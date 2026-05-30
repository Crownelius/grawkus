/**
 * Coverage for F4 — tool-call deduplication helpers in src/query.ts.
 *
 * F4 fingerprints (tool_name, normalized_args) and rewrites the older
 * of two duplicate tool-result messages in place. Normalization is
 * how it catches functionally-identical calls that differ only in
 * argument order, path casing, or whitespace.
 *
 * Pins the contracts that:
 *   1. Argument key order doesn't change the fingerprint.
 *   2. Path-like keys (file_path, path, cwd, dir) are case- and
 *      separator-normalized.
 *   3. `command` whitespace is collapsed.
 *   4. Malformed JSON falls back to a literal hash (no crash).
 *   5. dedupRepeatedToolCalls only rewrites SUBSEQUENT occurrences;
 *      the first call is never touched.
 *   6. The latest occurrence is always preserved verbatim — older
 *      duplicates become stubs.
 */
import { describe, it, expect } from 'vitest';
import {
  buildRecoveryReminder,
  dedupFingerprint,
  dedupRepeatedToolCalls,
  isTimeoutObservation,
} from '../src/query.js';
import type { Message } from '../src/types.js';

describe('dedupFingerprint', () => {
  it('collapses argument key reorderings', () => {
    const a = dedupFingerprint('read', '{"file_path":"/a.py","limit":10}');
    const b = dedupFingerprint('read', '{"limit":10,"file_path":"/a.py"}');
    expect(a).toBe(b);
  });

  it('normalizes path separators and case', () => {
    const a = dedupFingerprint('read', '{"file_path":"/App/X.py"}');
    const b = dedupFingerprint('read', '{"file_path":"\\\\app\\\\x.py"}');
    expect(a).toBe(b);
  });

  it('collapses whitespace inside shell command', () => {
    const a = dedupFingerprint('bash', '{"command":"ls -la"}');
    const b = dedupFingerprint('bash', '{"command":"ls   -la"}');
    const c = dedupFingerprint('bash', '{"command":"  ls -la  "}');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('does NOT collapse semantically different commands', () => {
    expect(dedupFingerprint('bash', '{"command":"ls -la"}'))
      .not.toBe(dedupFingerprint('bash', '{"command":"ls -a"}'));
    expect(dedupFingerprint('read', '{"file_path":"/a.py"}'))
      .not.toBe(dedupFingerprint('read', '{"file_path":"/b.py"}'));
  });

  it('namespaces by tool name', () => {
    expect(dedupFingerprint('read', '{"path":"/a"}'))
      .not.toBe(dedupFingerprint('write', '{"path":"/a"}'));
  });

  it('falls back to literal string on malformed JSON', () => {
    // Should not throw, even on garbage.
    const a = dedupFingerprint('bash', 'not json at all');
    const b = dedupFingerprint('bash', 'not json at all');
    expect(a).toBe(b);
    expect(a).not.toBe(dedupFingerprint('bash', 'different garbage'));
  });

  it('handles empty / missing arguments without crashing', () => {
    expect(() => dedupFingerprint('any', '')).not.toThrow();
    expect(() => dedupFingerprint('any', '{}')).not.toThrow();
    // null/undefined-ish should not throw either
    expect(() => dedupFingerprint('any', null as unknown as string)).not.toThrow();
  });
});

describe('dedupRepeatedToolCalls', () => {
  // Helper: build a minimal (toolCalls, toolResults) pair for a list of
  // (tool, args, content) tuples.
  function batch(
    items: Array<[name: string, args: string, content: string]>,
  ): {
    toolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    toolResults: Message[];
  } {
    const toolCalls = items.map(([name, args], i) => ({
      id: `c${i}`,
      type: 'function' as const,
      function: { name, arguments: args },
    }));
    const toolResults = items.map(([, , content], i) => ({
      role: 'tool' as const,
      tool_call_id: `c${i}`,
      content,
    }));
    return { toolCalls, toolResults };
  }

  it('leaves the first occurrence untouched', () => {
    const messages: Message[] = [];
    const dedup = new Map<string, number>();

    const { toolCalls, toolResults } = batch([
      ['read', '{"file_path":"/a.py"}', 'CONTENTS OF A 30K'],
    ]);
    messages.push(...toolResults);
    dedupRepeatedToolCalls(messages, toolCalls, toolResults, dedup);

    expect(messages[0].content).toBe('CONTENTS OF A 30K');
    expect(dedup.size).toBe(1);
  });

  it('rewrites the OLDER message when the same call repeats', () => {
    const messages: Message[] = [];
    const dedup = new Map<string, number>();

    // First call — read /a.py
    const first = batch([['read', '{"file_path":"/a.py"}', 'OLD COPY']]);
    messages.push(...first.toolResults);
    dedupRepeatedToolCalls(messages, first.toolCalls, first.toolResults, dedup);

    // Some unrelated turn in between
    messages.push({ role: 'assistant', content: 'thinking…' });

    // Second call — read /a.py again
    const second = batch([['read', '{"file_path":"/a.py"}', 'FRESH COPY']]);
    messages.push(...second.toolResults);
    const reminders = dedupRepeatedToolCalls(messages, second.toolCalls, second.toolResults, dedup);

    // OLDER message (index 0) stub'd; NEWER message (index 2) intact.
    expect(messages[0].content as string).toContain('deduped');
    expect(messages[2].content).toBe('FRESH COPY');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toContain('the same read call was re-issued');
    expect(reminders[0]).toContain('file_path=/a.py');
    expect(reminders[0]).toContain('FRESH COPY');
  });

  it('preserves role + tool_call_id on the stubbed message (API stays valid)', () => {
    const messages: Message[] = [];
    const dedup = new Map<string, number>();

    const first = batch([['bash', '{"command":"ls"}', 'a\nb\nc']]);
    messages.push(...first.toolResults);
    dedupRepeatedToolCalls(messages, first.toolCalls, first.toolResults, dedup);

    const second = batch([['bash', '{"command":"ls"}', 'a\nb\nc\nd']]);
    messages.push(...second.toolResults);
    dedupRepeatedToolCalls(messages, second.toolCalls, second.toolResults, dedup);

    const stubbed = messages[0] as Message & { tool_call_id?: string };
    expect(stubbed.role).toBe('tool');
    expect(stubbed.tool_call_id).toBe('c0');
  });

  it('chains correctly across three repeats — only the latest stays full', () => {
    const messages: Message[] = [];
    const dedup = new Map<string, number>();

    for (let i = 0; i < 3; i++) {
      const b = batch([['read', '{"file_path":"/same.py"}', `READ_${i}`]]);
      messages.push(...b.toolResults);
      dedupRepeatedToolCalls(messages, b.toolCalls, b.toolResults, dedup);
    }

    // First two should be stubbed; last should be full.
    expect(messages[0].content as string).toContain('deduped');
    expect(messages[1].content as string).toContain('deduped');
    expect(messages[2].content).toBe('READ_2');
  });

  it('does NOT touch results for different fingerprints', () => {
    const messages: Message[] = [];
    const dedup = new Map<string, number>();

    const b1 = batch([['read', '{"file_path":"/a.py"}', 'A']]);
    messages.push(...b1.toolResults);
    dedupRepeatedToolCalls(messages, b1.toolCalls, b1.toolResults, dedup);

    const b2 = batch([['read', '{"file_path":"/b.py"}', 'B']]);
    messages.push(...b2.toolResults);
    dedupRepeatedToolCalls(messages, b2.toolCalls, b2.toolResults, dedup);

    expect(messages[0].content).toBe('A');
    expect(messages[1].content).toBe('B');
  });

  it('treats case-different paths as duplicates', () => {
    const messages: Message[] = [];
    const dedup = new Map<string, number>();

    const b1 = batch([['read', '{"file_path":"/App/X.py"}', 'V1']]);
    messages.push(...b1.toolResults);
    dedupRepeatedToolCalls(messages, b1.toolCalls, b1.toolResults, dedup);

    const b2 = batch([['read', '{"file_path":"/app/x.py"}', 'V2']]);
    messages.push(...b2.toolResults);
    dedupRepeatedToolCalls(messages, b2.toolCalls, b2.toolResults, dedup);

    expect(messages[0].content as string).toContain('deduped');
    expect(messages[1].content).toBe('V2');
  });
});

describe('recovery reminders', () => {
  it('detects timeout observations from tool output', () => {
    expect(isTimeoutObservation('[command timed out after 30000ms]')).toBe(true);
    expect(isTimeoutObservation('operation timed out while reading')).toBe(true);
    expect(isTimeoutObservation('completed successfully')).toBe(false);
  });

  it('builds a timeout reminder that tells the model to change strategy', () => {
    const reminder = buildRecoveryReminder(
      'bash',
      '{"command":"npm test -- --watch","timeout":1000}',
      '[command timed out after 1000ms]',
      'timeout',
    );

    expect(reminder).toContain('bash timed out');
    expect(reminder).toContain('$ npm test -- --watch');
    expect(reminder).toContain('Do not rerun the same long command unchanged');
  });
});
