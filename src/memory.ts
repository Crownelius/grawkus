/**
 * Enhanced memory persistence — session-aware memory that persists key context across sessions.
 * Data stored in ~/.grawkus/memory/
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getConfigDir } from './config.js';
import type { Message } from './types.js';

const MEMORY_DIR = join(getConfigDir(), 'memory');

export interface MemoryEntry {
  key: string;
  value: string;
  category: 'project' | 'preference' | 'context' | 'decision';
  sessionId: string;
  createdAt: string;
  accessCount: number;
}

function ensureDir(): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
}

function memoryPath(key: string): string {
  // Sanitize key for filesystem
  const sanitized = key.replace(/[/\\:*?"<>|]/g, '_');
  return join(MEMORY_DIR, `${sanitized}.json`);
}

/**
 * Save or update a memory entry.
 */
export function saveMemory(
  key: string,
  value: string,
  category: MemoryEntry['category'],
  sessionId: string,
): void {
  ensureDir();

  const entry: MemoryEntry = {
    key,
    value,
    category,
    sessionId,
    createdAt: new Date().toISOString(),
    accessCount: 0,
  };

  writeFileSync(memoryPath(key), JSON.stringify(entry, null, 2), 'utf-8');
}

/**
 * Load a memory entry by key.
 */
export function loadMemory(key: string): MemoryEntry | null {
  const p = memoryPath(key);
  if (!existsSync(p)) return null;
  try {
    const entry = JSON.parse(readFileSync(p, 'utf-8')) as MemoryEntry;
    entry.accessCount++;
    writeFileSync(p, JSON.stringify(entry, null, 2), 'utf-8');
    return entry;
  } catch {
    return null;
  }
}

/**
 * Search memories by keyword across all entries.
 */
export function searchMemory(query: string): MemoryEntry[] {
  ensureDir();
  const files = readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.json'));
  const results: MemoryEntry[] = [];
  const queryLower = query.toLowerCase();

  for (const file of files) {
    try {
      const entry = JSON.parse(readFileSync(join(MEMORY_DIR, file), 'utf-8')) as MemoryEntry;
      const text = `${entry.key} ${entry.value} ${entry.category}`.toLowerCase();
      if (text.includes(queryLower)) {
        results.push(entry);
      }
    } catch { /* skip */ }
  }

  return results.sort((a, b) => b.accessCount - a.accessCount);
}

/**
 * Get all memories for a specific project (by cwd path).
 */
export function getProjectMemory(cwd: string): MemoryEntry[] {
  ensureDir();
  const files = readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.json'));
  const results: MemoryEntry[] = [];

  for (const file of files) {
    try {
      const entry = JSON.parse(readFileSync(join(MEMORY_DIR, file), 'utf-8')) as MemoryEntry;
      // Match project memories by key pattern (e.g., "project:/path/to/project")
      if (entry.key.startsWith(`project:${cwd}`) || entry.category === 'project') {
        results.push(entry);
      }
    } catch { /* skip */ }
  }

  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Called at session start — returns a context string to inject into system prompt.
 * Loads relevant memories for the given project.
 */
export function onSessionStart(sessionId: string, cwd: string): string {
  const projectMemories = getProjectMemory(cwd);
  if (projectMemories.length === 0) return '';

  const lines = [
    '## Relevant Project Context from Previous Sessions:',
  ];

  for (const mem of projectMemories.slice(0, 10)) {
    lines.push(`- [${mem.category}] ${mem.key}: ${mem.value}`);
  }

  return lines.join('\n');
}

/**
 * Called at session end — auto-extract key decisions and context from conversation.
 */
export function onSessionEnd(sessionId: string, messages: Message[], cwd: string): void {
  // Extract key decision points and context
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Look for user messages that indicate decisions
    if (msg.role === 'user' && typeof msg.content === 'string') {
      const text = msg.content.toLowerCase();

      // Decision keywords
      if (text.includes('decided') || text.includes('decided to') || text.includes('we will')) {
        const key = `decision:${sessionId}:${i}`;
        saveMemory(key, msg.content.slice(0, 500), 'decision', sessionId);
      }

      // Project context
      if (text.includes('project') || text.includes('codebase') || text.includes('architecture')) {
        const key = `project:${cwd}:context:${i}`;
        saveMemory(key, msg.content.slice(0, 500), 'project', sessionId);
      }

      // User preferences
      if (text.includes('prefer') || text.includes('prefer ') || text.includes('always')) {
        const key = `preference:${sessionId}:${i}`;
        saveMemory(key, msg.content.slice(0, 500), 'preference', sessionId);
      }
    }
  }
}

/**
 * Remove memories older than maxAge days.
 */
export function pruneOldMemories(maxAge: number): number {
  ensureDir();
  const files = readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.json'));
  const now = new Date();
  let pruned = 0;

  for (const file of files) {
    const p = join(MEMORY_DIR, file);
    try {
      const entry = JSON.parse(readFileSync(p, 'utf-8')) as MemoryEntry;
      const age = (now.getTime() - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (age > maxAge) {
        unlinkSync(p);
        pruned++;
      }
    } catch { /* skip */ }
  }

  return pruned;
}

export function printMemoryStatus(): void {
  ensureDir();
  const files = readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.json'));
  const entries: MemoryEntry[] = [];

  for (const file of files) {
    try {
      entries.push(JSON.parse(readFileSync(join(MEMORY_DIR, file), 'utf-8')));
    } catch { /* skip */ }
  }

  console.log(chalk.cyan(`\n  Memory: ${entries.length} entries`));

  const byCat = new Map<string, number>();
  for (const e of entries) {
    byCat.set(e.category, (byCat.get(e.category) || 0) + 1);
  }

  for (const [cat, count] of Array.from(byCat.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(chalk.dim(`  ${cat}: ${count}`));
  }

  if (entries.length > 0) {
    console.log(chalk.dim(`\n  Most accessed:`));
    const byAccess = entries.sort((a, b) => b.accessCount - a.accessCount);
    for (const entry of byAccess.slice(0, 5)) {
      const valuePreview = entry.value.slice(0, 50).replace(/\n/g, ' ');
      console.log(chalk.dim(`    [${entry.accessCount}x] ${entry.key}: ${valuePreview}...`));
    }
  }
  console.log();
}
