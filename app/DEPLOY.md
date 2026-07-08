# Deploying Logbook to your VPS

The app is a SvelteKit server (adapter-node) + a SQLite file. It runs behind
Caddy, which gives it automatic HTTPS. HTTPS is what makes the phone install work.

## 0. DNS (once)

Add an **A record**: `fitness.yourdomain.com` → your VPS public IP.

## 1. Install prerequisites on the VPS

```bash
# Node 20+ (via nodesource), Caddy, and the sqlite3 CLI (used for backups)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs caddy sqlite3
```

## 2. Build locally, copy up

From this `app/` folder on your machine:

```bash
npm install
npm run build                      # -> ./build (the Node server)

# Copy the pieces the server needs
sudo mkdir -p /opt/logbook
# via ssh, e.g. rsync -e ssh build package.json package-lock.json deploy user@vps:/opt/logbook/
rsync -av --delete build package.json package-lock.json deploy /opt/logbook/
```

On the VPS, install production deps (this rebuilds better-sqlite3 natively):

```bash
cd /opt/logbook && npm install --omit=dev
```

## 3. Configure secrets

Create `/opt/logbook/.env` (see `.env.example`):

```
AUTH_SECRET=<long random string>       # e.g. `openssl rand -hex 32`
ADMIN_USER=<your login>
ADMIN_PASSWORD=<your password>
DATABASE_PATH=/opt/logbook/data/logbook.db
```

Create a service user so it doesn't run as root:

```bash
sudo useradd --system --home /opt/logbook logbook
sudo chown -R logbook:logbook /opt/logbook
```

## 4. Run as a service

```bash
sudo cp /opt/logbook/deploy/logbook.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now logbook
sudo systemctl status logbook          # should be active (running)
```

(The single user is created from ADMIN_USER/ADMIN_PASSWORD the first time it starts.)

## 5. HTTPS via Caddy

Put `deploy/Caddyfile` at `/etc/caddy/Caddyfile` (edit the domain), then:

```bash
sudo systemctl reload caddy
```

Open the firewall for web traffic:

```bash
sudo ufw allow 80,443/tcp
```

## 6. Install on your phone

Open `https://fitness.yourdomain.com`, sign in, then:

- **Android/Chrome:** menu → *Install app* / *Add to Home screen*
- **iOS/Safari:** Share → *Add to Home Screen*

You get an app icon, fullscreen, and it opens offline (the in-progress session is
kept locally and syncs when you save).

## Updating later

Rebuild locally, rsync `build/` up again, then `sudo systemctl restart logbook`.

## Managing the login

The first user is created automatically from `ADMIN_USER`/`ADMIN_PASSWORD` in
`.env` the first time the app starts with an empty database.

To change the password or add another user later — without touching your data:

```bash
cd /opt/logbook
sudo -u logbook DATABASE_PATH=/opt/logbook/data/logbook.db \
  node scripts/set-user.mjs <username> <new-password>
```

Sessions are stateless, so a password change takes effect immediately (existing
sessions keep working until they expire; restart the service to invalidate them).

## Schema changes / migrations

Schema evolves via a built-in runner (SQLite `user_version`) in `src/lib/server/db.ts`.
When a new feature needs a schema change, a migration is appended there; it applies
automatically on the next `systemctl restart logbook`. No manual DB steps, and it's
safe on both fresh and existing databases.

## Backups (nightly, 30-day retention)

The whole database is one file, but never plain-`cp` it while the app runs (WAL mode).
Use the included online-backup script + systemd timer:

```bash
# scripts came up in step 2 under /opt/logbook/deploy
sudo cp /opt/logbook/deploy/logbook-backup.service /etc/systemd/system/
sudo cp /opt/logbook/deploy/logbook-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now logbook-backup.timer

# verify
sudo systemctl list-timers logbook-backup.timer
sudo systemctl start logbook-backup.service   # run one now
ls -la /opt/logbook/backups
```

This writes `/opt/logbook/backups/logbook-<date>.db` at 03:30 nightly and deletes
copies older than 30 days (tune via `BACKUP_KEEP_DAYS` in `.env`).

### Restore

```bash
sudo systemctl stop logbook
sudo -u logbook cp /opt/logbook/backups/logbook-<date>.db /opt/logbook/data/logbook.db
sudo rm -f /opt/logbook/data/logbook.db-wal /opt/logbook/data/logbook.db-shm
sudo systemctl start logbook
```
