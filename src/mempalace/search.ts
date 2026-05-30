/**
 * MemPalace text search — tokenized, field-weighted scoring.
 *
 * Design goals:
 *   1. Zero dependencies (no FTS index, no embedding model)
 *   2. Reasonable ranking out of the box: title-ish fields outrank body
 *   3. Tolerant to short queries (single keyword should still rank well)
 *   4. Tolerant to plural / case variations via simple stemming
 *
 * We tokenize on non-alphanumeric, lowercase everything, drop tokens
 * shorter than 2 chars and a small stopword list, and score each drawer
 * by summing per-token field weights:
 *
 *   tags     × 4   (semantic tags are the strongest signal)
 *   room     × 3
 *   wing     × 2
 *   content  × 1   (matches anywhere in body)
 *
 * Importance acts as a multiplier on the final score so the user can
 * boost high-signal drawers via the importance field. Recency also
 * lightly boosts via a half-life of 90 days.
 *
 * This is good enough until the store gets large; the search() entry
 * point is the swap-in for a real FTS / embedding search later.
 */

import type { Drawer, SearchOptions, SearchHit } from './types.js';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'but', 'the', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this',
  'that', 'these', 'those', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'by', 'from', 'as', 'into', 'about', 'it', 'its', 'i', 'you', 'we',
  'they', 'them', 'me', 'my', 'your', 'our', 'their', 'his', 'her',
]);

/**
 * Tokenize a string into lowercase, deduplicated, non-stopword tokens of
 * length ≥ 2. Very lightweight stemming: trailing 's' is stripped to fold
 * "drawer"/"drawers" together. Aggressive stemming (Porter, etc.) would
 * cost a lot for marginal recall gains at this scale.
 */
export function tokenize(s: string): string[] {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;
    if (STOPWORDS.has(raw)) continue;
    // Tiny stemmer: strip trailing 's' on words ≥ 4 chars (avoids "is"/"as" issues)
    const stem = raw.length >= 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
    out.add(stem);
  }
  return [...out];
}

/**
 * BM25 (Okapi) ranking on the content field, plus field-weight boosts for
 * tags/room/wing matches.
 *
 * Why BM25 over substring counting (the previous implementation): common
 * tokens (e.g. "test" appearing in every drawer of a testing-heavy repo)
 * drowned out distinctive ones. BM25's inverse-document-frequency term
 * naturally downweights tokens that appear in most drawers, and the
 * length-normalization keeps short drawers from being unfairly favored
 * just because their token density is higher.
 *
 * Parameters chosen to match MemPalace upstream:
 *   k1 = 1.5   — saturates term frequency around the third occurrence
 *   b  = 0.75  — moderate length normalization (full vs none = 1.0 vs 0)
 *
 * Field boosts (tags×4 > room×3 > wing×2) preserve the intuition that
 * tags are the strongest semantic signal. Importance + recency boosts
 * are unchanged from the prior implementation.
 *
 * Corpus stats (IDF + average length) are computed once per searchDrawers
 * call — fine for stores up to ~10k drawers. Beyond that, persist a
 * pre-computed index alongside the JSON store.
 */

interface CorpusStats {
  N: number;                  // total drawer count
  avgDocLength: number;       // mean tokenized-content length
  docFreq: Map<string, number>; // token → number of drawers containing it
}

function buildCorpusStats(drawers: Drawer[]): CorpusStats {
  const docFreq = new Map<string, number>();
  let totalLength = 0;
  for (const d of drawers) {
    const tokens = tokenize(d.content);
    totalLength += tokens.length;
    const seen = new Set<string>();   // count document frequency once per drawer
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      docFreq.set(t, (docFreq.get(t) || 0) + 1);
    }
  }
  return {
    N: drawers.length,
    avgDocLength: drawers.length > 0 ? totalLength / drawers.length : 1,
    docFreq,
  };
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

