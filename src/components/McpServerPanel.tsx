import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../lib/endpoint';
import { Plug, Play, Terminal, RefreshCw, Copy, Server, Usb } from 'lucide-react';
import { PanelShell, PanelSection, Pill, Mono, StatTile } from './panels/ui';
import {
  mcpHealth, mcpTools, mcpCall, mcpRefresh, gatewayStatus, toolResultText, fillRequired,
  McpTool, GatewayStatus,
} from '../lib/mcpClient';

/**
 * MCP-Panel: zeigt den angeschlossenen MCP-Server (GitHub-Projekt
 * `cristianoaredes/mcp-mobile-server`, installiert als npm-Paket `@cristianoaredes/mcp-mobile-server`),
 * alle Tools mit Schema, einen Test-Runner und das Gateway-Werkzeugset.
 */
const GATEWAY_TOOLS: { name: string; description: string; action?: string; args?: string[] }[] = [
  { name: 'gateway_status', description: 'Status, Zähler und letzte Sessions des mobilen BLE-Gateways', action: 'status' },
  { name: 'gateway_tokens', description: 'Token-Whitelist (CT45P) inkl. Sperr-/Revoke-Status', action: 'tokens' },
  { name: 'gateway_sessions', description: 'Letzte Lesevorgänge mit Begründung und Dauer', action: 'sessions' },
  { name: 'gateway_ble_scan', description: 'BLE-Umfeld scannen (bluetoothctl oder mock)', action: 'ble_scan' },
  { name: 'gateway_demo_handshake', description: 'Kompletter AES-128-Handshake gegen den Simulator', action: 'demo_handshake' },
  { name: 'gateway_selftest', description: 'End-to-End-Selbsttest des Gateways (9 Prüfungen)', action: 'selftest' },
];

