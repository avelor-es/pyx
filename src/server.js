// The server side: `pyx remote …`, called over ssh by the Mac. Values never leave this machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { load, dump } from 'js-yaml';
import { parse, set, remove, values, valueError, KEY_RE } from './env.js';
import { readStdin } from './ask.js';
import { fatal, ok, info, warn, col, G, Y, Z, VERSION } from './fmt.js';

export const NAME_RE = /^[A-Za-z0-9._-]+$/;

const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'pyx');
const PROJECTS_FILE = path.join(CONFIG_DIR, 'projects.yml');
const SALT_FILE = path.join(CONFIG_DIR, 'salt');

function readProjects() {
  try {
    return load(fs.readFileSync(PROJECTS_FILE, 'utf8'))?.projects ?? {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

// ponytail: dump drops comments; projects.yml is written by `pyx init`, not by hand.
function writeProjects(projects) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PROJECTS_FILE, dump({ projects }), { mode: 0o600 });
}

function project(name) {
  const p = readProjects()[name];
  if (!p) fatal(`"${name}" is not registered on ${os.hostname()}\n  run pyx init from the project`);
  return p;
}

// A short HMAC with a key that never leaves the server: it tells when a value changed,
// but a short or guessable value (a port, a phone number) cannot be recovered from it.
function fingerprint(value) {
  let salt;
  try {
    salt = fs.readFileSync(SALT_FILE);
  } catch {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    salt = crypto.randomBytes(32);
    fs.writeFileSync(SALT_FILE, salt, { mode: 0o600 });
  }
  return crypto.createHmac('sha256', salt).update(value).digest('hex').slice(0, 8);
}

function readEnv(dir) {
  try {
    return fs.readFileSync(path.join(dir, '.env'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function ownedByMe(file) {
  return fs.statSync(file).uid === process.getuid();
}

// Write a sibling file, then rename: the app never reads a half-written .env.
// A symlinked .env (shared/.env in Capistrano-style deploys) is written through, not replaced.
function writeEnv(dir, text) {
  let file = path.join(dir, '.env');
  let st = null;
  if (fs.existsSync(file)) {
    file = fs.realpathSync(file);
    st = fs.statSync(file);
    if (st.uid !== process.getuid()) fatal(`${file} belongs to another user; pyx will not change its owner`);
  }
  const mode = st ? st.mode & 0o777 : 0o600;
  const tmp = path.join(path.dirname(file), `.env.pyx-${process.pid}`);
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
    // Keep the group: a 0640 deploy:www-data .env must stay readable by the web server.
    if (st) fs.fchownSync(fd, st.uid, st.gid);
    fs.fchmodSync(fd, mode); // the umask may have narrowed it
  } catch (e) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    if (e.code === 'EPERM') fatal(`cannot keep the group of ${file}; ${os.userInfo().username} is not in it. Nothing was changed`);
    throw e;
  }
  fs.closeSync(fd);
  fs.renameSync(tmp, file);
}

function reload(p) {
  info(`reload: ${p.reload}`);
  const r = spawnSync(p.reload, { cwd: p.dir, shell: true, stdio: 'inherit' });
  if (r.status !== 0) fatal(`reload failed (exit ${r.status ?? r.signal}); the .env was already written`);
  ok('reloaded');
}

async function register(name) {
  const { dir, reload: command } = JSON.parse(await readStdin());

  if (!path.isAbsolute(dir)) fatal(`the directory must be an absolute path: ${dir}`);
  let st;
  try { st = fs.statSync(dir); } catch { fatal(`${dir} does not exist`); }
  if (!st.isDirectory()) fatal(`${dir} is not a directory`);
  try { fs.accessSync(dir, fs.constants.W_OK); } catch { fatal(`${dir} is not writable by ${os.userInfo().username}`); }
  ok(`${dir} exists and is writable`);

  const env = path.join(dir, '.env');
  if (fs.existsSync(env)) {
    if (!ownedByMe(env)) fatal(`${env} belongs to another user; connect as that user instead`);
    ok('.env found');
  } else {
    info('no .env yet; the first add creates it');
  }
  if (!fs.existsSync(path.join(dir, '.env.example'))) warn('no .env.example in that directory');
  if (!command?.trim()) fatal('the reload command is required');

  const projects = readProjects();
  projects[name] = { dir, reload: command };
  writeProjects(projects);
  ok(`${name} registered on ${os.hostname()}`);
}

export async function remote([cmd, name, key], flags) {
  if (!name || !NAME_RE.test(name)) fatal(`invalid project name: ${name}`);

  if (cmd === 'info') {
    const p = readProjects()[name];
    process.stdout.write(JSON.stringify({ version: VERSION, exists: !!p, ...p }) + '\n');
    return;
  }
  if (cmd === 'register') return register(name);

  const p = project(name);
  const text = readEnv(p.dir);

  if (cmd === 'ls') {
    info(`${name} · ${path.join(p.dir, '.env')}`);
    if (text === null) return info('no .env yet');
    const vars = values(text);
    const width = Math.max(0, ...[...vars.keys()].map(k => k.length)) + 2;
    for (const [k, v] of vars) {
      process.stdout.write('  ' + col(k, width) + (v ? G + fingerprint(v) + Z : Y + '(empty)' + Z) + '\n');
    }
    return;
  }

  if (!key || !KEY_RE.test(key)) fatal(`invalid key: ${key}`);

  if (cmd === 'add') {
    const value = await readStdin();
    const problem = valueError(value);
    if (problem) fatal(problem);
    const r = set(text ?? '', key, value);
    writeEnv(p.dir, r.text);
    ok(`${key} ${r.created ? 'created' : 'updated'}`);
  } else if (cmd === 'rm') {
    if (text === null || !parse(text).entries.some(e => e.key === key)) fatal(`${key} is not in the .env`);
    writeEnv(p.dir, remove(text, key).text);
    ok(`${key} removed`);
  } else {
    fatal(`unknown remote command: ${cmd}`);
  }

  if (!flags.has('--no-reload')) reload(p);
}
