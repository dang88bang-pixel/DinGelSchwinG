package com.dingelschwinng.moeagent;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * PortView – native Brücke für die automatische Server-Findung.
 *
 * Eine WebView darf weder UDP-Broadcasts senden noch fremde Ports antesten, und
 * gemischte Inhalte (https-Seite → http-Port) blockiert sie ebenfalls. Die native
 * Seite kann es – deshalb passiert genau das hier:
 *
 *   1. UDP :18791  "DGS_DISCOVER {..}"  an alle Broadcast-Adressen der aktiven
 *      Interfaces (+ 127.0.0.1, + Extra-Hosts). Antwort kommt vom
 *      Gateway-Kern (mobile-server/discovery.py) und nennt alle Ports.
 *   2. HTTP-Probe  GET /status (Gateway) und /mcp/health (Bridge) auf allen
 *      Kandidaten; als Treffer zählt nur das DinGelSchwinG-Markfeld.
 *   3. sweepSubnet (optional, extra Flag) /24 des aktiven Netzes, 24 Threads.
 *
 * Ergebnis: candidates[] mit base/host/port/kind/via/latencyMs – die Web-Schicht
 * (src/lib/portview.ts) übernimmt den besten Wert in die App-Konfiguration.
 */
@CapacitorPlugin(name = "PortView")
public class PortViewPlugin extends Plugin {

    private static final String TAG = "DGS-PortView";
    private static final String PRODUCT = "DinGelSchwinG";
    private static final String SERVICE = "dingelschwing-gateway";
    private static final String GATEWAY_SERVICE = "dingelschwing-mobile-gateway";
    private static final byte[] MAGIC = "DGS_DISCOVER".getBytes(StandardCharsets.UTF_8);
    private static final String USER_AGENT = "dingelschwing-portview/1.0 (Android)";

    @PluginMethod
    public void discover(PluginCall call) {
        final int discoveryPort = call.getInt("discoveryPort") != null ? call.getInt("discoveryPort") : 18791;
        final int gatewayPort = call.getInt("gatewayPort") != null ? call.getInt("gatewayPort") : 8791;
        final int bridgePort = call.getInt("bridgePort") != null ? call.getInt("bridgePort") : 8790;
        final boolean sweep = Boolean.TRUE.equals(call.getBoolean("sweepSubnet", false));
        final long timeoutMs = call.getInt("timeoutMs") != null ? call.getInt("timeoutMs") : 2500;
        final List<String> extraHosts = new ArrayList<>();
        JSArray hostArray = call.getArray("extraHosts");
        if (hostArray != null) {
            for (int i = 0; i < hostArray.length(); i++) {
                String host = hostArray.optString(i, null);
                if (host != null && !host.trim().isEmpty()) {
                    extraHosts.add(host.trim());
                }
            }
        }

        Runnable work = () -> {
            long started = System.currentTimeMillis();
            List<JSObject> found = Collections.synchronizedList(new ArrayList<>());
            Set<String> hosts = new LinkedHashSet<>();
            Set<Integer> ports = new LinkedHashSet<>();
            ports.add(gatewayPort);
            ports.add(bridgePort);

            // 1) UDP-Broadcast: der Gateway nennt sich selbst – inklusive Ports.
            Set<String> udpHosts = udpDiscover(discoveryPort, timeoutMs, extraHosts, found, hosts, ports);

            // 2) Kandidatenmenge aufbauen (Loopback, Emulator-Host, Funknetz-IPs …)
            hosts.addAll(udpHosts);
            hosts.add("127.0.0.1");
            hosts.add("10.0.2.2");
            hosts.addAll(extraHosts);
            List<String> localIps = localIPv4s();
            hosts.addAll(localIps);

            if (sweep) {
                String base4 = primaryIpv4(localIps);
                if (base4 != null) {
                    String prefix = base4.substring(0, base4.lastIndexOf('.') + 1);
                    for (int i = 1; i <= 254; i++) {
                        String candidate = prefix + i;
                        if (!candidate.equals(base4)) {
                            hosts.add(candidate);
                        }
                    }
                }
            }

            // 3) HTTP-Probe über alle Host×Port-Kombinationen. Beim /24-Sweep
            //    nur der Gateway-Port (sonst 3× so viele Pakete im Funknetz).
            List<Integer> probePorts = sweep ? new ArrayList<>(Collections.singletonList(gatewayPort)) : new ArrayList<>(ports);
            httpProbe(new ArrayList<>(hosts), probePorts, sweep ? 180 : Math.max(250, timeoutMs / 3), timeoutMs, found);

            JSObject result = new JSObject();
            JSArray out = new JSArray();
            synchronized (found) {
                for (JSObject item : found) {
                    out.put(item);
                }
            }
            result.put("ok", found.size() > 0);
            result.put("candidates", out);
            result.put("took_ms", System.currentTimeMillis() - started);
            if (found.isEmpty()) {
                result.put("error", "keine_antwort");
                result.put("detail", "UDP :" + discoveryPort + " und HTTP-Probes über " + hosts.size() + " Hosts / " + ports.size() + " Ports ohne Treffer");
            }
            call.resolve(result);
        };

        ExecutorService pool = Executors.newSingleThreadExecutor();
        pool.execute(() -> {
            try {
                work.run();
            } catch (Exception e) {
                Log.w(TAG, "discover fehlgeschlagen: " + e);
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("error", "native_fehler");
                err.put("detail", String.valueOf(e.getMessage()));
                call.resolve(err);
            } finally {
                pool.shutdownNow();
            }
        });
    }

