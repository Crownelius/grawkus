import { describe, expect, it } from 'vitest';
import {
  compactLargeToolOutput,
  quickCompact,
  QUICK_TOOL_OUTPUT_HEAD_CHARS,
  QUICK_TOOL_OUTPUT_TAIL_CHARS,
  QUICK_TOOL_OUTPUT_TRIGGER_CHARS,
} from '../src/compaction.js';
import type { Message } from '../src/types.js';

describe('compactLargeToolOutput', () => {
  it('keeps head and tail while omitting the middle of large output', () => {
    const head = 'H'.repeat(QUICK_TOOL_OUTPUT_HEAD_CHARS);
    const middle = 'M'.repeat(2_500);
    const tail = 'T'.repeat(QUICK_TOOL_OUTPUT_TAIL_CHARS);
    const output = compactLargeToolOutput(head + middle + tail);

    expect(output.startsWith(head)).toBe(true);
    expect(output.endsWith(tail)).toBe(true);
    expect(output).toContain('tool output truncated');
    expect(output).toContain('chars omitted from the middle');
    expect(output).not.toContain('M'.repeat(2_500));
  });

  it('does not change output at or below the trigger', () => {
    const output = 'x'.repeat(QUICK_TOOL_OUTPUT_TRIGGER_CHARS);
    expect(compactLargeToolOutput(output)).toBe(output);
  });
});

describe('quickCompact', () => {
  it('compacts only large tool messages', () => {
    const large = 'a'.repeat(QUICK_TOOL_OUTPUT_TRIGGER_CHARS + 1);
    const messages: Message[] = [
      { role: 'assistant', content: large },
      { role: 'tool', tool_call_id: 'c1', content: large },
      { role: 'tool', tool_call_id: 'c2', content: 'short' },
    ];

    const compacted = quickCompact(messages);

    expect(compacted[0].content).toBe(large);
    expect(compacted[1].content as string).toContain('tool output truncated');
    expect(compacted[2].content).toBe('short');
    expect((compacted[1] as Message & { tool_call_id?: string }).tool_call_id).toBe('c1');
  });
});
