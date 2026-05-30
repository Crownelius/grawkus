import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { STATE_DIR_NAME } from './brand.js';
import { PROVIDERS, type GrawkusConfig, type ReasoningEffort } from './types.js';

// Grawkus keeps config, sessions, skills, memory, and benchmark artifacts
// under ~/.grawkus by default. GRAWKUS_HOME can override that location.
export const CONFIG_DIR_NAME = STATE_DIR_NAME;

// Resolve the config dir LAZILY (every call) instead of caching at
// module-load time. The cached form prevented tests + sandboxed runs
// from overriding via GRAWKUS_HOME after the first import: the
// first module to load would freeze the path at the user's real
// home, and all subsequent overrides were ignored. The resolution
// is cheap (env lookup + one join) so calling per access has no
// observable cost on the hot path.
function resolveConfigDir(): string {
  return process.env.GRAWKUS_HOME || join(homedir(), CONFIG_DIR_NAME);
}

function resolveConfigFile(): string {
  return join(resolveConfigDir(), 'config.json');
}

/**
 * Resolve the per-project state dir (codemap cache, project memory,
 * package-manager pref). Prefers `<cwd>/.grawkus`; falls back to
 * the legacy `<cwd>/.grawkus` only if it exists and the new one
 * doesn't. Project dirs are NOT auto-renamed — they often live inside
 * repos and migrating them silently could surprise teammates / CI.
 */
export function getProjectStateDir(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME);
}

const DEFAULT_CONFIG: GrawkusConfig = {
  apiKey: '',
  baseURL: 'https://openrouter.ai/api/v1',
  model: 'openrouter/free',
  // When the primary model returns a cryptic/empty provider error
  // (common for free / experimental OpenRouter models like owl-alpha
  // returning literally "ERROR"), runQuery retries ONCE with this
  // fallback. The setup wizard writes an OpenRouter-specific free fallback;
  // keep the base default unset so non-OpenRouter providers don't inherit a
  // model name their endpoint cannot serve.
  provider: 'OpenRouter',
  maxTokens: 8192,
  temperature: 0.3,
  permissionMode: 'ask',
  // Default color palette. Users switch with /palette <name>; available
  // palettes are listed via /palettes. IDs come from Coolors trending schemes.
  palette: 'olive-garden-feast',
  // Thinking / reasoning shown by default — gives users live "the model isn't
  // dead" feedback during long turns. Toggle off with /thinking.
  showThinking: true,
  // Sandbox config. Default off: most workflows don't want the
  // restrictions, and the execpolicy intent gate from 1.19.0 already
  // catches the highest-risk commands. Users opt in via /sandbox standard
  // or /sandbox strict.
  sandbox: {
    level: 'off',
  },
  swarm: {
    setupWizard: true,
    maxAgents: 5,
  },
  import: {
    defaultSource: 'auto',
    autoSyncOnStartup: false,
    syncLimit: 200,
  },
  footer: {
    enabled: true,
    openingPrompt: '/model',
  },
  // MemPalace persistent memory. ON by default — it's a featured capability,
  // zero overhead until something is written, and the agent only uses the
  // tools when it sees a durable fact worth keeping. User can opt out during
  // the setup wizard or anytime via /memory disable.
  memory: {
    enabled: true,
    globalScope: true,
    projectScope: true,
  },
  // Voice / accessibility is OFF by default. ffmpeg is optional. Users opt in
  // via `/voice on` (and set the two API keys via `/voice config`). The
  // sub-blocks define what becomes active once enabled; this just primes them
  // with reasonable defaults so first use Just Works.
  voice: {
    enabled: false,
    stt: {
      // apiKey unset — falls back to top-level apiKey for OpenAI-compatible
      // providers. Whisper specifically requires a real OpenAI key; users
      // configure a separate one via /voice config when their main provider
      // isn't OpenAI.
      baseURL: 'https://api.openai.com/v1',
      model: 'whisper-1',
      dictationKey: 'F5',
      autoSubmit: false,
    },
    tts: {
      // apiKey unset — no fallback (ElevenLabs is a distinct provider). User
      // must run /voice config to provide it.
      baseURL: 'https://api.elevenlabs.io/v1',
      model: 'eleven_turbo_v2_5',
      // Rachel + Domi — both available on every ElevenLabs free tier; using
      // two distinct presets gives instant blind-accessibility benefit
      // (assistant ≠ user voice).
      assistantVoiceId: '21m00Tcm4TlvDq8ikWAM',
      userVoiceId: 'AZnzlk1XvdvUeBnXmlld',
      echoUser: true,
      skipCode: true,
      speed: 1.0,
      stability: 0.5,
      similarityBoost: 0.75,
    },
    accessibility: {
      // screenReader OFF by default — it's lossy for sighted users (no ANSI
      // means no syntax highlight). Blind users turn it on via /accessibility
      // screenReader on.
      screenReader: false,
      audioCues: true,
      announceErrors: true,
      announceModeSwitches: true,
      askBeforeDestructive: true,
      longResponseThreshold: 300,
    },
  },
};

