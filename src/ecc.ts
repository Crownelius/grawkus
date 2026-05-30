/**
 * ECC (everything-claude-code) integration.
 *
 * Imports skills, agents, slash commands, rules, and hook behaviors from the
 * bundled `resources/ecc/` directory into Grawkus's runtime stores:
 *   ~/.grawkus/skills/        — JSON skills generated from SKILL.md
 *   ~/.grawkus/rules/         — language rule files
 *   ~/.grawkus/ecc-commands/  — markdown prompt templates for /ecc-<cmd>
 *   ~/.grawkus/ecc-agents/    — agent prompt templates
 *   ~/.grawkus/hooks.json     — augmented with ECC hook entries
 *
 * Each ECC skill becomes a Grawkus Skill (skills.ts schema) with id
 * `ecc-<slug>`, triggers derived from name + description keywords, and the
 * SKILL.md body as the prompt template.
 *
 * The import is idempotent — re-running overwrites prior ECC entries but
 * leaves user-created skills/rules/hooks alone (ECC entries are scoped by
 * id prefix `ecc-` or `ecc:` category).
 */
import {
  readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync,
  copyFileSync, unlinkSync,
} from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { getConfigDir } from './config.js';
import { saveSkill, listSkills, deleteSkill, type Skill } from './skills.js';
import { addHook, listHooks, saveHooksConfig, type HookDef } from './hooks.js';

// ── Resource resolution ─────────────────────────────────
// resources/ live one level above the compiled dist/ (and one above src/).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESOURCES_ROOT = resolve(__dirname, '..', 'resources', 'ecc');

const ECC_SKILLS_SRC   = join(RESOURCES_ROOT, 'skills');
const ECC_AGENTS_SRC   = join(RESOURCES_ROOT, 'agents');
const ECC_COMMANDS_SRC = join(RESOURCES_ROOT, 'commands');
const ECC_PROMPTS_SRC  = join(RESOURCES_ROOT, 'prompts');
const ECC_RULES_SRC    = join(RESOURCES_ROOT, 'rules');

const RULES_DIR        = join(getConfigDir(), 'rules');
const ECC_COMMANDS_DST = join(getConfigDir(), 'ecc-commands');
const ECC_AGENTS_DST   = join(getConfigDir(), 'ecc-agents');
const ECC_STATE_FILE   = join(getConfigDir(), 'ecc-state.json');

const ECC_SKILL_ID_PREFIX = 'ecc-';
const ECC_HOOK_TAG = '__ecc__';

/**
 * Bundle version. Bumped whenever resources/ecc/ is refreshed from
 * upstream OR when the seedHooks() set materially changes.
 *
 * History:
 *   '1.0.0' — initial bundle (33 skills, 16 agents, 3 commands, flat rules)
 *   '2.0.0' — refreshed from upstream 2.0.0-rc.1
 *             (228 skills, 60 agents, 75 commands, 19 language rule subdirs;
 *              adds config-protection + simplified GateGuard hooks)
 *   '2.1.0' — adds quality-gate + format-typecheck-hint hooks (M1 leftovers)
 */
export const BUNDLE_VERSION = '2.1.0';

// ── State ───────────────────────────────────────────────
export interface EccState {
  installedAt: string;
  version: string;
  counts: {
    skills: number;
    agents: number;
    commands: number;
    rules: number;
    prompts: number;
  };
}

export function loadEccState(): EccState | null {
  if (!existsSync(ECC_STATE_FILE)) return null;
  try { return JSON.parse(readFileSync(ECC_STATE_FILE, 'utf-8')); } catch { return null; }
}

function saveEccState(s: EccState): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(ECC_STATE_FILE, JSON.stringify(s, null, 2), 'utf-8');
}

export function eccResourcesAvailable(): boolean {
  return existsSync(RESOURCES_ROOT) && existsSync(ECC_SKILLS_SRC);
}

