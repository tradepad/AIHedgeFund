#!/usr/bin/env bash
# Launches the TradingView indicator search MCP server (stdio).
# Upstream: https://github.com/daviddme/tradingview-indicator-search-mcp-server
# Pinned to a reviewed commit; bump TVMCP_REF deliberately after reviewing the diff.
# stdout is the MCP channel, so every setup step writes to stderr only.
set -euo pipefail

TVMCP_REPO="https://github.com/daviddme/tradingview-indicator-search-mcp-server.git"
TVMCP_REF="1f86489"
DIR="${TVMCP_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/arf-os/tradingview-indicator-search-mcp-server}"

if [ ! -f "$DIR/.arf-installed-$TVMCP_REF" ]; then
  {
    rm -rf "$DIR"
    mkdir -p "$(dirname "$DIR")"
    git clone --quiet "$TVMCP_REPO" "$DIR"
    git -C "$DIR" -c advice.detachedHead=false checkout --quiet "$TVMCP_REF"
    (cd "$DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
    touch "$DIR/.arf-installed-$TVMCP_REF"
  } 1>&2
fi

exec node "$DIR/src/server.js"
