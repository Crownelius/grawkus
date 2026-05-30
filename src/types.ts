import type OpenAI from 'openai';

// ── Messages ──────────────────────────────────────────────
export type Role = 'system' | 'user' | 'assistant' | 'tool';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface Message {
  role: Role;
  content: string | null;
  // OpenAI v6+ split ChatCompletionMessageToolCall into a union of function
  // and custom variants. We only emit function tools, so narrow here.
  tool_calls?: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[];
  tool_call_id?: string;
  name?: string;
}

// ── Config ────────────────────────────────────────────────
export interface GrawkusConfig {
  apiKey: string;
  // Optional pool of API keys (e.g. multiple OpenRouter free-tier accounts).
  // When present, the client rotates through them on 429/401, isolating
  // each key's rate-limit / quota state. The single `apiKey` field above
  // remains the primary; `apiKeys` is the rotation pool. If both are set,
  // `apiKey` is used as the first entry of the effective pool.
  apiKeys?: string[];
  baseURL: string;
  model: string;
  modelAliases?: Record<string, string>; // user-defined short names resolved by /model
  fallbackModel?: string;  // tried automatically once when the primary model errors with an empty/unknown provider error
  provider: string;        // display name: "OpenRouter", "GLM", "Ollama", etc.
  openaiAuth?: OpenAIAuthConfig; // OpenAI API key vs ChatGPT/Codex OAuth
  maxTokens: number;
  contextWindowTokens?: number; // optional prompt+completion window override for context capping
  temperature: number;
  // Optional per-chain tool-call iteration cap. Default behavior (when
  // omitted or 0) is unlimited — the chain runs until the model stops
  // calling tools, the user cancels, or the stream-loop detector fires.
  // Set to a finite number for unattended sessions where a runaway
  // would burn unbounded API cost.
  maxTurns?: number;
  permissionMode: 'ask' | 'auto' | 'yolo';  // ask=prompt, auto=safe-only, yolo=all
  alwaysAllowedTools?: string[];           // per-tool persistent allowlist populated when user types "always"
  dryRun?: boolean;        // when true, show what tools WOULD execute without running them
  theme?: 'full' | 'compact' | 'minimal';   // startup display mode (layout density)
  palette?: string;        // color palette id (Coolors trending schemes) — see src/theme.ts
  showThinking?: boolean;  // when true, display model reasoning/thinking tokens
  reasoningEffort?: ReasoningEffort; // request-level reasoning effort; usually set as a one-shot override
  voice?: VoiceConfig;     // accessibility: STT (Whisper) + TTS (ElevenLabs) + screen-reader mode
  memory?: MemoryConfig;   // MemPalace-style persistent memory (wings/rooms/drawers/tunnels/KG)
  sandbox?: SandboxConfig; // OS-native sandbox wrap for bash tool (Seatbelt/bwrap)
  swarm?: SwarmConfig;     // defaults for /swarm role selection and setup wizard
  footer?: FooterConfig;   // fixed-bottom terminal footer and opening prompt behavior
  import?: ImportConfig;   // cross-agent migration defaults (/import + startup sync)
}

export interface OpenAIAuthConfig {
  type: 'api_key' | 'codex_oauth';
  /** CODEX_HOME override for reading Codex CLI auth; defaults to $CODEX_HOME or ~/.codex. */
  codexHome?: string;
  /** Codex OAuth calls use the ChatGPT Codex Responses backend. */
  chatgptBaseURL?: string;
  /** Read tokens from Codex CLI auth.json at request time instead of storing them here. */
  useCodexAuthFile?: boolean;
}

// ── Sandbox config ───────────────────────────────────────
// Defense-in-depth on top of the execpolicy DSL. When enabled, bash
// commands run inside an OS-native sandbox (sandbox-exec on macOS,
// bwrap on Linux). Default OFF — most workflows don't want the
// restrictions, and the execpolicy intent gate already catches the
// highest-risk commands.
export interface SandboxConfig {
  /** off (no wrap) | standard (cwd + /tmp writable, net allowed) | strict (cwd-only) */
  level?: 'off' | 'standard' | 'strict';
}

// ── MemPalace memory config ──────────────────────────────
// Lives at ~/.grawkus/memory/store.json (global) and
// <cwd>/.grawkus/memory/store.json (project). When disabled, the
// memory_* tools are NOT registered with the model (no wasted tokens)
// and the system prompt's memory section is omitted.
export interface MemoryConfig {
  enabled?: boolean;        // default true; user can opt out during setup or /memory disable
  globalScope?: boolean;    // default true — cross-project knowledge enabled
  projectScope?: boolean;   // default true — per-repo knowledge enabled
}

// ── Voice / accessibility config ─────────────────────────
// All voice features are off by default. Enable end-to-end via /voice on or
// /voice config. The three sub-blocks split cleanly along their concerns:
// stt = dictation (user speaks → text into the prompt buffer), tts = readout
// (assistant + optional user-echo), accessibility = output-mode + cues + UX.
// Swarm config. These are defaults for /swarm, not replacements for the
// per-task setup fields inferred from the user's natural-language task.
export interface SwarmConfig {
  setupWizard?: boolean;
  maxAgents?: number;
  defaultBudget?: string;
  defaultTarget?: string;
  defaultAssets?: string;
  defaultQuality?: string;
}

