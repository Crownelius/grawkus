import { GrawkusCLI } from './cli.js';

/**
 * Login Page Object — encapsulates the setup wizard / login flow.
 *
 * The "login" for Grawkus is the first-run setup wizard that walks the
 * user through: provider selection → API key → model → permission mode.
 * This page object drives that flow programmatically via stdin/stdout.
 */
export class LoginPage {
  private cli: GrawkusCLI;

  constructor(cli: GrawkusCLI) {
    this.cli = cli;
  }

  // ── Provider Selection ──────────────────────────────

  /**
   * Wait for the provider selection prompt.
   */
  async waitForProviderPrompt(): Promise<void> {
    await this.cli.waitForOutput(/Choose a provider/i, { timeout: 10_000 });
  }

  /**
   * Select a provider by index (1-based, matching the wizard display).
   */
  async selectProvider(index: number): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    const before = this.cli.stdout.length;
    this.cli.process.stdin.write(`${index}\n`);
    await this.cli.waitForOutput(/API Key|Base URL|Model|Permission/i, { timeout: 5_000 });
    return this.cli.stdoutSince(before);
  }

  /**
   * Select a provider by key (e.g. 'openrouter', 'ollama', 'custom').
   * Resolves the index from the PROVIDERS ordering.
   */
  async selectProviderByKey(key: string): Promise<string> {
    const providerKeys = [
      'anthropic', 'openai', 'openai-codex', 'openrouter', 'google',
      'deepseek', 'ollama', 'lmstudio', 'glm', 'nvidia', 'custom',
    ];
    const idx = providerKeys.indexOf(key.toLowerCase());
    if (idx === -1) throw new Error(`Unknown provider key: ${key}`);
    return this.selectProvider(idx + 1);
  }

  // ── API Key ─────────────────────────────────────────

  /**
   * Wait for the API key prompt and enter a key.
   */
  async enterApiKey(key: string): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    await this.cli.waitForOutput(/API Key for/i, { timeout: 5_000 });
    const before = this.cli.stdout.length;
    this.cli.process.stdin.write(`${key}\n`);
    await this.cli.waitForOutput(/Model|Permission/i, { timeout: 5_000 });
    return this.cli.stdoutSince(before);
  }

  /**
   * Enter a custom base URL (for the 'custom' provider).
   */
  async enterBaseURL(url: string): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    await this.cli.waitForOutput(/Base URL/i, { timeout: 5_000 });
    const before = this.cli.stdout.length;
    this.cli.process.stdin.write(`${url}\n`);
    await this.cli.waitForOutput(/API Key|Model/i, { timeout: 5_000 });
    return this.cli.stdoutSince(before);
  }

  // ── Model ───────────────────────────────────────────

  /**
   * Wait for the model prompt and enter a model name.
   */
  async enterModel(model: string): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    await this.cli.waitForOutput(/Model.*\[/i, { timeout: 5_000 });
    const before = this.cli.stdout.length;
    this.cli.process.stdin.write(`${model}\n`);
    await this.cli.waitForOutput(/Permission mode|ask.*auto.*yolo/i, { timeout: 5_000 });
    return this.cli.stdoutSince(before);
  }

  /**
   * Accept the default model (press Enter at the model prompt).
   */
  async acceptDefaultModel(): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    await this.cli.waitForOutput(/Model.*\[/i, { timeout: 5_000 });
    const before = this.cli.stdout.length;
    this.cli.process.stdin.write('\n');
    await this.cli.waitForOutput(/Permission mode|ask.*auto.*yolo/i, { timeout: 5_000 });
    return this.cli.stdoutSince(before);
  }

  // ── Permission Mode ─────────────────────────────────

  /**
   * Select a permission mode by index (1=ask, 2=auto, 3=yolo).
   */
  async selectPermissionMode(index: number): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    await this.cli.waitForOutput(/Permission mode|ask.*auto.*yolo/i, { timeout: 5_000 });
    const before = this.cli.stdout.length;
    this.cli.process.stdin.write(`${index}\n`);
    await this.cli.waitForOutput(/MemPalace memory|Enable MemPalace/i, { timeout: 5_000 });
    this.cli.process.stdin.write('1\n');
    await this.cli.waitForOutput(/Config saved/i, { timeout: 5_000 });
    return this.cli.stdoutSince(before);
  }

  /**
   * Select a permission mode by name.
   */
  async selectPermissionModeByName(mode: 'ask' | 'auto' | 'yolo'): Promise<string> {
    const idx = ['ask', 'auto', 'yolo'].indexOf(mode);
    if (idx === -1) throw new Error(`Unknown permission mode: ${mode}`);
    return this.selectPermissionMode(idx + 1);
  }

  // ── Full Wizard ─────────────────────────────────────

  /**
   * Run the complete setup wizard with the given parameters.
   * This is the "happy path" login flow.
   */
  async completeSetup(params?: {
    providerKey?: string;
    providerIndex?: number;
    apiKey?: string;
    customBaseURL?: string;
    model?: string;
    useDefaultModel?: boolean;
    permissionMode?: 'ask' | 'auto' | 'yolo';
    permissionIndex?: number;
  }): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');

    const fullOutput: string[] = [];

    // Step 1: Provider selection
    await this.waitForProviderPrompt();
    const pIdx = params?.providerIndex ?? this.providerKeyToIndex(params?.providerKey) + 1;
    const providerOutput = await this.selectProvider(pIdx);
    fullOutput.push(providerOutput);

    // Step 2: API key (if required by the provider)
    const providerKeys = [
      'anthropic', 'openai', 'openai-codex', 'openrouter', 'google',
      'deepseek', 'ollama', 'lmstudio', 'glm', 'nvidia', 'custom',
    ];
    const selectedKey = providerKeys[pIdx - 1];
    const requiresKey = !['openai-codex', 'ollama', 'lmstudio'].includes(selectedKey);

    if (requiresKey) {
      if (selectedKey === 'custom' && params?.customBaseURL) {
        const urlOutput = await this.enterBaseURL(params.customBaseURL);
        fullOutput.push(urlOutput);
      }
      const keyOutput = await this.enterApiKey(params?.apiKey ?? 'test-api-key-12345');
      fullOutput.push(keyOutput);
    }

    // Step 3: Model
    let modelOutput: string;
    if (params?.useDefaultModel) {
      modelOutput = await this.acceptDefaultModel();
    } else {
      modelOutput = await this.enterModel(params?.model ?? 'test-model');
    }
    fullOutput.push(modelOutput);

    // Step 4: Permission mode
    let permOutput: string;
    if (params?.permissionMode) {
      permOutput = await this.selectPermissionModeByName(params.permissionMode);
    } else if (params?.permissionIndex) {
      permOutput = await this.selectPermissionMode(params.permissionIndex);
    } else {
      permOutput = await this.selectPermissionModeByName('ask');
    }
    fullOutput.push(permOutput);

    return fullOutput.join('\n');
  }

  // ── Reconfig (/config command) ──────────────────────

  /**
   * Trigger the reconfiguration flow via /config command.
   * Works when a config already exists.
   */
  async triggerReconfig(): Promise<void> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    this.cli.process.stdin.write('/config\n');
    await this.cli.waitForOutput(/Choose a provider/i, { timeout: 5_000 });
  }

  // ── State Checks ────────────────────────────────────

  /**
   * Check if the CLI is currently showing the setup wizard.
   */
  async isShowingWizard(): Promise<boolean> {
    return /Choose a provider/i.test(this.cli.stdout);
  }

  /**
   * Check if the CLI has completed setup and is showing the main prompt.
   */
  async isShowingMainPrompt(): Promise<boolean> {
    return /grawkus|▶|session/i.test(this.cli.stdout);
  }

  /**
   * Check if the "Config saved" confirmation appeared.
   */
  async sawConfigSaved(): Promise<boolean> {
    return /Config saved/i.test(this.cli.stdout);
  }

  // ── Helpers ─────────────────────────────────────────

  private providerKeyToIndex(key?: string): number {
    if (!key) return 3; // default to openrouter (index 3)
    const providerKeys = [
      'anthropic', 'openai', 'openai-codex', 'openrouter', 'google',
      'deepseek', 'ollama', 'lmstudio', 'glm', 'nvidia', 'custom',
    ];
    const idx = providerKeys.indexOf(key.toLowerCase());
    return idx >= 0 ? idx : 2;
  }
}
