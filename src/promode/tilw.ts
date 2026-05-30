/**
 * TILW priority picker — Tasks → Ideas → Likes/Wants (THE PRIORITY).
 * Deterministic queue drain; synthetic L/W work when queues are empty.
 */

import type { PromodeState, TilwPickResult, TilwPriority, TilwQueueItem } from './types.js';
import { markQueueItemInProgress } from './state.js';

export const FOCUS_CATEGORIES = [
  'security_review',
  'test_coverage_gaps',
  'documentation_gaps',
  'stub_placeholder_hunt',
  'dependency_health',
  'error_handling_review',
  'performance_hotspots',
  'api_contract_consistency',
  'accessibility_and_ux',
  'git_hygiene',
  'anticipate_user_needs',
  'bug_pattern_scan',
  'config_and_secrets_hygiene',
  'logging_and_observability',
  'dead_code_and_imports',
  'personal_goals_and_habits',
  'learning_paths_and_study_plans',
  'communication_and_stakeholder_updates',
  'travel_and_calendar_risk',
  'health_and_energy_rhythms',
  'home_and_finance_hygiene',
] as const;

export type FocusCategory = (typeof FOCUS_CATEGORIES)[number];

const FOCUS_ACTION_TEMPLATES: Record<FocusCategory, { L: string; W: string }> = {
  security_review: {
    L: 'Run a focused security pass: injection, eval, secrets in repo, SSRF, and auth gaps. List file paths and concrete fixes.',
    W: 'Add or tighten security linting in CI and document threat model notes in README or SECURITY.md.',
  },
  test_coverage_gaps: {
    L: 'Identify untested modules and add concrete test cases with real assertions (no placeholder tests).',
    W: 'Wire a fast test script in package.json and document how to run tests in CONTRIBUTING.',
  },
  documentation_gaps: {
    L: 'Update public API/CLI docs and examples for code that changed recently.',
    W: 'Add a short architecture section to README linking key src/ entry points.',
  },
  stub_placeholder_hunt: {
    L: 'Find TODO/FIXME/NotImplementedError/pass-only stubs and implement or remove them.',
    W: 'Add a grep-based CI check or script to flag new placeholders.',
  },
  dependency_health: {
    L: 'Audit package.json/lockfile for outdated deps and known CVE advisories; propose safe upgrades.',
    W: 'Pin critical deps and document upgrade policy in docs.',
  },
  error_handling_review: {
    L: 'Find bare excepts, swallowed errors, and missing error paths; fix with actionable messages.',
    W: 'Standardize error logging pattern across the main request/tool loop.',
  },
  performance_hotspots: {
    L: 'Profile obvious hotspots: sync I/O in loops, unbounded reads, redundant file scans.',
    W: 'Add caching or batching where repeated work appears in hot paths.',
  },
  api_contract_consistency: {
    L: 'Align REST/CLI/config key naming and response shapes across related modules.',
    W: 'Add contract tests or snapshot tests for public CLI flags.',
  },
  accessibility_and_ux: {
    L: 'Review terminal UX: footer, screen-reader paths, keyboard hints; fix a11y gaps.',
    W: 'Document accessibility toggles in COMMANDS.md with examples.',
  },
  git_hygiene: {
    L: 'Review branch state, stale files, and commit message quality; suggest cleanup commands.',
    W: 'Add git hygiene notes to contributor docs.',
  },
  anticipate_user_needs: {
    L: 'From MemPalace/diary context, prepare one improvement the user likely wants next.',
    W: 'Capture inferred preference in MemPalace (wing promode) if durable.',
  },
  bug_pattern_scan: {
    L: 'Scan for off-by-one, null deref patterns, race hints in async code.',
    W: 'Add regression test for the highest-risk pattern found.',
  },
  config_and_secrets_hygiene: {
    L: 'Ensure .env examples, config layering, and no committed secrets.',
    W: 'Document config precedence (global vs project) in INSTALL.md.',
  },
  logging_and_observability: {
    L: 'Improve structured debug logging for one high-traffic path.',
    W: 'Document GRAWKUS_DEBUG levels and where logs land.',
  },
  dead_code_and_imports: {
    L: 'Remove unused exports/imports and duplicate helpers found via grep.',
    W: 'Run typecheck/tests after cleanup and fix any breakage.',
  },
  personal_goals_and_habits: {
    L: 'Review diary/memory for stated goals; advance one small step.',
    W: 'Queue a follow-up /task for the user if a goal needs confirmation.',
  },
  learning_paths_and_study_plans: {
    L: 'Draft a short study plan with resources for a skill the user cared about.',
    W: 'Link learning resources in docs or a promode diary entry.',
  },
  communication_and_stakeholder_updates: {
    L: 'Write a concise status summary of recent ProMode work with evidence links.',
    W: 'Prepare changelog bullets for the next release.',
  },
  travel_and_calendar_risk: {
    L: 'Check memory for calendar/travel notes; surface risks or prep tasks.',
    W: 'Add reminder-style /task items for time-sensitive items.',
  },
  health_and_energy_rhythms: {
    L: 'Respect time-of-day: prefer lighter review tasks during low-energy hours if noted in memory.',
    W: 'Log energy-friendly task sizing guidance in diary.',
  },
  home_and_finance_hygiene: {
    L: 'From memory, list any personal admin items worth a gentle nudge (no secrets).',
    W: 'Suggest organizing durable personal facts in global MemPalace only if user opted in.',
  },
};

