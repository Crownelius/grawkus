import { GrawkusCLI } from './cli.js';
import { ConfigPage } from './config-page.js';
import { UsersPage } from './users-page.js';

/**
 * Shared test utilities for login flow E2E tests.
 */
export async function createFreshCLI(options: { cwd?: string } = {}): Promise<{
  cli: GrawkusCLI;
  config: ConfigPage;
  users: UsersPage;
}> {
  const cli = new GrawkusCLI({ cwd: options.cwd });
  const config = new ConfigPage(cli);
  const users = new UsersPage(cli);

  return { cli, config, users };
}

/**
 * Assert that a config file contains expected fields.
 */
export function assertConfigHas(
  config: Record<string, unknown>,
  expectations: Record<string, unknown>,
): void {
  for (const [key, expected] of Object.entries(expectations)) {
    if (expected === undefined) {
      // Field should not exist
      if (key in config) {
        throw new Error(`Expected field "${key}" to be undefined, got: ${JSON.stringify(config[key])}`);
      }
    } else if (config[key] !== expected) {
      throw new Error(
        `Config field "${key}" mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(config[key])}`,
      );
    }
  }
}

/**
 * Assert that the output contains a substring (case-insensitive).
 */
export function assertOutputContains(output: string, substring: string): void {
  if (!output.toLowerCase().includes(substring.toLowerCase())) {
    throw new Error(`Expected output to contain "${substring}", but got:\n${output}`);
  }
}

/**
 * Assert that the output does NOT contain a substring (case-insensitive).
 */
export function assertOutputNotContains(output: string, substring: string): void {
  if (output.toLowerCase().includes(substring.toLowerCase())) {
    throw new Error(`Expected output NOT to contain "${substring}", but it did:\n${output}`);
  }
}

/**
 * Assert that a user exists in the users.json with expected fields.
 */
export function assertUserExists(
  usersData: Record<string, unknown>,
  expectations: { name?: string; email?: string; role?: string; active?: boolean },
): string {
  const users = (usersData as { users: unknown[] })?.users as Record<string, unknown>[] | undefined;
  if (!users || users.length === 0) {
    throw new Error('No users found in users.json');
  }

  for (const user of users) {
    let match = true;
    for (const [key, expected] of Object.entries(expectations)) {
      if (user[key] !== expected) {
        match = false;
        break;
      }
    }
    if (match) {
      return user.id as string;
    }
  }

  throw new Error(
    `No user found matching ${JSON.stringify(expectations)} in ${JSON.stringify(users)}`,
  );
}