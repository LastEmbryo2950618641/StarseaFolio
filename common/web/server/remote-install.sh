#!/bin/bash
# Install the web-only account gate and point the public API location at it.
# API lives at location /worldseed/ (often inside an nginx snippet include).
# /StarseaFolio/ is the static SPA root and must not be rewritten to the gate.
# The shared backend on 127.0.0.1:8787 stays in place; this process checks the account first.
set -euo pipefail

PUBLIC_HOST="${PUBLIC_HOST:-nikoniko.cn}"

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
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -fsS "http://127.0.0.1:8791/auth/health" >/dev/null; then
    healthy=1
    break
  fi
  sleep 0.5
done
if [ "$healthy" -ne 1 ]; then
  echo "account gate did not become healthy on 127.0.0.1:8791" >&2
  journalctl -u starseafolio-account-gate -n 40 --no-pager >&2 || true
  exit 1
fi

nginx_state="$(PUBLIC_HOST="$PUBLIC_HOST" python3 - <<'PY'
from pathlib import Path
import os

public_host = os.environ.get("PUBLIC_HOST", "nikoniko.cn").strip() or "nikoniko.cn"
candidates: list[Path] = []
for root in (
    Path("/etc/nginx/snippets"),
    Path("/etc/nginx/sites-enabled"),
    Path("/etc/nginx/sites-available"),
    Path("/etc/nginx/conf.d"),
):
    if root.is_dir():
        candidates.extend(sorted(root.glob("*.conf")))
        candidates.extend(sorted(p for p in root.iterdir() if p.is_file() and p.suffix == ""))

# Prefer the API location. Never rewrite the static SPA location /StarseaFolio/.
markers = ["location /worldseed/"]
seen: set[Path] = set()
path = None
text = ""
marker = None
# Prefer files that already mention the public domain or the API location.
ranked = sorted(
    candidates,
    key=lambda item: (
        0 if "nikoniko" in item.name.lower() or "niko-home" in item.name.lower() else 1,
        0 if item.parent.name == "snippets" else 1,
        str(item),
    ),
)
for candidate in ranked:
    if candidate in seen or not candidate.is_file():
        continue
    seen.add(candidate)
    try:
        content = candidate.read_text()
    except OSError:
        continue
    found = next((item for item in markers if item in content), None)
    if found is None:
        continue
    path = candidate
    text = content
    marker = found
    break

if path is None or marker is None:
    print("SKIP\t\t")
    raise SystemExit(0)

start = text.find(marker)
start = text.rfind("\n", 0, start) + 1
brace = text.find("{", start)
if brace < 0:
    print(f"SKIP\t{path}\t{marker}")
    raise SystemExit(0)
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
    print(f"SKIP\t{path}\t{marker}")
    raise SystemExit(0)

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

# Domain origin bridge usually lives in the site file, not the snippet.
for site in (
    Path("/etc/nginx/sites-available/worldseed"),
    Path("/etc/nginx/sites-enabled/worldseed"),
    Path("/etc/nginx/sites-available/starseafolio"),
):
    if not site.is_file() or "niko_library_origin" not in site.read_text():
        continue
    site_text = site.read_text()
    https_line = f'    "https|https://{public_host}" "https://{public_host}";\n'
    http_line = f'    "http|http://{public_host}" "http://{public_host}";\n'
    if https_line.strip() in site_text and http_line.strip() in site_text:
        break
    needle = 'map "$scheme|$http_origin" $niko_library_origin {'
    idx = site_text.find(needle)
    if idx < 0:
        continue
    insert_at = site_text.find("\n", idx) + 1
    extra = "".join(line for line in (https_line, http_line) if line.strip() not in site_text)
    site_backup = Path(str(site) + ".bak-domain-origin")
    if not site_backup.exists():
        site_backup.write_text(site_text)
    site.write_text(site_text[:insert_at] + extra + site_text[insert_at:])
    print(f"ORIGIN\t{site}\t{public_host}", file=__import__("sys").stderr)
    break
PY
)" || true
nginx_state="${nginx_state//$'\r'/}"
nginx_action="${nginx_state%%$'\t'*}"
nginx_rest="${nginx_state#*$'\t'}"
nginx_path="${nginx_rest%%$'\t'*}"
nginx_marker="${nginx_rest#*$'\t'}"

if [ "$nginx_action" = "CHANGED" ]; then
  if ! nginx -t; then
    if [ -n "$nginx_path" ] && [ -f "${nginx_path}.bak-account-gate" ]; then
      cp "${nginx_path}.bak-account-gate" "$nginx_path"
    fi
    echo "nginx -t failed; left account gate running without nginx rewrite" >&2
  else
    systemctl reload nginx
  fi
elif [ "$nginx_action" = "SKIP" ]; then
  echo "nginx location /worldseed/ not found; account gate installed without nginx rewrite" >&2
fi

if [ "$nginx_action" = "CHANGED" ] || [ "$nginx_action" = "UNCHANGED" ]; then
  public_ok=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -H "Host: ${PUBLIC_HOST}" "http://127.0.0.1/worldseed/auth/captcha" >/dev/null; then
      public_ok=1
      break
    fi
    sleep 0.3
  done
  if [ "$public_ok" -ne 1 ]; then
    echo "public captcha check failed for https://${PUBLIC_HOST}/worldseed/; account gate is still installed" >&2
  fi
fi
echo "account gate installed (${nginx_state:-SKIP}; host=${PUBLIC_HOST})"
