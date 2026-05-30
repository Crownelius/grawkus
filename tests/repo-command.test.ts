import { describe, expect, it } from 'vitest';
import {
  decodeRepoDigestSentinel,
  encodeRepoDigestSentinel,
  formatRepoDigestCommandUsage,
  parseRepoDigestCommandArgs,
  _internal,
} from '../src/repo-command.js';

describe('/repo-digest command parser', () => {
  it('defaults to bounded GitHub repo inspection', () => {
    const result = parseRepoDigestCommandArgs('openai/codex');

    expect(result.error).toBeUndefined();
    expect(result.input).toMatchObject({
      repo: 'openai/codex',
      max_files: 300,
      max_text_files: 5,
      max_excerpt_chars: 1200,
    });
  });

  it('parses urls and source-specific flags', () => {
    const result = parseRepoDigestCommandArgs('https://github.com/anthropics/claude-code --ref main --files 500 --text-files 8 --chars 1600');

    expect(result.error).toBeUndefined();
    expect(result.input).toMatchObject({
      repo: 'https://github.com/anthropics/claude-code',
      ref: 'main',
      max_files: 500,
      max_text_files: 8,
      max_excerpt_chars: 1600,
    });
  });

  it('parses docs-only mode without requiring source-code excerpts', () => {
    const result = parseRepoDigestCommandArgs('openai/codex --files 500 --docs-only');

    expect(result.error).toBeUndefined();
    expect(result.input).toMatchObject({
      repo: 'openai/codex',
      max_files: 500,
      max_text_files: 4,
      docs_only: true,
    });
    expect(formatRepoDigestCommandUsage()).toContain('--docs-only');
  });

  it('round-trips the async slash-command sentinel payload', () => {
    const input = parseRepoDigestCommandArgs('google-gemini/gemini-cli --files 20').input!;
    const encoded = encodeRepoDigestSentinel(input);

    expect(encoded.startsWith('__REPO_DIGEST__')).toBe(true);
    expect(decodeRepoDigestSentinel(encoded)).toEqual(input);
  });

  it('rejects unknown flags and prints helpful usage', () => {
    const result = parseRepoDigestCommandArgs('openai/codex --unknown value');

    expect(result.error).toContain('unknown option');
    expect(formatRepoDigestCommandUsage()).toContain('/repo-digest <github-url|owner/repo>');
  });

  it('tokenizes shell-style quoted text', () => {
    expect(_internal.tokenizeArgs('"openai/codex" --files 10')).toEqual([
      'openai/codex',
      '--files',
      '10',
    ]);
  });
});
