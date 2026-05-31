import { execSync } from 'node:child_process';
import type { GrawkusConfig } from '../types.js';
import type { TilwPickResult } from './types.js';
import { buildPromodeMemoryContext } from './memory-context.js';
import { getQualityPromptAddition } from './quality.js';
import { getTilwSummary } from './state.js';
import type { PromodeState } from './types.js';

export function buildPromodeSystemOverlay(config: GrawkusConfig, cwd: string): string {
  const quality = config.promode?.quality ?? 'standard';
  return `
# ProMode active (THE PRIORITY = TILW)

You are in **ProMode** — maximum depth, iteration, and proof until the user runs \`/promode stop\`.

TILW order (strict): **T** Tasks → **I** Ideas → **L** Likes / **W** Wants.

Work loop: Understand → Explore → Plan → Execute → Verify → Report.

Use MemPalace (\`memory_search\`, \`memory_add\`, \`diary_write\`) for durable I/L/W facts; do not store one-off task text in memory.

${getQualityPromptAddition(quality)}
`.trim();
}

export function getGitSnapshotShort(cwd: string): string {
  try {
    const out = execSync('git status --short', { cwd, encoding: 'utf-8', timeout: 5000 });
    const lines = out.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return '(clean working tree)';
    return lines.slice(0, 40).join('\n');
  } catch {
    return '(not a git repo or git unavailable)';
  }
}

export function buildPromodeCyclePrompt(opts: {
  pick: TilwPickResult;
  state: PromodeState;
  cwd: string;
  config: GrawkusConfig;
  sessionId?: string;
  includeGit?: boolean;
}): string {
  const { pick, state, cwd, config } = opts;
  const summary = getTilwSummary(state);
  const memoryQuery = `${pick.action} ${pick.focusCategory ?? ''} promode TILW`;
  const memoryEnabled = config.memory?.enabled !== false;
  const memoryBlock = buildPromodeMemoryContext({
    cwd,
    query: memoryQuery,
    memoryEnabled,
    retrievalLimit: config.promode?.retrievalLimit ?? 12,
  });

  let gitBlock = '';
  if (opts.includeGit) {
    gitBlock = `\n## Git snapshot\n\`\`\`\n${getGitSnapshotShort(cwd)}\n\`\`\`\n`;
  }

  const handlerHint = pick.priority === 'T' || pick.priority === 'I'
    ? 'Answer helpfully and thoroughly. Use tools for ground truth.'
    : `You are ProMode on **${pick.priority}** priority. Be specific with file paths and actionable steps. No vague suggestions.`;

  return `[ProMode+:${pick.priority}] ${pick.action}

## TILW context
- Priority: **${pick.priority}** — ${pick.reasoning}
- Iteration: ${state.iterationCount + 1}
- Queues: T ${summary.tasks.pending}p, I ${summary.ideas.pending}p, L ${summary.likes.pending}p, W ${summary.wants.pending}p
${pick.focusCategory ? `- Focus category: ${pick.focusCategory}` : ''}

${memoryBlock}
${gitBlock}

## Instructions
${handlerHint}

Follow the 6-step work loop. Do not ask mid-execution on large work — verify with tests/diffs.`;
}

export const TILW_SELECTOR_PROMPT = `TILW PRIORITY ORDER (highest to lowest):
  T — TASKS: explicit user requests or queued work. Always first.
  I — IDEAS: things the user was curious about. After tasks.
  L — LIKES: inferred delight (security lint, docs, tests, automations).
  W — WANTS: mutual benefit (integrations, workflow, codebase health).

When picking work, respect queue order; never skip T for L/W.`;
