/**
 * Verification loop engine and checkpoint system
 * - Verification loop (/verify): Runs tests, analyzes failures, fixes code, repeats
 * - Checkpoint system (/checkpoint): Saves/restores git state
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { getConfigDir } from './config.js';

// ── Types ──────────────────────────────────────────────

export interface Checkpoint {
  id: string;
  sessionId: string;
  label?: string;
  headSha: string;
  isDirty: boolean;
  dirtyFiles: string[];
  timestamp: string;
  cwd: string;
}

export interface VerificationConfig {
  maxIterations: number;
  timeoutMs: number;
  verbose: boolean;
}

// ── Checkpoint System ──────────────────────────────────

const CHECKPOINTS_DIR = join(getConfigDir(), 'checkpoints');

function ensureCheckpointsDir(): void {
  mkdirSync(CHECKPOINTS_DIR, { recursive: true });
}

function checkpointPath(sessionId: string, checkpointId: string): string {
  return join(CHECKPOINTS_DIR, `${sessionId}__${checkpointId}.json`);
}

function generateCheckpointId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

function getGitHeadSha(cwd: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
  } catch {
    throw new Error('Not a git repository');
  }
}

function getGitDirtyFiles(cwd: string): string[] {
  try {
    const output = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
    return output ? output.split('\n').map((line) => line.slice(3)) : [];
  } catch {
    return [];
  }
}

function isGitDirty(cwd: string): boolean {
  try {
    const output = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

/**
 * Save current git state as a checkpoint
 * @param sessionId - Unique session identifier
 * @param cwd - Working directory to checkpoint
 * @param label - Optional label for the checkpoint
 * @returns Checkpoint metadata
 */
export function saveCheckpoint(sessionId: string, cwd: string, label?: string): Checkpoint {
  ensureCheckpointsDir();

  const checkpointId = generateCheckpointId();
  const headSha = getGitHeadSha(cwd);
  const isDirty = isGitDirty(cwd);
  const dirtyFiles = getGitDirtyFiles(cwd);

  const checkpoint: Checkpoint = {
    id: checkpointId,
    sessionId,
    label,
    headSha,
    isDirty,
    dirtyFiles,
    timestamp: new Date().toISOString(),
    cwd,
  };

  const path = checkpointPath(sessionId, checkpointId);
  writeFileSync(path, JSON.stringify(checkpoint, null, 2), 'utf-8');

  return checkpoint;
}

/**
 * List all checkpoints for a session
 * @param sessionId - Session identifier
 * @returns Array of checkpoint metadata
 */
export function listCheckpoints(sessionId: string): Checkpoint[] {
  ensureCheckpointsDir();

  const files = readdirSync(CHECKPOINTS_DIR).filter(
    (f) => f.startsWith(`${sessionId}__`) && f.endsWith('.json')
  );

  const checkpoints: Checkpoint[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(CHECKPOINTS_DIR, file), 'utf-8');
      checkpoints.push(JSON.parse(raw));
    } catch {
      // skip corrupt files
    }
  }

  return checkpoints.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Restore a checkpoint (returns instructions for restoration)
 * @param sessionId - Session identifier
 * @param checkpointId - Checkpoint identifier
 * @returns Instructions string for restoring the checkpoint
 */
export function restoreCheckpoint(sessionId: string, checkpointId: string): string {
  ensureCheckpointsDir();

  const path = checkpointPath(sessionId, checkpointId);
  if (!existsSync(path)) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  const checkpoint: Checkpoint = JSON.parse(readFileSync(path, 'utf-8'));

  // Build restoration instructions
  const instructions: string[] = [];
  instructions.push(`${chalk.bold('Checkpoint Restoration Instructions')}:`);
  instructions.push('');
  instructions.push(`Label: ${checkpoint.label || '(unlabeled)'}`);
  instructions.push(`Timestamp: ${checkpoint.timestamp}`);
  instructions.push(`HEAD SHA: ${checkpoint.headSha}`);
  instructions.push('');
  instructions.push('To restore this checkpoint, run:');
  instructions.push('');
  instructions.push(`  cd "${checkpoint.cwd}"`);
  instructions.push(`  git checkout ${checkpoint.headSha}`);

  if (checkpoint.isDirty) {
    instructions.push('');
    instructions.push('Note: This checkpoint had uncommitted changes:');
    for (const file of checkpoint.dirtyFiles) {
      instructions.push(`  - ${file}`);
    }
    instructions.push('');
    instructions.push('You may want to preserve them:');
    instructions.push('  git stash');
    instructions.push('  git checkout <your-branch>');
    instructions.push('  git stash pop');
  }

  return instructions.join('\n');
}

// ── Verification Loop ──────────────────────────────────