// ── Frontmatter parser ──────────────────────────────────
interface ParsedDoc {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Minimal YAML frontmatter parser — handles the subset used by ECC:
 *   key: value
 *   key: "value with: colons"
 *   key:
 *     - item1
 *     - item2
 *   key: ["a", "b"]
 * Anything more exotic is preserved as raw string.
 */
function parseFrontmatter(raw: string): ParsedDoc {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { frontmatter: {}, body: raw };
  const yamlBlock = raw.slice(3, end).replace(/^\r?\n/, '');
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');

  const fm: Record<string, unknown> = {};
  const lines = yamlBlock.split(/\r?\n/);
  let currentKey: string | null = null;
  let listAcc: string[] | null = null;

  const stripQuotes = (s: string): string => {
    const t = s.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1);
    }
    return t;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch && currentKey && listAcc) {
      listAcc.push(stripQuotes(listMatch[1]));
      continue;
    }
    // commit previous list
    if (currentKey && listAcc) {
      fm[currentKey] = listAcc;
      listAcc = null;
      currentKey = null;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const valRaw = kv[2];
    if (valRaw === '' || valRaw === undefined) {
      // start of multi-line value (list)
      currentKey = key;
      listAcc = [];
      continue;
    }
    // inline array
    if (valRaw.startsWith('[') && valRaw.endsWith(']')) {
      const inner = valRaw.slice(1, -1).trim();
      const items = inner.length
        ? inner.split(',').map(s => stripQuotes(s))
        : [];
      fm[key] = items;
      continue;
    }
    fm[key] = stripQuotes(valRaw);
  }
  // flush trailing list
  if (currentKey && listAcc) fm[currentKey] = listAcc;

  return { frontmatter: fm, body };
}

// ── Trigger derivation ──────────────────────────────────
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'when', 'use', 'used',
  'using', 'from', 'into', 'onto', 'a', 'an', 'of', 'to', 'in', 'on',
  'as', 'by', 'is', 'are', 'be', 'been', 'or', 'but', 'not', 'all',
  'any', 'some', 'must', 'should', 'must', 'will', 'can', 'skill',
  'workflow', 'pattern', 'patterns', 'rules', 'rule', 'using',
]);

function deriveTriggers(name: string, description: string, extras: string[] = []): string[] {
  const triggers = new Set<string>();
  // slug parts of name
  for (const part of name.toLowerCase().split(/[-_\s]+/)) {
    if (part.length >= 3) triggers.add(part);
  }
  triggers.add(name.toLowerCase());
  // first 60 chars of description, keywords
  const descSample = description.toLowerCase().slice(0, 200);
  for (const word of descSample.split(/[^a-z0-9]+/)) {
    if (word.length >= 5 && !STOPWORDS.has(word)) triggers.add(word);
  }
  for (const e of extras) {
    const norm = e.toLowerCase().trim();
    if (norm.length >= 3) triggers.add(norm);
  }
  return Array.from(triggers).slice(0, 12);
}

// ── Skill import ────────────────────────────────────────
function listSkillDirs(): string[] {
  if (!existsSync(ECC_SKILLS_SRC)) return [];
  return readdirSync(ECC_SKILLS_SRC)
    .map(n => join(ECC_SKILLS_SRC, n))
    .filter(p => {
      try { return statSync(p).isDirectory(); } catch { return false; }
    });
}

function readSkillMd(dir: string): { raw: string; references: string[] } | null {
  const skillPath = join(dir, 'SKILL.md');
  if (!existsSync(skillPath)) return null;
  const raw = readFileSync(skillPath, 'utf-8');
  // Pull in sibling reference docs if present (e.g. STYLE_PRESETS.md)
  const references: string[] = [];
  for (const f of readdirSync(dir)) {
    if (f === 'SKILL.md') continue;
    if (!f.endsWith('.md')) continue;
    references.push(readFileSync(join(dir, f), 'utf-8'));
  }
  // Also pull in references/ subdir
  const refDir = join(dir, 'references');
  if (existsSync(refDir)) {
    try {
      for (const f of readdirSync(refDir)) {
        if (f.endsWith('.md')) {
          references.push(readFileSync(join(refDir, f), 'utf-8'));
        }
      }
    } catch { /* ignore */ }
  }
  return { raw, references };
}

function eccSkillId(slug: string): string {
  return `${ECC_SKILL_ID_PREFIX}${slug}`;
}

export interface ImportReport {
  skills: number;
  agents: number;
  commands: number;
  rules: number;
  prompts: number;
  errors: string[];
}

