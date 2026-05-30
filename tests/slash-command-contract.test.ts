import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COMMAND_CATALOG, allSlashCommandNames, resolveCommandEntry, suggestCommandEntries } from '../src/command-palette.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

function handledSlashCommands(): string[] {
  const source = readFileSync(join(repoRoot, 'src', 'index.ts'), 'utf-8');
  const matches = source.matchAll(/case ['"](\/[^'"]+)['"]\s*:/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1]))).sort();
}

const aliasOnlyCommands = new Set([
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

const specialistShortcutCommands = new Set([
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

describe('slash command contract', () => {
  it('keeps every selector command backed by a handler case', () => {
    const handled = new Set(handledSlashCommands());
    const dead = COMMAND_CATALOG
      .map((entry) => entry.command)
      .filter((command) => !handled.has(command));

    expect(dead).toEqual([]);
  });

  it('keeps every public handler command visible in the slash selector', () => {
    const catalog = new Set(COMMAND_CATALOG.map((entry) => entry.command));
    const missing = handledSlashCommands().filter((command) => (
      !catalog.has(command) &&
      !aliasOnlyCommands.has(command) &&
      !specialistShortcutCommands.has(command)
    ));

    expect(missing).toEqual([]);
  });

  it('keeps selector metadata unique and readable', () => {
    const commands = COMMAND_CATALOG.map((entry) => entry.command);
    expect(new Set(commands).size).toBe(commands.length);

    for (const entry of COMMAND_CATALOG) {
      expect(entry.command).toMatch(/^\/[a-z0-9-]+$/);
      expect(entry.category.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(10);
    }
  });

  it('resolves aliases to their canonical command help entry', () => {
    expect(resolveCommandEntry('/bench')).toMatchObject({
      alias: '/bench',
      entry: { command: '/benchmark' },
    });
    expect(resolveCommandEntry('leaderboard-repos')).toMatchObject({
      alias: '/leaderboard-repos',
      entry: { command: '/benchmark-repos' },
    });
    expect(resolveCommandEntry('/hermes')).toMatchObject({
      alias: '/hermes',
      entry: { command: '/sentience' },
    });
    expect(resolveCommandEntry('/permissions')).toMatchObject({
      alias: '/permissions',
      entry: { command: '/perm' },
    });
  });

  it('includes aliases in completion names without duplicating entries', () => {
    const names = allSlashCommandNames();

    expect(names).toContain('/benchmark');
    expect(names).toContain('/bench');
    expect(names).toContain('/tb-repos');
    expect(names).toContain('/permissions');
    expect(names).toContain('/hermes');
    expect(new Set(names).size).toBe(names.length);
  });

  it('suggests nearby command entries for partial or unknown help queries', () => {
    expect(suggestCommandEntries('/bench').map((entry) => entry.command)).toContain('/benchmark');
    expect(suggestCommandEntries('/tb').map((entry) => entry.command)).toContain('/benchmark-repos');
    expect(suggestCommandEntries('memory').map((entry) => entry.command)).toContain('/memory');
  });

  it('handles local sentinel commands before the generic runQuery path', () => {
    const source = readFileSync(join(repoRoot, 'src', 'index.ts'), 'utf-8');
    const runQueryIdx = source.indexOf("messages.push({ role: 'user', content: result.injectPrompt });");
    for (const sentinel of ['__RESUME_PICK__', '__PICK_MODEL__', '__SWARM__', '__SOURCES__', '__REPO_DIGEST__']) {
      const idx = source.indexOf(sentinel);
      expect(idx).toBeGreaterThan(0);
      expect(idx).toBeLessThan(runQueryIdx);
    }
  });
});
