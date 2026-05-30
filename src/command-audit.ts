import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMAND_CATALOG, allSlashCommandNames } from './command-palette.js';

export type CommandAuditStatus = 'pass' | 'warn' | 'fail';

export interface CommandAuditIssue {
  code: string;
  severity: CommandAuditStatus;
  message: string;
  command?: string;
}

export interface CommandAuditReport {
  format: 'grawkus-command-audit-v1';
  version: 1;
  status: CommandAuditStatus;
  generatedAt: string;
  packageRoot: string;
  summary: {
    catalogCommands: number;
    aliases: number;
    completionNames: number;
    handledCases: number | null;
    smokeEntries: number | null;
    smokeExemptions: number;
    issues: number;
    failures: number;
    warnings: number;
  };
  checks: Array<{
    id: string;
    status: CommandAuditStatus;
    detail: string;
  }>;
  issues: CommandAuditIssue[];
  nextActions: string[];
}

export interface CommandAuditOptions {
  json: boolean;
  strict: boolean;
}

const ALIAS_ONLY_COMMANDS = new Set([
  '/a11y',
  '/bench',
  '/bench-repos',
  '/branch',
  '/codemaps',
  '/edit-prompt',
  '/github-digest',
  '/guide',
  '/hermes',
  '/harness-components',
  '/hooks-reset',
  '/leaderboard',
  '/leaderboard-repos',
  '/quit',
  '/refactor-clean',
  '/repo-inspect',
  '/research-sources',
  '/rewind',
  '/source-scan',
  '/stitch-status',
  '/tb-repos',
  '/tour',
]);

const SPECIALIST_SHORTCUT_COMMANDS = new Set([
  '/cpp-build-fix',
  '/cpp-review',
  '/db-review',
  '/go-build-fix',
  '/go-review',
  '/java-build-fix',
  '/java-review',
  '/kotlin-review',
  '/php-review',
  '/py-review',
  '/pytorch-fix',
  '/rust-build-fix',
  '/rust-review',
  '/ts-build-fix',
  '/ts-review',
]);

const SMOKE_EXEMPT_COMMANDS = new Map<string, string>([
  ['/commit', 'git-state dependent: only LLM-driven when the worktree has commit-worthy changes'],
  ['/pr', 'git-state dependent: only LLM-driven when pull-request context exists'],
  ['/editor', 'launches an external editor by design'],
  ['/update-codemaps', 'writes the codemap cache for the current repository'],
  ['/instinct-export', 'writes a timestamped export file in the current directory'],
  ['/dictate', 'opens the microphone recording flow'],
]);

function modulePackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const direct = join(here, '..', 'package.json');
  if (existsSync(direct)) return dirname(direct);
  return dirname(here);
}

function firstExisting(paths: string[]): string | null {
  for (const candidate of paths) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readOptional(path: string | null): string | null {
  if (!path) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function extractHandledCommands(source: string | null): string[] | null {
  if (!source) return null;
  const matches = source.matchAll(/case ['"](\/[^'"]+)['"]\s*:/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1]))).sort();
}

