/**
 * Skills system — reusable prompt templates extracted from instincts or git history.
 * Data stored in ~/.grawkus/skills/
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getConfigDir } from './config.js';
import type { Instinct } from './learning.js';

const SKILLS_DIR = join(getConfigDir(), 'skills');

export interface Skill {
  id: string;
  name: string;
  description: string;
  prompt: string;           // template with {{placeholders}}
  triggers: string[];       // keywords that activate this skill
  category: string;
  createdAt: string;
  useCount: number;
}

function ensureDir(): void {
  mkdirSync(SKILLS_DIR, { recursive: true });
}

function skillPath(id: string): string {
  return join(SKILLS_DIR, `${id}.json`);
}

function genId(): string {
  return `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createSkill(
  name: string,
  description: string,
  prompt: string,
  triggers: string[],
  category = 'general',
): Skill {
  ensureDir();

  const skill: Skill = {
    id: genId(),
    name,
    description,
    prompt,
    triggers,
    category,
    createdAt: new Date().toISOString(),
    useCount: 0,
  };

  saveSkill(skill);
  return skill;
}

export function saveSkill(skill: Skill): void {
  ensureDir();
  writeFileSync(skillPath(skill.id), JSON.stringify(skill, null, 2), 'utf-8');
}

export function loadSkill(id: string): Skill | null {
  const p = skillPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function listSkills(): Skill[] {
  ensureDir();
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.json'));
  const skills: Skill[] = [];
  for (const file of files) {
    try {
      skills.push(JSON.parse(readFileSync(join(SKILLS_DIR, file), 'utf-8')));
    } catch { /* skip */ }
  }
  return skills.sort((a, b) => b.useCount - a.useCount);
}

export function deleteSkill(id: string): boolean {
  const p = skillPath(id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

/**
 * Fuzzy match by trigger keywords. Returns the first matching skill.
 */
export function findSkill(query: string): Skill | null {
  const all = listSkills();
  const queryLower = query.toLowerCase();

  // Exact match on trigger
  for (const skill of all) {
    if (skill.triggers.some((t) => t.toLowerCase() === queryLower)) {
      return skill;
    }
  }

  // Partial match on trigger or name
  for (const skill of all) {
    const allText = `${skill.name} ${skill.triggers.join(' ')}`.toLowerCase();
    if (allText.includes(queryLower)) {
      return skill;
    }
  }

  return null;
}

/**
 * Apply skill by replacing {{placeholders}} with variables.
 */
export function applySkill(skill: Skill, variables: Record<string, string>): string {
  let result = skill.prompt;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder, 'g'), value);
  }
  return result;
}

/**
 * Cluster high-confidence instincts into reusable skills.
 * Groups by category, merges similar patterns.
 */
export function evolveInstinctsToSkills(instincts: Instinct[]): Skill[] {
  const created: Skill[] = [];

  // Group by category
  const byCategory = new Map<string, Instinct[]>();
  for (const inst of instincts) {
    if (inst.confidence < 0.6) continue; // Only use high-confidence instincts
    const cat = inst.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(inst);
  }

  // Convert each instinct group to a skill
  for (const [category, instList] of byCategory) {
    for (const inst of instList) {
      // Create a skill from this instinct
      const skillName = `${category}-${inst.id.slice(0, 8)}`;
      const triggers = [category, ...inst.pattern.split(/\s+/).slice(0, 3)];

      const skill = createSkill(
        skillName,
        inst.context,
        inst.pattern, // use pattern as prompt template
        triggers,
        category,
      );
      created.push(skill);
    }
  }

  return created;
}

/**
 * Increment useCount when a skill is applied.
 */
export function recordSkillUsage(id: string): void {
  const skill = loadSkill(id);
  if (skill) {
    skill.useCount++;
    saveSkill(skill);
  }
}

export function printSkillList(): void {
  const skills = listSkills();
  console.log(chalk.cyan(`\n  Skills: ${skills.length} total`));

  if (skills.length === 0) {
    console.log(chalk.dim('  (no skills yet)'));
    console.log();
    return;
  }

  const byCat = new Map<string, number>();
  for (const s of skills) {
    byCat.set(s.category, (byCat.get(s.category) || 0) + 1);
  }

  for (const [cat, count] of Array.from(byCat.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(chalk.dim(`  ${cat}: ${count}`));
  }

  console.log(chalk.dim(`\n  Most used:`));
  for (const skill of skills.slice(0, 5)) {
    const triggers = skill.triggers.slice(0, 2).join(', ');
    console.log(chalk.dim(`    [${skill.useCount}x] ${skill.name} (${triggers})`));
  }
  console.log();
}
