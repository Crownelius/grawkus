import { describe, it, expect, vi, afterEach } from 'vitest';

async function loadWithCatalog(data: unknown[]) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ data }),
  })));
  return import('../src/openrouter-models.js');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openrouter-models', () => {
  it('detects OpenRouter free model ids', async () => {
    const { isOpenRouterFreeModelId } = await loadWithCatalog([]);
    expect(isOpenRouterFreeModelId('openrouter/free')).toBe(true);
    expect(isOpenRouterFreeModelId('qwen/qwen3-coder:free')).toBe(true);
    expect(isOpenRouterFreeModelId('anthropic/claude-sonnet-4')).toBe(false);
  });

  it('sorts the free router and free text tool models before paid models', async () => {
    const { fetchOpenRouterModels, getCachedOpenRouterModelContextLength } = await loadWithCatalog([
      {
        id: 'anthropic/claude-sonnet-4',
        name: 'Claude Sonnet',
        context_length: 200_000,
        pricing: { prompt: '0.000003', completion: '0.000015', request: '0' },
        supported_parameters: ['tools'],
        architecture: { output_modalities: ['text'] },
      },
      {
        id: 'audio/free-preview',
        name: 'Audio Free Preview',
        context_length: 1_000_000,
        pricing: { prompt: '0', completion: '0', request: '0' },
        supported_parameters: ['max_tokens'],
        architecture: { output_modalities: ['audio'] },
      },
      {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        name: 'Llama Free',
        context_length: 131_072,
        pricing: { prompt: '0', completion: '0', request: '0' },
        supported_parameters: ['max_tokens'],
        architecture: { output_modalities: ['text'] },
      },
      {
        id: 'qwen/qwen3-coder:free',
        name: 'Qwen Coder Free',
        context_length: 1_048_576,
        pricing: { prompt: '0', completion: '0', request: '0' },
        supported_parameters: ['tools', 'tool_choice', 'max_tokens'],
        architecture: { output_modalities: ['text'] },
      },
      {
        id: 'openrouter/free',
        name: 'Free Models Router',
        top_provider: { context_length: 200_000 },
        pricing: { prompt: '0', completion: '0', request: '0' },
        supported_parameters: ['tools'],
        architecture: { output_modalities: ['text'] },
      },
    ]);

    const models = await fetchOpenRouterModels();
    expect(models.map((m) => m.id).slice(0, 3)).toEqual([
      'openrouter/free',
      'qwen/qwen3-coder:free',
      'meta-llama/llama-3.3-70b-instruct:free',
    ]);
    expect(models.find((m) => m.id === 'audio/free-preview')?.isFree).toBe(false);
    expect(models.find((m) => m.id === 'openrouter/free')?.contextLength).toBe(200_000);
    expect(getCachedOpenRouterModelContextLength('qwen/qwen3-coder:free')).toBe(1_048_576);
    expect(getCachedOpenRouterModelContextLength('missing/model')).toBeNull();
  });

  it('formats free pricing without exposing token prices', async () => {
    const { fetchOpenRouterModels, formatPricing } = await loadWithCatalog([
      {
        id: 'openrouter/free',
        name: 'Free Models Router',
        context_length: 200_000,
        pricing: { prompt: '0', completion: '0', request: '0' },
        supported_parameters: ['tools'],
        architecture: { output_modalities: ['text'] },
      },
    ]);
    const [model] = await fetchOpenRouterModels();
    expect(formatPricing(model)).toBe('FREE · 200k');
  });
});
