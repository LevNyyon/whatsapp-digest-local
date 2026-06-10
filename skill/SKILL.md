---
name: whatsapp-digest
description: Use when the user asks for a WhatsApp digest, a morning brief, "what did I miss on WhatsApp", "what needs a reply", or to summarize recent WhatsApp activity. Pulls recent messages with the whatsapp-digest MCP tools (get_messages, list_chats) and produces a short, prioritized brief.
---

# WhatsApp Digest

Turn recent WhatsApp activity into a short, prioritized brief the user can act on in under a minute.

## First, check the connection

Call `whatsapp_status`. If `state` is not `"ready"`:

- Call `link_whatsapp`.
- Tell the user a page opened in their browser with a QR code, and to scan it from their phone: **WhatsApp → Settings → Linked Devices → Link a Device**.
- Wait for them to say it's linked (or re-check `whatsapp_status`), then continue.

## Build the digest

1. Call `get_messages` (default last 24 hours). Optionally call `list_chats` to see unread counts.
2. Sort into three buckets:
   - **Needs a reply**, direct questions or asks pointed at the user that are still open.
   - **Time-sensitive**, anything with a date, deadline, payment, or "today/tomorrow".
   - **FYI**, useful context, no action needed.
3. One line per item: who it's from, the gist, and the action (if any). Quote sparingly.
4. Put unread and most-active chats first. Skip noise, stickers, "ok", group spam.
5. End with **Top 3 to handle today**.

## Style

Tight and skimmable. No preamble, no "here is your digest" throat-clearing. If nothing important happened, say so in one line.

## Naming

The user may give this assistant its own name (e.g. "call yourself Scout"). If they do, use that name when it greets them with the digest.

## Boundaries

This is **read-only**. There is no tool to send messages. If the user asks to reply or send, explain that this tool only reads, by design, to stay safe with WhatsApp.
