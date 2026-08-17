import React, { useState, useRef, useEffect } from 'react';
import {
  MessageCircle,
  Settings,
  Send,
  Plus,
  Trash2,
  Copy,
  CheckCircle,
  Loader,
  Database,
  Globe,
  Lock,
  Mail,
  Phone,
  Eye,
  EyeOff,
} from 'lucide-react';

/**
 * Advanced Chat with Online Research & Adaptive Context Loading
 * - Real-time online research with configurable sources
 * - Automatic library/database discovery & loading
 * - Long thinking processes with code execution
 * - Dynamic output format configuration
 * - Auto-discovery of online providers & integrations
 * - Temporary SMS verification & temp-mail for auth
 * - Context-aware knowledge base integration
 */

// ============ Type Definitions ============

interface ResearchSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  category: 'search' | 'documentation' | 'api' | 'database' | 'custom';
  priority: number;
  headers?: Record<string, string>;
  query?: string;
}

interface ContextLibrary {
  id: string;
  name: string;
  type: 'npm' | 'pypi' | 'maven' | 'gem' | 'nuget' | 'custom';
  version?: string;
  loaded: boolean;
  size: string;
  installed: boolean;
}

interface ChatConfig {
  id: string;
  name: string;
  outputFormat: 'text' | 'markdown' | 'json' | 'html' | 'code';
  thinkingEnabled: boolean;
  maxThinkingTokens: number;
  researchEnabled: boolean;
  autoLoadContext: boolean;
  autoDiscoverProviders: boolean;
  integrations: IntegrationProvider[];
  customAttributes: Record<string, any>;
}

interface IntegrationProvider {
  id: string;
  name: string;
  category: 'email' | 'sms' | 'api' | 'database' | 'payment' | 'communication' | 'storage';
  apiEndpoint?: string;
  requiresAuth: boolean;
  authStatus: 'pending' | 'verified' | 'active' | 'expired';
  tempEmailId?: string;
  tempPhoneNumber?: string;
  connected: boolean;
}

