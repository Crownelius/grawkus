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
const MAX_VERIFIER_COMMANDS = 6;
const VERIFICATION_FALLBACK_NOTICE = 'Failure detected; advancing to next verifier command in deterministic stack.';

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
  return buildVerifierStack(cwd)[0] || 'npm test';
}

function pushVerifierCommand(commands: string[], command: string): void {
  const normalized = command.trim();
  if (!normalized) return;
  if (commands.includes(normalized)) return;
  commands.push(normalized);
}

function readTextSafe(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

function pushIfScript(commands: string[], scripts: Record<string, unknown>, key: string, command: string): void {
  const script = scripts[key];
  if (typeof script === 'string' && script.trim()) {
    pushVerifierCommand(commands, command);
  }
}

function pushIfRegexMatch(commands: string[], content: string, pattern: RegExp, command: string): void {
  if (pattern.test(content)) {
    pushVerifierCommand(commands, command);
  }
}

function extractCommandOutput(error: unknown): string {
  if (!error) return '';

  const err = error as {
    stdout?: unknown;
    stderr?: unknown;
    message?: unknown;
  };

  const outputParts = [
    typeof err.stdout === 'string' ? err.stdout : err.stdout instanceof Buffer ? err.stdout.toString('utf-8') : '',
    typeof err.stderr === 'string' ? err.stderr : err.stderr instanceof Buffer ? err.stderr.toString('utf-8') : '',
  ];

  const message = typeof err.message === 'string' ? err.message : String(error);
  if (message && !outputParts.some((part) => part.includes(message))) {
    outputParts.push(message);
  }

  return outputParts.map((part) => part.trim()).filter(Boolean).join('\n');
}

function runVerifierCommand(cwd: string, command: string, timeoutMs: number): string {
  return execSync(command, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: timeoutMs,
  });
}

/**
 * Build a bounded stack of likely verification commands for the current project.
 * The first command is treated as primary; the rest are alternatives.
 */
export function buildVerifierStack(cwd: string): string[] {
  const commands: string[] = [];

  if (existsSync(join(cwd, 'package.json'))) {
    pushVerifierCommand(commands, 'npm test');
    try {
      const packageJson = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
      const scripts = packageJson?.scripts || {};
      // Common validation script families used in JS/TS ecosystems.
      pushIfScript(commands, scripts, 'verify', 'npm run verify');
      pushIfScript(commands, scripts, 'test', 'npm run test');
      pushIfScript(commands, scripts, 'lint', 'npm run lint');
      pushIfScript(commands, scripts, 'lint:fix', 'npm run lint:fix');
      pushIfScript(commands, scripts, 'typecheck', 'npm run typecheck');
      pushIfScript(commands, scripts, 'type-check', 'npm run type-check');
      pushIfScript(commands, scripts, 'typecheck:ci', 'npm run typecheck:ci');
      pushIfScript(commands, scripts, 'security', 'npm run security');
      pushIfScript(commands, scripts, 'check', 'npm run check');
      pushIfScript(commands, scripts, 'fmt', 'npm run fmt');
    } catch {
      // Ignore malformed package.json for command discovery.
    }
  }

  if (existsSync(join(cwd, 'pyproject.toml'))) {
    pushVerifierCommand(commands, 'pytest');
    const content = readTextSafe(join(cwd, 'pyproject.toml'));
    pushIfRegexMatch(commands, content, /^\[tool\.pytest\]/m, 'pytest');
    pushIfRegexMatch(commands, content, /^\[tool\.ruff\]/m, 'ruff check .');
    pushIfRegexMatch(commands, content, /^\[tool\.mypy\]/m, 'mypy .');
    pushIfRegexMatch(commands, content, /^\[tool\.flake8\]/m, 'flake8 .');
  }

  if (existsSync(join(cwd, 'setup.py'))) {
    pushVerifierCommand(commands, 'pytest');
  }

  if (existsSync(join(cwd, 'Cargo.toml'))) {
    pushVerifierCommand(commands, 'cargo test');
    const content = readTextSafe(join(cwd, 'Cargo.toml'));
    pushIfRegexMatch(commands, content, /\[features\]/m, 'cargo clippy --all-features');
    pushIfRegexMatch(commands, content, /clippy/m, 'cargo clippy --all-targets --all-features -- -D warnings');
  }

  if (existsSync(join(cwd, 'go.mod'))) {
    pushVerifierCommand(commands, 'go test ./...');
    if (existsSync(join(cwd, '.golangci.yml')) || existsSync(join(cwd, '.golangci.yaml')) || existsSync(join(cwd, '.golangci.toml'))) {
      pushVerifierCommand(commands, 'golangci-lint run ./...');
    }
  }

  if (existsSync(join(cwd, 'requirements.txt')) || existsSync(join(cwd, 'tox.ini')) || existsSync(join(cwd, 'pyproject.toml'))) {
    const requirementText = existsSync(join(cwd, 'pyproject.toml'))
      ? readTextSafe(join(cwd, 'pyproject.toml'))
      : '';
    if (requirementText && (/\[tool\.bandit\]/m.test(requirementText) || /\[project\]\n[\s\S]*?dependencies/m.test(requirementText))) {
      // Keep bandit optional: if this project declares dependency metadata with
      // security tooling intent, prefer an explicit security sweep.
      pushVerifierCommand(commands, 'bandit -r src --configfile pyproject.toml');
    }
  }

  if (existsSync(join(cwd, 'Gemfile'))) {
    pushVerifierCommand(commands, 'bundle exec rake test');
    pushVerifierCommand(commands, 'bundle exec rake');
  }

  if (existsSync(join(cwd, 'pom.xml'))) {
    pushVerifierCommand(commands, 'mvn test');
  }

  if (existsSync(join(cwd, 'build.gradle'))) {
    pushVerifierCommand(commands, 'gradle test');
  }

  const makefilePath = join(cwd, 'Makefile');
  if (existsSync(makefilePath)) {
    try {
      const makefileContent = readFileSync(makefilePath, 'utf-8');
      const makefileTargets: Array<{ re: RegExp; cmd: string }> = [
        { re: /(^|\n)\s*verify\s*:/m, cmd: 'make verify' },
        { re: /(^|\n)\s*test\s*:/m, cmd: 'make test' },
        { re: /(^|\n)\s*check\s*:/m, cmd: 'make check' },
        { re: /(^|\n)\s*lint\s*:/m, cmd: 'make lint' },
        { re: /(^|\n)\s*fmt\s*:/m, cmd: 'make fmt' },
        { re: /(^|\n)\s*format\s*:/m, cmd: 'make format' },
        { re: /(^|\n)\s*typecheck\s*:/m, cmd: 'make typecheck' },
        { re: /(^|\n)\s*security\s*:/m, cmd: 'make security' },
      ];
      for (const target of makefileTargets) {
        if (target.re.test(makefileContent)) {
          pushVerifierCommand(commands, target.cmd);
        }
      }
    } catch {
      // Ignore makefile read failures.
    }
  }

  if (commands.length === 0) {
    pushVerifierCommand(commands, 'npm test');
  }

  return commands.slice(0, MAX_VERIFIER_COMMANDS);
}