export default function McpServerPanel({ onClose }: { onClose: () => void }) {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof mcpHealth>> | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [gw, setGw] = useState<GatewayStatus | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [args, setArgs] = useState('{}');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [h, t, g] = await Promise.all([mcpHealth(), mcpTools(), gatewayStatus()]);
      setHealth(h);
      setTools(t.tools);
      setGw(g);
      if (!t.ok && t.error) setNote(`⚠️ ${t.error}${t.detail ? ` – ${t.detail}` : ''}\n${t.hint ?? ''}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = tools.filter((t) => (t.name === 'health_check' ? true : !t.name.startsWith('ios_')));
    if (!q) return list;
    return list.filter((t) => `${t.name} ${t.description ?? ''}`.toLowerCase().includes(q));
  }, [tools, filter]);

  const runTool = useCallback(
    async (name: string, parsedArgs: Record<string, unknown>) => {
      setBusy(true);
      setNote('');
      try {
        const res = await mcpCall(name, parsedArgs, { timeoutMs: 120_000 });
        setOutput(`${res.ok ? '✅' : '⚠️'} ${name}  ${res.ms ? `(${res.ms} ms)` : ''}${res.cached ? ' [cache]' : ''}\n\n${toolResultText(res.result) || res.error || 'leere Antwort'}`);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const callSelected = useCallback(async () => {
    if (!selected) return;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = args.trim() ? (JSON.parse(args) as Record<string, unknown>) : {};
    } catch (e) {
      setNote(`❌ Argumente sind kein JSON: ${String((e as Error)?.message ?? e)}`);
      return;
    }
    const tool = tools.find((t) => t.name === selected);
    const check = fillRequired(tool, parsed as Record<string, string | number | boolean>);
    if (!check.ok) {
      setNote(`❌ Pflichtfelder fehlen: ${check.missing.join(', ')} — Schema: ${JSON.stringify(tool?.inputSchema?.properties ?? {})}`);
      return;
    }
    await runTool(selected, check.args);
  }, [selected, args, tools, runTool]);

  const runGateway = useCallback(async (action: string) => {
    setBusy(true);
    setNote('');
    try {
      if (action === 'status') return setOutput(JSON.stringify(await gatewayStatus(), null, 2));
      if (action === 'tokens') return setOutput(JSON.stringify(await (await fetch(apiUrl('/gateway/tokens'))).json(), null, 2));
      if (action === 'sessions') return setOutput(JSON.stringify(await (await fetch(apiUrl('/gateway/sessions?limit=25'))).json(), null, 2));
      const res = await fetch(apiUrl('/gateway/command'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      return setOutput(JSON.stringify(await res.json(), null, 2));
    } catch (e) {
      return setOutput(`❌ ${String((e as Error)?.message ?? e)}\n\nTipp:  python3 mobile-server/mobile_ble_server.py --mock   (Start)   ·   curl -s localhost:8791/status`);
    } finally {
      setBusy(false);
    }
  }, []);

  const configJson = `{
  "mcpServers": {
    "mobile-dev": {
      "command": "node",
      "args": ["node_modules/@cristianoaredes/mcp-mobile-server/dist/server.js"],
      "env": { "NODE_ENV": "production" }
    },
    "dingelschwing-mobile-server": { "type": "http", "url": "http://127.0.0.1:8790/mcp/http" }
  }
}`;

  const connected = Boolean(health?.mcp?.connected);

  return (
    <PanelShell
      emoji="🔌"
      title="MCP & Plugins"
      subtitle={`${tools.length} Tools · ${connected ? 'stdio verbunden' : 'Bridge getrennt'} · Gateway ${gw?.ok ? '✓' : '✗'}`}
      onClose={onClose}
      onRefresh={async () => {
        await mcpRefresh();
        await refresh();
      }}
      busy={busy}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatTile label="MCP-Server" value={health?.mcp?.serverInfo?.name ?? '—'} tone={connected ? 'text-emerald-200' : 'text-rose-200'} hint={health?.mcp?.serverInfo?.version ? `v${health.mcp.serverInfo.version}` : 'npm: @cristianoaredes/mcp-mobile-server'} />
          <StatTile label="Transport" value="stdio · JSON-RPC" hint={health?.mcp?.protocolVersion ?? '—'} />
          <StatTile label="Tools" value={tools.length} tone="text-cyan-200" hint={`${visible.length} sichtbar`} />
          <StatTile label="Bridge" value={health?.ok ? `:${health.port ?? 8790}` : 'offline'} tone={health?.ok ? 'text-emerald-200' : 'text-amber-200'} hint={health?.uptime_s ? `uptime ${Math.round(health.uptime_s)} s` : 'npm run mcp:bridge'} />
        </div>

        {!connected && (
          <div className="rounded-xl bg-[#020617] border border-amber-700/30 p-3.5">
            <div className="text-[11px] font-black text-amber-200 mb-1.5">Startbefehle</div>
            <pre className="text-[10.5px] font-mono text-slate-200 overflow-x-auto leading-relaxed">{`# 1) MCP-Server direkt prüfen (31 Tools, stdio)
npm run mcp:list

# 2) Bridge + App-Anbindung (Port 8790, im Vite-Dev-Server unter /mcp/*)
npm run mcp:bridge

# 3) Mobiles BLE-Gateway (Port 8791, erreichbar über /gateway/*)
npm run mcp:gateway     # = python3 mobile-server/mobile_ble_server.py --mock`}</pre>
            <p className="text-[10.5px] text-slate-500 mt-2">
              Das Paket liegt bereits als Abhängigkeit in <Mono>package.json</Mono> (GitHub: <Mono>cristianoaredes/mcp-mobile-server</Mono>).
              Android-/Flutter-/Xcode-Tools brauchen die jeweiligen SDKs auf dem Host – ohne sie liefert <Mono>health_check</Mono> eine saubere Diagnose.
            </p>
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          <PanelSection
            title="Tool-Verzeichnis"
            right={
              <div className="flex items-center gap-2">
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filtern…" className="bg-[#020617] border border-white/10 rounded-lg px-2 py-1 text-[10.5px] font-mono text-slate-200 w-32 outline-none focus:border-cyan-400/50" />
              </div>
            }
          >
            {visible.length === 0 ? (
              <p className="text-[11px] text-slate-500">Keine Tools geladen — Bridge läuft (noch) nicht.</p>
            ) : (
              <div className="max-h-[340px] overflow-y-auto pr-1 space-y-1">
                {visible.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => {
                      setSelected(t.name === selected ? null : t.name);
                      const sample: Record<string, string | number | boolean> = {};
                      for (const [k, spec] of Object.entries(t.inputSchema?.properties ?? {})) {
                        if (spec.default !== undefined) sample[k] = spec.default as string | number | boolean;
                        else if (spec.type === 'boolean') sample[k] = true;
                      }
                      setArgs(Object.keys(sample).length ? JSON.stringify(sample, null, 2) : '{}');
                    }}
                    className={`w-full text-left rounded-lg px-2.5 py-1.5 border transition ${selected === t.name ? 'bg-cyan-950/60 border-cyan-500/40' : 'bg-[#050a18] border-white/8 hover:border-white/20'}`}
                  >
                    <div className="flex items-center gap-2">
                      <Mono className="!text-[11px] font-bold">{t.name}</Mono>
                      {t.inputSchema?.required?.length ? <Pill tone="warn">{t.inputSchema.required.length} Pflicht</Pill> : <Pill tone="ok">optional</Pill>}
                    </div>
                    {t.description && <div>{t.description}</div>}
                  </button>
                ))}
              </div>
            )}
          </PanelSection>

          <PanelSection title="Test-Runner" right={<Pill tone={selected ? 'info' : 'slate'}>{selected ?? 'nichts gewählt'}</Pill>}>
            <label className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Argumente (JSON)</label>
            <textarea
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              rows={5}
              spellCheck={false}
              className="w-full mt-1 bg-[#020617] border border-white/10 rounded-lg p-2 text-[11px] font-mono text-cyan-100 outline-none focus:border-cyan-400/50"
            />
            <button
              type="button"
              onClick={() => void callSelected()}
              disabled={!selected || busy}
              className="w-full mt-2 text-[11px] font-extrabold px-3 py-2 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 text-white hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" /> Tool aufrufen
            </button>
            <p className="text-[10px] text-slate-500 mt-1.5">
              Kurzhinweis: Im Chat genügt <Mono>mcp tool=android_list_devices</Mono> – Argumente werden aus dem Satz gelesen
              (<Mono>key=value</Mono> / <Mono>--key wert</Mono>).
            </p>
            <button
              type="button"
              onClick={() => void runTool('health_check', { verbose: true })}
              className="mt-2 w-full text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 flex items-center justify-center gap-1.5"
            >
              <Terminal className="w-3.5 h-3.5" /> health_check (SDK-Erkennung)
            </button>
          </PanelSection>
        </div>

        <PanelSection
          title="Eingebaute Werkzeuge dieser App"
          right={
            <div className="flex items-center gap-2">
              <Pill tone={gw?.ok ? 'ok' : 'warn'}>
                <Usb className="w-3 h-3" /> {gw?.ok ? 'gateway erreichbar' : 'gateway offline'}
              </Pill>
            </div>
          }
        >
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {GATEWAY_TOOLS.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => void runGateway(t.action ?? t.name.replace('gateway_', ''))}
                className="text-left rounded-lg bg-[#050a18] border border-white/8 hover:border-emerald-500/40 px-2.5 py-2 group"
              >
                <div className="flex items-center justify-between gap-2">
                  <Mono className="!text-[11px] font-bold">{t.name}</Mono>
                  <RefreshCw className="w-3 h-3 text-slate-600 group-hover:text-emerald-300" />
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">{t.description}</div>
              </button>
            ))}
          </div>
        </PanelSection>

        <PanelSection
          title="Client-Konfiguration"
          right={
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setConfigOpen((v) => !v)} className="text-[10px] font-bold px-2 py-1 rounded bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10">
                {configOpen ? 'ausblenden' : 'anzeigen'}
              </button>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(configJson).then(() => setNote('📋 Konfiguration kopiert (mcp.json).'), () => setNote('Kopieren blockiert – Datei mcp/mcp.json nutzen.'))} className="p-1 rounded bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10">
                <Copy className="w-3 h-3" />
              </button>
            </div>
          }
        >
          {configOpen && (
            <pre className="text-[10.5px] font-mono text-slate-200 bg-[#020617] border border-white/8 rounded-xl p-3 overflow-x-auto leading-relaxed">{configJson}</pre>
          )}
          <p className="text-[10.5px] text-slate-500 leading-relaxed mt-2">
            Diese Konfiguration liegt versioniert im Repo unter <Mono>mcp/mcp.json</Mono>. Claude Desktop/Cursor tragen denselben Block ein;
            LobeChat nutzt „Custom Plugins → Quick Import JSON“ mit dem <Mono>dingelschwing-mobile-server</Mono>-Eintrag (HTTP).
            Der MCP-Server selbst startet über <Mono>npm start</Mono> bzw. <Mono>npx @modelcontextprotocol/inspector node node_modules/@cristianoaredes/mcp-mobile-server/dist/server.js</Mono>.
          </p>
        </PanelSection>

        {(output || note) && (
          <div className="grid lg:grid-cols-2 gap-3">
            {output && (
              <PanelSection title="Letzte Antwort" right={<Pill tone="slate">rohe Ausgabe</Pill>}>
                <pre className="text-[10.5px] font-mono text-emerald-100 bg-[#020617] border border-white/8 rounded-xl p-3 overflow-auto max-h-[280px] whitespace-pre-wrap leading-relaxed">{output}</pre>
              </PanelSection>
            )}
            {note && (
              <PanelSection title="Hinweis">
                <pre className="text-[10.5px] font-mono text-amber-100 bg-amber-950/20 border border-amber-800/30 rounded-xl p-3 whitespace-pre-wrap leading-relaxed">{note}</pre>
              </PanelSection>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
          <Plug className="w-3.5 h-3.5" /> Server: {health?.server_binary ?? 'Pfad nicht aufgelöst'} · {tools.length} registriert ·
          <Server className="w-3.5 h-3.5 ml-1" /> {String((gw?.config as Record<string, unknown> | undefined)?.tcp ?? '—')}
        </div>
      </div>
    </PanelShell>
  );
}
