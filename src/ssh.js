// The Mac side: every ls, add and rm runs `pyx remote …` on the server over ssh.
import { spawn, spawnSync } from 'node:child_process';
import { fatal } from './fmt.js';

const sq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const command = args => ['pyx', 'remote', ...args].map(sq).join(' ');

function explain(code, host) {
  if (code === 255) fatal(`could not connect to ${host}`);
  if (code === 127) {
    fatal(
      `pyx is not on the PATH of non-interactive shells on ${host}\n` +
      `  install it there: npm install -g @avelor/pyx\n` +
      `  if it already is (nvm, fnm), export its PATH in ~/.zshenv or ~/.bashrc, not only in ~/.zshrc`,
    );
  }
}

// Streams the server's output; the value, when there is one, travels on stdin and never as an argument.
export function run(host, args, input) {
  return new Promise(resolve => {
    const child = spawn('ssh', ['-T', '--', host, command(args)], {
      stdio: [input === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'],
    });
    if (input !== undefined) child.stdin.end(input);
    child.on('close', code => {
      explain(code, host);
      resolve(code ?? 1);
    });
  });
}

export function capture(host, args) {
  const r = spawnSync('ssh', ['-T', '--', host, command(args)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  explain(r.status, host);
  if (r.status !== 0) process.exit(r.status ?? 1);
  return r.stdout;
}
