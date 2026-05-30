/**
 * Harness Asset Registry — typed asset metadata for progressive disclosure.
 * 
 * Assets are the reusable building blocks of Grawkus: skills, subagents,
 * rules, hooks, tools, prompts, memory policies, verifier contracts, etc.
 * 
 * Metadata is cheap to load; full content is loaded only when selected
 * (progressive disclosure). This prevents context bloat when hundreds
 * of assets are available.
 */

/** Kinds of harness assets Grawkus can manage. */
export type HarnessAssetKind =
  | 'system_prompt'
  | 'tool_description'
  | 'tool'
  | 'middleware'
  | 'skill'
  | 'subagent'
  | 'rule'
  | 'hook'
  | 'memory_policy'
  | 'mcp_config'
  | 'benchmark_profile'
  | 'verifier_contract';

/** How well an asset maps to a target harness. */
export type AdapterCapability =
  | 'native'         // directly enforced by target harness
  | 'adapted'        // maps cleanly but not perfectly
  | 'instruction_only' // represented as instructions; not deterministically enforced
  | 'unsupported';   // cannot safely map

/** Risk level for harness assets. */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Load level for progressive disclosure. */
export type LoadLevel = 'metadata' | 'full';

/** Metadata for a single harness asset. Cheap to load. */
export interface HarnessAssetMeta {
  id: string;
  name: string;
  version: string;
  kind: HarnessAssetKind;
  description: string;
  origin: string;
  tags: string[];
  requiredTools: string[];
  permissions: Record<string, unknown>;
  contextBudget?: {
    metadataTokens?: number;
    fullAssetTokens?: number;
  };
  riskLevel: RiskLevel;
  targetHarnesses: Record<string, AdapterCapability>;
  verifierContract?: string[];
  metadataPath?: string;
  bodyPath?: string;
}

/** Decision record for why and how an asset was loaded. */
export interface AssetLoadDecision {
  assetId: string;
  reason: string;
  loadLevel: LoadLevel;
  estimatedTokens?: number;
}

/** A loaded harness asset — metadata plus optional full body. */
export interface HarnessAsset {
  meta: HarnessAssetMeta;
  body?: string;
}

/**
 * Simple progressive-disclosure loader.
 * Returns metadata first; call loadBody() only when the asset is selected.
 */
export interface AssetLoader {
  listMeta(kind?: HarnessAssetKind): HarnessAssetMeta[];
  getMeta(id: string): HarnessAssetMeta | null;
  loadBody(id: string): string | null;
}
