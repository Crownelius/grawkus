import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { GrawkusConfig } from './types.js';

export const CHATGPT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

export interface OpenAICodexAuthSnapshot {
  accessToken: string;
  accountId?: string;
  email?: string;
  codexHome: string;
  authPath?: string;
  source: 'env' | 'codex-auth-file';
  accessTokenExpiresAt?: string;
}

export interface OpenAICodexAuthStatus {
  configured: boolean;
  available: boolean;
  source?: OpenAICodexAuthSnapshot['source'];
  codexHome: string;
  authPath: string;
  authMode?: string;
  hasTokens: boolean;
  hasAccessToken: boolean;
  accessTokenExpiresAt?: string;
  accessTokenExpired: boolean;
  hasAccountId: boolean;
  accountId?: string;
  email?: string;
  error?: string;
}

interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: string;
  tokens?: {
    id_token?: string | Record<string, unknown>;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
}

export function isOpenAICodexOAuth(config: GrawkusConfig): boolean {
  return config.openaiAuth?.type === 'codex_oauth';
}

export function resolveCodexHome(config?: Pick<GrawkusConfig, 'openaiAuth'>): string {
  return (
    config?.openaiAuth?.codexHome ||
    process.env.CODEX_HOME ||
    join(homedir(), '.codex')
  );
}

export function getCodexAuthPath(config?: Pick<GrawkusConfig, 'openaiAuth'>): string {
  return join(resolveCodexHome(config), 'auth.json');
}