    /** Einzelnen Endpunkt prüfen (Button „Verbindung testen“ im Panel). */
    @PluginMethod
    public void ping(PluginCall call) {
        String base = call.getString("base", "");
        String path = call.getString("path", "/status");
        int timeout = call.getInt("timeoutMs") != null ? call.getInt("timeoutMs") : 1500;
        JSObject res = new JSObject();
        long started = System.currentTimeMillis();
        JSONObject json = probe(base, path, timeout, res);
        res.put("latencyMs", System.currentTimeMillis() - started);
        res.put("ok", json != null);
        if (json != null) {
            res.put("product", json.optString("product", null));
            res.put("service", json.optString("service", null));
            res.put("hostname", json.optString("hostname", null));
        }
        call.resolve(res);
    }

    // -----------------------------------------------------------------------
    // UDP-Discovery
    // -----------------------------------------------------------------------
    private Set<String> udpDiscover(int port, long timeoutMs, List<String> extraHosts,
                                    List<JSObject> found, Set<String> hostsOut, Set<Integer> portsOut) {
        Set<String> responders = new LinkedHashSet<>();
        List<String> targets = new ArrayList<>();
        targets.add("127.0.0.1");
        targets.add("255.255.255.255");
        try {
            Enumeration<NetworkInterface> nics = NetworkInterface.getNetworkInterfaces();
            while (nics != null && nics.hasMoreElements()) {
                NetworkInterface nic = nics.nextElement();
                if (!nic.isUp() || nic.isLoopback()) {
                    continue;
                }
                for (InterfaceAddress addr : nic.getInterfaceAddresses()) {
                    InetAddress broadcast = addr.getBroadcast();
                    if (broadcast != null) {
                        targets.add(broadcast.getHostAddress());
                    }
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "Interfaces nicht lesbar: " + e);
        }
        targets.addAll(extraHosts);

        byte[] body = ("{\"nonce\":\"" + Long.toHexString(System.currentTimeMillis()) + "\"}").getBytes(StandardCharsets.UTF_8);
        byte[] packet = new byte[MAGIC.length + 1 + body.length];
        System.arraycopy(MAGIC, 0, packet, 0, MAGIC.length);
        packet[MAGIC.length] = ' ';
        System.arraycopy(body, 0, packet, MAGIC.length + 1, body.length);

        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket();
            socket.setBroadcast(true);
            socket.setSoTimeout(120);
            long deadline = System.currentTimeMillis() + Math.max(300, timeoutMs / 2);
            for (String target : new LinkedHashSet<>(targets)) {
                try {
                    socket.send(new DatagramPacket(packet, packet.length, InetAddress.getByName(target), port));
                } catch (Exception ignored) {
                    // einzelnes Ziel defekt: weitermachen
                }
                byte[] buffer = new byte[4096];
                while (System.currentTimeMillis() < deadline) {
                    DatagramPacket answer = new DatagramPacket(buffer, buffer.length);
                    try {
                        socket.receive(answer);
                    } catch (SocketTimeoutException steep) {
                        break;
                    } catch (Exception again) {
                        break;
                    }
                    String json = new String(answer.getData(), answer.getOffset(), answer.getLength(), StandardCharsets.UTF_8);
                    if (!json.startsWith("{")) {
                        continue;
                    }
                    try {
                        JSONObject payload = new JSONObject(json);
                        if (!PRODUCT.equals(payload.optString("product", "")) && !SERVICE.equals(payload.optString("service", ""))) {
                            continue;
                        }
                        String host = answer.getAddress().getHostAddress();
                        JSONObject ports = payload.optJSONObject("ports");
                        int httpPort = ports != null ? ports.optInt("http", 0) : 0;
                        if (httpPort > 0) {
                            portsOut.add(httpPort);
                            if (ports.optInt("bridge", 0) > 0) {
                                portsOut.add(ports.optInt("bridge"));
                            }
                        }
                        hostsOut.add(host);
                        responders.add(host);
                        found.add(candidate("http://" + host + ":" + (httpPort > 0 ? httpPort : port), host,
                                httpPort > 0 ? httpPort : port, "gateway", "udp", 0,
                                payload.optString("hostname", null), payload.optString("product", null),
                                payload.optString("service", null)));
                        Log.d(TAG, "UDP-Antwort von " + host + " → Port " + httpPort);
                    } catch (Exception badJson) {
                        Log.d(TAG, "UDP-Antwort unlesbar: " + badJson);
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "UDP-Discovery nicht möglich: " + e);
        } finally {
            if (socket != null) {
                socket.close();
            }
        }
        return responders;
    }

    // -----------------------------------------------------------------------
    // HTTP-Probes
    // -----------------------------------------------------------------------
    private void httpProbe(List<String> hosts, List<Integer> ports, long perProbeMs, long budgetMs, List<JSObject> found) {
        Set<String> seen = Collections.synchronizedSet(new LinkedHashSet<>());
        int workers = hosts.size() > 24 ? 24 : 6;
        ExecutorService pool = Executors.newFixedThreadPool(workers);
        List<Callable<Void>> jobs = new ArrayList<>();
        for (String host : hosts) {
            for (Integer port : ports) {
                final String base = "http://" + host + ":" + port;
                jobs.add(() -> {
                    long t0 = System.currentTimeMillis();
                    String keyGateway = "gateway:" + base;
                    if (!seen.contains(keyGateway)) {
                        JSONObject status = probe(base, "/status", perProbeMs, null);
                        if (isOurs(status)) {
                            seen.add(keyGateway);
                            found.add(fromJson(base, host, port, "gateway", "http", status, (int) (System.currentTimeMillis() - t0)));
                            JSONObject nested = status != null ? status.optJSONObject("ports") : null;
                            int bridge = nested != null ? nested.optInt("bridge", 0) : 0;
                            if (bridge > 0 && bridge != port) {
                                String bridgeBase = "http://" + host + ":" + bridge;
                                if (!seen.contains("bridge:" + bridgeBase)) {
                                    seen.add("bridge:" + bridgeBase);
                                    found.add(fromJson(bridgeBase, host, bridge, "bridge", "http", status, (int) (System.currentTimeMillis() - t0)));
                                }
                            }
                        }
                    }
                    String keyBridge = "bridge:" + base;
                    if (!seen.contains(keyBridge)) {
                        long t1 = System.currentTimeMillis();
                        JSONObject health = probe(base, "/mcp/health", perProbeMs, null);
                        if (isBridge(health)) {
                            seen.add(keyBridge);
                            found.add(fromJson(base, host, port, "bridge", "http", health, (int) (System.currentTimeMillis() - t1)));
                        }
                    }
                    return null;
                });
            }
        }
        try {
            List<Future<Void>> futures = pool.invokeAll(jobs, Math.max(600, budgetMs), TimeUnit.MILLISECONDS);
            for (Future<Void> future : futures) {
                try {
                    future.get(50, TimeUnit.MILLISECONDS);
                } catch (Exception ignored) {
                    // Timeout/Abbruch eines Probes: übrige Treffer zählen trotzdem
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            pool.shutdownNow();
        }
        synchronized (found) {
            found.sort((a, b) -> Integer.compare(a.optInt("latencyMs", 9999), b.optInt("latencyMs", 9999)));
        }
    }

    /** GET mit kurzem Timeout; gibt geparstes JSON zurück oder null. */
    private JSONObject probe(String base, String path, long timeoutMs, JSObject meta) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(base + path).openConnection();
            conn.setConnectTimeout((int) Math.max(120, timeoutMs));
            conn.setReadTimeout((int) Math.max(120, timeoutMs));
            conn.setRequestProperty("accept", "application/json");
            conn.setRequestProperty("user-agent", USER_AGENT);
            conn.setInstanceFollowRedirects(true);
            conn.connect();
            if (meta != null) {
                meta.put("status", conn.getResponseCode());
            }
            if (conn.getResponseCode() >= 400) {
                return null;
            }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream in = conn.getInputStream()) {
                byte[] chunk = new byte[4096];
                int read;
                int total = 0;
                while ((read = in.read(chunk)) > 0 && total < 200_000) {
                    bytes.write(chunk, 0, read);
                    total += read;
                }
            }
            return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
        } catch (Exception e) {
            if (meta != null) {
                meta.put("detail", e.getClass().getSimpleName() + ": " + e.getMessage());
            }
            return null;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private boolean isOurs(JSONObject json) {
        if (json == null) {
            return false;
        }
        return PRODUCT.equals(json.optString("product", "")) || GATEWAY_SERVICE.equals(json.optString("service", ""));
    }

    private boolean isBridge(JSONObject json) {
        if (json == null) {
            return false;
        }
        // mcp/bridge.mjs antwortet auf /mcp/health mit:
        //   { ok, bridge: "dingelschwing-mcp-bridge/1.0.0", port, mcp: { connected, tools } }
        if (json.optString("bridge", "").startsWith("dingelschwing-mcp-bridge")) {
            return true;
        }
        JSONObject mcp = json.optJSONObject("mcp");
        return mcp != null && mcp.has("tools");
    }

    private JSObject fromJson(String base, String host, int port, String kind, String via, JSONObject json, int latencyMs) {
        String hostname = json != null ? json.optString("hostname", null) : null;
        String product = json != null ? json.optString("product", null) : null;
        String service = json != null ? json.optString("service", null) : null;
        return candidate(base, host, port, kind, via, latencyMs, hostname, product, service);
    }

    private JSObject candidate(String base, String host, int port, String kind, String via, int latencyMs,
                              String hostname, String product, String service) {
        JSObject item = new JSObject();
        item.put("base", base);
        item.put("host", host);
        item.put("port", port);
        item.put("kind", kind);
        item.put("via", via);
        item.put("latencyMs", latencyMs);
        if (hostname != null && !"null".equals(hostname)) {
            item.put("hostname", hostname);
        }
        if (product != null && !"null".equals(product)) {
            item.put("product", product);
        }
        if (service != null && !"null".equals(service)) {
            item.put("service", service);
        }
        return item;
    }

    // -----------------------------------------------------------------------
    // Netz-Werkzeug
    // -----------------------------------------------------------------------
    private List<String> localIPv4s() {
        List<String> ips = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> nics = NetworkInterface.getNetworkInterfaces();
            while (nics != null && nics.hasMoreElements()) {
                NetworkInterface nic = nics.nextElement();
                if (!nic.isUp() || nic.isLoopback()) {
                    continue;
                }
                Enumeration<InetAddress> addresses = nic.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress addr = addresses.nextElement();
                    String text = addr.getHostAddress();
                    if (text != null && text.indexOf(':') < 0 && !text.startsWith("169.254.")) {
                        ips.add(text);
                    }
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "lokale IPs nicht lesbar: " + e);
        }
        return ips;
    }

    private String primaryIpv4(List<String> ips) {
        for (String ip : ips) {
            if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.")) {
                return ip;
            }
        }
        return ips.isEmpty() ? null : ips.get(0);
    }
}
