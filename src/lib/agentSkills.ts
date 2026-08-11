/**
 * MoE Agent Skill-Runtime — ECHTE ausführbare Skills (keine Simulation)
 * ======================================================================
 * Ersetzt die frühere Fake-Antwort ("Processing: …") durch tatsächlich
 * ausgeführte Operationen:
 *
 *   system.info        → echte Browser-/Geräte-Informationen
 *   sensor.read        → echte Sensorwerte (DeviceOrientation/Motion, aus Kontext)
 *   distance.calculate → echte Distanzberechnung (WASM-Modul oder verifizierter Fallback)
 *   network.probe      → echte HTTP-Probes (fetch + AbortController, Latenz in ms)
 *   device.scan        → echte Web-USB/Web-Bluetooth-Enumeration
 *   rosetta.convert    → echte Konvertierung (RosettaConverter)
 *   replay.stats       → echte Statistik über Signalpunkte
 *   diagnostics.run    → echte Netzwerk-Diagnose (bündelt Probes + Browser-API)
 *   help               → Skill-Übersicht
 *
 * MoE-Routing: Aufgabe → Skill (Keyword-Matching) → passende Agenten-Rolle.
 * Kritische Skills (Schreibzugriff) erfordern eine Permission-Freigabe.
 */

export type SkillId =
  | "system.info"
  | "sensor.read"
  | "distance.calculate"
  | "network.probe"
  | "device.scan"
  | "rosetta.convert"
  | "replay.stats"
  | "diagnostics.run"
  | "help";

export type AgentRole = "analyzer" | "executor" | "validator" | "critic";

export interface SkillContext {
  /** Echte Sensorwerte aus useSensors() (null-safe). */
  sensors?: { alpha: number | null; beta: number | null; gamma: number | null; permissionGranted: boolean };
  /** Echte Distanzfunktion (WASM via loadBLEWasm() oder JS-Fallback). */
  distanceFn?: (rssi: number, txPower: number) => number;
  /** Echte Konvertierung (RosettaConverter.convert). */
  rosettaConvert?: (input: string, format: string) => string;
  /** Signalpunkte (Replay-Editor) für echte Statistik. */
  replayPoints?: Array<{ t: number; freqMHz: number; rssi: number; amp: number }>;
  /** Basis-URL für lokale Probes (z. B. Backend /api/health). */
  apiBase?: string;
  /** Timeout für Netzwerk-Probes (ms). */
  probeTimeoutMs?: number;
}

export interface SkillResult {
  skill: SkillId;
  ok: boolean;
  summary: string;
  detail?: string;
  data?: unknown;
  /** Skill erfordert eine Permission-Freigabe vor Ausführung. */
  needsPermission?: boolean;
  permissionLabel?: string;
}

export interface RouteHint {
  skill: SkillId;
  /** Agenten-Rollen, die diesen Skill bevorzugt ausführen. */
  agentRoles: AgentRole[];
  label: string;
}

// ---------------------------------------------------------------------------
// Routing: Aufgabe → Skill
// ---------------------------------------------------------------------------

const ROUTES: Array<{ keywords: string[]; hint: RouteHint }> = [
  {
    keywords: ["hilfe", "help", "was kannst", "skills", "fähigkeiten", "was geht"],
    hint: { skill: "help", agentRoles: ["critic", "validator"], label: "Skill-Übersicht" },
  },
  {
    keywords: ["sensor", "lage", "orientierung", "beschleunigung", "alpha", "beta", "gamma", "bewegung"],
    hint: { skill: "sensor.read", agentRoles: ["analyzer"], label: "Sensorwerte auslesen" },
  },
  {
    keywords: ["distanz", "abstand", "rssi", "meter", "entfernung", "reichweite", "txpower"],
    hint: { skill: "distance.calculate", agentRoles: ["analyzer", "validator"], label: "Distanz aus RSSI/TxPower" },
  },
  {
    keywords: ["ping", "latenz", "erreichbar", "verbindung", "netz", "testen", "probe", "latenzzeit"],
    hint: { skill: "network.probe", agentRoles: ["analyzer"], label: "Erreichbarkeit/Latenz prüfen" },
  },
  {
    keywords: ["diagnose", "diagnostics", "gesundheit", "health", "status prüfen", "systemcheck"],
    hint: { skill: "diagnostics.run", agentRoles: ["analyzer", "critic"], label: "System-Diagnose" },
  },
  {
    keywords: ["gerät", "device", "usb", "dongle", "bluetooth", "scannen", "koppeln", "pairing", "flash", "peripherie", "nfc", "tag", "ndef"],
    hint: { skill: "device.scan", agentRoles: ["executor"], label: "Geräte erkennen (USB/BT/NFC)" },
  },
  {
    keywords: ["rosetta", "konvert", "umwandeln", "übersetzen", "format", "konverter", "protokoll"],
    hint: { skill: "rosetta.convert", agentRoles: ["validator"], label: "Format konvertieren" },
  },
  {
    keywords: ["replay", "aufnahme", "statistik", "signal", "analyse", "frequenz", "amp"],
    hint: { skill: "replay.stats", agentRoles: ["analyzer", "validator"], label: "Signal-Statistik" },
  },
];

