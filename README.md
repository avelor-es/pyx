<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/avelor-es/pyx/main/pyx-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/avelor-es/pyx/main/pyx-light.svg">
    <img src="https://raw.githubusercontent.com/avelor-es/pyx/main/pyx-light.svg" alt="pyx — keep a server's .env without logging into the server" width="700">
  </picture>
</p>

---

A new environment variable on a server you deploy to with CI usually goes like this: `ssh`, `cd /srv/app`, `nano .env`, paste, save, `pm2 restart app`, `exit`. Every time. And the day you forget, the deploy goes out without it.

**pyx** does it from your project's folder, without logging in:

```sh
pyx add STRIPE_KEY
```

<p align="center">
  <img src="https://raw.githubusercontent.com/avelor-es/pyx/main/demo.svg" alt="pyx add, pyx ls and pyx rm in a terminal" width="700"/>
</p>

## Why pyx

- **Nothing new on the server.** No daemon, no open port, no web panel. Every command rides on the ssh access you already have.
- **Values go in, never out.** `pyx ls` shows each key with a fingerprint of its value; no command ever brings a value back to your machine. The value travels on stdin, so it never lands in `ps` or a shell history.
- **Your .env stays yours.** Comments, blank lines and order survive every write, and the app never reads a half-written file.
- **Deploys that know what they need.** `pyx check` fails a deploy before the restart when a key in `.env.example` is missing on the server.
- **One small dependency.** Plain Node, and `js-yaml`.

## Quick start

On your machine **and** on the server, both macOS or Linux:

```sh
npm install -g @avelor/pyx
```

From your project's root:

```
$ pyx init
→ hosts in ~/.ssh/config: shop-prod
SSH host or alias [shop-prod] ›
Project [shop] ›
✓ connected to shop-prod
→ shop is not registered on shop-prod yet
Directory on the server [/var/www/html/shop] › /srv/shop
Reload command [pm2 restart shop] ›
✓ /srv/shop exists and is writable
✓ .env found
✓ shop registered on app-01
✓ .pyx.yml written; commit it with the project

$ pyx add SESSION_SECRET
SESSION_SECRET: ••••••••••••
✓ SESSION_SECRET created
→ reload: pm2 restart shop
✓ reloaded
```

That's it. Anyone who clones the project and has the same alias in their `~/.ssh/config` can now run `pyx` too.

## Commands

Run them anywhere inside the project; pyx finds `.pyx.yml` the way git finds `.git`.

| Command | |
|---|---|
| `pyx init` | Connect the project to its server |
| `pyx ls` | The keys in the server's `.env`, each with a fingerprint of its value |
| `pyx add <KEY>` | Create or update a key, then reload the app |
| `pyx rm <KEY>` | Remove a key, then reload the app |
| `pyx check` | Fail when the `.env` here lacks a key from `.env.example` |
| `pyx help` | |

### `pyx add <KEY>`

```sh
pyx add STRIPE_KEY                     # asks for the value without echoing it
pbpaste | pyx add STRIPE_KEY           # or reads it from stdin
pyx add A --no-reload && pyx add B     # several keys, a single reload
```

Empty and multi-line values are refused. If the key is already there, its line is updated where it is.

### `pyx rm <KEY>`

Removes every occurrence of the key. `--no-reload` skips the reload.

### `pyx ls`

```
→ shop · /srv/shop/.env
  DATABASE_URL    9c41e07a
  SMTP_PASSWORD   (empty)
  STRIPE_KEY      3f9a2c1e
```

The fingerprint changes when the value changes, so you can see that an `add` landed. It is an HMAC keyed with a random secret that never leaves the server (`~/.config/pyx/salt`), so even a short or guessable value cannot be worked out from it.

### `pyx check`

Compares the `.env` in the **current directory** with the `.env.example` next to it, on whatever machine it runs. Every key in `.env.example` is required; commented lines are ignored, so they are free for notes. It exits with `1` when a key is missing or empty, and warns about keys that `.env.example` does not list.

