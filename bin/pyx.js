#!/usr/bin/env node
import fs from 'node:fs';
import { init, loadConfig } from '../src/init.js';
import { run } from '../src/ssh.js';
import { remote } from '../src/server.js';
import { check, valueError, KEY_RE } from '../src/env.js';
import { secret, readStdin } from '../src/ask.js';
import { fatal, ok, info, warn, G, W, R, Z, VERSION } from '../src/fmt.js';

const USAGE = `
${G}pyx${Z} — keep a server's .env without logging into the server

${G}from the project${Z}
  ${W}init${Z}                   connect this project to its server (writes .pyx.yml)
  ${W}ls${Z}                     keys in the server's .env, with a fingerprint per value
  ${W}add${Z} <KEY> [--no-reload] create or update a key; the value is asked for, or read from stdin
  ${W}rm${Z} <KEY> [--no-reload]  remove a key

${G}anywhere${Z}
  ${W}check${Z}                  the .env in this directory has every key in .env.example

${G}config:${Z} .pyx.yml in the project · ~/.config/pyx/projects.yml on the server
`;

const [cmd, ...args] = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const [key] = args.filter(a => !a.startsWith('--'));
const reloadFlag = flags.has('--no-reload') ? ['--no-reload'] : [];

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function needKey() {
  if (!key) fatal(`usage: pyx ${cmd} <KEY>`);
  if (!KEY_RE.test(key)) fatal(`invalid key: ${key} (letters, digits and "_", not starting with a digit)`);
}

switch (cmd) {
  case 'init':
    await init();
    break;

  case 'ls': {
    const c = loadConfig();
    process.exit(await run(c.host, ['ls', c.project]));
  }

  case 'add': {
    needKey();
    const c = loadConfig();
    info(`${c.project} on ${c.host}`);
    const value = process.stdin.isTTY
      ? await secret(`${key}: `)
      : (await readStdin()).replace(/\r?\n$/, ''); // `pbpaste | pyx add KEY`, `echo … | pyx add KEY`
    const problem = valueError(value);
    if (problem) fatal(problem);
    process.exit(await run(c.host, ['add', c.project, key, ...reloadFlag], value));
  }

  case 'rm': {
    needKey();
    const c = loadConfig();
    process.exit(await run(c.host, ['rm', c.project, key, ...reloadFlag]));
  }

  case 'check': {
    const example = read('.env.example');
    if (example === null) fatal('no .env.example in this directory');
    const { missing, extra } = check(example, read('.env') ?? '');
    for (const k of extra) warn(`${k} is in .env but not in .env.example`);
    if (missing.length) {
      for (const k of missing) process.stderr.write(`${R}✗${Z} ${k} is missing or empty\n`);
      process.exit(1);
    }
    ok('.env has every key in .env.example');
    break;
  }

  case 'remote': // called over ssh by the Mac side
    await remote(args.filter(a => !a.startsWith('--')), flags);
    break;

  case '--version':
  case '-v':
    process.stdout.write(VERSION + '\n');
    break;

  default:
    process.stdout.write(USAGE + '\n');
    process.exit(cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h' ? 1 : 0);
}