function importSkills(): { count: number; errors: string[] } {
  const errors: string[] = [];
  // Clean prior ECC skills first so renames don't leave stragglers
  for (const s of listSkills()) {
    if (s.id.startsWith(ECC_SKILL_ID_PREFIX)) {
      deleteSkill(s.id);
    }
  }
  let count = 0;
  for (const dir of listSkillDirs()) {
    const slug = basename(dir);
    try {
      const doc = readSkillMd(dir);
      if (!doc) continue;
      const { frontmatter, body } = parseFrontmatter(doc.raw);
      const name = String(frontmatter.name || slug);
      const description = String(frontmatter.description || `ECC skill: ${slug}`);
      const triggers = deriveTriggers(name, description, [slug]);
      const fullBody = doc.references.length
        ? body + '\n\n---\n\n' + doc.references.join('\n\n---\n\n')
        : body;
      const skill: Skill = {
        id: eccSkillId(slug),
        name,
        description,
        prompt: fullBody.trim(),
        triggers,
        category: 'ecc',
        createdAt: new Date().toISOString(),
        useCount: 0,
      };
      saveSkill(skill);
      count++;
    } catch (err) {
      errors.push(`skill ${slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { count, errors };
}

// ── Agent import ────────────────────────────────────────
/**
 * Kiro agents are JSON + MD pairs:
 *   <name>.json  — { name, description, prompt, allowedTools, ... }
 *   <name>.md    — frontmatter (name, description, allowedTools) + body prompt
 *
 * We materialize each as a markdown file in ~/.grawkus/ecc-agents/<name>.md
 * (canonical prompt for /ecc-agent <name>) and ALSO register a Grawkus Skill
 * with id `ecc-agent-<name>` so it surfaces in /skills and trigger search.
 */
function importAgents(): { count: number; errors: string[] } {
  const errors: string[] = [];
  if (!existsSync(ECC_AGENTS_SRC)) return { count: 0, errors };

  mkdirSync(ECC_AGENTS_DST, { recursive: true });

  // Clean prior agent skills
  for (const s of listSkills()) {
    if (s.id.startsWith(`${ECC_SKILL_ID_PREFIX}agent-`)) {
      deleteSkill(s.id);
    }
  }

  // Discover agent slugs from either .json or .md files. The upstream
  // bundle shape changed:
  //   pre-2.0:  each agent had `<slug>.json` (metadata) + `<slug>.md` (prompt)
  //   2.0+:     only `<slug>.md` with YAML frontmatter (name, description,
  //             tools, model, etc.) and the prompt as body
  // We accept both layouts. Slug is the basename without extension; if
  // both exist for the same slug we use the .json as authoritative.
  let count = 0;
  const all = readdirSync(ECC_AGENTS_SRC);
  const slugs = new Set<string>();
  for (const f of all) {
    if (f.endsWith('.json')) slugs.add(f.replace(/\.json$/, ''));
    else if (f.endsWith('.md')) slugs.add(f.replace(/\.md$/, ''));
  }
  for (const slug of slugs) {
    try {
      const jsonPath = join(ECC_AGENTS_SRC, `${slug}.json`);
      const mdPath = join(ECC_AGENTS_SRC, `${slug}.md`);
      let prompt = '';
      let description = `ECC agent: ${slug}`;
      let allowed: string[] = [];
      if (existsSync(jsonPath)) {
        const jsonRaw = readFileSync(jsonPath, 'utf-8');
        const json = JSON.parse(jsonRaw) as Record<string, unknown>;
        prompt = String(json.prompt || '');
        description = String(json.description || description);
        allowed = (json.allowedTools as string[]) || [];
      }
      if (existsSync(mdPath)) {
        const md = readFileSync(mdPath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(md);
        if (body.trim().length > prompt.length) prompt = body.trim();
        if (frontmatter.description) description = String(frontmatter.description);
        // Frontmatter `tools` is the 2.0 location for allowed-tools
        const fmTools = frontmatter.tools;
        if (Array.isArray(fmTools)) allowed = fmTools.map((t) => String(t));
        else if (typeof fmTools === 'string') {
          allowed = fmTools.split(',').map((t) => t.trim()).filter(Boolean);
        }
      }
      // Skip if neither file produced a non-empty prompt
      if (!prompt.trim()) continue;

      // Write canonical agent prompt to ecc-agents dir
      const agentDoc = [
        `# ${slug}`,
        '',
        `> ${description}`,
        '',
        `**Allowed tools**: ${allowed.length ? allowed.join(', ') : '(any)'}`,
        '',
        prompt,
      ].join('\n');
      writeFileSync(join(ECC_AGENTS_DST, `${slug}.md`), agentDoc, 'utf-8');

      // Register a skill so it surfaces in /skills + trigger search
      const triggers = deriveTriggers(slug, description, [slug, 'agent']);
      saveSkill({
        id: `${ECC_SKILL_ID_PREFIX}agent-${slug}`,
        name: `agent: ${slug}`,
        description,
        prompt,
        triggers,
        category: 'ecc-agent',
        createdAt: new Date().toISOString(),
        useCount: 0,
      });
      count++;
    } catch (err) {
      errors.push(`agent ${slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { count, errors };
}

// ── Command + prompt import ─────────────────────────────
/**
 * .claude/commands/<name>.md and .github/prompts/<name>.prompt.md are both
 * frontmatter+body prompt templates. We copy them verbatim into
 * ~/.grawkus/ecc-commands/ so /ecc-<name> can read them at runtime.
 */
// Commands whose prompts are already loaded by built-in slash commands
// (/tdd, /review, /security-review, /plan, /refactor, /build-fix all call
// buildUnifiedPrompt which prefers the ECC prompt). Registering them as
// auto-matchable skills too would double-inject into the system prompt.
// Skip these in the skill registration pass.
const BUILTIN_BACKED_COMMANDS = new Set([
  'tdd', 'code-review', 'security-review', 'plan', 'refactor', 'build-fix',
]);

// Domain-specific trigger boost: hint keywords that should activate a
// particular ECC command. Generic keyword derivation from filenames covers
// the obvious cases, but these strengthen the match on natural-language
// requests the user is likely to phrase ("add a migration", "implement a
// feature", "add typescript rules").
const ECC_COMMAND_EXTRA_TRIGGERS: Record<string, string[]> = {
  'feature-development': [
    'feature', 'feature implementation', 'implement', 'add feature',
    'new feature', 'develop', 'build feature',
  ],
  'database-migration': [
    'migration', 'migrations', 'schema', 'schema change', 'alter table',
    'add column', 'add table', 'drop table', 'database change', 'db migration',
    'create table', 'rls policy', 'sql migration',
  ],
  'add-language-rules': [
    'language rules', 'coding style', 'style guide', 'add rules',
    'typescript rules', 'python rules', 'lint rules', 'project rules',
  ],
};

function importCommandsAndPrompts(): { commands: number; prompts: number; errors: string[] } {
  const errors: string[] = [];
  let commands = 0;
  let prompts = 0;

  mkdirSync(ECC_COMMANDS_DST, { recursive: true });

  // Wipe prior ECC commands
  for (const f of readdirSync(ECC_COMMANDS_DST)) {
    try { unlinkSync(join(ECC_COMMANDS_DST, f)); } catch { /* ignore */ }
  }

  // Clean prior command-derived skills so renames/deletions upstream don't
  // leave stragglers in the skill registry.
  for (const s of listSkills()) {
    if (s.id.startsWith(`${ECC_SKILL_ID_PREFIX}command-`)) {
      deleteSkill(s.id);
    }
  }

  const copyMd = (srcDir: string, suffix = ''): number => {
    if (!existsSync(srcDir)) return 0;
    let n = 0;
    for (const f of readdirSync(srcDir)) {
      if (!f.endsWith('.md')) continue;
      const src = join(srcDir, f);
      try {
        const stat = statSync(src);
        if (!stat.isFile()) continue;
      } catch { continue; }
      const baseName = f.replace(/\.prompt\.md$/, '').replace(/\.md$/, '');
      const dst = join(ECC_COMMANDS_DST, `${baseName}${suffix}.md`);
      copyFileSync(src, dst);

      // ALSO register as an auto-matchable skill — but only commands that
      // don't have a built-in `/tdd`/`/review`/etc. equivalent. Otherwise we'd
      // double-inject into the system prompt.
      if (!BUILTIN_BACKED_COMMANDS.has(baseName)) {
        try {
          const raw = readFileSync(src, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(raw);
          const description = String(frontmatter.description || `ECC workflow: ${baseName}`);
          const extras = ECC_COMMAND_EXTRA_TRIGGERS[baseName] || [];
          const triggers = deriveTriggers(baseName, description, [baseName, 'workflow', ...extras]);
          saveSkill({
            id: `${ECC_SKILL_ID_PREFIX}command-${baseName}${suffix}`,
            name: `workflow: ${baseName}`,
            description,
            prompt: body.trim(),
            triggers,
            category: 'ecc-command',
            createdAt: new Date().toISOString(),
            useCount: 0,
          });
        } catch (err) {
          errors.push(`command-skill ${baseName}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      n++;
    }
    return n;
  };

  try { commands = copyMd(ECC_COMMANDS_SRC); }
  catch (err) { errors.push(`commands: ${err instanceof Error ? err.message : err}`); }

  try { prompts = copyMd(ECC_PROMPTS_SRC); }
  catch (err) { errors.push(`prompts: ${err instanceof Error ? err.message : err}`); }

  return { commands, prompts, errors };
}

export function listEccCommands(): string[] {
  if (!existsSync(ECC_COMMANDS_DST)) return [];
  return readdirSync(ECC_COMMANDS_DST)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''))
    .sort();
}

