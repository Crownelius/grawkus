/**
 * Git workflow — smart commit, PR creation, diff, log.
 * Injected as slash commands: /commit, /pr, /diff, /log
 */
/**
 * Git workflow — smart commit, PR creation, diff, log.
 * Injected as slash commands: /commit, /pr, /diff, /log
 */
import { execSync } from 'node:child_process';
import chalk from 'chalk';

/**
 * Execute a git command safely, returning empty string on error.
 * @param cmd - Git command arguments (without "git" prefix)
 * @param cwd - Working directory
 * @returns Command output or error message
 */
function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return `Error: ${msg}`;
  }
}

export function isGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function gitStatus(cwd: string): string {
  return git('status --short', cwd);
}

export function gitDiff(cwd: string, staged = false): string {
  const flag = staged ? '--cached' : '';
  return git(`diff ${flag}`, cwd);
}

export function gitLog(cwd: string, count = 10): string {
  return git(`log --oneline -${count}`, cwd);
}

export function gitBranch(cwd: string): string {
  return git('branch -a', cwd);
}

export function gitCurrentBranch(cwd: string): string {
  return git('rev-parse --abbrev-ref HEAD', cwd);
}

/**
 * Generate a commit message prompt for the AI based on staged changes.
 */
export function buildCommitPrompt(cwd: string): string | null {
  if (!isGitRepo(cwd)) return null;

  const status = gitStatus(cwd);
  const stagedDiff = gitDiff(cwd, true);
  const unstagedDiff = gitDiff(cwd, false);
  const recentLog = gitLog(cwd, 5);

  if (!status && !stagedDiff && !unstagedDiff) return null;

  return `Generate a git commit for the following changes.

## Git Status
\`\`\`
${status}
\`\`\`

## Staged Changes
\`\`\`diff
${stagedDiff || '(no staged changes)'}
\`\`\`

## Unstaged Changes
\`\`\`diff
${unstagedDiff.slice(0, 5000) || '(no unstaged changes)'}
\`\`\`

## Recent Commits (for style reference)
\`\`\`
${recentLog}
\`\`\`

Instructions:
1. If there are unstaged changes, suggest which files to stage with \`git add\`
2. Write a concise commit message (imperative mood, <72 chars title)
3. Add a body if the changes are complex
4. Run the git commands to stage and commit

Follow the existing commit message style from the recent log.`;
}

/**
 * Generate a PR creation prompt based on branch diff.
 */
export function buildPRPrompt(cwd: string): string | null {
  if (!isGitRepo(cwd)) return null;

  const branch = gitCurrentBranch(cwd);
  const baseBranch = detectBaseBranch(cwd);
  const diffStat = git(`diff ${baseBranch}...HEAD --stat`, cwd);
  const log = git(`log ${baseBranch}..HEAD --oneline`, cwd);
  const diff = git(`diff ${baseBranch}...HEAD`, cwd);

  return `Create a GitHub Pull Request for branch \`${branch}\` into \`${baseBranch}\`.

## Commits
\`\`\`
${log}
\`\`\`

## Diff Summary
\`\`\`
${diffStat}
\`\`\`

## Full Diff (truncated)
\`\`\`diff
${diff.slice(0, 10000)}
\`\`\`

Instructions:
1. Write a PR title (<70 chars)
2. Write a description with: Summary (bullet points), Test Plan
3. Run: gh pr create --title "..." --body "..."
4. Return the PR URL`;
}

function detectBaseBranch(cwd: string): string {
  // First, check git symbolic-ref for origin/HEAD
  try {
    const result = git('symbolic-ref refs/remotes/origin/HEAD', cwd);
    if (result && !result.includes('Error')) {
      // Output is like "refs/remotes/origin/main"
      const parts = result.split('/');
      const branch = parts[parts.length - 1];
      if (branch) return branch;
    }
  } catch {
    // Fall through to other methods
  }

  // Fall back to checking branch list for common names
  const branches = git('branch -a', cwd);
  if (branches.includes('main')) return 'main';
  if (branches.includes('master')) return 'master';
  if (branches.includes('develop')) return 'develop';
  if (branches.includes('trunk')) return 'trunk';

  // Final fallback
  return 'main';
}

/**
 * Show formatted git info for /diff command.
 */
export function printDiff(cwd: string): void {
  if (!isGitRepo(cwd)) {
    console.log(chalk.yellow('  Not a git repository'));
    return;
  }

  const status = gitStatus(cwd);
  const staged = gitDiff(cwd, true);
  const unstaged = gitDiff(cwd, false);

  console.log(chalk.cyan('\n  Git Status:'));
  console.log(chalk.dim(status || '  (clean)'));

  if (staged) {
    console.log(chalk.cyan('\n  Staged Changes:'));
    console.log(chalk.green(staged.slice(0, 3000)));
  }
  if (unstaged) {
    console.log(chalk.cyan('\n  Unstaged Changes:'));
    console.log(chalk.yellow(unstaged.slice(0, 3000)));
  }
  console.log();
}

/**
 * Show formatted git log for /log command.
 */
export function printLog(cwd: string, count = 15): void {
  if (!isGitRepo(cwd)) {
    console.log(chalk.yellow('  Not a git repository'));
    return;
  }

  const branch = gitCurrentBranch(cwd);
  const log = git(`log --oneline --graph --decorate -${count}`, cwd);

  console.log(chalk.cyan(`\n  Branch: ${branch}`));
  console.log(chalk.dim(log));
  console.log();
}
