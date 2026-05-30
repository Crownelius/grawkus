import type { Tool } from './types.js';
import { BashTool } from './bash.js';
import { ReadTool } from './read.js';
import { WriteTool } from './write.js';
import { EditTool } from './edit.js';
import { GrepTool } from './grep.js';
import { GlobTool } from './glob.js';
import { WebFetchTool } from './web-fetch.js';
import { WebSearchTool } from './web-search.js';
import { ResearchSourcesTool } from './research-sources.js';
import { GitHubRepoDigestTool } from './github-repo-digest.js';
import { BenchmarkRepoCatalogTool } from '../benchmark-repos.js';
import { BenchmarkContextTool } from './benchmark-context.js';
import { HarnessComponentsTool } from './harness-components.js';
import { ListDirTool } from './list-dir.js';
import { StitchTool } from './stitch.js';
import { stitchConfigured } from '../stitch.js';
import { MEMORY_TOOLS } from './memory.js';
import { isMemoryEnabled } from '../mempalace/index.js';
import { SkillViewTool } from './skill.js';
import { ApplyPatchTool } from './apply-patch.js';
import { TodoWriteTool } from './todo.js';

// Stitch is only listed in the tool registry when configured — otherwise
// free models hallucinate calls to it and waste turns on auth errors.
const OPTIONAL_TOOLS: Tool[] = [];
if (stitchConfigured()) OPTIONAL_TOOLS.push(StitchTool);

// MemPalace memory tools — only registered when the user enabled the
// feature (default true). Disabling it during the setup wizard or via
// /memory disable removes them from the registry entirely so the model
// doesn't see them at all (no wasted tokens advertising tools it can't
// use, no risk of the model hallucinating memory calls).
const MEMORY_TOOLS_IF_ENABLED: Tool[] = isMemoryEnabled() ? MEMORY_TOOLS : [];

export const ALL_TOOLS: Tool[] = [
  BashTool,
  ReadTool,
  WriteTool,
  EditTool,
  // apply_patch — multi-file atomic edits (replaces chained edit/write
  // for refactors). Inspired by codex-cli's *** Begin Patch envelope.
  ApplyPatchTool,
  GrepTool,
  GlobTool,
  ListDirTool,
  WebFetchTool,
  WebSearchTool,
  ResearchSourcesTool,
  BenchmarkRepoCatalogTool,
  GitHubRepoDigestTool,
  BenchmarkContextTool,
  HarnessComponentsTool,
  TodoWriteTool,
  ...MEMORY_TOOLS_IF_ENABLED,
  // skill_view — Level-1 of the progressive-disclosure skill schema.
  // Always available; the system prompt only injects skill NAMES at
  // Level 0 and the model uses this tool to load full text on demand.
  SkillViewTool,
  ...OPTIONAL_TOOLS,
];

export function getToolNames(): string[] {
  return ALL_TOOLS.map((t) => t.name);
}

export function getToolByName(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export type { Tool, ToolResult } from './types.js';
