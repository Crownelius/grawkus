import { describe, it, expect, afterEach } from 'vitest';
import { buildGlobalPlanBlock } from '../src/query.js';
import type { Message } from '../src/types.js';

const ORIGINAL = process.env.GRAWKUS_GLOBAL_PLAN;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.GRAWKUS_GLOBAL_PLAN;
  else process.env.GRAWKUS_GLOBAL_PLAN = ORIGINAL;
});

function assistantWithCalls(...calls: Array<[id: string, name: string, args: string]>): Message {
  return {
    role: 'assistant',
    content: null,
    tool_calls: calls.map(([id, name, args]) => ({
      id,
      type: 'function' as const,
      function: { name, arguments: args },
    })),
  } as Message;
}

describe('buildGlobalPlanBlock', () => {
  it('returns null for short simple requests', () => {
    const out = buildGlobalPlanBlock([{ role: 'user', content: 'say hi' }]);
    expect(out).toBeNull();
  });

  it('can trigger on a complex first turn before any tool calls', () => {
    const out = buildGlobalPlanBlock([{
      role: 'user',
      content: 'Research and implement a benchmark-driven improvement for the agent architecture with verification.',
    }]);

    expect(out).not.toBeNull();
    expect(out).toContain('<global_plan>');
    expect(out).toContain('Current phase: orient and plan');
    expect(out).toContain('inspect=0');
    expect(out).toContain('Keep a 3-7 step plan');
  });

  it('classifies inspect/research/edit/execute/verify tool signals', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Implement the feature and verify it.' },
      assistantWithCalls(
        ['c1', 'grep', '{"pattern":"foo"}'],
        ['c2', 'web_search', '{"query":"agent planning"}'],
        ['c3', 'edit_file', '{"file_path":"src/a.ts","old_string":"a","new_string":"b"}'],
        ['c4', 'bash', '{"command":"npm test"}'],
      ),
      { role: 'tool', tool_call_id: 'c4', content: 'all tests passed' },
    ];

    const out = buildGlobalPlanBlock(messages) as string;
    expect(out).toContain('inspect=1');
    expect(out).toContain('research=1');
    expect(out).toContain('edit=1');
    expect(out).toContain('execute=1');
    expect(out).toContain('verify=1');
    expect(out).toContain('Current phase: refine or summarize');
  });

  it('recommends verification after edits when no verification ran yet', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Implement the parser refactor.' },
      assistantWithCalls(['c1', 'edit_file', '{"file_path":"src/parser.ts","old_string":"a","new_string":"b"}']),
      { role: 'tool', tool_call_id: 'c1', content: 'edited' },
    ];

    const out = buildGlobalPlanBlock(messages) as string;
    expect(out).toContain('Current phase: verify edits');
    expect(out).toContain('run the narrowest relevant test/build/check');
  });

  it('detects failing verification and recommends diagnosis', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Debug and verify the failing test.' },
      assistantWithCalls(['c1', 'bash', '{"command":"pytest"}']),
      { role: 'tool', tool_call_id: 'c1', content: 'Error: assertion failed' },
    ];

    const out = buildGlobalPlanBlock(messages) as string;
    expect(out).toContain('Current phase: diagnose failing verification');
    expect(out).toContain('read the failing output');
    expect(out).toContain('errors=1');
  });

  it('respects GRAWKUS_GLOBAL_PLAN=0', () => {
    process.env.GRAWKUS_GLOBAL_PLAN = '0';
    const out = buildGlobalPlanBlock([{
      role: 'user',
      content: 'Research and implement a benchmark-driven improvement for the agent architecture with verification.',
    }]);
    expect(out).toBeNull();
  });
});
