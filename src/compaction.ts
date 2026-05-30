/**
 * Context compaction — auto-summarize old messages when context grows large.
 * Keeps recent messages intact, summarizes older ones to free token space.
 */
import chalk from 'chalk';
import type { Message, GrawkusConfig } from './types.js';
import { streamChat } from './api.js';
import { ALL_TOOLS } from './tools/index.js';
import { getCachedOpenRouterModelContextLength, isOpenRouterFreeModelId } from './openrouter-models.js';

/**
 * Estimate tokens accounting for content type and message overhead.
 * - English prose: ~3.5 chars per token
 * - Code: ~3 chars per token (more special chars)
 * - Message overhead: ~4 tokens per message for role/structure
 */
export function estimateTokens(messages: Message[]): number {
  let tokens = 0;

  for (const m of messages) {
    // Add message overhead (role, message structure, etc)
    tokens += 4;

    if (typeof m.content === 'string' && m.content) {
      // Detect if content is code (common code indicators)
      const isCode = /^(```|  |  \t|function|class|def|const|let|var|import|export|fn |pub |async|await)/m.test(m.content);
      const charsPerToken = isCode ? 3 : 3.5;
      tokens += Math.ceil(m.content.length / charsPerToken);
    }

    if (m.tool_calls) {
      const toolJson = JSON.stringify(m.tool_calls);
      // Tool calls are structured data (mostly code), use 3 chars per token
      tokens += Math.ceil(toolJson.length / 3);
    }
  }

  return tokens;
}

export interface CompactionConfig {
  enabled: boolean;
  triggerTokens: number;      // compact when estimated tokens exceed this
  keepRecentMessages: number;  // always keep this many recent messages
  targetTokens: number;        // target token count after compaction
}

export const DEFAULT_COMPACTION: CompactionConfig = {
  enabled: true,
  triggerTokens: 80_000,    // ~80k tokens triggers compaction
  keepRecentMessages: 10,   // keep last 10 messages verbatim
  targetTokens: 20_000,     // aim to reduce to ~20k tokens
};

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
export const OPENROUTER_FREE_ROUTER_SAFE_CONTEXT_WINDOW_TOKENS = 128_000;
export const OPENROUTER_UNKNOWN_FREE_MODEL_CONTEXT_WINDOW_TOKENS = 32_768;
export const ROLLING_COMPACTION_MAX_TRIGGER_TOKENS = 60_000;
export const ROLLING_COMPACTION_CONTEXT_FRACTION = 0.5;
export const LOCAL_COMPACTION_SUMMARY_MAX_LINES = 80;
export const DEFAULT_COMPACTION_SUMMARY_MAX_TOKENS = 2_048;

export interface ContextCapResult {
  messages: Message[];
  changed: boolean;
  droppedMessages: number;
  beforeTokens: number;
  afterTokens: number;
  maxAllowedTokens: number;
}

export function contextCapTokens(contextWindowTokens: number): number {
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
    return Math.floor(DEFAULT_CONTEXT_WINDOW_TOKENS * 0.8);
  }
  return Math.floor(Math.max(contextWindowTokens - 40_000, contextWindowTokens * 0.8));
}

export function inferContextWindowTokens(config: Pick<GrawkusConfig, 'model' | 'contextWindowTokens'>): number {
  const explicit = Number(config.contextWindowTokens);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const env = Number(process.env.GRAWKUS_CONTEXT_WINDOW_TOKENS || process.env.GRAWKUS_CONTEXT_WINDOW);
  if (Number.isFinite(env) && env > 0) return env;

  const model = config.model.toLowerCase();
  if (model === 'openrouter/free') {
    return OPENROUTER_FREE_ROUTER_SAFE_CONTEXT_WINDOW_TOKENS;
  }

  const cachedOpenRouterContext = getCachedOpenRouterModelContextLength(model);
  if (cachedOpenRouterContext && cachedOpenRouterContext > 0) {
    return cachedOpenRouterContext;
  }

  if (isOpenRouterFreeModelId(model)) {
    return OPENROUTER_UNKNOWN_FREE_MODEL_CONTEXT_WINDOW_TOKENS;
  }

  if (model.includes('gemini')) return 1_000_000;
  if (model.includes('gpt-4.1')) return 1_000_000;
  if (model.includes('claude')) return 200_000;
  if (model.includes('glm-4-long')) return 128_000;
  if (model.includes('deepseek')) return 128_000;
  if (model.includes('qwen')) return 128_000;
  if (model.includes('gpt-4o')) return 128_000;
  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}

function positiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function envString(name: string): string | undefined {
  const value = process.env[name];
  if (!value || !value.trim()) return undefined;
  return value.trim();
}

function envFlag(name: string): boolean | undefined {
  const value = envString(name);
  if (!value) return undefined;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return undefined;
}

export function compactionTriggerTokens(
  config: Pick<GrawkusConfig, 'model' | 'contextWindowTokens'>,
  base: CompactionConfig = DEFAULT_COMPACTION,
): number {
  const override = positiveIntegerEnv('GRAWKUS_COMPACTION_TRIGGER_TOKENS');
  if (override) return override;

  const contextWindow = inferContextWindowTokens(config);
  const rollingTrigger = Math.floor(contextWindow * ROLLING_COMPACTION_CONTEXT_FRACTION);
  return Math.max(1, Math.min(
    base.triggerTokens,
    ROLLING_COMPACTION_MAX_TRIGGER_TOKENS,
    rollingTrigger,
  ));
}

export function buildCompactionConfig(
  config: Pick<GrawkusConfig, 'model' | 'contextWindowTokens'>,
  base: CompactionConfig = DEFAULT_COMPACTION,
): CompactionConfig {
  return {
    ...base,
    triggerTokens: compactionTriggerTokens(config, base),
  };
}

export function enforceContextCap(messages: Message[], maxAllowedTokens: number): ContextCapResult {
  const beforeTokens = estimateTokens(messages);
  if (beforeTokens <= maxAllowedTokens) {
    return {
      messages,
      changed: false,
      droppedMessages: 0,
      beforeTokens,
      afterTokens: beforeTokens,
      maxAllowedTokens,
    };
  }

  const firstUserIdx = messages.findIndex((m) => m.role === 'user');
  const anchorEnd = firstUserIdx >= 0 ? firstUserIdx + 1 : 0;
  const anchor = messages.slice(0, anchorEnd);
  const rest = messages.slice(anchorEnd);
  const chunks = chunkForContextCap(rest);
  const kept: Message[][] = [];
  let droppedMessages = 0;

  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const candidate = buildCappedMessages(anchor, chunks.slice(0, i), [chunk, ...kept], maxAllowedTokens);
    const candidateTokens = estimateTokens(candidate);
    if (candidateTokens <= maxAllowedTokens || kept.length === 0) {
      kept.unshift(chunk);
    } else {
      droppedMessages += countMessages(chunk);
    }
  }

  const capped = buildCappedMessages(anchor, [], kept, maxAllowedTokens, droppedMessages);
  const afterTokens = estimateTokens(capped);
  return {
    messages: capped,
    changed: true,
    droppedMessages,
    beforeTokens,
    afterTokens,
    maxAllowedTokens,
  };
}

function buildCappedMessages(
  anchor: Message[],
  droppedChunks: Message[][],
  keptChunks: Message[][],
  maxAllowedTokens: number,
  knownDroppedMessages?: number,
): Message[] {
  const dropped = knownDroppedMessages ?? droppedChunks.reduce((sum, chunk) => sum + countMessages(chunk), 0);
  const notice: Message[] = dropped > 0
    ? [{
        role: 'assistant',
        content:
          `[context cap: omitted ${dropped} older message${dropped === 1 ? '' : 's'} ` +
          `to keep the API request under ~${maxAllowedTokens.toLocaleString()} tokens. ` +
          `Use targeted read/grep/search tools if you need earlier details.]`,
      }]
    : [];
  return [...anchor, ...notice, ...keptChunks.flat()];
}

function chunkForContextCap(messages: Message[]): Message[][] {
  const chunks: Message[][] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      const ids = new Set(m.tool_calls.map((tc) => tc.id));
      const chunk: Message[] = [m];
      i++;
      while (i < messages.length && messages[i].role === 'tool') {
        const toolId = messages[i].tool_call_id;
        if (toolId && !ids.has(toolId)) break;
        chunk.push(messages[i]);
        i++;
      }
      chunks.push(chunk);
      continue;
    }

    if (
      m.role === 'user'
      && i + 1 < messages.length
      && messages[i + 1].role === 'assistant'
      && !messages[i + 1].tool_calls
    ) {
      chunks.push([m, messages[i + 1]]);
      i += 2;
      continue;
    }

    chunks.push([m]);
    i++;
  }
  return chunks;
}

function countMessages(messages: Message[]): number {
  return messages.length;
}

export function shouldCompact(messages: Message[], config: CompactionConfig): boolean {
  if (!config.enabled) return false;
  return estimateTokens(messages) > config.triggerTokens;
}

export function getCompactionStats(
  messages: Message[],
  config: Pick<GrawkusConfig, 'model' | 'contextWindowTokens'> = { model: '' },
): {
  messageCount: number;
  estimatedTokens: number;
  needsCompaction: boolean;
  triggerTokens: number;
} {
  const tokens = estimateTokens(messages);
  const triggerTokens = compactionTriggerTokens(config);
  return {
    messageCount: messages.length,
    estimatedTokens: tokens,
    needsCompaction: tokens > triggerTokens,
    triggerTokens,
  };
}

export interface CompactionPartition {
  pinnedPrefix: Message[];
  oldMessages: Message[];
  recentMessages: Message[];
  pinnedFirstUser: boolean;
}

function adjustedRecentStart(messages: Message[], keepRecentMessages: number): number {
  const keepCount = Math.max(0, Math.floor(keepRecentMessages));
  let start = Math.max(0, messages.length - keepCount);

  while (start > 0 && messages[start]?.role === 'tool') {
    const toolCallId = messages[start].tool_call_id;
    if (!toolCallId) break;
    let assistantIdx = -1;
    for (let i = start - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.tool_calls?.some((tc) => tc.id === toolCallId)) {
        assistantIdx = i;
        break;
      }
    }
    if (assistantIdx < 0) break;
    start = assistantIdx;
  }

  return start;
}

export function partitionMessagesForCompaction(
  messages: Message[],
  keepRecentMessages: number,
): CompactionPartition {
  const recentStart = adjustedRecentStart(messages, keepRecentMessages);
  const firstUserIdx = messages.findIndex((m) => m.role === 'user');
  const pinnedFirstUser = firstUserIdx >= 0 && firstUserIdx < recentStart;
  const pinnedPrefix = pinnedFirstUser ? [messages[firstUserIdx]] : [];
  const oldMessages = messages.filter((_, idx) => idx < recentStart && idx !== firstUserIdx);
  const recentMessages = messages.slice(recentStart);

  return {
    pinnedPrefix,
    oldMessages,
    recentMessages,
    pinnedFirstUser,
  };
}

export function buildCompactedMessages(
  summary: string,
  partition: CompactionPartition,
): Message[] {
  return [
    ...partition.pinnedPrefix,
    {
      role: 'assistant',
      content: `<<CONVERSATION SUMMARY - ${partition.oldMessages.length} messages compacted>>\n${summary}`,
    },
    ...partition.recentMessages,
  ];
}

function truncateOneLine(value: string, limit: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= limit) return oneLine;
  if (limit <= 3) return oneLine.slice(0, limit);
  const head = Math.ceil((limit - 3) * 0.6);
  const tail = Math.floor((limit - 3) * 0.4);
  return `${oneLine.slice(0, head)}...${oneLine.slice(-tail)}`;
}

function pushLimited(target: string[], value: string, max: number): void {
  const compact = truncateOneLine(value, max);
  if (compact) target.push(compact);
}

function collectFileHints(text: string, files: Set<string>): void {
  const matches = text.match(
    /(?:[A-Za-z]:[\\/][^\s"'`<>|]+|(?:\.{1,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+|[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|rs|go|java|cpp|c|h|hpp|cs|rb|php|sh|yml|yaml|toml|lock))/g,
  );
  if (!matches) return;
  for (const match of matches) {
    const cleaned = match.replace(/[),.;:]+$/, '');
    if (cleaned.length <= 160) files.add(cleaned);
  }
}

function inspectToolArguments(rawArgs: string, files: Set<string>): void {
  try {
    const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
    for (const key of ['file_path', 'path', 'cwd', 'dir', 'url']) {
      const value = parsed[key];
      if (typeof value === 'string') files.add(value);
    }
    const command = parsed.command;
    if (typeof command === 'string') collectFileHints(command, files);
  } catch {
    collectFileHints(rawArgs, files);
  }
}

export function buildLocalCompactionSummary(oldMessages: Message[]): string {
  const userRequests: string[] = [];
  const assistantNotes: string[] = [];
  const toolErrors: string[] = [];
  const files = new Set<string>();
  const toolCounts = new Map<string, number>();
  const roleCounts = new Map<string, number>();

  for (const m of oldMessages) {
    roleCounts.set(m.role, (roleCounts.get(m.role) ?? 0) + 1);
    if (typeof m.content === 'string') {
      collectFileHints(m.content, files);
    }

    if (m.role === 'user' && typeof m.content === 'string') {
      pushLimited(userRequests, m.content, 260);
    } else if (m.role === 'assistant') {
      if (typeof m.content === 'string' && m.content.trim()) {
        pushLimited(assistantNotes, m.content, 260);
      }
      for (const tc of m.tool_calls ?? []) {
        toolCounts.set(tc.function.name, (toolCounts.get(tc.function.name) ?? 0) + 1);
        inspectToolArguments(tc.function.arguments, files);
      }
    } else if (m.role === 'tool' && typeof m.content === 'string') {
      if (/(\berror\b|failed|timed out|timeout|exception|traceback)/i.test(m.content)) {
        pushLimited(toolErrors, m.content, 240);
      }
    }
  }

  const counts = [...roleCounts.entries()]
    .map(([role, count]) => `${role}=${count}`)
    .join(', ');
  const tools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, count]) => `${name} x${count}`);
  const fileList = [...files].slice(0, 24);
  const latestUsers = userRequests.slice(-10);
  const latestAssistant = assistantNotes.slice(-8);
  const latestErrors = toolErrors.slice(-8);

  const lines: string[] = [
    'Local fallback summary (LLM summarization unavailable).',
    `Compacted ${oldMessages.length} older messages${counts ? ` (${counts})` : ''}.`,
  ];
  if (latestUsers.length > 0) {
    lines.push('Recent user requests from compacted history:');
    latestUsers.forEach((item, i) => lines.push(`  ${i + 1}. ${item}`));
  }
  if (latestAssistant.length > 0) {
    lines.push('Recent assistant notes from compacted history:');
    latestAssistant.forEach((item, i) => lines.push(`  ${i + 1}. ${item}`));
  }
  if (tools.length > 0) {
    lines.push(`Tool calls seen: ${tools.join(', ')}.`);
  }
  if (fileList.length > 0) {
    lines.push(`File/path hints: ${fileList.join(', ')}.`);
  }
  if (latestErrors.length > 0) {
    lines.push('Recent errors/timeouts from compacted history:');
    latestErrors.forEach((item, i) => lines.push(`  ${i + 1}. ${item}`));
  }
  lines.push('Treat this as a compressed navigation aid; re-read files or rerun targeted commands before relying on exact details.');

  return lines.slice(0, LOCAL_COMPACTION_SUMMARY_MAX_LINES).join('\n');
}

