import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  autoDetectTestCommand,
  autoDetectVerifierCommands,
  buildVerifierStack,
  buildVerifyPrompt,
  runVerificationLoop,
} from '../src/verification.js';

describe('verification command detection', () => {
  const withTempProject = (run: (cwd: string) => void): void => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-verify-'));
    try {
      run(cwd);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };

  const withTempProjectAsync = async (run: (cwd: string) => Promise<void>): Promise<void> => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-verify-'));
    try {
      await run(cwd);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };

  it('builds an ordered verifier stack from project markers', () => {
    withTempProject((cwd) => {
      writeFileSync(
        join(cwd, 'package.json'),
        JSON.stringify({
          scripts: {
            test: 'jest',
            verify: 'echo verify',
            lint: 'eslint .',
          },
        }),
        'utf-8',
      );
      writeFileSync(join(cwd, 'Makefile'), 'test:\n\techo test\nverify:\n\techo verify\n');

      const stack = buildVerifierStack(cwd);
      expect(stack).toContain('npm test');
      expect(stack[0]).toBe('npm test');
      expect(stack).toContain('npm run verify');
      expect(stack).toContain('npm run test');
      expect(stack).toContain('npm run lint');
      expect(stack).toContain('make verify');
      expect(stack).toContain('make test');
      expect(stack.length).toBeLessThanOrEqual(6);
    });
  });

  it('includes type-check and security commands when available', () => {
    withTempProject((cwd) => {
      writeFileSync(
        join(cwd, 'package.json'),
        JSON.stringify({
          scripts: {
            typecheck: 'tsc --noEmit',
            security: 'npm audit',
          },
        }),
        'utf-8',
      );

      const stack = buildVerifierStack(cwd);
      expect(stack).toContain('npm run typecheck');
      expect(stack).toContain('npm run security');
    });
  });

  it('exposes auto-detected verifier stack as a public helper', () => {
    withTempProject((cwd) => {
      writeFileSync(join(cwd, 'pyproject.toml'), '[tool.ruff]\n[tool.mypy]\n[project]\n');
      const stack = autoDetectVerifierCommands(cwd);
      expect(stack).toContain('ruff check .');
      expect(stack).toContain('mypy .');
      expect(stack[0]).toBe('pytest');
      expect(autoDetectTestCommand(cwd)).toBe('pytest');
    });
  });

  it('formats /verify prompt with command stack when no explicit command is supplied', () => {
    withTempProject((cwd) => {
      writeFileSync(join(cwd, 'Cargo.toml'), '[package]\nname="x"\n');
      writeFileSync(join(cwd, 'Makefile'), 'test:\n\techo test\n');
      const prompt = buildVerifyPrompt(cwd);
      expect(prompt).toContain('Command stack:');
      expect(prompt).toContain('cargo test');
      expect(prompt).toContain('Alternative verification commands:');
      expect(prompt).toContain('make test');
    });
  });

  it('runs verifier fallback stack deterministically', async () => {
    await withTempProjectAsync(async (cwd) => {
      const failPath = join(cwd, 'fail.js');
      const passPath = join(cwd, 'pass.js');
      writeFileSync(failPath, 'process.exit(1);', 'utf-8');
      writeFileSync(passPath, 'process.exit(0);', 'utf-8');

      const result = await runVerificationLoop(cwd, [`node "${failPath}"`, `node "${passPath}"`], {
        maxIterations: 3,
        timeoutMs: 2000,
        verbose: false,
      });

      expect(result.success).toBe(true);
      expect(result.iterations).toBe(2);
      expect(result.errors).toHaveLength(1);
    });
  });

  it('retries the last verifier command after stack exhaustion', async () => {
    await withTempProjectAsync(async (cwd) => {
      const failPath = join(cwd, 'fail.js');
      writeFileSync(failPath, 'process.exit(1);', 'utf-8');

      const result = await runVerificationLoop(cwd, `node "${failPath}"`, {
        maxIterations: 2,
        timeoutMs: 2000,
        verbose: false,
      });

      expect(result.success).toBe(false);
      expect(result.iterations).toBe(2);
      expect(result.errors).toHaveLength(2);
    });
  });
});