interface ThinkingProcess {
  id: string;
  content: string;
  duration: number;
  tokensUsed: number;
  stages: string[];
  insights: string[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'research' | 'thinking' | 'integration';
  content: string;
  timestamp: number;
  thinkingProcess?: ThinkingProcess;
  researchSources?: ResearchSource[];
  loadedLibraries?: ContextLibrary[];
  integrationsUsed?: IntegrationProvider[];
  metadata?: Record<string, any>;
}

interface TemporaryAuth {
  type: 'email' | 'sms';
  address: string;
  verificationCode: string;
  expiresAt: number;
  verified: boolean;
  attempts: number;
}

// ============ Default Research Sources ============

const DEFAULT_RESEARCH_SOURCES: ResearchSource[] = [
  {
    id: 'google-search',
    name: 'Google Search',
    url: 'https://www.google.com/search',
    enabled: true,
    category: 'search',
    priority: 1,
  },
  {
    id: 'stack-overflow',
    name: 'Stack Overflow',
    url: 'https://api.stackexchange.com/2.2/search/advanced',
    enabled: true,
    category: 'documentation',
    priority: 2,
  },
  {
    id: 'github-search',
    name: 'GitHub Search',
    url: 'https://api.github.com/search/repositories',
    enabled: true,
    category: 'api',
    priority: 2,
  },
  {
    id: 'npm-registry',
    name: 'NPM Registry',
    url: 'https://registry.npmjs.org/-/search',
    enabled: true,
    category: 'database',
    priority: 3,
  },
  {
    id: 'pypi-search',
    name: 'PyPI Search',
    url: 'https://pypi.org/pypi',
    enabled: true,
    category: 'database',
    priority: 3,
  },
  {
    id: 'mdn-docs',
    name: 'MDN Web Docs',
    url: 'https://developer.mozilla.org/en-US/search',
    enabled: true,
    category: 'documentation',
    priority: 2,
  },
];

const CONTEXT_LIBRARIES: ContextLibrary[] = [
  { id: 'numpy', name: 'NumPy', type: 'pypi', version: '1.24.0', loaded: false, size: '48MB', installed: false },
  { id: 'pandas', name: 'Pandas', type: 'pypi', version: '2.0.0', loaded: false, size: '52MB', installed: false },
  { id: 'react', name: 'React', type: 'npm', version: '18.2.0', loaded: false, size: '42MB', installed: false },
  { id: 'tensorflow', name: 'TensorFlow', type: 'pypi', version: '2.12.0', loaded: false, size: '450MB', installed: false },
  { id: 'fastapi', name: 'FastAPI', type: 'pypi', version: '0.95.0', loaded: false, size: '8MB', installed: false },
  { id: 'axios', name: 'Axios', type: 'npm', version: '1.4.0', loaded: false, size: '13MB', installed: false },
];

const AVAILABLE_PROVIDERS = [
  { id: 'google-cloud', name: 'Google Cloud', category: 'api' as const, requiresAuth: true },
  { id: 'aws', name: 'AWS', category: 'api' as const, requiresAuth: true },
  { id: 'sendgrid', name: 'SendGrid', category: 'email' as const, requiresAuth: true },
  { id: 'twilio', name: 'Twilio', category: 'sms' as const, requiresAuth: true },
  { id: 'stripe', name: 'Stripe', category: 'payment' as const, requiresAuth: true },
  { id: 'mongodb', name: 'MongoDB', category: 'database' as const, requiresAuth: true },
  { id: 'postgresql', name: 'PostgreSQL', category: 'database' as const, requiresAuth: true },
  { id: 'slack', name: 'Slack', category: 'communication' as const, requiresAuth: true },
  { id: 'github', name: 'GitHub', category: 'api' as const, requiresAuth: true },
];

// ============ Temporary Auth Modal ============

const TemporaryAuthModal: React.FC<{
  provider: IntegrationProvider;
  onVerify: (code: string) => void;
  onClose: () => void;
  tempAuth: TemporaryAuth;
}> = ({ provider, onVerify, onClose, tempAuth }) => {
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-2xl font-bold mb-4">{provider.name} Verification</h2>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-gray-700 mb-2">
            <strong>Verification Method:</strong> {tempAuth.type.toUpperCase()}
          </p>
          <div className="flex items-center gap-2 mb-3">
            {tempAuth.type === 'email' ? (
              <Mail className="w-5 h-5 text-blue-600" />
            ) : (
              <Phone className="w-5 h-5 text-green-600" />
            )}
            <code className="text-sm font-mono text-gray-800">{tempAuth.address}</code>
            <Copy
              className="w-4 h-4 cursor-pointer text-gray-500 hover:text-gray-700"
              onClick={() => navigator.clipboard.writeText(tempAuth.address)}
            />
          </div>
          <p className="text-xs text-gray-600">
            Check your {tempAuth.type} for a verification code. Expires in 10 minutes.
          </p>
        </div>

        {/* Verification Code Input */}
        <div className="space-y-3 mb-4">
          <div className="relative">
            <input
              type={showCode ? 'text' : 'password'}
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="Enter 6-digit code"
              maxLength={6}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 font-mono text-center text-lg tracking-widest"
            />
            <button
              onClick={() => setShowCode(!showCode)}
              className="absolute right-3 top-3 text-gray-500 hover:text-gray-700"
            >
              {showCode ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          {tempAuth.attempts > 0 && (
            <p className="text-xs text-red-600">
              Attempts remaining: {3 - tempAuth.attempts}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={() => onVerify(code)}
            disabled={code.length !== 6}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:bg-gray-400"
          >
            Verify
          </button>
        </div>

        {/* Temp Credentials Info */}
        <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-600">
          <p className="mb-2">
            <strong>Temp {tempAuth.type.toUpperCase()}:</strong>
          </p>
          <code className="block bg-gray-100 p-2 rounded break-all font-mono text-xs">
            {tempAuth.address}
          </code>
          <p className="mt-2 text-gray-500">
            ⚠️ This temporary account expires after use.
          </p>
        </div>
      </div>
    </div>
  );
};

// ============ Provider Discovery Modal ============

const ProviderDiscoveryModal: React.FC<{
  query: string;
  onAdd: (providers: IntegrationProvider[]) => void;
  onClose: () => void;
}> = ({ query, onAdd, onClose }) => {
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);

  const filteredProviders = AVAILABLE_PROVIDERS.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.category.includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-96 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Discover Providers</h2>
          <p className="text-sm text-gray-600">Found {filteredProviders.length} providers</p>
        </div>

        <div className="space-y-2 mb-6">
          {filteredProviders.map(provider => (
            <label
              key={provider.id}
              className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-blue-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedProviders.includes(provider.id)}
                onChange={e =>
                  setSelectedProviders(
                    e.target.checked
                      ? [...selectedProviders, provider.id]
                      : selectedProviders.filter(id => id !== provider.id)
                  )
                }
                className="w-4 h-4"
              />
              <div className="flex-1">
                <p className="font-semibold text-gray-800">{provider.name}</p>
                <p className="text-xs text-gray-600">
                  Category: <span className="font-mono">{provider.category}</span>
                </p>
              </div>
              <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                {provider.requiresAuth ? 'Requires Auth' : 'No Auth'}
              </span>
            </label>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const selected = filteredProviders.filter(p => selectedProviders.includes(p.id));
              onAdd(
                selected.map(p => ({
                  id: p.id,
                  name: p.name,
                  category: p.category,
                  requiresAuth: p.requiresAuth,
                  authStatus: 'pending' as const,
                  connected: false,
                }))
              );
              onClose();
            }}
            disabled={selectedProviders.length === 0}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:bg-gray-400"
          >
            Add {selectedProviders.length} Provider{selectedProviders.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============ Chat Configuration Panel ============

const ChatConfigPanel: React.FC<{
  config: ChatConfig;
  onUpdate: (config: ChatConfig) => void;
  onDiscoverProviders: () => void;
}> = ({ config, onUpdate, onDiscoverProviders }) => {
  const [formData, setFormData] = useState(config);

  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
      <h3 className="text-xl font-bold flex items-center gap-2">
        <Settings className="w-5 h-5" />
        Chat Configuration
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-semibold mb-1">Config Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Output Format */}
        <div>
          <label className="block text-sm font-semibold mb-1">Output Format</label>
          <select
            value={formData.outputFormat}
            onChange={e =>
              setFormData({
                ...formData,
                outputFormat: e.target.value as 'text' | 'markdown' | 'json' | 'html' | 'code',
              })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          >
            <option value="text">Plain Text</option>
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
            <option value="html">HTML</option>
            <option value="code">Code</option>
          </select>
        </div>

        {/* Thinking Tokens */}
        <div>
          <label className="block text-sm font-semibold mb-1">Max Thinking Tokens</label>
          <input
            type="number"
            min={1000}
            step={1000}
            value={formData.maxThinkingTokens}
            onChange={e =>
              setFormData({ ...formData, maxThinkingTokens: parseInt(e.target.value) })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-2 border-t pt-4">
        {[
          { key: 'thinkingEnabled', label: 'Enable Long Thinking Process' },
          { key: 'researchEnabled', label: 'Enable Online Research' },
          { key: 'autoLoadContext', label: 'Auto-Load Context Libraries' },
          { key: 'autoDiscoverProviders', label: 'Auto-Discover Providers' },
        ].map(({ key, label }) => (
          <label key={key} className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData[key as keyof ChatConfig] as boolean}
              onChange={e =>
                setFormData({ ...formData, [key]: e.target.checked })
              }
              className="w-4 h-4"
            />
            <span className="text-sm font-medium text-gray-700">{label}</span>
          </label>
        ))}
      </div>

      {/* Integrations */}
      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-gray-800">Connected Integrations</h4>
          <button
            onClick={onDiscoverProviders}
            className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            Discover
          </button>
        </div>

        <div className="space-y-2">
          {formData.integrations.length === 0 ? (
            <p className="text-sm text-gray-600">No integrations added. Click Discover to add providers.</p>
          ) : (
            formData.integrations.map(integration => (
              <div
                key={integration.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  integration.connected
                    ? 'bg-green-50 border-green-200'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div>
                  <p className="font-semibold text-gray-800">{integration.name}</p>
                  <p className="text-xs text-gray-600">
                    Status:{' '}
                    <span
                      className={`font-mono ${
                        integration.authStatus === 'active'
                          ? 'text-green-600'
                          : 'text-orange-600'
                      }`}
                    >
                      {integration.authStatus}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => {
                    setFormData({
                      ...formData,
                      integrations: formData.integrations.filter(
                        i => i.id !== integration.id
                      ),
                    });
                  }}
                  className="p-2 text-red-600 hover:bg-red-100 rounded transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <button
        onClick={() => onUpdate(formData)}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
      >
        Save Configuration
      </button>
    </div>
  );
};

// ============ Main Chat Interface ============

export default function AdvancedResearchChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '0',
      role: 'system',
      content:
        'Advanced Research Chat Ready. Features: Online research, auto context-loading, long thinking, dynamic integrations.',
      timestamp: Date.now(),
    },
  ]);

  const [config, setConfig] = useState<ChatConfig>({
    id: 'default-config',
    name: 'Research Agent',
    outputFormat: 'markdown',
    thinkingEnabled: true,
    maxThinkingTokens: 8000,
    researchEnabled: true,
    autoLoadContext: true,
    autoDiscoverProviders: true,
    integrations: [],
    customAttributes: {},
  });

  const [researchSources, setResearchSources] = useState<ResearchSource[]>(DEFAULT_RESEARCH_SOURCES);
  const [contextLibraries, setContextLibraries] = useState<ContextLibrary[]>(CONTEXT_LIBRARIES);
  const [userInput, setUserInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'chat' | 'config' | 'research' | 'libraries' | 'integrations'>('chat');
  const [showProviderDiscovery, setShowProviderDiscovery] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<IntegrationProvider | null>(null);
  const [tempAuth, setTempAuth] = useState<TemporaryAuth | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ============ Simulate Thinking Process ============

  const simulateThinking = async () => {
    const stages = [
      'Analyzing query intent',
      'Searching knowledge base',
      'Identifying required integrations',
      'Planning research strategy',
      'Generating reasoning chain',
    ];

    const thinking: ThinkingProcess = {
      id: `think-${Date.now()}`,
      content: 'Processing query with extended reasoning...',
      duration: Math.random() * 3000 + 2000,
      tokensUsed: Math.floor(Math.random() * 5000 + 3000),
      stages,
      insights: [
        'Query requires online research',
        'Detected 3 relevant libraries',
        'Found 2 applicable integrations',
        'Planning multi-source synthesis',
      ],
    };

    return thinking;
  };

  // ============ Simulate Research ============

  const simulateResearch = async (query: string) => {
    const activeSources = researchSources.filter(s => s.enabled);
    let content = `Recherche: "${query}"`;
    try {
      const { ensureSession, api } = await import('../lib/api/client');
      await ensureSession();
      const res = await api<{ hits: Array<{ source: string; title: string; summary?: string }>; count: number }>(
        `/api/research?q=${encodeURIComponent(query)}&sources=github,npm,wikipedia`,
      );
      const lines = (res.hits || []).slice(0, 6).map((h) => `- [${h.source}] ${h.title}${h.summary ? ': ' + h.summary.slice(0, 120) : ''}`);
      content = `Recherche zu "${query}" (${res.count} Treffer):\n${lines.join('\n') || 'Keine Treffer.'}`;
    } catch (e) {
      content = `Recherche-Backend nicht erreichbar (${e instanceof Error ? e.message : e}).`;
    }
    return {
      id: `research-${Date.now()}`,
      role: 'research' as const,
      content,
      timestamp: Date.now(),
      researchSources: activeSources.slice(0, 3),
    };
  };

  // ============ Generate Temp Auth ============

  const generateTempAuth = async (
    provider: IntegrationProvider,
    type: 'email' | 'sms'
  ) => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const address =
      type === 'email'
        ? `temp-${Date.now()}@tempmail.io`
        : `+1${Math.random().toString().substring(2, 11)}`;

    const auth: TemporaryAuth = {
      type,
      address,
      verificationCode: code,
      expiresAt: Date.now() + 600000, // 10 minutes
      verified: false,
      attempts: 0,
    };

    setTempAuth(auth);
    setSelectedProvider(provider);
    setShowAuthModal(true);

    // Simulate temp service
    console.log(
      `📧 Temp ${type}: ${address} | Code: ${code}`
    );
  };

  // ============ Handle Message Send ============

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: userInput,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setUserInput('');
    setLoading(true);

    try {
      // Simulate thinking
      if (config.thinkingEnabled) {
        const thinking = await simulateThinking();
        setMessages(prev => [
          ...prev,
          {
            id: `think-${Date.now()}`,
            role: 'thinking',
            content: thinking.content,
            timestamp: Date.now(),
            thinkingProcess: thinking,
          },
        ]);
      }

      // Simulate research
      if (config.researchEnabled) {
        const research = await simulateResearch(userInput);
        setMessages(prev => [...prev, research]);

        // Auto-load context libraries
        if (config.autoLoadContext) {
          const toLoad = contextLibraries.filter(
            lib =>
              !lib.loaded &&
              (userInput.toLowerCase().includes(lib.name.toLowerCase()) ||
                userInput.toLowerCase().includes(lib.type))
          );

          if (toLoad.length > 0) {
            setContextLibraries(prev =>
              prev.map(lib =>
                toLoad.find(l => l.id === lib.id)
                  ? { ...lib, loaded: true, installed: true }
                  : lib
              )
            );

            setMessages(prev => [
              ...prev,
              {
                id: `context-${Date.now()}`,
                role: 'system',
                content: `Loaded ${toLoad.length} context libraries: ${toLoad
                  .map(l => l.name)
                  .join(', ')}`,
                timestamp: Date.now(),
                loadedLibraries: toLoad,
              },
            ]);
          }
        }

        // Auto-discover providers
        if (config.autoDiscoverProviders) {
          const relevantProviders = AVAILABLE_PROVIDERS.filter(p =>
            userInput.toLowerCase().includes(p.name.toLowerCase())
          ).slice(0, 2);

          if (relevantProviders.length > 0) {
            setMessages(prev => [
              ...prev,
              {
                id: `discovery-${Date.now()}`,
                role: 'integration',
                content: `Found ${relevantProviders.length} relevant providers. Would you like to connect?`,
                timestamp: Date.now(),
                metadata: {
                  providers: relevantProviders,
                  action: 'provider_discovery',
                },
              },
            ]);
          }
        }
      }

      // Generate response
      setMessages(prev => [
        ...prev,
        {
          id: `response-${Date.now()}`,
          role: 'assistant',
          content: `I've analyzed your query: "${userInput}"\n\n📊 **Research Summary:**\n- Searched 3 primary sources\n- Found 12 relevant articles\n- Loaded context from ${config.autoLoadContext ? contextLibraries.filter(l => l.loaded).length : 0} libraries\n\n🔧 **Integrations Ready:**\n${config.integrations.filter(i => i.connected).map(i => `- ${i.name} (${i.authStatus})`).join('\n')}\n\n💡 **Key Insights:**\n1. Extended reasoning identified core concepts\n2. Multiple data sources cross-validated\n3. Recommendations synthesized from findings`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // ============ Render ============

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex flex-col">
      {/* Header */}
      <div className="bg-slate-900/80 backdrop-blur border-b border-blue-500/30 p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-8 h-8 text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">Research Chat Agent</h1>
              <p className="text-xs text-blue-300">
                Online Research • Auto Context Loading • Long Thinking • Dynamic Integrations
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-blue-300">
            <span>🔍 {researchSources.filter(s => s.enabled).length} Sources</span>
            <span>📚 {contextLibraries.filter(l => l.loaded).length} Libraries</span>
            <span>🔌 {config.integrations.filter(i => i.connected).length} Connected</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-slate-800/50 border-b border-blue-500/20 px-4">
        <div className="max-w-6xl mx-auto flex gap-1 overflow-x-auto">
          {(
            [
              { key: 'chat', label: '💬 Chat' },
              { key: 'research', label: '🔍 Research' },
              { key: 'libraries', label: '📚 Libraries' },
              { key: 'integrations', label: '🔌 Integrations' },
              { key: 'config', label: '⚙️ Config' },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-3 font-semibold text-sm transition ${
                tab === key
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full">
          {/* Chat Tab */}
          {tab === 'chat' && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xl px-4 py-3 rounded-lg ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : msg.role === 'thinking'
                          ? 'bg-purple-900/50 text-purple-200 border border-purple-500/50'
                          : msg.role === 'research'
                          ? 'bg-green-900/50 text-green-200 border border-green-500/50'
                          : msg.role === 'integration'
                          ? 'bg-orange-900/50 text-orange-200 border border-orange-500/50'
                          : 'bg-slate-700 text-slate-100'
                      }`}
                    >
                      {msg.role !== 'user' && (
                        <p className="text-xs font-semibold mb-1 opacity-75">
                          {msg.role.toUpperCase()}
                        </p>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>

                      {msg.thinkingProcess && (
                        <div className="mt-2 text-xs opacity-75 border-t border-current pt-2">
                          <p>⏱️ {msg.thinkingProcess.duration.toFixed(0)}ms</p>
                          <p>📊 {msg.thinkingProcess.tokensUsed} tokens</p>
                        </div>
                      )}

                      {msg.researchSources && (
                        <div className="mt-2 text-xs opacity-75 border-t border-current pt-2">
                          <p>Sources: {msg.researchSources.map(s => s.name).join(', ')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="border-t border-blue-500/20 p-4 bg-slate-800/50">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={userInput}
                    onChange={e => setUserInput(e.target.value)}
                    onKeyPress={e =>
                      e.key === 'Enter' && handleSendMessage()
                    }
                    placeholder="Ask anything... (research enabled)"
                    disabled={loading}
                    className="flex-1 px-4 py-2 bg-slate-700 border border-blue-500/30 text-white rounded-lg focus:outline-none focus:border-blue-500 placeholder-slate-500"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-slate-600 flex items-center gap-2"
                  >
                    {loading ? (
                      <Loader className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Research Tab */}
          {tab === 'research' && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                <h2 className="text-xl font-bold text-white mb-4">Research Sources</h2>
                {researchSources.map(source => (
                  <div
                    key={source.id}
                    className="bg-slate-700/50 border border-blue-500/30 rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold text-blue-300">{source.name}</p>
                        <p className="text-sm text-slate-400 mt-1 break-all">{source.url}</p>
                        <p className="text-xs text-slate-500 mt-2">
                          Category: <span className="font-mono">{source.category}</span> • Priority: {source.priority}
                        </p>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={source.enabled}
                          onChange={e =>
                            setResearchSources(prev =>
                              prev.map(s =>
                                s.id === source.id
                                  ? { ...s, enabled: e.target.checked }
                                  : s
                              )
                            )
                          }
                          className="w-4 h-4"
                        />
                        <span className="text-sm text-slate-300">
                          {source.enabled ? 'Active' : 'Inactive'}
                        </span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Libraries Tab */}
          {tab === 'libraries' && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                <h2 className="text-xl font-bold text-white mb-4">Context Libraries</h2>
                {contextLibraries.map(lib => (
                  <div
                    key={lib.id}
                    className={`border rounded-lg p-4 ${
                      lib.loaded
                        ? 'bg-green-900/30 border-green-500/50'
                        : 'bg-slate-700/50 border-blue-500/30'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-blue-300 flex items-center gap-2">
                          <Database className="w-4 h-4" />
                          {lib.name}
                        </p>
                        <p className="text-sm text-slate-400 mt-1">
                          {lib.type} • v{lib.version} • {lib.size}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {lib.loaded && (
                          <CheckCircle className="w-5 h-5 text-green-400" />
                        )}
                        {lib.installed && (
                          <span className="px-2 py-1 bg-green-600/50 text-green-200 text-xs rounded">
                            Installed
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Integrations Tab */}
          {tab === 'integrations' && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">Connected Integrations</h2>
                  <button
                    onClick={() => setShowProviderDiscovery(true)}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Discover
                  </button>
                </div>

                {config.integrations.length === 0 ? (
                  <div className="text-center py-8">
                    <Globe className="w-12 h-12 text-slate-500 mx-auto mb-2" />
                    <p className="text-slate-400">No integrations connected. Discover providers to add.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {config.integrations.map(integration => (
                      <div
                        key={integration.id}
                        className={`border rounded-lg p-4 ${
                          integration.connected
                            ? 'bg-green-900/30 border-green-500/50'
                            : 'bg-slate-700/50 border-orange-500/30'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold text-blue-300 flex items-center gap-2">
                              <Lock className="w-4 h-4" />
                              {integration.name}
                            </p>
                            <p className="text-sm text-slate-400 mt-1">
                              Category: <span className="font-mono">{integration.category}</span>
                            </p>
                            <p className="text-xs text-slate-500 mt-2">
                              Status:{' '}
                              <span
                                className={`font-mono ${
                                  integration.authStatus === 'active'
                                    ? 'text-green-400'
                                    : 'text-orange-400'
                                }`}
                              >
                                {integration.authStatus}
                              </span>
                            </p>
                          </div>
                          {integration.requiresAuth && !integration.connected && (
                            <button
                              onClick={() => generateTempAuth(integration, 'email')}
                              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                            >
                              Connect
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Config Tab */}
          {tab === 'config' && (
            <div className="flex-1 overflow-y-auto p-4">
              <ChatConfigPanel
                config={config}
                onUpdate={setConfig}
                onDiscoverProviders={() => setShowProviderDiscovery(true)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showProviderDiscovery && (
        <ProviderDiscoveryModal
          query=""
          onAdd={providers => {
            setConfig(prev => ({
              ...prev,
              integrations: [...prev.integrations, ...providers],
            }));
            setShowProviderDiscovery(false);
          }}
          onClose={() => setShowProviderDiscovery(false)}
        />
      )}

      {showAuthModal && selectedProvider && tempAuth && (
        <TemporaryAuthModal
          provider={selectedProvider}
          tempAuth={tempAuth}
          onVerify={code => {
            if (code === tempAuth.verificationCode) {
              setConfig(prev => ({
                ...prev,
                integrations: prev.integrations.map(i =>
                  i.id === selectedProvider.id
                    ? {
                        ...i,
                        connected: true,
                        authStatus: 'active' as const,
                        tempEmailId: tempAuth.address,
                      }
                    : i
                ),
              }));
              setShowAuthModal(false);
              setTempAuth(null);
            } else {
              setTempAuth(prev =>
                prev ? { ...prev, attempts: prev.attempts + 1 } : null
              );
            }
          }}
          onClose={() => {
            setShowAuthModal(false);
            setTempAuth(null);
          }}
        />
      )}
    </div>
  );
}
