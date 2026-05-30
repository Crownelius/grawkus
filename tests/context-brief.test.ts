import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildContextBrief, buildContextDossier } from '../src/context-brief.js';

describe('context brief', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grawkus-context-brief-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      scripts: {
        test: 'vitest run',
        build: 'tsc',
      },
    }, null, 2));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'index.ts'), 'export const answer = 42;\n');
    writeFileSync(join(root, 'README.md'), '# Fixture\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('summarizes manifests, scripts, language footprint, and likely verifiers', () => {
    const output = buildContextBrief(root);

    expect(output).toContain('# Context Brief');
    expect(output).toContain('package.json');
    expect(output).toContain('test: vitest run');
    expect(output).toContain('.ts: 1');
    expect(output).toContain('npm run test');
    expect(output).toContain('npm run build');
  });

  it('builds a task-aware candidate file dossier', () => {
    writeFileSync(join(root, 'src', 'query.ts'), 'export function runQuery() {}\n');
    writeFileSync(join(root, 'src', 'fixed-footer.ts'), 'export function updateFooter() {}\n');
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'tests', 'query-liveness.test.ts'), 'test("liveness", () => {});\n');

    const output = buildContextDossier('fix prompt freezing and footer heartbeat during third turn', root);

    expect(output).toContain('# Context Dossier');
    expect(output).toContain('## Candidate Files');
    expect(output).toContain('src/query.ts');
    expect(output).toContain('src/fixed-footer.ts');
    expect(output).toContain('tests/query-liveness.test.ts');
    expect(output).toContain('## Dossier Contract');
    expect(output).toContain('/manifest');
  });
});
