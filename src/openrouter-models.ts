/**
 * OpenRouter model catalog fetcher.
 *
 * GET https://openrouter.ai/api/v1/models returns the full catalog
 * (300+ entries) with per-token pricing in USD. We cache the result
 * for the duration of the process — the catalog only changes when
 * OpenRouter adds/removes models, which is rare enough that one
 * fetch per REPL session is the right trade-off.
 *
 * Pricing in the response is per-token; we convert to per-1M tokens
 * for display because that's how everyone quotes LLM costs.
 *
 * No auth required for /models (it's public). We hit it without the
 * user's API key so it works even before the user has finished
 * configuring their key.
 */

export interface OpenRouterModel {
  /** Canonical model ID, e.g. "anthropic/claude-sonnet-4". */
  id: string;
  /** Display name, e.g. "Claude Sonnet 4". */
  name: string;
  /** Context window in tokens, or null if unknown. */
  contextLength: number | null;
  /** USD per million input tokens. */
  promptPerM: number;
  /** USD per million output tokens. */
  completionPerM: number;
  /** USD per request. Usually 0 for chat models. */
  requestCost: number;
  /** True when the model is usable through a zero-cost route. */
  isFree: boolean;
  /** True for OpenRouter's dynamic zero-cost router. */
  isFreeRouter: boolean;
  /** Supported request parameters from the catalog, e.g. "tools". */
  supportedParameters: string[];
  /** Output modalities from the catalog architecture block. */
  outputModalities: string[];
  /** True when the model can be used for normal text chat. */
  isTextModel: boolean;
  /** True when the model advertises tool/function calling support. */
  supportsTools: boolean;
}

interface RawModel {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    request?: string | number;
  };
  supported_parameters?: string[];
  architecture?: {
    output_modalities?: string[];
  };
  top_provider?: {
    context_length?: number;
  };
}

let _cache: OpenRouterModel[] | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;  // 1 hour

/**
 * Fetch the OpenRouter model catalog, normalized + sorted (free
 * models first, then alphabetical by ID).
 *
 * Returns an empty array on any network / parse failure instead of
 * throwing — the caller is typically the model-picker, which can
 * gracefully say "couldn't fetch models" without aborting the REPL.
 */
export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  // Cache hit?
  if (_cache && (Date.now() - _cacheAt) < CACHE_TTL_MS) {
    return _cache;
  }

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      // Quick timeout — picker is interactive, can't sit on a stuck
      // request. If the network is slow the user can use /model <id>
      // directly.
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'grawkus/1.x' },
    });
    if (!resp.ok) return [];
    const json = await resp.json() as { data?: RawModel[] };
    const raw = json.data ?? [];

    const models: OpenRouterModel[] = [];
    for (const r of raw) {
      if (!r.id) continue;
      const prompt = parsePrice(r.pricing?.prompt);
      const completion = parsePrice(r.pricing?.completion);
      const request = parsePrice(r.pricing?.request);
      const supportedParameters = Array.isArray(r.supported_parameters) ? r.supported_parameters : [];
      const outputModalities = Array.isArray(r.architecture?.output_modalities)
        ? r.architecture.output_modalities
        : [];
      const isFreeRouter = r.id === 'openrouter/free';
      const isTextModel = outputModalities.length === 0 || outputModalities.includes('text');
      const supportsTools = supportedParameters.includes('tools') || supportedParameters.includes('tool_choice');
      models.push({
        id: r.id,
        name: r.name ?? r.id,
        contextLength: typeof r.context_length === 'number'
          ? r.context_length
          : (typeof r.top_provider?.context_length === 'number' ? r.top_provider.context_length : null),
        promptPerM: prompt * 1_000_000,
        completionPerM: completion * 1_000_000,
        requestCost: request,
        isFree: isFreeRouter || (prompt === 0 && completion === 0 && request === 0 && isTextModel),
        isFreeRouter,
        supportedParameters,
        outputModalities,
        isTextModel,
        supportsTools,
      });
    }

    // Sort: OpenRouter's free router first, then free text+tool models,
    // then other free text models, then paid. Within each bucket prefer
    // larger context and then alphabetical ID. Free availability changes
    // often, so the catalog decides the actual ordering at runtime.
    models.sort((a, b) => {
      const ar = openRouterFreeRank(a);
      const br = openRouterFreeRank(b);
      if (ar !== br) return ar - br;
      const ac = a.contextLength ?? 0;
      const bc = b.contextLength ?? 0;
      if (ac !== bc) return bc - ac;
      return a.id.localeCompare(b.id);
    });

    _cache = models;
    _cacheAt = Date.now();
    return models;
  } catch {
    return [];
  }
}

export function isOpenRouterFreeModelId(model: string | undefined): boolean {
  const id = (model ?? '').trim().toLowerCase();
  return id === 'openrouter/free' || id.endsWith(':free');
}

export function getCachedOpenRouterModelContextLength(model: string | undefined): number | null {
  const id = (model ?? '').trim().toLowerCase();
  if (!id || !_cache) return null;
  const found = _cache.find((m) => m.id.toLowerCase() === id);
  return found?.contextLength ?? null;
}

function openRouterFreeRank(model: OpenRouterModel): number {
  if (model.isFreeRouter) return 0;
  if (model.isFree && model.isTextModel && model.supportsTools) return 1;
  if (model.isFree && model.isTextModel) return 2;
  if (model.isFree) return 3;
  return 4;
}

function parsePrice(p: string | number | undefined): number {
  if (p === undefined || p === null) return 0;
  if (typeof p === 'number') return p;
  const n = parseFloat(p);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format the per-million pricing as a compact column for use in
 * the picker's hint field. "in:$0.14 out:$0.28 · 128k" style.
 */
export function formatPricing(m: OpenRouterModel): string {
  if (m.isFree) {
    return `FREE · ${formatCtx(m.contextLength)}`;
  }
  return `in:$${formatPrice(m.promptPerM)} out:$${formatPrice(m.completionPerM)} · ${formatCtx(m.contextLength)}`;
}

function formatPrice(n: number): string {
  // Sub-$1: show two decimals. $1+: show one or whole-dollar.
  if (n < 1) return n.toFixed(2);
  if (n < 10) return n.toFixed(1);
  return n.toFixed(0);
}

function formatCtx(ctx: number | null): string {
  if (!ctx) return '?';
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(1)}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}k`;
  return String(ctx);
}
