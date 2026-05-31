/**
 * REPL ↔ ProMode loop bridge (avoids circular imports with index.ts).
 */

import type { Interface } from 'node:readline/promises';
import type { GrawkusConfig, Message } from '../types.js';
import type { Mode } from '../modes.js';
import type { Session } from '../sessions.js';
import { syncPromodeTokensFromSession } from './consent.js';
import { startPromodeLoop, schedulePromodeAfterTurn, type PromodeLoopContext } from './loop.js';

export interface PromodeReplBridge {
  cwd: string;
  config: GrawkusConfig;
  rl?: Interface;
  getMessages: () => Message[];
  getMode: () => { current: Mode };
  getSession: () => Session;
  runQuery: (opts: {
    config: GrawkusConfig;
    messages: Message[];
    cwd: string;
    sessionId: string;
    mode: Mode;
  }) => Promise<void>;
  saveSnapshot: () => Promise<void>;
  hasQueuedUserInput: () => boolean;
  isQueryInFlight: () => boolean;
  consumeTurnConfig: () => GrawkusConfig;
  syncFooter: () => void;
}

let bridge: PromodeReplBridge | null = null;

export function registerPromodeReplBridge(b: PromodeReplBridge | null): void {
  bridge = b;
}

export function getPromodeReplBridge(): PromodeReplBridge | null {
  return bridge;
}

function buildLoopCtx(b: PromodeReplBridge): PromodeLoopContext {
  return {
    cwd: b.cwd,
    config: b.config,
    sessionId: b.getSession().id,
    rl: b.rl,
    hasQueuedUserInput: b.hasQueuedUserInput,
    isQueryInFlight: b.isQueryInFlight,
    runCycle: async (prompt, promodeMode) => {
      const messages = b.getMessages();
      b.getMode().current = promodeMode;
      messages.push({ role: 'user', content: prompt });
      await b.saveSnapshot();
      const turnConfig = b.consumeTurnConfig();
      const promodeCfg = { ...turnConfig };
      const maxPer = turnConfig.promode?.maxTurnsPerCycle;
      if (maxPer && maxPer > 0) promodeCfg.maxTurns = maxPer;
      b.syncFooter();
      await b.runQuery({
        config: promodeCfg,
        messages,
        cwd: b.cwd,
        sessionId: b.getSession().id,
        mode: promodeMode,
      });
      syncPromodeTokensFromSession(b.cwd, b.getSession().id);
      b.syncFooter();
      await b.saveSnapshot();
    },
  };
}

export function startPromodeFromRepl(): void {
  if (!bridge) return;
  startPromodeLoop(buildLoopCtx(bridge));
}

export function afterReplTurnPromode(): void {
  if (!bridge) return;
  schedulePromodeAfterTurn(buildLoopCtx(bridge));
}
