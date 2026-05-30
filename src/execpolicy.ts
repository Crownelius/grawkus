/**
 * Execpolicy DSL — a lightweight command-intent allowlist that gates
 * bash commands BEFORE the existing ask/auto/yolo permission flow.
 *
 * Inspired by codex-rs/execpolicy/. Three decisions per rule:
 *   allow      — skip the permission prompt (treat as yolo for this cmd)
 *   prompt     — force the prompt even in `auto` mode
 *   forbidden  — block outright, don't even prompt; print reason
 *
 * First matching rule wins. If no rule matches, the original
 * permission mode is honored (so the default is "no change to behavior").
 *
 * The DEFAULT_RULES below codify the most-common safety intents the
 * Codex execpolicy ships, condensed to what's portable across Win/
 * macOS/Linux. Users can override at runtime via /perm-policy and the
 * config field `execpolicy` (TODO in v1.20).
 *
 * Real OS-native sandboxing (Seatbelt/landlock/ACL) is intentionally
 * out of scope for this layer — it's an evening's work in TS for an
 * intent gate, vs weeks for proper sandboxing. This is the audit's
 * pragmatic recommendation.
 */

export type Decision = 'allow' | 'prompt' | 'forbidden';

export interface ExecRule {
  /** Command prefix or regex. String values are treated as `^<value>`. */
  pattern: RegExp | string;
  decision: Decision;
  /** Optional: only match if this also tests true */
  match?: RegExp | string;
  /** Optional: only match if this tests FALSE */
  notMatch?: RegExp | string;
  /** Shown to the user when decision != 'allow' */
  reason?: string;
  /** Human-readable rule name for logging / debugging */
  id?: string;
}

export interface PolicyResult {
  decision: Decision;
  reason?: string;
  ruleId?: string;
}

/**
 * Built-in policy. Ordered: most-specific dangerous patterns first
 * so they fire before broader category rules. Allows come last so
 * a dangerous variant of "git" hits the prompt rule before the
 * "git read ops" allow.
 */
