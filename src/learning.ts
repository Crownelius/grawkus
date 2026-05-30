/**
 * Instinct/learning system — extract patterns from sessions,
 * store with confidence scores, cluster into reusable instincts.
 * Data stored in ~/.grawkus/instincts/
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getConfigDir } from './config.js';
import type { Message } from './types.js';

const INSTINCTS_DIR = join(getConfigDir(), 'instincts');

export interface Instinct {
  id: string;
  pattern: string;           // what was learned
  context: string;           // when it applies
  category: InstinctCategory;
  confidence: number;        // 0-1, increases with reinforcement
  source: string;            // session ID or "imported"
  createdAt: string;
  lastUsed: string;
  useCount: number;
  expiresAt?: string;        // optional TTL
}

export type InstinctCategory =
  | 'code_pattern'      // coding style/pattern preference
  | 'tool_preference'   // preferred tool for a task
  | 'workflow'          // multi-step workflow
  | 'error_fix'         // known error → fix mapping
  | 'project_context'   // project-specific knowledge
  | 'user_preference';  // user behavior preference

function ensureDir(): void {
  mkdirSync(INSTINCTS_DIR, { recursive: true });
}

function instinctPath(id: string): string {
  return join(INSTINCTS_DIR, `${id}.json`);
}

function genId(): string {
  return `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function saveInstinct(instinct: Instinct): void {
  ensureDir();
  writeFileSync(instinctPath(instinct.id), JSON.stringify(instinct, null, 2), 'utf-8');
}

export function loadInstinct(id: string): Instinct | null {
  const p = instinctPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function listInstincts(): Instinct[] {
  ensureDir();
  const files = readdirSync(INSTINCTS_DIR).filter((f) => f.endsWith('.json'));
  const instincts: Instinct[] = [];
  for (const file of files) {
    try {
      instincts.push(JSON.parse(readFileSync(join(INSTINCTS_DIR, file), 'utf-8')));
    } catch { /* skip */ }
  }
  return instincts.sort((a, b) => b.confidence - a.confidence);
}

export function deleteInstinct(id: string): boolean {
  const p = instinctPath(id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

export function createInstinct(
  pattern: string,
  context: string,
  category: InstinctCategory,
  source: string,
  confidence = 0.5,
): Instinct {
  const inst: Instinct = {
    id: genId(),
    pattern,
    context,
    category,
    confidence,
    source,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    useCount: 0,
  };
  saveInstinct(inst);
  return inst;
}

export function reinforceInstinct(id: string, boost = 0.1): void {
  const inst = loadInstinct(id);
  if (!inst) return;
  inst.confidence = Math.min(1.0, inst.confidence + boost);
  inst.useCount++;
  inst.lastUsed = new Date().toISOString();
  saveInstinct(inst);
}

export function decayInstinct(id: string, amount = 0.05): void {
  const inst = loadInstinct(id);
  if (!inst) return;
  inst.confidence = Math.max(0, inst.confidence - amount);
  if (inst.confidence === 0) {
    deleteInstinct(id);
  } else {
    saveInstinct(inst);
  }
}

/**
 * Fuzzy match to detect similar patterns (simple approach)
 */
function similarPattern(a: string, b: string, threshold = 0.7): boolean {
  const aWords = a.toLowerCase().split(/\s+/);
  const bWords = b.toLowerCase().split(/\s+/);
  const commonWords = aWords.filter((w) => bWords.includes(w)).length;
  const totalWords = Math.max(aWords.length, bWords.length);
  return totalWords > 0 && commonWords / totalWords >= threshold;
}

/**
 * Extract patterns from a conversation.
 * Looks for: repeated tool sequences, error→fix patterns, style preferences.
 * Deduplicates similar patterns before creating instincts.
 */
export function extractPatterns(messages: Message[], sessionId: string): Instinct[] {
  const extracted: Instinct[] = [];
  const existingPatterns = listInstincts().map((i) => i.pattern);

  // Extract error→fix patterns
  for (let i = 0; i < messages.length - 2; i++) {
    const m1 = messages[i];
    const m2 = messages[i + 1];
    const m3 = messages[i + 2];

    // Pattern: tool error → assistant fix → successful tool
    if (
      m1.role === 'tool' &&
      typeof m1.content === 'string' &&
      (m1.content.includes('Error') || m1.content.includes('error')) &&
      m2.role === 'assistant' &&
      m3.role === 'tool' &&
      typeof m3.content === 'string' &&
      !m3.content.includes('Error')
    ) {
      const errorSnippet = (m1.content as string).slice(0, 200);
      const fixSnippet = typeof m2.content === 'string' ? m2.content.slice(0, 200) : '';
      if (fixSnippet) {
        const pattern = `When encountering: ${errorSnippet}\nFix: ${fixSnippet}`;

        // Check if a similar pattern already exists
        const isDuplicate = existingPatterns.some((p) => similarPattern(pattern, p));
        if (!isDuplicate) {
          extracted.push(
            createInstinct(
              pattern,
              'error resolution',
              'error_fix',
              sessionId,
              0.4,
            ),
          );
          existingPatterns.push(pattern);
        }
      }
    }
  }

  // Extract tool usage patterns (which tools are used together)
  const toolSequences: string[] = [];
  for (const m of messages) {
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        toolSequences.push(tc.function.name);
      }
    }
  }

  // Find repeated sequences of 2-3 tools
  for (let len = 2; len <= 3; len++) {
    const seqCounts = new Map<string, number>();
    for (let i = 0; i <= toolSequences.length - len; i++) {
      const seq = toolSequences.slice(i, i + len).join(' → ');
      seqCounts.set(seq, (seqCounts.get(seq) || 0) + 1);
    }
    for (const [seq, count] of seqCounts) {
      if (count >= 2) {
        const pattern = `Common workflow: ${seq}`;

        // Check if similar pattern already exists
        const isDuplicate = existingPatterns.some((p) => similarPattern(pattern, p));
        if (!isDuplicate) {
          extracted.push(
            createInstinct(
              pattern,
              'repeated tool sequence',
              'workflow',
              sessionId,
              Math.min(0.3 + count * 0.1, 0.8),
            ),
          );
          existingPatterns.push(pattern);
        }
      }
    }
  }

  return extracted;
}

