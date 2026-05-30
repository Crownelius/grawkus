/**
 * Curator — periodic skill consolidation pass (M2 item 4, convergent
 * across Sentience and MemPalace audits).
 *
 * The problem: as the agent learns instincts and graduates them into
 * skills (and as ECC ships new skills via bundle refresh), the skill
 * registry accumulates duplicates, stale single-use items, and near-
 * misses that should be merged. Without periodic curation, /skills
 * becomes noise and `findEccSkillsForQuery` returns more false-positive
 * matches.
 *
 * Sentience mode runs an "Autonomous Curator" on a 7-day cron. We ship
 * the same idea but:
 *   - Manual-only for v1.14 (`/curate`) — no automatic execution
 *   - Report-only: surfaces merge/archive candidates, never mutates
 *   - Pure heuristic: no LLM call (so it works offline and costs $0)
 *
 * Heuristics implemented:
 *   - Duplicate name: two skills with identical names (modulo whitespace)
 *   - Trigger overlap ≥70%: likely duplicate
 *   - Single use over 30 days old: stale
 *   - Zero use over 60 days old: probably noise
 *
 * Out of scope for v1.14: automatic merging, LLM-based "are these
 * actually the same thing" calls, skill quality scoring. Add later
 * if the heuristics turn out to false-positive a lot.
 */

import type { Skill } from './skills.js';
import { listSkills } from './skills.js';

export interface CuratorFinding {
  kind: 'duplicate-name' | 'high-overlap' | 'stale-single-use' | 'unused';
  primary: string;          // skill id
  secondary?: string;       // for pairs
  reason: string;           // human-readable
  recommendation: 'archive' | 'merge' | 'review';
}

export interface CuratorReport {
  scannedAt: string;
  totalSkills: number;
  findings: CuratorFinding[];
}

/**
 * Jaccard similarity between two arrays of strings. Symmetric, 0..1.
 * Used for trigger-overlap detection.
 */
function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a.map((s) => s.toLowerCase()));
  const sb = new Set(b.map((s) => s.toLowerCase()));
  if (sa.size === 0 && sb.size === 0) return 0;
  let intersection = 0;
  for (const x of sa) if (sb.has(x)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function ageDays(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

export function runCurator(): CuratorReport {
  const all = listSkills();
  const findings: CuratorFinding[] = [];

  // ── Duplicate names ──────────────────────────────────────
  const byName = new Map<string, Skill[]>();
  for (const s of all) {
    const key = s.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(s);
  }
  for (const [name, dupes] of byName.entries()) {
    if (dupes.length < 2) continue;
    // Keep the most-used / newest as primary; flag the rest for archive
    const sorted = [...dupes].sort((a, b) => (b.useCount - a.useCount) || b.createdAt.localeCompare(a.createdAt));
    for (let i = 1; i < sorted.length; i++) {
      findings.push({
        kind: 'duplicate-name',
        primary: sorted[i].id,
        secondary: sorted[0].id,
        reason: `Duplicate of "${name}" (${sorted[i].useCount} uses vs ${sorted[0].useCount}); keep the more-used one.`,
        recommendation: 'archive',
      });
    }
  }

  // ── High trigger overlap (likely near-duplicates) ────────
  // O(n²) but n is small (<300 skills typically). Skip pairs already
  // flagged as duplicate-name to avoid redundant findings.
  const flaggedDup = new Set<string>();
  for (const f of findings) {
    if (f.kind === 'duplicate-name') flaggedDup.add(f.primary);
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]; const b = all[j];
      if (flaggedDup.has(a.id) || flaggedDup.has(b.id)) continue;
      const sim = jaccard(a.triggers, b.triggers);
      if (sim >= 0.7 && a.triggers.length >= 2) {
        const sorted = [a, b].sort((x, y) => (y.useCount - x.useCount) || y.createdAt.localeCompare(x.createdAt));
        findings.push({
          kind: 'high-overlap',
          primary: sorted[1].id,
          secondary: sorted[0].id,
          reason: `${(sim * 100).toFixed(0)}% trigger overlap with "${sorted[0].name}" — consider merging.`,
          recommendation: 'merge',
        });
      }
    }
  }

  // ── Stale single-use skills ──────────────────────────────
  // Used exactly once and >30 days old → probably situational, not
  // a recurring pattern. Worth reviewing whether to keep.
  for (const s of all) {
    if (s.useCount === 1 && ageDays(s.createdAt) > 30) {
      findings.push({
        kind: 'stale-single-use',
        primary: s.id,
        reason: `Used once, ${Math.floor(ageDays(s.createdAt))} days old — may be situational.`,
        recommendation: 'review',
      });
    }
  }

  // ── Unused skills (never invoked, >60 days) ──────────────
  for (const s of all) {
    if (s.useCount === 0 && ageDays(s.createdAt) > 60) {
      findings.push({
        kind: 'unused',
        primary: s.id,
        reason: `Never invoked, ${Math.floor(ageDays(s.createdAt))} days old — likely noise.`,
        recommendation: 'archive',
      });
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    totalSkills: all.length,
    findings,
  };
}