/**
 * Resolve a `/ecc-<name>` command to its prompt body. Frontmatter is stripped;
 * if `allowed_tools` is set, it's preserved as a note at the top.
 */
export function getEccCommandPrompt(name: string): string | null {
  const path = join(ECC_COMMANDS_DST, `${name}.md`);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const header: string[] = [];
  if (frontmatter.description) header.push(`> ${frontmatter.description}`);
  if (frontmatter.allowed_tools) {
    const tools = Array.isArray(frontmatter.allowed_tools)
      ? frontmatter.allowed_tools.join(', ')
      : String(frontmatter.allowed_tools);
    header.push(`> Allowed tools: ${tools}`);
  }
  return [...header, '', body].join('\n').trim();
}

// ── Rules import ────────────────────────────────────────
/**
 * ECC ships per-language rules. Two layouts are supported:
 *
 *   OLD (pre-2.0):  rules/<lang>-<section>.md  (flat)
 *   NEW (2.0+):     rules/<lang>/<section>.md  (subdir per language)
 *
 * The upstream 2.0 refresh introduced the subdir layout AND added more
 * sections (security, testing, patterns, hooks plus a few new ones like
 * coding-style). We detect which layout is present and load accordingly.
 *
 * Both produce the same output: one `~/.grawkus/rules/<language>.md`
 * file per language, with all sections concatenated. Existing user
 * content in those files is preserved by appending under a clearly-marked
 * ECC section.
 */
