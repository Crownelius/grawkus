#!/bin/bash
set -euo pipefail

if command -v grawkus >/dev/null 2>&1; then
    echo "grawkus already available on PATH"
    exit 0
fi

if command -v grawkus >/dev/null 2>&1; then
    echo "legacy cawdex alias already available on PATH"
    exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is required to install Grawkus for Exgentic." >&2
    exit 1
fi

INSTALL_SPEC="${GRAWKUS_INSTALL_SPEC:-grawkus@latest}"
npm install -g "$INSTALL_SPEC"
echo "Grawkus Exgentic setup complete: $INSTALL_SPEC"