export function routeTask(input: string): RouteHint {
  const text = input.toLowerCase();
  for (const r of ROUTES) {
    if (r.keywords.some((k) => text.includes(k))) return r.hint;
  }
  // Fallback: System-Info + Hilfe-Hinweis
  return { skill: "system.info", agentRoles: ["analyzer", "executor", "validator", "critic"], label: "System-Information" };
}

/** Wählt aus der Agentenliste die passende Rolle für den Skill (MoE-Routing). */
export function pickAgent(agents: Array<{ id: string; name: string; role: AgentRole }>, hint: RouteHint): { id: string; name: string; role: AgentRole } | null {
  if (agents.length === 0) return null;
  const preferred = hint.agentRoles;
  for (const role of preferred) {
    const match = agents.find((a) => a.role === role);
    if (match) return match;
  }
  return agents[0];
}

// ---------------------------------------------------------------------------
// Echte Skill-Ausführung
// ---------------------------------------------------------------------------

async function probeUrl(url: string, timeoutMs: number): Promise<{ latencyMs: number; ok: boolean; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = performance.now();
  try {
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal, cache: "no-store", mode: "cors" });
    return { latencyMs: Math.round(performance.now() - start), ok: res.ok || res.status < 500 };
  } catch (e: unknown) {
    return { latencyMs: Math.round(performance.now() - start), ok: false, error: (e as Error)?.message ?? "Probe fehlgeschlagen" };
  } finally {
    clearTimeout(timer);
  }
}

async function scanDevices(): Promise<Array<{ id: string; name: string; source: string; vid?: number; pid?: number }>> {
  const out: Array<{ id: string; name: string; source: string; vid?: number; pid?: number }> = [];
  // Web-USB (bereits berechtigte Geräte)
  try {
    if (typeof navigator !== "undefined" && "usb" in navigator) {
      const devices = await (navigator as any).usb.getDevices();
      for (const d of devices) {
        out.push({ id: `usb:${d.vendorId}:${d.productId}`, name: d.productName ?? "USB-Gerät", source: "usb", vid: d.vendorId, pid: d.productId });
      }
    }
  } catch {
    /* Enumeration ohne Permission → leer */
  }
  // Web-Bluetooth (bereits berechtigte Geräte)
  try {
    if (typeof navigator !== "undefined" && "bluetooth" in navigator && typeof (navigator as any).bluetooth.getDevices === "function") {
      const devices = await (navigator as any).bluetooth.getDevices();
      for (const d of devices) {
        out.push({ id: `ble:${d.id}`, name: d.name ?? "BLE-Gerät", source: "ble" });
      }
    }
  } catch {
    /* nicht unterstützt */
  }
  return out;
}