export const DEFAULT_RULES: ExecRule[] = [
  // ── FORBIDDEN (block outright) ────────────────────────
  {
    id: 'rm-rf-root',
    pattern: /\brm\s/,
    match: /-r[a-z]*f|-f[a-z]*r/,
    notMatch: /^[\s\S]*?\srm\s.*\s\.\.?\/?$/,  // allow rm -rf . or ..
    decision: 'forbidden',
    reason: 'rm with recursive force flag; require explicit user approval',
  },
  {
    id: 'rm-system-path',
    pattern: /\brm\s.*\s(\/|C:\\?|\/usr|\/etc|\/bin|\/sbin|\/var|\/boot)\b/,
    decision: 'forbidden',
    reason: 'targeting a system path',
  },
  {
    id: 'shutdown',
    pattern: /^(shutdown|reboot|halt|poweroff)\b/,
    decision: 'forbidden',
    reason: 'system shutdown / reboot',
  },
  {
    id: 'dd-disk',
    pattern: /^dd\s/,
    match: /of=\/dev\/(sd|nvme|hd|disk)/,
    decision: 'forbidden',
    reason: 'dd writing to raw disk device',
  },
  {
    id: 'format-disk',
    pattern: /^(format|mkfs|diskpart)\b/,
    decision: 'forbidden',
    reason: 'disk formatting',
  },

  // ── PROMPT (force prompt even in auto mode) ───────────
  {
    id: 'sudo',
    pattern: /^sudo\b/,
    decision: 'prompt',
    reason: 'requires elevated privileges',
  },
  {
    id: 'rm-recursive',
    pattern: /\brm\s/,
    match: /-r/,
    decision: 'prompt',
    reason: 'recursive removal',
  },
  {
    id: 'curl-pipe-shell',
    pattern: /\bcurl\b/,
    match: /\|\s*(sh|bash|zsh|fish)\b/,
    decision: 'prompt',
    reason: 'piping curl output directly to shell',
  },
  {
    id: 'wget-pipe-shell',
    pattern: /\bwget\b/,
    match: /\|\s*(sh|bash|zsh|fish)\b/,
    decision: 'prompt',
    reason: 'piping wget output directly to shell',
  },
  {
    id: 'git-force-push',
    pattern: /^git\s+push\b/,
    match: /--force(?!-with-lease)|--mirror|\+/,
    decision: 'prompt',
    reason: 'force-push (rewrites remote history)',
  },
  {
    id: 'git-reset-hard',
    pattern: /^git\s+reset\b/,
    match: /--hard/,
    decision: 'prompt',
    reason: 'hard reset discards uncommitted work',
  },
  {
    id: 'git-clean-force',
    pattern: /^git\s+clean\b/,
    match: /-f/,
    decision: 'prompt',
    reason: 'git clean -f deletes untracked files',
  },
  {
    id: 'npm-mutate-registry',
    pattern: /^npm\s+(unpublish|deprecate)\b/,
    decision: 'prompt',
    reason: 'mutating the npm registry',
  },
  {
    id: 'pip-uninstall',
    pattern: /^pip(3)?\s+uninstall\b/,
    decision: 'prompt',
    reason: 'pip uninstall',
  },
  {
    id: 'docker-rm-volume',
    pattern: /^docker\s+(volume\s+rm|system\s+prune|rm\s+--force|kill)\b/,
    decision: 'prompt',
    reason: 'docker destructive operation',
  },

  // ── ALLOW (skip prompt entirely) ──────────────────────
  // Pure read / inspection ops — safe to auto-approve even in `ask` mode
  { id: 'cat',     pattern: /^cat\s/,    decision: 'allow' },
  { id: 'less',    pattern: /^less\s/,   decision: 'allow' },
  { id: 'more',    pattern: /^more\s/,   decision: 'allow' },
  { id: 'head',    pattern: /^head\s/,   decision: 'allow' },
  { id: 'tail',    pattern: /^tail\s/,   decision: 'allow' },
  { id: 'ls',      pattern: /^ls\b/,     decision: 'allow' },
  { id: 'dir',     pattern: /^dir\b/,    decision: 'allow' },
  { id: 'pwd',     pattern: /^pwd\s*$/,  decision: 'allow' },
  { id: 'echo',    pattern: /^echo\s/,   decision: 'allow' },
  { id: 'which',   pattern: /^which\s/,  decision: 'allow' },
  { id: 'where',   pattern: /^where\s/,  decision: 'allow' },
  { id: 'whoami',  pattern: /^whoami\s*$/, decision: 'allow' },
  { id: 'env',     pattern: /^env\s*$|^env\s+\|\s/, decision: 'allow' },
  { id: 'date',    pattern: /^date\s*$|^date\s+\+/, decision: 'allow' },
  { id: 'uname',   pattern: /^uname\b/,  decision: 'allow' },
  { id: 'file',    pattern: /^file\s/,   decision: 'allow' },
  { id: 'wc',      pattern: /^wc\s/,     decision: 'allow' },
  { id: 'stat',    pattern: /^stat\s/,   decision: 'allow' },
  // Git read ops
  {
    id: 'git-read',
    pattern: /^git\s+(status|log|diff|show|branch|tag|remote(\s+-v)?|stash\s+list|config\s+--get|reflog|describe|blame|rev-parse|ls-files)\b/,
    decision: 'allow',
  },
  // npm/pnpm/yarn read ops
  {
    id: 'npm-read',
    pattern: /^(npm|pnpm|yarn)\s+(list|ls|view|info|outdated|audit|why|exec|run\s+--list)\b/,
    decision: 'allow',
  },
  // pip / python read ops
  {
    id: 'pip-read',
    pattern: /^(pip|pip3)\s+(list|show|freeze|check|search)\b/,
    decision: 'allow',
  },
  // Process listing
  {
    id: 'process-list',
    pattern: /^(ps|top|htop|tasklist|jobs)\b/,
    decision: 'allow',
  },
];

function compileMatcher(p: RegExp | string, anchor: boolean): RegExp {
  if (p instanceof RegExp) return p;
  return new RegExp(anchor ? `^${p}` : p);
}

function applyRule(cmd: string, rule: ExecRule): boolean {
  if (!compileMatcher(rule.pattern, true).test(cmd)) return false;
  if (rule.match && !compileMatcher(rule.match, false).test(cmd)) return false;
  if (rule.notMatch && compileMatcher(rule.notMatch, false).test(cmd)) return false;
  return true;
}

/**
 * Evaluate a bash command against the policy. Returns the FIRST
 * matching rule's decision. If nothing matches, returns
 * { decision: 'prompt' } so the user's configured permission mode
 * decides — i.e. a no-op for `auto` (non-destructive tools pass)
 * and a single prompt for `ask`.
 */
export function evaluateCommand(cmd: string, rules: ExecRule[] = DEFAULT_RULES): PolicyResult {
  const c = cmd.trim();
  if (!c) return { decision: 'prompt' };
  for (const r of rules) {
    if (applyRule(c, r)) {
      return { decision: r.decision, reason: r.reason, ruleId: r.id };
    }
  }
  // No rule matched — defer to the normal permission flow
  return { decision: 'prompt' };
}
