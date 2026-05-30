/**
 * Model router - cost-aware model selection.
 * Routes to cheaper models for simple tasks, expensive for complex ones.
 */
import chalk from 'chalk';
import type { GrawkusConfig } from './types.js';
import { getModelCost } from './cost-tracker.js';

export interface ModelOption {
  id: string;
  tier: 'fast' | 'balanced' | 'powerful';
  description: string;
}

export type ModelTier = 'fast' | 'balanced' | 'powerful';
export type TaskComplexity = 'simple' | 'medium' | 'complex';
export type RouteRole =
  | 'auto'
  | 'fast'
  | 'balanced'
  | 'powerful'
  | 'coding'
  | 'analysis'
  | 'review'
  | 'verification';

// Provider-specific model tiers
const MODEL_TIERS: Record<string, ModelOption[]> = {
  openrouter: [
    { id: 'openrouter/free', tier: 'fast', description: 'Free Models Router - zero-cost, auto-selected' },
    { id: 'openrouter/free', tier: 'balanced', description: 'Free Models Router - zero-cost, tool-aware' },
    { id: 'openrouter/free', tier: 'powerful', description: 'Free Models Router - zero-cost, best available' },
  ],
  openai: [
    { id: 'gpt-4o-mini', tier: 'fast', description: 'GPT-4o Mini' },
    { id: 'gpt-4o', tier: 'balanced', description: 'GPT-4o' },
    { id: 'o3-mini', tier: 'powerful', description: 'o3-mini (reasoning)' },
  ],
  glm: [
    { id: 'glm-4-flash', tier: 'fast', description: 'GLM-4 Flash' },
    { id: 'glm-4-plus', tier: 'balanced', description: 'GLM-4 Plus' },
    { id: 'glm-4-long', tier: 'powerful', description: 'GLM-4 Long (128k context)' },
  ],
  deepseek: [
    { id: 'deepseek-chat', tier: 'fast', description: 'DeepSeek Chat - fast' },
    { id: 'deepseek-reasoner', tier: 'powerful', description: 'DeepSeek Reasoner - R1' },
  ],
  ollama: [
    { id: 'qwen2.5-coder:latest', tier: 'fast', description: 'Qwen 2.5 Coder (local)' },
    { id: 'deepseek-coder-v2:latest', tier: 'balanced', description: 'DeepSeek Coder v2 (local)' },
    { id: 'llama3.3:latest', tier: 'powerful', description: 'Llama 3.3 (local)' },
  ],
};

const ROLE_TOKENS = new Map<string, Exclude<RouteRole, 'auto'>>([
  ['fast', 'fast'],
  ['quick', 'fast'],
  ['balanced', 'balanced'],
  ['normal', 'balanced'],
  ['standard', 'balanced'],
  ['powerful', 'powerful'],
  ['strong', 'powerful'],
  ['reasoning', 'powerful'],
  ['coding', 'coding'],
  ['code', 'coding'],
  ['build', 'coding'],
  ['analysis', 'analysis'],
  ['analyze', 'analysis'],
  ['debug', 'analysis'],
  ['review', 'review'],
  ['reviewer', 'review'],
  ['verification', 'verification'],
  ['verify', 'verification'],
  ['checks', 'verification'],
  ['check', 'verification'],
]);

const ROLE_TO_TIER_MAP: Record<
  Exclude<RouteRole, 'auto' | 'fast' | 'balanced' | 'powerful'>,
  Record<TaskComplexity, ModelTier>
> = {
  coding: {
    simple: 'fast',
    medium: 'balanced',
    complex: 'powerful',
  },
  analysis: {
    simple: 'balanced',
    medium: 'powerful',
    complex: 'powerful',
  },
  review: {
    simple: 'balanced',
    medium: 'powerful',
    complex: 'powerful',
  },
  verification: {
    simple: 'balanced',
    medium: 'balanced',
    complex: 'powerful',
  },
};

/**
 * Parse role from /route arguments.
 */
export function parseRouteRole(raw: string): RouteRole {
  const token = raw.trim().toLowerCase().split(/\s+/)[0];
  if (!token || token === 'auto') return 'auto';
  return ROLE_TOKENS.get(token) ?? 'auto';
}

/**
 * Validate /route role text.
 */
export function isValidRouteRole(raw: string): boolean {
  if (!raw.trim()) return true;
  const role = parseRouteRole(raw);
  return role !== 'auto' || raw.trim().toLowerCase() === 'auto';
}