/**
 * Get relevant instincts for the current context.
 */
export function getRelevantInstincts(query: string, limit = 5): Instinct[] {
  const all = listInstincts();
  const now = new Date();

  // Filter expired
  const active = all.filter((i) => {
    if (i.expiresAt && new Date(i.expiresAt) < now) return false;
    return true;
  });

  // Score by relevance (simple keyword matching + confidence)
  const queryWords = query.toLowerCase().split(/\s+/);
  const scored = active.map((inst) => {
    const text = `${inst.pattern} ${inst.context}`.toLowerCase();
    const matchCount = queryWords.filter((w) => text.includes(w)).length;
    const score = (matchCount / queryWords.length) * inst.confidence;
    return { inst, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.inst);
}

export function pruneExpired(): number {
  const all = listInstincts();
  const now = new Date();
  let pruned = 0;
  for (const inst of all) {
    if (inst.expiresAt && new Date(inst.expiresAt) < now) {
      deleteInstinct(inst.id);
      pruned++;
    }
    // Also prune zero-confidence
    if (inst.confidence <= 0) {
      deleteInstinct(inst.id);
      pruned++;
    }
  }
  return pruned;
}

export function exportInstincts(): string {
  return JSON.stringify(listInstincts(), null, 2);
}

export function importInstincts(json: string): number {
  const instincts: Instinct[] = JSON.parse(json);
  let count = 0;
  for (const inst of instincts) {
    inst.source = 'imported';
    saveInstinct(inst);
    count++;
  }
  return count;
}

export function printInstinctStatus(): void {
  const all = listInstincts();
  console.log(chalk.cyan(`\n  Instincts: ${all.length} total`));
  const byCat = new Map<string, number>();
  for (const i of all) {
    byCat.set(i.category, (byCat.get(i.category) || 0) + 1);
  }
  for (const [cat, count] of byCat) {
    console.log(chalk.dim(`  ${cat}: ${count}`));
  }
  if (all.length > 0) {
    console.log(chalk.dim(`\n  Top instincts:`));
    for (const inst of all.slice(0, 5)) {
      console.log(chalk.dim(`    [${(inst.confidence * 100).toFixed(0)}%] ${inst.pattern.slice(0, 80)}`));
    }
  }
  console.log();
}
