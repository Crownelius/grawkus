import { GrawkusCLI } from './cli.js';

/**
 * Config Page Object — encapsulates all configuration/login operations.
 * Maps to the setup wizard (/config command) and config file state.
 */
export class ConfigPage {
  private cli: GrawkusCLI;

  constructor(cli: GrawkusCLI) {
    this.cli = cli;
  }

  /**
   * Get the current config from the file system.
   */
  getConfig(): Record<string, unknown> | null {
    return this.cli.readConfig();
  }

  /**
   * Check if a valid config exists (API key present or local provider).
   */
  configExists(): boolean {
    return this.cli.configExists();
  }

  /**
   * Run the full setup wizard with given parameters.
   * Simulates the happy-path login flow.
   */
  async setupWizard(params?: {
    providerIndex?: number;
    apiKey?: string;
    model?: string;
    permissionMode?: 'ask' | 'auto' | 'yolo';
  }): Promise<string> {
    return this.cli.runSetupWizard(params);
  }

  /**
   * Send the /config command to re-trigger the setup wizard.
   */
  async triggerReconfig(): Promise<void> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    this.cli.process.stdin.write('/config\n');
    await this.cli.waitForOutput('Choose a provider', { timeout: 5_000 });
  }

  /**
   * Send /provider to check current provider info.
   * Clears the stdout buffer before sending so we capture only new output.
   */
  async checkProvider(): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    // Reset stdout capture to isolate the /provider output
    this.cli.clearStdout();
    this.cli.process.stdin.write('/provider\n');
    // Wait for the API Key line which is the last line of /provider output
    await this.cli.waitForOutput(/API Key:/i, { timeout: 5_000 });
    return this.cli.stdout;
  }

  /**
   * Write a config directly to simulate pre-existing state.
   */
  seedConfig(config: Record<string, unknown>): void {
    this.cli.writeConfig(config);
  }

  /**
   * Delete the config file to simulate first-run.
   */
  deleteConfig(): void {
    const fs = require('node:fs');
    if (fs.existsSync(this.cli.configPath)) {
      fs.unlinkSync(this.cli.configPath);
    }
  }

  /**
   * Get the config directory path.
   */
  getConfigDir(): string {
    return this.cli.configDir;
  }
}
