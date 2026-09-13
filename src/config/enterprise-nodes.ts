/**
 * Enterprise Node Database — reale Ladelogik statt einkompilierter Planungsdaten.
 *
 * // REAL-IMPLEMENTATION 2026-09-13 (Schritt 3): Zuvor standen hier fünf fest
 * verdrahtete `.local`-Endpunkte (mcp-bridge.qloud.local, api.qloud-gp.local …)
 * mit `validateNodeEndpoint()`, das **immer `true`** zurückgab. Beides ist
 * ersetzt:
 *
 *  - Knoten kommen aus einer echten CSV-Datei (`public/enterprise-nodes.csv`,
 *    Vorlage: `config/enterprise-nodes.csv`), die zur Laufzeit geladen und
 *    geparst wird ([loadEnterpriseNodes], [parseEnterpriseNodesCsv]).
 *  - Ohne gepflegte Datei ist die Registry **leer** — es werden keine Endpunkte
 *    erfunden ([getNodeConfig] liefert `null`).
 *  - [validateNodeEndpoint] prüft den konfigurierten Endpunkt wirklich
 *    (fetch mit Timeout) und meldet `false`, wenn nichts konfiguriert ist.
 *
 * Die Planungs-Endpunkte stehen weiterhin als Spezifikation in
 * `docs/enterprise-node-database.md` — sie sind Dokumentation, keine Laufzeitdaten.
 */

export type NodeCategory = 'MCP' | 'API' | 'Web-Hook' | 'Notebook' | 'KI-Inferenz';

export interface EnterpriseNode {
  category: NodeCategory;
  nodeId: string;
  nodeName: string;
  tunnelProtocol: string;
  endpointUrl: string;
  authentication: string;
  securityLayer: string;
  primaryFunction: string;
  description?: string;
}

export interface MCPNodeConfig extends EnterpriseNode {
  category: 'MCP';
  jsonRpcVersion: string;
  defaultMethod: string;
  hardwareTokenType: string;
  tlsVersion: string;
}

export interface APINodeConfig extends EnterpriseNode {
  category: 'API';
  endpoints: {
    path: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    description: string;
  }[];
  encryptionAlgorithm: string;
  rbacEnabled: boolean;
}

export interface WebHookNodeConfig extends EnterpriseNode {
  category: 'Web-Hook';
  httpMethod: string;
  signatureAlgorithm: string;
  retryPolicy: string;
}

export interface NotebookNodeConfig extends EnterpriseNode {
  category: 'Notebook';
  runtime: string;
  websocketSupport: boolean;
}

export interface InferenceNodeConfig extends EnterpriseNode {
  category: 'KI-Inferenz';
  modelName: string;
  quantization: string;
  vectorStore: string;
  ragVaultEnabled: boolean;
}

/** Standardpfad der zur Laufzeit geladenen Knotenliste (Vite/public). */
export const ENTERPRISE_NODES_URL = '/enterprise-nodes.csv';

/** Spaltenreihenfolge der CSV (siehe `config/enterprise-nodes.csv`). */
const CSV_HEADER_KEYS = [
  'category',
  'nodeId',
  'tunnelProtocol',
  'endpointUrl',
  'authentication',
  'primaryFunction',
] as const;

export const EMPTY_ENTERPRISE_NODES: readonly EnterpriseNode[] = Object.freeze([]);

/** Laufzeit-Registry — gefüllt über [setEnterpriseNodes] bzw. [loadEnterpriseNodes]. */
let registry: EnterpriseNode[] = [];

function isCategory(value: string): value is NodeCategory {
  return ['MCP', 'API', 'Web-Hook', 'Notebook', 'KI-Inferenz'].includes(value);
}

/** Zerlegt eine CSV-Zeile inkl. Anführungszeichen und Kommas in Feldern. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === ';') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Parst die Knotenliste aus CSV-Text.
 *
 * Erwartet die Kopfzeile `Kategorie,Knoten-ID / Name,Tunnel-Protokoll & Routing,
 * Endpunkt / URL-Schema,Authentifizierung & Security,Primärer Einsatzzweck & Funktion`.
 * Zeilen, die mit `#` beginnen, sind Kommentare; unbekannte Kategorien und
 * Zeilen ohne Endpunkt werden übersprungen (nie geraten).
 */
