#!/usr/bin/env bash
# HTTPS front-door for Foundry on a box that ALREADY runs nginx (this VPS also
# serves 'cuprint'). Adds an nginx vhost for our hostname + a Let's Encrypt cert,
# and disables the Caddy attempt (Caddy can't coexist on the same ports).
# Run ONCE with sudo:  sudo bash setup-nginx.sh
set -euo pipefail

DOMAIN="foundry12345.duckdns.org"
PORT=3000

if [ "$(id -u)" -ne 0 ]; then
	echo "Please run with sudo:  sudo bash setup-nginx.sh"
	exit 1
fi

echo "▶ Disabling the conflicting Caddy service …"
systemctl disable --now caddy 2>/dev/null || true

echo "▶ Installing certbot (nginx plugin) …"
apt-get update -qq
apt-get install -y -qq certbot python3-certbot-nginx

echo "▶ Writing nginx vhost for $DOMAIN (routes only that hostname; cuprint untouched) …"
cat > /etc/nginx/sites-available/foundry <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/foundry /etc/nginx/sites-enabled/foundry

nginx -t
systemctl reload nginx

echo "▶ Obtaining HTTPS certificate via Let's Encrypt …"
# No account email (auto-renewal still runs via certbot's systemd timer).
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect

systemctl reload nginx
echo ""
echo "✓ nginx + HTTPS ready for https://$DOMAIN"
echo "  (the app will return 502 until you run 'make deploy' to ship the code)."
