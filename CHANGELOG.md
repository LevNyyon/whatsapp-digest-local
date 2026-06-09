# Changelog

All notable changes to WhatsApp Digest are documented here.

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
