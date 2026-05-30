import { describe, it, expect, afterEach } from 'vitest';
import {
  buildCompactedMessages,
  buildCompactionConfig,
  compactionTriggerTokens,
  contextCapTokens,
  enforceContextCap,
  inferContextWindowTokens,
  OPENROUTER_FREE_ROUTER_SAFE_CONTEXT_WINDOW_TOKENS,
  OPENROUTER_UNKNOWN_FREE_MODEL_CONTEXT_WINDOW_TOKENS,
  partitionMessagesForCompaction,
} from '../src/compaction.js';
import type { Message } from '../src/types.js';

const ORIGINAL_CONTEXT_WINDOW = process.env.GRAWKUS_CONTEXT_WINDOW_TOKENS;
const ORIGINAL_COMPACTION_TRIGGER = process.env.GRAWKUS_COMPACTION_TRIGGER_TOKENS;

afterEach(() => {
  if (ORIGINAL_CONTEXT_WINDOW === undefined) {
    delete process.env.GRAWKUS_CONTEXT_WINDOW_TOKENS;
  } else {
    process.env.GRAWKUS_CONTEXT_WINDOW_TOKENS = ORIGINAL_CONTEXT_WINDOW;
  }
  if (ORIGINAL_COMPACTION_TRIGGER === undefined) {
    delete process.env.GRAWKUS_COMPACTION_TRIGGER_TOKENS;
  } else {
    process.env.GRAWKUS_COMPACTION_TRIGGER_TOKENS = ORIGINAL_COMPACTION_TRIGGER;
  }
});

function assistantWithTool(id: string, name: string, args: string): Message {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{
      id,
      type: 'function',
      function: { name, arguments: args },
    }],
  };
}

describe('contextCapTokens', () => {
  it('uses the larger of context minus 40k and 80 percent of context', () => {
    expect(contextCapTokens(200_000)).toBe(160_000);
    expect(contextCapTokens(128_000)).toBe(102_400);
    expect(contextCapTokens(32_000)).toBe(25_600);
  });
});

describe('inferContextWindowTokens', () => {
  it('uses explicit config before model heuristics', () => {
    expect(inferContextWindowTokens({ model: 'anthropic/claude-sonnet-4', contextWindowTokens: 64_000 })).toBe(64_000);
  });

  it('uses environment override before model heuristics', () => {
    process.env.GRAWKUS_CONTEXT_WINDOW_TOKENS = '96000';
    expect(inferContextWindowTokens({ model: 'anthropic/claude-sonnet-4' })).toBe(96_000);
  });

  it('falls back to known model-family defaults', () => {
    expect(inferContextWindowTokens({ model: 'anthropic/claude-sonnet-4' })).toBe(200_000);
    expect(inferContextWindowTokens({ model: 'google/gemini-2.5-flash' })).toBe(1_000_000);
  });

  it('uses conservative context defaults for OpenRouter free routes without an explicit catalog hint', () => {
    expect(inferContextWindowTokens({ model: 'openrouter/free' })).toBe(OPENROUTER_FREE_ROUTER_SAFE_CONTEXT_WINDOW_TOKENS);
    expect(inferContextWindowTokens({ model: 'liquid/lfm-2.5-1.2b-instruct:free' })).toBe(OPENROUTER_UNKNOWN_FREE_MODEL_CONTEXT_WINDOW_TOKENS);
  });
});

describe('rolling compaction config', () => {
  it('uses the smaller of 60k tokens and half the context window', () => {
    expect(compactionTriggerTokens({ model: 'openai/gpt-4o' })).toBe(60_000);
    expect(buildCompactionConfig({ model: 'local-small', contextWindowTokens: 32_000 }).triggerTokens).toBe(16_000);
    expect(compactionTriggerTokens({ model: 'liquid/lfm-2.5-1.2b-instruct:free' })).toBe(16_384);
  });

  it('allows an explicit compaction trigger override', () => {
    process.env.GRAWKUS_COMPACTION_TRIGGER_TOKENS = '12345';
    expect(compactionTriggerTokens({ model: 'openai/gpt-4o' })).toBe(12_345);
  });
});

