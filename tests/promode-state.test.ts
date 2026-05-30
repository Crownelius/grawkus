import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempHome = '';
let tempCwd = '';

beforeEach(() => {
  vi.resetModules();
  tempHome = mkdtempSync(join(tmpdir(), 'grawkus-promode-state-home-'));
  tempCwd = mkdtempSync(join(tmpdir(), 'grawkus-promode-state-cwd-'));
  vi.stubEnv('GRAWKUS_HOME', tempHome);
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(tempCwd, { recursive: true, force: true });
});

describe('ProMode state persistence', () => {
  it('roundtrips global state through save and load', async () => {
    const { loadPromodeState, savePromodeState, getGlobalStatePath } = await import('../src/promode/state.js');
    const state = loadPromodeState(tempCwd);
    state.running = true;
    state.tasks.push({ text: 'ship feature', status: 'pending', createdAt: new Date().toISOString() });
    savePromodeState(state, tempCwd);

    expect(existsSync(getGlobalStatePath())).toBe(true);
    const reloaded = loadPromodeState(tempCwd);
    expect(reloaded.running).toBe(true);
    expect(reloaded.tasks).toHaveLength(1);
    expect(reloaded.tasks[0].text).toBe('ship feature');
  });

  it('adds queue items via helpers', async () => {
    const { loadPromodeState, addTask, addIdea, getTilwSummary } = await import('../src/promode/state.js');
    addTask('run tests', tempCwd);
    addIdea('try biome', tempCwd);
    const summary = getTilwSummary(loadPromodeState(tempCwd));
    expect(summary.tasks.pending).toBe(1);
    expect(summary.ideas.pending).toBe(1);
  });
});
