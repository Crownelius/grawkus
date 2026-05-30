/**
 * Dead Code Detection & Cleanup — find unused code, duplicates, and refactoring opportunities.
 * Suggests safe refactorings while ensuring tests still pass.
 */
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectLanguage } from './docs-sync.js';

// ── Types ──────────────────────────────────────────────
export interface DeadCodeAnalysis {
  unusedExports: string[];
  unreachableCode: string[];
  unusedVariables: string[];
  duplicatedLogic: string[];
  highComplexityFunctions: string[];
}

// ── Helper: Find source files ──────────────────────────────────────
function findSourceFiles(cwd: string, language: string): string[] {
  const files: string[] = [];
  const srcDir = join(cwd, 'src');

  if (!existsSync(srcDir)) return files;

  const extensions: Record<string, string[]> = {
    typescript: ['.ts', '.tsx'],
    javascript: ['.js', '.jsx'],
    python: ['.py'],
    rust: ['.rs'],
  };

  const exts = extensions[language] || [];
  const recurse = (dir: string) => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          recurse(join(dir, entry.name));
        } else if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) {
          files.push(join(dir, entry.name));
        }
      }
    } catch {
      // Ignore read errors
    }
  };

  recurse(srcDir);
  return files;
}

// ── Helper: Check if test command exists ──────────────────────────
function hasTestCommand(cwd: string): boolean {
  try {
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return !!(pkg.scripts && (pkg.scripts.test || pkg.scripts['test:unit']));
    }
  } catch {
    // Continue
  }
  return false;
}

// ── Main Functions ──────────────────────────────────────────────
/**
 * Build a comprehensive prompt for AI to detect dead code and duplicates.
 * Optionally targets a specific file or pattern.
 */
export function buildRefactorPrompt(cwd: string, target?: string): string {
  const language = getProjectLanguage(cwd);
  const sourceFiles = findSourceFiles(cwd, language);
  const testAvailable = hasTestCommand(cwd);

  const targetInfo = target
    ? `\n## Target for Refactoring\nFocus on: \`${target}\``
    : `\n## Project Structure\nFound ${sourceFiles.length} source files`;

  return `Analyze this project for dead code, duplication, and refactoring opportunities.

## Current Working Directory
\`\`\`
${cwd}
\`\`\`

## Detected Language
${language}

${targetInfo}

## Instructions
1. Scan for dead code:
   - Unused exports (functions, classes, constants declared but never imported)
   - Unreachable code (after returns, in dead branches)
   - Unused variables and function parameters
   - Unused imports

2. Find code duplication:
   - Similar logic repeated in multiple functions
   - Duplicated error handling patterns
   - Identical conditional branches
   - Extract common patterns into shared utilities

3. Identify complexity issues:
   - Functions with high cyclomatic complexity (>10)
   - Long parameter lists (>4 params)
   - Deep nesting levels (>3 levels)
   - Overly long files (>300 lines)

4. Suggest refactorings:
   - Inline unused variables
   - Consolidate duplicated logic
   - Extract helper functions
   - Break apart complex functions
   - Reorganize imports

5. Ensure test coverage${testAvailable ? ': Run tests after each change' : ' (note: no test script detected)'}

## Refactoring Strategy
${testAvailable ? '- Before refactoring: run `npm test` to establish baseline\n- After each change: verify tests still pass\n- Only apply changes if tests pass' : '- Document each change clearly\n- Preserve public API signatures'}

## Expected Output Format
For each finding, provide:
1. **Type**: (unused export / unreachable code / duplication / complexity)
2. **Location**: File path and line range
3. **Current Code**: Snippet showing the issue
4. **Suggested Fix**: Concrete refactoring steps
5. **Risk Level**: Low / Medium / High
6. **Test Impact**: How to verify the change is safe

## Priority Order
1. Remove unused exports (safest)
2. Consolidate duplication (high impact)
3. Simplify complex functions (medium risk)
4. Reorganize code structure (larger refactors)`;
}