export function getConfigDir(): string {
  return resolveConfigDir();
}

/**
 * Same as getConfigDir() but exported under a clearer name for
 * other modules that want the home-dir state root. Used by
 * sessions, debug log, gateguard state, etc.
 */
export function getHomeStateDir(): string {
  return resolveConfigDir();
}

export function loadConfig(): GrawkusConfig {
  const configFile = resolveConfigFile();
  if (!existsSync(configFile)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(configFile, 'utf-8');
    const loaded = JSON.parse(raw);
    const config = { ...DEFAULT_CONFIG, ...loaded };
    validateConfig(config);
    return config;
  } catch (err) {
    console.warn(`Warning: Failed to load config: ${err instanceof Error ? err.message : err}`);
    return { ...DEFAULT_CONFIG };
  }
}

type ProviderKey = keyof typeof PROVIDERS;

const ENV_KEYS = [
  'GRAWKUS_PROVIDER',
  'GRAWKUS_API_KEY',
  'GRAWKUS_BASE_URL',
  'GRAWKUS_MODEL',
  'GRAWKUS_MODEL_OVERRIDE',
  'GRAWKUS_FALLBACK_MODEL',
  'GRAWKUS_FALLBACK_MODEL_OVERRIDE',
  'GRAWKUS_MAX_TOKENS',
  'GRAWKUS_MAX_TOKENS_OVERRIDE',
  'GRAWKUS_CONTEXT_WINDOW_TOKENS',
  'GRAWKUS_CONTEXT_WINDOW_TOKENS_OVERRIDE',
  'GRAWKUS_MAX_TURNS',
  'GRAWKUS_MAX_TURNS_OVERRIDE',
  'GRAWKUS_TEMPERATURE',
  'GRAWKUS_TEMPERATURE_OVERRIDE',
  'GRAWKUS_PERMISSION',
  'GRAWKUS_MEMORY',
  'GRAWKUS_THEME',
  'GRAWKUS_SHOW_THINKING',
  'GRAWKUS_REASONING_EFFORT',
  'GRAWKUS_REASONING_EFFORT_OVERRIDE',
  'GRAWKUS_BASE_URL_OVERRIDE',
  'GRAWKUS_API_KEY_OVERRIDE',
  'GRAWKUS_API_KEY_ENV',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'NVIDIA_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GLM_API_KEY',
  'ZHIPUAI_API_KEY',
  'OLLAMA_BASE_URL',
] as const;

