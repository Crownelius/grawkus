/**
 * Documentation Synchronization — find stale docs, missing JSDoc, and sync with code.
 * Keeps documentation in sync with actual code.
 */
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ──────────────────────────────────────────────
export interface DocFile {
  path: string;
  type: 'readme' | 'changelog' | 'api' | 'guide' | 'markdown' | 'jsdoc';
  lastModified?: number;
}

// ── Helper: Detect Language ──────────────────────────────────────
function detectProjectLanguage(cwd: string): 'typescript' | 'javascript' | 'python' | 'rust' | 'unknown' {
  const pkgPath = join(cwd, 'package.json');
  const cargoPath = join(cwd, 'Cargo.toml');
  const pyPath = join(cwd, 'pyproject.toml');

  if (existsSync(pkgPath)) {
    const srcDir = join(cwd, 'src');
    if (existsSync(srcDir)) {
      const files = readdirSync(srcDir, { recursive: true });
      if (files.some((f) => f.toString().endsWith('.ts'))) {
        return 'typescript';
      }
    }
    return 'javascript';
  }

  if (existsSync(cargoPath)) return 'rust';
  if (existsSync(pyPath)) return 'python';

  return 'unknown';
}

// ── Main Functions ──────────────────────────────────────────────
/**
 * Detect all documentation files in the project.
 * Returns: README.md, CHANGELOG.md, docs/, JSDoc comments, docstrings, API docs
 */
export function detectDocFiles(cwd: string): DocFile[] {
  const docs: DocFile[] = [];

  // Check for root-level markdown files
  const rootFiles = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'API.md', 'ARCHITECTURE.md'];
  for (const file of rootFiles) {
    const path = join(cwd, file);
    if (existsSync(path)) {
      docs.push({
        path,
        type: file === 'README.md' ? 'readme' : file === 'CHANGELOG.md' ? 'changelog' : 'markdown',
      });
    }
  }

  // Check for docs directory
  const docsDir = join(cwd, 'docs');
  if (existsSync(docsDir)) {
    const recurse = (dir: string) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            recurse(join(dir, entry.name));
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            docs.push({
              path: join(dir, entry.name),
              type: 'guide',
            });
          }
        }
      } catch {
        // Ignore read errors
      }
    };
    recurse(docsDir);
  }

  // Check for source files with JSDoc/docstrings
  const srcDir = join(cwd, 'src');
  if (existsSync(srcDir)) {
    const language = detectProjectLanguage(cwd);
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
            docs.push({
              path: join(dir, entry.name),
              type: 'jsdoc',
            });
          }
        }
      } catch {
        // Ignore read errors
      }
    };
    recurse(srcDir);
  }

  return docs;
}

/**
 * Build a prompt that tells the AI to sync documentation with code.
 */
