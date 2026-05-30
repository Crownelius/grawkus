import { describe, expect, it } from 'vitest';
import {
  deleteModelAlias,
  listModelAliases,
  parseModelOnce,
  resolveModelReference,
  setModelAlias,
} from '../src/model-aliases.js';
import { PROVIDERS, type GrawkusConfig } from '../src/types.js';

function config(): GrawkusConfig {
  return {
    apiKey: 'sk-test',
    baseURL: PROVIDERS.openrouter.baseURL,
    model: 'openrouter/free',
    provider: PROVIDERS.openrouter.name,
    maxTokens: 8192,
    temperature: 0.3,
    permissionMode: 'ask',
  };
}

describe('model aliases and one-shot overrides', () => {
  it('stores user aliases and resolves them before direct model ids', () => {
    const cfg = config();
    const set = setModelAlias(cfg, 'paid', 'anthropic/claude-sonnet-4');
    expect(set).toEqual({ ok: true, model: 'anthropic/claude-sonnet-4' });
    expect(resolveModelReference(cfg, 'paid')).toMatchObject({
      model: 'anthropic/claude-sonnet-4',
      source: 'user-alias',
    });
    expect(listModelAliases(cfg).map((item) => item.alias)).toContain('paid');
    expect(deleteModelAlias(cfg, 'paid')).toBe(true);
    expect(resolveModelReference(cfg, 'paid')).toMatchObject({ model: 'paid', source: 'direct' });
  });

  it('rejects reserved or empty aliases', () => {
    const cfg = config();
    expect(setModelAlias(cfg, 'once', 'openrouter/free').ok).toBe(false);
    expect(setModelAlias(cfg, 'quick', '').ok).toBe(false);
  });

  it('parses next-turn model and reasoning effort overrides', () => {
    const cfg = config();
    setModelAlias(cfg, 'paid', 'anthropic/claude-sonnet-4');
    const parsed = parseModelOnce(cfg, 'paid --effort high');
    expect(parsed.error).toBeUndefined();
    expect(parsed.override).toMatchObject({
      model: 'anthropic/claude-sonnet-4',
      reasoningEffort: 'high',
    });

    expect(parseModelOnce(cfg, '--effort nonsense').error).toContain('Invalid reasoning effort');
  });
});
