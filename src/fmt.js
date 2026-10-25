import fs from 'node:fs';

export const G  = '\x1b[90m';
export const W  = '\x1b[97m';
export const Y  = '\x1b[33m';
export const GR = '\x1b[32m';
export const R  = '\x1b[31m';
export const Z  = '\x1b[0m';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export function col(str, width) {
  str = String(str ?? '');
  return str + ' '.repeat(Math.max(0, width - str.length));
}

export function fatal(msg) {
  process.stderr.write(R + 'error: ' + Z + msg + '\n');
  process.exit(1);
}

export function ok(msg) {
  process.stdout.write(GR + '✓ ' + Z + msg + '\n');
}

export function info(msg) {
  process.stdout.write(G + '→ ' + Z + msg + '\n');
}

export function warn(msg) {
  process.stdout.write(Y + '⚠ ' + Z + msg + '\n');
}
