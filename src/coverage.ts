/**
 * Test Coverage Analysis — auto-detect test framework and build coverage prompts.
 * Parses coverage reports and suggests uncovered areas.
 */
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ──────────────────────────────────────────────
export interface CoverageSummary {
  totalLines: number;
  coveredLines: number;
  percentage: number;
  uncoveredFiles: string[];
}

type TestFramework = 'jest' | 'pytest' | 'cargo' | 'mocha' | 'vitest' | 'unknown';

// ── Auto-detection ──────────────────────────────────────────────
function detectTestFramework(cwd: string): TestFramework {
  // Check package.json for test framework dependencies
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps.jest) return 'jest';
      if (deps.vitest) return 'vitest';
      if (deps.mocha) return 'mocha';
    } catch {
      // Continue to next check
    }
  }

  // Check for Rust Cargo.toml
  if (existsSync(join(cwd, 'Cargo.toml'))) {
    return 'cargo';
  }

  // Check for Python pytest
  if (existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'pyproject.toml'))) {
    return 'pytest';
  }

  // Check for test files
  const srcDir = join(cwd, 'src');
  const testsDir = join(cwd, 'tests');
  if (existsSync(srcDir)) {
    const files = readdirSync(srcDir, { recursive: true });
    if (files.some((f) => f.toString().includes('.test.') || f.toString().includes('.spec.'))) {
      return 'jest'; // Likely Jest/Vitest
    }
  }
  if (existsSync(testsDir)) {
    const files = readdirSync(testsDir);
    if (files.some((f) => f.includes('test_') || f.includes('_test.'))) {
      return 'pytest';
    }
  }

  return 'unknown';
}

// ── Coverage Command Building ──────────────────────────────────────
function getCoverageCommand(framework: TestFramework): string {
  switch (framework) {
    case 'jest':
      return 'npx jest --coverage';
    case 'vitest':
      return 'npx vitest --coverage';
    case 'mocha':
      return 'npx nyc mocha';
    case 'pytest':
      return 'pytest --cov --cov-report=term-missing';
    case 'cargo':
      return 'cargo tarpaulin --out Stdout';
    default:
      return '# Unable to detect test framework; manually specify coverage command';
  }
}

// ── Main Functions ──────────────────────────────────────────────
/**
 * Build a prompt that tells the AI to run coverage and suggest test improvements.
 */
export function buildCoveragePrompt(cwd: string): string {
  const framework = detectTestFramework(cwd);
  const coverageCmd = getCoverageCommand(framework);

  return `Analyze test coverage for this project and suggest improvements.

## Current Working Directory
\`\`\`
${cwd}
\`\`\`

## Detected Test Framework
${framework !== 'unknown' ? chalk.green(framework) : chalk.yellow('unknown (manually specify)')}

## Instructions
1. Run the coverage command: \`${coverageCmd}\`
2. Parse the coverage report and extract:
   - Total lines of code
   - Lines covered
   - Coverage percentage
   - List of uncovered or poorly-covered files
3. Analyze the results:
   - Identify the top 3-5 uncovered functions or code paths
   - Prioritize by impact (critical paths first)
4. Suggest specific tests to write:
   - For each uncovered area, describe what test cases would improve coverage
   - Focus on edge cases and error handling
5. Set a target of 80% coverage minimum

## Expected Output Format
Provide:
1. Current coverage summary (percentage and line counts)
2. List of uncovered files
3. For each top uncovered function:
   - Function name and location
   - What it does
   - Suggested test cases to cover it
4. Estimated effort to reach 80% coverage
5. Commands to run the suggested tests

## Notes
- If coverage is already ≥80%, suggest areas for improvement beyond line coverage
- Consider mutation testing or branch coverage for deeper insights
- Ensure all new tests have clear assertions`;
}

/**
 * Parse typical coverage output formats (Istanbul/Jest, pytest-cov, cargo-tarpaulin, lcov).
 */