export interface FooterConfig {
  enabled?: boolean;        // default true in interactive TTYs
  template?: string;        // optional custom status row; supports {provider}, {model}, {mode}, etc.
  openingPrompt?: string;   // editable draft for the first prompt after startup; default /model
}

export interface ImportConfig {
  defaultSource?: 'auto' | 'claude' | 'codex' | 'mempalace';
  autoSyncOnStartup?: boolean; // default false
  syncLimit?: number;          // default 200
}

export interface VoiceConfig {
  enabled?: boolean;
  stt?: VoiceSttConfig;
  tts?: VoiceTtsConfig;
  accessibility?: VoiceAccessibilityConfig;
}

export interface VoiceSttConfig {
  apiKey?: string;        // OpenAI key for Whisper. Falls back to top-level apiKey if absent.
  baseURL?: string;       // default https://api.openai.com/v1
  model?: string;         // default 'whisper-1'
  dictationKey?: string;  // 'F5' (default) — push-to-talk toggle. Bare F-keys avoid NVDA/JAWS Insert-modifier conflicts.
  autoSubmit?: boolean;   // if true, hitting stop-dictation submits the message
}

export interface VoiceTtsConfig {
  apiKey?: string;            // ElevenLabs key (separate from STT)
  baseURL?: string;           // default https://api.elevenlabs.io/v1
  model?: string;             // 'eleven_turbo_v2_5' (default) | 'eleven_flash_v2_5' | 'eleven_multilingual_v2'
  assistantVoiceId?: string;  // default '21m00Tcm4TlvDq8ikWAM' (Rachel)
  userVoiceId?: string;       // default 'AZnzlk1XvdvUeBnXmlld'  (Domi) — distinct voice for echoed user input
  echoUser?: boolean;         // when true, user messages are also TTS'd in userVoiceId
  skipCode?: boolean;         // when true, code blocks are stripped before TTS (default true)
  speed?: number;             // 0.25 – 4.0, default 1.0
  stability?: number;         // ElevenLabs voice setting, 0.0 – 1.0, default 0.5
  similarityBoost?: number;   // ElevenLabs voice setting, 0.0 – 1.0, default 0.75
}

export interface VoiceAccessibilityConfig {
  screenReader?: boolean;          // strip ANSI + emoji; replace symbols with words for NVDA/JAWS/VoiceOver
  audioCues?: boolean;             // beeps for state transitions (ready, recording, processing, done, error)
  announceErrors?: boolean;        // TTS the error category + fix line on every API error
  announceModeSwitches?: boolean;  // TTS when /mode <name> fires
  askBeforeDestructive?: boolean;  // verbal confirmation before destructive tool calls
  longResponseThreshold?: number;  // word count; over this, agent asks "summary or full read?" (default 300)
}

// ── Provider presets ──────────────────────────────────────
export interface ProviderPreset {
  name: string;
  baseURL: string;
  defaultModel: string;
  requiresKey: boolean;
}

export const PROVIDERS: Record<string, ProviderPreset> = {
  anthropic: {
    name: 'Anthropic (Claude)',
    baseURL: 'https://api.anthropic.com/v1/',
    defaultModel: 'claude-sonnet-4-20250514',
    requiresKey: true,
  },
  openai: {
    name: 'OpenAI (GPT)',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    requiresKey: true,
  },
  'openai-codex': {
    name: 'OpenAI Codex (OAuth)',
    baseURL: 'https://chatgpt.com/backend-api/codex',
    defaultModel: 'gpt-5.5',
    requiresKey: false,
  },
  openrouter: {
    name: 'OpenRouter (Any Model)',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    requiresKey: true,
  },
  google: {
    name: 'Google (Gemini)',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.5-flash',
    requiresKey: true,
  },
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    requiresKey: true,
  },
  ollama: {
    name: 'Ollama (Local)',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder:latest',
    requiresKey: false,
  },
  lmstudio: {
    name: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    defaultModel: 'loaded-model',
    requiresKey: false,
  },
  glm: {
    name: 'GLM (ZhipuAI)',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    requiresKey: true,
  },
  nvidia: {
    name: 'NVIDIA NIM',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    // meta/llama-3.1-70b-instruct is the most-reliable widely-available
    // default on build.nvidia.com's free tier as of 2026. Users can switch
    // to nvidia/nemotron-4-340b-instruct, qwen/qwen-2.5-coder-32b-instruct,
    // deepseek-ai/deepseek-coder-6.7b-instruct, or any of the ~100 models
    // exposed at /v1/chat/completions via /model.
    defaultModel: 'meta/llama-3.1-70b-instruct',
    requiresKey: true,
  },
  custom: {
    name: 'Custom',
    baseURL: '',
    defaultModel: '',
    requiresKey: true,
  },
};