const REASONING_EFFORTS: readonly ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function normalizeProviderKey(value: string | undefined): ProviderKey | null {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return null;
  const compact = key.replace(/[^a-z0-9]/g, '');
  if (compact in PROVIDERS) return compact as ProviderKey;
  if (compact.includes('openrouter')) return 'openrouter';
  if (compact.includes('openaicodex') || compact === 'codex') return 'openai-codex';
  if (compact.includes('openai')) return 'openai';
  if (compact.includes('deepseek')) return 'deepseek';
  if (compact.includes('nvidia') || compact.includes('nim')) return 'nvidia';
  if (compact.includes('google') || compact.includes('gemini')) return 'google';
  if (compact.includes('ollama')) return 'ollama';
  if (compact.includes('lmstudio')) return 'lmstudio';
  if (compact.includes('glm') || compact.includes('zhipu')) return 'glm';
  if (compact.includes('custom')) return 'custom';
  return null;
}

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function inferProviderFromEnv(): { providerKey: ProviderKey; apiKey?: string } | null {
  const explicit = normalizeProviderKey(firstEnv('GRAWKUS_PROVIDER'));
  if (explicit) {
    return { providerKey: explicit, apiKey: apiKeyForProvider(explicit) };
  }
  if (firstEnv('OPENROUTER_API_KEY')) return { providerKey: 'openrouter', apiKey: firstEnv('OPENROUTER_API_KEY') };
  if (firstEnv('OPENAI_API_KEY')) return { providerKey: 'openai', apiKey: firstEnv('OPENAI_API_KEY') };
  if (firstEnv('DEEPSEEK_API_KEY')) return { providerKey: 'deepseek', apiKey: firstEnv('DEEPSEEK_API_KEY') };
  if (firstEnv('NVIDIA_API_KEY')) return { providerKey: 'nvidia', apiKey: firstEnv('NVIDIA_API_KEY') };
  if (firstEnv('GOOGLE_API_KEY', 'GEMINI_API_KEY')) return { providerKey: 'google', apiKey: firstEnv('GOOGLE_API_KEY', 'GEMINI_API_KEY') };
  if (firstEnv('GLM_API_KEY', 'ZHIPUAI_API_KEY')) return { providerKey: 'glm', apiKey: firstEnv('GLM_API_KEY', 'ZHIPUAI_API_KEY') };
  if (firstEnv('OLLAMA_BASE_URL')) return { providerKey: 'ollama' };
  return null;
}

function apiKeyForProvider(providerKey: ProviderKey): string | undefined {
  const explicit = firstEnv('GRAWKUS_API_KEY');
  if (explicit) return explicit;
  switch (providerKey) {
    case 'openrouter': return firstEnv('OPENROUTER_API_KEY');
    case 'openai': return firstEnv('OPENAI_API_KEY');
    case 'deepseek': return firstEnv('DEEPSEEK_API_KEY');
    case 'nvidia': return firstEnv('NVIDIA_API_KEY');
    case 'google': return firstEnv('GOOGLE_API_KEY', 'GEMINI_API_KEY');
    case 'glm': return firstEnv('GLM_API_KEY', 'ZHIPUAI_API_KEY');
    default: return undefined;
  }
}

function envWasProvided(): boolean {
  return ENV_KEYS.some((key) => !!process.env[key]?.trim());
}

