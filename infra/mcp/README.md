# MCP servers

Project-scoped MCP servers for Claude Code, registered in the root `.mcp.json`.

## tradingview (indicator search)

[daviddme/tradingview-indicator-search-mcp-server](https://github.com/daviddme/tradingview-indicator-search-mcp-server), MIT.
Searches TradingView's public indicator and strategy library and fetches the Pine Script
source of open-source scripts. No account or API key. Local stdio process only.

`tradingview-search.sh` clones the upstream repo at a pinned, reviewed commit into
`~/.cache/arf-os/` on first run (override with `TVMCP_HOME`), installs production
dependencies, and starts the server. Requires Node 22.5+ and git.

Tools: `search_scripts`, `list_editors_picks`, `list_author_scripts`, `get_script_source`,
`harvest_scripts`, `query_corpus`, `fetch_status`.

Notes:

- It needs outbound access to `www.tradingview.com` and `pine-facade.tradingview.com`.
  Upstream recommends running it on a residential connection; datacenter IPs are blocked
  more aggressively.
- Fetched Pine source and descriptions are third-party, untrusted content (CLAUDE.md 11.5)
  and remain their authors' copyright. Treat them as research inputs, not approved code.
- To upgrade, review the upstream diff and bump `TVMCP_REF`.
