import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAutoRepoMapBlock, generateCodeMap } from '../src/codemaps.js';

const ORIGINAL_REPO_MAP = process.env.GRAWKUS_REPO_MAP;

afterEach(() => {
  if (ORIGINAL_REPO_MAP === undefined) {
    delete process.env.GRAWKUS_REPO_MAP;
  } else {
    process.env.GRAWKUS_REPO_MAP = ORIGINAL_REPO_MAP;
  }
});

function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'grawkus-codemap-'));
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'core.ts'), 'export function core(input: string) { return input.trim(); }\n');
  writeFileSync(join(cwd, 'src', 'feature.ts'), "import { core } from './core';\nexport const feature = () => core('x');\n");
  writeFileSync(join(cwd, 'src', 'index.ts'), "export { core } from './core';\nexport { feature } from './feature';\n");
  writeFileSync(join(cwd, 'src', 'app.ts'), "import { feature } from './feature';\nexport function run() { return feature(); }\n");
  writeFileSync(join(cwd, 'src', 'other.ts'), 'export const other = 1;\n');
  return cwd;
}

describe('automatic repo map', () => {
  it('extracts local import specifiers for dependency ranking', () => {
    const cwd = fixture();
    try {
      const map = generateCodeMap(cwd);
      const feature = map.files.find((file) => file.path === 'src/feature.ts');
      expect(feature?.localImports).toContain('./core');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('renders a bounded repo map for larger codebases', () => {
    const cwd = fixture();
    try {
      const block = buildAutoRepoMapBlock(cwd, 'fix core behavior', { minFiles: 5, maxFiles: 4, maxChars: 1200 });
      expect(block).toContain('<repo_map>');
      expect(block).toContain('Project outline: 5 code/config files');
      expect(block).toContain('src/core.ts');
      expect(block).toContain('exports: core');
      expect(block!.length).toBeLessThanOrEqual(1200);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('skips small repos and honors the env kill switch', () => {
    const cwd = fixture();
    try {
      expect(buildAutoRepoMapBlock(cwd, 'anything', { minFiles: 10 })).toBeNull();
      process.env.GRAWKUS_REPO_MAP = '0';
      expect(buildAutoRepoMapBlock(cwd, 'anything', { minFiles: 5 })).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