function localCompactionFallbackEnabled(): boolean {
  return process.env.GRAWKUS_LOCAL_COMPACTION_FALLBACK !== '0';
}

function llmCompactionEnabled(): boolean {
  const mode = envString('GRAWKUS_COMPACTION_MODE')?.toLowerCase();
  if (mode === 'local' || mode === 'deterministic') return false;
  return envFlag('GRAWKUS_LLM_COMPACTION') !== false;
}

function shouldUseFallbackModelForCompaction(config: GrawkusConfig): boolean {
  if (!config.fallbackModel || config.fallbackModel === config.model) return false;
  const override = envFlag('GRAWKUS_COMPACTION_USE_FALLBACK');
  if (override !== undefined) return override;

  const provider = `${config.provider} ${config.baseURL}`.toLowerCase();
  return provider.includes('openrouter');
}

export function buildCompactionSummaryConfig(config: GrawkusConfig): GrawkusConfig {
  const model =
    envString('GRAWKUS_COMPACTION_MODEL') ||
    (shouldUseFallbackModelForCompaction(config) ? config.fallbackModel : undefined) ||
    config.model;
  const maxTokens = positiveIntegerEnv('GRAWKUS_COMPACTION_MAX_TOKENS')
    ?? Math.min(config.maxTokens, DEFAULT_COMPACTION_SUMMARY_MAX_TOKENS);

  return {
    ...config,
    model,
    maxTokens,
  };
}