function importRules(): { count: number; errors: string[] } {
  const errors: string[] = [];
  if (!existsSync(ECC_RULES_SRC)) return { count: 0, errors };

  mkdirSync(RULES_DIR, { recursive: true });

  const byLang = new Map<string, string[]>();

  // Walk ECC_RULES_SRC. For each entry:
  //   - If it's a .md file matching `<lang>-<section>.md` → old layout
  //   - If it's a directory → new layout; read `<section>.md` files inside
  for (const entry of readdirSync(ECC_RULES_SRC, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const m = entry.name.match(/^([a-z]+)-([a-z-]+)\.md$/);
      if (!m) continue;
      const [, lang, section] = m;
      const content = readFileSync(join(ECC_RULES_SRC, entry.name), 'utf-8');
      if (!byLang.has(lang)) byLang.set(lang, []);
      byLang.get(lang)!.push(`## ${section}\n\n${content.trim()}`);
    } else if (entry.isDirectory()) {
      const lang = entry.name;
      // Skip the `zh` directory — Chinese translations, not language rules
      if (lang === 'zh') continue;
      const subdir = join(ECC_RULES_SRC, lang);
      let subEntries: string[] = [];
      try { subEntries = readdirSync(subdir); } catch { continue; }
      for (const sub of subEntries) {
        if (!sub.endsWith('.md')) continue;
        const section = sub.replace(/\.md$/, '');
        const content = readFileSync(join(subdir, sub), 'utf-8');
        if (!byLang.has(lang)) byLang.set(lang, []);
        byLang.get(lang)!.push(`## ${section}\n\n${content.trim()}`);
      }
    }
  }

  let count = 0;
  for (const [lang, sections] of byLang.entries()) {
    try {
      const dst = join(RULES_DIR, `${lang}.md`);
      const ECC_BEGIN = '<!-- ECC-RULES:BEGIN -->';
      const ECC_END = '<!-- ECC-RULES:END -->';
      const eccBlock = [
        ECC_BEGIN,
        `# ${lang} — everything-claude-code rules`,
        '',
        sections.join('\n\n---\n\n'),
        ECC_END,
      ].join('\n');

      let final = eccBlock;
      if (existsSync(dst)) {
        const existing = readFileSync(dst, 'utf-8');
        // Strip prior ECC block before appending
        const stripped = existing.replace(
          new RegExp(`${ECC_BEGIN}[\\s\\S]*?${ECC_END}`, 'g'),
          '',
        ).trim();
        final = stripped ? `${stripped}\n\n${eccBlock}` : eccBlock;
      }
      writeFileSync(dst, final, 'utf-8');
      count++;
    } catch (err) {
      errors.push(`rules ${lang}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { count, errors };
}

// ── Hook seeding ────────────────────────────────────────
/**
 * Seeds Grawkus's hooks.json with ECC-compatible default hooks.
 *
 * The cursor hook scripts have a dense in-repo dependency tree (scripts/lib/,
 * scripts/hooks/) and require their original directory layout — we don't try
 * to run them from Grawkus. Instead we install native equivalents for the
 * highest-value ECC hook behaviors: block-no-verify, secret-in-prompt detection,
 * console.log warnings post-edit, dev-server tmux reminder.
 *
 * Each hook entry is tagged with __ecc__ so /ecc-install can refresh them
 * without touching user-defined hooks.
 */
function seedHooks(): number {
  const installDir = resolve(__dirname, '..');
  const hookScript = join(installDir, 'bin', 'ecc-hooks.cjs');
  if (!existsSync(hookScript)) return 0;

  const nodeBin = process.platform === 'win32' ? 'node' : 'node';

  // Strip prior ECC-tagged hooks
  const existing = listHooks().filter(h => !h.command.includes(ECC_HOOK_TAG));

  const eccHooks: HookDef[] = [
    {
      event: 'PreToolUse',
      match: 'bash',
      command: `${nodeBin} "${hookScript}" block-no-verify ${ECC_HOOK_TAG}`,
      blocking: true,
      enabled: true,
      timeout: 5000,
    },
    {
      event: 'PreToolUse',
      match: 'bash',
      command: `${nodeBin} "${hookScript}" dev-server-tmux ${ECC_HOOK_TAG}`,
      blocking: false,
      enabled: true,
      timeout: 5000,
    },
    {
      event: 'PreToolUse',
      match: 'read_file',
      command: `${nodeBin} "${hookScript}" sensitive-file ${ECC_HOOK_TAG}`,
      blocking: false,
      enabled: true,
      timeout: 5000,
    },
    {
      event: 'PostToolUse',
      match: 'edit_file',
      command: `${nodeBin} "${hookScript}" console-log-warn ${ECC_HOOK_TAG}`,
      blocking: false,
      enabled: true,
      timeout: 5000,
    },
    {
      event: 'PostToolUse',
      match: 'write_file',
      command: `${nodeBin} "${hookScript}" console-log-warn ${ECC_HOOK_TAG}`,
      blocking: false,
      enabled: true,
      timeout: 5000,
    },
    // ── New in 1.11: config-protection ──────────────────
    // Blocks edits to linter/formatter config files. Most common
    // failure mode it prevents: agent hits a lint error, "fixes" it
    // by relaxing the eslint/tsconfig rule instead of the source file.
    {
      event: 'PreToolUse',
      match: 'write_file',
      command: `${nodeBin} "${hookScript}" config-protection ${ECC_HOOK_TAG}`,
      blocking: true,
      enabled: true,
      timeout: 5000,
    },
    {
      event: 'PreToolUse',
      match: 'edit_file',
      command: `${nodeBin} "${hookScript}" config-protection ${ECC_HOOK_TAG}`,
      blocking: true,
      enabled: true,
      timeout: 5000,
    },
    // ── New in 1.11: GateGuard fact-forcing ─────────────
    // Blocks the FIRST Edit/Write to each file per session and demands
    // the agent investigate (read + grep) before proceeding. Upstream
    // reports a 2.25-point quality lift in A/B tests. Simplified port
    // of the 878-line ECC original — per-session-per-file state in
    // ~/.grawkus/state/gateguard/<sessionId>.json. Subsequent edits
    // to the same file pass through normally.
    {
      event: 'PreToolUse',
      match: 'write_file',
      command: `${nodeBin} "${hookScript}" gateguard ${ECC_HOOK_TAG}`,
      blocking: true,
      enabled: true,
      timeout: 5000,
    },
    {
      event: 'PreToolUse',
      match: 'edit_file',
      command: `${nodeBin} "${hookScript}" gateguard ${ECC_HOOK_TAG}`,
      blocking: true,
      enabled: true,
      timeout: 5000,
    },
    // ── New in 1.17: quality-gate ───────────────────────
    // Post-edit reminder of language-specific lint/format commands
    // (eslint, prettier, ruff, golangci, rubocop). Non-blocking warn.
    {
      event: 'PostToolUse',
      match: 'write_file',
      command: `${nodeBin} "${hookScript}" quality-gate ${ECC_HOOK_TAG}`,
      blocking: false,
      enabled: true,
      timeout: 5000,
    },
    {
      event: 'PostToolUse',
      match: 'edit_file',
      command: `${nodeBin} "${hookScript}" quality-gate ${ECC_HOOK_TAG}`,
      blocking: false,
      enabled: true,
      timeout: 5000,
    },
    // ── New in 1.17: format-typecheck-hint ───────────────
    // Session-end-ish reminder to run typecheck (tsc / mypy / go vet
    // / cargo check). Fires at most once per session per project,
    // tracked at ~/.grawkus/state/quality-hint/<sessionId>.json.
    {
      event: 'PostToolUse',
      match: 'edit_file',
      command: `${nodeBin} "${hookScript}" format-typecheck-hint ${ECC_HOOK_TAG}`,
      blocking: false,
      enabled: true,
      timeout: 5000,
    },
    {
      event: 'PostToolUse',
      match: 'write_file',
      command: `${nodeBin} "${hookScript}" format-typecheck-hint ${ECC_HOOK_TAG}`,
      blocking: false,
      enabled: true,
      timeout: 5000,
    },
  ];

  saveHooksConfig({ hooks: [...existing, ...eccHooks] });
  return eccHooks.length;
}

/**
 * Re-seed ECC hooks against the CURRENT install path. Called on every
 * startup (when ECC is already installed) to self-heal stale absolute
 * paths from a prior install location. Idempotent.
 *
 * Safe to call repeatedly — strips and re-adds the __ecc__-tagged hooks
 * each time. Returns the number of hooks now seeded (0 if ecc-hooks.cjs
 * is missing on this machine, in which case we leave hooks.json alone).
 */
export function reseedEccHooks(): number {
  return seedHooks();
}

// ── Top-level install ───────────────────────────────────
export function installEcc(opts: { verbose?: boolean } = {}): ImportReport {
  if (!eccResourcesAvailable()) {
    return {
      skills: 0, agents: 0, commands: 0, rules: 0, prompts: 0,
      errors: [`ECC resources not found at ${RESOURCES_ROOT}`],
    };
  }

  mkdirSync(getConfigDir(), { recursive: true });

  const s = importSkills();
  const a = importAgents();
  const cp = importCommandsAndPrompts();
  const r = importRules();
  const hookCount = seedHooks();

  const report: ImportReport = {
    skills: s.count,
    agents: a.count,
    commands: cp.commands,
    rules: r.count,
    prompts: cp.prompts,
    errors: [...s.errors, ...a.errors, ...cp.errors, ...r.errors],
  };

  saveEccState({
    installedAt: new Date().toISOString(),
    version: BUNDLE_VERSION,
    counts: {
      skills: report.skills,
      agents: report.agents,
      commands: report.commands,
      rules: report.rules,
      prompts: report.prompts,
    },
  });

  if (opts.verbose) {
    console.log(chalk.cyan(`\n  ECC install complete:`));
    console.log(chalk.dim(`    skills:   ${report.skills}`));
    console.log(chalk.dim(`    agents:   ${report.agents}`));
    console.log(chalk.dim(`    commands: ${report.commands}`));
    console.log(chalk.dim(`    prompts:  ${report.prompts}`));
    console.log(chalk.dim(`    rules:    ${report.rules} languages`));
    console.log(chalk.dim(`    hooks:    ${hookCount} native hooks seeded`));
    if (report.errors.length) {
      console.log(chalk.yellow(`\n  ${report.errors.length} errors:`));
      for (const e of report.errors.slice(0, 5)) {
        console.log(chalk.dim(`    ${e}`));
      }
    }
  }

  return report;
}

// ── Status output ───────────────────────────────────────
export function printEccStatus(): void {
  const state = loadEccState();
  if (!state) {
    // First-launch auto-install in main() didn't run yet, or ECC resources
    // weren't bundled with this build. Surface the issue but don't ask the
    // user to do anything special — `/ecc refresh` is the manual path.
    console.log(chalk.yellow('\n  everything-claude-code'));
    console.log(chalk.dim('    not yet installed (auto-install usually runs on first launch)'));
    console.log(chalk.dim('    → /ecc refresh   to install now\n'));
    return;
  }
  console.log(chalk.cyan('\n  everything-claude-code') + chalk.green('  ✓ enabled'));
  console.log(chalk.dim(`    bundled, free, open source — auto-installed on first launch`));
  console.log(chalk.dim(`    v${state.version} · installed ${state.installedAt.slice(0, 10)}`));
  console.log(chalk.dim(`    ${state.counts.skills} skills · ${state.counts.agents} agents · ${state.counts.commands + state.counts.prompts} commands · ${state.counts.rules} language rule sets`));
  console.log('');
  console.log(chalk.dim('  Built-in commands use ECC prompts automatically:'));
  console.log(chalk.dim('    /tdd  /review  /security-review  /plan  /refactor  /build-fix'));
  console.log('');
  console.log(chalk.dim('  ECC-only workflows (no built-in equivalent):'));
  console.log(chalk.dim('    /ecc-feature-development  /ecc-add-language-rules  /ecc-database-migration'));
  console.log('');
  console.log(chalk.dim('  Diagnostics:  /ecc refresh  /ecc skills  /ecc agents  /ecc commands'));
  console.log();
}

export function printEccSkills(): void {
  const skills = listSkills().filter(s => s.id.startsWith(ECC_SKILL_ID_PREFIX) && !s.id.startsWith(`${ECC_SKILL_ID_PREFIX}agent-`));
  console.log(chalk.cyan(`\n  ECC skills: ${skills.length}`));
  for (const s of skills.sort((a, b) => a.name.localeCompare(b.name))) {
    const desc = s.description.length > 70 ? s.description.slice(0, 67) + '...' : s.description;
    console.log(chalk.dim(`    ${s.name.padEnd(28)} ${desc}`));
  }
  console.log();
}

export function printEccAgents(): void {
  const agents = listSkills().filter(s => s.id.startsWith(`${ECC_SKILL_ID_PREFIX}agent-`));
  console.log(chalk.cyan(`\n  ECC agents: ${agents.length}`));
  for (const a of agents.sort((x, y) => x.name.localeCompare(y.name))) {
    const desc = a.description.length > 70 ? a.description.slice(0, 67) + '...' : a.description;
    console.log(chalk.dim(`    ${a.name.padEnd(28)} ${desc}`));
  }
  console.log();
}

export function printEccCommandList(): void {
  const cmds = listEccCommands();
  console.log(chalk.cyan(`\n  ECC commands: ${cmds.length}`));
  for (const c of cmds) {
    console.log(chalk.dim(`    /ecc-${c}`));
  }
  console.log();
}

/**
 * Match the user's free-form text against ECC skill triggers and return the
 * top-matching skill prompt body, or null if nothing fires. Used to auto-inject
 * skill content into the system prompt — bumps relevance for that turn.
 */
export function findEccSkillForQuery(query: string): Skill | null {
  const hits = findEccSkillsForQuery(query, 1);
  return hits[0] ?? null;
}

let bundledSkillCache: Skill[] | null = null;

function loadBundledEccSkills(): Skill[] {
  if (bundledSkillCache) return bundledSkillCache;
  const skills: Skill[] = [];
  for (const dir of listSkillDirs()) {
    const slug = basename(dir);
    try {
      const doc = readSkillMd(dir);
      if (!doc) continue;
      const { frontmatter, body } = parseFrontmatter(doc.raw);
      const name = String(frontmatter.name || slug);
      const description = String(frontmatter.description || `ECC skill: ${slug}`);
      const prompt = doc.references.length
        ? body + '\n\n---\n\n' + doc.references.join('\n\n---\n\n')
        : body;
      skills.push({
        id: eccSkillId(slug),
        name,
        description,
        prompt: prompt.trim(),
        triggers: deriveTriggers(name, description, [slug]),
        category: 'ecc',
        createdAt: new Date(0).toISOString(),
        useCount: 0,
      });
    } catch {
      // A malformed bundled skill should not break prompt construction.
    }
  }
  bundledSkillCache = skills;
  return skills;
}

function listAvailableEccSkills(): Skill[] {
  const installed = listSkills().filter((s) => s.id.startsWith(ECC_SKILL_ID_PREFIX));
  return installed.length > 0 ? installed : loadBundledEccSkills();
}

/**
 * Same scoring as findEccSkillForQuery but returns the top-K hits.
 * Used by the progressive-disclosure system prompt injection to surface
 * multiple potentially-relevant skill names + descriptions without
 * burning the token budget on full prompt bodies.
 */
export function findEccSkillsForQuery(query: string, limit = 3): Skill[] {
  if (!query) return [];
  const q = query.toLowerCase();
  const candidates = listAvailableEccSkills();
  const scored: { skill: Skill; score: number }[] = [];
  for (const s of candidates) {
    let score = 0;
    for (const t of s.triggers) {
      if (q.includes(t.toLowerCase())) score += t.length;
    }
    if (score > 0) scored.push({ skill: s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.skill);
}

/**
 * Look up a skill by exact or substring name match. Used by the
 * skill_view tool to expand a Level-0 reference (name only) to the
 * Level-1 full prompt body the model needs to actually apply.
 */
export function findEccSkillByName(name: string): Skill | null {
  if (!name) return null;
  const target = name.toLowerCase().trim();
  const all = listAvailableEccSkills();
  return (
    all.find((s) => s.name.toLowerCase() === target)
    ?? all.find((s) => s.name.toLowerCase().includes(target))
    ?? null
  );
}
