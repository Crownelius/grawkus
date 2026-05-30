/**
 * harness_components: AHE-style component observability for this CLI harness.
 *
 * The goal is to expose editable harness surfaces as file-level components:
 * prompts, tools, middleware, skills, memory, config/providers, adapters, and
 * tests. It is intentionally read-only and bounded so an agent can orient
 * before changing the harness without flooding context.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { globSync } from 'glob';
import { resolveUserPath } from './path-utils.js';
import type { Tool, ToolResult } from './types.js';

type HarnessComponentId =
  | 'system_prompts'
  | 'tooling'
  | 'middleware'
  | 'skills'
  | 'subagents'
  | 'memory'
  | 'providers'
  | 'benchmark_adapters'
  | 'cli_ui'
  | 'verification';

interface ComponentSpec {
  id: HarnessComponentId;
  title: string;
  role: string;
  patterns: string[];
  tests: string[];
  docs?: string[];
  editContract: string;
}

interface ComponentSummary {
  spec: ComponentSpec;
  files: string[];
  fileCount: number;
  tests: string[];
  testCount: number;
  docs: string[];
  docCount: number;
}

interface HarnessComponentsJsonReport {
  version: 1;
  format: 'grawkus-harness-components-v1';
  source: 'harness_components';
  root: string;
  package: string | null;
  summary: {
    totalComponents: number;
    shownComponents: number;
    matchedEditableFiles: number;
    matchedTestFiles: number;
    matchedDocFiles: number;
    componentIds: HarnessComponentId[];
  };
  discipline: string[];
  redaction: {
    secretsIncluded: false;
    memoryContentsIncluded: false;
    oracleContentsIncluded: false;
  };
  components: Array<{
    id: HarnessComponentId;
    title: string;
    role: string;
    editContract: string;
    patterns: string[];
    testPatterns: string[];
    docPatterns: string[];
    files: string[];
    fileCount: number;
    tests: string[];
    testCount: number;
    docs: string[];
    docCount: number;
  }>;
}

type HarnessComponentsFormat = 'text' | 'json';

const IGNORE_GLOBS = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.next/**',
  '**/build/**',
  '**/.grawkus/**',
  'bench/runs/**',
  'bench/tb-repo/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
];

const COMPONENTS: ComponentSpec[] = [
  {
    id: 'system_prompts',
    title: 'System Prompts And Modes',
    role: 'Model-facing behavior policy, mode additions, rules, and command prompts.',
    patterns: [
      'src/system-prompt.ts',
      'src/modes.ts',
      'src/rules.ts',
      'src/search-first.ts',
      'resources/ecc/prompts/*.prompt.md',
      'resources/ecc/rules/**/*.md',
    ],
    tests: [
      'tests/smoke-commands.test.ts',
      'tests/benchmark-mode.test.ts',
      'tests/critique-prompts.test.ts',
      'tests/global-plan-block.test.ts',
    ],
    docs: ['README.md', 'COMMANDS.md'],
    editContract: 'Prediction: name the behavior the prompt/mode edit should improve and one user workflow it must not regress.',
  },
  {
    id: 'tooling',
    title: 'Tool Descriptions And Implementations',
    role: 'Agent action surface: file IO, shell, research, memory, todo, web, benchmark context, and generated UI tools.',
    patterns: ['src/tools/*.ts'],
    tests: ['tests/*tool*.test.ts', 'tests/research-sources.test.ts', 'tests/bash-tool.test.ts', 'tests/todo-tool.test.ts'],
    docs: ['README.md', 'COMMANDS.md'],
    editContract: 'Prediction: state the tool-call failure or missing affordance, expected output shape, and secret-redaction invariant.',
  },
  {
    id: 'middleware',
    title: 'Runtime Middleware And Turn Control',
    role: 'Streaming, query loops, queueing, permissions, compaction, retries, tracing, and execution policy.',
    patterns: [
      'src/query.ts',
      'src/index.ts',
      'src/live-queue.ts',
      'src/prompt-buffer.ts',
      'src/turn-context.ts',
      'src/retry.ts',
      'src/permissions.ts',
      'src/sandbox.ts',
      'src/execpolicy.ts',
      'src/compaction.ts',
      'src/strategic-compaction.ts',
      'src/tool-output-archive.ts',
      'src/benchmark-trace.ts',
      'src/autonomous-loops.ts',
    ],
    tests: [
      'tests/query-liveness.test.ts',
      'tests/prompt-buffer.test.ts',
      'tests/stream-loop.test.ts',
      'tests/context-cap.test.ts',
      'tests/benchmark-trace.test.ts',
    ],
    docs: ['README.md', 'COMMANDS.md'],
    editContract: 'Prediction: identify the liveness or control-flow failure, cancellation behavior, and final-state evidence to verify.',
  },
  {
    id: 'skills',
    title: 'Skills And Rules Corpus',
    role: 'Progressive-disclosure reusable instructions, rules, domain skills, and skill registry behavior.',
    patterns: [
      'src/ecc.ts',
      'src/skills.ts',
      'src/skill-create.ts',
      'resources/ecc/skills/*/SKILL.md',
      'resources/ecc/commands/*.md',
    ],
    tests: ['tests/skill-view.test.ts', 'tests/smoke-commands.test.ts'],
    docs: ['README.md', 'COMMANDS.md', 'SKILL_TEMPLATES.md'],
    editContract: 'Prediction: specify which task class should load the skill and the false-positive match it should avoid.',
  },
  {
    id: 'subagents',
    title: 'Subagents And Orchestration',
    role: 'Agent roles, swarm fan-out, multi-agent planning/execution, and autonomous review loops.',
    patterns: [
      'src/agents.ts',
      'src/swarm.ts',
      'src/orchestration.ts',
      'resources/ecc/agents/*.md',
    ],
    tests: ['tests/smoke-commands.test.ts'],
    docs: ['README.md', 'COMMANDS.md'],
    editContract: 'Prediction: describe attribution, merge, or delegation evidence the orchestration edit should create.',
  },
  {
    id: 'memory',
    title: 'Long-Term Memory',
    role: 'MemPalace stores, memory tools, recall injection, learned instincts, and project/global persistence.',
    patterns: [
      'src/mempalace/*.ts',
      'src/tools/memory.ts',
      'src/memory.ts',
      'src/learning.ts',
      'src/system-prompt.ts',
    ],
    tests: ['tests/mempalace.test.ts', 'tests/mask-tool-results.test.ts'],
    docs: ['README.md', 'COMMANDS.md'],
    editContract: 'Prediction: state what should be remembered, retrieval scope, and what private content must not be surfaced.',
  },
  {
    id: 'providers',
    title: 'Providers, Models, And Auth',
    role: 'Provider config, OpenAI-compatible API calls, OAuth, key rotation, routing, and cost accounting.',
    patterns: [
      'src/api.ts',
      'src/config.ts',
      'src/openai-oauth.ts',
      'src/openai-smoke.ts',
      'src/key-rotation.ts',
      'src/model-router.ts',
      'src/openrouter-models.ts',
      'src/cost-tracker.ts',
      'bin/grawkus.js',
      'bin/grawkus.js',
    ],
    tests: [
      'tests/api-responses.test.ts',
      'tests/openai-oauth.test.ts',
      'tests/openrouter-free.test.ts',
      'tests/key-rotation.test.ts',
      'tests/env-config.test.ts',
    ],
    docs: ['README.md', 'COMMANDS.md', 'INSTALL.md'],
    editContract: 'Prediction: name the auth/request/stream path being changed and verify without printing credentials.',
  },
  {
    id: 'benchmark_adapters',
    title: 'Benchmark Adapters And Evidence Artifacts',
    role: 'Terminal-Bench, KBench, HAL, Exgentic, Open Agent cards, and trajectory evidence export.',
    patterns: [
      'bench/**/*',
      'resources/terminal_bench/**/*',
      'resources/kbench/**/*',
      'resources/hal/**/*',
      'resources/exgentic/**/*',
      'resources/open_agent_leaderboard/**/*',
      'src/benchmark-trace.ts',
      'src/tools/benchmark-context.ts',
    ],
    tests: [
      'tests/terminal-bench-adapter.test.ts',
      'tests/kbench-adapter.test.ts',
      'tests/hal-adapter.test.ts',
      'tests/exgentic-adapter.test.ts',
      'tests/benchmark-context-tool.test.ts',
      'tests/benchmark-trace.test.ts',
    ],
    docs: ['README.md', 'COMMANDS.md', 'bench/README.md', 'bench/REDESIGN-v2.md'],
    editContract: 'Prediction: define the benchmark-visible metric, artifact field, or verifier evidence the edit should improve.',
  },
  {
    id: 'cli_ui',
    title: 'CLI UX, Slash Commands, And Accessibility',
    role: 'REPL rendering, slash palette, themes, logo/banner, setup wizard, voice, and screen-reader support.',
    patterns: [
      'src/index.ts',
      'src/command-palette.ts',
      'src/theme.ts',
      'src/animations.ts',
      'src/status.ts',
      'src/walkthrough.ts',
      'src/voice.ts',
      'src/audio.ts',
      'src/accessibility.ts',
      'tests/e2e/**/*',
    ],
    tests: [
      'tests/smoke-commands.test.ts',
      'tests/theme.test.ts',
      'tests/e2e/**/*.test.ts',
    ],
    docs: ['README.md', 'COMMANDS.md'],
    editContract: 'Prediction: name the user-visible interaction, keyboard path, and scroll/input state that must remain stable.',
  },
  {
    id: 'verification',
    title: 'Verification, Packaging, And Release Gates',
    role: 'Build/test/package checks, doctor diagnostics, install docs, security scan, and release metadata.',
    patterns: [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'src/doctor.ts',
      'src/security.ts',
      'tests/**/*.test.ts',
      'docs/**/*',
    ],
    tests: ['tests/doctor.test.ts', 'tests/smoke-commands.test.ts', 'tests/security*.test.ts'],
    docs: ['README.md', 'COMMANDS.md', 'INSTALL.md', 'THIRD_PARTY_NOTICES.md'],
    editContract: 'Prediction: list the focused gate and broad gate that should prove the release-impacting edit.',
  },
];