/**
 * Build a more focused prompt for dead code cleanup only.
 */
export function buildCleanupPrompt(cwd: string): string {
  const language = getProjectLanguage(cwd);

  return `Clean up dead code in this project.

## Current Working Directory
\`\`\`
${cwd}
\`\`\`

## Language
${language}

## Focus Areas
1. Remove unused imports
2. Delete unused variables and constants
3. Remove commented-out code
4. Clean up unused function parameters
5. Delete unused exports

## Instructions
- Go through each source file
- Identify lines/blocks that serve no purpose
- Remove them one at a time
- Keep the code compiling/running
- Remove trailing whitespace and fix formatting

## Output Format
For each cleanup action:
- **File**: Path to the file
- **Action**: What was removed or cleaned
- **Before/After**: Show the change
- **Reason**: Why it's safe to remove

Focus on speed and confidence over perfection.`;
}

/**
 * Print a summary of dead code analysis.
 */
export function printDeadCodeAnalysis(analysis: DeadCodeAnalysis): void {
  const isEmpty =
    analysis.unusedExports.length === 0 &&
    analysis.unreachableCode.length === 0 &&
    analysis.unusedVariables.length === 0 &&
    analysis.duplicatedLogic.length === 0 &&
    analysis.highComplexityFunctions.length === 0;

  console.log(chalk.cyan('\n  Dead Code Analysis:'));

  if (isEmpty) {
    console.log(chalk.green('  ✓ No obvious dead code detected'));
    console.log();
    return;
  }

  if (analysis.unusedExports.length > 0) {
    console.log(chalk.yellow(`  Unused Exports (${analysis.unusedExports.length}):`));
    analysis.unusedExports.slice(0, 5).forEach((item) => {
      console.log(chalk.dim(`    - ${item}`));
    });
    if (analysis.unusedExports.length > 5) {
      console.log(chalk.dim(`    ... and ${analysis.unusedExports.length - 5} more`));
    }
  }

  if (analysis.unreachableCode.length > 0) {
    console.log(chalk.red(`  Unreachable Code (${analysis.unreachableCode.length}):`));
    analysis.unreachableCode.slice(0, 5).forEach((item) => {
      console.log(chalk.dim(`    - ${item}`));
    });
    if (analysis.unreachableCode.length > 5) {
      console.log(chalk.dim(`    ... and ${analysis.unreachableCode.length - 5} more`));
    }
  }

  if (analysis.duplicatedLogic.length > 0) {
    console.log(chalk.yellow(`  Duplicated Logic (${analysis.duplicatedLogic.length}):`));
    analysis.duplicatedLogic.slice(0, 5).forEach((item) => {
      console.log(chalk.dim(`    - ${item}`));
    });
    if (analysis.duplicatedLogic.length > 5) {
      console.log(chalk.dim(`    ... and ${analysis.duplicatedLogic.length - 5} more`));
    }
  }

  if (analysis.highComplexityFunctions.length > 0) {
    console.log(chalk.yellow(`  High Complexity Functions (${analysis.highComplexityFunctions.length}):`));
    analysis.highComplexityFunctions.slice(0, 5).forEach((item) => {
      console.log(chalk.dim(`    - ${item}`));
    });
    if (analysis.highComplexityFunctions.length > 5) {
      console.log(chalk.dim(`    ... and ${analysis.highComplexityFunctions.length - 5} more`));
    }
  }

  console.log();
}

// ── Exports ──────────────────────────────────────────────
// `getProjectLanguage` is exported from docs-sync.ts (imported above) — don't
// re-export the same identifier here, it collides at the ESM module level.

export function getSourceFiles(cwd: string): string[] {
  const language = getProjectLanguage(cwd);
  return findSourceFiles(cwd, language);
}

export function projectHasTests(cwd: string): boolean {
  return hasTestCommand(cwd);
}