function bm25Score(drawer: Drawer, queryTokens: string[], stats: CorpusStats): number {
  const docTokens = tokenize(drawer.content);
  const docLength = docTokens.length || 1;
  // Term frequencies within this document
  const tf = new Map<string, number>();
  for (const t of docTokens) tf.set(t, (tf.get(t) || 0) + 1);

  let score = 0;
  for (const qt of queryTokens) {
    const f = tf.get(qt) || 0;
    if (f === 0) continue;
    const df = stats.docFreq.get(qt) || 0;
    // Smoothed IDF: log((N - df + 0.5) / (df + 0.5) + 1). The +1 keeps
    // IDF non-negative even when a token appears in more than half the
    // corpus (otherwise the score for very common tokens goes negative
    // and we'd subtract relevance, which is wrong here).
    const idf = Math.log((stats.N - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / stats.avgDocLength)));
    score += idf * tfNorm;
  }
  return score;
}

/**
 * Score a single drawer against a tokenized query. Returns 0 if no match,
 * otherwise a positive score (higher = better).
 *
 * Combines BM25 on content with simple field-weight boosts on tags/
 * room/wing. The field boosts use the original substring-presence model
 * (still a token-set check) because BM25 over very-short fields like
 * a 1-2 word wing name is poorly behaved.
 */
function scoreDrawer(
  drawer: Drawer,
  queryTokens: string[],
  matchedFields: Set<'content' | 'tags' | 'wing' | 'room'>,
  stats: CorpusStats,
): number {
  if (queryTokens.length === 0) return 0;

  const tagSet = new Set(drawer.tags.flatMap(tokenize));
  const wingTokens = new Set(tokenize(drawer.wing));
  const roomTokens = new Set(tokenize(drawer.room));

  let fieldScore = 0;
  let anyMatch = false;

  for (const qt of queryTokens) {
    if (tagSet.has(qt)) { fieldScore += 4; matchedFields.add('tags'); anyMatch = true; }
    if (roomTokens.has(qt)) { fieldScore += 3; matchedFields.add('room'); anyMatch = true; }
    if (wingTokens.has(qt)) { fieldScore += 2; matchedFields.add('wing'); anyMatch = true; }
  }

  // BM25 on content
  const contentBm25 = bm25Score(drawer, queryTokens, stats);
  if (contentBm25 > 0) {
    matchedFields.add('content');
    anyMatch = true;
  }

  if (!anyMatch) return 0;

  let score = fieldScore + contentBm25;

  // Importance multiplier — 0.5 default gives no boost, 1.0 → 1.5×, 0 → 0.5×
  score *= 1 + (drawer.importance - 0.5);

  // Recency bonus — half-life of 90 days. Drawers from today get +50%,
  // 90-day-old drawers get +25%, older fade toward baseline.
  const ageDays = (Date.now() - new Date(drawer.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  const recencyBoost = 0.5 * Math.pow(0.5, ageDays / 90);
  score *= 1 + recencyBoost;

  return score;
}

/**
 * Top-level search. Filters by scope/wing/room/tags first, then scores
 * each remaining drawer and returns the top `limit` by score.
 */
export function searchDrawers(
  drawers: Drawer[],
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  let candidates = drawers;
  if (opts.wing) candidates = candidates.filter((d) => d.wing === opts.wing!.toLowerCase());
  if (opts.room) candidates = candidates.filter((d) => d.room === opts.room!.toLowerCase());
  if (opts.tags && opts.tags.length > 0) {
    const required = opts.tags.map((t) => t.toLowerCase());
    candidates = candidates.filter((d) => required.every((t) => d.tags.includes(t)));
  }
  if (opts.minImportance !== undefined) {
    candidates = candidates.filter((d) => d.importance >= opts.minImportance!);
  }

  // BM25 needs corpus-level IDF + average document length. Compute it
  // once over the candidate set (post-filter, so it reflects the search
  // scope's actual distribution).
  const stats = buildCorpusStats(candidates);

  const hits: SearchHit[] = [];
  for (const d of candidates) {
    const matchedFields = new Set<'content' | 'tags' | 'wing' | 'room'>();
    const score = scoreDrawer(d, tokens, matchedFields, stats);
    if (score > 0) {
      hits.push({ drawer: d, score, matchedFields: [...matchedFields] });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, opts.limit ?? 20);
}
