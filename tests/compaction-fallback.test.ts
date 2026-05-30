import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from '../src/api.js';
import {
  buildCompactionSummaryConfig,
  buildLocalCompactionSummary,
  compactMessages,
  DEFAULT_COMPACTION,
} from '../src/compaction.js';
import type { GrawkusConfig, Message } from '../src/types.js';

vi.mock('../src/api.js', () => ({
  streamChat: vi.fn(),
}));

const ORIGINAL_LOCAL_FALLBACK = process.env.GRAWKUS_LOCAL_COMPACTION_FALLBACK;
const ORIGINAL_LLM_COMPACTION = process.env.GRAWKUS_LLM_COMPACTION;
const ORIGINAL_COMPACTION_MODE = process.env.GRAWKUS_COMPACTION_MODE;
const ORIGINAL_COMPACTION_MODEL = process.env.GRAWKUS_COMPACTION_MODEL;
const ORIGINAL_COMPACTION_MAX_TOKENS = process.env.GRAWKUS_COMPACTION_MAX_TOKENS;
const ORIGINAL_COMPACTION_USE_FALLBACK = process.env.GRAWKUS_COMPACTION_USE_FALLBACK;

afterEach(() => {
  vi.mocked(streamChat).mockReset();
  if (ORIGINAL_LOCAL_FALLBACK === undefined) {
    delete process.env.GRAWKUS_LOCAL_COMPACTION_FALLBACK;
  } else {
    process.env.GRAWKUS_LOCAL_COMPACTION_FALLBACK = ORIGINAL_LOCAL_FALLBACK;
  }
  if (ORIGINAL_LLM_COMPACTION === undefined) {
    delete process.env.GRAWKUS_LLM_COMPACTION;
  } else {
    process.env.GRAWKUS_LLM_COMPACTION = ORIGINAL_LLM_COMPACTION;
  }
  if (ORIGINAL_COMPACTION_MODE === undefined) {
    delete process.env.GRAWKUS_COMPACTION_MODE;
  } else {
    process.env.GRAWKUS_COMPACTION_MODE = ORIGINAL_COMPACTION_MODE;
  }
  if (ORIGINAL_COMPACTION_MODEL === undefined) {
    delete process.env.GRAWKUS_COMPACTION_MODEL;
  } else {
    process.env.GRAWKUS_COMPACTION_MODEL = ORIGINAL_COMPACTION_MODEL;
  }
  if (ORIGINAL_COMPACTION_MAX_TOKENS === undefined) {
    delete process.env.GRAWKUS_COMPACTION_MAX_TOKENS;
  } else {
    process.env.GRAWKUS_COMPACTION_MAX_TOKENS = ORIGINAL_COMPACTION_MAX_TOKENS;
  }
  if (ORIGINAL_COMPACTION_USE_FALLBACK === undefined) {
    delete process.env.GRAWKUS_COMPACTION_USE_FALLBACK;
  } else {
    process.env.GRAWKUS_COMPACTION_USE_FALLBACK = ORIGINAL_COMPACTION_USE_FALLBACK;
  }
});

function config(): GrawkusConfig {
  return {
    apiKey: 'test',
    baseURL: 'http://localhost:11434/v1',
    model: 'local-test',
    provider: 'test',
    maxTokens: 1024,
    temperature: 0,
    permissionMode: 'auto',
  };
}

function messages(): Message[] {
  return [
    { role: 'user', content: 'original task: fix the failing benchmark' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call-read',
        type: 'function',
        function: { name: 'read_file', arguments: '{"file_path":"src/foo.ts"}' },
      }],
    },
    { role: 'tool', tool_call_id: 'call-read', content: 'Error: src/foo.ts is missing' },
    { role: 'user', content: 'also make sure tests cover the regression' },
    { role: 'assistant', content: 'I found the failure path and need to patch it.' },
    { role: 'user', content: 'latest request: verify' },
    { role: 'assistant', content: 'latest answer' },
  ];
}

