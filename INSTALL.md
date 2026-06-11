# Install

These steps install WhatsApp Digest on your machine and wire it into Claude Desktop. An AI agent (Claude Code, Cursor, or Claude Desktop in agent mode) can follow them for you, or you can run them yourself. If you are an agent, ask before running each command and stop if anything fails.

## Requirements
- Node.js 18 or newer, and git. If they are missing, install them first (nodejs.org and git-scm.com).
- An MCP client that runs local servers. Claude Desktop is the easiest.

## Steps
1. Clone and enter the repo:
   ```
   git clone https://github.com/LevNyyon/whatsapp-digest-local
   cd whatsapp-digest-local
   ```
2. Install dependencies. This downloads a Chromium, about 150MB, one time:
   ```
   npm install
   ```
3. Wire it into Claude Desktop:
   ```
   node scripts/apply-to-claude-desktop.mjs
   ```
   Using a different MCP client? Point it at `node <full path>/src/index.js` instead.
4. Fully quit and reopen Claude Desktop.
5. In a new chat, say: **link my whatsapp**. A page opens with a QR code. Scan it from your phone: WhatsApp, Settings, Linked Devices, Link a Device.
6. Then ask for a digest, or search your history.

## Important
This automates WhatsApp Web, which is unofficial and against WhatsApp's terms, so use a number you are comfortable risking. It is read only and runs entirely on your machine.
