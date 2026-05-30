import { estimateTokens, inferContextWindowTokens } from './compaction.js';
import type { GrawkusConfig, Message } from './types.js';

export type LifespanLevel = 'low' | 'medium' | 'high';

export interface LifespanDimension {
  id: 'compression' | 'interference' | 'revision' | 'maintenance';
  label: string;
  score: number;
  level: LifespanLevel;
  evidence: string[];
  actions: string[];
}

export interface LifespanReport {
  format: 'grawkus-lifespan-v1';
  version: 1;
  generatedAt: string;
  cwd: string;
  summary: {
    overallScore: number;
    level: LifespanLevel;
    estimatedTokens: number;
    contextWindowTokens: number;
    contextPercent: number;
    messageCount: number;
    userTurns: number;
    assistantTurns: number;
    toolMessages: number;
    toolCalls: number;
    toolErrors: number;
  };
  dimensions: LifespanDimension[];
  nextActions: string[];
}

export interface LifespanFormatOptions {
  json: boolean;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function levelFor(score: number): LifespanLevel {
  if (score >= 67) return 'high';
  if (score >= 34) return 'medium';
  return 'low';
}

function textOf(message: Message): string {
  return typeof message.content === 'string' ? message.content : '';
}

function countMatches(messages: Message[], pattern: RegExp): number {
  let count = 0;
  for (const message of messages) {
    const text = textOf(message);
    if (text && pattern.test(text)) count++;
  }
  return count;
}

function countAllMatches(messages: Message[], pattern: RegExp): number {
  let count = 0;
  for (const message of messages) {
    const text = textOf(message);
    if (!text) continue;
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

function lastUserMessage(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return textOf(messages[i]);
  }
  return '';
}

function firstLines(values: string[], limit: number): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function compactOneLine(value: string, limit = 110): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length <= limit ? oneLine : `${oneLine.slice(0, Math.max(0, limit - 3))}...`;
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function dimension(
  id: LifespanDimension['id'],
  label: string,
  score: number,
  evidence: string[],
  actions: string[],
): LifespanDimension {
  const normalized = clampScore(score);
  return {
    id,
    label,
    score: normalized,
    level: levelFor(normalized),
    evidence: firstLines(evidence, 5),
    actions: firstLines(actions, 5),
  };
}

export function parseLifespanArgs(args: string): LifespanFormatOptions {
  const parts = args.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  return {
    json: parts.some((part, index) =>
      part === '--json'
      || part === 'json'
      || part === 'format=json'
      || part === '--format=json'
      || (part === '--format' && parts[index + 1] === 'json')),
  };
}

export function buildLifespanReport(
  messages: Message[],
  config: Pick<GrawkusConfig, 'model' | 'provider' | 'baseURL' | 'contextWindowTokens' | 'fallbackModel' | 'memory'>,
  cwd: string,
  now = new Date(),
): LifespanReport {
  const estimatedTokens = estimateTokens(messages);
  const contextWindowTokens = inferContextWindowTokens(config);
  const contextPercent = contextWindowTokens > 0 ? estimatedTokens / contextWindowTokens : 0;
  const userTurns = messages.filter((message) => message.role === 'user').length;
  const assistantTurns = messages.filter((message) => message.role === 'assistant').length;
  const toolMessages = messages.filter((message) => message.role === 'tool').length;
  const toolCalls = messages.reduce((sum, message) => sum + (message.tool_calls?.length ?? 0), 0);
  const toolErrors = countMatches(messages, /\b(error|failed|failure|timeout|timed out|exception|traceback|rate limit|429)\b/i);
  const compactedMarkers = countMatches(messages, /(CONVERSATION SUMMARY|context cap|omitted \d+ older messages|compacted \d+)/i);
  const commandTurns = messages.filter((message) => message.role === 'user' && textOf(message).trim().startsWith('/')).length;
  const correctionTurns = countMatches(messages, /\b(actually|instead|change|revise|make it|not that|wrong|should have|shouldn't|doesn't|isn't)\b/i);
  const oldTaskReferences = countAllMatches(messages, /\b(poem|essay|game|config|resume|history|logo|swarm|oauth|openrouter|benchmark|theme)\b/gi);
  const recentUser = compactOneLine(lastUserMessage(messages), 140);
  const providerText = `${config.provider || ''} ${config.baseURL || ''}`.toLowerCase();
  const model = (config.model || '').toLowerCase();
  const isOpenRouter = providerText.includes('openrouter');
  const memoryEnabled = config.memory?.enabled !== false;
  const fallbackEnabled = Boolean(config.fallbackModel && config.fallbackModel !== config.model);

  const dimensions: LifespanDimension[] = [];

  const compressionEvidence = [
    `${estimatedTokens.toLocaleString()} estimated tokens across ${messages.length} messages.`,
    `${Math.round(contextPercent * 100)}% of the inferred ${contextWindowTokens.toLocaleString()} token context window is in use.`,
  ];
  if (compactedMarkers > 0) compressionEvidence.push(`${compactedMarkers} compaction/context-cap marker${compactedMarkers === 1 ? '' : 's'} detected.`);
  if (messages.length > 80) compressionEvidence.push('Long message history increases stale-context and cursor recovery risk.');
  const compressionScore =
    contextPercent * 90
    + Math.max(0, messages.length - 40) * 0.7
    + compactedMarkers * 12;
  dimensions.push(dimension('compression', 'Compression aging', compressionScore, compressionEvidence, [
    '/context dossier <current task> before a large patch or benchmark run.',
    '/fork <name> when starting an unrelated task from an old session.',
    '/history to confirm token growth before another provider call.',
    'Use /clear only when the current thread is no longer needed.',
  ]));

  const interferenceEvidence = [
    `${userTurns} user turn${userTurns === 1 ? '' : 's'}, ${assistantTurns} assistant turn${assistantTurns === 1 ? '' : 's'}, ${toolMessages} tool message${toolMessages === 1 ? '' : 's'}.`,
  ];
  if (oldTaskReferences >= 10) interferenceEvidence.push(`Repeated prior task nouns detected (${oldTaskReferences} hits), which can bleed into the next answer.`);
  if (recentUser) interferenceEvidence.push(`Latest user turn: "${recentUser}"`);
  if (toolCalls > 20) interferenceEvidence.push(`${toolCalls} tool call records are still in the active history.`);
  const interferenceScore =
    Math.max(0, userTurns - 6) * 4
    + Math.max(0, oldTaskReferences - 8) * 2
    + Math.max(0, toolCalls - 12) * 1.5
    + (recentUser.length > 0 && recentUser.length < 30 && userTurns > 4 ? 12 : 0);
  dimensions.push(dimension('interference', 'Interference aging', interferenceScore, interferenceEvidence, [
    '/fork <name> before switching product goals or benchmark targets.',
    '/back to remove accidental or provider-corrupted turns.',
    'Restate the exact target in one sentence before asking for a long generation.',
    '/context brief to re-anchor on the current repo instead of old chat content.',
  ]));

  const revisionEvidence = [
    `${commandTurns} slash-command turn${commandTurns === 1 ? '' : 's'} and ${correctionTurns} correction/revision cue${correctionTurns === 1 ? '' : 's'} detected.`,
  ];
  if (correctionTurns > 4) revisionEvidence.push('Several correction turns suggest the active state may differ from earlier instructions.');
  if (commandTurns > 8) revisionEvidence.push('Many local command turns can make the next model call inherit stale operational context.');
  const revisionScore = correctionTurns * 8 + Math.max(0, commandTurns - 4) * 3;
  dimensions.push(dimension('revision', 'Revision aging', revisionScore, revisionEvidence, [
    '/manifest <target> to state expected files, risks, and verification before edits.',
    '/context dossier <current task> to rebuild a focused local file map.',
    'For UI or behavior rewrites, name the current desired behavior explicitly.',
    '/export md before major rewrites if the prior decisions must be preserved.',
  ]));

  const maintenanceEvidence = [
    `Provider: ${config.provider || 'unknown'}; model: ${config.model || 'unknown'}.`,
    `MemPalace memory is ${memoryEnabled ? 'enabled' : 'disabled'}.`,
  ];
  if (toolErrors > 0) maintenanceEvidence.push(`${toolErrors} error/timeout/rate-limit marker${toolErrors === 1 ? '' : 's'} found in active history.`);
  if (isOpenRouter && !fallbackEnabled) maintenanceEvidence.push('OpenRouter is active without a distinct fallback model.');
  if (isOpenRouter && /:free|openrouter\/free|owl-alpha/.test(model)) maintenanceEvidence.push('Free or experimental OpenRouter model detected; latency and empty responses are more likely.');
  const maintenanceScore =
    toolErrors * 10
    + (memoryEnabled ? 0 : 18)
    + (isOpenRouter && !fallbackEnabled ? 18 : 0)
    + (isOpenRouter && /:free|openrouter\/free|owl-alpha/.test(model) ? 12 : 0);
  dimensions.push(dimension('maintenance', 'Maintenance aging', maintenanceScore, maintenanceEvidence, [
    '/doctor no-registry for local install/config readiness without npm traffic.',
    '/fallback <model-id> when using OpenRouter for interactive work.',
    '/memory status to confirm project/global memory is available.',
    '/openai-login smoke when Codex OAuth should be the primary provider.',
  ]));

  const overallScore = clampScore(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length);
  const nextActions = uniq(
    dimensions
      .filter((item) => item.level !== 'low')
      .sort((a, b) => b.score - a.score)
      .flatMap((item) => item.actions.slice(0, 2)),
  ).slice(0, 6);

  return {
    format: 'grawkus-lifespan-v1',
    version: 1,
    generatedAt: now.toISOString(),
    cwd,
    summary: {
      overallScore,
      level: levelFor(overallScore),
      estimatedTokens,
      contextWindowTokens,
      contextPercent,
      messageCount: messages.length,
      userTurns,
      assistantTurns,
      toolMessages,
      toolCalls,
      toolErrors,
    },
    dimensions,
    nextActions,
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatActionBlock(actions: string[]): string[] {
  if (actions.length === 0) return ['  Actions: none required right now.'];
  return ['  Actions:', ...actions.map((action) => `  - ${action}`)];
}

export function formatLifespanReport(report: LifespanReport, options: LifespanFormatOptions = { json: false }): string {
  if (options.json) return JSON.stringify(report, null, 2);

  const lines: string[] = [
    '',
    '  Grawkus Lifespan Diagnostic',
    '',
    `  Overall: ${report.summary.level} (${report.summary.overallScore}/100)`,
    `  Window: ~${report.summary.estimatedTokens.toLocaleString()} / ${report.summary.contextWindowTokens.toLocaleString()} tokens (${formatPercent(report.summary.contextPercent)})`,
    `  Turns: ${report.summary.userTurns} user / ${report.summary.assistantTurns} assistant / ${report.summary.toolMessages} tool`,
    '',
  ];

  for (const item of report.dimensions) {
    lines.push(`  ${item.label}: ${item.level} (${item.score}/100)`);
    for (const evidence of item.evidence) lines.push(`  - ${evidence}`);
    lines.push(...formatActionBlock(item.actions.slice(0, item.level === 'low' ? 1 : 3)));
    lines.push('');
  }

  if (report.nextActions.length > 0) {
    lines.push('  Next actions:');
    for (const action of report.nextActions) lines.push(`  - ${action}`);
    lines.push('');
  }

  lines.push('  Frame: compression, interference, revision, and maintenance aging for long-running agent sessions.');
  return lines.join('\n');
}
