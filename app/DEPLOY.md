# Deploying Foundry to your VPS

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
sudo mkdir -p /opt/foundry
# via ssh, e.g. rsync -e ssh build package.json package-lock.json deploy user@vps:/opt/foundry/
rsync -av --delete build package.json package-lock.json deploy /opt/foundry/
```

On the VPS, install production deps (this rebuilds better-sqlite3 natively):

```bash
cd /opt/foundry && npm install --omit=dev
```

## 3. Configure secrets

Create `/opt/foundry/.env` (see `.env.example`):

```
AUTH_SECRET=<long random string>       # e.g. `openssl rand -hex 32`
ADMIN_USER=<your login>
ADMIN_PASSWORD=<your password>
DATABASE_PATH=/opt/foundry/data/foundry.db
```

Create a service user so it doesn't run as root:

```bash
sudo useradd --system --home /opt/foundry foundry
sudo chown -R foundry:foundry /opt/foundry
```

## 4. Run as a service

```bash
sudo cp /opt/foundry/deploy/foundry.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now foundry
sudo systemctl status foundry          # should be active (running)
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

Rebuild locally, rsync `build/` up again, then `sudo systemctl restart foundry`.

## Managing the login

The first user is created automatically from `ADMIN_USER`/`ADMIN_PASSWORD` in
`.env` the first time the app starts with an empty database.

To change the password or add another user later — without touching your data:

```bash
cd /opt/foundry
sudo -u foundry DATABASE_PATH=/opt/foundry/data/foundry.db \
  node scripts/set-user.mjs <username> <new-password>
```

Sessions are stateless, so a password change takes effect immediately (existing
sessions keep working until they expire; restart the service to invalidate them).

## Google Fit steps (optional)

Foundry can pull your daily step count from Google Fit via its REST API. It's
opt-in: with the two env vars below unset, the "Connect Google Fit" button simply
doesn't appear. (Heads up: Google is winding the Fit REST API down in favour of
Health Connect, so treat this as a stopgap.)

One-time Google Cloud setup:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project and enable the **Fitness API** (APIs & Services → Library → "Fitness API").
2. Configure the **OAuth consent screen**: user type **External**, fill in the app
   name/email, add the scope `.../auth/fitness.activity.read`, and add your own
   Google account under **Test users**. You can leave it in "Testing" mode — a
   single-user personal app never needs Google verification.
3. Create an **OAuth client ID** → application type **Web application**. Under
   *Authorized redirect URIs* add exactly:
   `https://<your-domain>/api/fit/callback`
4. Copy the client ID + secret into `/opt/foundry/.env`:

```
GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>
```

`systemctl restart foundry`, then open the app → **Profile → Steps → Connect
Google Fit**, approve, and it syncs the last 30 days. It refreshes tokens on its
own; use **Sync now** to pull the latest, or **Disconnect** to revoke.

The redirect URI is auto-derived from the request origin (via adapter-node's
`ORIGIN`). If yours differs, pin it with `GOOGLE_REDIRECT_URI` — it must match the
console entry byte-for-byte.

## Schema changes / migrations

Schema evolves via a built-in runner (SQLite `user_version`) in `src/lib/server/db.ts`.
When a new feature needs a schema change, a migration is appended there; it applies
automatically on the next `systemctl restart foundry`. No manual DB steps, and it's
safe on both fresh and existing databases.

## Backups (nightly, 30-day retention)

The whole database is one file, but never plain-`cp` it while the app runs (WAL mode).
Use the included online-backup script + systemd timer:

```bash
# scripts came up in step 2 under /opt/foundry/deploy
sudo cp /opt/foundry/deploy/foundry-backup.service /etc/systemd/system/
sudo cp /opt/foundry/deploy/foundry-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now foundry-backup.timer

# verify
sudo systemctl list-timers foundry-backup.timer
sudo systemctl start foundry-backup.service   # run one now
ls -la /opt/foundry/backups
```

This writes `/opt/foundry/backups/foundry-<date>.db` at 03:30 nightly and deletes
copies older than 30 days (tune via `BACKUP_KEEP_DAYS` in `.env`).

### Photos are separate from the DB backup

Uploaded photos are files in `/opt/foundry/data/uploads/` (only their metadata is in
the DB). The nightly `.backup` covers the DB, **not** the image files — to protect
photos too, also copy that directory, e.g. `rsync -a /opt/foundry/data/uploads/
/opt/foundry/backups/uploads/` (add to `deploy/backup.sh` to automate).

### Restore

```bash
sudo systemctl stop foundry
sudo -u foundry cp /opt/foundry/backups/foundry-<date>.db /opt/foundry/data/foundry.db
sudo rm -f /opt/foundry/data/foundry.db-wal /opt/foundry/data/foundry.db-shm
sudo systemctl start foundry
```
