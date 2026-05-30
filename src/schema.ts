/**
 * Schema definitions for persistent data stores.
 *
 * Each store is a JSON file under ~/.grawkus/.
 * Schema versions are tracked to support future migrations.
 */

// ── Users Table ──────────────────────────────────────────

export const USERS_TABLE_VERSION = 1;

export interface UserRow {
  id: string;                // UUID v4
  name: string;              // Display name
  email?: string;            // Optional email address
  role?: string;             // Optional role label (e.g. "admin", "developer")
  active: boolean;           // Whether this user is currently active
  createdAt: string;         // ISO 8601 timestamp
  updatedAt: string;         // ISO 8601 timestamp
  metadata: Record<string, string>;  // Arbitrary key-value pairs
}

export interface UsersTable {
  version: number;           // Schema version (USERS_TABLE_VERSION)
  users: UserRow[];
  activeUserId: string | null;
}

export function createEmptyUsersTable(): UsersTable {
  return { version: USERS_TABLE_VERSION, users: [], activeUserId: null };
}
