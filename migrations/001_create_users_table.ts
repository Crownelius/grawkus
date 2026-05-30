/**
 * Migration 001 — Create users table.
 *
 * Creates the users.json store at ~/.grawkus/users.json with:
 *   - Empty users array
 *   - Null activeUserId
 *
 * This is the initial schema for the users table introduced in v1.1.0.
 * The JSON file acts as a lightweight single-file database.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../src/config.js';

export const MIGRATION_ID = '001_create_users_table';
export const MIGRATION_DESCRIPTION = 'Create users table (users.json)';

interface UsersSchema {
  version: number;
  users: unknown[];
  activeUserId: string | null;
}

function getUsersFile(): string {
  return join(getConfigDir(), 'users.json');
}

export function up(): void {
  const file = getUsersFile();
  if (existsSync(file)) {
    console.log(`  [${MIGRATION_ID}] already applied — users.json exists`);
    return;
  }
  mkdirSync(getConfigDir(), { recursive: true });
  const initial: UsersSchema = { version: 1, users: [], activeUserId: null };
  writeFileSync(file, JSON.stringify(initial, null, 2), 'utf-8');
  console.log(`  [${MIGRATION_ID}] applied — created users.json`);
}

export function down(): void {
  const file = getUsersFile();
  if (!existsSync(file)) {
    console.log(`  [${MIGRATION_ID}] nothing to roll back — users.json does not exist`);
    return;
  }
  // Rename rather than delete for safety
  const backup = file + '.bak';
  writeFileSync(backup, require('node:fs').readFileSync(file, 'utf-8'), 'utf-8');
  require('node:fs').unlinkSync(file);
  console.log(`  [${MIGRATION_ID}] rolled back — users.json moved to users.json.bak`);
}
