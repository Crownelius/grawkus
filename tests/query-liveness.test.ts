import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamChat, resetClient } from '../src/api.js';
import { formatWorkingIndicatorFrame, resolveTurnFirstTokenTimeoutMs, runQuery, shouldUseFastDirectReply } from '../src/query.js';
import type { GrawkusConfig, Message } from '../src/types.js';

vi.mock('../src/api.js', () => ({
  streamChat: vi.fn(),
  resetClient: vi.fn(),
}));

function config(): GrawkusConfig {
  return {
    apiKey: 'sk-test',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'openrouter/owl-alpha',
    fallbackModel: 'openrouter/free',
    provider: 'OpenRouter (Any Model)',
    permissionMode: 'yolo',
    maxTokens: 128,
    temperature: 0.3,
    showThinking: false,
  };
}

describe('runQuery provider liveness recovery', () => {
  const originalTimeout = process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS;
  const originalIdleTimeout = process.env.GRAWKUS_STREAM_IDLE_TIMEOUT_MS;
  const originalNonInteractive = process.env.GRAWKUS_NON_INTERACTIVE;
  const originalCompactionTrigger = process.env.GRAWKUS_COMPACTION_TRIGGER_TOKENS;

  beforeEach(() => {
    vi.mocked(streamChat).mockReset();
    vi.mocked(resetClient).mockReset();
    process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS = '1';
    process.env.GRAWKUS_STREAM_IDLE_TIMEOUT_MS = '1';
    process.env.GRAWKUS_NON_INTERACTIVE = '0';
  });

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS;
    } else {
      process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS = originalTimeout;
    }
    if (originalIdleTimeout === undefined) {
      delete process.env.GRAWKUS_STREAM_IDLE_TIMEOUT_MS;
    } else {
      process.env.GRAWKUS_STREAM_IDLE_TIMEOUT_MS = originalIdleTimeout;
    }
    if (originalNonInteractive === undefined) {
      delete process.env.GRAWKUS_NON_INTERACTIVE;
    } else {
      process.env.GRAWKUS_NON_INTERACTIVE = originalNonInteractive;
    }
    if (originalCompactionTrigger === undefined) {
      delete process.env.GRAWKUS_COMPACTION_TRIGGER_TOKENS;
    } else {
      process.env.GRAWKUS_COMPACTION_TRIGGER_TOKENS = originalCompactionTrigger;
    }
  });

  it('never preemptively switches a user-configured known-stuck OpenRouter model', async () => {
    vi.mocked(streamChat).mockImplementation(async function* (
      cfg: GrawkusConfig,
    ) {
      yield { type: 'text', content: `model=${cfg.model}` };
      yield { type: 'done' };
    });

    const cfg = config();
    const messages: Message[] = [{ role: 'user', content: 'Say hi' }];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-no-flaky-preflight-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(cfg.model).toBe('openrouter/owl-alpha');
    expect(resetClient).not.toHaveBeenCalled();
    expect(streamChat).toHaveBeenCalled();
    expect(vi.mocked(streamChat).mock.calls[0][0].model).toBe('openrouter/owl-alpha');
    expect(ctx.messages.at(-1)).toEqual({ role: 'assistant', content: 'model=openrouter/owl-alpha' });
  });

  it('retries with the fallback model when the primary model never sends a first stream event', async () => {
    process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS = '10';
    vi.mocked(streamChat).mockImplementation(async function* (
      cfg: GrawkusConfig,
      _messages: Message[],
      _tools: unknown[],
      signal?: AbortSignal,
    ) {
      if (cfg.model === 'openrouter/owl-alpha') {
        while (!signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        throw new Error('aborted');
      }
      yield { type: 'text', content: 'fallback response' };
      yield { type: 'done' };
    });

    const cfg = config();
    const messages: Message[] = [{ role: 'user', content: 'Say hi' }];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-liveness-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(cfg.model).toBe('openrouter/free');
    expect(resetClient).toHaveBeenCalledTimes(1);
    expect(streamChat).toHaveBeenCalledTimes(2);
    expect(ctx.messages.at(-1)).toEqual({ role: 'assistant', content: 'fallback response' });
  });

  it('retries once on the same model when fallback is disabled and the first response is empty', async () => {
    let call = 0;
    vi.mocked(streamChat).mockImplementation(async function* () {
      call++;
      if (call === 1) {
        yield { type: 'done' };
        return;
      }
      yield { type: 'text', content: 'complete response' };
      yield { type: 'done' };
    });

    const cfg = config();
    cfg.model = 'minimax/minimax-m2.1';
    cfg.fallbackModel = undefined;
    const messages: Message[] = [{ role: 'user', content: 'say hi' }];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-empty-retry-primary-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session-empty-retry-primary',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(streamChat).toHaveBeenCalledTimes(2);
    expect(ctx.messages.at(-1)).toEqual({ role: 'assistant', content: 'complete response' });
  });

  it('hard-times out a provider that ignores abort before the first event', async () => {
    vi.mocked(streamChat).mockImplementation(async function* () {
      await new Promise(() => { /* provider never resolves */ });
    });

    const cfg = config();
    cfg.model = 'minimax/minimax-m2.1';
    cfg.fallbackModel = undefined;
    const messages: Message[] = [{ role: 'user', content: 'i like ketchup' }];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-hard-timeout-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session-hard-timeout',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(streamChat).toHaveBeenCalledTimes(2);
    expect(ctx.messages.at(-1)?.role).toBe('assistant');
    expect(String(ctx.messages.at(-1)?.content)).toContain('[Provider timeout: minimax/minimax-m2.1 produced no stream events');
  });

  it('closes timed-out provider iterators before retrying', async () => {
    const closed: Array<ReturnType<typeof vi.fn>> = [];
    vi.mocked(streamChat).mockImplementation(() => {
      const returnSpy = vi.fn(async () => ({ done: true, value: undefined }));
      closed.push(returnSpy);
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise(() => { /* provider ignores abort */ }),
            return: returnSpy,
          };
        },
      } as never;
    });

    const cfg = config();
    cfg.model = 'minimax/minimax-m2.1';
    cfg.fallbackModel = undefined;
    const messages: Message[] = [{ role: 'user', content: 'i like ketchup' }];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-timeout-close-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session-timeout-close',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(streamChat).toHaveBeenCalledTimes(2);
    expect(closed).toHaveLength(2);
    expect(closed[0]).toHaveBeenCalledTimes(1);
    expect(closed[1]).toHaveBeenCalledTimes(1);
    expect((globalThis as { __turnCancelCurrent?: unknown }).__turnCancelCurrent).toBeNull();
  });

  it('hard-times out a provider stream that stalls after the first event', async () => {
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield { type: 'thinking', content: 'internal progress' };
      await new Promise(() => { /* provider never sends text, tool calls, done, or stream close */ });
    });

    const cfg = config();
    cfg.model = 'minimax/minimax-m2.1';
    cfg.fallbackModel = undefined;
    const messages: Message[] = [{ role: 'user', content: 'i like ketchup' }];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-stream-idle-timeout-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session-stream-idle-timeout',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(streamChat).toHaveBeenCalledTimes(2);
    expect(ctx.messages.at(-1)?.role).toBe('assistant');
    expect(String(ctx.messages.at(-1)?.content)).toContain('[Provider timeout: minimax/minimax-m2.1 stream stalled');
  });

  it('returns as soon as the provider emits done instead of waiting for socket close', async () => {
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield { type: 'text', content: 'complete response' };
      yield { type: 'done' };
      await new Promise(() => { /* provider connection never closes */ });
    });

    const cfg = config();
    cfg.model = 'minimax/minimax-m2.1';
    cfg.fallbackModel = undefined;
    const messages: Message[] = [{ role: 'user', content: 'say hi' }];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-done-break-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session-done-break',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(ctx.messages.at(-1)).toEqual({ role: 'assistant', content: 'complete response' });
  });

  it('treats global F5 cancellation as a user cancellation instead of a provider failure', async () => {
    process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS = '0';

    vi.mocked(streamChat).mockImplementation(async function* (
      _cfg: GrawkusConfig,
      _messages: Message[],
      _tools: unknown[],
      signal?: AbortSignal,
    ) {
      const cancel = (globalThis as { __turnCancelCurrent?: () => void }).__turnCancelCurrent;
      expect(typeof cancel).toBe('function');
      cancel?.();
      expect(signal?.aborted).toBe(true);
      throw new Error('aborted');
    });

    const cfg = config();
    cfg.model = 'openrouter/free';
    cfg.fallbackModel = undefined;
    const messages: Message[] = [{ role: 'user', content: 'Say hi' }];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-global-cancel-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(resetClient).not.toHaveBeenCalled();
    expect(ctx.messages.at(-1)?.role).toBe('assistant');
    expect(String(ctx.messages.at(-1)?.content)).toContain('[interrupted by user steer');
    expect((globalThis as { __turnCancelCurrent?: unknown }).__turnCancelCurrent).toBeNull();
  });

  it('uses an isolated no-tools request for first-turn short direct prompts', async () => {
    let sentMessages: Message[] = [];
    let sentTools: unknown[] = [];
    vi.mocked(streamChat).mockImplementation(async function* (
      _cfg: GrawkusConfig,
      apiMessages: Message[],
      tools: unknown[],
    ) {
      sentMessages = apiMessages;
      sentTools = tools;
      yield { type: 'text', content: 'A fresh short poem.' };
      yield { type: 'done' };
    });

    const cfg = config();
    cfg.model = 'openrouter/free';
    cfg.showThinking = true;
    const messages: Message[] = [
      { role: 'user', content: 'Can you write a short poem for me about dinner' },
    ];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-fast-direct-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session-fast-direct',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(sentTools).toEqual([]);
    expect(sentMessages.filter((m) => m.role === 'user')).toEqual([
      { role: 'user', content: 'Can you write a short poem for me about dinner' },
    ]);
    expect(ctx.messages.at(-1)).toEqual({ role: 'assistant', content: 'A fresh short poem.' });
  });

  it('keeps buildable website prompts on the full tool-capable path', async () => {
    let sentMessages: Message[] = [];
    let sentTools: unknown[] = [];
    vi.mocked(streamChat).mockImplementation(async function* (
      _cfg: GrawkusConfig,
      apiMessages: Message[],
      tools: unknown[],
    ) {
      sentMessages = apiMessages;
      sentTools = tools;
      yield { type: 'text', content: 'I will create the website file.' };
      yield { type: 'done' };
    });

    const cfg = config();
    cfg.model = 'openrouter/free';
    cfg.showThinking = true;
    const messages: Message[] = [
      { role: 'user', content: 'I need you to write a website for a man named Harry Sprouts. He is a data scientist, make him hireable.' },
    ];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-website-full-path-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session-website-full-path',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(sentTools.length).toBeGreaterThan(0);
    expect(sentMessages[0]?.role).toBe('system');
    expect(String(sentMessages[0]?.content)).toContain('tools available');
    expect(ctx.messages.at(-1)).toEqual({ role: 'assistant', content: 'I will create the website file.' });
  });

  it('passes AGENTS.md tool-scoped instructions to the provider tool schema', async () => {
    let sentTools: Array<{ name?: string; description?: string }> = [];
    vi.mocked(streamChat).mockImplementation(async function* (
      _cfg: GrawkusConfig,
      _apiMessages: Message[],
      tools: Array<{ name?: string; description?: string }>,
    ) {
      sentTools = tools;
      yield { type: 'text', content: 'I will use the scoped tool guidance.' };
      yield { type: 'done' };
    });

    const cfg = config();
    cfg.model = 'openrouter/free';
    cfg.fallbackModel = undefined;
    const messages: Message[] = [
      { role: 'user', content: 'create a single-file HTML landing page' },
    ];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-agents-md-'));
    writeFileSync(join(cwd, 'AGENTS.md'), `
## Tool: bash
Use short, bounded shell commands for this repository.
`);
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session-agents-md',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    const bashTool = sentTools.find((tool) => tool.name === 'bash');
    expect(bashTool?.description).toContain('Use short, bounded shell commands for this repository.');
    expect(ctx.messages.at(-1)).toEqual({ role: 'assistant', content: 'I will use the scoped tool guidance.' });
  });

  it('routes polite casual prompts through fast-direct without catching repo work', () => {
    expect(shouldUseFastDirectReply('Can you write a poem for me?', 'dev')).toBe(true);
    expect(shouldUseFastDirectReply('please summarize this paragraph', 'dev')).toBe(true);
    expect(shouldUseFastDirectReply('I need you to explain novocaine', 'dev')).toBe(true);
    expect(shouldUseFastDirectReply('I need your help', 'dev')).toBe(true);
    expect(shouldUseFastDirectReply('i like ketchup', 'dev')).toBe(true);
    expect(shouldUseFastDirectReply('Sorry, make it more accurate to the time', 'dev')).toBe(true);
    expect(shouldUseFastDirectReply('I need you to write a website for Harry Sprouts', 'dev')).toBe(false);
    expect(shouldUseFastDirectReply('make a portfolio website for a data scientist', 'dev')).toBe(false);
    expect(shouldUseFastDirectReply('create a single-file HTML landing page', 'dev')).toBe(false);
    expect(shouldUseFastDirectReply('could you please continue that', 'dev')).toBe(false);
    expect(shouldUseFastDirectReply('can you fix the tests', 'dev')).toBe(false);
    expect(shouldUseFastDirectReply('give me a git command', 'dev')).toBe(false);
  });

  it('keeps follow-up rewrites on full-context path when prior assistant context exists', () => {
    const followup = 'I need you to make the bear cub distinctively male';
    expect(shouldUseFastDirectReply(followup, 'dev', false)).toBe(false);
    expect(shouldUseFastDirectReply(followup, 'dev', true)).toBe(false);
  });

  it('disables fast-direct when there is prior assistant context in the session', async () => {
    let sentMessages: Message[] = [];
    vi.mocked(streamChat).mockImplementation(async function* (
      _cfg: GrawkusConfig,
      apiMessages: Message[],
    ) {
      sentMessages = apiMessages;
      yield { type: 'text', content: 'Done.' };
      yield { type: 'done' };
    });

    const cfg = config();
    cfg.model = 'openrouter/free';
    cfg.fallbackModel = undefined;
    const messages: Message[] = [
      { role: 'user', content: 'write a story about a bear cub lost in the forest' },
      { role: 'assistant', content: 'A story about a cub named Rowan...' },
      { role: 'user', content: 'I need you to make the bear cub distinctively male' },
    ];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-followup-context-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session-followup-context',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    const convo = sentMessages.filter((m) => m.role === 'user' || m.role === 'assistant');
    expect(convo.length).toBeGreaterThan(1);
    expect(convo.some((m) => m.role === 'assistant' && String(m.content).includes('cub named Rowan'))).toBe(true);
    expect(ctx.messages.at(-1)).toEqual({ role: 'assistant', content: 'Done.' });
  });

  it('uses full-context path for short follow-ups when prior assistant context exists', async () => {
    process.env.GRAWKUS_COMPACTION_TRIGGER_TOKENS = '1';

    let sentMessages: Message[] = [];
    vi.mocked(streamChat).mockImplementation(async function* (
      _cfg: GrawkusConfig,
      apiMessages: Message[],
    ) {
      sentMessages = apiMessages;
      yield { type: 'text', content: 'Dinner poem.' };
      yield { type: 'done' };
    });

    const cfg = config();
    cfg.model = 'openrouter/free';
    const bloated = 'old Dungeons context '.repeat(10_000);
    const messages: Message[] = [
      { role: 'user', content: bloated },
      { role: 'assistant', content: bloated },
      { role: 'user', content: 'Could you write a short poem about dinner?' },
    ];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-fast-direct-no-compact-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session-fast-direct-no-compact',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(streamChat).toHaveBeenCalledTimes(1);
    const convo = sentMessages.filter((m) => m.role === 'user' || m.role === 'assistant');
    expect(convo.length).toBeGreaterThan(1);
    expect(convo.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('preserves message-array identity so autosave sees multi-turn history', async () => {
    const sentRequests: Message[][] = [];
    vi.mocked(streamChat).mockImplementation(async function* (
      _cfg: GrawkusConfig,
      apiMessages: Message[],
    ) {
      sentRequests.push(apiMessages);
      yield {
        type: 'text',
        content: sentRequests.length === 1
          ? 'First response'
          : sentRequests.length === 2
            ? 'Second response'
            : 'Third response',
      };
      yield { type: 'done' };
    });

    const cfg = config();
    cfg.model = 'openrouter/free';
    cfg.fallbackModel = undefined;
    const messages: Message[] = [{ role: 'user', content: 'First prompt' }];
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-query-history-identity-'));
    const ctx = {
      config: cfg,
      messages,
      cwd,
      rl: {} as never,
      sessionId: 'test-session-history-identity',
      mode: 'dev' as const,
    };
    try {
      await runQuery(ctx);
      expect((globalThis as { __turnCancelCurrent?: unknown }).__turnCancelCurrent).toBeNull();
      expect(ctx.messages).toBe(messages);
      expect(messages).toEqual([
        { role: 'user', content: 'First prompt' },
        { role: 'assistant', content: 'First response' },
      ]);

      messages.push({ role: 'user', content: 'Second prompt' });
      await runQuery(ctx);
      expect((globalThis as { __turnCancelCurrent?: unknown }).__turnCancelCurrent).toBeNull();
      messages.push({ role: 'user', content: 'Third prompt' });
      await runQuery(ctx);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(ctx.messages).toBe(messages);
    expect(messages).toEqual([
      { role: 'user', content: 'First prompt' },
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Second prompt' },
      { role: 'assistant', content: 'Second response' },
      { role: 'user', content: 'Third prompt' },
      { role: 'assistant', content: 'Third response' },
    ]);
    const secondConversation = sentRequests[1].filter((m) => m.role === 'user' || m.role === 'assistant');
    expect(secondConversation).toEqual([
      { role: 'user', content: 'First prompt' },
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Second prompt' },
    ]);
    const thirdConversation = sentRequests[2].filter((m) => m.role === 'user' || m.role === 'assistant');
    expect(thirdConversation).toEqual([
      { role: 'user', content: 'First prompt' },
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Second prompt' },
      { role: 'assistant', content: 'Second response' },
      { role: 'user', content: 'Third prompt' },
    ]);
    expect((globalThis as { __turnCancelCurrent?: unknown }).__turnCancelCurrent).toBeNull();
  });

  it('does not shorten fast-direct first-token recovery below the normal interactive timeout', () => {
    delete process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS;
    const cfg = config();
    cfg.model = 'minimax/minimax-m2.7';
    cfg.fallbackModel = undefined;

    expect(resolveTurnFirstTokenTimeoutMs(cfg, false)).toBe(8_000);
    expect(resolveTurnFirstTokenTimeoutMs(cfg, true)).toBe(8_000);

    process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS = '1';
    expect(resolveTurnFirstTokenTimeoutMs(cfg, true)).toBe(1);
  });

  it('formats the active-turn waiting indicator with animation and interrupt hint', () => {
    expect(formatWorkingIndicatorFrame(83_000, 0)).toContain('Working (1m 23s • Esc/F5 to interrupt)');
    expect(formatWorkingIndicatorFrame(83_000, 1, 'Edo lanterns lit')).toContain('Edo lanterns lit');
  });
});
