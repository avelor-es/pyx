// Runs `pyx remote …` as ssh would, against a temporary project and config directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BIN = new URL('../bin/pyx.js', import.meta.url).pathname;

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyx-'));
  const dir = path.join(root, 'app');
  fs.mkdirSync(dir);
  const pyx = (args, input = '') => spawnSync(process.execPath, [BIN, 'remote', ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: path.join(root, 'config') },
  });
  const register = reload => pyx(['register', 'app'], JSON.stringify({ dir, reload }));
  return { root, dir, pyx, register, env: () => fs.readFileSync(path.join(dir, '.env'), 'utf8') };
}

test('register rejects a relative or missing directory', () => {
  const { pyx } = setup();
  assert.equal(pyx(['register', 'app'], JSON.stringify({ dir: 'app', reload: 'true' })).status, 1);
  assert.equal(pyx(['register', 'app'], JSON.stringify({ dir: '/nope/pyx', reload: 'true' })).status, 1);
});

test('add creates a 0600 .env, updates in place and keeps comments', () => {
  const { dir, pyx, register, env } = setup();
  assert.equal(register('true').status, 0);

  assert.equal(pyx(['add', 'app', 'A', '--no-reload'], 'one').status, 0);
  assert.equal(fs.statSync(path.join(dir, '.env')).mode & 0o777, 0o600);

  fs.writeFileSync(path.join(dir, '.env'), '# keep\nA=one\nB=two\n');
  assert.equal(pyx(['add', 'app', 'A', '--no-reload'], 'new value').status, 0);
  assert.equal(env(), "# keep\nA='new value'\nB=two\n");
  assert.deepEqual(fs.readdirSync(dir), ['.env']); // no temp file left behind
});

test('add keeps the mode of an existing .env', () => {
  const { dir, pyx, register } = setup();
  register('true');
  fs.writeFileSync(path.join(dir, '.env'), 'A=1\n', { mode: 0o640 });
  fs.chmodSync(path.join(dir, '.env'), 0o640);
  pyx(['add', 'app', 'B', '--no-reload'], '2');
  assert.equal(fs.statSync(path.join(dir, '.env')).mode & 0o777, 0o640);
});

test('add writes through a symlinked .env', () => {
  const { root, dir, pyx, register } = setup();
  register('true');
  const shared = path.join(root, 'shared.env');
  fs.writeFileSync(shared, 'A=1\n');
  fs.symlinkSync(shared, path.join(dir, '.env'));
  assert.equal(pyx(['add', 'app', 'B', '--no-reload'], '2').status, 0);
  assert.ok(fs.lstatSync(path.join(dir, '.env')).isSymbolicLink());
  assert.equal(fs.readFileSync(shared, 'utf8'), 'A=1\nB=2\n');
});

test('rm removes the key and fails on a missing one', () => {
  const { dir, pyx, register, env } = setup();
  register('true');
  fs.writeFileSync(path.join(dir, '.env'), 'A=1\nB=2\n');
  assert.equal(pyx(['rm', 'app', 'A', '--no-reload']).status, 0);
  assert.equal(env(), 'B=2\n');
  assert.equal(pyx(['rm', 'app', 'A', '--no-reload']).status, 1);
});

test('add refuses empty and multi-line values', () => {
  const { pyx, register } = setup();
  register('true');
  assert.equal(pyx(['add', 'app', 'A', '--no-reload'], '').status, 1);
  assert.equal(pyx(['add', 'app', 'A', '--no-reload'], 'a\nb').status, 1);
});

test('reload runs in the project directory; a failed reload exits 1 after writing', () => {
  const { dir, pyx, register, env } = setup();
  register('touch reloaded');
  assert.equal(pyx(['add', 'app', 'A'], '1').status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'reloaded')));

  register('exit 3');
  assert.equal(pyx(['add', 'app', 'A'], '2').status, 1);
  assert.equal(env(), 'A=2\n');
});

test('ls shows fingerprints, never values, and they change with the value', () => {
  const { pyx, register } = setup();
  register('true');
  pyx(['add', 'app', 'SECRET', '--no-reload'], 'hunter2');
  const before = pyx(['ls', 'app']).stdout;
  assert.ok(!before.includes('hunter2'));
  pyx(['add', 'app', 'SECRET', '--no-reload'], 'hunter3');
  assert.notEqual(pyx(['ls', 'app']).stdout, before);
});

test('an unregistered project or invalid name fails', () => {
  const { pyx } = setup();
  assert.equal(pyx(['ls', 'other']).status, 1);
  assert.equal(pyx(['ls', '../x']).status, 1);
});
