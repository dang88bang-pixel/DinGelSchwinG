/**
 * AdminHub – Verwaltungszentrale (Vollbild-Overlay) mit 4 Tabs:
 *  – Benutzer (RBAC: anlegen/löschen, Rollen guest…emergency)
 *  – Audit-Log (Filter + Trace-ID, Compliance)
 *  – SSH-Key (privaten Schlüssel hinterlegen – wird von der Terminal-Bridge
 *    für SSH-Sessions verwendet)
 *  – WebAuthn (FIDO2-Sicherheitsschlüssel registrieren/verwalten – für
 *    kritische L3+-Aktionen erforderlich)
 */
import { useCallback, useEffect, useState } from 'react';
import { X, Users, ScrollText, KeyRound, ShieldCheck, RefreshCw, Plus, Trash2, Loader2, CheckCircle2, AlertTriangle, SlidersHorizontal, Gauge, Search, RotateCcw } from 'lucide-react';
import { api } from '../lib/api/client';

type TabKey = 'users' | 'audit' | 'ssh' | 'webauthn' | 'rbac' | 'system';

const ROLE_OPTIONS = ['guest', 'operator', 'service', 'developer', 'expert', 'emergency', 'admin'];

function TabBar({ tab, setTab }: { tab: TabKey; setTab: (t: TabKey) => void }) {
  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    { key: 'users', label: 'Benutzer', icon: <Users className="w-3.5 h-3.5" /> },
    { key: 'audit', label: 'Audit-Log', icon: <ScrollText className="w-3.5 h-3.5" /> },
    { key: 'ssh', label: 'SSH-Key', icon: <KeyRound className="w-3.5 h-3.5" /> },
    { key: 'webauthn', label: 'WebAuthn', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { key: 'rbac', label: 'RBAC-Matrix', icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
    { key: 'system', label: 'System', icon: <Gauge className="w-3.5 h-3.5" /> },
  ];
  return (
    <nav className="px-4 pt-3 flex gap-1.5 overflow-x-auto border-b border-white/5 bg-[#050a18]/60">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => setTab(t.key)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-t-xl text-[11px] font-bold border-b-2 transition whitespace-nowrap ${
            tab === t.key ? 'border-cyan-400 text-cyan-100 bg-white/5' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}>
          {t.icon}{t.label}
        </button>
      ))}
    </nav>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<Array<{ username: string; role: string; source: string }>>([]);
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState('service');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setUsers(await api.adminUsers()); setError(null); }
    catch (e) { setError(String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setMsg(null); setError(null);
    const res = await api.adminCreateUser(name.trim(), pw, role);
    if (res.ok) {
      setMsg(`✅ Nutzer '${res.username}' angelegt (${role})`);
      setName(''); setPw('');
      await load();
    } else {
      setError(res.error ?? 'Anlegen fehlgeschlagen');
    }
  };

  const remove = async (username: string) => {
    const res = await api.adminDeleteUser(username);
    if (res.ok) { setMsg(`🗑️ '${username}' gelöscht`); await load(); }
    else setError(res.error ?? 'Löschen fehlgeschlagen');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
        <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
          <Plus className="w-3.5 h-3.5 text-cyan-300" /> Neuer Benutzer (RBAC)
        </h4>
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Benutzername"
            className="bg-slate-900/70 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-100 outline-none focus:border-cyan-400/50 flex-1 min-w-[140px]" />
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Passwort (min. 8)"
            className="bg-slate-900/70 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-100 outline-none focus:border-cyan-400/50 flex-1 min-w-[140px]" />
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="bg-slate-900/70 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-100 outline-none [&>option]:bg-slate-900">
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={create} disabled={!name.trim() || pw.length < 8}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 text-white text-[11px] font-extrabold hover:brightness-110 transition disabled:opacity-40">
            <Plus className="w-3 h-3" /> Anlegen
          </button>
        </div>
        {msg && <div className="mt-2 text-[11px] font-mono text-emerald-300">{msg}</div>}
        {error && <div className="mt-2 text-[11px] font-mono text-rose-300">⚠️ {error}</div>}
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-black text-white">Benutzer ({users.length})</h4>
          <button onClick={load} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition" title="Neu laden">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-1.5">
          {users.map((u) => (
            <div key={u.username} className="flex items-center gap-2 rounded-xl border border-white/5 bg-slate-900/50 px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-[12px] font-bold text-slate-100 flex-1">{u.username}</span>
              <span className="text-[10px] font-black text-cyan-300 border border-cyan-700/40 bg-cyan-950/40 px-2 py-0.5 rounded-full">{u.role}</span>
              <span className="text-[9px] font-mono text-slate-500">{u.source === 'env' ? 'ENV' : 'DB'}</span>
              {u.source !== 'env' && (
                <button onClick={() => remove(u.username)} className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 transition" title="Löschen">
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          {users.length === 0 && <div className="text-[11px] text-slate-500 italic">Keine Benutzer.</div>}
        </div>
      </div>
    </div>
  );
}

function AuditTab() {
  const [logs, setLogs] = useState<Array<{ ts: string; user: string; role: string; action: string; detail: string; critical?: boolean; trace_id: string }>>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query = '') => {
    setBusy(true); setError(null);
    try { setLogs(await api.auditLogs(query)); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    const header = 'ts,user,role,action,detail,critical,trace_id';
    const rows = logs.map((l) =>
      `${l.ts},${l.user},${l.role},${l.action},"${l.detail.replace(/"/g, '""')}",${l.critical ? 1 : 0},${l.trace_id}`);
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'audit.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(q)}
          placeholder="Filtern nach User, Aktion, Detail oder Trace-ID… (Enter)"
          className="flex-1 bg-slate-900/70 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-100 outline-none focus:border-cyan-400/50" />
        <button onClick={() => load(q)} disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 text-[11px] font-extrabold transition disabled:opacity-40">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Filtern
        </button>
        <button onClick={exportCsv}
          className="px-4 py-2 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 text-white text-[11px] font-extrabold hover:brightness-110 transition">
          CSV-Export
        </button>
      </div>
      {error && <div className="text-[11px] font-mono text-rose-300">⚠️ {error}</div>}
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 overflow-hidden">
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-[11px] font-mono">
            <thead className="bg-slate-900/80 sticky top-0">
              <tr className="text-slate-400 text-left">
                <th className="px-3 py-2">Zeit</th><th>User</th><th>Rolle</th><th>Aktion</th><th>Detail</th><th>Trace-ID</th><th>Kritisch</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={i} className={`border-t border-white/5 ${l.critical ? 'bg-rose-950/20' : i % 2 ? 'bg-slate-900/30' : ''}`}>
                  <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{l.ts}</td>
                  <td className="text-cyan-300">{l.user}</td>
                  <td className="text-slate-400">{l.role}</td>
                  <td className="text-violet-300 whitespace-nowrap">{l.action}</td>
                  <td className="text-slate-300 max-w-[260px] truncate">{l.detail}</td>
                  <td className="text-slate-500 text-[10px]">{l.trace_id}</td>
                  <td>{l.critical ? <AlertTriangle className="w-3 h-3 text-rose-300" /> : ''}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Keine Audit-Einträge.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-[10px] font-mono text-slate-500">
        {logs.length} Einträge · manipulationssicher · jeder Schritt mit Nutzer-ID, Zeitstempel und Trace-ID
      </div>
    </div>
  );
}

function SshKeyTab() {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<{ configured: boolean; path: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.sshKeyStatus().then(setStatus).catch(() => setStatus({ configured: false, path: '' }));
  }, []);

  const upload = async () => {
    if (!key.includes('PRIVATE KEY')) { setError('Bitte einen privaten Schlüssel im PEM-Format einfügen'); return; }
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await api.sshKeyUpload(key);
      if (res.ok) { setMsg('✅ SSH-Key hinterlegt – Terminal-Bridge nutzt ihn jetzt für SSH-Sessions'); setKey(''); }
      else setError(res.error ?? 'Upload fehlgeschlagen');
      setStatus(await api.sshKeyStatus());
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
        <h4 className="text-xs font-black text-white mb-2 flex items-center gap-2">
          <KeyRound className="w-3.5 h-3.5 text-amber-300" /> SSH-Authentifizierung
          <span className={`ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full border ${
            status?.configured ? 'text-emerald-300 border-emerald-700/40 bg-emerald-950/40' : 'text-amber-300 border-amber-700/40 bg-amber-950/40'
          }`}>
            {status?.configured ? '● konfiguriert' : '○ nicht hinterlegt'}
          </span>
        </h4>
        <p className="text-[10px] font-mono text-slate-500 mb-3">
          Der private Schlüssel wird serverseitig abgelegt (chmod 600) und von der Terminal-Bridge für SSH-Sessions
          verwendet – <b>kein stiller Passwort-Fallback mehr</b>. Ziel-Format im Terminal: host:port:user
        </p>
        {status?.path && <div className="text-[9px] font-mono text-slate-600 mb-2">Pfad: {status.path}</div>}
        <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={8}
          placeholder="-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----"
          className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-mono text-emerald-200 outline-none focus:border-amber-400/50 resize-y" spellCheck={false} />
        <button onClick={upload} disabled={busy || !key.trim()}
          className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-br from-amber-600 to-orange-700 text-white text-[11px] font-extrabold hover:brightness-110 transition disabled:opacity-40">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />} Schlüssel speichern
        </button>
        {msg && <div className="mt-2 text-[11px] font-mono text-emerald-300 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{msg}</div>}
        {error && <div className="mt-2 text-[11px] font-mono text-rose-300">⚠️ {error}</div>}
      </div>
    </div>
  );
}

function WebAuthnTab() {
  const [creds, setCreds] = useState<{ credentials: Array<{ credentialId: string; deviceName: string; registeredAt: string }>; required: boolean }>({ credentials: [], required: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setCreds(await api.webauthnCredentials()); } catch { /* offline */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const register = async () => {
    setBusy(true); setMsg(null); setError(null);
    try {
      const ch = await api.webauthnRegisterChallenge();
      const challengeBytes = Uint8Array.from(atob(ch.challenge_b64), (c) => c.charCodeAt(0));
      const userIdBytes = Uint8Array.from(atob(ch.user_id_b64), (c) => c.charCodeAt(0));
      // Echte Browser-WebAuthn-API (Passkey/FIDO2)
      const options: PublicKeyCredentialCreationOptions = {
        challenge: challengeBytes,
        rp: { name: ch.rp },
        user: { id: userIdBytes, name: ch.username, displayName: ch.username },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        authenticatorSelection: { authenticatorAttachment: 'platform', requireResidentKey: false, userVerification: 'preferred' },
        timeout: 60000,
      };
      const credential = await navigator.credentials.create({
        publicKey: options,
      } as unknown as CredentialCreationOptions);
      const id = (credential as PublicKeyCredential).id;
      const res = await api.webauthnRegister(id, 'Passkey (Browser)');
      if (res.ok) {
        setMsg('✅ Sicherheitsschlüssel registriert – kritische L3+-Aktionen sind jetzt 2FA-geschützt');
        await load();
      } else setError(res.error ?? 'Registrierung fehlgeschlagen');
    } catch (e) {
      // Browser ohne WebAuthn-Support → klarer Hinweis (Registrierung direkt am Host möglich)
      setError(`WebAuthn im Browser nicht verfügbar: ${String(e)}`);
    } finally { setBusy(false); }
  };

  const remove = async (credentialId: string) => {
    await api.webauthnDelete(credentialId);
    setMsg('🗑️ Schlüssel entfernt');
    await load();
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
        <h4 className="text-xs font-black text-white mb-2 flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-yellow-300" /> FIDO2 / Passkey
          <span className={`ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full border ${
            creds.required ? 'text-amber-300 border-amber-700/40 bg-amber-950/40' : 'text-emerald-300 border-emerald-700/40 bg-emerald-950/40'
          }`}>
            {creds.required ? 'erforderlich für kritische Aktionen' : 'optional'}
          </span>
        </h4>
        <p className="text-[10px] font-mono text-slate-500 mb-3">
          Registriere deinen Sicherheitsschlüssel, bevor du kritische Aktionen (Mesh löschen, Konfiguration
          überschreiben, Fehlersimulation) ausführst – sonst antwortet das Backend mit 428.
        </p>
        <button onClick={register} disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-br from-yellow-600 to-amber-700 text-white text-[11px] font-extrabold hover:brightness-110 transition disabled:opacity-40">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
          FIDO2 / Passkey registrieren
        </button>
        {msg && <div className="mt-2 text-[11px] font-mono text-emerald-300 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{msg}</div>}
        {error && <div className="mt-2 text-[11px] font-mono text-rose-300">⚠️ {error}</div>}
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
        <h4 className="text-xs font-black text-white mb-3">Registrierte Schlüssel ({creds.credentials.length})</h4>
        <div className="space-y-1.5">
          {creds.credentials.map((c) => (
            <div key={c.credentialId} className="flex items-center gap-2 rounded-xl border border-white/5 bg-slate-900/50 px-3 py-2">
              <ShieldCheck className="w-3.5 h-3.5 text-yellow-300" />
              <span className="text-[12px] font-bold text-slate-100 flex-1">{c.deviceName}</span>
              <span className="text-[9px] font-mono text-slate-500 truncate max-w-[140px]">{c.credentialId}</span>
              <span className="text-[9px] font-mono text-slate-500">{c.registeredAt}</span>
              <button onClick={() => remove(c.credentialId)} className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 transition">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {creds.credentials.length === 0 && <div className="text-[11px] text-slate-500 italic">Keine Schlüssel registriert.</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RBAC-Matrix-Tab (Closed-Loop #1): Checkboxen wirken LIVE auf die
// tatsächliche Backend-Autorisierung (PATCH /api/admin/rbac, WebAuthn-geschützt)
// ---------------------------------------------------------------------------
const FEATURE_LABELS: Record<string, string> = {
  ble_discovery: 'BLE-Discovery (bleak + virtuelle Peripherals)',
  network_arp: 'ARP-/Netzwerk-Scan + HTTP-Probe (Fritzbox, Drucker…)',
  usb_dongle: 'USB-Dongle-Enumeration',
  ssh_server: 'SSH-Server (:2222, Terminal-Ziel)',
};

function RbacTab() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminRbac>> | null>(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.adminRbac()); setError(null); }
    catch (e) { setError(String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (action: string, role: string, current: boolean) => {
    setBusy(true); setMsg(null); setError(null);
    try {
      const res = await api.adminRbacSet(action, role, !current);
      if (res.ok) {
        setMsg(`✅ ${action} / ${role} → ${!current ? 'erlaubt' : 'gesperrt'} (wirkt sofort im Backend)`);
        await load();
      }
    } catch (e) { setError(`⚠️ ${String(e)}`); }
    finally { setBusy(false); }
  };

  const resetAction = async (action: string) => {
    setBusy(true); setMsg(null); setError(null);
    try {
      for (const role of data?.roles ?? []) {
        await api.adminRbacReset(action, role).catch(() => undefined);
      }
      setMsg(`↩️ ${action}: alle Overrides zurückgesetzt (Default-Matrix)`);
      await load();
    } catch (e) { setError(`⚠️ ${String(e)}`); }
    finally { setBusy(false); }
  };

  if (!data) {
    return <div className="text-[11px] text-slate-500">Lade RBAC-Matrix…</div>;
  }
  const filtered = data.actions.filter((a) => a.includes(q.toLowerCase()));
  const overridden = (action: string, role: string) =>
    data.overrides[action]?.[role] !== undefined;

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Aktion filtern… (z. B. ble_connect, config_write)"
            className="w-full bg-slate-900/70 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-[11px] text-slate-100 outline-none focus:border-cyan-400/50" />
        </div>
        <span className="text-[10px] font-mono text-slate-500">
          {data.actions.length} Aktionen · {data.roles.length} Rollen · Live-Wirkung im Backend
        </span>
      </div>
      {msg && <div className="text-[11px] font-mono text-emerald-300 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{msg}</div>}
      {error && <div className="text-[11px] font-mono text-rose-300">⚠️ {error}</div>}
      {busy && <div className="text-[10px] font-mono text-cyan-300 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> warte auf WebAuthn-Bestätigung…</div>}

      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 overflow-hidden">
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-[11px] font-mono">
            <thead className="bg-slate-900/80 sticky top-0 z-10">
              <tr className="text-slate-400 text-left">
                <th className="px-3 py-2">Aktion</th>
                {data.roles.map((r) => (
                  <th key={r} className="px-2 py-2 text-center text-[10px]">{r}</th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((action) => {
                const hasOverride = data.roles.some((r) => overridden(action, r));
                return (
                  <tr key={action} className={`border-t border-white/5 ${hasOverride ? 'bg-cyan-950/20' : ''}`}>
                    <td className="px-3 py-1.5 text-violet-300 whitespace-nowrap" title={`Mindestlevel: ${data.defaults[action]}`}>
                      {action} <span className="text-slate-600">L{data.defaults[action]}</span>
                    </td>
                    {data.roles.map((role) => {
                      const allowed = data.matrix[action]?.[role] ?? false;
                      const isOverride = overridden(action, role);
                      return (
                        <td key={role} className="px-2 py-1.5 text-center">
                          <button
                            onClick={() => toggle(action, role, allowed)}
                            disabled={busy}
                            title={isOverride ? `Override (${allowed ? 'erlaubt' : 'gesperrt'}) – klicken zum Ändern` : `Default (${allowed ? 'erlaubt' : 'gesperrt'}) – klicken zum Override`}
                            className={`w-4 h-4 rounded inline-block align-middle transition border disabled:opacity-40 ${
                              allowed
                                ? 'bg-emerald-500/80 border-emerald-400'
                                : 'bg-slate-800 border-slate-600'
                            } ${isOverride ? 'ring-2 ring-amber-400/60' : ''}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-center">
                      {hasOverride && (
                        <button onClick={() => resetAction(action)} disabled={busy}
                          className="p-1 rounded bg-slate-800 hover:bg-amber-900/50 text-slate-400 hover:text-amber-300 transition" title="Alle Overrides dieser Aktion zurücksetzen">
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={data.roles.length + 2} className="px-3 py-6 text-center text-slate-500">Keine Aktion gefunden.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-[10px] font-mono text-slate-500 flex items-center gap-3">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/80 inline-block" /> erlaubt</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-800 border border-slate-600 inline-block" /> gesperrt</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded ring-2 ring-amber-400/60 bg-emerald-500/80 inline-block" /> UI-Override (wirkt live)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System-Tab (Closed-Loop #2 + #5): Feature-Toggles + Live-Metriken
// ---------------------------------------------------------------------------
function SystemTab() {
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof api.metricsLive>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadFeatures = useCallback(async () => {
    try { const res = await api.systemFeatures(); setFeatures(res.features); } catch { /* offline */ }
  }, []);
  const loadMetrics = useCallback(async () => {
    try { setMetrics(await api.metricsLive()); } catch { /* offline */ }
  }, []);
  useEffect(() => { loadFeatures(); }, [loadFeatures]);
  useEffect(() => {
    loadMetrics();
    const id = window.setInterval(loadMetrics, 2000);
    return () => window.clearInterval(id);
  }, [loadMetrics]);

  const toggleFeature = async (key: string, enabled: boolean) => {
    setBusy(true); setMsg(null); setError(null);
    try {
      const res = await api.systemFeaturesPatch({ [key]: !enabled });
      if (res.ok) {
        setFeatures(res.features);
        setMsg(`✅ Feature '${key}' → ${!enabled ? 'AKTIV' : 'GESTOPPT'} – Hintergrund-Task real geschaltet`);
      }
    } catch (e) { setError(`⚠️ ${String(e)}`); }
    finally { setBusy(false); }
  };

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="space-y-3">
        <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
          <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-300" /> Background-Services (Feature-Toggles)
            <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full border border-amber-700/40 bg-amber-950/40 text-amber-300">WebAuthn-geschützt</span>
          </h4>
          {msg && <div className="mb-2 text-[11px] font-mono text-emerald-300 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{msg}</div>}
          {error && <div className="mb-2 text-[11px] font-mono text-rose-300">⚠️ {error}</div>}
          {busy && <div className="mb-2 text-[10px] font-mono text-cyan-300 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> warte auf WebAuthn-Bestätigung…</div>}
          <div className="space-y-2">
            {Object.entries(FEATURE_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900/50 px-3 py-2">
                <button
                  onClick={() => toggleFeature(key, features?.[key] ?? false)}
                  disabled={busy || !features}
                  className={`relative w-10 h-5 rounded-full transition disabled:opacity-40 ${features?.[key] ? 'bg-emerald-500/80' : 'bg-slate-700'}`}
                  title={features?.[key] ? 'Anklicken → stoppen' : 'Anklicken → starten'}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${features?.[key] ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
                <span className="text-[11px] font-bold text-slate-100 flex-1">{label}</span>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${
                  features?.[key] ? 'text-emerald-300 border-emerald-700/40 bg-emerald-950/40' : 'text-rose-300 border-rose-700/40 bg-rose-950/40'
                }`}>{features?.[key] ? 'RUNNING' : 'STOPPED'}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] font-mono text-slate-500">
            Toggle schaltet die tatsächlichen Scan-/Server-Tasks des Hosts ab/an (persistiert in host/data/features.json).
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
          <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5 text-emerald-300" /> Live-Metriken (2s-Poll)
          </h4>
          {metrics ? (
            <div className="space-y-2 text-[11px] font-mono">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-900/60 border border-white/5 p-2.5">
                  <div className="text-[9px] text-slate-500 uppercase">CPU</div>
                  <div className="text-base font-black text-cyan-300">{metrics.cpu_percent ?? '--'}%</div>
                  <div className="h-1.5 rounded bg-slate-800 mt-1 overflow-hidden">
                    <div className="h-full bg-cyan-400 transition-all" style={{ width: `${Math.min(100, metrics.cpu_percent ?? 0)}%` }} />
                  </div>
                </div>
                <div className="rounded-xl bg-slate-900/60 border border-white/5 p-2.5">
                  <div className="text-[9px] text-slate-500 uppercase">RAM</div>
                  <div className="text-base font-black text-violet-300">{metrics.ram_percent ?? '--'}%</div>
                  <div className="h-1.5 rounded bg-slate-800 mt-1 overflow-hidden">
                    <div className="h-full bg-violet-400 transition-all" style={{ width: `${Math.min(100, metrics.ram_percent ?? 0)}%` }} />
                  </div>
                </div>
              </div>
              <div className="flex justify-between border-b border-white/5 py-1"><span className="text-slate-500">Uptime</span><b className="text-slate-100">{fmtUptime(metrics.uptime_s)}</b></div>
              <div className="flex justify-between border-b border-white/5 py-1"><span className="text-slate-500">Backend</span><b className="text-cyan-200">{metrics.backend}</b></div>
              <div className="flex justify-between border-b border-white/5 py-1"><span className="text-slate-500">BLE verbunden</span><b className="text-slate-100">{metrics.connected_devices}</b></div>
              <div className="flex justify-between border-b border-white/5 py-1"><span className="text-slate-500">Gebundene Geräte</span><b className="text-slate-100">{metrics.bound_devices}</b></div>
              <div className="flex justify-between border-b border-white/5 py-1"><span className="text-slate-500">Clients online</span><b className="text-slate-100">{metrics.clients_online}</b></div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 italic">Keine Live-Daten (Host offline).</div>
          )}
          {metrics && metrics.alerts.length > 0 && (
            <div className="mt-3 pt-2 border-t border-white/5">
              <div className="text-[9px] font-black uppercase tracking-wide text-rose-300 mb-1.5">Kritische Alerts (letzte 5)</div>
              <div className="space-y-1">
                {metrics.alerts.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-rose-200/90 bg-rose-950/30 rounded-lg px-2 py-1">
                    <AlertTriangle className="w-3 h-3 text-rose-300 shrink-0" />
                    <span className="text-slate-500">{a.ts.split('T')[1]}</span>
                    <span className="text-rose-200">{a.action}</span>
                    <span className="text-slate-400 truncate flex-1">{a.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminHub({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>('users');
  return (
    <div className="fixed inset-0 z-[100] bg-[#020617]/95 backdrop-blur-xl flex flex-col">
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-[#050a18]/90">
        <div className="flex items-center gap-2.5 mr-auto">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shadow-lg ring-1 ring-slate-400/30">
            <Users className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-black text-white leading-none">Admin &amp; Compliance</h2>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">RBAC · Audit · SSH-Key · WebAuthn</div>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition" aria-label="Schließen">
          <X className="w-4 h-4" />
        </button>
      </header>
      <TabBar tab={tab} setTab={setTab} />
      <main className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[1200px] mx-auto">
          {tab === 'users' && <UsersTab />}
          {tab === 'audit' && <AuditTab />}
          {tab === 'ssh' && <SshKeyTab />}
          {tab === 'webauthn' && <WebAuthnTab />}
          {tab === 'rbac' && <RbacTab />}
          {tab === 'system' && <SystemTab />}
        </div>
      </main>
    </div>
  );
}