export function getOpenAICodexBaseURL(config: GrawkusConfig): string {
  return config.openaiAuth?.chatgptBaseURL || config.baseURL || CHATGPT_CODEX_BASE_URL;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(
      Math.ceil(parts[1].length / 4) * 4,
      '=',
    );
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function authClaimsFromIdToken(idToken: unknown): { accountId?: string; email?: string } {
  const claims =
    typeof idToken === 'string'
      ? decodeJwtPayload(idToken)
      : idToken && typeof idToken === 'object'
        ? idToken as Record<string, unknown>
        : null;
  if (!claims) return {};

  const profile = claims['https://api.openai.com/profile'];
  const auth = claims['https://api.openai.com/auth'];
  const email =
    typeof claims.email === 'string'
      ? claims.email
      : profile && typeof profile === 'object' && typeof (profile as Record<string, unknown>).email === 'string'
        ? (profile as Record<string, string>).email
        : undefined;
  const accountId =
    auth && typeof auth === 'object' && typeof (auth as Record<string, unknown>).chatgpt_account_id === 'string'
      ? (auth as Record<string, string>).chatgpt_account_id
      : undefined;

  return { accountId, email };
}

function jwtExpiresAt(jwt: string): string | undefined {
  const claims = decodeJwtPayload(jwt);
  const exp = claims && typeof claims.exp === 'number' ? claims.exp : null;
  if (!exp || !Number.isFinite(exp)) return undefined;
  return new Date(exp * 1000).toISOString();
}

function isExpiredIso(iso: string | undefined): boolean {
  return !!iso && Date.parse(iso) <= Date.now();
}

function envAuth(config?: Pick<GrawkusConfig, 'openaiAuth'>): OpenAICodexAuthSnapshot | null {
  const accessToken =
    process.env.GRAWKUS_OPENAI_ACCESS_TOKEN ||
    process.env.OPENAI_CODEX_ACCESS_TOKEN ||
    process.env.CODEX_OPENAI_ACCESS_TOKEN ||
    '';
  if (!accessToken.trim()) return null;
  const accessTokenExpiresAt = jwtExpiresAt(accessToken);
  return {
    accessToken,
    accountId:
      process.env.GRAWKUS_OPENAI_ACCOUNT_ID ||
      process.env.OPENAI_CODEX_ACCOUNT_ID ||
      process.env.CODEX_OPENAI_ACCOUNT_ID ||
      undefined,
    codexHome: resolveCodexHome(config),
    source: 'env',
    accessTokenExpiresAt,
  };
}

function parseCodexAuthFile(path: string): CodexAuthFile {
  return JSON.parse(readFileSync(path, 'utf8')) as CodexAuthFile;
}

export function resolveOpenAICodexAuth(config: GrawkusConfig): OpenAICodexAuthSnapshot | null {
  const fromEnv = envAuth(config);
  if (fromEnv) return isExpiredIso(fromEnv.accessTokenExpiresAt) ? null : fromEnv;

  const authPath = getCodexAuthPath(config);
  if (!existsSync(authPath)) return null;

  const auth = parseCodexAuthFile(authPath);
  const accessToken = auth.tokens?.access_token;
  if (!accessToken || !accessToken.trim()) return null;
  const accessTokenExpiresAt = jwtExpiresAt(accessToken);
  if (isExpiredIso(accessTokenExpiresAt)) return null;

  const idClaims = authClaimsFromIdToken(auth.tokens?.id_token);
  return {
    accessToken,
    accountId: auth.tokens?.account_id || idClaims.accountId,
    email: idClaims.email,
    codexHome: resolveCodexHome(config),
    authPath,
    source: 'codex-auth-file',
    accessTokenExpiresAt,
  };
}

export function getOpenAICodexAuthStatus(config: GrawkusConfig): OpenAICodexAuthStatus {
  const codexHome = resolveCodexHome(config);
  const authPath = getCodexAuthPath(config);
  const fromEnv = envAuth(config);
  if (fromEnv) {
    const accessTokenExpired = isExpiredIso(fromEnv.accessTokenExpiresAt);
    return {
      configured: isOpenAICodexOAuth(config),
      available: !accessTokenExpired,
      source: 'env',
      codexHome,
      authPath,
      hasTokens: true,
      hasAccessToken: true,
      accessTokenExpiresAt: fromEnv.accessTokenExpiresAt,
      accessTokenExpired,
      hasAccountId: !!fromEnv.accountId,
      accountId: fromEnv.accountId,
      email: fromEnv.email,
      error: accessTokenExpired ? 'Codex access token is expired' : undefined,
    };
  }

  if (!existsSync(authPath)) {
    return {
      configured: isOpenAICodexOAuth(config),
      available: false,
      codexHome,
      authPath,
      hasTokens: false,
      hasAccessToken: false,
      accessTokenExpired: false,
      hasAccountId: false,
      error: 'Codex auth file not found',
    };
  }

  try {
    const auth = parseCodexAuthFile(authPath);
    const idClaims = authClaimsFromIdToken(auth.tokens?.id_token);
    const accountId = auth.tokens?.account_id || idClaims.accountId;
    const accessTokenExpiresAt = auth.tokens?.access_token ? jwtExpiresAt(auth.tokens.access_token) : undefined;
    const accessTokenExpired = isExpiredIso(accessTokenExpiresAt);
    return {
      configured: isOpenAICodexOAuth(config),
      available: !!auth.tokens?.access_token && !accessTokenExpired,
      source: auth.tokens?.access_token ? 'codex-auth-file' : undefined,
      codexHome,
      authPath,
      authMode: auth.auth_mode,
      hasTokens: !!auth.tokens,
      hasAccessToken: !!auth.tokens?.access_token,
      accessTokenExpiresAt,
      accessTokenExpired,
      hasAccountId: !!accountId,
      accountId,
      email: idClaims.email,
      error: accessTokenExpired ? 'Codex access token is expired' : undefined,
    };
  } catch (err) {
    return {
      configured: isOpenAICodexOAuth(config),
      available: false,
      codexHome,
      authPath,
      hasTokens: false,
      hasAccessToken: false,
      accessTokenExpired: false,
      hasAccountId: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function openAICodexAuthInstructions(config: GrawkusConfig): string {
  const authPath = getCodexAuthPath(config);
  const status = getOpenAICodexAuthStatus(config);
  const reason = status.accessTokenExpired
    ? 'OpenAI Codex OAuth is selected, but the ChatGPT/Codex access token is expired.'
    : 'OpenAI Codex OAuth is selected, but no ChatGPT/Codex access token was found.';
  return [
    reason,
    `Run /openai-login or run "codex login" so Codex writes ${authPath}.`,
    'Grawkus reads the token at request time and does not store OAuth tokens in its own config.',
  ].join(' ');
}

export function runCodexLogin(config: GrawkusConfig): { ok: boolean; status: number | null; error?: string } {
  const result = spawnSync('codex', ['login'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CODEX_HOME: resolveCodexHome(config),
    },
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    error: result.error ? result.error.message : undefined,
  };
}
