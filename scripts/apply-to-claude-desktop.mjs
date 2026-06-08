// Registers whatsapp-digest with Claude Desktop via the classic
// `mcpServers` key in claude_desktop_config.json. Merges — never clobbers.
// Run with Claude Desktop CLOSED for the most reliable result:
//   node scripts/apply-to-claude-desktop.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'src', 'index.js');
const cfgPath = path.join(
  process.env.HOME,
  'Library',
  'Application Support',
  'Claude',
  'claude_desktop_config.json'
);

let cfg = {};
if (fs.existsSync(cfgPath)) {
  const raw = fs.readFileSync(cfgPath, 'utf8');
  const bak = cfgPath + '.bak';
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw); // preserve pristine original
  cfg = JSON.parse(raw);
}

cfg.mcpServers = cfg.mcpServers || {};
// Absolute node path: macOS GUI apps don't inherit the shell PATH,
// so a bare "node" command often fails to launch.
cfg.mcpServers['whatsapp-digest'] = { command: process.execPath, args: [entry] };

fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

console.log('Installed whatsapp-digest into Claude Desktop.');
console.log('  config :', cfgPath);
console.log('  entry  :', entry);
console.log('  servers:', Object.keys(cfg.mcpServers).join(', '));
console.log('Restart Claude Desktop, then say: "link my whatsapp".');