function envNumber(name: string | string[], min?: number): number | undefined {
  const raw = Array.isArray(name) ? firstEnv(...name) : firstEnv(name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  if (min !== undefined && value < min) return undefined;
  return value;
}

function envFlag(name: string | string[]): boolean | undefined {
  const raw = Array.isArray(name) ? firstEnv(...name) : firstEnv(name);
  if (!raw) return undefined;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return undefined;
}

function envReasoningEffort(name: string | string[]): ReasoningEffort | undefined {
  const raw = Array.isArray(name) ? firstEnv(...name) : firstEnv(name);
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return undefined;
  return (REASONING_EFFORTS as readonly string[]).includes(normalized)
    ? normalized as ReasoningEffort
    : undefined;
}

/**
 * Build a runtime config from environment variables for headless harnesses.
 * This intentionally does not write config.json; it lets benchmark containers
 * run grawkus with `--prompt` from API-key env vars only.
 */
export function loadConfigFromEnv(): GrawkusConfig | null {
  if (!envWasProvided()) return null;

  const inferred = inferProviderFromEnv();
  const explicitBaseURL = firstEnv('GRAWKUS_BASE_URL', 'OLLAMA_BASE_URL');
  const explicitModel = firstEnv('GRAWKUS_MODEL');
  const providerKey = inferred?.providerKey ?? (explicitBaseURL || explicitModel ? 'custom' : null);
  if (!providerKey) return null;

  const preset = PROVIDERS[providerKey];
  const baseURL = explicitBaseURL || preset.baseURL;
  const model = explicitModel || preset.defaultModel;
  const apiKey = inferred?.apiKey || apiKeyForProvider(providerKey) || '';
  const keyRequired = preset.requiresKey && !baseURL.includes('localhost') && !baseURL.includes('127.0.0.1');
  if (keyRequired && !apiKey && providerKey !== 'openai-codex') return null;

  const config: GrawkusConfig = {
    ...DEFAULT_CONFIG,
    apiKey,
    baseURL,
    model,
    provider: preset.name,
    fallbackModel: firstEnv('GRAWKUS_FALLBACK_MODEL'),
  };

  const maxTokens = envNumber('GRAWKUS_MAX_TOKENS', 1);
  if (maxTokens) config.maxTokens = Math.floor(maxTokens);
  const contextWindowTokens = envNumber('GRAWKUS_CONTEXT_WINDOW_TOKENS', 1);
  if (contextWindowTokens) config.contextWindowTokens = Math.floor(contextWindowTokens);
  const maxTurns = envNumber('GRAWKUS_MAX_TURNS', 1);
  if (maxTurns) config.maxTurns = Math.floor(maxTurns);
  const temperature = envNumber('GRAWKUS_TEMPERATURE', 0);
  if (temperature !== undefined) config.temperature = temperature;

  const permission = firstEnv('GRAWKUS_PERMISSION');
  if (permission === 'ask' || permission === 'auto' || permission === 'yolo') {
    config.permissionMode = permission;
  }
  const memoryEnabled = envFlag('GRAWKUS_MEMORY');
  if (memoryEnabled !== undefined) {
    config.memory = { ...(config.memory || {}), enabled: memoryEnabled };
  }
  const showThinking = envFlag('GRAWKUS_SHOW_THINKING');
  if (showThinking !== undefined) config.showThinking = showThinking;
  const reasoningEffort = envReasoningEffort('GRAWKUS_REASONING_EFFORT');
  if (reasoningEffort) config.reasoningEffort = reasoningEffort;
  const theme = firstEnv('GRAWKUS_THEME');
  if (theme === 'full' || theme === 'compact' || theme === 'minimal') config.theme = theme;

  if (providerKey === 'openai-codex') {
    config.openaiAuth = {
      type: 'codex_oauth',
      useCodexAuthFile: true,
      chatgptBaseURL: preset.baseURL,
    };
  }

  validateConfig(config);
  return config;
}

/**
 * Apply per-invocation overrides from CLI/env without mutating config.json.
 * These are intentionally separate from loadConfigFromEnv(): env bootstrap
 * builds a full config for fresh headless containers, while runtime overrides
 * tweak an already-loaded config for harness adapters (`--model`, `--max-turns`,
 * `--base-url`, etc.).
 */
export function applyRuntimeConfigOverrides(config: GrawkusConfig): GrawkusConfig {
  const next: GrawkusConfig = {
    ...config,
    memory: config.memory ? { ...config.memory } : config.memory,
    sandbox: config.sandbox ? { ...config.sandbox } : config.sandbox,
    voice: config.voice ? { ...config.voice } : config.voice,
    openaiAuth: config.openaiAuth ? { ...config.openaiAuth } : config.openaiAuth,
    swarm: config.swarm ? { ...config.swarm } : config.swarm,
    import: config.import ? { ...config.import } : config.import,
    footer: config.footer ? { ...config.footer } : config.footer,
    modelAliases: config.modelAliases ? { ...config.modelAliases } : config.modelAliases,
  };

  const model = firstEnv('GRAWKUS_MODEL_OVERRIDE');
  if (model) next.model = model;
  const fallbackModel = firstEnv('GRAWKUS_FALLBACK_MODEL_OVERRIDE');
  if (fallbackModel) next.fallbackModel = fallbackModel;
  const baseURL = firstEnv('GRAWKUS_BASE_URL_OVERRIDE');
  if (baseURL) next.baseURL = baseURL;
  const apiKey = firstEnv('GRAWKUS_API_KEY_OVERRIDE');
  if (apiKey) next.apiKey = apiKey;
  const apiKeyEnv = firstEnv('GRAWKUS_API_KEY_ENV');
  if (apiKeyEnv && process.env[apiKeyEnv]?.trim()) next.apiKey = process.env[apiKeyEnv]!.trim();

  const maxTokens = envNumber('GRAWKUS_MAX_TOKENS_OVERRIDE', 1);
  if (maxTokens) next.maxTokens = Math.floor(maxTokens);
  const contextWindowTokens = envNumber('GRAWKUS_CONTEXT_WINDOW_TOKENS_OVERRIDE', 1);
  if (contextWindowTokens) next.contextWindowTokens = Math.floor(contextWindowTokens);
  const maxTurns = envNumber('GRAWKUS_MAX_TURNS_OVERRIDE', 1);
  if (maxTurns) next.maxTurns = Math.floor(maxTurns);
  const temperature = envNumber('GRAWKUS_TEMPERATURE_OVERRIDE', 0);
  if (temperature !== undefined) next.temperature = temperature;
  const reasoningEffort = envReasoningEffort('GRAWKUS_REASONING_EFFORT_OVERRIDE');
  if (reasoningEffort) next.reasoningEffort = reasoningEffort;

  validateConfig(next);
  return next;
}

// Track which fields we've already warned about this process. loadConfig()
// is called both from configExists() and from main(), and each invocation
// validates — so without this set we'd print "Warning: Unexpected config
// field: X" twice on every startup. Per-process is the right scope; cross-
// process spam would require persisting the set to disk which isn't worth
// the complexity for a defensive log message.
const _alreadyWarnedFields = new Set<string>();

function validateConfig(config: GrawkusConfig): void {
  // Validate baseURL
  if (config.baseURL && typeof config.baseURL === 'string') {
    try {
      new URL(config.baseURL);
    } catch {
      console.warn(`Warning: Invalid baseURL: ${config.baseURL}`);
      config.baseURL = DEFAULT_CONFIG.baseURL;
    }
  }

  // Validate model
  if (!config.model || typeof config.model !== 'string' || config.model.trim() === '') {
    console.warn('Warning: Invalid model name, using default');
    config.model = DEFAULT_CONFIG.model;
  }

  // Validate permissionMode
  const validModes: GrawkusConfig['permissionMode'][] = ['ask', 'auto', 'yolo'];
  if (!validModes.includes(config.permissionMode)) {
    console.warn(`Warning: Invalid permissionMode: ${config.permissionMode}, using 'ask'`);
    config.permissionMode = 'ask';
  }

  // Warn on unexpected fields
  const expectedFields = new Set(['apiKey', 'apiKeys', 'baseURL', 'model', 'modelAliases', 'fallbackModel', 'provider', 'openaiAuth', 'maxTokens', 'contextWindowTokens', 'maxTurns', 'temperature', 'permissionMode', 'alwaysAllowedTools', 'dryRun', 'theme', 'palette', 'showThinking', 'reasoningEffort', 'voice', 'memory', 'sandbox', 'swarm', 'import', 'footer']);
  for (const key in config) {
    if (!expectedFields.has(key) && !_alreadyWarnedFields.has(key)) {
      _alreadyWarnedFields.add(key);
      console.warn(`Warning: Unexpected config field: ${key}`);
    }
  }
}

export function saveConfig(config: GrawkusConfig): void {
  mkdirSync(resolveConfigDir(), { recursive: true });
  writeFileSync(resolveConfigFile(), JSON.stringify(config, null, 2), 'utf-8');
}

export function configExists(): boolean {
  const cfg = loadConfig();
  return !!(cfg.apiKey || !requiresKey(cfg));
}

function requiresKey(cfg: GrawkusConfig): boolean {
  if (cfg.openaiAuth?.type === 'codex_oauth') return false;
  // Local providers don't need API keys
  return !cfg.baseURL.includes('localhost') && !cfg.baseURL.includes('127.0.0.1');
}
