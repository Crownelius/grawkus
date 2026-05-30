export interface SourceCommandParseResult {
  input?: Record<string, unknown>;
  error?: string;
}

const SOURCE_VALUES = new Set(['all', 'arxiv', 'github', 'huggingface', 'hf', 'kaggle']);
const GITHUB_VALUES = new Set(['repositories', 'repos', 'issues', 'pulls', 'prs', 'code', 'all']);
const HF_VALUES = new Set(['models', 'datasets', 'papers', 'both', 'all']);
const KAGGLE_VALUES = new Set(['datasets', 'competitions', 'both']);

export function formatSourceCommandUsage(): string {
  return [
    '  Usage: /sources <query> [--source all|arxiv|github|huggingface|kaggle]',
    '         [--github repositories|issues|pulls|code|all] [--hf models|datasets|papers|both|all]',
    '         [--kaggle datasets|competitions|both] [--recent days] [--limit n] [--json]',
    '  Defaults: --source all --github all --hf all --kaggle both --recent 90 --limit 5',
    '  Example: /sources coding agent verification --recent 30 --github all --hf papers',
  ].join('\n');
}

export function parseSourceCommandArgs(args: string): SourceCommandParseResult {
  const tokens = tokenizeArgs(args);
  if (tokens.length === 0) {
    return { error: 'missing query' };
  }

  const input: Record<string, unknown> = {
    source: 'all',
    github_kind: 'all',
    kind: 'all',
    kaggle_kind: 'both',
    recent_days: 90,
    limit: 5,
  };
  const queryParts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('-')) {
      queryParts.push(token);
      continue;
    }

    if (token === '--benchmark' || token === '--targeted') {
      input.source = 'all';
      input.github_kind = 'all';
      input.kind = 'all';
      input.kaggle_kind = 'both';
      input.recent_days = 90;
      continue;
    }
    if (token === '--json') {
      input.format = 'json';
      continue;
    }

    const { name, inlineValue } = splitFlag(token);
    const value = inlineValue ?? tokens[i + 1];
    const needsValue = !['--benchmark', '--targeted', '--json'].includes(name);
    if (needsValue && (!value || value.startsWith('-'))) {
      return { error: `${name} requires a value` };
    }
    if (inlineValue == null && needsValue) i++;

    switch (name) {
      case '--source':
      case '-s': {
        const normalized = normalizeSourceValue(value);
        if (!SOURCE_VALUES.has(value.toLowerCase()) || !normalized) {
          return { error: `unsupported source "${value}"` };
        }
        input.source = normalized;
        break;
      }
      case '--github':
      case '--github-kind':
      case '--gh': {
        const normalized = normalizeGitHubKind(value);
        if (!GITHUB_VALUES.has(value.toLowerCase()) || !normalized) {
          return { error: `unsupported GitHub kind "${value}"` };
        }
        input.github_kind = normalized;
        break;
      }
      case '--hf':
      case '--hf-kind':
      case '--huggingface':
      case '--kind': {
        const normalized = value.toLowerCase();
        if (!HF_VALUES.has(normalized)) {
          return { error: `unsupported Hugging Face kind "${value}"` };
        }
        input.kind = normalized;
        break;
      }
      case '--kaggle':
      case '--kaggle-kind':
      case '--kg': {
        const normalized = value.toLowerCase();
        if (!KAGGLE_VALUES.has(normalized)) {
          return { error: `unsupported Kaggle kind "${value}"` };
        }
        input.kaggle_kind = normalized;
        break;
      }
      case '--recent':
      case '--recent-days':
      case '--days': {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) {
          return { error: `recent_days must be a positive number, got "${value}"` };
        }
        input.recent_days = Math.floor(n);
        break;
      }
      case '--limit':
      case '-n': {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) {
          return { error: `limit must be a positive number, got "${value}"` };
        }
        input.limit = Math.floor(n);
        break;
      }
      case '--format': {
        const normalized = value.toLowerCase();
        if (normalized !== 'text' && normalized !== 'json') {
          return { error: `unsupported format "${value}"` };
        }
        input.format = normalized;
        break;
      }
      default:
        return { error: `unknown option "${name}"` };
    }
  }

  const query = queryParts.join(' ').trim();
  if (!query) return { error: 'missing query' };
  input.query = query;
  return { input };
}

export function encodeSourcesSentinel(input: Record<string, unknown>): string {
  return `__SOURCES__${JSON.stringify(input)}`;
}

export function decodeSourcesSentinel(value: string): Record<string, unknown> | null {
  if (!value.startsWith('__SOURCES__')) return null;
  try {
    const parsed = JSON.parse(value.slice('__SOURCES__'.length));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function splitFlag(token: string): { name: string; inlineValue?: string } {
  const idx = token.indexOf('=');
  if (idx === -1) return { name: token };
  return { name: token.slice(0, idx), inlineValue: token.slice(idx + 1) };
}

function normalizeSourceValue(value: string): string | null {
  const normalized = value.toLowerCase();
  if (normalized === 'hf') return 'huggingface';
  return SOURCE_VALUES.has(normalized) ? normalized : null;
}

function normalizeGitHubKind(value: string): string | null {
  const normalized = value.toLowerCase();
  if (normalized === 'repos') return 'repositories';
  if (normalized === 'prs') return 'pulls';
  return GITHUB_VALUES.has(normalized) ? normalized : null;
}

function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const ch of input) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (escaping) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

export const _internal = {
  tokenizeArgs,
};
