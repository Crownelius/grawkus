import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

/**
 * CLI Page Object — encapsulates spawning, interacting with, and asserting
 * on the Grawkus CLI process. Mirrors the Page Object Model pattern used
 * in browser E2E tests but adapted for a REPL-based CLI application.
 */
export class GrawkusCLI {
  private _proc: ChildProcessWithoutNullStreams | null = null;
  private _configDir: string;
  private cwd: string;

  // Output accumulators
  private _stdout = '';
  private _stderr = '';

  constructor(options: { configDir?: string; cwd?: string } = {}) {
    this._configDir = options.configDir || this.createTempConfigDir();
    this.cwd = options.cwd || process.cwd();
  }

  /**
   * Create an isolated temp config directory (like the existing smoke tests do).
   */
  private createTempConfigDir(): string {
    const dir = join(tmpdir(), `grawkus-e2e-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Get the path to the config file.
   */
  get configPath(): string {
    return join(this._configDir, 'config.json');
  }

  /**
   * Get the path to the users file.
   */
  get usersPath(): string {
    return join(this._configDir, 'users.json');
  }

  /**
   * Get the path to the sessions directory.
   */
  get sessionsDir(): string {
    return join(this._configDir, 'sessions');
  }

  /**
   * Expose the spawned process for page objects that need stdin access.
   */
  get process(): ChildProcessWithoutNullStreams | null {
    return this._proc;
  }

  /**
   * Expose the config directory for page objects that need filesystem access.
   */
  get configDir(): string {
    return this._configDir;
  }

  /**
   * Spawn the CLI process with a clean environment.
   */
  async spawn(extraEnv: Record<string, string> = {}): Promise<void> {
    const binPath = join(process.cwd(), 'bin', 'grawkus.js');

    this._proc = spawn('node', [binPath], {
      cwd: this.cwd,
      env: {
        ...process.env,
        GRAWKUS_HOME: this._configDir,
        NODE_OPTIONS: '--no-deprecation',
        ...extraEnv,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Accumulate output for assertions
    this._proc.stdout.on('data', (data) => {
      this._stdout += data.toString();
    });
    this._proc.stderr.on('data', (data) => {
      this._stderr += data.toString();
    });

    // Wait for initial prompt
    await this.waitForOutput(/grawkus|setup|Choose a provider/i, { timeout: 10_000 });
  }

  /**
   * Send input to the CLI and wait for the response.
   */
  async send(input: string, waitForPrompt: boolean = true): Promise<string> {
    if (!this._proc) throw new Error('CLI not spawned');

    const before = this._stdout.length;

    this._proc.stdin.write(input + '\n');

    if (waitForPrompt) {
      await this.waitForOutput(/▶|grawkus|Choice|API Key|Model|Permission|Theme|command/i, { timeout: 5_000 });
    }

    return this.stdoutSince(before);
  }

  /**
   * Get stdout content since a given length.
   */
  stdoutSince(startLen: number): string {
    return this._stdout.slice(startLen);
  }

  /**
   * Get all accumulated stdout.
   */
  get stdout(): string {
    return this._stdout;
  }

  /**
   * Reset the stdout accumulator — useful when page objects need to isolate
   * the output of a single command from prior banner/wizard output.
   */
  clearStdout(): void {
    this._stdout = '';
  }

  /**
   * Get all accumulated stderr.
   */
  get stderr(): string {
    return this._stderr;
  }

  /**
   * Wait for a specific pattern in stdout.
   */
  async waitForOutput(
    pattern: RegExp | string,
    options: { timeout?: number; interval?: number } = {},
  ): Promise<boolean> {
    const { timeout = 15_000, interval = 100 } = options;
    const regex = pattern instanceof RegExp ? pattern : new RegExp(escapeRegex(pattern));
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (regex.test(this._stdout)) return true;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    return false;
  }

  /**
   * Wait for the process to exit.
   */
  async waitForExit(options: { timeout?: number } = {}): Promise<number> {
    const { timeout = 10_000 } = options;
    return new Promise((resolve, reject) => {
      if (!this._proc) {
        reject(new Error('CLI not spawned'));
        return;
      }
      const timer = setTimeout(() => reject(new Error('Timed out waiting for exit')), timeout);
      this._proc.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code ?? -1);
      });
    });
  }

  /**
   * Send /exit or /quit to gracefully close the CLI.
   */
  async exit(): Promise<void> {
    if (!this._proc) return;
    try {
      this._proc.stdin.write('/exit\n');
      await this.waitForExit({ timeout: 5_000 });
    } catch {
      this._proc.kill();
    }
  }

  /**
   * Force-kill the process.
   */
  kill(): void {
    if (this._proc) {
      this._proc.kill();
      this._proc = null;
    }
  }

  /**
   * Read the current config file.
   */
  readConfig(): Record<string, unknown> | null {
    if (!existsSync(this.configPath)) return null;
    return JSON.parse(readFileSync(this.configPath, 'utf-8'));
  }

  /**
   * Read the current users file.
   */
  readUsers(): Record<string, unknown> | null {
    if (!existsSync(this.usersPath)) return null;
    return JSON.parse(readFileSync(this.usersPath, 'utf-8'));
  }

  /**
   * Write a config file directly (simulates pre-existing config).
   */
  writeConfig(config: Record<string, unknown>): void {
    mkdirSync(this._configDir, { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Check if config file exists.
   */
  configExists(): boolean {
    return existsSync(this.configPath);
  }

  /**
   * Clean up temp resources.
   */
  cleanup(): void {
    this.kill();
    try {
      rmSync(this._configDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Run the complete setup wizard programmatically.
   * Returns the sequence of outputs for assertion.
   */
  async runSetupWizard({
    providerIndex = 0,
    apiKey = 'test-api-key-12345',
    model = 'test-model',
    permissionMode = 'ask' as 'ask' | 'auto' | 'yolo',
  }: {
    providerIndex?: number;
    apiKey?: string;
    model?: string;
    permissionMode?: 'ask' | 'auto' | 'yolo';
  } = {}): Promise<string> {
    if (!this._proc) throw new Error('CLI not spawned');

    // Wait for provider prompt
    await this.waitForOutput('Choose a provider');

    // Select provider
    this._proc.stdin.write(`${providerIndex + 1}\n`);
    await this.waitForOutput(/API Key|Base URL|Model/i, { timeout: 5_000 });

    // Enter API key (if prompted)
    const apiKeyPattern = /API Key for/i;
    if (apiKeyPattern.test(this._stdout)) {
      this._proc.stdin.write(`${apiKey}\n`);
    }

    // Wait for model prompt and enter model
    await this.waitForOutput(/Model.*\[/i, { timeout: 5_000 });
    this._proc.stdin.write(`${model}\n`);

    // Wait for permission mode prompt
    await this.waitForOutput(/Permission mode|ask.*auto.*yolo/i, { timeout: 5_000 });
    const permIndex = ['ask', 'auto', 'yolo'].indexOf(permissionMode);
    this._proc.stdin.write(`${permIndex + 1}\n`);

    // Keep the setup path explicit now that MemPalace is a first-run choice.
    await this.waitForOutput(/MemPalace memory|Enable MemPalace/i, { timeout: 5_000 });
    this._proc.stdin.write('1\n');

    // Wait for config saved confirmation
    await this.waitForOutput(/Config saved/i, { timeout: 5_000 });

    return this._stdout;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
