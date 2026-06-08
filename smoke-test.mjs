// Smoke test: spawn the MCP server and verify it exposes its tools + prompt.
// Does not touch WhatsApp (the client loads lazily on first link/use).
// Run from anywhere:  node smoke-test.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, 'src', 'index.js');

const transport = new StdioClientTransport({ command: 'node', args: [serverPath] });
const client = new Client({ name: 'smoke', version: '0.0.0' });

await client.connect(transport);
const tools = (await client.listTools()).tools.map((t) => t.name);
const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
console.log('TOOLS:', tools.join(', '));
console.log('PROMPTS:', prompts.join(', '));

const res = await client.callTool({ name: 'whatsapp_status', arguments: {} });
console.log('STATUS_RESULT:', res.content[0].text.replace(/\s+/g, ' '));

await client.close();
console.log('SMOKE_OK');
process.exit(0);
