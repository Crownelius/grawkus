import OpenAI from 'openai';
import type { GrawkusConfig, Message } from './types.js';
import type { Tool } from './tools/types.js';
import { type RetryConfig, withRetry } from './retry.js';
import { setPool, pickKey, reportFailure, reportSuccess, poolSize } from './key-rotation.js';
import {
  getOpenAICodexBaseURL,
  isOpenAICodexOAuth,
  openAICodexAuthInstructions,
  resolveOpenAICodexAuth,
} from './openai-oauth.js';

let client: OpenAI | null = null;
let lastConfigHash = '';
let lastClientKey = '';   // which key the current client was built with

function configHash(config: GrawkusConfig): string {
  // The client cache key depends on the CURRENT pool key, not the config
  // apiKey, so a rotation picks a fresh client without re-checking config.
  const poolKeys = (config.apiKeys || []).join(',');
  const auth = config.openaiAuth
    ? `${config.openaiAuth.type}:${config.openaiAuth.codexHome || ''}:${config.openaiAuth.chatgptBaseURL || ''}`
    : '';
  return `${config.baseURL}:${config.apiKey}:${poolKeys}:${auth}`;
}

/**
 * Sync the rotation pool with the latest config. Called from getClient
 * on every request so /config or env-var changes flow through.
 */
function syncPool(config: GrawkusConfig): void {
  if (isOpenAICodexOAuth(config)) {
    setPool('', []);
    return;
  }
  setPool(config.apiKey, config.apiKeys || []);
}

export function getClient(config: GrawkusConfig): OpenAI {
  syncPool(config);
  if (isOpenAICodexOAuth(config)) {
    const auth = resolveOpenAICodexAuth(config);
    if (!auth) {
      throw new Error(openAICodexAuthInstructions(config));
    }
    const activeKey = auth.accessToken;
    const hash = configHash(config);
    if (!client || hash !== lastConfigHash || activeKey !== lastClientKey) {
      const defaultHeaders: Record<string, string> = {
        originator: 'grawkus',
        version: 'grawkus',
      };
      if (auth.accountId) defaultHeaders['ChatGPT-Account-ID'] = auth.accountId;
      client = new OpenAI({
        apiKey: activeKey,
        baseURL: getOpenAICodexBaseURL(config),
        defaultHeaders,
      });
      lastConfigHash = hash;
      lastClientKey = activeKey;
    }
    return client;
  }

  // Pick the current key from the pool (round-robin, skipping cool keys).
  // Falls back to config.apiKey when the pool is empty or all keys are
  // cool — the original request will fail with a clear error in that
  // case, which is the right behavior.
  const activeKey = pickKey() || config.apiKey;
  const hash = configHash(config);
  if (!client || hash !== lastConfigHash || activeKey !== lastClientKey) {
    const isAnthropic = config.baseURL.includes('anthropic.com');

    client = new OpenAI({
      apiKey: activeKey || 'not-needed',
      baseURL: config.baseURL,
      ...(isAnthropic ? {
        defaultHeaders: {
          'x-api-key': activeKey,
          'anthropic-version': '2023-06-01',
        },
      } : {}),
    });
    lastConfigHash = hash;
    lastClientKey = activeKey;
  }
  return client;
}

/**
 * Same as getClient but explicitly reports the active key in use, so
 * callers (streamChat) can attribute success/failure back to the
 * specific key for rotation health-tracking.
 */
export function getClientWithKey(config: GrawkusConfig): { client: OpenAI; activeKey: string } {
  const c = getClient(config);
  return { client: c, activeKey: lastClientKey };
}

export function resetClient(): void {
  client = null;
  lastConfigHash = '';
  lastClientKey = '';
}

/** Re-export so callers (index.ts /keys) can introspect pool status. */
export { reportFailure, reportSuccess, poolSize } from './key-rotation.js';

export function toolsToFunctions(tools: Tool[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as unknown as Record<string, unknown>,
    },
  }));
}

export function toolsToResponsesTools(tools: Tool[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters as unknown as Record<string, unknown>,
    strict: false,
  }));
}

export function messagesToResponsesInput(messages: Message[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      if (m.tool_call_id) {
        input.push({
          type: 'function_call_output',
          call_id: m.tool_call_id,
          output: m.content ?? '',
        });
      }
      continue;
    }

    const content = m.content ?? '';
    if (content) {
      input.push({
        type: 'message',
        role: m.role,
        content,
      });
    }

    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments || '{}',
        });
      }
    }
  }

  return input;
}

export function messagesToResponsesInstructions(messages: Message[]): string {
  const instructions = messages
    .filter((m) => m.role === 'system' && m.content?.trim())
    .map((m) => m.content!.trim())
    .join('\n\n');
  return instructions || 'You are Grawkus, terminal coding agents with a mind for the whole repo.';
}