export function buildDocsUpdatePrompt(cwd: string): string {
  const language = detectProjectLanguage(cwd);
  const docFiles = detectDocFiles(cwd);

  const docSummary = docFiles
    .map((d) => `  - ${d.type.toUpperCase()}: ${d.path}`)
    .join('\n');

  return `Update and synchronize all documentation to match the current code.

## Current Working Directory
\`\`\`
${cwd}
\`\`\`

## Detected Language
${language}

## Found Documentation Files
\`\`\`
${docSummary}
\`\`\`

## Instructions
1. **Review all documentation files**:
   - README.md: Check installation, usage, API overview
   - CHANGELOG.md: Verify recent entries match recent code changes
   - docs/*.md: Check all guides for outdated examples
   - Source files: Check for missing or stale JSDoc/docstrings

2. **Compare with actual code**:
   - List all exported functions, classes, and types
   - Check if they appear in documentation
   - Verify function signatures match docs
   - Check if CLI flags, config options are documented
   - Look for examples that might be outdated

3. **Identify gaps**:
   - Missing JSDoc comments on public APIs
   - Undocumented exports
   - Examples that don't run
   - Missing error documentation
   - Deprecated features still documented
   - New features not documented

4. **Update stale documentation**:
   - Fix outdated examples with current syntax
   - Update API signatures if code changed
   - Correct parameter names and types
   - Update version numbers in examples
   - Fix broken internal links

5. **Add missing documentation**:
   - Add JSDoc to all public functions and classes
   - Document all public exports in README or API.md
   - Add examples for common use cases
   - Document error cases and exceptions
   - Add CLI usage if applicable

## Documentation Standards
For JSDoc/Docstrings:
\`\`\`typescript
/**
 * Brief description of what this does.
 *
 * More detailed explanation if needed.
 *
 * @param paramName - Description of parameter
 * @returns Description of return value
 * @throws ErrorType If this condition occurs
 * @example
 * const result = myFunction('input');
 */
function exampleFunction(paramName: string): string {
  // ...
}
\`\`\`

For README:
- Brief project description
- Installation instructions
- Quick start example
- Link to full API documentation
- Contributing guidelines
- License

## Expected Output Format
1. **Summary**:
   - Total documentation files found
   - Number of public exports
   - Coverage % (documented vs total)

2. **For each documentation file**:
   - **File**: Path
   - **Status**: (up-to-date / needs update / incomplete)
   - **Issues Found**: Specific problems
   - **Changes Made**: What was updated

3. **For JSDoc/Docstrings**:
   - **Functions without docs**: List
   - **Outdated docs**: List with fixes
   - **Missing examples**: Which functions need them

4. **Overall Documentation Health**:
   - Completeness score (0-100%)
   - Key gaps remaining
   - Recommended priorities for next steps`;
}

/**
 * Print documentation status summary.
 */
export function printDocsSyncStatus(docFiles: DocFile[], coveredExports?: number, totalExports?: number): void {
  console.log(chalk.cyan('\n  Documentation Status:'));
  console.log(`  ${chalk.dim(`Total doc files: ${docFiles.length}`)}`);

  // Group by type
  const byType: Record<string, number> = {};
  for (const doc of docFiles) {
    byType[doc.type] = (byType[doc.type] || 0) + 1;
  }

  for (const [type, count] of Object.entries(byType)) {
    console.log(chalk.dim(`    ${type}: ${count}`));
  }

  // Coverage
  if (coveredExports !== undefined && totalExports !== undefined) {
    const percentage = totalExports > 0 ? (coveredExports / totalExports) * 100 : 0;
    const color = percentage >= 80 ? chalk.green : percentage >= 60 ? chalk.yellow : chalk.red;

    console.log(chalk.cyan('\n  API Documentation Coverage:'));
    console.log(`  ${color(`  ${percentage.toFixed(1)}%`)} (${coveredExports} / ${totalExports} exports)`);
  }

  // Recommendations
  const hasReadme = docFiles.some((d) => d.type === 'readme');
  const hasChangelog = docFiles.some((d) => d.type === 'changelog');
  const hasGuides = docFiles.some((d) => d.type === 'guide');

  if (!hasReadme) {
    console.log(chalk.yellow('\n  ⚠ Missing README.md'));
  }
  if (!hasChangelog) {
    console.log(chalk.yellow('  ⚠ Missing CHANGELOG.md'));
  }
  if (!hasGuides && docFiles.length > 0) {
    console.log(chalk.yellow('  ⚠ No guides in docs/ directory'));
  }

  console.log();
}

// ── Exports ──────────────────────────────────────────────
export function getProjectLanguage(cwd: string): 'typescript' | 'javascript' | 'python' | 'rust' | 'unknown' {
  return detectProjectLanguage(cwd);
}

export function getDocumentationFiles(cwd: string): DocFile[] {
  return detectDocFiles(cwd);
}

export function hasReadme(cwd: string): boolean {
  return existsSync(join(cwd, 'README.md'));
}

export function hasChangelog(cwd: string): boolean {
  return existsSync(join(cwd, 'CHANGELOG.md'));
}

export function hasDocsDirectory(cwd: string): boolean {
  return existsSync(join(cwd, 'docs'));
}
