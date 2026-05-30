import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GrawkusConfig } from '../src/types.js';
import {
  CHATGPT_CODEX_BASE_URL,
  getOpenAICodexAuthStatus,
  resolveOpenAICodexAuth,
} from '../src/openai-oauth.js';
import { formatOpenAICodexSmokeResult, runOpenAICodexSmokeTest } from '../src/openai-smoke.js';

const envKeys = [
  'GRAWKUS_OPENAI_ACCESS_TOKEN',
  'OPENAI_CODEX_ACCESS_TOKEN',
  'CODEX_OPENAI_ACCESS_TOKEN',
  'GRAWKUS_OPENAI_ACCOUNT_ID',
  'OPENAI_CODEX_ACCOUNT_ID',
  'CODEX_OPENAI_ACCOUNT_ID',
] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function config(codexHome: string): GrawkusConfig {
  return {
    apiKey: '',
    baseURL: CHATGPT_CODEX_BASE_URL,
    model: 'gpt-5.5',
    provider: 'OpenAI Codex (OAuth)',
    openaiAuth: {
      type: 'codex_oauth',
      codexHome,
      useCodexAuthFile: true,
      chatgptBaseURL: CHATGPT_CODEX_BASE_URL,
    },
    maxTokens: 1024,
    temperature: 0.3,
    permissionMode: 'ask',
  };
}

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('OpenAI Codex OAuth helpers', () => {
  beforeEach(() => {
    for (const key of envKeys) delete process.env[key];
  });

  it('reads Codex CLI auth.json without requiring Grawkus to store tokens', () => {
    const home = mkdtempSync(join(tmpdir(), 'grawkus-codex-'));
    try {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, 'auth.json'), JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          id_token: fakeJwt({
            email: 'dev@example.test',
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'account-from-jwt',
            },
          }),
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          account_id: 'account-from-file',
        },
      }));

      const auth = resolveOpenAICodexAuth(config(home));
      expect(auth?.accessToken).toBe('access-token');
      expect(auth?.accountId).toBe('account-from-file');
      expect(auth?.email).toBe('dev@example.test');

      const status = getOpenAICodexAuthStatus(config(home));
      expect(status.available).toBe(true);
      expect(JSON.stringify(status)).not.toContain('access-token');
      expect(JSON.stringify(status)).not.toContain('refresh-token');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('supports environment-provided tokens for keyring-only Codex installs', () => {
    const home = mkdtempSync(join(tmpdir(), 'grawkus-codex-'));
    try {
      process.env.GRAWKUS_OPENAI_ACCESS_TOKEN = 'env-access-token';
      process.env.GRAWKUS_OPENAI_ACCOUNT_ID = 'env-account';

      const auth = resolveOpenAICodexAuth(config(home));
      expect(auth?.source).toBe('env');
      expect(auth?.accessToken).toBe('env-access-token');
      expect(auth?.accountId).toBe('env-account');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('reports missing Codex auth without throwing', () => {
    const home = mkdtempSync(join(tmpdir(), 'grawkus-codex-'));
    try {
      expect(resolveOpenAICodexAuth(config(home))).toBeNull();
      const status = getOpenAICodexAuthStatus(config(home));
      expect(status.available).toBe(false);
      expect(status.error).toContain('not found');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('OpenAI Codex OAuth smoke test', () => {
  beforeEach(() => {
    for (const key of envKeys) delete process.env[key];
  });

  it('uses Codex OAuth config and validates streamed text without exposing tokens', async () => {
    const home = mkdtempSync(join(tmpdir(), 'grawkus-codex-'));
    try {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, 'auth.json'), JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'access-token',
          account_id: 'account-from-file',
        },
      }));

      const result = await runOpenAICodexSmokeTest(config(home), {
        stream: async function* (cfg) {
          expect(cfg.provider).toBe('OpenAI Codex (OAuth)');
          expect(cfg.baseURL).toBe(CHATGPT_CODEX_BASE_URL);
          expect(cfg.openaiAuth?.type).toBe('codex_oauth');
          yield { type: 'text' as const, content: 'OAuth smoke OK' };
          yield { type: 'done' as const, usage: { prompt: 1, completion: 2, total: 3 } };
        },
      });

      expect(result.ok).toBe(true);
      expect(result.text).toBe('OAuth smoke OK');
      const formatted = formatOpenAICodexSmokeResult(result);
      expect(formatted).toContain('PASS');
      expect(formatted).not.toContain('access-token');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('fails before request streaming when Codex auth is missing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'grawkus-codex-'));
    try {
      let called = false;
      const result = await runOpenAICodexSmokeTest(config(home), {
        stream: async function* () {
          called = true;
        },
      });

      expect(called).toBe(false);
      expect(result.ok).toBe(false);
      expect(result.phase).toBe('auth');
      expect(formatOpenAICodexSmokeResult(result)).toContain('FAIL');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