function extractSmokeCommands(source: string | null): string[] | null {
  if (!source) return null;
  const matches = source.matchAll(/\[\s*['"](\/[^'"]+)['"]\s*,\s*['"](local|llm|local-error)['"]\s*\]/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1].split(/\s+/, 1)[0]))).sort();
}

function pushIssue(issues: CommandAuditIssue[], issue: CommandAuditIssue): void {
  issues.push(issue);
}

function statusFromIssues(issues: CommandAuditIssue[], strict: boolean): CommandAuditStatus {
  if (issues.some((issue) => issue.severity === 'fail')) return 'fail';
  if (strict && issues.length > 0) return 'fail';
  if (issues.length > 0) return 'warn';
  return 'pass';
}

function checkStatus(issues: CommandAuditIssue[], codes: string[], strict: boolean): CommandAuditStatus {
  const scoped = issues.filter((issue) => codes.includes(issue.code));
  return statusFromIssues(scoped, strict);
}

export function parseCommandAuditArgs(args: string): CommandAuditOptions {
  const parts = args.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  return {
    json: parts.some((part, index) =>
      part === '--json'
      || part === 'json'
      || part === 'format=json'
      || part === '--format=json'
      || (part === '--format' && parts[index + 1] === 'json')),
    strict: parts.includes('--strict'),
  };
}

export function buildCommandAuditReport(options: Partial<CommandAuditOptions> = {}, now = new Date()): CommandAuditReport {
  const strict = options.strict ?? false;
  const packageRoot = modulePackageRoot();
  const indexSource = readOptional(firstExisting([
    join(packageRoot, 'src', 'index.ts'),
    join(packageRoot, 'dist', 'index.js'),
  ]));
  const smokeSource = readOptional(firstExisting([
    join(packageRoot, 'tests', 'smoke-commands.test.ts'),
  ]));
  const handled = extractHandledCommands(indexSource);
  const smoke = extractSmokeCommands(smokeSource);
  const issues: CommandAuditIssue[] = [];

  const commandSet = new Set<string>();
  const aliasSet = new Set<string>();
  for (const entry of COMMAND_CATALOG) {
    if (commandSet.has(entry.command)) {
      pushIssue(issues, {
        code: 'duplicate-catalog-command',
        severity: 'fail',
        command: entry.command,
        message: `Duplicate catalog command ${entry.command}.`,
      });
    }
    commandSet.add(entry.command);

    if (!/^\/[a-z0-9-]+$/.test(entry.command)) {
      pushIssue(issues, {
        code: 'invalid-command-format',
        severity: 'fail',
        command: entry.command,
        message: `Command ${entry.command} must match /^\\/[a-z0-9-]+$/.`,
      });
    }
    if (entry.description.trim().length < 10) {
      pushIssue(issues, {
        code: 'weak-description',
        severity: 'warn',
        command: entry.command,
        message: `Command ${entry.command} has a weak selector description.`,
      });
    }
    if (!entry.category.trim()) {
      pushIssue(issues, {
        code: 'missing-category',
        severity: 'fail',
        command: entry.command,
        message: `Command ${entry.command} has no category.`,
      });
    }

    for (const alias of entry.aliases ?? []) {
      if (aliasSet.has(alias) || commandSet.has(alias)) {
        pushIssue(issues, {
          code: 'duplicate-alias',
          severity: 'fail',
          command: alias,
          message: `Alias ${alias} collides with another command or alias.`,
        });
      }
      aliasSet.add(alias);
      if (!/^\/[a-z0-9-]+$/.test(alias)) {
        pushIssue(issues, {
          code: 'invalid-alias-format',
          severity: 'fail',
          command: alias,
          message: `Alias ${alias} must match /^\\/[a-z0-9-]+$/.`,
        });
      }
    }
  }

  if (handled) {
    const handledSet = new Set(handled);
    for (const entry of COMMAND_CATALOG) {
      if (!handledSet.has(entry.command)) {
        pushIssue(issues, {
          code: 'catalog-command-without-handler',
          severity: 'fail',
          command: entry.command,
          message: `${entry.command} is visible in the selector but has no slash handler case.`,
        });
      }
    }

    for (const command of handled) {
      if (
        !commandSet.has(command)
        && !ALIAS_ONLY_COMMANDS.has(command)
        && !SPECIALIST_SHORTCUT_COMMANDS.has(command)
      ) {
        pushIssue(issues, {
          code: 'handler-command-hidden-from-selector',
          severity: 'fail',
          command,
          message: `${command} has a handler case but is not visible in the slash selector.`,
        });
      }
    }
  } else {
    pushIssue(issues, {
      code: 'handler-source-unavailable',
      severity: 'warn',
      message: 'Could not inspect the installed handler source; catalog-only audit completed.',
    });
  }

  if (smoke) {
    const smokeSet = new Set(smoke);
    for (const entry of COMMAND_CATALOG) {
      if (!smokeSet.has(entry.command) && !SMOKE_EXEMPT_COMMANDS.has(entry.command)) {
        pushIssue(issues, {
          code: 'catalog-command-missing-smoke',
          severity: 'warn',
          command: entry.command,
          message: `${entry.command} is not represented in smoke-command coverage.`,
        });
      }
    }
  } else {
    pushIssue(issues, {
      code: 'smoke-source-unavailable',
      severity: 'warn',
      message: 'Smoke-test source is unavailable in this install; runtime audit cannot prove per-command smoke coverage.',
    });
  }

  const completionNames = allSlashCommandNames();
  if (new Set(completionNames).size !== completionNames.length) {
    pushIssue(issues, {
      code: 'duplicate-completion-name',
      severity: 'fail',
      message: 'Completion names contain duplicates.',
    });
  }

  const failures = issues.filter((issue) => issue.severity === 'fail').length;
  const warnings = issues.filter((issue) => issue.severity === 'warn').length;
  const status = statusFromIssues(issues, strict);
  const checks = [
    {
      id: 'catalog-metadata',
      status: checkStatus(issues, ['duplicate-catalog-command', 'invalid-command-format', 'weak-description', 'missing-category', 'duplicate-alias', 'invalid-alias-format', 'duplicate-completion-name'], strict),
      detail: `${COMMAND_CATALOG.length} catalog commands, ${aliasSet.size} aliases, ${completionNames.length} completion names.`,
    },
    {
      id: 'handler-coverage',
      status: checkStatus(issues, ['catalog-command-without-handler', 'handler-command-hidden-from-selector', 'handler-source-unavailable'], strict),
      detail: handled ? `${handled.length} handler cases inspected.` : 'Handler source unavailable; catalog-only audit.',
    },
    {
      id: 'smoke-coverage',
      status: checkStatus(issues, ['catalog-command-missing-smoke', 'smoke-source-unavailable'], strict),
      detail: smoke ? `${smoke.length} smoke-command entries inspected; ${SMOKE_EXEMPT_COMMANDS.size} commands intentionally exempted.` : 'Smoke source unavailable in this install.',
    },
  ];

  const nextActions = issues.length === 0
    ? ['No command-surface action required.']
    : [
        'Run npm test before publishing command-surface changes.',
        'Add missing selector entries to src/command-palette.ts or mark aliases intentionally hidden.',
        'Add missing smoke coverage to tests/smoke-commands.test.ts for user-visible commands.',
      ];

  return {
    format: 'grawkus-command-audit-v1',
    version: 1,
    status,
    generatedAt: now.toISOString(),
    packageRoot,
    summary: {
      catalogCommands: COMMAND_CATALOG.length,
      aliases: aliasSet.size,
      completionNames: completionNames.length,
      handledCases: handled?.length ?? null,
      smokeEntries: smoke?.length ?? null,
      smokeExemptions: SMOKE_EXEMPT_COMMANDS.size,
      issues: issues.length,
      failures,
      warnings,
    },
    checks,
    issues,
    nextActions,
  };
}

export function formatCommandAuditReport(report: CommandAuditReport, options: Partial<CommandAuditOptions> = {}): string {
  if (options.json) return JSON.stringify(report, null, 2);

  const lines: string[] = [
    '',
    '  Grawkus Command Audit',
    '',
    `  Status: ${report.status.toUpperCase()} (${report.summary.failures} failures, ${report.summary.warnings} warnings)`,
    `  Catalog: ${report.summary.catalogCommands} commands, ${report.summary.aliases} aliases, ${report.summary.completionNames} completion names`,
    `  Handler cases: ${report.summary.handledCases ?? 'unavailable'}`,
    `  Smoke entries: ${report.summary.smokeEntries ?? 'unavailable'} (${report.summary.smokeExemptions} intentional exemptions)`,
    '',
  ];

  for (const check of report.checks) {
    lines.push(`  ${check.status.toUpperCase()} ${check.id}: ${check.detail}`);
  }

  if (report.issues.length > 0) {
    lines.push('', '  Issues:');
    for (const issue of report.issues.slice(0, 20)) {
      const target = issue.command ? ` ${issue.command}` : '';
      lines.push(`  - ${issue.severity.toUpperCase()} ${issue.code}${target}: ${issue.message}`);
    }
    if (report.issues.length > 20) {
      lines.push(`  - ... ${report.issues.length - 20} more issue${report.issues.length - 20 === 1 ? '' : 's'}; rerun with --json.`);
    }
  }

  lines.push('', '  Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  return lines.join('\n');
}
