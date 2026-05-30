import type { GrawkusConfig } from './types.js';
import { streamChat, resetClient } from './api.js';
import {
  CHATGPT_CODEX_BASE_URL,
  getOpenAICodexAuthStatus,
  type OpenAICodexAuthStatus,
} from './openai-oauth.js';
import { PROVIDERS } from './types.js';

type StreamChatFn = typeof streamChat;

export interface OpenAICodexSmokeResult {
  ok: boolean;
  phase: 'auth' | 'request' | 'stream';
  model: string;
  baseURL: string;
  auth: Pick<OpenAICodexAuthStatus,
    'available' | 'source' | 'authPath' | 'hasAccountId' | 'accessTokenExpiresAt' | 'accessTokenExpired' | 'error'
  >;
  elapsedMs: number;
  eventCount: number;
  text: string;
  usage?: { prompt: number; completion: number; total: number };
  error?: string;
}

interface SmokeOptions {
  model?: string;
  timeoutMs?: number;
  stream?: StreamChatFn;
}

function isCodexConfigured(config: GrawkusConfig): boolean {
  return config.openaiAuth?.type === 'codex_oauth'
    || config.provider === PROVIDERS['openai-codex'].name
    || config.baseURL.includes('chatgpt.com/backend-api/codex');
}

function smokeConfig(config: GrawkusConfig, modelOverride?: string): GrawkusConfig {
  const model = modelOverride
    || (isCodexConfigured(config) && config.model ? config.model : PROVIDERS['openai-codex'].defaultModel);
  return {
    ...config,
    apiKey: '',
    baseURL: CHATGPT_CODEX_BASE_URL,
    model,
    provider: PROVIDERS['openai-codex'].name,
    openaiAuth: {
      type: 'codex_oauth',
      useCodexAuthFile: true,
      codexHome: config.openaiAuth?.codexHome,
      chatgptBaseURL: CHATGPT_CODEX_BASE_URL,
    },
  };
}

function publicAuthStatus(status: OpenAICodexAuthStatus): OpenAICodexSmokeResult['auth'] {
  return {
    available: status.available,
    source: status.source,
    authPath: status.authPath,
    hasAccountId: status.hasAccountId,
    accessTokenExpiresAt: status.accessTokenExpiresAt,
    accessTokenExpired: status.accessTokenExpired,
    error: status.error,
  };
}

export async function runOpenAICodexSmokeTest(
  config: GrawkusConfig,
  options: SmokeOptions = {},
): Promise<OpenAICodexSmokeResult> {
  const cfg = smokeConfig(config, options.model);
  const started = Date.now();
  const authStatus = getOpenAICodexAuthStatus(cfg);
  const baseResult = {
    model: cfg.model,
    baseURL: cfg.baseURL,
    auth: publicAuthStatus(authStatus),
  };

  if (!authStatus.available) {
    return {
      ...baseResult,
      ok: false,
      phase: 'auth',
      elapsedMs: Date.now() - started,
      eventCount: 0,
      text: '',
      error: authStatus.error || 'OpenAI Codex OAuth token is unavailable',
    };
  }

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), options.timeoutMs ?? 30_000);
  timeout.unref?.();
  const stream = options.stream ?? streamChat;
  let eventCount = 0;
  let doneSeen = false;
  let text = '';
  let usage: OpenAICodexSmokeResult['usage'];

  try {
    resetClient();
    for await (const event of stream(cfg, [
      { role: 'system', content: 'Reply only with OAuth smoke OK.' },
      { role: 'user', content: 'Say exactly: OAuth smoke OK' },
    ], [], ac.signal)) {
      eventCount++;
      if (event.type === 'text' && event.content) text += event.content;
      if (event.type === 'done') {
        doneSeen = true;
        usage = event.usage;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...baseResult,
      ok: false,
      phase: eventCount > 0 ? 'stream' : 'request',
      elapsedMs: Date.now() - started,
      eventCount,
      text,
      usage,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }

  const normalized = text.trim();
  const ok = doneSeen && normalized.includes('OAuth smoke OK');
  return {
    ...baseResult,
    ok,
    phase: 'stream',
    elapsedMs: Date.now() - started,
    eventCount,
    text: normalized,
    usage,
    error: ok
      ? undefined
      : doneSeen
        ? `Unexpected smoke response: ${normalized || '(empty)'}`
        : 'Stream ended before a done event',
  };
}

export function formatOpenAICodexSmokeResult(result: OpenAICodexSmokeResult): string {
  const lines = [
    `OpenAI Codex OAuth smoke: ${result.ok ? 'PASS' : 'FAIL'}`,
    `  Model: ${result.model}`,
    `  Auth: ${result.auth.available ? 'available' : 'missing'}${result.auth.source ? ` (${result.auth.source})` : ''}`,
    `  Account ID: ${result.auth.hasAccountId ? 'present' : 'missing'}`,
    `  Stream: ${result.eventCount} event(s), ${result.elapsedMs}ms`,
  ];
  if (result.auth.accessTokenExpiresAt) lines.push(`  Token expires: ${result.auth.accessTokenExpiresAt}`);
  if (result.text) lines.push(`  Text: ${result.text.slice(0, 120)}`);
  if (result.usage) lines.push(`  Usage: ${result.usage.prompt}->${result.usage.completion} tokens`);
  if (!result.ok) {
    lines.push(`  Phase: ${result.phase}`);
    if (result.error) lines.push(`  Error: ${result.error}`);
    lines.push(`  Fix: run /openai-login or "codex login", then retry /openai-login smoke.`);
  }
  return lines.join('\n');
}
