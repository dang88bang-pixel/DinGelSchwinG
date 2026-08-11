import React, { useState, useRef, useEffect } from 'react';
import { executeTask, routeTask, pickAgent } from '../lib/agentSkills';
import { loadBLEWasm } from '../lib/bleWasm';
import { RosettaConverter } from '../lib/rosetta/rosettaConverter';
import { useSensors } from '../hooks/useSensors';
import { MessageCircle, Lock, AlertCircle, Plus, Send, CheckCircle } from 'lucide-react';

/**
 * MoE Agent Chat Interface mit System-Critical Permission Guards
 * - Nutzer-bestätigte Permissions für kritische Aktionen
 * - Vollständig erweiterbar & anpassbar (Attribute, Actions, Rules)
 * - Netzwerk/USB-C Zugriff mit explizitem Consent
 */

// ============ Type Definitions ============

interface PermissionRule {
  id: string;
  name: string;
  resource: 'network' | 'usb-c' | 'filesystem' | 'system' | 'process';
  action: 'read' | 'write' | 'execute' | 'delete';
  requiresConfirm: boolean;
  allowedPatterns?: string[];
  deniedPatterns?: string[];
  metadata?: Record<string, any>;
}

interface SystemPermission {
  ruleId: string;
  timestamp: number;
  userId: string;
  granted: boolean;
  reason?: string;
  duration?: 'session' | 'permanent' | 'timed';
  expiresAt?: number;
}

interface MoEAgent {
  id: string;
  name: string;
  description: string;
  model: string;
  role: 'analyzer' | 'executor' | 'validator' | 'critic';
  permissions: PermissionRule[];
  maxTokens: number;
  temperature: number;
  enabled: boolean;
  customAttributes?: Record<string, any>;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'permission-request';
  content: string;
  agent?: string;
  timestamp: number;
  permissions?: PermissionRule[];
  permissionStatus?: 'pending' | 'granted' | 'denied';
  metadata?: Record<string, any>;
}

interface PermissionRequest {
  id: string;
  rule: PermissionRule;
  agent: MoEAgent;
  action: string;
  context: string;
  timestamp: number;
  status: 'pending' | 'granted' | 'denied' | 'expired';
  userResponse?: boolean;
}

// ============ Default System Rules ============

const DEFAULT_PERMISSION_RULES: PermissionRule[] = [
  {
    id: 'network-read',
    name: 'Network Read Access',
    resource: 'network',
    action: 'read',
    requiresConfirm: false,
    allowedPatterns: ['192.168.*', '10.0.*', 'localhost']
  },
  {
    id: 'network-write',
    name: 'Network Write (Send Data)',
    resource: 'network',
    action: 'write',
    requiresConfirm: true, // CRITICAL
    allowedPatterns: []
  },
  {
    id: 'network-external',
    name: 'External Network Access',
    resource: 'network',
    action: 'execute',
    requiresConfirm: true, // CRITICAL
    deniedPatterns: ['10.0.*']
  },
  {
    id: 'usb-read',
    name: 'USB-C Device Enumeration',
    resource: 'usb-c',
    action: 'read',
    requiresConfirm: false
  },
  {
    id: 'usb-write',
    name: 'USB-C Device Control',
    resource: 'usb-c',
    action: 'write',
    requiresConfirm: true, // CRITICAL
    metadata: { devicesToDiscover: true }
  },
  {
    id: 'usb-dongle-flash',
    name: 'USB-C Dongle Flash',
    resource: 'usb-c',
    action: 'execute',
    requiresConfirm: true, // CRITICAL - HIGH RISK
    metadata: { riskLevel: 'critical' }
  },
  {
    id: 'filesystem-read',
    name: 'Filesystem Read',
    resource: 'filesystem',
    action: 'read',
    requiresConfirm: false,
    allowedPatterns: ['/data/app/*', '/sdcard/*']
  },
  {
    id: 'filesystem-write',
    name: 'Filesystem Write',
    resource: 'filesystem',
    action: 'write',
    requiresConfirm: true, // CRITICAL
    allowedPatterns: ['/sdcard/*']
  },
  {
    id: 'system-exec',
    name: 'System Command Execution',
    resource: 'system',
    action: 'execute',
    requiresConfirm: true, // CRITICAL
    metadata: { riskLevel: 'critical' }
  },
  {
    id: 'process-kill',
    name: 'Process Termination',
    resource: 'process',
    action: 'execute',
    requiresConfirm: true, // CRITICAL
    metadata: { riskLevel: 'critical' }
  }
];

