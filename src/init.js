// The local side of setup: asks everything, keeps host and project in .pyx.yml,
// and sends the directory and the reload command to the server only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load, dump } from 'js-yaml';
import { ask, confirm, close } from './ask.js';
import { run, capture } from './ssh.js';
import { NAME_RE } from './server.js';
import { fatal, ok, info, warn, VERSION } from './fmt.js';

export const CONFIG_FILE = '.pyx.yml';

// .pyx.yml comes from the repo: a host such as `-oProxyCommand=…` would run a command on this machine.
export const HOST_RE = /^[A-Za-z0-9_.@:\[\]-]+$/;
const hostError = host => (!HOST_RE.test(host) || host.startsWith('-') ? `invalid ssh host: ${host}` : null);

// Found from any directory inside the project, like git.
export function loadConfig() {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const file = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(file)) {
      const c = load(fs.readFileSync(file, 'utf8')) ?? {};
      if (!c.host || !c.project) fatal(`${file} needs both host and project`);
      const problem = hostError(String(c.host));
      if (problem) fatal(`${problem} in ${file}`);
      return c;
    }
    if (dir === path.dirname(dir)) fatal(`no ${CONFIG_FILE} here or above\n  run pyx init in the project's root`);
  }
}

function sshHosts() {
  try {
    const text = fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8');
    return [...text.matchAll(/^\s*Host\s+(.+)$/gim)]
      .flatMap(m => m[1].trim().split(/\s+/))
      .filter(h => !/[*?!]/.test(h));
  } catch {
    return [];
  }
}

function defaultProject() {
  let name = path.basename(process.cwd());
  try {
    name = JSON.parse(fs.readFileSync('package.json', 'utf8')).name?.replace(/^@[^/]+\//, '') || name;
  } catch {}
  return name.replace(/[^A-Za-z0-9._-]/g, '-');
}

function defaultReload(project) {
  try {
    const names = [...fs.readFileSync('ecosystem.config.cjs', 'utf8').matchAll(/name:\s*["'`]([^"'`]+)/g)].map(m => m[1]);
    if (names.length === 1) return `pm2 restart ${names[0]}`;
    if (names.length > 1) return 'pm2 restart ecosystem.config.cjs';
  } catch {}
  return `pm2 restart ${project}`;
}

export async function init() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      process.stdout.write(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (!(await confirm(`${CONFIG_FILE} already exists. Replace it?`))) return;
    }

    const hosts = sshHosts();
    if (hosts.length) info(`hosts in ~/.ssh/config: ${hosts.join(', ')}`);
    const host = await ask('SSH host or alias', hosts[0]);
    if (hostError(host)) fatal(hostError(host));
    const project = await ask('Project', defaultProject());
    if (!NAME_RE.test(project)) fatal('the project name may only use letters, digits, ".", "_" and "-"');

    // .pyx.yml is committed: an alias keeps the address and the user in ~/.ssh/config, out of the repo.
    if (!hosts.includes(host)) {
      const at = host.lastIndexOf('@');
      const user = at === -1 ? null : host.slice(0, at);
      const hostname = host.slice(at + 1);
      const alias = `${project}-server`;
      warn(`${host} will be committed in ${CONFIG_FILE}`);
      process.stdout.write(
        `  keep it out of the repo with an alias in ~/.ssh/config:\n\n` +
        `    Host ${alias}\n      HostName ${hostname}\n${user ? `      User ${user}\n` : ''}\n` +
        `  then run pyx init again and answer ${alias}\n`,
      );
      if (!(await confirm('Commit it as is?'))) return;
    }

    const remote = JSON.parse(capture(host, ['info', project]));
    ok(`connected to ${host}`);
    if (remote.version !== VERSION) warn(`the server runs pyx ${remote.version}, this machine ${VERSION}`);

    let register = !remote.exists;
    if (remote.exists) {
      info(`${project} is already registered there: ${remote.dir} · ${remote.reload}`);
      register = !(await confirm('Keep it?', true));
    } else {
      info(`${project} is not registered on ${host} yet`);
    }

    if (register) {
      const dir = await ask('Directory on the server', remote.dir || `/var/www/html/${project}`);
      const reload = await ask('Reload command', remote.reload || defaultReload(project));
      const code = await run(host, ['register', project], JSON.stringify({ dir, reload }));
      if (code !== 0) process.exit(code);
    }

    fs.writeFileSync(CONFIG_FILE, dump({ host, project }));
    ok(`${CONFIG_FILE} written; commit it with the project`);
  } finally {
    close();
  }
}