function finalizeCompaction(messages: Message[], partition: CompactionPartition, summary: string): Message[] {
  const compactedMessages = buildCompactedMessages(summary, partition);
  const oldTokens = estimateTokens(messages);
  const newTokens = estimateTokens(compactedMessages);
  console.log(
    chalk.green(
      `  [compaction] Reduced: ~${oldTokens.toLocaleString()} → ~${newTokens.toLocaleString()} tokens (${Math.round((1 - newTokens / oldTokens) * 100)}% reduction)`,
    ),
  );
  return compactedMessages;
}

/**
 * Compact messages by summarizing older ones with the AI model.
 * Returns a new messages array with a summary + recent messages.
 */
export async function compactMessages(
  messages: Message[],
  config: GrawkusConfig,
  compactionConfig: CompactionConfig = DEFAULT_COMPACTION,
): Promise<Message[]> {
  if (messages.length <= compactionConfig.keepRecentMessages) {
    return messages;
  }

  const partition = partitionMessagesForCompaction(messages, compactionConfig.keepRecentMessages);
  const { oldMessages } = partition;
  if (oldMessages.length === 0) {
    return messages;
  }

  if (!llmCompactionEnabled()) {
    console.log(chalk.dim(`  [compaction] Using local summary (LLM compaction disabled)...`));
    return finalizeCompaction(messages, partition, buildLocalCompactionSummary(oldMessages));
  }

  console.log(chalk.dim(`  [compaction] Summarizing ${oldMessages.length} old messages...`));
  const summaryConfig = buildCompactionSummaryConfig(config);

  // Build a summary request
  const summaryPrompt: Message[] = [
    {
      role: 'system',
      content: `You are a conversation summarizer. Summarize the following conversation between a user and an AI coding assistant.
Focus on:
- The original user task and any later changes in task scope
- What files were read, created, or modified
- Key decisions made
- Current state of the work
- Important context the assistant needs to continue

Be concise but thorough. Output a structured summary.`,
    },
    {
      role: 'user',
      content: oldMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => `[${m.role}]: ${typeof m.content === 'string' ? m.content?.slice(0, 2000) : '(tool call)'}`)
        .join('\n\n'),
    },
  ];

  try {
    let summary = '';
    for await (const event of streamChat(summaryConfig, summaryPrompt, [])) {
      if (event.type === 'text' && event.content) {
        summary += event.content;
      }
    }

    if (!summary) {
      if (localCompactionFallbackEnabled()) {
        console.log(chalk.yellow('  [compaction] Summary generation returned no text; using local fallback'));
        return finalizeCompaction(messages, partition, buildLocalCompactionSummary(oldMessages));
      }
      console.log(chalk.yellow('  [compaction] Summary generation failed, keeping messages'));
      return messages;
    }

    // Build compacted message array
    // Use 'assistant' role instead of 'system' since some providers ignore system messages mid-conversation
    return finalizeCompaction(messages, partition, summary);
  } catch (err: unknown) {
    console.log(chalk.yellow(`  [compaction] Error: ${err instanceof Error ? err.message : err}`));
    if (localCompactionFallbackEnabled()) {
      console.log(chalk.yellow('  [compaction] Using local fallback summary'));
      return finalizeCompaction(messages, partition, buildLocalCompactionSummary(oldMessages));
    }
    return messages;
  }
}

