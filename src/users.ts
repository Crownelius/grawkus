/**
 * Users table — persistent user management.
 * Stores user data in ~/.grawkus/users.json
 *
 * Each user has a unique ID, display name, and metadata.
 * Users can be activated/deactivated, and the active user's context
 * is injected into the system prompt so the LLM knows who it's working with.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getConfigDir } from './config.js';
import { type UserRow, type UsersTable, createEmptyUsersTable } from './schema.js';

export type User = UserRow;
export type UsersData = UsersTable;

const USERS_FILE = join(getConfigDir(), 'users.json');

function defaultUsersData(): UsersData {
  return createEmptyUsersTable();
}

function loadUsers(): UsersData {
  if (!existsSync(USERS_FILE)) {
    return defaultUsersData();
  }
  try {
    const raw = readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(raw) as UsersData;
  } catch {
    return defaultUsersData();
  }
}

function saveUsers(data: UsersData): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Create a new user. Returns the created User.
 */
export function createUser(name: string, email?: string, role?: string): User {
  const data = loadUsers();
  const user: User = {
    id: randomUUID(),
    name,
    email,
    role,
    active: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  };
  data.users.push(user);
  saveUsers(data);
  return user;
}

/**
 * List all users.
 */
export function listUsers(): User[] {
  return loadUsers().users;
}

/**
 * Get a user by ID.
 */
export function getUser(id: string): User | null {
  const data = loadUsers();
  return data.users.find((u) => u.id === id) || null;
}

/**
 * Get a user by email address.
 */
export function getUserByEmail(email: string): User | null {
  const data = loadUsers();
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

/**
 * Get the currently active user.
 */
export function getActiveUser(): User | null {
  const data = loadUsers();
  if (!data.activeUserId) return null;
  return getUser(data.activeUserId);
}

/**
 * Update a user's fields. Returns the updated User or null if not found.
 */
export function updateUser(id: string, updates: Partial<Pick<User, 'name' | 'email' | 'role' | 'active' | 'metadata'>>): User | null {
  const data = loadUsers();
  const idx = data.users.findIndex((u) => u.id === id);
  if (idx === -1) return null;

  const user = data.users[idx];
  if (updates.name !== undefined) user.name = updates.name;
  if (updates.email !== undefined) user.email = updates.email;
  if (updates.role !== undefined) user.role = updates.role;
  if (updates.active !== undefined) user.active = updates.active;
  if (updates.metadata !== undefined) user.metadata = { ...user.metadata, ...updates.metadata };
  user.updatedAt = new Date().toISOString();

  // If activating this user, deactivate all others
  if (updates.active === true) {
    data.activeUserId = id;
    for (let i = 0; i < data.users.length; i++) {
      if (i !== idx) {
        data.users[i].active = false;
      }
    }
  } else if (updates.active === false && data.activeUserId === id) {
    data.activeUserId = null;
  }

  data.users[idx] = user;
  saveUsers(data);
  return user;
}

/**
 * Delete a user by ID. Returns true if deleted, false if not found.
 */
export function deleteUser(id: string): boolean {
  const data = loadUsers();
  const idx = data.users.findIndex((u) => u.id === id);
  if (idx === -1) return false;

  if (data.activeUserId === id) {
    data.activeUserId = null;
  }
  data.users.splice(idx, 1);
  saveUsers(data);
  return true;
}

/**
 * Set the active user by ID. Returns the activated User or null if not found.
 */
export function setActiveUser(id: string): User | null {
  const user = getUser(id);
  if (!user) return null;
  return updateUser(id, { active: true });
}

/**
 * Set user metadata key/value pair.
 */
export function setUserMetadata(id: string, key: string, value: string): User | null {
  const user = getUser(id);
  if (!user) return null;
  return updateUser(id, { metadata: { ...user.metadata, [key]: value } });
}

/**
 * Get a metadata value for a user.
 */
export function getUserMetadata(id: string, key: string): string | undefined {
  const user = getUser(id);
  return user?.metadata[key];
}

/**
 * Print a formatted user list to stdout.
 */
export function printUserList(): void {
  const { users, activeUserId } = loadUsers();
  if (users.length === 0) {
    console.log('  No users defined yet.');
    return;
  }

  for (const u of users) {
    const marker = u.id === activeUserId ? ' ◀ active' : '';
    const status = u.active ? '' : ' (inactive)';
    const email = u.email ? ` <${u.email}>` : '';
    const role = u.role ? ` [${u.role}]` : '';
    console.log(`  ${u.id.slice(0, 8)}  ${u.name}${email}${role}${status}${marker}`);
  }
}

/**
 * Build a context string about the active user for the system prompt.
 */
export function buildUserContext(): string {
  const user = getActiveUser();
  if (!user) return '';

  const lines = [`# Active User: ${user.name}`];
  if (user.email) lines.push(`# Email: ${user.email}`);
  if (user.role) lines.push(`# Role: ${user.role}`);

  const customKeys = Object.keys(user.metadata).filter(
    (k) => !['name', 'email', 'role'].includes(k),
  );
  for (const k of customKeys) {
    lines.push(`# ${k}: ${user.metadata[k]}`);
  }

  return lines.join('\n');
}