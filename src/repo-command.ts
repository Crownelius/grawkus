export interface RepoDigestCommandParseResult {
  input?: Record<string, unknown>;
  error?: string;
}

export function formatRepoDigestCommandUsage(): string {
  return [
    '  Usage: /repo-digest <github-url|owner/repo> [--ref branch-or-sha] [--files n] [--text-files n] [--chars n] [--docs-only]',
    '  Defaults: --files 300 --text-files 5 --chars 1200',
    '  Example: /repo-digest openai/codex --files 500 --text-files 6',
    '  Docs-only: /repo-digest openai/codex --files 500 --docs-only',
  ].join('\n');
}

export function parseRepoDigestCommandArgs(args: string): RepoDigestCommandParseResult {
  const tokens = tokenizeArgs(args);
  if (tokens.length === 0) return { error: 'missing GitHub repository' };

  const input: Record<string, unknown> = {
    max_files: 300,
    max_text_files: 5,
    max_excerpt_chars: 1200,
  };
  const repoParts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('-')) {
      repoParts.push(token);
      continue;
    }

    if (token === '--docs-only' || token === '--no-source-code') {
      input.docs_only = true;
      input.max_text_files = 4;
      continue;
    }

    const { name, inlineValue } = splitFlag(token);
    const value = inlineValue ?? tokens[i + 1];
    if (!value || value.startsWith('-')) return { error: `${name} requires a value` };
    if (inlineValue == null) i++;

    switch (name) {
      case '--ref':
      case '--branch': {
        input.ref = value;
        break;
      }
      case '--files':
      case '--max-files': {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return { error: `max_files must be a positive number, got "${value}"` };
        input.max_files = Math.floor(n);
        break;
      }
      case '--text-files':
      case '--max-text-files': {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return { error: `max_text_files must be a non-negative number, got "${value}"` };
        input.max_text_files = Math.floor(n);
        break;
      }
      case '--chars':
      case '--excerpt-chars':
      case '--max-excerpt-chars': {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return { error: `max_excerpt_chars must be a positive number, got "${value}"` };
        input.max_excerpt_chars = Math.floor(n);
        break;
      }
      default:
        return { error: `unknown option "${name}"` };
    }
  }

  const repo = repoParts.join(' ').trim();
  if (!repo) return { error: 'missing GitHub repository' };
  input.repo = repo;
  return { input };
}

export function encodeRepoDigestSentinel(input: Record<string, unknown>): string {
  return `__REPO_DIGEST__${JSON.stringify(input)}`;
}

export function decodeRepoDigestSentinel(value: string): Record<string, unknown> | null {
  if (!value.startsWith('__REPO_DIGEST__')) return null;
  try {
    const parsed = JSON.parse(value.slice('__REPO_DIGEST__'.length));
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
