#!/usr/bin/env bash
# One-time server setup for Foundry. Run ONCE on the VPS with sudo:
#   sudo bash setup.sh
#
# Idempotent-ish: re-running won't clobber an existing .env (your secrets).
# After this, deploy code from your laptop with `make deploy`.
set -euo pipefail

# --- Config (edit here if your setup differs) ---
DOMAIN="foundry12345.duckdns.org"
APP_DIR="/opt/foundry"
APP_USER="victor"          # owns the app dir + runs the service (the SSH/deploy user)
PORT=3000

if [ "$(id -u)" -ne 0 ]; then
	echo "Please run with sudo:  sudo bash setup.sh"
	exit 1
fi

echo "▶ Creating $APP_DIR (owned by $APP_USER) …"
mkdir -p "$APP_DIR/data" "$APP_DIR/backups"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# --- Secrets file (only written once; never overwritten) ---
if [ ! -f "$APP_DIR/.env" ]; then
	echo ""
	echo "Set up your Foundry login (stored hashed; this password is only used to"
	echo "create the account on first start)."
	read -rp "  Choose a username: " ADMIN_USER
	read -rsp "  Choose a password: " ADMIN_PASSWORD; echo
	AUTH_SECRET="$(openssl rand -hex 32)"
	cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=$PORT
HOST=127.0.0.1
ORIGIN=https://$DOMAIN
AUTH_SECRET=$AUTH_SECRET
ADMIN_USER=$ADMIN_USER
ADMIN_PASSWORD=$ADMIN_PASSWORD
DATABASE_PATH=$APP_DIR/data/foundry.db
BACKUP_DIR=$APP_DIR/backups
EOF
	chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
	chmod 600 "$APP_DIR/.env"
	echo "  ✓ wrote $APP_DIR/.env (AUTH_SECRET generated on-server)"
else
	echo "▶ $APP_DIR/.env already exists — leaving it untouched"
fi

# --- systemd: app service ---
echo "▶ Installing systemd units …"
cat > /etc/systemd/system/foundry.service <<EOF
[Unit]
Description=Foundry — personal workout tracker
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node build
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# --- systemd: nightly backup ---
cat > /etc/systemd/system/foundry-backup.service <<EOF
[Unit]
Description=Foundry SQLite backup

[Service]
Type=oneshot
User=$APP_USER
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/bash $APP_DIR/deploy/backup.sh
EOF

cat > /etc/systemd/system/foundry-backup.timer <<EOF
[Unit]
Description=Nightly Foundry backup

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

# --- Passwordless sudo for just the restart (lets `make deploy` be non-interactive) ---
echo "▶ Allowing '$APP_USER' to restart the service without a password …"
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart foundry" > /etc/sudoers.d/foundry
chmod 440 /etc/sudoers.d/foundry
visudo -cf /etc/sudoers.d/foundry >/dev/null

# --- Caddy: reverse proxy + automatic HTTPS ---
echo "▶ Configuring Caddy for https://$DOMAIN …"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF

# --- Firewall (only if ufw is active) ---
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
	echo "▶ Opening ports 80/443 in ufw …"
	ufw allow 80,443/tcp >/dev/null || true
fi

systemctl daemon-reload
systemctl enable foundry.service >/dev/null 2>&1 || true
systemctl enable --now foundry-backup.timer >/dev/null 2>&1 || true
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo ""
echo "✓ Server setup complete."
echo "  The app service is installed but not started yet (no code deployed)."
echo "  Now run  'make deploy'  from your laptop to ship the build."