export function parseEnterpriseNodesCsv(csv: string): EnterpriseNode[] {
  const rows = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const nodes: EnterpriseNode[] = [];
  for (const [index, line] of rows.entries()) {
    const cells = splitCsvLine(line);
    if (index === 0 && /kategorie|category/i.test(cells[0] ?? '')) continue; // Kopfzeile
    if (cells.length < CSV_HEADER_KEYS.length) continue;
    const [rawCategory, nodeId, tunnelProtocol, endpointUrl, authentication, primaryFunction] = cells;
    // Kategorie tolerieren: "1. MCP" oder "KI-Interferenz" (Doku-Schreibweise)
    const normalized = rawCategory.replace(/^\d+\.\s*/, '').trim();
    const category = isCategory(normalized)
      ? normalized
      : normalized === 'KI-Interferenz'
        ? 'KI-Inferenz'
        : null;
    if (!category || !nodeId || !endpointUrl) continue;
    nodes.push({
      category,
      nodeId,
      nodeName: nodeId,
      tunnelProtocol,
      endpointUrl,
      authentication,
      securityLayer: authentication,
      primaryFunction,
    });
  }
  return nodes;
}

/** Setzt die Registry (z. B. nach einem Import oder Test). */
export function setEnterpriseNodes(nodes: EnterpriseNode[]): void {
  registry = [...nodes];
}

/** Alle konfigurierten Knoten (leer, wenn keine CSV gepflegt ist). */
export function getAllNodeConfigs(): EnterpriseNode[] {
  return [...registry];
}

/** Knoten einer Kategorie — `null`, wenn nicht konfiguriert (kein Platzhalter). */
export function getNodeConfig(category: NodeCategory): EnterpriseNode | null {
  return registry.find((n) => n.category === category) ?? null;
}

/**
 * Lädt die Knotenliste aus einer realen CSV-Quelle.
 *
 * @returns die geladenen Knoten; bei Fehler/leerer Datei eine leere Liste.
 */
export async function loadEnterpriseNodes(
  url: string = ENTERPRISE_NODES_URL,
  init: RequestInit = {},
): Promise<EnterpriseNode[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return [];
    const nodes = parseEnterpriseNodesCsv(await res.text());
    setEnterpriseNodes(nodes);
    return nodes;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prüft, ob der konfigurierte Endpunkt antwortet — echte Anfrage mit Timeout.
 *
 * `false`, wenn kein Knoten konfiguriert ist oder die Gegenstelle nicht
 * antwortet. Es wird nie ein Erfolg angenommen.
 */
export async function validateNodeEndpoint(
  category: NodeCategory,
  timeoutMs = 4000,
): Promise<boolean> {
  const node = getNodeConfig(category);
  if (!node) return false;
  if (!/^https?:\/\//i.test(node.endpointUrl)) {
    // ws://, wss:// und proprietäre Schemata lassen sich im Browser nicht per fetch prüfen.
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(node.endpointUrl, { method: 'HEAD', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Abwärtskompatibler Zugriff für ältere Aufrufer.
 *
 * Früher war das ein fest verdrahtetes Objekt mit Platzhalter-Endpunkten. Jetzt
 * die reale Registry als kategorie-indizierte Sicht (leer, bis eine CSV geladen ist).
 */
export const ENTERPRISE_NODES: Record<string, EnterpriseNode | undefined> = new Proxy(
  {} as Record<string, EnterpriseNode | undefined>,
  {
    get: (_target, prop: string) => getNodeConfig(prop as NodeCategory) ?? undefined,
    has: (_target, prop: string) => getNodeConfig(prop as NodeCategory) !== null,
    ownKeys: () => getAllNodeConfigs().map((n) => n.category),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
);
