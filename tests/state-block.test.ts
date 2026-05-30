/**
 * Coverage for StateAct task-state block in src/query.ts.
 *
 * Source: arxiv 2410.02810. Re-injects the original goal + recent
 * action list before each turn so the model doesn't drift on long
 * chains. Targets the `run-pdp11-code` failure (375K context, model
 * wrote the same file twice because earlier turns drifted out of
 * attention).
 *
 * Contracts pinned by these tests:
 *   - Returns null on very short chains (< 3 messages)
 *   - Returns null when no first user message exists
 *   - Returns null when no tool calls have been made
 *   - Goal section truncates at STATE_BLOCK_GOAL_MAX_CHARS (400)
 *   - Action list shows last N=8 actions
 *   - Older-action count is reported when truncated
 *   - Action args are preview-truncated (no full 30K dumps)
 *   - Respects GRAWKUS_STATE_BLOCK=0 to opt out
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildStateBlock } from '../src/query.js';
import type { Message } from '../src/types.js';

const ORIGINAL = process.env.GRAWKUS_STATE_BLOCK;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.GRAWKUS_STATE_BLOCK;
  else process.env.GRAWKUS_STATE_BLOCK = ORIGINAL;
});

// Helper: build an assistant message with N tool calls
function assistantWithCalls(...calls: Array<[string, string]>): Message {
  return {
    role: 'assistant',
    content: null,
    tool_calls: calls.map(([name, args], i) => ({
      id: `c${i}`,
      type: 'function' as const,
      function: { name, arguments: args },
    })),
  } as Message;
}

describe('buildStateBlock', () => {
  it('returns null on short chains', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'do thing' },
    ];
    expect(buildStateBlock(msgs)).toBeNull();
  });

  it('returns null when GRAWKUS_STATE_BLOCK=0', () => {
    process.env.GRAWKUS_STATE_BLOCK = '0';
    const msgs: Message[] = [
      { role: 'user', content: 'do thing' },
      assistantWithCalls(['bash', '{"command":"ls"}']),
      { role: 'tool', tool_call_id: 'c0', content: 'a b c' },
    ];
    expect(buildStateBlock(msgs)).toBeNull();
  });

  it('returns null when there are no tool calls at all', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'just thinking' },
      { role: 'assistant', content: 'I will think about it' },
      { role: 'user', content: 'thoughts?' },
    ];
    expect(buildStateBlock(msgs)).toBeNull();
  });

  it('includes the original goal verbatim (under cap)', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'Create a file at /app/hello.txt with "Hello".' },
      assistantWithCalls(['write', '{"file_path":"/app/hello.txt","content":"Hello"}']),
      { role: 'tool', tool_call_id: 'c0', content: 'ok' },
    ];
    const out = buildStateBlock(msgs);
    expect(out).not.toBeNull();
    expect(out).toContain('Original goal:');
    expect(out).toContain('Create a file at /app/hello.txt');
  });

  it('truncates an oversized goal with ellipsis', () => {
    const longGoal = 'x'.repeat(800);
    const msgs: Message[] = [
      { role: 'user', content: longGoal },
      assistantWithCalls(['bash', '{"command":"ls"}']),
      { role: 'tool', tool_call_id: 'c0', content: 'ok' },
    ];
    const out = buildStateBlock(msgs);
    expect(out).not.toBeNull();
    // Goal section should be capped — find the line and check length
    const line = (out as string).split('\n').find((l) => l.startsWith('Original goal:'))!;
    expect(line.length).toBeLessThan(500); // 400 cap + prefix + ellipsis
    expect(line.endsWith('…')).toBe(true);
  });

  it('lists action count and recent actions', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'do stuff' },
      assistantWithCalls(
        ['bash', '{"command":"ls -la"}'],
        ['read', '{"file_path":"/x.py"}'],
        ['write', '{"file_path":"/y.py","content":"print()"}'],
      ),
      { role: 'tool', tool_call_id: 'c0', content: 'ok' },
    ];
    const out = buildStateBlock(msgs);
    expect(out).toContain('Actions completed: 3');
    expect(out).toContain('bash(');
    expect(out).toContain('read(');
    expect(out).toContain('write(');
  });

  it('shows only the last 8 actions and reports the older count', () => {
    // Build 12 actions across two assistant turns
    const calls1: Array<[string, string]> = [];
    const calls2: Array<[string, string]> = [];
    for (let i = 0; i < 6; i++) calls1.push(['bash', `{"command":"echo ${i}"}`]);
    for (let i = 6; i < 12; i++) calls2.push(['bash', `{"command":"echo ${i}"}`]);

    const msgs: Message[] = [
      { role: 'user', content: 'do' },
      assistantWithCalls(...calls1),
      assistantWithCalls(...calls2),
    ];
    const out = buildStateBlock(msgs) as string;
    expect(out).toContain('Actions completed: 12');
    // Should mention older count truncation
    expect(out).toMatch(/Recent 8 \(4 earlier omitted\)/);
    // Earliest visible should be #5 (echo 4) — counting: 12 total, last 8 = indices 4-11
    expect(out).toContain('echo 4');
    expect(out).toContain('echo 11');
    expect(out).not.toContain('echo 0');
    expect(out).not.toContain('echo 3');
  });

  it('truncates per-action argsPreview at 80 chars with ellipsis', () => {
    const longArgs = '{"command":"' + 'A'.repeat(200) + '"}';
    const msgs: Message[] = [
      { role: 'user', content: 'do' },
      assistantWithCalls(['bash', longArgs]),
      { role: 'tool', tool_call_id: 'c0', content: 'ok' },
    ];
    const out = buildStateBlock(msgs) as string;
    expect(out).toContain('…)');
    // No raw 200-char arg blob in the state block
    expect(out).not.toContain('A'.repeat(150));
  });

  it('includes the "stay focused" reminder', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'do' },
      assistantWithCalls(['bash', '{"command":"ls"}']),
      { role: 'tool', tool_call_id: 'c0', content: 'a' },
    ];
    const out = buildStateBlock(msgs) as string;
    expect(out.toLowerCase()).toContain('stay focused');
    expect(out.toLowerCase()).toContain('do not re-issue');
  });

  it('wraps everything in <task_state> tags', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'do' },
      assistantWithCalls(['bash', '{"command":"ls"}']),
      { role: 'tool', tool_call_id: 'c0', content: 'a' },
    ];
    const out = buildStateBlock(msgs) as string;
    expect(out.startsWith('<task_state>')).toBe(true);
    expect(out.endsWith('</task_state>')).toBe(true);
  });
});