export function buildCodexResponsesRequest(
  config: GrawkusConfig,
  messages: Message[],
  tools: Tool[],
): Record<string, unknown> {
  const toolDefs = toolsToResponsesTools(tools);

  // The ChatGPT Codex OAuth backend is Responses-like, but stricter than
  // api.openai.com: it requires `instructions` and currently rejects common
  // public Responses parameters such as temperature and max_output_tokens.
  return {
    model: config.model,
    instructions: messagesToResponsesInstructions(messages),
    input: messagesToResponsesInput(messages),
    tools: toolDefs.length > 0 ? toolDefs : undefined,
    stream: true,
    store: false,
    parallel_tool_calls: true,
  };
}

export function shouldRequestChatStreamUsage(
  config: Pick<GrawkusConfig, 'baseURL'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = env.GRAWKUS_STREAM_USAGE;
  if (override && /^(0|false|off|no)$/i.test(override)) return false;
  if (override && /^(1|true|on|yes)$/i.test(override)) return true;

  const baseURL = String(config.baseURL || '').toLowerCase();
  if (/\b(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)\b/.test(baseURL)) return false;
  return [
    'openrouter.ai',
    'api.openai.com',
    'api.deepseek.com',
    'integrate.api.nvidia.com',
    'generativelanguage.googleapis.com',
    'open.bigmodel.cn',
  ].some((host) => baseURL.includes(host));
}

export function buildChatCompletionsRequest(
  config: GrawkusConfig,
  messages: Message[],
  tools: Tool[],
): Record<string, unknown> {
  const toolDefs = toolsToFunctions(tools);
  const request: Record<string, unknown> = {
    model: config.model,
    messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
    tools: toolDefs.length > 0 ? toolDefs : undefined,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: true,
    stream_options: shouldRequestChatStreamUsage(config)
      ? { include_usage: true }
      : undefined,
  };
  if (config.reasoningEffort) {
    request.reasoning_effort = config.reasoningEffort;
  }
  return request;
}

function envInteger(name: string, env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env[name];
  if (!raw || !raw.trim()) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

export function resolveChatRetryConfig(
  _config: Pick<GrawkusConfig, 'baseURL'>,
  env: NodeJS.ProcessEnv = process.env,
): RetryConfig {
  const explicitRetries = envInteger('GRAWKUS_API_RETRIES', env);
  return {
    maxRetries: explicitRetries ?? (env.GRAWKUS_NON_INTERACTIVE === '1' ? 2 : 0),
    baseDelay: envInteger('GRAWKUS_API_RETRY_BASE_MS', env) ?? 500,
    maxDelay: envInteger('GRAWKUS_API_RETRY_MAX_MS', env) ?? 5000,
  };
}

type StreamChatEvent = {
  type: 'text' | 'thinking' | 'tool_call' | 'done';
  content?: string;
  toolCalls?: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[];
  usage?: { prompt: number; completion: number; total: number };
};

export async function* streamChat(
  config: GrawkusConfig,
  messages: Message[],
  tools: Tool[],
  signal?: AbortSignal,
): AsyncGenerator<StreamChatEvent> {
  if (isOpenAICodexOAuth(config)) {
    yield* streamResponsesChat(config, messages, tools, signal);
    return;
  }

  // Capture the active key so we can attribute success/failure to it
  // for the rotation health tracker. Multi-key users (multiple OpenRouter
  // accounts) get automatic round-robin when a key 429s or exhausts quota.
  const { client: api, activeKey } = getClientWithKey(config);

  // Bail early if the caller already cancelled before we even started
  if (signal?.aborted) throw new Error('Aborted before stream start');

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  try {
    stream = await withRetry(
      () =>
        api.chat.completions.create(
          buildChatCompletionsRequest(config, messages, tools) as never,
          signal ? { signal } : undefined,
        ),
      resolveChatRetryConfig(config),
    ) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  } catch (err) {
    // Hand the failure to the rotation pool so subsequent calls skip
    // this key for the cool-down window. Re-throw so the outer error
    // handling (auto-fallback model, error UI) still fires.
    if (activeKey && poolSize() > 1) reportFailure(activeKey, err);
    throw err;
  }
  // If we get this far, the request was at least accepted — record success.
  // (We don't wait for completion; mid-stream errors are vanishingly rare
  // for OpenAI-compatible APIs vs upfront 4xx/5xx).
  if (activeKey && poolSize() > 1) reportSuccess(activeKey);

  let currentText = '';
  const toolCallAccumulator: Map<number, {
    id: string;
    function: { name: string; arguments: string };
  }> = new Map();

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    // Reasoning/thinking content (DeepSeek, OpenRouter reasoning models, etc.)
    // The field is `reasoning_content` on some providers, or nested in delta
    const deltaAny = delta as Record<string, unknown>;
    const reasoning = deltaAny.reasoning_content || deltaAny.thinking || deltaAny.reasoning;
    if (reasoning && typeof reasoning === 'string') {
      yield { type: 'thinking', content: reasoning };
    }

    // Text content
    if (delta.content) {
      currentText += delta.content;
      yield { type: 'text', content: delta.content };
    }

    // Tool calls (streamed incrementally)
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallAccumulator.has(idx)) {
          toolCallAccumulator.set(idx, {
            id: tc.id || '',
            function: { name: '', arguments: '' },
          });
        }
        const acc = toolCallAccumulator.get(idx)!;
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.function.name += tc.function.name;
        if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
      }
    }

    // Check for finish
    const finishReason = chunk.choices?.[0]?.finish_reason;
    if (finishReason) {
      if (toolCallAccumulator.size > 0) {
        const toolCalls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] = [];
        for (const [, tc] of toolCallAccumulator) {
          toolCalls.push({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          });
        }
        yield { type: 'tool_call', toolCalls };
      }

      yield {
        type: 'done',
        usage: chunk.usage
          ? {
              prompt: chunk.usage.prompt_tokens,
              completion: chunk.usage.completion_tokens,
              total: chunk.usage.total_tokens,
            }
          : undefined,
      };
    }
  }
}