It needs no `.pyx.yml` and no ssh, which makes it a good deploy step. With [@avelor/floo](https://github.com/avelor-es/floo), which runs each step in the project's directory:

```yaml
projects:
  shop:
    cwd: /srv/shop
    steps:
      - git pull origin main
      - pyx check
      - npm ci
      - pm2 restart shop
```

A push that needs a new key now stops before the restart, with `✗ STRIPE_KEY is missing or empty`. Run `pyx add STRIPE_KEY` and deploy again.

## Configuration

`init` asks for everything, but keeps each answer in one place only:

| | Kept in |
|---|---|
| SSH host alias and project name | `.pyx.yml`, in the project; commit it |
| Address and user of the server | `~/.ssh/config`, on your machine |
| Directory on the server and reload command | `~/.config/pyx/projects.yml`, on the server |

```yaml
# .pyx.yml
host: shop-prod
project: shop
```

```yaml
# ~/.config/pyx/projects.yml, on the server
projects:
  shop:
    dir: /srv/shop
    reload: pm2 restart shop
```

### Keep your infrastructure out of the repo

`.pyx.yml` is committed, so `host` should be an alias, not an address. pyx hands it to `ssh` as it is, and ssh resolves it from your own `~/.ssh/config`:

```
# ~/.ssh/config, on your machine
Host shop-prod
  HostName 10.0.0.12
  User deploy
```

The repository then names the server without saying where it is or who logs in. If you answer `init` with an address or `user@host` instead, it shows you this block, ready to paste, before writing anything.

### Everything else stays on the server

The repository never learns where the app lives or how it restarts: moving it or changing how it reloads is a change on the server alone. If the project is already registered there (a second machine, a fresh clone), `init` only writes `.pyx.yml`.

The reload command is any shell command, run in the project's directory: `pm2 restart shop`, `systemctl --user restart shop`, `docker compose up -d`, `touch tmp/restart.txt`.

**Connect as the user that owns the app's `.env` and runs the app** (the `User` of the alias). pyx writes the file and runs the reload as that user, so it never needs `sudo`.

## How the .env is written

- `add` rewrites the key's line where it is, dropping later duplicates, or appends it at the end. `rm` removes only that key's lines.
- Values are written bare when nothing in them could be misread, otherwise in single quotes, otherwise (when they contain `'`) in double quotes. A value with `'` and also `"`, `\` or `$` is refused: Node, phpdotenv, python-dotenv and Ruby dotenv would each read it differently.
- Each write goes to a sibling file that is then renamed over `.env`. A symlinked `.env` is written through to its target.
- The file keeps its permissions and its group; a new `.env` is created `0600`. pyx refuses to write a `.env` owned by another user rather than take it over.
- If the reload fails, the `.env` has already been written: pyx shows the reload's output and exits with `1`.

## FAQ

**Can I read a value back?** Not through pyx, by design. Log into the server and read the file.

**Does it keep a history?** No. No copies, no log. The `.env` on the server is the only truth.

**Does my app need to change?** No. If it reads a `.env` (`node --env-file`, dotenv, Laravel, Django, Rails…), it keeps doing exactly that.

**`pyx init` says pyx is not on the PATH.** Over ssh, commands run in a non-interactive shell, which skips `~/.zshrc`. If Node comes from nvm or fnm, export its `PATH` in `~/.zshenv` (zsh) or near the top of `~/.bashrc` (bash).

**Is this a secrets manager?** No. Vault, Doppler and Infisical handle teams, policies, audit logs and rotation. sops and dotenvx keep encrypted secrets in the repository. pyx is for a server you deploy to yourself and the `.env` it already has.

## Develop

```sh
pnpm install
pnpm test
```

---

<p align="center">
  <sub>Avelor · <a href="https://pkg.avelor.es">pkg.avelor.es</a> · MIT</sub>
</p>
