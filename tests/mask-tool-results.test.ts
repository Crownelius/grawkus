/**
 * Coverage for F2 — observation window masking in src/query.ts.
 *
 * The mask:
 *   - keeps the last MASKING_WINDOW tool-result messages full
 *   - replaces older tool-results' content with a 1-line stub
 *   - leaves user/assistant/system messages alone
 *   - is a no-op below the byte threshold (avoids touching short tasks)
 *   - preserves role + tool_call_id so the OpenAI schema stays valid
 *
 * Source: arxiv 2508.21433. The paper shows this is a near-zero-cost
 * substitute for LLM-summarization in long agent loops.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { maskOldToolResults } from '../src/query.js';
import type { Message } from '../src/types.js';

const ORIGINAL_WINDOW = process.env.GRAWKUS_MASK_WINDOW;

afterEach(() => {
  if (ORIGINAL_WINDOW === undefined) {
    delete process.env.GRAWKUS_MASK_WINDOW;
  } else {
    process.env.GRAWKUS_MASK_WINDOW = ORIGINAL_WINDOW;
  }
});

// Helper: synthesize a tool-result message with `bytes` worth of content.
function toolMsg(callId: string, bytes: number): Message {
  return {
    role: 'tool',
    tool_call_id: callId,
    content: 'x'.repeat(bytes),
  };
}

describe('maskOldToolResults', () => {
  it('is a no-op when total bytes are below the trigger threshold', () => {
    // Threshold is 60_000 bytes. Build messages well below that.
    const msgs: Message[] = [];
    for (let i = 0; i < 20; i++) msgs.push(toolMsg(`c${i}`, 100));
    const out = maskOldToolResults(msgs);
    // Reference equality: short tasks should return the input as-is.
    expect(out).toBe(msgs);
  });

  it('keeps only the last MASKING_WINDOW (=12) tool results when triggered', () => {
    process.env.GRAWKUS_MASK_WINDOW = '12';
    // Build 20 tool-result messages, each 5000 bytes → ~100K total
    const msgs: Message[] = [];
    for (let i = 0; i < 20; i++) msgs.push(toolMsg(`c${i}`, 5000));
    const out = maskOldToolResults(msgs);

    // Last 12 (indices 8..19) should be untouched
    for (let i = 8; i < 20; i++) {
      expect(out[i].content).toBe(msgs[i].content);
    }
    // First 8 (indices 0..7) should be masked
    for (let i = 0; i < 8; i++) {
      const stubbed = out[i].content as string;
      expect(stubbed).toContain('older tool output omitted');
      expect(stubbed.length).toBeLessThan(150); // short stub
    }
  });

  it('preserves role + tool_call_id on masked messages (API stays valid)', () => {
    const msgs: Message[] = [];
    for (let i = 0; i < 20; i++) msgs.push(toolMsg(`call-${i}`, 5000));
    const out = maskOldToolResults(msgs);

    // Stubbed message at index 0 should still have role=tool + the original tool_call_id
    const m0 = out[0] as Message & { tool_call_id?: string };
    expect(m0.role).toBe('tool');
    expect(m0.tool_call_id).toBe('call-0');
  });

  it('does NOT mask user/assistant/system messages', () => {
    // Mix in non-tool messages between tool results
    const msgs: Message[] = [
      { role: 'system', content: 'sys msg ' + 'y'.repeat(5000) },
      { role: 'user', content: 'user msg ' + 'y'.repeat(5000) },
    ];
    for (let i = 0; i < 18; i++) {
      msgs.push({ role: 'assistant', content: 'assistant ' + 'y'.repeat(2000) });
      msgs.push(toolMsg(`c${i}`, 3000));
    }
    const out = maskOldToolResults(msgs);
    // system + user + every assistant should be unchanged
    expect(out[0]).toEqual(msgs[0]); // system
    expect(out[1]).toEqual(msgs[1]); // user
    for (let i = 2; i < out.length; i += 2) {
      expect(out[i].role).toBe('assistant');
      expect(out[i].content).toBe(msgs[i].content); // assistants never masked
    }
  });

  it('mentions the byte count of the original output in the stub', () => {
    const msgs: Message[] = [];
    for (let i = 0; i < 20; i++) msgs.push(toolMsg(`c${i}`, 5000));
    const out = maskOldToolResults(msgs);
    // Should reference original byte size in the stub for the model's awareness
    expect(out[0].content as string).toContain('5000');
  });

  it('does not mutate the input array', () => {
    const msgs: Message[] = [];
    for (let i = 0; i < 20; i++) msgs.push(toolMsg(`c${i}`, 5000));
    const originalFirstContent = msgs[0].content;
    maskOldToolResults(msgs);
    expect(msgs[0].content).toBe(originalFirstContent);
  });

  it('respects GRAWKUS_MASK_WINDOW override', () => {
    process.env.GRAWKUS_MASK_WINDOW = '3';
    const msgs: Message[] = [];
    for (let i = 0; i < 10; i++) msgs.push(toolMsg(`c${i}`, 7000));
    const out = maskOldToolResults(msgs);
    // Only last 3 (indices 7,8,9) verbatim; indices 0..6 masked
    expect(out[6].content as string).toContain('omitted');
    expect(out[7].content).toBe(msgs[7].content);
    expect(out[8].content).toBe(msgs[8].content);
    expect(out[9].content).toBe(msgs[9].content);
  });

  it('falls back gracefully on invalid GRAWKUS_MASK_WINDOW', () => {
    process.env.GRAWKUS_MASK_WINDOW = 'not-a-number';
    const msgs: Message[] = [];
    for (let i = 0; i < 20; i++) msgs.push(toolMsg(`c${i}`, 5000));
    // Should NOT throw and should use the default window
    expect(() => maskOldToolResults(msgs)).not.toThrow();
  });

  it('handles edge case: fewer tool messages than the window', () => {
    process.env.GRAWKUS_MASK_WINDOW = '12';
    const msgs: Message[] = [];
    // 5 tool results, each 15K bytes → 75K total (triggers threshold)
    // but only 5 messages — fewer than window of 12 → nothing should be masked
    for (let i = 0; i < 5; i++) msgs.push(toolMsg(`c${i}`, 15000));
    const out = maskOldToolResults(msgs);
    for (let i = 0; i < 5; i++) {
      expect(out[i].content).toBe(msgs[i].content);
    }
  });
});