/**
 * Legacy alias for auto-detected verification command list.
 */
export function autoDetectVerifierCommands(cwd: string): string[] {
  return buildVerifierStack(cwd);
}

/**
 * Build a detailed verification loop prompt
 * @param cwd - Working directory
 * @param command - Optional test command (auto-detected if not provided)
 * @returns Detailed prompt string
 */
export function buildVerifyPrompt(cwd: string, command?: string): string {
  const commands = command ? [command] : autoDetectVerifierCommands(cwd);
  const testCmd = commands[0] || autoDetectTestCommand(cwd);
  const alternatives = commands.slice(1);
  const alternativeBlock = alternatives.length > 0
    ? `\n${chalk.bold('Alternative verification commands:')}\n${alternatives.map((cmd) => `- ${chalk.yellow(cmd)}`).join('\n')}`
    : '';

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
- ${chalk.dim('Command stack:')} ${commands.join(' | ')}
- ${chalk.dim('Max iterations:')} 5 (safety limit)
- ${chalk.dim('Fallback behavior:')} On failure, move to the next command in the stack before re-running.
- ${chalk.dim('Be systematic:')} Fix one issue at a time
- ${chalk.dim('Show progress:')} Report iteration count and current status
- ${chalk.dim('Be explicit:')} Show the exact commands you run and their output
- ${chalk.dim('Stop if stuck:')} If you can't make progress after 5 iterations, explain what you've tried and ask for help

${chalk.bold('Output Format:')}
For each iteration, clearly indicate:
- Iteration number (e.g., "Iteration 1/5")
- Test command being run
- ${chalk.dim('Current command stack:')} ${commands.join(' > ')}
- Output/errors found
- Root cause analysis
- Fix applied
- Result of re-run
${alternativeBlock}

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
  commandOrStack: string | string[],
  config: VerificationConfig = { maxIterations: 5, timeoutMs: 30000, verbose: false }
): Promise<{ success: boolean; iterations: number; errors: string[] }> {
  const commandStack = Array.isArray(commandOrStack)
    ? commandOrStack.filter((command) => command.trim().length > 0)
    : [commandOrStack];
  const stack = commandStack.length > 0 ? commandStack : autoDetectVerifierCommands(cwd);
  const normalizedStack = stack.length > 0 ? stack : [autoDetectTestCommand(cwd)];
  let stackIndex = 0;
  const errors: string[] = [];
  let iterations = 0;

  for (iterations = 1; iterations <= config.maxIterations; iterations++) {
    if (config.verbose) {
      console.log(`\n${chalk.blue(`Iteration ${iterations}/${config.maxIterations}`)}`);
    }

    const command = normalizedStack[Math.min(stackIndex, normalizedStack.length - 1)];
    if (config.verbose) {
      console.log(chalk.dim(`Command: ${command}`));
      if (stackIndex > 0) {
        console.log(chalk.dim(`Using fallback tier ${stackIndex + 1}/${normalizedStack.length}`));
      }
    }

    try {
      runVerifierCommand(cwd, command, config.timeoutMs);

      if (config.verbose) {
        console.log(chalk.green('All tests passed!'));
      }

      return { success: true, iterations, errors };
    } catch (err) {
      const errorOutput = extractCommandOutput(err);
      const suffix = errorOutput ? `\n${errorOutput}` : '';
      const prefix = `Iteration ${iterations} failed using: ${command}`;
      const contextualOutput = stackIndex + 1 < normalizedStack.length
        ? `${prefix}: ${VERIFICATION_FALLBACK_NOTICE}${suffix}`
        : `${prefix}${suffix}`;
      errors.push(contextualOutput);
      const loggedOutput = contextualOutput;
      if (config.verbose) {
        console.log(chalk.red('Test failed'));
        console.log(chalk.dim(loggedOutput.slice(0, 200) + '...'));
      }

      if (stackIndex + 1 < normalizedStack.length) {
        stackIndex += 1;
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