function firstPending(items: TilwQueueItem[]): TilwQueueItem | undefined {
  return items.find((i) => i.status === 'pending');
}

function effectiveFocusIndex(state: PromodeState, focusRotate: number): number {
  if (focusRotate <= 0) return state.focusIndex;
  const layer = Math.floor(state.iterationCount / focusRotate);
  return (state.focusIndex + layer) % FOCUS_CATEGORIES.length;
}

export function pickNextTilwAction(
  state: PromodeState,
  cwd: string,
  opts: { focusRotate?: number; preferWant?: boolean } = {},
): TilwPickResult {
  const focusRotate = opts.focusRotate ?? 24;

  const task = firstPending(state.tasks);
  if (task) {
    markQueueItemInProgress(state, 'T', task);
    return {
      priority: 'T',
      action: task.text,
      reasoning: 'Explicit task queue has pending work (highest TILW priority).',
      queueItem: task,
    };
  }

  const idea = firstPending(state.ideas);
  if (idea) {
    markQueueItemInProgress(state, 'I', idea);
    return {
      priority: 'I',
      action: idea.text,
      reasoning: 'Ideas queue has pending curiosity items after tasks.',
      queueItem: idea,
    };
  }

  const like = firstPending(state.likes);
  const want = firstPending(state.wants);
  if (like) {
    markQueueItemInProgress(state, 'L', like);
    return {
      priority: 'L',
      action: like.text,
      reasoning: 'User-queued like: inferred delight work.',
      queueItem: like,
    };
  }
  if (want) {
    markQueueItemInProgress(state, 'W', want);
    return {
      priority: 'W',
      action: want.text,
      reasoning: 'User-queued want: mutual benefit work.',
      queueItem: want,
    };
  }

  const idx = effectiveFocusIndex(state, focusRotate);
  const category = FOCUS_CATEGORIES[idx];
  const templates = FOCUS_ACTION_TEMPLATES[category];
  const useWant = opts.preferWant ?? (state.iterationCount % 2 === 1);
  const priority: TilwPriority = useWant ? 'W' : 'L';
  const action = useWant ? templates.W : templates.L;
  state.currentPriority = priority;
  state.lastAction = action;
  state.focusIndex = idx;

  return {
    priority,
    action: `[${category}] ${action} (workspace: ${cwd})`,
    reasoning: `T/I/L/W queues empty — rotating focus category ${category} for proactive ${priority} work.`,
    focusCategory: category,
  };
}

export function advanceAfterCycle(state: PromodeState, pick: TilwPickResult): void {
  state.iterationCount += 1;
  if (pick.queueItem && pick.queueItem.status === 'in_progress') {
    pick.queueItem.status = 'done';
    pick.queueItem.completedAt = new Date().toISOString();
    if (pick.priority === 'T') {
      state.completedTasks.push(pick.queueItem);
      state.tasks = state.tasks.filter((t) => t !== pick.queueItem);
    } else if (pick.priority === 'I') {
      state.ideas = state.ideas.filter((i) => i !== pick.queueItem);
    } else if (pick.priority === 'L') {
      state.likes = state.likes.filter((i) => i !== pick.queueItem);
    } else if (pick.priority === 'W') {
      state.wants = state.wants.filter((i) => i !== pick.queueItem);
    }
  }
}
