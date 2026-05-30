import { describe, expect, it } from 'vitest';
import {
  applySessionPickerInput,
  eraseSessionPickerRows,
  filterSessionPickerItems,
  formatSessionPickerLine,
  maxVisibleSessionRows,
  parseSessionPickerInput,
  visibleSessionPickerWindow,
  type SessionSummary,
} from '../src/session-picker.js';

const sessions: SessionSummary[] = [
  {
    id: 'mpkgb0l4-alpha',
    name: 'Auth refactor',
    cwd: 'C:/repo/auth',
    model: 'openrouter/free',
    createdAt: '2026-05-20T10:00:00.000Z',
    updatedAt: '2026-05-21T11:22:00.000Z',
    turnCount: 7,
  },
  {
    id: 'mpkgb0l4-beta',
    name: 'Web game build',
    cwd: 'C:/repo/game',
    model: 'gpt-4.1',
    createdAt: '2026-05-22T10:00:00.000Z',
    updatedAt: '2026-05-23T11:22:00.000Z',
    turnCount: 1,
  },
];

describe('session picker helpers', () => {
  it('formats rows with name, turns, model, and update time', () => {
    const line = formatSessionPickerLine(sessions[0]);
    expect(line).toContain('Auth refactor');
    expect(line).toContain('7 turns');
    expect(line).toContain('openrouter/free');
    expect(line).toContain('2026-05-21 11:22');
  });

  it('filters by id, name, model, and cwd', () => {
    expect(filterSessionPickerItems(sessions, 'alpha').map((s) => s.id)).toEqual(['mpkgb0l4-alpha']);
    expect(filterSessionPickerItems(sessions, 'web game').map((s) => s.id)).toEqual(['mpkgb0l4-beta']);
    expect(filterSessionPickerItems(sessions, 'gpt-4.1').map((s) => s.id)).toEqual(['mpkgb0l4-beta']);
    expect(filterSessionPickerItems(sessions, 'repo/auth').map((s) => s.id)).toEqual(['mpkgb0l4-alpha']);
  });

  it('keeps the visible picker window bounded', () => {
    expect(maxVisibleSessionRows(24)).toBeLessThanOrEqual(8);
    const many = Array.from({ length: 20 }, (_, i) => i);
    const win = visibleSessionPickerWindow(many, 14, 5);
    expect(win.items).toHaveLength(5);
    expect(win.items).toContain(14);
  });

  it('handles movement, typing, selection, and cancel inputs', () => {
    expect(parseSessionPickerInput(Buffer.from([0x1B, 0x5B, 0x42]))).toEqual({ type: 'move', delta: 1 });
    expect(parseSessionPickerInput(Buffer.from([0x1B]))).toEqual({ type: 'cancel' });
    expect(parseSessionPickerInput(Buffer.from('\r'))).toEqual({ type: 'accept' });
    expect(parseSessionPickerInput(Buffer.from('auth'))).toEqual({ type: 'append', text: 'auth' });

    let result = applySessionPickerInput({ filter: '', selected: 0 }, { type: 'move', delta: 1 }, 2);
    expect(result.state.selected).toBe(1);
    result = applySessionPickerInput(result.state, { type: 'append', text: 'x' }, 2);
    expect(result.state).toEqual({ filter: 'x', selected: 0 });
    expect(applySessionPickerInput(result.state, { type: 'accept' }, 1)).toMatchObject({ accepted: true });
    expect(applySessionPickerInput(result.state, { type: 'cancel' }, 1)).toMatchObject({ cancelled: true });
  });

  it('erases only picker-owned rows without clearing the screen or alt-screen', () => {
    const erase = eraseSessionPickerRows(3);
    expect(erase).toContain('\x1b[2K');
    expect(erase).not.toContain('\x1b[J');
    expect(erase).not.toContain('\x1b[?1049h');
  });
});
