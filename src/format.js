// Formats the get_messages result. Small results go back inline. Large results
// (a big multi-month pull) are written to a JSON file, and we return an explicit
// instruction with the path so the agent knows to open and SEARCH that file
// instead of treating it as missing or "too large".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIG_RESULT_CHARS = 60000;

export function formatMessagesResult(jsonText) {
  if (!jsonText || jsonText.length <= BIG_RESULT_CHARS) {
    return { content: [{ type: 'text', text: jsonText }] };
  }

  let chats = 0;
  let messages = 0;
  try {
    const arr = JSON.parse(jsonText);
    chats = arr.length;
    messages = arr.reduce((n, c) => n + (c.messages?.length || 0), 0);
  } catch {
    /* keep going even if the count parse fails */
  }

  try {
    const dir = path.join(os.tmpdir(), 'whatsapp-digest-exports');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(
      dir,
      `messages-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
    );
    fs.writeFileSync(file, jsonText);

    const text =
      `This result is large (${messages} messages across ${chats} chats), so the full data was written to a file instead of being inlined here:\n\n` +
      `${file}\n\n` +
      `IMPORTANT: To answer the user, OPEN AND SEARCH THIS FILE. It is JSON: an array of ` +
      `{ "chat", "isGroup", "unread", "messages": [ { "from", "body", "time" } ] }. ` +
      `Read it (or grep it) for the people, topics, or keywords the user asked about, then answer from what you find there. ` +
      `Do NOT tell the user the data is too large or unavailable — it is all in that file.`;

    return { content: [{ type: 'text', text }] };
  } catch {
    // If the file write fails for any reason, fall back to returning inline.
    return { content: [{ type: 'text', text: jsonText }] };
  }
}
