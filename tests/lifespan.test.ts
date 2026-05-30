import { describe, expect, it } from 'vitest';
import {
  buildLifespanReport,
  formatLifespanReport,
  parseLifespanArgs,
} from '../src/lifespan.js';
import type { GrawkusConfig, Message } from '../src/types.js';

const baseConfig: Pick<GrawkusConfig, 'model' | 'provider' | 'baseURL' | 'contextWindowTokens' | 'fallbackModel' | 'memory'> = {
  model: 'openrouter/free',
  provider: 'OpenRouter',
  baseURL: 'https://openrouter.ai/api/v1',
  contextWindowTokens: 8_000,
  memory: { enabled: true },
};

describe('lifespan diagnostic', () => {
  it('parses json output flags', () => {
    expect(parseLifespanArgs('--json')).toEqual({ json: true });
    expect(parseLifespanArgs('--format json')).toEqual({ json: true });
    expect(parseLifespanArgs('')).toEqual({ json: false });
  });

  it('scores long histories and exposes next actions', () => {
    const messages: Message[] = [
      { role: 'user', content: 'write a poem about a hiker' },
      { role: 'assistant', content: 'Here is a poem.' },
      { role: 'user', content: 'actually make it male' },
      { role: 'assistant', content: 'Revised poem.' },
      { role: 'user', content: '/config' },
      { role: 'assistant', content: '429 Provider returned error status timeout' },
      { role: 'user', content: 'now build a game instead' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'bash', arguments: '{"command":"npm test"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'Error: test failed' },
      { role: 'assistant', content: '<<CONVERSATION SUMMARY - 20 messages compacted>>' },
    ];

    const report = buildLifespanReport(
      messages,
      { ...baseConfig, fallbackModel: undefined },
      'C:\\repo',
      new Date('2026-05-30T00:00:00.000Z'),
    );

    expect(report.format).toBe('grawkus-lifespan-v1');
    expect(report.summary.userTurns).toBe(4);
    expect(report.summary.toolErrors).toBeGreaterThanOrEqual(2);
    expect(report.dimensions.map((item) => item.id)).toEqual([
      'compression',
      'interference',
      'revision',
      'maintenance',
    ]);
    expect(report.nextActions.length).toBeGreaterThan(0);
  });

  it('formats text and json reports', () => {
    const report = buildLifespanReport(
      [{ role: 'user', content: 'fix prompt freezing' }],
      baseConfig,
      'C:\\repo',
      new Date('2026-05-30T00:00:00.000Z'),
    );

    expect(formatLifespanReport(report)).toContain('Grawkus Lifespan Diagnostic');

    const json = JSON.parse(formatLifespanReport(report, { json: true })) as { format: string };
    expect(json.format).toBe('grawkus-lifespan-v1');
  });
});
