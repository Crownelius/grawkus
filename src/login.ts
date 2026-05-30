/**
 * Login flow — authentication and session management.
 *
 * Passwords are hashed with scrypt (built-in Node.js crypto).
 * Auth tokens are persisted in ~/.grawkus/auth.json.
 *
 * Flow:
 *   1. User runs /login <email>
 *   2. CLI prompts for password (hidden input)
 *   3. System verifies password against stored hash
 *   4. On success: auth token saved, user set active
 *   5. User runs /logout to clear the token
 *   6. /whoami shows the currently authenticated user
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { getConfigDir } from './config.js';
import { getUserByEmail, setActiveUser, getUser } from './users.js';

// Hand-rolled promise wrapper for crypto.scrypt's 4-arg (options) form.
// node:util's promisify only types the 3-arg overload, which is why the
// 4-arg call sites below need this wrapper.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

const AUTH_FILE = join(getConfigDir(), 'auth.json');
const CREDENTIALS_FILE = join(getConfigDir(), 'credentials.json');

// ── Types ──────────────────────────────────────────────────

export interface AuthState {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

interface CredentialRecord {
  userId: string;
  /** scrypt hash in format "salt:hash" (both hex-encoded) */
  passwordHash: string;
  updatedAt: string;
}

interface CredentialsData {
  credentials: CredentialRecord[];
}

// ── Password hashing ──────────────────────────────────────

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 32;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N }) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scryptAsync(password, salt, expected.length, { N: SCRYPT_N }) as Buffer;

  return timingSafeEqual(derived, expected);
}

// ── Credentials store ─────────────────────────────────────

function loadCredentials(): CredentialsData {
  if (!existsSync(CREDENTIALS_FILE)) {
    return { credentials: [] };
  }
  try {
    const raw = readFileSync(CREDENTIALS_FILE, 'utf-8');
    return JSON.parse(raw) as CredentialsData;
  } catch {
    return { credentials: [] };
  }
}

function saveCredentials(data: CredentialsData): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Auth token store ──────────────────────────────────────

function loadAuthState(): AuthState | null {
  if (!existsSync(AUTH_FILE)) return null;
  try {
    const raw = readFileSync(AUTH_FILE, 'utf-8');
    const state = JSON.parse(raw) as AuthState;
    // Check expiry
    if (new Date(state.expiresAt) < new Date()) {
      clearAuthState();
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function saveAuthState(state: AuthState): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function clearAuthState(): void {
  if (existsSync(AUTH_FILE)) {
    writeFileSync(AUTH_FILE, '', 'utf-8');
  }
}

// ── Public API ─────────────────────────────────────────────

/**
 * Register a password for a user. Creates or updates the credential record.
 * Returns true on success, false if the user doesn't exist.
 */
export async function registerPassword(userId: string, password: string): Promise<boolean> {
  const user = getUser(userId);
  if (!user) return false;

  const data = loadCredentials();
  const hash = await hashPassword(password);
  const idx = data.credentials.findIndex((c) => c.userId === userId);

  if (idx === -1) {
    data.credentials.push({
      userId,
      passwordHash: hash,
      updatedAt: new Date().toISOString(),
    });
  } else {
    data.credentials[idx].passwordHash = hash;
    data.credentials[idx].updatedAt = new Date().toISOString();
  }

  saveCredentials(data);
  return true;
}

/**
 * Authenticate a user by email and password.
 * On success, creates an auth token, sets the user active, and returns the AuthState.
 * On failure, returns null.
 */
export async function login(email: string, password: string): Promise<AuthState | null> {
  const user = getUserByEmail(email);
  if (!user) return null;

  const data = loadCredentials();
  const cred = data.credentials.find((c) => c.userId === user.id);
  if (!cred) return null;

  const valid = await verifyPassword(password, cred.passwordHash);
  if (!valid) return null;

  // Create auth token (valid for 24 hours)
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const state: AuthState = {
    token: randomBytes(32).toString('hex'),
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };

  saveAuthState(state);
  setActiveUser(user.id);
  return state;
}

/**
 * Log out the current user. Clears the auth token.
 */
export function logout(): void {
  clearAuthState();
}

/**
 * Get the currently authenticated user (from the auth token).
 * Returns null if not authenticated or token expired.
 */
export function getAuthenticatedUser(): { userId: string; token: string } | null {
  const state = loadAuthState();
  if (!state) return null;

  const user = getUser(state.userId);
  if (!user) {
    clearAuthState();
    return null;
  }

  return { userId: state.userId, token: state.token };
}

/**
 * Check whether a user has a password set.
 */
export function hasPassword(userId: string): boolean {
  const data = loadCredentials();
  return data.credentials.some((c) => c.userId === userId);
}

/**
 * Delete a user's credential record.
 */
export function deleteCredentials(userId: string): boolean {
  const data = loadCredentials();
  const idx = data.credentials.findIndex((c) => c.userId === userId);
  if (idx === -1) return false;
  data.credentials.splice(idx, 1);
  saveCredentials(data);
  return true;
}
