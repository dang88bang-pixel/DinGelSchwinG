/**
 * BindWizard – modaler Assistent zum manuellen Binden von Geräten.
 *
 * Schritt 1: Protokoll wählen (SSH/HTTP/BLE/Bluetooth/Ping/Seriell)
 * Schritt 2: protokoll-spezifische Felder (IP, MAC, Benutzername, Port…)
 * Bindung über POST /api/devices/bind (bei SSH wird "host:port:user:pass"
 * als kompakte Ziel-Adresse übergeben – gleiches Format wie Terminal-Bridge).
 */
import { useState } from 'react';
import { X, ChevronRight, ChevronLeft, Check, Loader2, Plus } from 'lucide-react';
import { api } from '../lib/api/client';

interface BindWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ProtocolOption {
  value: string;
  label: string;
  emoji: string;
  fields: Array<'ip' | 'mac' | 'username' | 'password' | 'port' | 'model'>;
}

const PROTOCOL_OPTIONS: ProtocolOption[] = [
  { value: 'ssh', label: 'SSH (Linux/Server)', emoji: '🖥️', fields: ['ip', 'username', 'password', 'port'] },
  { value: 'http', label: 'HTTP/HTTPS (Fritzbox, Shelly, Tasmota)', emoji: '🌐', fields: ['ip', 'username', 'password'] },
  { value: 'ble', label: 'BLE (Kopfhörer, Sensoren)', emoji: '🎧', fields: ['mac', 'model'] },
  { value: 'bluetooth', label: 'Bluetooth Classic (Musikboxen)', emoji: '🔊', fields: ['mac', 'model'] },
  { value: 'ping', label: 'Ping (Smartphone, Drucker)', emoji: '📱', fields: ['ip'] },
  { value: 'serial', label: 'Seriell (USB-Dongle)', emoji: '🔌', fields: ['ip'] },
];

export default function BindWizard({ isOpen, onClose, onSuccess }: BindWizardProps) {
  const [step, setStep] = useState(1);
  const [protocol, setProtocol] = useState('ssh');
  const [alias, setAlias] = useState('');
  const [ip, setIp] = useState('');
  const [mac, setMac] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [port, setPort] = useState('');
  const [model, setModel] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const current = PROTOCOL_OPTIONS.find((p) => p.value === protocol)!;
  const has = (f: ProtocolOption['fields'][number]) => current.fields.includes(f);

  const reset = () => {
    setStep(1); setProtocol('ssh'); setAlias(''); setIp(''); setMac('');
    setUsername(''); setPassword(''); setPort(''); setModel(''); setError(null);
  };

  const handleSubmit = async () => {
    if (!alias.trim()) { setError('Bitte einen Namen (Alias) angeben.'); return; }
    setIsLoading(true); setError(null);
    try {
      // Adresse je Protokoll: SSH kompakt als host:port:user:pass
      let address = '';
      if (protocol === 'ssh') {
        address = `${ip}:${port || '22'}:${username}:${password}`;
      } else if (protocol === 'ble' || protocol === 'bluetooth') {
        address = mac;
      } else {
        address = ip;
      }
      const nodeId = `manual:${protocol}:${Date.now()}`;
      const res = await api.deviceBind(nodeId, alias.trim(), protocol, address);
      if (!res.ok) {
        setError(`Bindung fehlgeschlagen: ${String(res.error ?? 'unbekannt')}`);
        return;
      }
      onSuccess();
      onClose();
      reset();
    } catch (e) {
      setError(`⚠️ ${String(e)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNext = () => {
    if (step === 1) setStep(2);
    else handleSubmit();
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#050a18] border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-white/10">
          <h2 className="text-base font-black text-white flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white text-sm"><Plus className="w-4 h-4" /></span>
            Gerät manuell binden
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition" aria-label="Schließen">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {/* Steps */}
          <div className="flex justify-between mb-5 max-w-[240px]">
            {[1, 2].map((s) => (
              <div key={s} className={`flex items-center gap-2 ${step >= s ? 'text-cyan-300' : 'text-slate-600'}`}>
                <span className="w-6 h-6 rounded-full border-2 border-current flex items-center justify-center text-xs font-black">{s}</span>
                <span className="text-xs font-bold">{s === 1 ? 'Protokoll' : 'Daten'}</span>
              </div>
            ))}
          </div>

          {/* Step 1: Protokoll */}
          {step === 1 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-400 mb-3">Wähle den Gerätetyp / das Protokoll:</p>
              {PROTOCOL_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setProtocol(p.value)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs font-bold transition ${
                    protocol === p.value
                      ? 'border-cyan-500/60 bg-cyan-950/40 text-cyan-100'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <span className="mr-2">{p.emoji}</span>{p.label}
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Daten */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[11px] font-mono text-cyan-300 bg-cyan-950/30 border border-cyan-800/30 rounded-lg px-3 py-2">
                <span className="text-base">{current.emoji}</span> {current.label}
              </div>
              <Field label="Name (Alias)" value={alias} onChange={setAlias} placeholder="z.B. Wohnzimmer-Box" required />
              {has('ip') && <Field label="IP-Adresse" value={ip} onChange={setIp} placeholder="192.168.178.x" />}
              {has('mac') && <Field label="MAC-Adresse" value={mac} onChange={setMac} placeholder="AA:BB:CC:DD:EE:FF" mono />}
              {has('username') && <Field label="Benutzername" value={username} onChange={setUsername} placeholder="admin" />}
              {has('password') && (
                <Field label="Passwort" value={password} onChange={setPassword} password
                  hint="wird als Teil der Ziel-Adresse (host:port:user:pass) hinterlegt" />
              )}
              {has('port') && <Field label="Port (optional)" value={port} onChange={setPort} placeholder="22" />}
              {has('model') && <Field label="Modell (optional)" value={model} onChange={setModel} placeholder="z.B. Sony WH-1000XM4" />}
              {error && <div className="text-[11px] font-mono text-rose-300">⚠️ {error}</div>}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-6 pt-4 border-t border-white/10">
            <button
              onClick={() => setStep(Math.max(1, step - 1))}
              disabled={step === 1}
              className="text-xs text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition"
            >
              <ChevronLeft className="w-4 h-4" /> Zurück
            </button>
            <button
              onClick={handleNext}
              disabled={isLoading || (step === 2 && !alias.trim())}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 text-white text-xs font-extrabold hover:brightness-110 transition disabled:opacity-40"
            >
              {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Wird gebunden…</>
                : step === 2 ? <><Check className="w-4 h-4" /> Binden</>
                : <>Weiter <ChevronRight className="w-4 h-4" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, required, mono, password, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; mono?: boolean; password?: boolean; hint?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] text-slate-400 mb-1">{label}{required && ' *'}</label>
      <input
        type={password ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-slate-900/70 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-400/50 ${mono ? 'font-mono' : ''}`}
      />
      {hint && <div className="text-[10px] font-mono text-slate-600 mt-0.5">{hint}</div>}
    </div>
  );
}
