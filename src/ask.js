import readline from 'node:readline/promises';

let rl = null;

function open() {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}

export function close() {
  if (rl) { rl.close(); rl = null; }
}

export async function ask(question, fallback = '') {
  const hint = fallback ? ` [${fallback}]` : '';
  while (true) {
    const answer = (await open().question(`${question}${hint} › `)).trim() || fallback;
    if (answer) return answer;
    process.stdout.write('  (required)\n');
  }
}

export async function confirm(question, fallback = false) {
  const answer = (await open().question(`${question} ${fallback ? '[Y/n]' : '[y/N]'} › `)).trim().toLowerCase();
  return answer ? answer.startsWith('y') : fallback;
}

// Reads a value without echoing it.
export function secret(prompt) {
  const { stdin, stderr } = process;
  stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  return new Promise(resolve => {
    let value = '';
    const done = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write('\n');
    };
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { done(); return resolve(value); }
        if (ch === '\u0003') { done(); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

export async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}
