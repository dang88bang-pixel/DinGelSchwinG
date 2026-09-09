#!/usr/bin/env node
/**
 * Tool-Katalog des installierten MCP-Servers ausgeben – ohne laufenden
 * Bridge-Server (startet den stdio-Prozess selbst, listet, beendet sich).
 * Nützlich für: npm run mcp:list · CI-Smoke-Test · Doku-Abgleich.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const pkg = '@cristianoaredes/mcp-mobile-server';

function resolveBin() {
  const explicit = process.env.MCP_SERVER_BIN;
  if (explicit && existsSync(explicit)) return explicit;
  try {
    const meta = require(`${pkg}/package.json`);
    const rel = typeof meta.bin === 'string' ? meta.bin : meta.bin?.['mcp-mobile-server'];
    const abs = path.join(root, 'node_modules', pkg, rel ?? 'dist/server.js');
    if (existsSync(abs)) return abs;
  } catch {
    /* nicht installiert */
  }
  const fallback = path.join(root, 'node_modules', pkg, 'dist/server.js');
  return existsSync(fallback) ? fallback : null;
}

const bin = resolveBin();
if (!bin) {
  console.error(`❌ ${pkg} nicht gefunden.\n   Installieren:  npm install ${pkg}`);
  process.exit(2);
}

const proc = spawn(process.execPath, [bin], { stdio: ['pipe', 'pipe', 'ignore'] });
let buf = '';
const wait = (id, ms = 12_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout nach ${ms} ms (id=${id})`)), ms);
    const onData = (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === id) {
          clearTimeout(timer);
          proc.stdout.off('data', onData);
          resolve(msg.result);
          return;
        }
      }
    };
    proc.stdout.on('data', onData);
  });

const send = (obj) => proc.stdin.write(`${JSON.stringify(obj)}\n`);
try {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dingelschwing-mcp-list', version: '1.0.0' } } });
  const info = await wait(1, 15_000);
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const listed = await wait(2);
  const tools = listed?.tools ?? [];
  console.log(`\n🔌 ${info?.serverInfo?.name ?? pkg} v${info?.serverInfo?.version ?? '?'} · Protokoll ${info?.protocolVersion ?? '—'} · ${tools.length} Tools\n`);
  for (const t of tools) {
    const req = t.inputSchema?.required ?? [];
    console.log(`  ${t.name.padEnd(30)} ${req.length ? `pflicht: ${req.join(',')}  ` : ''}${(t.description ?? '').slice(0, 78)}`);
  }
  console.log(`\nBinary: ${bin}`);
  process.exitCode = tools.length ? 0 : 1;
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exitCode = 1;
} finally {
  proc.kill('SIGTERM');
}
