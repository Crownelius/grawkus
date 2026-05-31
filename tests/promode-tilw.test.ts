import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempHome = '';
let tempCwd = '';

beforeEach(() => {
  vi.resetModules();
  tempHome = mkdtempSync(join(tmpdir(), 'grawkus-promode-home-'));
  tempCwd = mkdtempSync(join(tmpdir(), 'grawkus-promode-cwd-'));
  vi.stubEnv('GRAWKUS_HOME', tempHome);
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(tempCwd, { recursive: true, force: true });
});

describe('ProMode TILW picker', () => {
  it('picks T before I when both queues have items', async () => {
    const { loadPromodeState, savePromodeState } = await import('../src/promode/state.js');
    const { pickNextTilwAction } = await import('../src/promode/tilw.js');
    const state = loadPromodeState(tempCwd);
    state.ideas.push({ text: 'explore graphql', status: 'pending', createdAt: new Date().toISOString() });
    state.tasks.push({ text: 'fix login bug', status: 'pending', createdAt: new Date().toISOString() });
    savePromodeState(state, tempCwd);

    const pick = pickNextTilwAction(state, tempCwd, {});
    expect(pick.priority).toBe('T');
    expect(pick.action).toContain('fix login bug');
  });

  it('picks I after tasks are done', async () => {
    const { createDefaultPromodeState } = await import('../src/promode/state.js');
    const { pickNextTilwAction } = await import('../src/promode/tilw.js');
    const state = createDefaultPromodeState();
    state.tasks = [{ text: 'done task', status: 'done', createdAt: new Date().toISOString() }];
    state.ideas.push({ text: 'learn rust async', status: 'pending', createdAt: new Date().toISOString() });

    const pick = pickNextTilwAction(state, tempCwd, {});
    expect(pick.priority).toBe('I');
    expect(pick.action).toContain('rust async');
  });

  it('never returns empty action when all queues are empty', async () => {
    const { createDefaultPromodeState } = await import('../src/promode/state.js');
    const { pickNextTilwAction, FOCUS_CATEGORIES } = await import('../src/promode/tilw.js');
    const state = createDefaultPromodeState();
    state.focusIndex = 0;

    const pick = pickNextTilwAction(state, tempCwd, {});
    expect(['L', 'W']).toContain(pick.priority);
    expect(pick.action.trim().length).toBeGreaterThan(10);
    expect(pick.focusCategory).toBe(FOCUS_CATEGORIES[0]);
  });

  it('advances focus index every focusRotate iterations', async () => {
    const { createDefaultPromodeState } = await import('../src/promode/state.js');
    const { pickNextTilwAction, FOCUS_CATEGORIES } = await import('../src/promode/tilw.js');
    const state = createDefaultPromodeState();
    state.iterationCount = 24;
    const pick = pickNextTilwAction(state, tempCwd, { focusRotate: 24 });
    expect(pick.focusCategory).toBe(FOCUS_CATEGORIES[1]);
  });
});
