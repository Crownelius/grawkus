#!/bin/bash
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." 2>/dev/null && pwd || true)"

if command -v grawkus >/dev/null 2>&1; then
  grawkus --print-terminal-bench-adapter >/dev/null
  exit 0
fi
if command -v grawkus >/dev/null 2>&1; then
  grawkus --print-terminal-bench-adapter >/dev/null
  exit 0
fi

ensure_node_npm() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    apt-get update
    apt-get install -y ca-certificates curl
  fi

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm use 22
}

install_from_bundle_root() {
  root="$1"
  if [ -z "$root" ] || [ ! -d "$root/dist" ]; then
    return 1
  fi
  entry="$root/bin/grawkus.js"
  if [ ! -f "$entry" ]; then
    entry="$root/bin/grawkus.js"
  fi
  if [ ! -f "$entry" ]; then
    return 1
  fi
  if [ -d "$root/node_modules" ] && command -v node >/dev/null 2>&1; then
    mkdir -p /usr/local/bin
    cat > /usr/local/bin/grawkus <<EOF
#!/bin/sh
exec node "$entry" "\$@"
EOF
    chmod +x /usr/local/bin/grawkus
    cat > /usr/local/bin/grawkus <<EOF
#!/bin/sh
exec grawkus "\$@"
EOF
    chmod +x /usr/local/bin/grawkus
    return 0
  fi
  if command -v npm >/dev/null 2>&1 && [ -f "$root/package.json" ]; then
    npm install -g "$root" --no-audit --no-fund
    return 0
  fi
  return 1
}

install_from_tarball() {
  tarball="$1"
  if [ -z "$tarball" ] || [ ! -f "$tarball" ]; then
    return 1
  fi
  npm install -g "$tarball" --no-audit --no-fund
  return 0
}

try_offline_install() {
  if command -v node >/dev/null 2>&1; then
    if install_from_bundle_root "${GRAWKUS_BUNDLE_ROOT:-}"; then
      return 0
    fi
    if install_from_bundle_root "$PACKAGE_ROOT"; then
      return 0
    fi
  fi

  ensure_node_npm

  if install_from_tarball "${GRAWKUS_BUNDLE_TARBALL:-}"; then
    return 0
  fi
  if install_from_bundle_root "${GRAWKUS_BUNDLE_ROOT:-}"; then
    return 0
  fi
  if install_from_bundle_root "$PACKAGE_ROOT"; then
    return 0
  fi
  for candidate in "$SCRIPT_DIR"/grawkus*.tgz "$PACKAGE_ROOT"/grawkus*.tgz "$SCRIPT_DIR"/grawkus*.tgz "$PACKAGE_ROOT"/grawkus*.tgz; do
    if install_from_tarball "$candidate"; then
      return 0
    fi
  done
  return 1
}

if try_offline_install; then
  grawkus --print-terminal-bench-adapter >/dev/null
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl
fi

ensure_node_npm

npm install -g "${GRAWKUS_INSTALL_SPEC:-grawkus@latest}" --no-audit --no-fund

grawkus --print-terminal-bench-adapter >/dev/null