export function parseCoverageSummary(output: string): CoverageSummary {
  let totalLines = 0;
  let coveredLines = 0;
  let percentage = 0;
  const uncoveredFiles: string[] = [];

  // Try Jest/Istanbul format: "statements   : 75.5% ( 150/200 )"
  const istanbulMatch = output.match(/statements\s*:\s*([\d.]+)%\s*\(\s*(\d+)\/(\d+)\s*\)/);
  if (istanbulMatch) {
    percentage = parseFloat(istanbulMatch[1]);
    coveredLines = parseInt(istanbulMatch[2], 10);
    totalLines = parseInt(istanbulMatch[3], 10);
  }

  // Try pytest format: "TOTAL  150  30  80%"
  const pytestMatch = output.match(/TOTAL\s+(\d+)\s+(\d+)\s+([\d.]+)%/);
  if (pytestMatch) {
    totalLines = parseInt(pytestMatch[1], 10);
    const uncovered = parseInt(pytestMatch[2], 10);
    coveredLines = totalLines - uncovered;
    percentage = parseFloat(pytestMatch[3]);
  }

  // Try cargo-tarpaulin format: "Region coverage: 75.5%"
  const cargoMatch = output.match(/Region coverage:\s*([\d.]+)%/);
  if (cargoMatch) {
    percentage = parseFloat(cargoMatch[1]);
    // Estimate total lines from percentage if we have some baseline
    if (totalLines === 0) totalLines = 200; // Conservative estimate
    coveredLines = Math.round((percentage / 100) * totalLines);
  }

  // Try lcov format: "LF:<total lines> LH:<covered lines>"
  const lcovMatch = output.match(/LF:(\d+)\s+LH:(\d+)/);
  if (lcovMatch) {
    totalLines = parseInt(lcovMatch[1], 10);
    coveredLines = parseInt(lcovMatch[2], 10);
    percentage = totalLines > 0 ? (coveredLines / totalLines) * 100 : 0;
  }

  // Extract uncovered files (common patterns)
  const fileMatches = Array.from(output.matchAll(/file:\s*([^\s]+)|coverage.*?([a-zA-Z0-9/._-]+\.(?:ts|js|py|rs))/g));
  for (const match of fileMatches) {
    const file = match[1] || match[2];
    if (file && !uncoveredFiles.includes(file)) {
      uncoveredFiles.push(file);
    }
  }

  return {
    totalLines: totalLines || 200,
    coveredLines: coveredLines || 0,
    percentage: percentage || 0,
    uncoveredFiles,
  };
}

/**
 * Pretty-print coverage summary with color-coded thresholds.
 * Green ≥80%, Yellow ≥60%, Red <60%
 */
export function printCoverageSummary(summary: CoverageSummary): void {
  const { totalLines, coveredLines, percentage, uncoveredFiles } = summary;

  let color: typeof chalk.green;
  if (percentage >= 80) {
    color = chalk.green;
  } else if (percentage >= 60) {
    color = chalk.yellow;
  } else {
    color = chalk.red;
  }

  console.log(chalk.cyan('\n  Coverage Summary:'));
  console.log(`  ${color(`  ${percentage.toFixed(1)}%`)} (${coveredLines} / ${totalLines} lines)`);

  if (uncoveredFiles.length > 0) {
    console.log(chalk.yellow('\n  Uncovered Files:'));
    uncoveredFiles.slice(0, 10).forEach((file) => {
      console.log(chalk.dim(`    - ${file}`));
    });
    if (uncoveredFiles.length > 10) {
      console.log(chalk.dim(`    ... and ${uncoveredFiles.length - 10} more`));
    }
  }

  const targetGap = 80 - percentage;
  if (targetGap > 0) {
    console.log(chalk.yellow(`\n  Gap to 80% target: ${targetGap.toFixed(1)}%`));
  } else {
    console.log(chalk.green('\n  ✓ Target 80% coverage achieved!'));
  }

  console.log();
}

// ── Exports ──────────────────────────────────────────────
export function getCoverageFramework(cwd: string): TestFramework {
  return detectTestFramework(cwd);
}

export function getCoverageCommandForFramework(cwd: string): string {
  const framework = detectTestFramework(cwd);
  return getCoverageCommand(framework);
}
