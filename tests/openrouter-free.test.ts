import { describe, it, expect } from 'vitest';
import { PROVIDERS, type GrawkusConfig } from '../src/types.js';
import { isValidRouteRole, parseRouteRole, routeModel, switchModel } from '../src/model-router.js';

function cfg(model = 'anthropic/claude-sonnet-4'): GrawkusConfig {
  return {
    apiKey: 'sk-test',
    baseURL: PROVIDERS.openrouter.baseURL,
    model,
    provider: PROVIDERS.openrouter.name,
    maxTokens: 8192,
    temperature: 0.3,
    permissionMode: 'ask',
  };
}

describe('OpenRouter free-tier defaults', () => {
  it('uses the free router as the provider default', () => {
    expect(PROVIDERS.openrouter.defaultModel).toBe('openrouter/free');
  });

  it('routes all OpenRouter complexity tiers to the free router', () => {
    expect(routeModel(cfg(), 'simple').model).toBe('openrouter/free');
    expect(routeModel(cfg(), 'medium').model).toBe('openrouter/free');
    expect(routeModel(cfg(), 'complex').model).toBe('openrouter/free');
  });

  it('honors explicit route roles', () => {
    expect(routeModel(cfg(), 'simple', 'fast').model).toBe('openrouter/free');
    expect(routeModel(cfg(), 'simple', 'balanced').model).toBe('openrouter/free');
    expect(routeModel(cfg(), 'complex', 'powerful').model).toBe('openrouter/free');
  });

  it('parses and validates route roles', () => {
    expect(parseRouteRole('analysis')).toBe('analysis');
    expect(parseRouteRole('code')).toBe('coding');
    expect(parseRouteRole('  verification ')).toBe('verification');
    expect(parseRouteRole('auto')).toBe('auto');
    expect(isValidRouteRole('')).toBe(true);
    expect(isValidRouteRole('fast')).toBe(true);
    expect(isValidRouteRole('analysis')).toBe(true);
    expect(isValidRouteRole('weird-role')).toBe(false);
  });

  it('allows switching by the free-router model id', () => {
    expect(switchModel(cfg(), 'openrouter/free')).toBe('openrouter/free');
  });
});
