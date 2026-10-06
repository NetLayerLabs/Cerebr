#!/usr/bin/env bash
# Installs or updates cerebr.xyz on the VPS. Run from the unpacked bundle (repo root):
#   bash deploy/install.sh            # build + start the container, add the nginx site
#   bash deploy/install.sh --https    # then: certificate for cerebr.xyz and www via certbot
# It only touches: the cerebr-web container, /opt/cerebr-web, and /etc/nginx/sites-{available,enabled}/cerebr.xyz.
# Every nginx change is checked with `nginx -t` before a reload, and rolled back if the check fails.
set -euo pipefail
DOMAIN=cerebr.xyz
SITE=/etc/nginx/sites-available/$DOMAIN
LINK=/etc/nginx/sites-enabled/$DOMAIN
PORT=8140
HERE="$(cd "$(dirname "$0")/.." && pwd)"
say() { printf '\n== %s\n' "$*"; }
stop() { printf '\nSTOPPED: %s\n' "$*"; exit 1; }

if [ "${1:-}" = "--https" ]; then
  say "Certificate for $DOMAIN and www.$DOMAIN (certbot edits only the $DOMAIN site)"
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --redirect --non-interactive --agree-tos --keep-until-expiring
  nginx -t && systemctl reload nginx
  sleep 2
  curl -s -o /dev/null -w "https://$DOMAIN/ -> %{http_code}\n" "https://$DOMAIN/"
  curl -s -o /dev/null -w "https://$DOMAIN/app -> %{http_code}\n" "https://$DOMAIN/app"
  exit 0
fi

say "1/4 Checks (read-only)"
command -v docker >/dev/null || stop "Docker is not installed."
command -v nginx >/dev/null || stop "nginx is not installed."
if ss -Hltn "( sport = :$PORT )" | grep -q . && ! docker ps --format '{{.Names}}' | grep -qx cerebr-web; then
  stop "Port $PORT is used by something else."
fi
OTHER=$(grep -RlE "server_name[^;]*\b(www\.)?$DOMAIN\b" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | grep -v "/$DOMAIN\$" || true)
[ -z "$OTHER" ] || stop "Another nginx site already serves $DOMAIN: $OTHER"
nginx -t 2>&1 | tail -1

say "2/4 Building and starting the cerebr-web container (127.0.0.1:$PORT)"
cd "$HERE"
nice -n 10 docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d
for i in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/healthz" && break; sleep 1; done
curl -s -o /dev/null -w "container /app -> %{http_code}\n" "http://127.0.0.1:$PORT/app"

say "3/4 nginx site for $DOMAIN"
if [ ! -e "$SITE" ]; then
  cp deploy/nginx-host.conf "$SITE"
  ln -sf "$SITE" "$LINK"
  if ! nginx -t; then rm -f "$LINK" "$SITE"; stop "nginx -t failed; the new site was removed, nothing reloaded."; fi
  systemctl reload nginx
else
  echo "$SITE already exists (kept as is; certbot may have added HTTPS to it)."
fi

say "4/4 Check"
curl -s -o /dev/null -H "Host: $DOMAIN" -w "http://$DOMAIN/ via nginx -> %{http_code}\n" http://127.0.0.1/
docker ps --format '  {{.Names}}\t{{.Status}}' | head -20
printf '\nDone. Next, HTTPS: bash %s/deploy/install.sh --https\n' "$HERE"