export const HarnessComponentsTool: Tool = {
  name: 'harness_components',
  description:
    'Read-only AHE-style harness inventory. Maps prompts, tools, middleware, skills, memory, providers, benchmark adapters, CLI UX, and verification surfaces to editable files, tests, docs, and prediction contracts before self-improvement work.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory to inspect. Defaults to the current working directory.',
      },
      component: {
        type: 'string',
        enum: ['all', ...COMPONENTS.map((c) => c.id)],
        description: 'Optional component filter. Default all.',
      },
      max_files_per_component: {
        type: 'number',
        description: 'Maximum matching files to list per files/tests/docs block. Default 10, max 40.',
      },
      format: {
        type: 'string',
        enum: ['text', 'json'],
        description: 'Output format. Default text. Use json for machine-readable component observability.',
      },
      json: {
        type: 'boolean',
        description: 'Shortcut for format=json.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    return buildHarnessComponentsReport(input, cwd);
  },
};

export function buildHarnessComponentsReport(input: Record<string, unknown>, cwd: string): ToolResult {
  try {
    const root = input.path ? resolveUserPath(cwd, String(input.path)) : cwd;
    if (!existsSync(root)) {
      return { output: `harness_components: path does not exist: ${root}`, isError: true };
    }
    if (!statSync(root).isDirectory()) {
      return { output: `harness_components: path is not a directory: ${root}`, isError: true };
    }

    const component = String(input.component || 'all') as HarnessComponentId | 'all';
    const allowed = new Set<string>(['all', ...COMPONENTS.map((c) => c.id)]);
    if (!allowed.has(component)) {
      return { output: `harness_components: unsupported component "${component}"`, isError: true };
    }

    const format = normalizeFormat(input);
    if (!format) {
      return { output: 'harness_components: unsupported format (use "text" or "json")', isError: true };
    }

    const maxFiles = clampNumber(input.max_files_per_component, 10, 3, 40);
    const selected = component === 'all'
      ? COMPONENTS
      : COMPONENTS.filter((spec) => spec.id === component);
    const summaries = selected.map((spec) => summarizeComponent(root, spec, maxFiles));
    const pkg = readPackageIdentity(root);
    const matchedFiles = summaries.reduce((sum, s) => sum + s.fileCount, 0);
    const matchedTests = summaries.reduce((sum, s) => sum + s.testCount, 0);
    const matchedDocs = summaries.reduce((sum, s) => sum + s.docCount, 0);

    const data = buildJsonReport(root, pkg, summaries, matchedFiles, matchedTests, matchedDocs);
    if (format === 'json') {
      return { output: JSON.stringify(data, null, 2), isError: false };
    }

    const lines: string[] = [
      '# Harness Components',
      `Root: ${root}`,
      `Package: ${pkg ?? '(no package.json identity found)'}`,
      '',
      '## Component Digest',
      `- components: ${summaries.length} shown of ${COMPONENTS.length}`,
      `- matched editable files: ${matchedFiles}`,
      `- matched test files: ${matchedTests}`,
      `- matched doc files: ${matchedDocs}`,
      '- basis: AHE-style component observability; use this before harness edits, self-improvement, or debugging tool/UX behavior.',
      '',
      '## Edit Discipline',
      '- Read current files before editing; do not rely on this inventory as source content.',
      '- Attach a short `Prediction:` to non-trivial harness edits, then verify with the focused tests listed under the touched component.',
      '- Keep provider tokens, OAuth material, MemPalace contents, and benchmark oracle/answer files out of reports and commits.',
      '- Prefer file-local component changes over broad prompt-only edits when the failure is in tools, middleware, memory, or UX.',
      '',
    ];

    for (const summary of summaries) {
      lines.push(formatComponent(summary), '');
    }

    return { output: lines.join('\n').trim(), isError: false };
  } catch (e) {
    return { output: `harness_components: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}

function buildJsonReport(
  root: string,
  pkg: string | null,
  summaries: ComponentSummary[],
  matchedFiles: number,
  matchedTests: number,
  matchedDocs: number,
): HarnessComponentsJsonReport {
  return {
    version: 1,
    format: 'grawkus-harness-components-v1',
    source: 'harness_components',
    root,
    package: pkg,
    summary: {
      totalComponents: COMPONENTS.length,
      shownComponents: summaries.length,
      matchedEditableFiles: matchedFiles,
      matchedTestFiles: matchedTests,
      matchedDocFiles: matchedDocs,
      componentIds: summaries.map((summary) => summary.spec.id),
    },
    discipline: [
      'Read current files before editing; do not rely on this inventory as source content.',
      'Attach a short Prediction: line to non-trivial harness edits, then verify with focused tests for the touched component.',
      'Keep provider tokens, OAuth material, MemPalace contents, and benchmark oracle/answer files out of reports and commits.',
      'Prefer file-local component changes over broad prompt-only edits when the failure is in tools, middleware, memory, or UX.',
    ],
    redaction: {
      secretsIncluded: false,
      memoryContentsIncluded: false,
      oracleContentsIncluded: false,
    },
    components: summaries.map((summary) => ({
      id: summary.spec.id,
      title: summary.spec.title,
      role: summary.spec.role,
      editContract: summary.spec.editContract,
      patterns: summary.spec.patterns,
      testPatterns: summary.spec.tests,
      docPatterns: summary.spec.docs ?? [],
      files: summary.files,
      fileCount: summary.fileCount,
      tests: summary.tests,
      testCount: summary.testCount,
      docs: summary.docs,
      docCount: summary.docCount,
    })),
  };
}

function summarizeComponent(root: string, spec: ComponentSpec, maxFiles: number): ComponentSummary {
  const fileMatches = matchExisting(root, spec.patterns);
  const testMatches = matchExisting(root, spec.tests);
  const docMatches = matchExisting(root, spec.docs ?? []);
  return {
    spec,
    files: fileMatches.slice(0, maxFiles),
    fileCount: fileMatches.length,
    tests: testMatches.slice(0, maxFiles),
    testCount: testMatches.length,
    docs: docMatches.slice(0, maxFiles),
    docCount: docMatches.length,
  };
}

function matchExisting(root: string, patterns: string[]): string[] {
  const matches = new Set<string>();
  for (const pattern of patterns) {
    const normalized = normalizePath(pattern);
    if (!hasGlobMagic(normalized)) {
      const absolute = resolve(root, normalized);
      if (existsSync(absolute) && statSync(absolute).isFile()) matches.add(normalized);
      continue;
    }
    for (const hit of globSync(normalized, {
      cwd: root,
      nodir: true,
      dot: true,
      ignore: IGNORE_GLOBS,
    })) {
      matches.add(normalizePath(hit));
    }
  }
  return Array.from(matches).sort((a, b) => a.localeCompare(b));
}

function formatComponent(summary: ComponentSummary): string {
  const { spec } = summary;
  const lines = [
    `## ${spec.title} (${spec.id})`,
    `Role: ${spec.role}`,
    `Edit contract: ${spec.editContract}`,
    `Editable surfaces (${summary.fileCount}):`,
    formatBoundedList(summary.files, summary.fileCount),
    `Tests (${summary.testCount}):`,
    formatBoundedList(summary.tests, summary.testCount),
    `Docs (${summary.docCount}):`,
    formatBoundedList(summary.docs, summary.docCount),
  ];
  return lines.join('\n');
}

function formatBoundedList(items: string[], total: number): string {
  if (total === 0) return '- (none matched in this workspace)';
  const lines = items.map((item) => `- ${item}`);
  if (total > items.length) lines.push(`- ... ${total - items.length} more`);
  return lines.join('\n');
}

function readPackageIdentity(root: string): string | null {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { name?: unknown; version?: unknown };
    const name = typeof parsed.name === 'string' ? parsed.name : undefined;
    const version = typeof parsed.version === 'string' ? parsed.version : undefined;
    if (!name && !version) return null;
    return `${name ?? '(unnamed)'}${version ? `@${version}` : ''}`;
  } catch {
    return null;
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function hasGlobMagic(pattern: string): boolean {
  return /[*?\[\]{}()!+@]/.test(pattern);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeFormat(input: Record<string, unknown>): HarnessComponentsFormat | null {
  if (input.json === true) return 'json';
  if (input.format === undefined || input.format === null || input.format === '') return 'text';
  const value = String(input.format).toLowerCase();
  if (value === 'text' || value === 'json') return value;
  return null;
}

export const _internal = {
  COMPONENTS,
  buildHarnessComponentsReport,
  buildJsonReport,
  matchExisting,
  normalizeFormat,
};
