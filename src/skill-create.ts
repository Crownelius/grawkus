/**
 * Skill Creation from Git History — Generate reusable skills by analyzing patterns.
 * Extracts workflows from commit history and converts them to skill templates.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

export interface GitPattern {
  pattern: string;
  frequency: number;
  files: string[];
  description: string;
  example?: string;
}

/**
 * Parse git log and extract commit information
 */
function parseGitLog(
  cwd: string,
  limit = 50
): Array<{ hash: string; message: string; files: string[] }> {
  try {
    // Get recent commits with modified files
    const logFormat = '%H|%s|%b';
    const result = execSync(
      `git log --pretty=format:"${logFormat}" --numstat -${limit} 2>/dev/null`,
      {
        cwd,
        encoding: 'utf-8',
        timeout: 10_000,
      }
    );

    const commits: Array<{ hash: string; message: string; files: string[] }> = [];
    const lines = result.split('\n');
    let currentCommit: { hash: string; message: string; files: string[] } | null = null;

    for (const line of lines) {
      if (line.includes('|')) {
        // Commit header line
        const [hash, message] = line.split('|');
        if (currentCommit && currentCommit.files.length > 0) {
          commits.push(currentCommit);
        }
        currentCommit = { hash: hash.trim(), message: message.trim(), files: [] };
      } else if (line.match(/^\d+\s+\d+\s+/)) {
        // File change line (additions\tdeletions\tfilename)
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const fileName = parts.slice(2).join(' ');
          if (currentCommit) {
            currentCommit.files.push(fileName);
          }
        }
      }
    }

    if (currentCommit && currentCommit.files.length > 0) {
      commits.push(currentCommit);
    }

    return commits;
  } catch (err) {
    console.warn(chalk.yellow(`Warning: Could not parse git log: ${err}`));
    return [];
  }
}

/**
 * Analyze file change patterns (which files change together)
 */
function analyzeFilePatterns(commits: Array<{ files: string[] }>): Map<string, number> {
  const patterns = new Map<string, number>();

  for (const commit of commits) {
    if (commit.files.length <= 1) continue;

    // Create signature from file extensions/patterns
    const exts = commit.files
      .map((f) => f.split('.').pop())
      .filter(Boolean)
      .sort();
    const signature = exts.join('-');

    if (signature) {
      patterns.set(signature, (patterns.get(signature) || 0) + 1);
    }

    // Also track file path patterns
    const pathPattern = commit.files
      .map((f) => f.split('/')[0])
      .filter(Boolean)
      .sort()
      .join('-');

    if (pathPattern && pathPattern !== signature) {
      patterns.set(`path:${pathPattern}`, (patterns.get(`path:${pathPattern}`) || 0) + 1);
    }
  }

  return patterns;
}

/**
 * Analyze commit message patterns
 */
function analyzeCommitPatterns(commits: Array<{ message: string }>): Map<string, number> {
  const patterns = new Map<string, number>();

  // Common commit patterns
  const patterns_to_check = [
    { regex: /^feat:/i, label: 'feature' },
    { regex: /^fix:/i, label: 'bugfix' },
    { regex: /^test:/i, label: 'test' },
    { regex: /^refactor:/i, label: 'refactor' },
    { regex: /^docs?:/i, label: 'documentation' },
    { regex: /^chore:/i, label: 'chore' },
    { regex: /^perf:/i, label: 'performance' },
    { regex: /^style:/i, label: 'style' },
  ];

  for (const commit of commits) {
    const msg = commit.message.toLowerCase();

    for (const { regex, label } of patterns_to_check) {
      if (regex.test(msg)) {
        patterns.set(label, (patterns.get(label) || 0) + 1);
      }
    }

    // Keywords
    const keywords = ['fix', 'add', 'update', 'remove', 'improve', 'cleanup'];
    for (const keyword of keywords) {
      if (msg.includes(keyword)) {
        patterns.set(`keyword:${keyword}`, (patterns.get(`keyword:${keyword}`) || 0) + 1);
      }
    }
  }

  return patterns;
}

/**
 * Find sequences of related commits (workflows)
 */