describe('buildLocalCompactionSummary', () => {
  it('summarizes useful breadcrumbs without preserving full tool output', () => {
    const summary = buildLocalCompactionSummary(messages().slice(1, 5));

    expect(summary).toContain('Local fallback summary');
    expect(summary).toContain('read_file x1');
    expect(summary).toContain('src/foo.ts');
    expect(summary).toContain('tests cover the regression');
    expect(summary).toContain('Error: src/foo.ts is missing');
  });
});

describe('compactMessages fallback summary', () => {
  it('routes OpenRouter compaction through the fallback model with a smaller token cap', () => {
    const summaryConfig = buildCompactionSummaryConfig({
      ...config(),
      baseURL: 'https://openrouter.ai/api/v1',
      provider: 'OpenRouter',
      model: 'anthropic/claude-sonnet-4.5',
      fallbackModel: 'openrouter/free',
      maxTokens: 8192,
    });

    expect(summaryConfig.model).toBe('openrouter/free');
    expect(summaryConfig.maxTokens).toBe(2048);
  });

  it('lets explicit compaction model and token env override fallback routing', () => {
    process.env.GRAWKUS_COMPACTION_MODEL = 'deepseek/deepseek-chat-v3.1:free';
    process.env.GRAWKUS_COMPACTION_MAX_TOKENS = '1024';

    const summaryConfig = buildCompactionSummaryConfig({
      ...config(),
      baseURL: 'https://openrouter.ai/api/v1',
      provider: 'OpenRouter',
      model: 'anthropic/claude-sonnet-4.5',
      fallbackModel: 'openrouter/free',
      maxTokens: 8192,
    });

    expect(summaryConfig.model).toBe('deepseek/deepseek-chat-v3.1:free');
    expect(summaryConfig.maxTokens).toBe(1024);
  });

  it('can force deterministic local compaction without calling the model', async () => {
    process.env.GRAWKUS_LLM_COMPACTION = '0';

    const compacted = await compactMessages(messages(), config(), {
      ...DEFAULT_COMPACTION,
      keepRecentMessages: 2,
    });

    expect(streamChat).not.toHaveBeenCalled();
    expect(compacted[1].content).toContain('Local fallback summary');
    expect(compacted[1].content).toContain('read_file x1');
  });

  it('passes the summary-specific config to model summarization', async () => {
    process.env.GRAWKUS_COMPACTION_MODEL = 'openrouter/free';
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield { type: 'text', content: 'model summary' };
    });

    await compactMessages(messages(), {
      ...config(),
      model: 'expensive-model',
      maxTokens: 8192,
    }, {
      ...DEFAULT_COMPACTION,
      keepRecentMessages: 2,
    });

    const [summaryConfig] = vi.mocked(streamChat).mock.calls[0];
    expect(summaryConfig.model).toBe('openrouter/free');
    expect(summaryConfig.maxTokens).toBe(2048);
  });

  it('uses local compaction when model summarization throws', async () => {
    vi.mocked(streamChat).mockImplementation(async function* () {
      throw new Error('rate limit');
    });

    const compacted = await compactMessages(messages(), config(), {
      ...DEFAULT_COMPACTION,
      keepRecentMessages: 2,
    });

    expect(compacted).toHaveLength(4);
    expect(compacted[0].content).toBe('original task: fix the failing benchmark');
    expect(compacted[1].content).toContain('Local fallback summary');
    expect(compacted[1].content).toContain('read_file x1');
    expect(compacted[2].content).toBe('latest request: verify');
    expect(compacted[3].content).toBe('latest answer');
  });

  it('can keep the original messages when local fallback is disabled', async () => {
    process.env.GRAWKUS_LOCAL_COMPACTION_FALLBACK = '0';
    vi.mocked(streamChat).mockImplementation(async function* () {
      throw new Error('rate limit');
    });

    const original = messages();
    const compacted = await compactMessages(original, config(), {
      ...DEFAULT_COMPACTION,
      keepRecentMessages: 2,
    });

    expect(compacted).toBe(original);
  });
});