function tierFromRole(role: RouteRole, complexity: TaskComplexity): ModelTier {
  if (role === 'fast' || role === 'balanced' || role === 'powerful') return role;
  if (role === 'auto') {
    const defaultMap: Record<TaskComplexity, ModelTier> = {
      simple: 'fast',
      medium: 'balanced',
      complex: 'powerful',
    };
    return defaultMap[complexity];
  }
  return ROLE_TO_TIER_MAP[role][complexity];
}

/**
 * Classify task complexity from the user's message.
 */
export function classifyComplexity(message: string): TaskComplexity {
  const lower = message.toLowerCase();

  // Simple: short messages, single operations, questions
  const simpleSignals = [
    /^(what|how|why|where|when|who|which|list|show|print|explain)\b/,
    /^(read|cat|ls|find|search|grep|look)\b/,
    /\?([\s]*$)/,
    /^(yes|no|ok|sure|thanks|y|n)\b/i,
  ];
  if (message.length < 100 && simpleSignals.some((r) => r.test(lower))) {
    return 'simple';
  }

  // Complex: multi-step, architecture, large changes
  const complexSignals = [
    /\b(refactor|rewrite|architect|redesign|migrate|implement|build|create .+ system)\b/,
    /\b(entire|whole|all files|full|complete|comprehensive)\b/,
    /\b(performance|security audit|review all|test all)\b/,
    /and\b.*\band\b.*\band\b/,
  ];
  if (complexSignals.some((r) => r.test(lower))) {
    return 'complex';
  }

  return 'medium';
}

/**
 * Map provider display names to tier keys
 */
function getProviderKey(displayName: string): string {
  const map: Record<string, string> = {
    'openrouter': 'openrouter',
    'glm (zhipuai)': 'glm',
    'glm': 'glm',
    'ollama (local)': 'ollama',
    'ollama': 'ollama',
    'lm studio': 'lmstudio',
    'lmstudio': 'lmstudio',
    'openai': 'openai',
    'deepseek': 'deepseek',
    'custom': 'custom',
  };

  const key = displayName.toLowerCase();
  if (key.includes('openrouter')) return 'openrouter';
  if (key.includes('openai')) return 'openai';
  if (key.includes('deepseek')) return 'deepseek';
  if (key.includes('ollama')) return 'ollama';
  return map[key] || key.replace(/[^a-z]/g, '');
}

/**
 * Suggest the best model for a given complexity and provider.
 */
export function routeModel(
  config: GrawkusConfig,
  complexity: TaskComplexity,
  role: RouteRole = 'auto',
): { model: string; reason: string } {
  const provider = getProviderKey(config.provider);
  const tiers = MODEL_TIERS[provider];

  if (!tiers) {
    return { model: config.model, reason: 'No routing available for this provider' };
  }

  const targetTier = tierFromRole(role, complexity);
  const match = tiers.find((m) => m.tier === targetTier);

  if (!match) {
    return { model: config.model, reason: 'No matching model tier' };
  }

  const cost = getModelCost(match.id);
  const roleText = role === 'auto' ? 'auto' : `role:${role}`;
  return {
    model: match.id,
    reason: `${complexity} task (${roleText}) -> ${match.description} ($${cost.input}/$${cost.output} per 1M tokens)`,
  };
}

export function printModelOptions(config: GrawkusConfig): void {
  const provider = getProviderKey(config.provider);
  const tiers = MODEL_TIERS[provider] || [];

  console.log(chalk.cyan(`\n  Models for ${config.provider}:`));
  const current = config.model;
  for (const m of tiers) {
    const marker = m.id === current ? chalk.green(' * current') : '';
    const cost = getModelCost(m.id);
    console.log(
      chalk.white(`  ${m.tier.padEnd(10)}`) +
        chalk.dim(`${m.id.padEnd(35)} $${cost.input}/$${cost.output} per 1M`) +
        marker,
    );
  }
  console.log();
}

/**
 * Switch to a model by name or tier.
 */
export function switchModel(config: GrawkusConfig, nameOrTier: string): string | null {
  const provider = getProviderKey(config.provider);
  const tiers = MODEL_TIERS[provider] || [];

  // Try exact match first
  const exact = tiers.find((m) => m.id === nameOrTier);
  if (exact) return exact.id;

  // Try tier match
  const tier = tiers.find((m) => m.tier === nameOrTier);
  if (tier) return tier.id;

  // Try partial match
  const partial = tiers.find((m) => m.id.includes(nameOrTier) || m.description.toLowerCase().includes(nameOrTier.toLowerCase()));
  if (partial) return partial.id;

  return null;
}
