import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, set, remove, quote, check, values, valueError } from '../src/env.js';

const SAMPLE = `# Mail
MAIL_FROM="Shop <hello@example.com>"
export PORT=8790

TOKEN='abc#def' # inline comment
PLAIN=value # comment
KEY="-----BEGIN
line
-----END"
`;

test('parse reads quotes, export, inline comments and multi-line values', () => {
  const v = values(SAMPLE);
  assert.equal(v.get('MAIL_FROM'), 'Shop <hello@example.com>');
  assert.equal(v.get('PORT'), '8790');
  assert.equal(v.get('TOKEN'), 'abc#def');
  assert.equal(v.get('PLAIN'), 'value');
  assert.equal(v.get('KEY'), '-----BEGIN\nline\n-----END');
  assert.equal(parse(SAMPLE).entries.length, 5);
});

test('set updates in place and keeps everything else', () => {
  const { text, created } = set(SAMPLE, 'PORT', '9000');
  assert.equal(created, false);
  assert.equal(text, SAMPLE.replace('export PORT=8790', 'PORT=9000'));
});

test('set replaces a whole multi-line value', () => {
  const { text } = set(SAMPLE, 'KEY', 'short');
  assert.ok(!text.includes('-----END'));
  assert.equal(values(text).get('KEY'), 'short');
  assert.equal(values(text).get('PLAIN'), 'value');
});

test('set appends a new key before the trailing newline', () => {
  assert.deepEqual(set('A=1\n', 'B', '2'), { text: 'A=1\nB=2\n', created: true });
  assert.deepEqual(set('', 'B', '2'), { text: 'B=2\n', created: true });
  assert.deepEqual(set('A=1', 'B', '2'), { text: 'A=1\nB=2\n', created: true });
});

test('set collapses duplicates into the first occurrence', () => {
  assert.equal(set('A=1\nB=2\nA=3\n', 'A', '9').text, 'A=9\nB=2\n');
});

test('remove drops every occurrence and nothing else', () => {
  assert.deepEqual(remove('# a\nA=1\nB=2\nA=3\n', 'A'), { text: '# a\nB=2\n', removed: true });
  assert.equal(remove('B=2\n', 'A').removed, false);
});

test('quote leaves safe values bare and picks a quote the value lacks', () => {
  assert.equal(quote('re_123-abc.def:8790/x@y+z'), 're_123-abc.def:8790/x@y+z');
  assert.equal(quote('two words'), `'two words'`);
  assert.equal(quote('a $b'), `'a $b'`);
  assert.equal(quote(`it's`), `"it's"`);
  for (const v of [`it's "x"`, `it's $x`, `it's \\n`]) {
    assert.throws(() => quote(v));
    assert.ok(valueError(v));
  }
  for (const v of ['a b', 'a#b', `it's`, 'a\\nb']) assert.equal(values(`K=${quote(v)}`).get('K'), v);
});

test('a quote never closed is a single line and does not swallow the rest', () => {
  const text = "A='oops\nB=1\nC=2\n";
  assert.equal(set(text, 'A', 'x').text, 'A=x\nB=1\nC=2\n');
  assert.equal(remove(text, 'A').text, 'B=1\nC=2\n');
  assert.equal(values(text).get('B'), '1');
});

test('valueError rejects empty and multi-line values', () => {
  assert.ok(valueError(''));
  assert.ok(valueError('a\nb'));
  assert.equal(valueError('ok'), null);
});

test('check requires every key in .env.example and ignores comments', () => {
  const example = '# Context for devs\nA=\nB=example\n# C=\n';
  assert.deepEqual(check(example, 'A=1\nB=2\n'), { missing: [], extra: [] });
  assert.deepEqual(check(example, 'A=1\nB=\nD=4\n'), { missing: ['B'], extra: ['D'] });
  assert.deepEqual(check(example, ''), { missing: ['A', 'B'], extra: [] });
});
