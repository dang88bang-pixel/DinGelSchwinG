/**
 * Echte-Runtime-Tests — verifiziert, dass die simulierten Parts durch
 * aktiv ausführbare Logik ersetzt wurden:
 *   1. agentSkills: Routing + echte Ausführung (sensor/distance/rosetta/replay/device/system)
 *   2. networkProbe: echte HTTP-Probe gegen lokales Backend (falls erreichbar)
 *   3. RosettaConverter: echte Konvertierungen (json/csv/base64/hex/kv)
 *   4. bleWasm: Loader liefert ausführbares Modul (WASM oder verifizierter Fallback)
 *
 * Aufruf:  npx tsx tests/realRuntime.test.ts   (Exit 0 = grün)
 */
import { executeTask, routeTask } from "../src/lib/agentSkills";
import { probeHttp, networkInfo } from "../src/lib/networkProbe";
import { RosettaConverter } from "../src/lib/rosetta/rosettaConverter";
import { loadBLEWasm, bleWasmVerifiedSimulation } from "../src/lib/bleWasm";
import { usbListDevices, bleConnectAndRead, nfcStartScan } from "../src/lib/hardwareAccess";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  [OK]   ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${detail}`); }
}

const AGENTS = [
  { id: "a1", name: "Network Analyzer", role: "analyzer" as const },
  { id: "a2", name: "Device Controller", role: "executor" as const },
  { id: "a3", name: "Validator", role: "validator" as const },
  { id: "a4", name: "Critic", role: "critic" as const },
];

async function main() {
  // ── 1) Routing (kein Zufall) ──
  check("routeTask('ping 8.8.8.8') → network.probe", routeTask("ping 8.8.8.8").skill === "network.probe", routeTask("ping 8.8.8.8").skill);
  check("routeTask('Distanz von -65 bei -59') → distance.calculate", routeTask("Distanz von -65 bei -59").skill === "distance.calculate");
  check("routeTask('sensorwerte lesen') → sensor.read", routeTask("sensorwerte lesen").skill === "sensor.read");
  check("routeTask('usb dongle scannen') → device.scan", routeTask("usb dongle scannen").skill === "device.scan");
  check("routeTask('hilfe') → help", routeTask("hilfe").skill === "help");

  // ── 2) Echte Skill-Ausführung ──
  const ctx = {
    sensors: { alpha: 10, beta: 20, gamma: 30, permissionGranted: true },
    distanceFn: (rssi: number, tx: number) => Math.pow(10, (tx - rssi) / 20),
    rosettaConvert: (input: string, format: string) => RosettaConverter.convert(input, format),
    replayPoints: [
      { t: 0, freqMHz: 2400, rssi: -70, amp: 0.5 },
      { t: 1000, freqMHz: 2410, rssi: -65, amp: 0.7 },
      { t: 2000, freqMHz: 2420, rssi: -60, amp: 0.9 },
    ],
  };
  const sensor = await executeTask(AGENTS[0], "sensorwerte", ctx);
  check("sensor.read liefert echte Werte", sensor.ok && sensor.summary.includes("α=10"), sensor.summary);

  const dist = await executeTask(AGENTS[1], "Distanz bei -65 tx -59", ctx);
  check("distance.calculate rechnet echt (≈2.0 m)", dist.ok && dist.data && Math.abs((dist.data as any).distanceM - Math.pow(10, 6 / 20)) < 1e-6, JSON.stringify(dist.data));

  const rosetta = await executeTask(AGENTS[2], "rosetta konvertiere {\"a\":1} nach csv", ctx);
  check("rosetta.convert liefert echtes CSV", rosetta.ok && (rosetta.summary.includes("a") && rosetta.summary.includes("1")), rosetta.summary);

  const replay = await executeTask(AGENTS[3], "replay statistik", ctx);
  check("replay.stats rechnet echte Statistik (3 Punkte, Ø -65)", replay.ok && replay.summary.includes("3 Punkte") && replay.summary.includes("-65"), replay.summary);

  const dev = await executeTask(AGENTS[1], "geräte scannen", ctx);
  check("device.scan ausführbar (leer ohne HW, kein Crash)", dev.skill === "device.scan" && typeof dev.summary === "string", dev.summary);

  const sys = await executeTask(AGENTS[0], "system info", ctx);
  check("system.info liefert echte Browser-Daten", sys.ok && sys.summary.includes("Browser"), sys.summary);

  // ── 3) networkProbe: echte HTTP-Probe (lokal erreichbar? sonst ehrlicher Fail) ──
  const probe = await probeHttp("http://127.0.0.1:5000/api/health", 3000);
  if (probe.status === "ok") {
    check("networkProbe: lokales Backend erreichbar, Latenz gemessen", probe.latencyMs !== null && probe.latencyMs >= 0, JSON.stringify(probe));
  } else {
    check("networkProbe: ehrlicher Fail wenn Backend offline", probe.status === "fail" && probe.error !== undefined, JSON.stringify(probe));
  }
  const info = networkInfo();
  check("networkInfo liefert Objekt", typeof info === "object" && info !== null);

  // ── 4) RosettaConverter: echte Konvertierungen ──
  check("convert json→pretty", RosettaConverter.convert('{"a":1}', "json") === '{\n  "a": 1\n}');
  check("convert json→csv", RosettaConverter.convert('{"a":1,"b":2}', "csv").split("\n")[0] === "a,b");
  check("convert json→kv", RosettaConverter.convert('{"a":1}', "kv") === "a=1");
  check("convert base64 encode/decode", RosettaConverter.convert(RosettaConverter.convert("Hallo Welt", "base64"), "base64") === "Hallo Welt");
  check("convert hex encode/decode", RosettaConverter.convert(RosettaConverter.convert("Hi!", "hex"), "hex") === "Hi!");
  check("convert kv→json", RosettaConverter.convert("rssi=-65\nname=node1", "json").includes('"rssi": -65'));

  // ── 5) bleWasm-Loader: ausführbares Modul (WASM oder verifizierter Fallback) ──
  const wasm = await loadBLEWasm();
  const d = wasm.calculate_distance(-65, -59);
  check("bleWasm: calculate_distance(-65,-59) ≈ 2.0", typeof d === "number" && Math.abs(d - 2.0) < 0.5, String(d));
  check("bleWasm: JS-Simulation ist die verifizierte Referenz", bleWasmVerifiedSimulation.calculate_distance(-65, -59) === Math.pow(10, 6 / 20));
  const batch = wasm.batch_distances(new Float64Array([-65, -70]), -59);
  check("bleWasm: batch_distances ausführbar", batch.length === 2 && Math.abs(batch[0] - Math.pow(10, 6 / 20)) < 1e-9, String(batch[0]));

  // ── 6) hardwareAccess: ehrliche Ergebnisse ohne Hardware/Browser ──
  try {
    await bleConnectAndRead(null);
    check("bleConnectAndRead wirft ohne Web-Bluetooth", false, "sollte werfen");
  } catch (e) {
    check("bleConnectAndRead wirft ehrlich ohne Web-Bluetooth", (e as Error).message.includes("Web Bluetooth"), (e as Error).message);
  }
  const usb = await usbListDevices();
  check("usbListDevices liefert leere Liste ohne Web-USB", Array.isArray(usb) && usb.length === 0);
  let nfcErr: Error | null = null;
  nfcStartScan(() => {}, (err) => { nfcErr = err; });
  check("nfcStartScan meldet ehrlich fehlendes WebNFC", nfcErr !== null && nfcErr.message.includes("WebNFC"), nfcErr?.message);

  console.log(`═══════ ECHTE-RUNTIME-TESTS: ${pass}/${pass + fail} · ${fail} Fehler ═══════`);
  process.exit(fail ? 1 : 0);
}

void main();
