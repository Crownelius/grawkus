import type { GrawkusConfig, ReasoningEffort } from './types.js';
import { switchModel } from './model-router.js';

export interface ModelResolution {
  model: string;
  source: 'user-alias' | 'builtin-alias' | 'tier' | 'direct';
  alias?: string;
}

export interface ModelTurnOverride {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  source: string;
}

export interface ParsedModelOnce {
  override?: ModelTurnOverride;
  error?: string;
}

export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

const RESERVED_ALIAS_NAMES = new Set([
  'alias',
  'aliases',
  'unalias',
  'rm',
  'remove',
  'delete',
  'set',
  'once',
  'next',
  'effort',
  'reasoning',
  'off',
  'none',
]);

const BUILTIN_ALIASES: Array<{
  alias: string;
  model: string;
  description: string;
  provider?: RegExp;
}> = [
  {
    alias: 'free',
    model: 'openrouter/free',
    description: 'OpenRouter free router',
    provider: /openrouter/i,
  },
  {
    alias: 'or-free',
    model: 'openrouter/free',
    description: 'OpenRouter free router',
    provider: /openrouter/i,
  },
  {
    alias: 'openrouter-free',
    model: 'openrouter/free',
    description: 'OpenRouter free router',
    provider: /openrouter/i,
  },
];

function aliasKey(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidModelAliasName(value: string): boolean {
  const key = aliasKey(value);
  return /^[a-z][a-z0-9._-]{0,63}$/i.test(key) && !RESERVED_ALIAS_NAMES.has(key);
}

export function normalizeReasoningEffort(value: string | undefined): ReasoningEffort | null {
  const key = String(value || '').trim().toLowerCase();
  return (REASONING_EFFORTS as readonly string[]).includes(key) ? key as ReasoningEffort : null;
}

export function tokenizeModelCommandArgs(args: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(args)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

export function listModelAliases(config: GrawkusConfig): Array<{
  alias: string;
  model: string;
  source: 'user' | 'builtin';
  description?: string;
}> {
  const user = Object.entries(config.modelAliases || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([alias, model]) => ({ alias, model, source: 'user' as const }));

  const builtin = BUILTIN_ALIASES
    .filter((entry) => !entry.provider || entry.provider.test(config.provider))
    .filter((entry) => !(config.modelAliases || {})[entry.alias])
    .map((entry) => ({
      alias: entry.alias,
      model: entry.model,
      source: 'builtin' as const,
      description: entry.description,
    }));

  return [...user, ...builtin];
}

export function resolveModelReference(
  config: GrawkusConfig,
  value: string,
  depth = 0,
): ModelResolution {
  const raw = value.trim();
  const key = aliasKey(raw);
  const userAliases = config.modelAliases || {};
  if (key && userAliases[key]) {
    if (depth > 5) {
      return { model: userAliases[key], source: 'user-alias', alias: raw };
    }
    const resolved = resolveModelReference(config, userAliases[key], depth + 1);
    return { model: resolved.model, source: 'user-alias', alias: raw };
  }

  const builtin = BUILTIN_ALIASES.find((entry) =>
    entry.alias === key && (!entry.provider || entry.provider.test(config.provider))
  );
  if (builtin) {
    return { model: builtin.model, source: 'builtin-alias', alias: raw };
  }

  const tier = switchModel(config, raw);
  if (tier) return { model: tier, source: 'tier', alias: raw };
  return { model: raw, source: 'direct' };
}

export function setModelAlias(config: GrawkusConfig, alias: string, target: string): { ok: true; model: string } | { ok: false; error: string } {
  const key = aliasKey(alias);
  if (!isValidModelAliasName(key)) {
    return {
      ok: false,
      error: 'Alias names must start with a letter, use only letters/numbers/._-, and cannot be reserved words like once or effort.',
    };
  }
  const trimmedTarget = target.trim();
  if (!trimmedTarget) return { ok: false, error: 'Alias target cannot be empty.' };
  if (aliasKey(trimmedTarget) === key) return { ok: false, error: 'Alias cannot point to itself.' };

  const resolved = resolveModelReference(config, trimmedTarget);
  config.modelAliases = { ...(config.modelAliases || {}), [key]: resolved.model };
  return { ok: true, model: resolved.model };
}

export function deleteModelAlias(config: GrawkusConfig, alias: string): boolean {
  const key = aliasKey(alias);
  if (!config.modelAliases?.[key]) return false;
  const next = { ...config.modelAliases };
  delete next[key];
  config.modelAliases = Object.keys(next).length > 0 ? next : undefined;
  return true;
}

function extractEffort(tokens: string[]): { tokens: string[]; effort?: ReasoningEffort; error?: string } {
  const rest: string[] = [];
  let effort: ReasoningEffort | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();
    let raw: string | undefined;
    if (lower === '--effort' || lower === '--reasoning' || lower === 'effort' || lower === 'reasoning') {
      raw = tokens[++i];
    } else if (lower.startsWith('--effort=')) {
      raw = token.slice('--effort='.length);
    } else if (lower.startsWith('effort=')) {
      raw = token.slice('effort='.length);
    } else if (lower.startsWith('--reasoning=')) {
      raw = token.slice('--reasoning='.length);
    } else if (lower.startsWith('reasoning=')) {
      raw = token.slice('reasoning='.length);
    } else {
      rest.push(token);
      continue;
    }

    const normalized = normalizeReasoningEffort(raw);
    if (!normalized) {
      return {
        tokens,
        error: `Invalid reasoning effort "${raw || ''}". Use: ${REASONING_EFFORTS.join(', ')}.`,
      };
    }
    effort = normalized;
  }
  return { tokens: rest, effort };
}

export function parseModelOnce(config: GrawkusConfig, args: string): ParsedModelOnce {
  const tokens = tokenizeModelCommandArgs(args);
  const { tokens: positional, effort, error } = extractEffort(tokens);
  if (error) return { error };

  const modelRef = positional.join(' ').trim();
  if (!modelRef && !effort) {
    return {
      error: 'Usage: /model once <model-or-alias> [--effort low|medium|high] or /model effort <level>',
    };
  }

  const override: ModelTurnOverride = {
    source: 'manual',
  };
  if (modelRef) {
    override.model = resolveModelReference(config, modelRef).model;
  }
  if (effort) override.reasoningEffort = effort;
  return { override };
}

export function formatModelResolution(resolution: ModelResolution): string {
  if (resolution.source === 'user-alias') return `${resolution.model} (alias: ${resolution.alias})`;
  if (resolution.source === 'builtin-alias') return `${resolution.model} (built-in alias: ${resolution.alias})`;
  if (resolution.source === 'tier') return `${resolution.model} (${resolution.alias})`;
  return `${resolution.model} (custom)`;
}

export function formatTurnOverride(override: ModelTurnOverride, currentModel: string): string {
  const parts: string[] = [];
  if (override.model && override.model !== currentModel) parts.push(`model ${override.model}`);
  if (override.reasoningEffort) parts.push(`effort ${override.reasoningEffort}`);
  if (parts.length === 0 && override.model) parts.push(`model ${override.model}`);
  return parts.join(', ') || 'no-op';
}