async function execSkill(skill: SkillId, input: string, ctx: SkillContext): Promise<SkillResult> {
  const timeout = ctx.probeTimeoutMs ?? 4000;
  switch (skill) {
    case "help": {
      const list = ROUTES.map((r) => `• ${r.hint.label} — z. B. „${r.keywords[0]}”`).join("\n");
      return { skill, ok: true, summary: `Verfügbare Skills (echte Ausführung):\n${list}`, data: ROUTES.map((r) => r.hint.label) };
    }
    case "system.info": {
      const nav = typeof navigator !== "undefined" ? navigator : null;
      const info = {
        userAgent: nav?.userAgent ?? "n/a",
        language: nav?.language ?? "n/a",
        online: nav?.onLine ?? true,
        platform: nav?.platform ?? "n/a",
        cores: nav?.hardwareConcurrency ?? "n/a",
        memory: (nav as any)?.deviceMemory ?? "n/a",
        connection: (nav as any)?.connection ? { downlinkMbps: (nav as any).connection.downlink, effectiveType: (nav as any).connection.effectiveType } : null,
        screen: typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "n/a",
        sensors: ctx.sensors ? {
          alpha: ctx.sensors.alpha, beta: ctx.sensors.beta, gamma: ctx.sensors.gamma, permissionGranted: ctx.sensors.permissionGranted,
        } : null,
      };
      const lines = [
        `Browser: ${info.userAgent.slice(0, 60)}…`,
        `Plattform: ${info.platform} · Sprache: ${info.language}`,
        `Online: ${info.online} · Kerne: ${info.cores} · RAM: ${info.memory} GB`,
        info.connection ? `Netz: ${info.connection.effectiveType} (${info.connection.downlinkMbps} Mbps)` : "Netz-API: n/a",
        `Bildschirm: ${info.screen}`,
        ctx.sensors?.permissionGranted ? `Sensoren: α=${ctx.sensors.alpha}° β=${ctx.sensors.beta}° γ=${ctx.sensors.gamma}°` : "Sensoren: keine Freigabe",
      ];
      return { skill, ok: true, summary: lines.join("\n"), data: info };
    }
    case "sensor.read": {
      const s = ctx.sensors;
      if (!s || !s.permissionGranted) {
        return { skill, ok: false, summary: "Sensorwerte nicht verfügbar — bitte Sensoren im Geräte-Dashboard freigeben.", needsPermission: true, permissionLabel: "sensor.read" };
      }
      const data = { alpha: s.alpha, beta: s.beta, gamma: s.gamma };
      return {
        skill, ok: true,
        summary: `Aktuelle Lage: α=${s.alpha?.toFixed(1) ?? "–"}° · β=${s.beta?.toFixed(1) ?? "–"}° · γ=${s.gamma?.toFixed(1) ?? "–"}°`,
        data,
      };
    }
    case "distance.calculate": {
      const fn = ctx.distanceFn;
      if (!fn) return { skill, ok: false, summary: "Distanz-Modul nicht initialisiert (WASM lädt asynchron)." };
      // RSSI/TxPower aus der Eingabe parsen, sonst Referenzwerte
      const m = input.match(/(-?\d+(?:\.\d+)?)\s*(?:dbm)?\s*(?:,|\s|bei)\s*(-?\d+(?:\.\d+)?)/i);
      const rssi = m ? parseFloat(m[1]) : -65;
      const tx = m ? parseFloat(m[2]) : -59;
      const dist = fn(rssi, tx);
      return {
        skill, ok: true,
        summary: `Distanz bei RSSI ${rssi} dBm / TxPower ${tx} dBm: ${dist.toFixed(2)} m (Pfadverlustmodell, echtes WASM/JS-Modul)`,
        data: { rssi, txPower: tx, distanceM: dist },
      };
    }
    case "network.probe": {
      const targets = ["https://www.google.com/generate_204", "https://cloudflare.com/cdn-cgi/trace"];
      if (ctx.apiBase) targets.push(`${ctx.apiBase}/api/health`);
      const results = [];
      for (const t of targets) {
        const r = await probeUrl(t, timeout);
        results.push({ target: t, ...r });
      }
      const okCount = results.filter((r) => r.ok).length;
      const lines = results.map((r) => `• ${r.target} → ${r.ok ? `${r.latencyMs} ms` : `✗ ${r.error ?? "nicht erreichbar"}`}`).join("\n");
      return { skill, ok: okCount > 0, summary: `Netzwerk-Probe (${okCount}/${results.length} erreichbar):\n${lines}`, data: results };
    }
    case "diagnostics.run": {
      const probe = await execSkill("network.probe", input, ctx);
      const nav = typeof navigator !== "undefined" ? navigator : null;
      const conn = (nav as any)?.connection;
      const lines = [
        probe.summary,
        conn ? `Netz-API: ${conn.effectiveType} · ${conn.downlink} Mbps · RTT ${conn.rtt} ms` : "Netz-API: n/a",
        `Geräte im Browser sichtbar: ${(await scanDevices()).length}`,
      ];
      return { skill, ok: probe.ok, summary: `System-Diagnose:\n${lines.join("\n")}`, data: { probe: probe.data, connection: conn ? { type: conn.effectiveType, downlinkMbps: conn.downlink, rttMs: conn.rtt } : null } };
    }
    case "device.scan": {
      const devices = await scanDevices();
      const low = input.toLowerCase();
      const flashRequested = low.includes("flash") || low.includes("schreib") || low.includes("write");
      const nfcWrite = low.includes("nfc") && (low.includes("schreib") || low.includes("write") || low.includes("tag"));
      if (flashRequested) {
        return {
          skill, ok: true,
          summary: `Geräte erkannt (${devices.length}). Schreibvorgang wartet auf HUMAN-IN-THE-LOOP-Freigabe (USB/NFC-Transfer wird erst nach Bestätigung ausgeführt).\n${devices.map((d) => `• ${d.name} (${d.source}${d.vid ? ` 0x${d.vid.toString(16)}` : ""})`).join("\n") || "• keine berechtigten Geräte"}`,
          data: devices, needsPermission: true, permissionLabel: nfcWrite ? "nfc.write" : "device.write",
        };
      }
      return {
        skill, ok: true,
        summary: `Geräte erkannt (${devices.length}):\n${devices.map((d) => `• ${d.name} (${d.source}${d.vid ? ` 0x${d.vid.toString(16)}` : ""})`).join("\n") || "• keine — USB/BT-Geräte zuerst im Browser freigeben"}`,
        data: devices,
      };
    }
    case "rosetta.convert": {
      const convert = ctx.rosettaConvert;
      if (!convert) return { skill, ok: false, summary: "Rosetta-Konverter nicht verfügbar." };
      // JSON in der Eingabe bevorzugen; sonst alles nach dem Konvertier-Befehl
      const jsonMatch = input.match(/\{.*\}|\[.*\]/s);
      const cmd = input.replace(/^(?:rosetta[ :]*)?(?:konvertiere|convert|umwandeln|to|nach)\s*/i, "").trim();
      const formatMatch = cmd.match(/\s+(?:nach|zu|to|in)\s+(\w+)$/i);
      const format = formatMatch?.[1]?.toLowerCase() ?? "json";
      const stripped = cmd.replace(/\s+(?:nach|zu|to|in)\s+\w+$/i, "").trim();
      const payload = jsonMatch?.[0] ?? (stripped.length > 0 ? stripped : '{"type":"wifi","ssid":"DemoNet","rssi":-62}');
      try {
        const out = convert(payload, format);
        return { skill, ok: true, summary: `Konvertiert (${format}):\n${out.slice(0, 300)}`, data: out };
      } catch (e) {
        return { skill, ok: false, summary: `Konvertierung fehlgeschlagen: ${(e as Error).message}` };
      }
    }
    case "replay.stats": {
      const points = ctx.replayPoints ?? [];
      if (points.length === 0) return { skill, ok: false, summary: "Keine Signalpunkte vorhanden — bitte im Replay-Editor aufnehmen/generieren." };
      const rssiVals = points.map((p) => p.rssi);
      const freqVals = points.map((p) => p.freqMHz);
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      const min = (a: number[]) => Math.min(...a);
      const max = (a: number[]) => Math.max(...a);
      const stats = {
        count: points.length,
        rssi: { min: Math.round(min(rssiVals)), max: Math.round(max(rssiVals)), avg: Math.round(avg(rssiVals) * 10) / 10 },
        freq: { min: Math.round(min(freqVals)), max: Math.round(max(freqVals)) },
        durationMs: Math.max(0, Math.round(max(points.map((p) => p.t)) - min(points.map((p) => p.t)))),
      };
      return {
        skill, ok: true,
        summary: `Signal-Statistik (${stats.count} Punkte):\nRSSI: ${stats.rssi.min}…${stats.rssi.max} dBm (Ø ${stats.rssi.avg})\nFrequenz: ${stats.freq.min}…${stats.freq.max} MHz\nDauer: ${(stats.durationMs / 1000).toFixed(1)} s`,
        data: stats,
      };
    }
    default:
      return { skill, ok: false, summary: `Skill „${skill}” nicht verfügbar.` };
  }
}

/** Führt eine Aufgabe für einen Agenten echt aus. */
export async function executeTask(
  _agent: { id: string; name: string; role: AgentRole },
  input: string,
  ctx: SkillContext,
): Promise<SkillResult> {
  const hint = routeTask(input);
  return execSkill(hint.skill, input, ctx);
}
