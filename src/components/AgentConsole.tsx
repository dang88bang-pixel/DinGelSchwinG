import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, X, Paperclip, Settings } from 'lucide-react';
import { AgentEngine, AgentMessage } from '../lib/agent/agentEngine';
import {
  MODE_LABELS, AgentMode, CHAT_SYSTEM_INSTRUCTION, ADB_SYSTEM_INSTRUCTION, BLE_SYSTEM_INSTRUCTION,
} from '../config/systemInstructions';
import { MODEL_ID, MODEL_SIZE_MB } from '../lib/agent/transformersBackend';

// ---------------------------------------------------------------------------
// Minimal-Markdown-Renderer: **fett**, *kursiv*, `code`, ```Blöcke```, Listen
// ---------------------------------------------------------------------------
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4) {
          return <b key={i}>{p.slice(2, -2)}</b>;
        }
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
          return (
            <code key={i} className="px-1.5 py-0.5 rounded bg-slate-950/80 text-cyan-300 font-mono text-[0.85em] border border-slate-700/50">
              {p.slice(1, -1)}
            </code>
          );
        }
        if (p.startsWith('*') && p.endsWith('*') && p.length > 2) {
          return <i key={i}>{p.slice(1, -1)}</i>;
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/);
  return (
    <div className="space-y-1 text-[13px] leading-relaxed break-words">
      {blocks.map((block, i) => {
        if (i % 2 === 1) {
          return (
            <pre key={i} className="bg-slate-950/90 border border-slate-700/50 rounded-lg p-2.5 text-[11px] font-mono text-cyan-200 overflow-x-auto whitespace-pre-wrap">
              {block.replace(/^\w+\n/, '')}
            </pre>
          );
        }
        return (
          <div key={i}>
            {block.split('\n').map((line, j) => {
              const trimmed = line.trim();
              if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
                return (
                  <div key={j} className="pl-3 flex gap-1.5">
                    <span className="text-slate-400">•</span>
                    <span>
                      <InlineText text={trimmed.replace(/^[-•]\s*/, '')} />
                    </span>
                  </div>
                );
              }
              return (
                <div key={j}>
                  <InlineText text={line} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentConsole – Chat-zentrierte Agenten-Steuerung (Overlay)
// ---------------------------------------------------------------------------
interface AgentConsoleProps {
  role?: string;
  onClose: () => void;
}

export default function AgentConsole({ role = 'admin', onClose }: AgentConsoleProps) {
  const engineRef = useRef<AgentEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AgentEngine(role);
  const engine = engineRef.current;

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState(engine.summary());
  const [modelStatus, setModelStatus] = useState(engine.backend.describe());
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const [buttons, setButtons] = useState(engine.buttons.map((b) => ({ ...b })));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modeDraft, setModeDraft] = useState<AgentMode>(engine.mode);
  const [instructionDraft, setInstructionDraft] = useState(engine.systemInstruction);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgId = useRef(1);

  const addMessage = useCallback((sender: AgentMessage['sender'], text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: msgId.current++,
        sender,
        text,
        time: new Date().toLocaleTimeString('de-DE'),
      },
    ]);
  }, []);

  // Willkommensnachricht
  useEffect(() => {
    addMessage(
      'system',
      'Willkommen bei der DinGelSchwinG Agent Console v3.0.\nIch steuere Geräte, Clients und Workflows per Chat.\nTippe „hilfe“, um meine Fähigkeiten zu sehen.',
    );
  }, [addMessage]);

  // Auto-Scroll bei neuen Nachrichten
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Status-Bar live
  useEffect(() => {
    const id = window.setInterval(() => setStatusText(engine.summary()), 2000);
    return () => window.clearInterval(id);
  }, [engine]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    addMessage('user', text);
    setBusy(true);
    try {
      const reply = await engine.ask(text);
      addMessage('agent', reply);
    } catch (e) {
      addMessage('agent', `⚠️ Fehler: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [input, busy, engine, addMessage]);

  const actionClick = useCallback(
    async (idx: number) => {
      const button = engine.getButton(idx);
      if (button.action === 'attach') {
        fileInputRef.current?.click();
        return;
      }
      addMessage('system', `▶️ Führe Aktion aus: ${button.desc || button.action}`);
      setBusy(true);
      try {
        const result = await engine.executeAction(idx);
        addMessage('system', result);
      } catch (e) {
        addMessage('system', `❌ Aktion fehlgeschlagen: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [engine, addMessage],
  );

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        addMessage('system', engine.attachFile(file.name, file.size));
      }
      e.target.value = '';
    },
    [engine, addMessage],
  );

  const loadModel = useCallback(async () => {
    setModelProgress(0);
    setModelStatus('Modell wird geladen…');
    try {
      await engine.backend.load((p) => setModelProgress(p));
      setModelStatus(engine.backend.describe());
      addMessage('system', `✅ ${MODEL_ID} (q4) ist einsatzbereit – der Agent antwortet jetzt frei.`);
    } catch (e) {
      setModelStatus(engine.backend.describe());
      addMessage('system', `⚠️ Modell konnte nicht geladen werden: ${String(e).slice(0, 200)}`);
    } finally {
      setModelProgress(null);
    }
  }, [engine, addMessage]);

  const refreshButtons = useCallback(() => {
    setButtons(engine.buttons.map((b) => ({ ...b })));
  }, [engine]);

  const bubbleClass = (sender: AgentMessage['sender']) => {
    if (sender === 'user') return 'bg-blue-950/80 border border-blue-700/40 self-end rounded-2xl rounded-br-sm';
    if (sender === 'agent') return 'bg-slate-800/80 border border-slate-700/40 self-start rounded-2xl rounded-bl-sm';
    return 'bg-emerald-950/50 border border-emerald-800/30 self-start rounded-xl';
  };

  const nameColor = (sender: AgentMessage['sender']) => {
    if (sender === 'user') return 'text-blue-300';
    if (sender === 'agent') return 'text-cyan-300';
    return 'text-emerald-300';
  };

  const senderName = (sender: AgentMessage['sender']) =>
    sender === 'user' ? 'Du' : sender === 'agent' ? 'Agent' : 'System';

  return (
    <div className="fixed inset-0 z-[100] bg-[#020617]/95 backdrop-blur-xl flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-[#050a18]/90">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xl">💬</span>
          <h2 className="text-lg font-black text-white truncate">Agent Console <span className="text-xs font-medium text-slate-500">v3.0 · {role}</span></h2>
        </div>

        <span className="hidden md:inline px-2 py-1 rounded-full text-[10px] font-black border border-violet-500/40 bg-violet-950/40 text-violet-300">
          {MODE_LABELS[engine.mode]}
        </span>

        <button
          onClick={loadModel}
          disabled={engine.backend.status === 'loading' || engine.backend.isReady()}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold border transition disabled:opacity-60 ${
            engine.backend.isReady()
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
              : 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/40'
          }`}
          title={`Lokales Modell laden (${MODEL_SIZE_MB} MB, einmalig)`}
        >
          <span className={engine.backend.isReady() ? '' : 'animate-pulse'}>🧠</span>
          <span className="hidden sm:inline max-w-[220px] truncate">{modelStatus}</span>
          <span className="sm:hidden">Modell</span>
          {modelProgress !== null && <span className="tabular-nums">{Math.round(modelProgress)}%</span>}
        </button>

        <button
          onClick={() => {
            setModeDraft(engine.mode);
            setInstructionDraft(engine.systemInstruction);
            setSettingsOpen(true);
          }}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition"
          title="Agent konfigurieren (Modus + Systemanweisung)"
        >
          <Settings className="w-4 h-4" />
        </button>

        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition"
          aria-label="Schließen"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      {/* Einstellungen: Modus + Systemanweisung */}
      {settingsOpen && (
        <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/70">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-cyan-300" /> Agent konfigurieren
              </h3>
              <button
                onClick={() => setSettingsOpen(false)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition"
                aria-label="Schließen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 block mb-1.5">
                  Modus
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(Object.keys(MODE_LABELS) as AgentMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setModeDraft(m);
                        setInstructionDraft(
                          m === engine.mode
                            ? engine.systemInstruction
                            : m === 'adb'
                              ? ADB_SYSTEM_INSTRUCTION
                              : m === 'ble'
                                ? BLE_SYSTEM_INSTRUCTION
                                : m === 'custom'
                                  ? engine.customInstruction || engine.systemInstruction
                                  : CHAT_SYSTEM_INSTRUCTION,
                        );
                      }}
                      className={`text-left px-3 py-2.5 rounded-xl border text-xs font-bold transition ${
                        modeDraft === m
                          ? 'border-cyan-500/60 bg-cyan-950/50 text-cyan-200'
                          : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 block mb-1.5">
                  Systemanweisung (editierbar)
                </label>
                <textarea
                  value={instructionDraft}
                  onChange={(e) => setInstructionDraft(e.target.value)}
                  rows={14}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-[11px] font-mono text-slate-200 leading-relaxed outline-none focus:border-cyan-500/60 resize-y"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-700/70">
              <button
                onClick={() => {
                  setInstructionDraft(
                    engine.mode === 'adb' ? ADB_SYSTEM_INSTRUCTION
                      : engine.mode === 'ble' ? BLE_SYSTEM_INSTRUCTION
                        : engine.mode === 'custom' ? '' : CHAT_SYSTEM_INSTRUCTION,
                  );
                }}
                className="px-3 py-2 rounded-xl text-[11px] font-bold text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 transition"
              >
                ↩️ Standard laden
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="px-4 py-2 rounded-xl text-[11px] font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-600 transition"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() => {
                    if (modeDraft !== engine.mode) {
                      engine.setMode(modeDraft);
                      addMessage('system', `✅ Modus gewechselt: ${MODE_LABELS[modeDraft]} – Anweisung und Skills neu geladen.`);
                    }
                    engine.saveInstruction(instructionDraft);
                    addMessage('system', `💾 Systemanweisung für Modus ${MODE_LABELS[engine.mode]} gespeichert.`);
                    setSettingsOpen(false);
                  }}
                  className="px-4 py-2 rounded-xl text-[11px] font-bold text-white bg-gradient-to-br from-cyan-600 to-blue-700 hover:brightness-110 transition"
                >
                  💾 Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Nachrichten */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[85%] md:max-w-[70%] flex flex-col ${bubbleClass(m.sender)} px-4 py-2.5 shadow-xl`}>
            <div className="flex items-baseline gap-2 mb-1">
              <span className={`text-[10px] font-black uppercase tracking-wide ${nameColor(m.sender)}`}>{senderName(m.sender)}</span>
              <span className="text-[9px] text-slate-500 font-mono">{m.time}</span>
            </div>
            <Markdown text={m.text} />
          </div>
        ))}
        {busy && (
          <div className="self-start bg-slate-800/60 border border-slate-700/40 rounded-2xl px-4 py-2 text-xs text-slate-400 flex items-center gap-2">
            <span className="animate-pulse">🤖</span> Agent denkt nach…
          </div>
        )}
      </div>

      {/* 6 Aktionsbuttons */}
      <div className="px-4 pb-2 grid grid-cols-6 gap-2">
        {buttons.map((b, i) => (
          <button
            key={i}
            onClick={() => actionClick(i)}
            disabled={busy}
            title={b.desc || b.action}
            className="flex flex-col items-center gap-0.5 py-2 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-xl transition disabled:opacity-40"
          >
            <span>{b.label}</span>
            <span className="text-[8px] text-slate-500 font-mono truncate w-full px-1 text-center">{b.action}</span>
          </button>
        ))}
      </div>

      {/* Eingabe */}
      <div className="px-4 pb-2 flex items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition"
          title="Datei anhängen"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={onFile} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Nachricht eingeben… (Enter zum Senden)"
          className="flex-1 px-4 py-3 rounded-xl bg-slate-900/80 border border-slate-700/60 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-500/60 transition"
        />
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-br from-cyan-600 to-blue-700 text-white text-sm font-bold hover:brightness-110 transition disabled:opacity-40"
        >
          <Send className="w-4 h-4" /> Senden
        </button>
      </div>

      {/* Status-Bar */}
      <footer className="px-4 py-2 border-t border-white/10 bg-[#050a18]/90 text-[11px] font-mono text-cyan-200/80 flex items-center justify-between gap-3">
        <span className="truncate">{statusText}</span>
        <button onClick={refreshButtons} className="text-slate-500 hover:text-cyan-300 transition shrink-0" title="Buttons aktualisieren">
          🔄
        </button>
      </footer>
    </div>
  );
}
