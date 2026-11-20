#!/bin/bash
# Install the web-only account gate and point the public web location at it.
# Prefer /StarseaFolio/ (current), fall back to legacy /worldseed/.
# The shared backend on 127.0.0.1:8787 stays in place; this process checks the account first.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -n bash "$0" "$@"
fi

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST=/data/disk/starseafolio/account-gate
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "node is not installed" >&2
  exit 1
fi
if [ ! -f /etc/worldseed/worldseed.env ]; then
  echo "missing /etc/worldseed/worldseed.env" >&2
  exit 1
fi

GROUP_NAME="$(id -gn liuqi)"
install -d -o liuqi -g "$GROUP_NAME" -m 755 "$DEST"
install -o liuqi -g "$GROUP_NAME" -m 644 \
  "$SRC/account-gate.mjs" "$SRC/account-store.mjs" "$SRC/captcha.mjs" "$DEST/"
mkdir -p /var/lib/worldseed/data
chown liuqi:"$GROUP_NAME" /var/lib/worldseed/data
chmod 700 /var/lib/worldseed/data

cat > /etc/systemd/system/starseafolio-account-gate.service <<EOF
[Unit]
Description=StarseaFolio web account gate
After=network.target

[Service]
User=liuqi
Group=$GROUP_NAME
WorkingDirectory=$DEST
EnvironmentFile=/etc/worldseed/worldseed.env
Environment=ACCOUNT_GATE_PORT=8791
Environment=ACCOUNT_GATE_UPSTREAM=http://127.0.0.1:8787
Environment=ACCOUNT_GATE_FILE=/var/lib/worldseed/data/web-accounts.json
Environment=ACCOUNT_GATE_BOOKS_ROOT=/var/lib/worldseed/books
ExecStart=$NODE_BIN $DEST/account-gate.mjs
Restart=on-failure
RestartSec=2
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable starseafolio-account-gate
systemctl restart starseafolio-account-gate

healthy=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8791/auth/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 0.3
done
if [ "$healthy" -ne 1 ]; then
  echo "account gate did not become healthy" >&2
  journalctl -u starseafolio-account-gate -n 40 --no-pager >&2 || true
  exit 1
fi

nginx_state="$(python3 - <<'PY'
from pathlib import Path

candidates = [
    Path("/etc/nginx/sites-available/starseafolio"),
    Path("/etc/nginx/sites-available/worldseed"),
]
markers = ["location /StarseaFolio/", "location /worldseed/"]
path = next((item for item in candidates if item.exists()), None)
if path is None:
    raise SystemExit("missing nginx site config (starseafolio/worldseed)")
text = path.read_text()
marker = next((item for item in markers if item in text), None)
if marker is None:
    raise SystemExit("missing location /StarseaFolio/ or /worldseed/")
start = text.find(marker)
start = text.rfind("\n", 0, start) + 1
brace = text.find("{", start)
if brace < 0:
    raise SystemExit(f"{marker} has no brace")
depth = 0
end = None
for index, char in enumerate(text[brace:], brace):
    if char == "{":
        depth += 1
    elif char == "}":
        depth -= 1
        if depth == 0:
            end = index + 1
            break
if end is None:
    raise SystemExit(f"{marker} is not closed")
block = text[start:end]
updated = block.replace("127.0.0.1:8787", "127.0.0.1:8791")
if "X-Real-Ip" not in updated and "proxy_pass" in updated:
    updated = updated.replace(
        "proxy_pass",
        "proxy_set_header X-Real-Ip $remote_addr;\n        proxy_pass",
        1,
    )
new_text = text[:start] + updated + text[end:]
backup = Path(str(path) + ".bak-account-gate")
if new_text == text:
    print(f"UNCHANGED\t{path}\t{marker}")
else:
    if not backup.exists():
        backup.write_text(text)
    path.write_text(new_text)
    print(f"CHANGED\t{path}\t{marker}")
PY
)"
nginx_state="${nginx_state//$'\r'/}"
nginx_action="${nginx_state%%$'\t'*}"
nginx_rest="${nginx_state#*$'\t'}"
nginx_path="${nginx_rest%%$'\t'*}"
nginx_marker="${nginx_rest#*$'\t'}"

if [ "$nginx_action" = "CHANGED" ]; then
  if ! nginx -t; then
    if [ -f "${nginx_path}.bak-account-gate" ]; then
      cp "${nginx_path}.bak-account-gate" "$nginx_path"
    fi
    exit 1
  fi
  systemctl reload nginx
fi

public_path="/StarseaFolio"
if [[ "$nginx_marker" == *"location /worldseed/"* ]]; then
  public_path="/worldseed"
fi
public_ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -H "Host: 111.229.32.85" "http://127.0.0.1${public_path}/auth/captcha" >/dev/null; then
    public_ok=1
    break
  fi
  sleep 0.3
done
if [ "$public_ok" -ne 1 ]; then
  echo "public captcha check failed for ${public_path}" >&2
  exit 1
fi
echo "account gate installed (${nginx_state})"
