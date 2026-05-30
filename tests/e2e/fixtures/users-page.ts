import { GrawkusCLI } from './cli.js';

/**
 * User Page Object — encapsulates all user management operations.
 * Maps to the /users slash command and the users.json file.
 */
export class UsersPage {
  private cli: GrawkusCLI;

  constructor(cli: GrawkusCLI) {
    this.cli = cli;
  }

  /**
   * List all users via /users ls command.
   */
  async listUsers(): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    const before = this.cli.stdout.length;
    this.cli.process.stdin.write('/users ls\n');
    await this.cli.waitForOutput(/No users defined|active|inactive/i, { timeout: 5_000 });
    return this.cli.stdoutSince(before);
  }

  /**
   * Add a new user via /users add <name> [email] [role].
   */
  async addUser(name: string, email?: string, role?: string): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    const before = this.cli.stdout.length;
    const args = [name, email, role].filter(Boolean).join(' ');
    this.cli.process.stdin.write(`/users add ${args}\n`);
    await this.cli.waitForOutput(/User created/i, { timeout: 5_000 });
    return this.cli.stdoutSince(before);
  }

  /**
   * Activate/set a user as active via /users set <id>.
   */
  async setActiveUser(userId: string): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    const before = this.cli.stdout.length;
    this.cli.process.stdin.write(`/users set ${userId}\n`);
    await this.cli.waitForOutput(/Active user|not found/i, { timeout: 5_000 });
    return this.cli.stdoutSince(before);
  }

  /**
   * Delete a user via /users rm <id>.
   */
  async deleteUser(userId: string): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    const before = this.cli.stdout.length;
    this.cli.process.stdin.write(`/users rm ${userId}\n`);
    await this.cli.waitForOutput(/User deleted|not found/i, { timeout: 5_000 });
    return this.cli.stdoutSince(before);
  }

  /**
   * Set user metadata via /users meta <id> <key> [value].
   */
  async setMetadata(userId: string, key: string, value?: string): Promise<string> {
    if (!this.cli.process) throw new Error('CLI not spawned');
    const before = this.cli.stdout.length;
    const args = value ? `${userId} ${key} ${value}` : `${userId} ${key}`;
    this.cli.process.stdin.write(`/users meta ${args}\n`);
    await this.cli.waitForOutput(/Metadata set|:/i, { timeout: 5_000 });
    return this.cli.stdoutSince(before);
  }

  /**
   * Read the users.json file directly.
   */
  readUsersFile(): Record<string, unknown> | null {
    return this.cli.readUsers();
  }

  /**
   * Extract user IDs from the user list output.
   */
  async getUserIds(): Promise<string[]> {
    const output = await this.listUsers();
    const ids: string[] = [];
    // Parse lines like "  abcdef12  Name ..."
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s{2}([a-f0-9-]{8,})/);
      if (match) {
        ids.push(match[1]);
      }
    }
    return ids;
  }
}