async function* streamResponsesChat(
  config: GrawkusConfig,
  messages: Message[],
  tools: Tool[],
  signal?: AbortSignal,
): AsyncGenerator<StreamChatEvent> {
  const { client: api } = getClientWithKey(config);

  if (signal?.aborted) throw new Error('Aborted before stream start');

  let stream;
  try {
    stream = await withRetry(
      () =>
        api.responses.create(
          buildCodexResponsesRequest(config, messages, tools) as never,
          signal ? { signal } : undefined,
        ) as never,
      resolveChatRetryConfig(config),
    );
  } catch (err) {
    throw err;
  }

  const toolCallAccumulator: Map<number, {
    id: string;
    name: string;
    arguments: string;
    itemId?: string;
  }> = new Map();

  const getAcc = (outputIndex: number, itemId?: string) => {
    if (!toolCallAccumulator.has(outputIndex)) {
      toolCallAccumulator.set(outputIndex, {
        id: '',
        name: '',
        arguments: '',
        itemId,
      });
    }
    const acc = toolCallAccumulator.get(outputIndex)!;
    if (itemId) acc.itemId = itemId;
    return acc;
  };

  for await (const event of stream as unknown as AsyncIterable<Record<string, unknown>>) {
    switch (event.type) {
      case 'response.output_text.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) yield { type: 'text', content: delta };
        break;
      }
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) yield { type: 'thinking', content: delta };
        break;
      }
      case 'response.output_item.added':
      case 'response.output_item.done': {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === 'function_call') {
          const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0;
          const acc = getAcc(outputIndex, typeof item.id === 'string' ? item.id : undefined);
          if (typeof item.call_id === 'string') acc.id = item.call_id;
          if (typeof item.name === 'string') acc.name = item.name;
          if (typeof item.arguments === 'string') acc.arguments = item.arguments;
        }
        break;
      }
      case 'response.function_call_arguments.delta': {
        const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0;
        const acc = getAcc(outputIndex, typeof event.item_id === 'string' ? event.item_id : undefined);
        if (typeof event.delta === 'string') acc.arguments += event.delta;
        break;
      }
      case 'response.function_call_arguments.done': {
        const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0;
        const acc = getAcc(outputIndex, typeof event.item_id === 'string' ? event.item_id : undefined);
        if (typeof event.name === 'string') acc.name = event.name;
        if (typeof event.arguments === 'string') acc.arguments = event.arguments;
        break;
      }
      case 'response.completed': {
        const toolCalls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] = [];
        for (const [, tc] of toolCallAccumulator) {
          if (!tc.name) continue;
          toolCalls.push({
            id: tc.id || tc.itemId || `call_${toolCalls.length}`,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments || '{}' },
          });
        }
        if (toolCalls.length > 0) {
          yield { type: 'tool_call', toolCalls };
        }

        const response = event.response as { usage?: {
          input_tokens?: number;
          output_tokens?: number;
          total_tokens?: number;
        } } | undefined;
        const usage = response?.usage;
        yield {
          type: 'done',
          usage: usage
            ? {
                prompt: usage.input_tokens ?? 0,
                completion: usage.output_tokens ?? 0,
                total: usage.total_tokens ?? 0,
              }
            : undefined,
        };
        break;
      }
      case 'response.failed': {
        const response = event.response as { error?: { message?: string } } | undefined;
        throw new Error(response?.error?.message || 'OpenAI Responses API request failed');
      }
      case 'error': {
        const message = typeof event.message === 'string' ? event.message : 'OpenAI Responses API stream error';
        throw new Error(message);
      }
    }
  }
}
