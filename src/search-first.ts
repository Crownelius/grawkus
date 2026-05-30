/**
 * Search-First Workflow — Research before implementation.
 * Builds prompts that force the AI to understand existing code patterns
 * before proposing new implementations.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

/**
 * Escape special regex characters for safe usage in grep patterns
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Safely run grep without throwing errors
 */
function safeGrep(pattern: string, path: string, filePattern = '*.ts'): string[] {
  try {
    const escaped = escapeRegex(pattern);
    const result = execSync(
      `grep -r "${escaped}" "${path}" --include="${filePattern}" 2>/dev/null || echo ""`,
      {
        encoding: 'utf-8',
        cwd: path,
        timeout: 10_000,
      }
    );
    return result
      .split('\n')
      .filter((line) => line.trim())
      .slice(0, 20); // Limit to first 20 matches
  } catch {
    return [];
  }
}

/**
 * Find relevant files based on keywords
 */
function findRelevantFiles(keyword: string, cwd: string): string[] {
  try {
    const result = execSync(
      `find "${cwd}/src" -name "*.ts" -type f 2>/dev/null | head -30`,
      { encoding: 'utf-8', timeout: 5_000 }
    );
    const files = result
      .split('\n')
      .filter((f) => f.trim())
      .map((f) => f.replace(cwd + '/', ''));

    // Filter by keyword relevance
    return files.filter(
      (f) =>
        f.toLowerCase().includes(keyword.toLowerCase()) ||
        f.includes('types') ||
        f.includes('index')
    );
  } catch {
    return [];
  }
}

/**
 * Read and summarize a file's key exports and patterns
 */
function summarizeFile(filePath: string, cwd: string): string {
  try {
    const fullPath = join(cwd, filePath);
    if (!existsSync(fullPath)) return '';

    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    // Extract exports
    const exports = lines
      .filter((l) => l.includes('export '))
      .slice(0, 10)
      .map((l) => l.trim());

    // Extract imports
    const imports = lines
      .filter((l) => l.includes('import '))
      .slice(0, 5)
      .map((l) => l.trim());

    // Extract top-level function/class names
    const definitions = lines
      .filter((l) => /^(export\s+)?(function|class|interface|type|const)\s+\w+/.test(l))
      .slice(0, 8)
      .map((l) => l.trim());

    let summary = `\n### ${filePath}\n`;
    if (definitions.length > 0) {
      summary += `**Definitions:**\n${definitions.map((d) => `- ${d}`).join('\n')}\n`;
    }
    if (exports.length > 0) {
      summary += `**Key exports:**\n${exports.map((e) => `- ${e}`).join('\n')}\n`;
    }

    return summary;
  } catch {
    return '';
  }
}

/**
 * Find documentation files (README, docs/, comments in code)
 */
