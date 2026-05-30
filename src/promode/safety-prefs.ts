/**
 * ProMode cost-warning preferences (~/.grawkus/promode/safety.json).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getHomeStateDir } from '../config.js';

const SAFETY_FILE = 'safety.json';

export interface PromodeSafetyPrefs {
  /** Skip multi-step activation cost warnings */
  skipActivationWarnings?: boolean;
  /** Skip periodic re-confirmations during the loop */
  skipPeriodicWarnings?: boolean;
  /** Last time user accepted activation warnings (ISO) */
  lastActivationAcceptedAt?: string;
}

function safetyPath(): string {
  return join(getHomeStateDir(), 'promode', SAFETY_FILE);
}

export function loadPromodeSafetyPrefs(): PromodeSafetyPrefs {
  const path = safetyPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PromodeSafetyPrefs;
  } catch {
    return {};
  }
}

export function savePromodeSafetyPrefs(prefs: PromodeSafetyPrefs): void {
  const path = safetyPath();
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(prefs, null, 2), 'utf-8');
}

export function setSkipActivationWarnings(skip: boolean): PromodeSafetyPrefs {
  const prefs = loadPromodeSafetyPrefs();
  prefs.skipActivationWarnings = skip;
  if (skip) prefs.skipPeriodicWarnings = true;
  savePromodeSafetyPrefs(prefs);
  return prefs;
}

export function setSkipPeriodicWarnings(skip: boolean): PromodeSafetyPrefs {
  const prefs = loadPromodeSafetyPrefs();
  prefs.skipPeriodicWarnings = skip;
  savePromodeSafetyPrefs(prefs);
  return prefs;
}