function findWorkflowSequences(commits: Array<{ message: string; files: string[] }>): string[] {
  const sequences: string[] = [];

  // Look for common workflow sequences
  const messages = commits.map((c) => c.message.toLowerCase());

  // test → fix → commit pattern
  for (let i = 0; i < messages.length - 2; i++) {
    const m1 = messages[i];
    const m2 = messages[i + 1];
    const m3 = messages[i + 2];

    if (m1.includes('test') && m2.includes('fix') && m3.includes('fix')) {
      sequences.push('test-then-fix-then-verify');
    }

    if (m1.includes('refactor') && m2.includes('test')) {
      sequences.push('refactor-then-test');
    }

    if (m1.includes('feature') && m2.includes('docs')) {
      sequences.push('feature-then-document');
    }
  }

  return Array.from(new Set(sequences)); // Deduplicate
}

/**
 * Analyze git patterns from recent commits
 */
export function analyzeGitPatterns(cwd: string, limit = 50): GitPattern[] {
  if (!existsSync(join(cwd, '.git'))) {
    console.warn(chalk.yellow('Warning: Not a git repository'));
    return [];
  }

  const commits = parseGitLog(cwd, limit);
  if (commits.length === 0) {
    return [];
  }

  const filePatterns = analyzeFilePatterns(commits);
  const commitPatterns = analyzeCommitPatterns(commits);
  const workflows = findWorkflowSequences(commits);

  const patterns: GitPattern[] = [];

  // Convert file patterns to GitPattern
  for (const [pattern, frequency] of Array.from(filePatterns.entries())) {
    if (frequency >= 2) {
      // Only patterns that appear 2+ times
      patterns.push({
        pattern: `file-changes:${pattern}`,
        frequency,
        files: commits
          .filter((c) => {
            const exts = c.files.map((f) => f.split('.').pop()).sort().join('-');
            return exts === pattern;
          })
          .flatMap((c) => c.files)
          .slice(0, 5),
        description: `Files with pattern ${pattern} frequently change together`,
      });
    }
  }

  // Convert commit patterns to GitPattern
  for (const [pattern, frequency] of Array.from(commitPatterns.entries())) {
    if (frequency >= 3) {
      // Only patterns that appear 3+ times
      patterns.push({
        pattern,
        frequency,
        files: commits
          .filter((c) => c.message.toLowerCase().includes(pattern.split(':')[1] || pattern))
          .flatMap((c) => c.files)
          .slice(0, 5),
        description: `Commits with pattern "${pattern}" appear ${frequency} times`,
      });
    }
  }

  // Add workflow sequences
  for (const workflow of workflows) {
    patterns.push({
      pattern: `workflow:${workflow}`,
      frequency: 1,
      files: [],
      description: `Identified workflow: ${workflow}`,
    });
  }

  return patterns.sort((a, b) => b.frequency - a.frequency).slice(0, 20);
}

/**
 * Build a prompt for the AI to generate skills from git patterns
 */
