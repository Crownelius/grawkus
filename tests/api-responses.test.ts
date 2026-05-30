import { describe, expect, it } from 'vitest';
import {
  buildCodexResponsesRequest,
  buildChatCompletionsRequest,
  messagesToResponsesInput,
  messagesToResponsesInstructions,
  resolveChatRetryConfig,
  shouldRequestChatStreamUsage,
  toolsToResponsesTools,
} from '../src/api.js';
import type { Message } from '../src/types.js';
import type { Tool } from '../src/tools/types.js';

describe('Responses API conversion', () => {
  it('preserves function call continuity across assistant and tool messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Read the file.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_123',
          type: 'function',
          function: { name: 'read_file', arguments: '{"file_path":"README.md"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call_123', content: 'file contents' },
    ];

    expect(messagesToResponsesInstructions(messages)).toBe('Be concise.');
    expect(messagesToResponsesInput(messages)).toEqual([
      { type: 'message', role: 'user', content: 'Read the file.' },
      {
        type: 'function_call',
        call_id: 'call_123',
        name: 'read_file',
        arguments: '{"file_path":"README.md"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_123',
        output: 'file contents',
      },
    ]);
  });

  it('builds a Codex OAuth payload without unsupported public Responses params', () => {
    const messages: Message[] = [
      { role: 'system', content: 'Use short answers.' },
      { role: 'user', content: 'Say hi.' },
    ];
    const payload = buildCodexResponsesRequest({
      apiKey: '',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      model: 'gpt-5.5',
      provider: 'OpenAI Codex (OAuth)',
      maxTokens: 4096,
      temperature: 0.3,
      permissionMode: 'ask',
    }, messages, []);

    expect(payload).toMatchObject({
      model: 'gpt-5.5',
      instructions: 'Use short answers.',
      input: [{ type: 'message', role: 'user', content: 'Say hi.' }],
      stream: true,
      store: false,
      parallel_tool_calls: true,
    });
    expect(payload).not.toHaveProperty('temperature');
    expect(payload).not.toHaveProperty('max_output_tokens');
    expect(payload).not.toHaveProperty('max_completion_tokens');
  });

  it('emits Responses API function tools with non-strict schemas', () => {
    const tools: Tool[] = [{
      name: 'grep',
      description: 'Search text',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
        },
        required: ['pattern'],
      },
      call: async () => ({ output: '', isError: false }),
    }];

    expect(toolsToResponsesTools(tools)).toEqual([{
      type: 'function',
      name: 'grep',
      description: 'Search text',
      parameters: tools[0].parameters,
      strict: false,
    }]);
  });
});

describe('Chat stream retry policy', () => {
  it('fails fast by default in the interactive REPL', () => {
    expect(resolveChatRetryConfig(
      { baseURL: 'https://openrouter.ai/api/v1' },
      {},
    ).maxRetries).toBe(0);
  });

  it('keeps limited retries for non-interactive harness runs and supports override', () => {
    expect(resolveChatRetryConfig(
      { baseURL: 'https://openrouter.ai/api/v1' },
      { GRAWKUS_NON_INTERACTIVE: '1' },
    ).maxRetries).toBe(2);
    expect(resolveChatRetryConfig(
      { baseURL: 'https://openrouter.ai/api/v1' },
      { GRAWKUS_API_RETRIES: '4' },
    ).maxRetries).toBe(4);
  });
});

describe('Chat Completions stream usage request', () => {
  it('adds reasoning_effort when configured', () => {
    const request = buildChatCompletionsRequest({
      apiKey: 'sk-test',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-5.5',
      provider: 'OpenRouter',
      maxTokens: 4096,
      temperature: 0.3,
      permissionMode: 'ask',
      reasoningEffort: 'high',
    }, [{ role: 'user', content: 'Think carefully.' }], []);

    expect(request.reasoning_effort).toBe('high');
    expect(request.model).toBe('openai/gpt-5.5');
  });

  it('requests usage for OpenRouter cloud endpoints', () => {
    expect(shouldRequestChatStreamUsage({ baseURL: 'https://openrouter.ai/api/v1' }, {})).toBe(true);
  });

  it('does not send stream_options to local OpenAI-compatible servers by default', () => {
    expect(shouldRequestChatStreamUsage({ baseURL: 'http://localhost:11434/v1' }, {})).toBe(false);
    expect(shouldRequestChatStreamUsage({ baseURL: 'http://127.0.0.1:1234/v1' }, {})).toBe(false);
  });

  it('supports explicit env override', () => {
    expect(shouldRequestChatStreamUsage(
      { baseURL: 'http://localhost:11434/v1' },
      { GRAWKUS_STREAM_USAGE: '1' },
    )).toBe(true);
    expect(shouldRequestChatStreamUsage(
      { baseURL: 'https://openrouter.ai/api/v1' },
      { GRAWKUS_STREAM_USAGE: '0' },
    )).toBe(false);
  });
});
