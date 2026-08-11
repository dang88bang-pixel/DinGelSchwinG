/**
 * NEXUS-BUILDER v2.2 — useTerminal Hook
 * Verwaltet xterm.js-Terminal + TerminalSessionClient + RBAC-Actions.
 */
import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { TerminalSessionClient } from "../infrastructure/terminalSession";
import { AccessTarget } from "../domain/types";
import { requireAction, Role } from "../domain/rbac";
import { buildTerminalWsUrl } from "../infrastructure/deviceAccess";

export interface UseTerminalArgs {
  token: string;
  target: AccessTarget;
  wsBase: string;
  minRole?: Role; // default SERVICE
  idleTimeoutMs?: number;
  /** WebAuthn-Grant-Token (wa_token) für L3+/L5-Aktionen (dongle/network). */
  waToken?: string;
}

export function useTerminal({ token, target, wsBase, minRole = Role.SERVICE, idleTimeoutMs = 10 * 60_000, waToken }: UseTerminalArgs) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const sessionRef = useRef<TerminalSessionClient | null>(null);

  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;

    // 1. RBAC: Aktion abhängig vom Ziel verlangen.
    const action =
      target.kind === "network" ? "terminal.network.ssh" : target.kind === "dongle" ? "terminal.dongle.flash" : "terminal.interactive";
    try {
      requireAction(token, action);
    } catch (e) {
      if (el) el.innerHTML = `<div class="p-4 text-red-600">Zugriff verweigert (${(e as Error).message})</div>`;
      return;
    }

    // 2. Terminal aufsetzen
    const term = new Terminal({ cursorBlink: true, scrollback: 5000, fontSize: 13, theme: { background: "#0b0f14", foreground: "#d6dde6" } });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    fit.fit();

    // 3. Session-Client + Attach-Addon (wa_token für WebAuthn-geschützte Ziele)
    const url = buildTerminalWsUrl(wsBase, target, token, waToken);
    const client = new TerminalSessionClient({
      url,
      target,
      token,
      idleTimeoutMs,
      onData: (d) => term.write(d),
      onError: (err) => term.writeln(`\x1b[31m[System] ${err.message}\x1b[0m`),
      onClose: (reason) => term.writeln(`\x1b[33m[Session beendet: ${reason}]\x1b[0m`),
    });
    sessionRef.current = client;
    void client.connect();

    // Attachment: xterm schreibt Input direkt via send(); wir bündeln über den Client.
    // AttachAddon erwartet eine raw WebSocket — für sauberes JSON nutzen wir onData-Bridge manuell:
    term.onData((data) => {
      try {
        client.send(data);
      } catch (e) {
        term.writeln(`\x1b[31m${(e as Error).message}\x1b[0m`);
      }
    });

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);

    // Cleanup: Session schließen, Interlock-safe
    return () => {
      window.removeEventListener("resize", onResize);
      sessionRef.current?.terminate("unmount");
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, target, wsBase, minRole]);

  return { terminalRef };
}
