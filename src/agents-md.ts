import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Tool } from './tools/types.js';

export type AgentsSectionKind = 'model' | 'tool';

export interface AgentsScopedSection {
  kind: AgentsSectionKind;
  selector: string;
  content: string;
}

export interface AgentsFileInstructions {
  filePath: string;
  relativePath: string;
  global: string;
  modelSections: AgentsScopedSection[];
  toolSections: AgentsScopedSection[];
  truncated: boolean;
}

export interface AgentsInstructionSet {
  root: string;
  cwd: string;
  files: AgentsFileInstructions[];
}

const AGENTS_FILE_NAMES = ['AGENTS.md', 'agents.md'] as const;
const MAX_FILE_CHARS = 50_000;
const MAX_SECTION_CHARS = 4_000;
const MAX_PROMPT_CHARS = 12_000;
const MAX_TOOL_INSTRUCTION_CHARS = 3_000;

function normalizeLines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function trimBlock(value: string): string {
  const lines = normalizeLines(value).split('\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

function capText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 38)).trimEnd()}\n[truncated by Grawkus for prompt budget]`;
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function findGitRootByCommand(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return null;
    const root = resolve(out);
    return isWithin(root, cwd) ? root : null;
  } catch {
    return null;
  }
}

function findGitRootByWalking(cwd: string): string | null {
  let cur = resolve(cwd);
  while (true) {
    const dotGit = join(cur, '.git');
    if (existsSync(dotGit)) return cur;
    const parent = resolve(cur, '..');
    if (parent === cur) return null;
    cur = parent;
  }
}

function normalizeCwd(cwd: string): string {
  const resolved = resolve(cwd || process.cwd());
  try {
    const stat = statSync(resolved);
    return stat.isDirectory() ? resolved : resolve(resolved, '..');
  } catch {
    return resolved;
  }
}

export function findAgentsRoot(cwd = process.cwd()): string {
  const normalized = normalizeCwd(cwd);
  return findGitRootByWalking(normalized) ?? findGitRootByCommand(normalized) ?? normalized;
}

function dirsFromRootToCwd(root: string, cwd: string): string[] {
  const normalizedRoot = resolve(root);
  const normalizedCwd = normalizeCwd(cwd);
  if (!isWithin(normalizedRoot, normalizedCwd)) return [normalizedCwd];

  const dirs = [normalizedRoot];
  const rel = relative(normalizedRoot, normalizedCwd);
  if (!rel) return dirs;

  let cur = normalizedRoot;
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    cur = join(cur, part);
    dirs.push(cur);
  }
  return dirs;
}

function firstAgentsFile(dir: string): string | null {
  for (const name of AGENTS_FILE_NAMES) {
    const candidate = join(dir, name);
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      // Ignore unreadable or racing files.
    }
  }
  return null;
}

function parseScopedHeading(line: string): { level: number; kind: AgentsSectionKind; selector: string } | null {
  const match = /^(#{1,6})\s+(Model|Tool)\s*:\s*(.+?)\s*#*\s*$/i.exec(line.trimEnd());
  if (!match) return null;
  const selector = match[3].trim();
  if (!selector) return null;
  return {
    level: match[1].length,
    kind: match[2].toLowerCase() as AgentsSectionKind,
    selector,
  };
}

function parseAnyHeading(line: string): { level: number } | null {
  const match = /^(#{1,6})\s+/.exec(line.trimEnd());
  return match ? { level: match[1].length } : null;
}

export function parseAgentsMarkdown(content: string): {
  global: string;
  modelSections: AgentsScopedSection[];
  toolSections: AgentsScopedSection[];
} {
  const globalLines: string[] = [];
  const modelSections: AgentsScopedSection[] = [];
  const toolSections: AgentsScopedSection[] = [];
  let active: { kind: AgentsSectionKind; selector: string; level: number; lines: string[] } | null = null;

  const flushActive = (): void => {
    if (!active) return;
    const content = capText(trimBlock(active.lines.join('\n')), MAX_SECTION_CHARS);
    if (content) {
      const section: AgentsScopedSection = {
        kind: active.kind,
        selector: active.selector,
        content,
      };
      if (active.kind === 'model') modelSections.push(section);
      else toolSections.push(section);
    }
    active = null;
  };

  for (const line of normalizeLines(content).split('\n')) {
    const scopedHeading = parseScopedHeading(line);
    if (scopedHeading) {
      flushActive();
      active = {
        kind: scopedHeading.kind,
        selector: scopedHeading.selector,
        level: scopedHeading.level,
        lines: [],
      };
      continue;
    }

    const heading = parseAnyHeading(line);
    if (active && heading && heading.level <= active.level) {
      flushActive();
    }

    if (active) active.lines.push(line);
    else globalLines.push(line);
  }

  flushActive();
  return {
    global: capText(trimBlock(globalLines.join('\n')), MAX_SECTION_CHARS),
    modelSections,
    toolSections,
  };
}

function readAgentsFile(filePath: string, root: string): AgentsFileInstructions | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const truncated = raw.length > MAX_FILE_CHARS;
    const parsed = parseAgentsMarkdown(raw.slice(0, MAX_FILE_CHARS));
    const rel = relative(root, filePath).replace(/\\/g, '/') || filePath;
    return {
      filePath,
      relativePath: rel,
      truncated,
      ...parsed,
    };
  } catch {
    return null;
  }
}

export function discoverAgentsInstructions(cwd = process.cwd()): AgentsInstructionSet {
  const normalizedCwd = normalizeCwd(cwd);
  const root = findAgentsRoot(normalizedCwd);
  const files: AgentsFileInstructions[] = [];

  for (const dir of dirsFromRootToCwd(root, normalizedCwd)) {
    const filePath = firstAgentsFile(dir);
    if (!filePath) continue;
    const parsed = readAgentsFile(filePath, root);
    if (parsed) files.push(parsed);
  }

  return { root, cwd: normalizedCwd, files };
}

function compileSlashRegex(value: string): RegExp | null {
  if (!value.startsWith('/')) return null;
  const lastSlash = value.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  try {
    return new RegExp(value.slice(1, lastSlash), value.slice(lastSlash + 1));
  } catch {
    return null;
  }
}

function selectorParts(selector: string): string[] {
  return selector.split(',').map((part) => part.trim()).filter(Boolean);
}

export function selectorMatches(selector: string, target: string): boolean {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) return false;
  for (const part of selectorParts(selector)) {
    if (part.toLowerCase() === normalizedTarget.toLowerCase()) return true;
    const slashRegex = compileSlashRegex(part);
    if (slashRegex) {
      if (slashRegex.test(normalizedTarget)) return true;
      continue;
    }
    try {
      if (new RegExp(part, 'i').test(normalizedTarget)) return true;
    } catch {
      // Invalid regex-like selectors fall back to case-insensitive exact
      // matching above. This keeps a typo from breaking startup.
    }
  }
  return false;
}

function matchingModelSections(file: AgentsFileInstructions, model: string): AgentsScopedSection[] {
  return file.modelSections.filter((section) => selectorMatches(section.selector, model));
}

function collectPromptBlocks(set: AgentsInstructionSet, model: string): string[] {
  const blocks: string[] = [];
  for (const file of set.files) {
    if (file.global) {
      blocks.push(`## ${file.relativePath}\n${file.global}${file.truncated ? '\n[AGENTS.md file was truncated before parsing]' : ''}`);
    }
    for (const section of matchingModelSections(file, model)) {
      blocks.push(`## ${file.relativePath} - Model: ${section.selector}\n${section.content}`);
    }
  }
  return blocks;
}

