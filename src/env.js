// Reads and edits .env text line by line, so comments, blank lines and order survive every write.

export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const QUOTES = ['\'', '`', '"'];

export function parse(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LINE_RE.exec(lines[i]);
    if (!m) continue; // comments, blank lines and anything else are kept as they are
    const start = i;
    let raw = m[2];
    const q = raw[0];
    if (QUOTES.includes(q) && raw.indexOf(q, 1) === -1) {
      // A quoted value left open runs until the line that closes it.
      while (i + 1 < lines.length) {
        raw += '\n' + lines[++i];
        if (lines[i].includes(q)) break;
      }
    }
    entries.push({ key: m[1], value: unquote(raw), start, end: i });
  }
  return { lines, entries };
}

function unquote(raw) {
  const q = raw[0];
  if (QUOTES.includes(q)) {
    const close = raw.indexOf(q, 1);
    const value = close === -1 ? raw.slice(1) : raw.slice(1, close);
    return q === '"' ? value.replace(/\\n/g, '\n') : value;
  }
  const hash = raw.indexOf('#');
  return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}

// Unquoted when nothing in the value could be misread; otherwise the first quote it does not contain.
// Double quotes go last because Node expands \n inside them.
export function quote(value) {
  if (/^[\w.\-:/@+,=%]*$/.test(value)) return value;
  const q = QUOTES.find(c => !value.includes(c));
  if (!q) throw new Error('the value contains \', ` and " at once, which no .env quoting can hold');
  return q + value + q;
}

export function valueError(value) {
  if (!value) return 'the value is empty';
  if (/[\r\n]/.test(value)) return 'the value spans more than one line';
  return null;
}

// Updates the key in place (dropping later duplicates) or appends it at the end.
export function set(text, key, value) {
  const { lines, entries } = parse(text);
  const line = `${key}=${quote(value)}`;
  const hits = entries.filter(e => e.key === key);

  if (!hits.length) {
    const at = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    lines.splice(at, 0, line);
    if (lines[lines.length - 1] !== '') lines.push('');
    return { text: lines.join('\n'), created: true };
  }

  for (const e of hits.slice(1).reverse()) lines.splice(e.start, e.end - e.start + 1);
  lines.splice(hits[0].start, hits[0].end - hits[0].start + 1, line);
  return { text: lines.join('\n'), created: false };
}

export function remove(text, key) {
  const { lines, entries } = parse(text);
  const hits = entries.filter(e => e.key === key);
  for (const e of hits.reverse()) lines.splice(e.start, e.end - e.start + 1);
  return { text: lines.join('\n'), removed: hits.length > 0 };
}

// Last occurrence wins, as when Node loads the file.
export function values(text) {
  return new Map(parse(text).entries.map(e => [e.key, e.value]));
}

// Every key written in .env.example is required; commented lines are not keys.
export function check(example, env) {
  const have = values(env);
  const required = [...values(example).keys()];
  return {
    missing: required.filter(k => !have.get(k)),
    extra: [...have.keys()].filter(k => !required.includes(k)),
  };
}
