# Changelog

All notable changes to WhatsApp Digest are documented here.

## [0.2.0] - 2026-06-09

### Added
- `search_messages` tool: search your WhatsApp account for a topic or keywords and get back only the messages that match (who said it, when, and which chat). Lets you ask your WhatsApp history questions in natural language. It reports how many chats it covered, so a partial search is clear and you can narrow.

### Changed
- Lookback window raised from 1 week to about 6 months. `get_messages` reads deeper for longer windows, and deepest when you target a single chat by name. The daily digest default stays 24 hours.
- Large results are written to a JSON file and the response gives the path with an instruction to open and search it, so big multi-month pulls do not get truncated or lost.

## [0.1.2] - 2026-06-09

### Security
- The local helper now validates the `Host` header and rejects cross-site requests. This closes a DNS rebinding vector (a malicious web page could otherwise reach the local daemon through your browser and read messages or the link QR) and CSRF against the control endpoints. The helper only answers requests that genuinely originate from your own machine. Thanks to the community member who flagged it.

## [0.1.1] - 2026-06-09

### Fixed
- New-day and after-sleep reliability. The first chat fetch after the session has been idle could time out before WhatsApp Web finished re-syncing, which made the helper look stuck. It now waits long enough for that first slow query.
- No more spurious reset or QR loop. On a routine digest, the assistant no longer reaches for `reset_whatsapp` or a QR re-scan when the session is actually fine. A saved-login marker plus clearer tool guidance make it wait and retry instead.
- A live connection is never torn down on a guess. Reconnects happen only in response to a real disconnect.

## [0.1.0] - 2026-06-08

### Added
- Initial release. A local, read-only WhatsApp digest, exposed as an MCP server.
- Tools: `whatsapp_status`, `link_whatsapp`, `list_chats`, `get_messages`, `reset_whatsapp`, plus a `whatsapp_digest` prompt.
- One shared background helper on a fixed port that survives app restarts, so you link once.
- Self-cleans stale browser locks and auto-reconnects on disconnect.
- Pinned WhatsApp Web version for reliable linking, and parallel message fetch for speed.
- Works with any local MCP client (Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Cline, Zed).