export function buildAgentsInstructionsPrompt(cwd: string, model: string): string {
  const set = discoverAgentsInstructions(cwd);
  const blocks = collectPromptBlocks(set, model);
  if (blocks.length === 0) return '';

  const body = capText(blocks.join('\n\n'), MAX_PROMPT_CHARS);
  return `\n# AGENTS.md Instructions\n` +
    `Repo-local AGENTS.md instructions were discovered from repository root to current directory. ` +
    `Follow them when they do not conflict with the user's latest request, Grawkus safety rules, permissions, or current file evidence. ` +
    `Later files are closer to the current directory and take precedence over earlier files when they conflict. ` +
    `Tool-scoped sections are attached to matching tool descriptions.\n\n` +
    body + '\n';
}

function collectToolInstructions(set: AgentsInstructionSet, toolName: string): string[] {
  const entries: string[] = [];
  for (const file of set.files) {
    for (const section of file.toolSections) {
      if (!selectorMatches(section.selector, toolName)) continue;
      entries.push(`From ${file.relativePath} (Tool: ${section.selector}):\n${section.content}`);
    }
  }
  return entries;
}

export function applyAgentToolInstructions(
  tools: Tool[],
  cwd: string,
  _model: string,
): Tool[] {
  const set = discoverAgentsInstructions(cwd);
  if (set.files.length === 0) return tools;

  let changed = false;
  const scopedTools = tools.map((tool) => {
    const entries = collectToolInstructions(set, tool.name);
    if (entries.length === 0) return tool;
    changed = true;
    const instructionText = capText(entries.join('\n\n'), MAX_TOOL_INSTRUCTION_CHARS);
    return {
      ...tool,
      description:
        `${tool.description}\n\n` +
        `AGENTS.md instructions for this tool, ordered from repository root to current directory. ` +
        `Follow these only when compatible with user instructions, Grawkus safety rules, and tool permissions:\n` +
        instructionText,
    };
  });

  return changed ? scopedTools : tools;
}

export function formatAgentsInstructionsReport(
  cwd: string,
  model: string,
  tools: Tool[] = [],
): string {
  const set = discoverAgentsInstructions(cwd);
  if (set.files.length === 0) {
    return `\n  No AGENTS.md files found from ${set.root} to ${set.cwd}.`;
  }

  const toolNames = tools.map((tool) => tool.name);
  const lines = [
    '',
    `  AGENTS.md files (${set.files.length})`,
    `  Root:  ${set.root}`,
    `  CWD:   ${set.cwd}`,
    `  Model: ${model}`,
    '',
  ];

  for (const file of set.files) {
    const matchingModels = matchingModelSections(file, model);
    const matchingTools = file.toolSections
      .map((section) => ({
        selector: section.selector,
        tools: toolNames.filter((name) => selectorMatches(section.selector, name)),
      }))
      .filter((entry) => entry.tools.length > 0);

    lines.push(`  - ${file.relativePath}`);
    if (file.global) lines.push(`    global: ${file.global.length} chars`);
    if (matchingModels.length > 0) {
      lines.push(`    model: ${matchingModels.map((section) => section.selector).join(', ')}`);
    }
    if (matchingTools.length > 0) {
      for (const entry of matchingTools) {
        lines.push(`    tool: ${entry.selector} -> ${entry.tools.join(', ')}`);
      }
    }
    if (file.truncated) lines.push('    note: file was truncated before parsing');
    if (!file.global && matchingModels.length === 0 && matchingTools.length === 0) {
      lines.push('    no active global/model/tool sections for this model and tool set');
    }
  }

  lines.push('');
  return lines.join('\n');
}
