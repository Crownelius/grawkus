/**
 * Cost/token tracker — tracks usage per session and cumulative.
 * Stores data in ~/.grawkus/usage.json
 * Supports budget limits and alerts.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getConfigDir } from './config.js';

function getUsageFile(): string {
  return join(getConfigDir(), 'usage.json');
}

// Cost per 1M tokens (input/output) for common models via OpenRouter
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // OpenRouter free tier/router
  'openrouter/free': { input: 0, output: 0 },
  // Anthropic
  'anthropic/claude-sonnet-4': { input: 3.0, output: 15.0 },
  'anthropic/claude-opus-4': { input: 15.0, output: 75.0 },
  'anthropic/claude-haiku-4': { input: 0.8, output: 4.0 },
  // OpenAI
  'openai/gpt-4o': { input: 2.5, output: 10.0 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/o3-mini': { input: 1.1, output: 4.4 },
  // Google
  'google/gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'google/gemini-2.5-flash': { input: 0.15, output: 0.6 },
  // DeepSeek
  'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek/deepseek-reasoner': { input: 0.55, output: 2.19 },
  // Meta
  'meta-llama/llama-4-maverick': { input: 0.2, output: 0.6 },
  // GLM
  'glm-4-plus': { input: 1.0, output: 1.0 },
  // Defaults for unknown models
  _default: { input: 1.0, output: 3.0 },
};

export interface UsageEntry {
  timestamp: string;
  sessionId: string;
  provider?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number; // USD
  firstTokenMs?: number;
  durationMs?: number;
}

export interface UsageData {
  entries: UsageEntry[];
  budget: {
    dailyLimit: number;   // USD, 0 = no limit
    monthlyLimit: number; // USD, 0 = no limit
    alertThreshold: number; // 0-1, alert at this % of limit
  };
  totals: {
    allTimeTokens: number;
    allTimeCost: number;
  };
}

function loadUsage(): UsageData {
  const usageFile = getUsageFile();
  if (!existsSync(usageFile)) {
    return {
      entries: [],
      budget: { dailyLimit: 0, monthlyLimit: 0, alertThreshold: 0.8 },
      totals: { allTimeTokens: 0, allTimeCost: 0 },
    };
  }
  try {
    return JSON.parse(readFileSync(usageFile, 'utf-8'));
  } catch {
    return {
      entries: [],
      budget: { dailyLimit: 0, monthlyLimit: 0, alertThreshold: 0.8 },
      totals: { allTimeTokens: 0, allTimeCost: 0 },
    };
  }
}

function saveUsage(data: UsageData): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(getUsageFile(), JSON.stringify(data, null, 2), 'utf-8');
}

export function getModelCost(model: string): { input: number; output: number } {
  if (model === 'openrouter/free' || model.endsWith(':free')) return { input: 0, output: 0 };
  // Try exact match first, then partial
  if (MODEL_COSTS[model]) return MODEL_COSTS[model];
  for (const [key, cost] of Object.entries(MODEL_COSTS)) {
    if (model.includes(key) || key.includes(model)) return cost;
  }
  return MODEL_COSTS._default;
}

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs = getModelCost(model);
  return (promptTokens * costs.input + completionTokens * costs.output) / 1_000_000;
}

export function trackUsage(
  sessionId: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  metadata: {
    provider?: string;
    firstTokenMs?: number | null;
    durationMs?: number | null;
  } = {},
): { cost: number; warning?: string; entry: UsageEntry } {
  const data = loadUsage();
  const cost = estimateCost(model, promptTokens, completionTokens);

  const entry: UsageEntry = {
    timestamp: new Date().toISOString(),
    sessionId,
    provider: metadata.provider,
    model,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedCost: cost,
    firstTokenMs: finiteOptional(metadata.firstTokenMs),
    durationMs: finiteOptional(metadata.durationMs),
  };

  data.entries.push(entry);
  data.totals.allTimeTokens += entry.totalTokens;
  data.totals.allTimeCost += cost;

  // Prune entries older than 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  data.entries = data.entries.filter((e) => new Date(e.timestamp) > cutoff);

  saveUsage(data);

  // Check budget
  let warning: string | undefined;
  const today = new Date().toISOString().slice(0, 10);
  const todayCost = data.entries
    .filter((e) => e.timestamp.startsWith(today))
    .reduce((sum, e) => sum + e.estimatedCost, 0);

  const month = new Date().toISOString().slice(0, 7);
  const monthCost = data.entries
    .filter((e) => e.timestamp.startsWith(month))
    .reduce((sum, e) => sum + e.estimatedCost, 0);

  if (data.budget.dailyLimit > 0 && todayCost >= data.budget.dailyLimit) {
    warning = `Daily budget exceeded: $${todayCost.toFixed(4)} / $${data.budget.dailyLimit}`;
  } else if (data.budget.monthlyLimit > 0 && monthCost >= data.budget.monthlyLimit) {
    warning = `Monthly budget exceeded: $${monthCost.toFixed(4)} / $${data.budget.monthlyLimit}`;
  } else if (
    data.budget.dailyLimit > 0 &&
    todayCost >= data.budget.dailyLimit * data.budget.alertThreshold
  ) {
    warning = `Approaching daily limit: $${todayCost.toFixed(4)} / $${data.budget.dailyLimit}`;
  }

  return { cost, warning, entry };
}

export interface UsagePeriodSummary {
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  calls: number;
  averageFirstTokenMs: number | null;
  averageDurationMs: number | null;
}

export interface UsageSummary {
  today: UsagePeriodSummary;
  month: UsagePeriodSummary;
  allTime: { tokens: number; cost: number };
  session: UsagePeriodSummary;
  last: UsageEntry | null;
  budget: UsageData['budget'];
}

export function getUsageSummary(sessionId?: string): UsageSummary {
  const data = loadUsage();
  const today = new Date().toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);

  const todayEntries = data.entries.filter((e) => e.timestamp.startsWith(today));
  const monthEntries = data.entries.filter((e) => e.timestamp.startsWith(month));
  const sessionEntries = sessionId
    ? data.entries.filter((e) => e.sessionId === sessionId)
    : [];
  const last = sessionEntries.at(-1) ?? data.entries.at(-1) ?? null;

  return {
    today: summarizeEntries(todayEntries),
    month: summarizeEntries(monthEntries),
    allTime: { tokens: data.totals.allTimeTokens, cost: data.totals.allTimeCost },
    session: summarizeEntries(sessionEntries),
    last,
    budget: data.budget,
  };
}

export function setBudget(daily: number, monthly: number, threshold = 0.8): void {
  const data = loadUsage();
  data.budget = { dailyLimit: daily, monthlyLimit: monthly, alertThreshold: threshold };
  saveUsage(data);
}

export function printUsageSummary(sessionId?: string): void {
  const s = getUsageSummary(sessionId);
  console.log(chalk.cyan('\n  Usage Summary'));
  if (sessionId) {
    console.log(chalk.dim(`  Session:  ${s.session.tokens.toLocaleString()} tokens | $${s.session.cost.toFixed(4)} | ${s.session.calls} calls${formatLatencySummary(s.session)}`));
  }
  console.log(chalk.dim(`  Today:    ${s.today.tokens.toLocaleString()} tokens | $${s.today.cost.toFixed(4)} | ${s.today.calls} calls`));
  console.log(chalk.dim(`  Month:    ${s.month.tokens.toLocaleString()} tokens | $${s.month.cost.toFixed(4)} | ${s.month.calls} calls`));
  console.log(chalk.dim(`  All-time: ${s.allTime.tokens.toLocaleString()} tokens | $${s.allTime.cost.toFixed(4)}`));
  if (s.last) {
    const provider = s.last.provider ? `${s.last.provider} | ` : '';
    console.log(chalk.dim(
      `  Last:     ${provider}${s.last.model} | ${s.last.totalTokens.toLocaleString()} tokens | $${s.last.estimatedCost.toFixed(4)}` +
      `${formatLastLatency(s.last)}`,
    ));
  }
  if (s.budget.dailyLimit > 0) {
    console.log(chalk.dim(`  Budget:   $${s.budget.dailyLimit}/day, $${s.budget.monthlyLimit}/month`));
  }
  console.log();
}

function summarizeEntries(entries: UsageEntry[]): UsagePeriodSummary {
  const firstTokenValues = entries
    .map((e) => e.firstTokenMs)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const durationValues = entries
    .map((e) => e.durationMs)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return {
    tokens: entries.reduce((s, e) => s + e.totalTokens, 0),
    promptTokens: entries.reduce((s, e) => s + e.promptTokens, 0),
    completionTokens: entries.reduce((s, e) => s + e.completionTokens, 0),
    cost: entries.reduce((s, e) => s + e.estimatedCost, 0),
    calls: entries.length,
    averageFirstTokenMs: average(firstTokenValues),
    averageDurationMs: average(durationValues),
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finiteOptional(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function formatLatencySummary(summary: UsagePeriodSummary): string {
  const bits: string[] = [];
  if (summary.averageFirstTokenMs !== null) bits.push(`avg first ${formatMs(summary.averageFirstTokenMs)}`);
  if (summary.averageDurationMs !== null) bits.push(`avg turn ${formatMs(summary.averageDurationMs)}`);
  return bits.length ? ` | ${bits.join(', ')}` : '';
}

function formatLastLatency(entry: UsageEntry): string {
  const bits: string[] = [];
  if (typeof entry.firstTokenMs === 'number') bits.push(`first ${formatMs(entry.firstTokenMs)}`);
  if (typeof entry.durationMs === 'number') bits.push(`turn ${formatMs(entry.durationMs)}`);
  return bits.length ? ` | ${bits.join(', ')}` : '';
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export const _internal = {
  getUsageFile,
  summarizeEntries,
};