function findDocs(cwd: string): string[] {
  const docFiles: string[] = [];

  // Check for README
  const readmeFiles = ['README.md', 'readme.md', 'docs/README.md'];
  for (const f of readmeFiles) {
    if (existsSync(join(cwd, f))) {
      docFiles.push(f);
    }
  }

  // Check for docs directory
  const docsDir = join(cwd, 'docs');
  if (existsSync(docsDir)) {
    try {
      const files = readdirSync(docsDir);
      docFiles.push(...files.filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`));
    } catch {
      // Ignore errors
    }
  }

  // Check for src/docs
  const srcDocsDir = join(cwd, 'src', 'docs');
  if (existsSync(srcDocsDir)) {
    try {
      const files = readdirSync(srcDocsDir);
      docFiles.push(...files.filter((f) => f.endsWith('.md')).map((f) => `src/docs/${f}`));
    } catch {
      // Ignore errors
    }
  }

  return docFiles.slice(0, 10); // Limit to 10 docs
}

/**
 * Extract JSDoc comments from a file
 */
function extractJSDoc(filePath: string, cwd: string): string[] {
  try {
    const fullPath = join(cwd, filePath);
    if (!existsSync(fullPath)) return [];

    const content = readFileSync(fullPath, 'utf-8');
    const jsdocs: string[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('/**')) {
        let doc = '';
        for (let j = i; j < Math.min(i + 10, lines.length); j++) {
          doc += lines[j] + '\n';
          if (lines[j].includes('*/')) {
            jsdocs.push(doc);
            break;
          }
        }
      }
    }

    return jsdocs.slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Build a prompt that tells the AI to research existing code first
 */
export function buildSearchFirstPrompt(task: string, cwd: string): string {
  const keyword = task.split(/\s+/)[0]; // Extract first word as search term
  const relevantFiles = findRelevantFiles(keyword, cwd);
  const relatedGreps = safeGrep(keyword, join(cwd, 'src'), '*.ts');

  let research = '';

  // Relevant file summaries
  if (relevantFiles.length > 0) {
    research += `\n## Relevant Existing Code\n`;
    for (const file of relevantFiles.slice(0, 5)) {
      research += summarizeFile(file, cwd);
    }
  }

  // Pattern matches
  if (relatedGreps.length > 0) {
    research += `\n## Related Code Patterns\n`;
    research += 'Found these related patterns in the codebase:\n';
    research += relatedGreps.map((g) => `\`\`\`\n${g}\n\`\`\``).join('\n');
  }

  return `# Research-First Implementation

## Task
${task}

## Before Writing Code: Research Phase

Please follow this approach:

1. **Analyze existing patterns** in the codebase
   - Look at similar functions and modules
   - Understand how the project structures code
   - Check for established patterns we should follow

2. **Review documentation and comments**
   - Check relevant files for JSDoc and inline comments
   - Look for design patterns in existing implementations
   - Understand architectural decisions

3. **Identify applicable patterns**
   - What patterns from existing code apply here?
   - Are there similar functions we should model after?
   - What conventions does this project follow?

4. **Reference existing code in your proposal**
   - When proposing a solution, reference the existing code that informed it
   - Explain how your implementation follows established patterns
   - Point out if you're introducing a new pattern and why

## Current Codebase Research
${research || '(Run research to populate this section)'}

## Implementation Guidelines
- Follow the style and patterns of existing code
- Use the same import structure and module organization
- Match the error handling approach used elsewhere
- Maintain consistency with project conventions
- Reference specific files and functions that informed the design

Now, please implement the task, but start by analyzing the codebase and then proposing your solution.`;
}

/**
 * Build a prompt for looking up documentation
 */
export function buildDocsLookupPrompt(query: string, cwd: string): string {
  const docFiles = findDocs(cwd);
  const grepResults = safeGrep(query, join(cwd, 'src'), '*.ts');

  let docsContent = '';

  // Read doc files
  if (docFiles.length > 0) {
    docsContent += `\n## Documentation Files Found\n`;
    for (const docFile of docFiles) {
      const fullPath = join(cwd, docFile);
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          docsContent += `\n### ${docFile}\n\`\`\`\n${content.slice(0, 1000)}\n\`\`\`\n`;
        } catch {
          docsContent += `\n### ${docFile} (could not read)\n`;
        }
      }
    }
  }

  // JSDoc from relevant files
  if (grepResults.length > 0) {
    const srcFiles = findRelevantFiles(query, cwd).slice(0, 3);
    docsContent += `\n## Code Documentation & Comments\n`;
    for (const file of srcFiles) {
      const jsDoc = extractJSDoc(file, cwd);
      if (jsDoc.length > 0) {
        docsContent += `\n### ${file}\n`;
        docsContent += jsDoc.map((doc) => `\`\`\`typescript\n${doc}\n\`\`\``).join('\n');
      }
    }
  }

  return `# Documentation Lookup

## Query
${query}

## Research Results

### Step 1: Local Documentation
- Searched docs/ directory
- Searched README files
- Searched for configuration files

### Step 2: Code Comments & JSDoc
- Extracted JSDoc from relevant files
- Found inline documentation
- Checked for examples in tests

${docsContent || '(No documentation found - searching code patterns instead)'}

### Step 3: Code Patterns
${
  grepResults.length > 0
    ? 'Found these implementations:\n' +
      grepResults.slice(0, 10).map((g) => `- ${g}`).join('\n')
    : 'No specific patterns found'
}

## Summary
Based on the documentation and code patterns found, here are the key findings:

1. **Documentation**: ${docFiles.length > 0 ? `Found ${docFiles.length} documentation files` : 'Limited documentation'}
2. **Code Examples**: ${grepResults.length > 0 ? `Found ${grepResults.length} related code snippets` : 'No examples'}
3. **Related Files**: ${findRelevantFiles(query, cwd).length} relevant source files

Please use these findings to answer the query.`;
}

/**
 * Build a prompt for source-grounded external research before implementation.
 */
export function buildSourceResearchPrompt(topic: string): string {
  return `# Source-Grounded Research Brief

## Topic
${topic}

Use the \`research_sources\` tool before answering. Query at least:
- \`source:"arxiv"\`, \`recent_days:90\`, \`format:"json"\` for recent papers and methods
- \`source:"github"\`, \`github_kind:"all"\`, \`recent_days:90\`, \`format:"json"\` for repos, issues, PRs, and code patterns
- \`source:"huggingface"\`, \`kind:"all"\`, \`recent_days:90\`, \`format:"json"\` for papers, models, and datasets
- \`source:"kaggle"\`, \`kaggle_kind:"both"\`, \`format:"json"\` for datasets and competitions

After the GitHub pass, call \`github_repo_digest\` on one or two directly relevant public GitHub repos when the topic is about agent/harness implementation, benchmark strategy, or source-code patterns. Use the digest's manifests, likely commands, and component surface signals as evidence; do not infer implementation details from repo popularity alone.
For Terminal-Bench public-agent comparisons, call \`benchmark_repo_catalog\` first so known public leaderboard repos are not missed.

Then synthesize a brief with:
1. The strongest current ideas or artifacts relevant to the topic.
2. What is directly applicable to this codebase.
3. Compatibility or operational risks.
4. A concrete implementation plan with verification steps.

Rules:
- Cite URLs returned by the tool.
- Prefer recent and maintained sources over stale popularity.
- Do not invent papers, repos, datasets, or benchmark claims.
- If a source fails, say which one failed and continue with the others.`;
}

/**
 * Print a summary of the research workflow
 */
export function printSearchFirstSummary(): void {
  console.log(chalk.cyan('\n📚 Search-First Workflow'));
  console.log(chalk.gray('Research existing code before implementation\n'));
  console.log(chalk.blue('Available prompts:'));
  console.log(chalk.gray('  buildSearchFirstPrompt(task, cwd)'));
  console.log(chalk.gray('    → Forces research phase before coding'));
  console.log(chalk.gray('  buildDocsLookupPrompt(query, cwd)'));
  console.log(chalk.gray('    → Looks up relevant documentation & patterns\n'));
}