describe('partitionMessagesForCompaction', () => {
  it('pins the original user task when it would otherwise be summarized away', () => {
    const messages: Message[] = [
      { role: 'user', content: 'original goal: fix grawkus' },
      { role: 'assistant', content: 'old analysis' },
      { role: 'user', content: 'old follow-up' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'latest request' },
      { role: 'assistant', content: 'latest answer' },
    ];

    const partition = partitionMessagesForCompaction(messages, 2);
    const compacted = buildCompactedMessages('summary text', partition);

    expect(partition.pinnedFirstUser).toBe(true);
    expect(partition.pinnedPrefix).toHaveLength(1);
    expect(partition.oldMessages.some((m) => m.content === 'original goal: fix grawkus')).toBe(false);
    expect(compacted[0].content).toBe('original goal: fix grawkus');
    expect(compacted[1].content).toContain('CONVERSATION SUMMARY');
    expect(compacted.filter((m) => m.content === 'original goal: fix grawkus')).toHaveLength(1);
  });

  it('does not duplicate the original user task when it is still recent', () => {
    const messages: Message[] = [
      { role: 'assistant', content: 'older note' },
      { role: 'user', content: 'original goal near tail' },
      { role: 'assistant', content: 'recent answer' },
    ];

    const partition = partitionMessagesForCompaction(messages, 2);
    const compacted = buildCompactedMessages('summary text', partition);

    expect(partition.pinnedFirstUser).toBe(false);
    expect(compacted.filter((m) => m.content === 'original goal near tail')).toHaveLength(1);
  });

  it('keeps a recent tool result with the assistant tool call that produced it', () => {
    const messages: Message[] = [
      { role: 'user', content: 'original goal' },
      { role: 'assistant', content: 'old answer' },
      assistantWithTool('latest-tool', 'bash', '{"command":"npm test"}'),
      { role: 'tool', tool_call_id: 'latest-tool', content: 'test output' },
      { role: 'assistant', content: 'after tool' },
    ];

    const partition = partitionMessagesForCompaction(messages, 2);

    expect(partition.recentMessages[0].role).toBe('assistant');
    expect(partition.recentMessages[0].tool_calls?.[0]?.id).toBe('latest-tool');
    expect(partition.recentMessages[1].role).toBe('tool');
    expect(partition.recentMessages[1].tool_call_id).toBe('latest-tool');
  });
});

describe('enforceContextCap', () => {
  it('returns the same message array when under cap', () => {
    const messages: Message[] = [{ role: 'user', content: 'small task' }];
    const result = enforceContextCap(messages, 10_000);
    expect(result.changed).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it('preserves the original goal and latest turn while dropping middle history', () => {
    const messages: Message[] = [
      { role: 'user', content: 'original goal: fix the project' },
    ];
    for (let i = 0; i < 12; i++) {
      messages.push({ role: 'user', content: `middle request ${i}` });
      messages.push({ role: 'assistant', content: `middle answer ${i} ${'x'.repeat(1600)}` });
    }
    messages.push({ role: 'user', content: 'latest request: run the final test' });
    messages.push({ role: 'assistant', content: `latest answer ${'y'.repeat(300)}` });

    const result = enforceContextCap(messages, 1_800);

    expect(result.changed).toBe(true);
    expect(result.droppedMessages).toBeGreaterThan(0);
    expect(result.messages[0].content).toContain('original goal');
    expect(result.messages.some((m) => typeof m.content === 'string' && m.content.includes('context cap: omitted'))).toBe(true);
    expect(result.messages.some((m) => typeof m.content === 'string' && m.content.includes('latest request'))).toBe(true);
  });

  it('keeps assistant tool-call messages paired with their tool results', () => {
    const messages: Message[] = [
      { role: 'user', content: 'original goal' },
    ];
    for (let i = 0; i < 8; i++) {
      messages.push(assistantWithTool(`old-${i}`, 'bash', `{"command":"echo old-${i}"}`));
      messages.push({ role: 'tool', tool_call_id: `old-${i}`, content: `old output ${i} ${'x'.repeat(1200)}` });
    }
    messages.push(assistantWithTool('latest', 'bash', '{"command":"echo latest"}'));
    messages.push({ role: 'tool', tool_call_id: 'latest', content: 'latest output' });

    const result = enforceContextCap(messages, 1_200);
    const latestAssistantIndex = result.messages.findIndex((m) => m.role === 'assistant' && m.tool_calls?.[0]?.id === 'latest');
    const latestToolIndex = result.messages.findIndex((m) => m.role === 'tool' && m.tool_call_id === 'latest');

    expect(latestAssistantIndex).toBeGreaterThanOrEqual(0);
    expect(latestToolIndex).toBe(latestAssistantIndex + 1);
    expect(result.messages.findIndex((m) => m.role === 'tool')).toBeGreaterThan(0);
  });
});