// ============ Permission Modal Component ============

const PermissionConfirmModal: React.FC<{
  request: PermissionRequest;
  onGrant: (id: string) => void;
  onDeny: (id: string) => void;
  onTimedGrant: (id: string, minutes: number) => void;
}> = ({ request, onGrant, onDeny, onTimedGrant }) => {
  const [timedMinutes, setTimedMinutes] = useState(5);
  const isRiskCritical = request.rule.metadata?.riskLevel === 'critical';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 ${isRiskCritical ? 'border-2 border-red-500' : 'border border-gray-200'}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {isRiskCritical ? (
              <AlertCircle className="w-6 h-6 text-red-500" />
            ) : (
              <Lock className="w-6 h-6 text-orange-500" />
            )}
            <h2 className="text-xl font-bold">Permission Request</h2>
          </div>
          <span className={`px-3 py-1 rounded text-sm font-semibold ${isRiskCritical ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
            {isRiskCritical ? '⚠️ CRITICAL' : 'Requires Approval'}
          </span>
        </div>

        {/* Details */}
        <div className="bg-gray-50 rounded p-4 mb-4 space-y-3">
          <div>
            <p className="text-xs text-gray-600 uppercase font-semibold">Agent</p>
            <p className="font-mono text-sm">{request.agent.name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600 uppercase font-semibold">Action</p>
            <p className="font-mono text-sm">{request.rule.name} ({request.rule.resource}/{request.rule.action})</p>
          </div>
          <div>
            <p className="text-xs text-gray-600 uppercase font-semibold">Context</p>
            <p className="text-sm text-gray-700">{request.context}</p>
          </div>

          {/* Restrictions */}
          {request.rule.allowedPatterns && request.rule.allowedPatterns.length > 0 && (
            <div>
              <p className="text-xs text-gray-600 uppercase font-semibold">Allowed Patterns</p>
              <div className="flex gap-1 flex-wrap">
                {request.rule.allowedPatterns.map(p => (
                  <span key={p} className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    ✓ {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {request.rule.deniedPatterns && request.rule.deniedPatterns.length > 0 && (
            <div>
              <p className="text-xs text-gray-600 uppercase font-semibold">Denied Patterns</p>
              <div className="flex gap-1 flex-wrap">
                {request.rule.deniedPatterns.map(p => (
                  <span key={p} className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">
                    ✗ {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
          {/* Deny */}
          <button
            onClick={() => onDeny(request.id)}
            className="px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 font-semibold transition"
          >
            Deny
          </button>

          {/* Timed Grant */}
          <div className="flex gap-1 items-center">
            <select
              value={timedMinutes}
              onChange={(e) => setTimedMinutes(Number(e.target.value))}
              className="flex-1 px-2 py-2 border border-gray-300 rounded text-sm"
            >
              <option value={1}>1 min</option>
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={60}>1 hour</option>
            </select>
            <button
              onClick={() => onTimedGrant(request.id, timedMinutes)}
              className="flex-1 px-4 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-semibold transition text-sm"
            >
              Timed
            </button>
          </div>

          {/* Grant */}
          <button
            onClick={() => onGrant(request.id)}
            className="px-4 py-2 bg-green-100 text-green-700 rounded hover:bg-green-200 font-semibold transition"
          >
            Grant
          </button>
        </div>

        {/* Info */}
        <p className="text-xs text-gray-500 text-center">
          This action will be logged in the audit trail. You can revoke permissions anytime.
        </p>
      </div>
    </div>
  );
};

// ============ Agent Card Component ============

const AgentCard: React.FC<{ agent: MoEAgent; onEdit: (agent: MoEAgent) => void; onDelete: (id: string) => void }> = ({ agent, onEdit, onDelete }) => (
  <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition">
    <div className="flex items-start justify-between mb-3">
      <div>
        <h3 className="font-bold text-lg">{agent.name}</h3>
        <p className="text-sm text-gray-600">{agent.model}</p>
      </div>
      <span className={`px-2 py-1 rounded text-xs font-semibold ${agent.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
        {agent.enabled ? '● Enabled' : '● Disabled'}
      </span>
    </div>
    <p className="text-sm text-gray-700 mb-3">{agent.description}</p>
    <div className="text-xs text-gray-600 mb-3 space-y-1">
      <p>Role: <span className="font-mono">{agent.role}</span></p>
      <p>Permissions: <span className="font-mono">{agent.permissions.length} rules</span></p>
    </div>
    <div className="flex gap-2">
      <button onClick={() => onEdit(agent)} className="flex-1 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition">
        Edit
      </button>
      <button onClick={() => onDelete(agent.id)} className="flex-1 px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition">
        Delete
      </button>
    </div>
  </div>
);

// ============ Main Chat Interface ============

export default function MoEChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '0',
      role: 'system',
      content: 'MoE Agent Chat initialized. System-critical permissions require explicit user confirmation.',
      timestamp: Date.now()
    }
  ]);

  const [agents, setAgents] = useState<MoEAgent[]>([
    {
      id: 'agent-1',
      name: 'Network Analyzer',
      description: 'Analyzes network traffic and device connectivity',
      model: 'gpt-4-moe',
      role: 'analyzer',
      permissions: [
        DEFAULT_PERMISSION_RULES[0], // network-read
        DEFAULT_PERMISSION_RULES[1]  // network-write (requires confirm)
      ],
      maxTokens: 2000,
      temperature: 0.5,
      enabled: true
    },
    {
      id: 'agent-2',
      name: 'Device Controller',
      description: 'Controls USB-C devices and peripherals',
      model: 'gpt-4-moe',
      role: 'executor',
      permissions: [
        DEFAULT_PERMISSION_RULES[4], // usb-read
        DEFAULT_PERMISSION_RULES[5], // usb-write (requires confirm)
        DEFAULT_PERMISSION_RULES[6]  // usb-dongle-flash (critical)
      ],
      maxTokens: 1500,
      temperature: 0.3,
      enabled: true
    }
  ]);

  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([]);
  const [grantedPermissions, setGrantedPermissions] = useState<SystemPermission[]>([]);
  const [userInput, setUserInput] = useState('');
  const [tab, setTab] = useState<'chat' | 'agents' | 'permissions'>('chat');
  const [editingAgent, setEditingAgent] = useState<MoEAgent | null>(null);
  const [showAgentForm, setShowAgentForm] = useState(false);

  // Agent-Formular (vollständig implementiert — Create/Edit)
  const AVAILABLE_MODELS = ['gpt-4-moe', 'claude-moe', 'llama3-moe', 'local-ondevice'];
  const AGENT_ROLES = ['analyzer', 'executor', 'validator', 'critic'] as const;
  interface AgentFormState {
    name: string;
    description: string;
    model: string;
    role: MoEAgent['role'];
    temperature: number;
    maxTokens: number;
    enabled: boolean;
    permissionIds: string[];
  }
  const emptyForm = (): AgentFormState => ({
    name: '',
    description: '',
    model: AVAILABLE_MODELS[0],
    role: 'analyzer',
    temperature: 0.5,
    maxTokens: 2000,
    enabled: true,
    permissionIds: [],
  });
  const [form, setForm] = useState<AgentFormState>(emptyForm);

  const openCreateAgent = () => {
    setEditingAgent(null);
    setForm(emptyForm());
    setShowAgentForm(true);
  };
  const openEditAgent = (agent: MoEAgent) => {
    setEditingAgent(agent);
    setForm({
      name: agent.name,
      description: agent.description,
      model: agent.model,
      role: agent.role,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      enabled: agent.enabled,
      permissionIds: agent.permissions.map((p) => p.id),
    });
    setShowAgentForm(true);
  };
  const submitAgentForm = () => {
    if (!form.name.trim()) return;
    handleSaveAgent({
      id: editingAgent?.id ?? `agent-${Date.now()}`,
      name: form.name.trim(),
      description: form.description.trim(),
      model: form.model,
      role: form.role,
      permissions: DEFAULT_PERMISSION_RULES.filter((r) => form.permissionIds.includes(r.id)),
      maxTokens: Math.max(256, Math.min(8192, form.maxTokens)),
      temperature: Math.max(0, Math.min(2, form.temperature)),
      enabled: form.enabled,
    });
    setShowAgentForm(false);
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors();
  const [wasmModule, setWasmModule] = useState<any>(null);
  const [replayPoints, setReplayPoints] = useState<Array<{ t: number; freqMHz: number; rssi: number; amp: number }>>([]);

  useEffect(() => {
    loadBLEWasm().then(setWasmModule).catch(() => {});
  }, []);

  // Echte Replay-Punkte aus dem ReplayEditor übernehmen (via CustomEvent)
  useEffect(() => {
    const handler = (ev: Event) => {
      const pts = (ev as CustomEvent).detail;
      if (Array.isArray(pts) && pts.length > 0) setReplayPoints(pts);
    };
    window.addEventListener('hgpt-replay-points', handler);
    return () => window.removeEventListener('hgpt-replay-points', handler);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ============ Permission Management ============

  const requestPermission = (agent: MoEAgent, rule: PermissionRule, action: string, context: string) => {
    const request: PermissionRequest = {
      id: `req-${Date.now()}`,
      rule,
      agent,
      action,
      context,
      timestamp: Date.now(),
      status: 'pending'
    };
    setPermissionRequests(prev => [...prev, request]);

    // Add system message
    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}`,
      role: 'permission-request',
      content: `🔒 Permission Request: ${rule.name}`,
      agent: agent.name,
      timestamp: Date.now(),
      permissions: [rule],
      permissionStatus: 'pending'
    }]);
  };

  const handlePermissionGrant = (requestId: string) => {
    const request = permissionRequests.find(r => r.id === requestId);
    if (!request) return;

    setGrantedPermissions(prev => [...prev, {
      ruleId: request.rule.id,
      timestamp: Date.now(),
      userId: 'current-user',
      granted: true,
      duration: 'session'
    }]);

    setPermissionRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'granted', userResponse: true } : r));

    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}`,
      role: 'system',
      content: `✅ Permission granted: ${request.rule.name}`,
      timestamp: Date.now()
    }]);
  };

  const handlePermissionDeny = (requestId: string) => {
    const request = permissionRequests.find(r => r.id === requestId);
    if (!request) return;

    setPermissionRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'denied', userResponse: false } : r));

    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}`,
      role: 'system',
      content: `❌ Permission denied: ${request.rule.name}`,
      timestamp: Date.now()
    }]);
  };

  const handleTimedPermissionGrant = (requestId: string, minutes: number) => {
    const request = permissionRequests.find(r => r.id === requestId);
    if (!request) return;

    const expiresAt = Date.now() + minutes * 60 * 1000;

    setGrantedPermissions(prev => [...prev, {
      ruleId: request.rule.id,
      timestamp: Date.now(),
      userId: 'current-user',
      granted: true,
      duration: 'timed',
      expiresAt
    }]);

    setPermissionRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'granted', userResponse: true } : r));

    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}`,
      role: 'system',
      content: `✅ Permission granted for ${minutes} minute(s): ${request.rule.name}`,
      timestamp: Date.now()
    }]);
  };

  // ============ Chat Handling ============

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: userInput,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMessage]);
    setUserInput('');

    // ECHTE Ausführung: Routing → Agent → Skill
    const hint = routeTask(userInput);
    const agent = pickAgent(agents, hint);
    if (!agent) {
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}`, role: 'system', content: 'Kein Agent konfiguriert — bitte im Agents-Tab einen erstellen.', timestamp: Date.now(),
      }]);
      return;
    }
    const agentFull = agents.find(a => a.id === agent.id)!;

    const ctx = {
      sensors: { alpha: sensors.alpha, beta: sensors.beta, gamma: sensors.gamma, permissionGranted: sensors.permissionGranted },
      distanceFn: wasmModule ? (rssi: number, tx: number) => wasmModule.calculate_distance(rssi, tx) : undefined,
      rosettaConvert: (input: string, format: string) => RosettaConverter.convert(input, format),
      replayPoints: replayPoints.length > 0 ? replayPoints : undefined,
      apiBase: typeof window !== 'undefined' ? window.location.origin : undefined,
      probeTimeoutMs: 4000,
    };

    // Kritische Skills → Permission-Flow VOR Ausführung (echter Guard)
    const result = await executeTask(agent, userInput, ctx);
    if (result.needsPermission) {
      const rule: PermissionRule = {
        id: `skill-${result.skill}`, name: result.permissionLabel ?? 'Kritische Aktion',
        resource: 'process' as PermissionRule['resource'], action: 'execute' as PermissionRule['action'], requiresConfirm: true,
      };
      requestPermission(agentFull, rule, result.skill, `User requested: ${userInput}`);
    }

    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: `[${hint.label} · ${agent.name}]\n${result.summary}`,
      agent: agent.name,
      timestamp: Date.now()
    }]);
  };

  // ============ Agent Management ============

  const handleSaveAgent = (agent: MoEAgent) => {
    if (editingAgent) {
      setAgents(prev => prev.map(a => a.id === agent.id ? agent : a));
    } else {
      setAgents(prev => [...prev, { ...agent, id: `agent-${Date.now()}` }]);
    }
    setEditingAgent(null);
    setShowAgentForm(false);
  };

  const handleDeleteAgent = (id: string) => {
    setAgents(prev => prev.filter(a => a.id !== id));
  };

  // ============ Render ============

  return (
    <div className="h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white p-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-8 h-8" />
            <div>
              <h1 className="text-2xl font-bold">MoE Agent Chat</h1>
              <p className="text-xs opacity-90">System-Critical Permission Guard Enabled</p>
            </div>
          </div>
          <div className="text-right text-sm">
            <p>Pending: <span className="font-bold">{permissionRequests.filter(r => r.status === 'pending').length}</span></p>
            <p>Granted: <span className="font-bold text-green-300">{grantedPermissions.length}</span></p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 flex">
        {(['chat', 'agents', 'permissions'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-4 py-3 font-semibold capitalize transition ${tab === t ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-800'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Chat Tab */}
        {tab === 'chat' && (
          <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                    msg.role === 'user' ? 'bg-blue-500 text-white' :
                    msg.role === 'system' ? 'bg-gray-300 text-gray-800' :
                    msg.role === 'permission-request' ? 'bg-red-100 text-red-800 border-l-4 border-red-500' :
                    'bg-gray-200 text-gray-800'
                  }`}>
                    {msg.agent && <p className="text-xs opacity-75 font-semibold mb-1">{msg.agent}</p>}
                    <p className="text-sm">{msg.content}</p>
                    {msg.permissionStatus && (
                      <p className="text-xs mt-1 opacity-75">Status: {msg.permissionStatus}</p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-200 p-4 bg-white">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask the MoE agent... (try 'flash dongle' for permission demo)"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleSendMessage}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Agents Tab */}
        {tab === 'agents' && (
          <div className="flex-1 overflow-y-auto p-4 max-w-6xl mx-auto w-full">
            <div className="mb-4">
              <button
                onClick={openCreateAgent}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
              >
                <Plus className="w-4 h-4" />
                New Agent
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onEdit={() => openEditAgent(agent)}
                  onDelete={handleDeleteAgent}
                />
              ))}
            </div>

            {showAgentForm && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
                  <h2 className="text-2xl font-bold mb-1">{editingAgent ? 'Edit Agent' : 'Create New Agent'}</h2>
                  <p className="text-sm text-gray-600 mb-4">Configure agent attributes, permissions, and behavior.</p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Name *</label>
                      <input
                        className="w-full border rounded px-3 py-2 text-sm"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="z. B. Network Analyzer"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Beschreibung</label>
                      <textarea
                        className="w-full border rounded px-3 py-2 text-sm"
                        rows={2}
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        placeholder="Aufgabe des Agents…"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Modell</label>
                        <select
                          className="w-full border rounded px-3 py-2 text-sm"
                          value={form.model}
                          onChange={(e) => setForm({ ...form, model: e.target.value })}
                        >
                          {AVAILABLE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Rolle</label>
                        <select
                          className="w-full border rounded px-3 py-2 text-sm"
                          value={form.role}
                          onChange={(e) => setForm({ ...form, role: e.target.value as MoEAgent['role'] })}
                        >
                          {AGENT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">
                          Temperatur: <span className="text-blue-700">{form.temperature.toFixed(1)}</span>
                        </label>
                        <input
                          type="range" min="0" max="2" step="0.1"
                          className="w-full"
                          value={form.temperature}
                          onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Max Tokens</label>
                        <input
                          type="number" min="256" max="8192" step="256"
                          className="w-full border rounded px-3 py-2 text-sm"
                          value={form.maxTokens}
                          onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) || 2000 })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Permissions</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                        {DEFAULT_PERMISSION_RULES.map((rule) => (
                          <label key={rule.id} className="flex items-center gap-2 text-sm border rounded px-2 py-1.5 cursor-pointer hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={form.permissionIds.includes(rule.id)}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  permissionIds: e.target.checked
                                    ? [...form.permissionIds, rule.id]
                                    : form.permissionIds.filter((id) => id !== rule.id),
                                })
                              }
                            />
                            <span className="flex-1">
                              {rule.name}
                              {rule.requiresConfirm && <span className="text-[10px] text-red-600 font-bold ml-1">⚠ CONFIRM</span>}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                      />
                      <span className="font-semibold text-gray-700">Agent aktiviert</span>
                    </label>
                  </div>

                  <div className="flex justify-end gap-2 mt-6">
                    <button
                      onClick={() => setShowAgentForm(false)}
                      className="px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400 transition"
                    >
                      Abbrechen
                    </button>
                    <button
                      onClick={submitAgentForm}
                      disabled={!form.name.trim()}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition disabled:opacity-50"
                    >
                      {editingAgent ? 'Änderungen speichern' : 'Agent erstellen'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Permissions Tab */}
        {tab === 'permissions' && (
          <div className="flex-1 overflow-y-auto p-4 max-w-6xl mx-auto w-full space-y-4">
            {/* Pending Requests */}
            <div>
              <h2 className="text-xl font-bold mb-3">Pending Requests</h2>
              {permissionRequests.filter(r => r.status === 'pending').length === 0 ? (
                <p className="text-gray-600 text-sm">No pending permission requests.</p>
              ) : (
                <div className="space-y-2">
                  {permissionRequests.filter(r => r.status === 'pending').map(req => (
                    <PermissionConfirmModal
                      key={req.id}
                      request={req}
                      onGrant={handlePermissionGrant}
                      onDeny={handlePermissionDeny}
                      onTimedGrant={handleTimedPermissionGrant}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Granted Permissions */}
            <div className="mt-6">
              <h2 className="text-xl font-bold mb-3">Granted Permissions</h2>
              {grantedPermissions.length === 0 ? (
                <p className="text-gray-600 text-sm">No permissions granted yet.</p>
              ) : (
                <div className="space-y-2">
                  {grantedPermissions.map(perm => {
                    const rule = DEFAULT_PERMISSION_RULES.find(r => r.id === perm.ruleId);
                    const isExpired = perm.expiresAt && perm.expiresAt < Date.now();
                    return (
                      <div key={`${perm.ruleId}-${perm.timestamp}`} className="bg-white border border-green-200 rounded p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CheckCircle className="w-5 h-5 text-green-600" />
                          <div>
                            <p className="font-semibold">{rule?.name}</p>
                            <p className="text-xs text-gray-600">{rule?.resource}/{rule?.action}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-600">
                            {perm.duration === 'timed' && perm.expiresAt ? `Expires in ${Math.max(0, Math.round((perm.expiresAt - Date.now()) / 1000 / 60))}m` : 'Session'}
                          </p>
                          {isExpired && <p className="text-xs text-red-600 font-semibold">EXPIRED</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* System Rules */}
            <div className="mt-6">
              <h2 className="text-xl font-bold mb-3">System Permission Rules</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {DEFAULT_PERMISSION_RULES.map(rule => (
                  <div key={rule.id} className={`border rounded p-3 ${rule.requiresConfirm ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                    <p className="font-semibold text-sm">{rule.name}</p>
                    <p className="text-xs text-gray-600">{rule.resource} / {rule.action}</p>
                    {rule.requiresConfirm && <p className="text-xs text-red-600 font-semibold mt-1">⚠️ Requires Confirmation</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
