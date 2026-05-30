import { describe, expect, it } from 'vitest';
import {
  decodeSourcesSentinel,
  encodeSourcesSentinel,
  formatSourceCommandUsage,
  parseSourceCommandArgs,
  _internal,
} from '../src/source-command.js';

describe('/sources command parser', () => {
  it('defaults to targeted cross-source research coverage', () => {
    const result = parseSourceCommandArgs('coding agent verification');

    expect(result.error).toBeUndefined();
    expect(result.input).toMatchObject({
      query: 'coding agent verification',
      source: 'all',
      github_kind: 'all',
      kind: 'all',
      kaggle_kind: 'both',
      recent_days: 90,
      limit: 5,
    });
  });

  it('parses quoted queries and source-specific flags', () => {
    const result = parseSourceCommandArgs('"agent harness" --source=github --github prs --hf papers --kaggle competitions --recent 30 --limit 2 --json');

    expect(result.error).toBeUndefined();
    expect(result.input).toMatchObject({
      query: 'agent harness',
      source: 'github',
      github_kind: 'pulls',
      kind: 'papers',
      kaggle_kind: 'competitions',
      recent_days: 30,
      limit: 2,
      format: 'json',
    });
  });

  it('parses explicit source output formats', () => {
    expect(parseSourceCommandArgs('agent --format=json').input).toMatchObject({
      query: 'agent',
      format: 'json',
    });
    expect(parseSourceCommandArgs('agent --format text').input).toMatchObject({
      query: 'agent',
      format: 'text',
    });
    expect(parseSourceCommandArgs('agent --format xml').error).toContain('unsupported format');
  });

  it('round-trips the async slash-command sentinel payload', () => {
    const input = parseSourceCommandArgs('SWE-CI --benchmark --limit 1').input!;
    const encoded = encodeSourcesSentinel(input);

    expect(encoded.startsWith('__SOURCES__')).toBe(true);
    expect(decodeSourcesSentinel(encoded)).toEqual(input);
  });

  it('rejects unknown flags and prints helpful usage', () => {
    const result = parseSourceCommandArgs('agent --unknown value');

    expect(result.error).toContain('unknown option');
    expect(formatSourceCommandUsage()).toContain('/sources <query>');
    expect(formatSourceCommandUsage()).toContain('--json');
  });

  it('tokenizes shell-style quoted text', () => {
    expect(_internal.tokenizeArgs('"coding agent" --source arxiv')).toEqual([
      'coding agent',
      '--source',
      'arxiv',
    ]);
  });
});
