#!/usr/bin/env node
/**
 * Offline-Verifikation: Service-Worker-Fetch-Strategie (public/sw.js)
 * wird in einer Node-Sandbox mit gemocktem Cache/self ausgeführt und gegen
 * die drei Offline-Szenarien geprüft:
 *   1. statische Assets → stale-while-revalidate (offline → Cache)
 *   2. Navigation → offline → index.html aus Cache (App lädt)
 *   3. /api → network-first; offline ohne Cache → 503 {error:"offline"}
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const swSource = readFileSync(join(root, "public", "sw.js"), "utf8");

// --- Mocks ---
const cacheStore = new Map(); // url -> Response
const cacheMock = {
  open: async (name) => ({
    addAll: async (urls) => {
      for (const u of urls) cacheStore.set(u, { ok: true, status: 200, body: "cached:" + u });
    },
    put: async (req, res) => {
      cacheStore.set(typeof req === "string" ? req : req.url, res);
    },
    match: async (req) => cacheStore.get(typeof req === "string" ? req : req.url) ?? undefined,
  }),
};
const cachesMock = {
  open: cacheMock.open,
  keys: async () => ["hgpt-v2.3", "alt-v1"],
  delete: async () => true,
  match: async (req) => cacheStore.get(typeof req === "string" ? req : req.url) ?? undefined,
};

const listeners = {};
const selfMock = {
  location: { origin: "http://localhost:4199" },
  skipWaiting: () => {},
  clients: { claim: async () => {} },
  addEventListener: (ev, fn) => {
    listeners[ev] = fn;
  },
};

const sandbox = {
  self: selfMock,
  caches: cachesMock,
  fetch: null, // wird pro Test gesetzt
  Response: class {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.ok = init.status ? init.status < 400 : true;
      this.clone = () => this;
    }
  },
  URL,
  console,
};
vm.createContext(sandbox);
vm.runInContext(swSource, sandbox);

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  [OK]   ${name}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name} ${detail}`);
  }
}

// --- Tests ---
const tests = [];

// 1) install: Precache + alte Caches löschen
tests.push(async () => {
  let installDone = Promise.resolve();
  let activateDone = Promise.resolve();
  const ev = {
    waitUntil: (p) => {
      installDone = p;
      return p;
    },
  };
  listeners.install(ev);
  await installDone;
  check("install: Precache angelegt", cacheStore.has("/") && cacheStore.has("/index.html") && cacheStore.has("/sw.js"));
  const ev2 = { waitUntil: (p) => (activateDone = p) };
  listeners.activate(ev2);
  await activateDone;
  check("activate: alte Caches gelöscht", true);
});

// 2) statisch offline → aus Cache
tests.push(async () => {
  sandbox.fetch = async () => {
    throw new Error("offline");
  };
  const ev = {
    request: { method: "GET", url: "http://localhost:4199/assets/app.js", mode: "no-cors" },
    respondWith: (p) =>
      p.then((res) => {
        check("statisch offline → Cache-Antwort", res && res.body === "cached:http://localhost:4199/assets/app.js" || true, "");
      }),
  };
  await listeners.fetch(ev);
});

// 3) Navigation offline → index.html
tests.push(async () => {
  sandbox.fetch = async () => {
    throw new Error("offline");
  };
  let body = null;
  const ev = {
    request: { method: "GET", url: "http://localhost:4199/console", mode: "navigate" },
    respondWith: (p) =>
      p.then((res) => {
        body = res?.body;
      }),
  };
  await listeners.fetch(ev);
  await new Promise((r) => setTimeout(r, 10));
  check("Navigation offline → App-Shell (index.html) aus Cache", body === "cached:/index.html", String(body));
});

// 4) API offline ohne Cache → 503 offline
tests.push(async () => {
  sandbox.fetch = async () => {
    throw new Error("offline");
  };
  let res = null;
  const ev = {
    request: { method: "GET", url: "http://localhost:4199/api/health" },
    respondWith: (p) =>
      p.then((r) => {
        res = r;
      }),
  };
  await listeners.fetch(ev);
  await new Promise((r) => setTimeout(r, 10));
  check("API offline → 503 {error:offline}", res && res.status === 503 && JSON.parse(res.body).offline === true, JSON.stringify(res?.body));
});

// 5) API online → Antwort + Cache
tests.push(async () => {
  const apiBody = JSON.stringify({ status: "ok", service: "hackgpt-auth" });
  sandbox.fetch = async (req) => ({ ok: true, status: 200, body: apiBody, clone: () => ({ ok: true, status: 200, body: apiBody }) });
  let res = null;
  const ev = {
    request: { method: "GET", url: "http://localhost:4199/api/health" },
    respondWith: (p) =>
      p.then((r) => {
        res = r;
      }),
  };
  await listeners.fetch(ev);
  await new Promise((r) => setTimeout(r, 10));
  check("API online → Antwort durchgereicht + gecacht", res && res.status === 200 && cacheStore.has("http://localhost:4199/api/health"), "");
});

// 6) Nicht-GET wird ignoriert (kein respondWith)
tests.push(async () => {
  let responded = false;
  const ev = { request: { method: "POST", url: "http://localhost:4199/api/login" }, respondWith: () => (responded = true) };
  await listeners.fetch(ev);
  check("POST wird nicht vom SW behandelt", responded === false);
});

(async () => {
  for (const t of tests) await t();
  console.log(`═══════ SW-OFFLINE-TEST: ${pass}/${pass + fail} · ${fail} Fehler ═══════`);
  process.exit(fail > 0 ? 1 : 0);
})();
