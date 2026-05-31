import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempHome = '';
let tempCwd = '';

beforeEach(() => {
  vi.resetModules();
  tempHome = mkdtempSync(join(tmpdir(), 'grawkus-promode-consent-home-'));
  tempCwd = mkdtempSync(join(tmpdir(), 'grawkus-promode-consent-cwd-'));
  vi.stubEnv('GRAWKUS_HOME', tempHome);
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(tempCwd, { recursive: true, force: true });
});

describe('ProMode consent', () => {
  it('lists multiple activation warnings', async () => {
    const { PROMODE_ACTIVATION_WARNINGS } = await import('../src/promode/consent.js');
    expect(PROMODE_ACTIVATION_WARNINGS.length).toBeGreaterThanOrEqual(6);
    expect(PROMODE_ACTIVATION_WARNINGS[0]).toContain('API cost');
  });

  it('persists skip-activation preference', async () => {
    const { setSkipActivationWarnings, loadPromodeSafetyPrefs } = await import(
      '../src/promode/safety-prefs.js'
    );
    setSkipActivationWarnings(true);
    const prefs = loadPromodeSafetyPrefs();
    expect(prefs.skipActivationWarnings).toBe(true);
    expect(prefs.skipPeriodicWarnings).toBe(true);
  });

  it('tracks token budget on state and detects exceed', async () => {
    const { beginPromodeRunAccounting, isPromodeTokenBudgetExceeded } = await import(
      '../src/promode/consent.js'
    );
    const { loadPromodeState, mutatePromodeState } = await import('../src/promode/state.js');

    beginPromodeRunAccounting(tempCwd, 'sess-1', 1000);
    let state = loadPromodeState(tempCwd);
    expect(state.sessionTokenBudget).toBe(1000);
    expect(state.usageBaselineTokens).toBeDefined();

    mutatePromodeState(tempCwd, (s) => {
      s.sessionTokensUsed = 999;
    });
    expect(isPromodeTokenBudgetExceeded(tempCwd)).toBe(false);

    mutatePromodeState(tempCwd, (s) => {
      s.sessionTokensUsed = 1000;
    });
    expect(isPromodeTokenBudgetExceeded(tempCwd)).toBe(true);
    state = loadPromodeState(tempCwd);
    expect(state.sessionTokensUsed).toBe(1000);
  });

  it('shouldShowPeriodicWarning every N iterations', async () => {
    const { shouldShowPeriodicWarning } = await import('../src/promode/consent.js');
    expect(shouldShowPeriodicWarning(0)).toBe(false);
    expect(shouldShowPeriodicWarning(5)).toBe(true);
    expect(shouldShowPeriodicWarning(10)).toBe(true);
    expect(shouldShowPeriodicWarning(4)).toBe(false);
  });

  it('writes safety prefs under GRAWKUS_HOME', async () => {
    const { setSkipActivationWarnings } = await import('../src/promode/safety-prefs.js');
    setSkipActivationWarnings(true);
    expect(existsSync(join(tempHome, 'promode', 'safety.json'))).toBe(true);
  });
});