/**
 * Quick local compaction without API call — just truncates tool results.
 */
export const QUICK_TOOL_OUTPUT_TRIGGER_CHARS = 5_000;
export const QUICK_TOOL_OUTPUT_HEAD_CHARS = 2_000;
export const QUICK_TOOL_OUTPUT_TAIL_CHARS = 2_000;

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}

export function compactLargeToolOutput(
  content: string,
  triggerChars = QUICK_TOOL_OUTPUT_TRIGGER_CHARS,
  headChars = QUICK_TOOL_OUTPUT_HEAD_CHARS,
  tailChars = QUICK_TOOL_OUTPUT_TAIL_CHARS,
): string {
  if (content.length <= triggerChars) return content;

  const headSize = Math.max(0, Math.min(headChars, content.length));
  const tailSize = Math.max(0, Math.min(tailChars, content.length - headSize));
  const head = content.slice(0, headSize);
  const tail = tailSize > 0 ? content.slice(-tailSize) : '';
  const omittedChars = content.length - headSize - tailSize;
  const notice = [
    `[tool output truncated: ${omittedChars.toLocaleString()} chars omitted from the middle; ` +
      `original was ${content.length.toLocaleString()} chars across ${lineCount(content).toLocaleString()} lines.]`,
    `Showing first ${headSize.toLocaleString()} chars and last ${tailSize.toLocaleString()} chars.`,
    'Run a narrower command or targeted read if the omitted middle is needed.',
  ].join('\n');

  return `${head}\n\n${notice}\n\n${tail}`;
}

export function quickCompact(messages: Message[]): Message[] {
  return messages.map((m) => {
    if (m.role === 'tool' && typeof m.content === 'string') {
      const compacted = compactLargeToolOutput(m.content);
      if (compacted !== m.content) return { ...m, content: compacted };
    }
    return m;
  });
}