export function buildSkillCreatePrompt(cwd: string, pattern?: string): string {
  const patterns = analyzeGitPatterns(cwd);

  if (patterns.length === 0) {
    return `# Skill Creation from Git History

The repository has no clear git history patterns to extract skills from.

Please help generate reusable skill templates for common development workflows in this project.

Consider:
1. What repetitive tasks appear in the commit history?
2. What are the standard steps for common operations?
3. What conventions does the team follow?
4. What could be automated with skills/workflows?

For each skill, provide:
- **Name**: Concise skill identifier
- **Description**: What it does
- **Steps**: Numbered workflow steps with {{placeholders}}
- **Commands**: Specific tool calls or scripts
- **Validation**: How to verify success`;
  }

  // Filter patterns if requested
  let filteredPatterns = patterns;
  if (pattern) {
    filteredPatterns = patterns.filter(
      (p) =>
        p.pattern.toLowerCase().includes(pattern.toLowerCase()) ||
        p.description.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  let patternsSummary = '';
  for (const p of filteredPatterns.slice(0, 10)) {
    patternsSummary += `\n- **${p.pattern}** (${p.frequency}x)\n  ${p.description}\n`;
    if (p.files.length > 0) {
      patternsSummary += `  Files: ${p.files.slice(0, 3).join(', ')}\n`;
    }
  }

  return `# Skill Creation from Git History

## Discovered Patterns

Based on analyzing the last 50 commits, these patterns emerged:
${patternsSummary}

## Workflow

1. **Analyze Patterns** — I've identified ${patterns.length} patterns from git history
2. **Extract Skills** — Convert recurring patterns into reusable skills
3. **Create Templates** — Generate skill templates with {{placeholders}}
4. **Validate** — Ensure each skill solves a real workflow

## Skill Template Format

For each skill, create a file with:
\`\`\`
# {{SKILL_NAME}}

## Description
{{What this skill does}}

## Trigger Pattern
{{When to use this skill}}

## Steps
1. {{Step 1 with {{placeholders}}}}
2. {{Step 2}}
...

## Validation
{{How to verify success}}

## Example Usage
\`\`\`bash
{{Example command}}
\`\`\`
\`\`\`

## Task

Based on the patterns above, please:

1. **Identify** the top 3 most valuable skills to create
2. **Design** skill workflows with clear steps and placeholders
3. **Include** validation checks for each skill
4. **Provide** example invocations
5. **Export** as reusable templates

Focus on the most frequent patterns ({{${filteredPatterns[0]?.pattern || 'feature development'}}})`;
}

/**
 * Pretty-print git patterns
 */
export function printGitPatterns(patterns: GitPattern[]): void {
  console.log(chalk.cyan('\n📊 Git Patterns Analysis'));
  console.log(chalk.gray(`Found ${patterns.length} patterns\n`));

  console.log(chalk.blue('Top Patterns:'));
  for (const p of patterns.slice(0, 15)) {
    const freqColor = p.frequency >= 5 ? chalk.green : chalk.yellow;
    console.log(chalk.gray(`  ${p.pattern}`));
    console.log(chalk.gray(`    ${p.description}`));
    console.log(freqColor(`    Frequency: ${p.frequency}x`));
    if (p.files.length > 0) {
      console.log(chalk.gray(`    Files: ${p.files.slice(0, 3).join(', ')}`));
    }
    console.log();
  }
}

/**
 * Export patterns to a JSON file for reference
 */
export function exportPatternsToJSON(patterns: GitPattern[], outputPath: string): void {
  const dir = outputPath.substring(0, outputPath.lastIndexOf('/'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(patterns, null, 2), 'utf-8');
  console.log(chalk.green(`✓ Exported ${patterns.length} patterns to ${outputPath}`));
}

/**
 * Generate a skill file from a git pattern
 */
export function generateSkillFromPattern(
  pattern: GitPattern,
  cwd: string
): { name: string; content: string } {
  const skillName = pattern.pattern.replace(/[^a-z0-9-]/gi, '-').toLowerCase();

  const content = `# ${pattern.pattern}

${pattern.description}

Frequency in recent history: ${pattern.frequency} occurrences

## When to Use

This pattern appears in commits that:
- Modify: ${pattern.files.slice(0, 3).join(', ') || 'multiple files'}
- Pattern: ${pattern.pattern}

## Workflow Steps

1. {{TODO: Define workflow step 1}}
2. {{TODO: Define workflow step 2}}
3. {{TODO: Define validation}}

## Files Involved

${pattern.files.map((f) => `- \`${f}\``).join('\n')}

## Example

\`\`\`bash
# {{Example command}}
\`\`\`

## Notes

- Generated from git history analysis
- ${pattern.frequency} instances found in recent commits
- Suggested for automation/skill creation
`;

  return { name: skillName, content };
}

/**
 * Analyze and print git workflow summary
 */
export function printGitWorkflowSummary(cwd: string): void {
  const patterns = analyzeGitPatterns(cwd);

  if (patterns.length === 0) {
    console.log(chalk.yellow('No clear patterns found in git history'));
    return;
  }

  console.log(chalk.cyan('\n🔄 Git Workflow Summary'));
  console.log(chalk.gray(`Analyzed repository: ${cwd}\n`));

  // Group by pattern type
  const byType = new Map<string, GitPattern[]>();
  for (const p of patterns) {
    const type = p.pattern.split(':')[0];
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type)!.push(p);
  }

  for (const [type, pats] of Array.from(byType.entries())) {
    console.log(chalk.blue(`${type.charAt(0).toUpperCase() + type.slice(1)}:`));
    for (const p of pats.slice(0, 3)) {
      console.log(chalk.gray(`  - ${p.pattern} (${p.frequency}x)`));
    }
    console.log();
  }

  console.log(chalk.gray('Run: buildSkillCreatePrompt(cwd) to generate skills'));
}