/**
 * Auto-detect the test command for the current project
 * @param cwd - Working directory
 * @returns Test command string
 */
export function autoDetectTestCommand(cwd: string): string {
  const checks = [
    { file: 'package.json', cmd: 'npm test' },
    { file: 'pyproject.toml', cmd: 'pytest' },
    { file: 'setup.py', cmd: 'pytest' },
    { file: 'Cargo.toml', cmd: 'cargo test' },
    { file: 'go.mod', cmd: 'go test ./...' },
    { file: 'Gemfile', cmd: 'bundle exec rake test' },
    { file: 'pom.xml', cmd: 'mvn test' },
    { file: 'build.gradle', cmd: 'gradle test' },
  ];

  for (const { file, cmd } of checks) {
    if (existsSync(join(cwd, file))) {
      return cmd;
    }
  }

  return 'npm test'; // default fallback
}

/**
 * Build a detailed verification loop prompt
 * @param cwd - Working directory
 * @param command - Optional test command (auto-detected if not provided)
 * @returns Detailed prompt string
 */
export function buildVerifyPrompt(cwd: string, command?: string): string {
  const testCmd = command || autoDetectTestCommand(cwd);

  const prompt = `You are now in verification mode. Your goal is to run tests, analyze failures, fix the code, and repeat until all tests pass.

${chalk.bold('Verification Loop Process:')}

1. ${chalk.cyan('Run the test command')}
   Execute: ${chalk.yellow(testCmd)}
   Capture all output, stderr, and exit codes

2. ${chalk.cyan('Analyze the output')}
   Look for:
   - Failed test names and error messages
   - Stack traces and assertion failures
   - Missing imports or undefined references
   - Type errors (if applicable)
   - Any other compilation/runtime errors

3. ${chalk.cyan('Fix the failing code')}
   Based on the errors:
   - Identify the root cause
   - Modify the minimal necessary code to fix the issue
   - Do NOT refactor unrelated code
   - Ensure fixes are targeted and precise

4. ${chalk.cyan('Re-run the test command')}
   Execute: ${chalk.yellow(testCmd)}
   Verify the fix resolved the issue

5. ${chalk.cyan('Repeat until success')}
   Continue the loop until either:
   - All tests pass (SUCCESS)
   - You've made 5 iterations (STOP - escalate)

${chalk.bold('Important Guidelines:')}
- ${chalk.dim('Work in:')} ${cwd}
- ${chalk.dim('Run tests with:')} ${testCmd}
- ${chalk.dim('Max iterations:')} 5 (safety limit)
- ${chalk.dim('Be systematic:')} Fix one issue at a time
- ${chalk.dim('Show progress:')} Report iteration count and current status
- ${chalk.dim('Be explicit:')} Show the exact commands you run and their output
- ${chalk.dim('Stop if stuck:')} If you can't make progress after 5 iterations, explain what you've tried and ask for help

${chalk.bold('Output Format:')}
For each iteration, clearly indicate:
- Iteration number (e.g., "Iteration 1/5")
- Test command being run
- Output/errors found
- Root cause analysis
- Fix applied
- Result of re-run

When complete, provide a summary of:
- Total iterations taken
- Issues fixed
- Final test status (PASS/FAIL)
- Any remaining concerns
`;

  return prompt;
}

/**
 * Run a verification loop (for CLI reference/testing)
 * @param cwd - Working directory
 * @param command - Test command
 * @param config - Verification configuration
 * @returns Verification result
 */
export async function runVerificationLoop(
  cwd: string,
  command: string,
  config: VerificationConfig = { maxIterations: 5, timeoutMs: 30000, verbose: false }
): Promise<{ success: boolean; iterations: number; errors: string[] }> {
  const errors: string[] = [];
  let iterations = 0;

  for (iterations = 1; iterations <= config.maxIterations; iterations++) {
    if (config.verbose) {
      console.log(`\n${chalk.blue(`Iteration ${iterations}/${config.maxIterations}`)}`);
    }

    try {
      const output = execSync(command, {
        cwd,
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: config.timeoutMs,
      });

      if (config.verbose) {
        console.log(chalk.green('All tests passed!'));
      }

      return { success: true, iterations, errors: [] };
    } catch (err) {
      const errorOutput = err instanceof Error ? err.message : String(err);
      errors.push(errorOutput);

      if (config.verbose) {
        console.log(chalk.red('Test failed'));
        console.log(chalk.dim(errorOutput.slice(0, 200) + '...'));
      }
    }
  }

  return {
    success: false,
    iterations: config.maxIterations,
    errors,
  };
}

// ── Exports ────────────────────────────────────────────

export {
  getGitHeadSha,
  getGitDirtyFiles,
  isGitDirty,
  generateCheckpointId,
  checkpointPath,
  ensureCheckpointsDir,
};
