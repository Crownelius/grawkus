/**
 * Code Map System — Project structure tracking and context injection.
 * Maintains a map of project structure, modules, and file relationships.
 */

import { execSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, relative, extname, dirname, basename } from 'node:path';
import chalk from 'chalk';
import { getConfigDir, getProjectStateDir } from './config.js';

export interface FileEntry {
  path: string;
  language: string;
  lineCount: number;
  exports: string[];
  imports: string[];
  localImports: string[];
  size: number;
}

export interface ModuleEntry {
  name: string;
  files: string[];
  description: string;
}

export interface CodeMap {
  projectRoot: string;
  files: FileEntry[];
  modules: ModuleEntry[];
  generatedAt: string;
  totalFiles: number;
  totalLines: number;
}

export interface RepoMapOptions {
  minFiles?: number;
  maxFiles?: number;
  maxChars?: number;
}

interface RankedFile {
  file: FileEntry;
  score: number;
  inbound: number;
}

const AUTO_REPO_MAP_CACHE = new Map<string, { createdAt: number; block: string | null }>();
const AUTO_REPO_MAP_TTL_MS = 10_000;

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c-header',
    '.hpp': 'cpp-header',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
  };
  return langMap[ext] || 'unknown';
}

/**
 * Extract exports from a code file using regex
 */
function extractExports(content: string, language: string): string[] {
  const exports: Set<string> = new Set();
  let match: RegExpExecArray | null;

  if (language === 'typescript' || language === 'javascript') {
    // Match "export function name", "export const name", "export class name", etc.
    const exportRegex = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type)\s+(\w+)/g;
    while ((match = exportRegex.exec(content)) !== null) {
      exports.add(match[1]);
    }

    // Match "export { name }"
    const destructureRegex = /export\s*\{\s*([^}]+)\s*\}/g;
    while ((match = destructureRegex.exec(content)) !== null) {
      const names = match[1].split(',').map((n) => n.trim().split(' as ')[0]);
      names.forEach((n) => n && exports.add(n));
    }
  } else if (language === 'python') {
    // Match "def name" and "class name" at module level
    const defRegex = /^(?:def|class)\s+(\w+)/gm;
    while ((match = defRegex.exec(content)) !== null) {
      exports.add(match[1]);
    }
  }

  return Array.from(exports).slice(0, 20); // Limit to 20 exports
}

/**
 * Extract imports from a code file
 */
function extractImports(content: string, language: string): { external: string[]; local: string[] } {
  const imports: Set<string> = new Set();
  const localImports: Set<string> = new Set();
  let match: RegExpExecArray | null;

  if (language === 'typescript' || language === 'javascript') {
    // Match import/export specifiers and CommonJS require().
    const importRegex = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = importRegex.exec(content)) !== null) {
      const source = match[1] || match[2];
      if (!source) continue;
      if (source.startsWith('.')) {
        localImports.add(source);
      } else {
        imports.add(source.split('/')[0]); // Get package name
      }
    }
  } else if (language === 'python') {
    // Match "import x" and "from x import y"
    const importRegex = /^(?:import\s+(\w+)|from\s+(\w+)\s+import)/gm;
    while ((match = importRegex.exec(content)) !== null) {
      const module = match[1] || match[2];
      if (module) imports.add(module);
    }
  }

  return {
    external: Array.from(imports).slice(0, 15),
    local: Array.from(localImports).slice(0, 30),
  };
}

/**
 * Count lines in a file
 */
function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

/**
 * Walk directory tree and collect file information
 */
function walkDirectory(
  dir: string,
  rootDir: string,
  ignorePatterns: string[] = ['node_modules', 'dist', '.git', 'build', 'coverage']
): FileEntry[] {
  const entries: FileEntry[] = [];
  const codeExtensions = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.py',
    '.go',
    '.rs',
    '.java',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.json',
    '.yaml',
    '.yml',
  ];

  try {
    const files = readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
      const fullPath = join(dir, file.name);
      const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');

      // Check if should ignore
      if (ignorePatterns.some((pattern) => relPath.includes(pattern))) {
        continue;
      }

      if (file.isDirectory()) {
        entries.push(...walkDirectory(fullPath, rootDir, ignorePatterns));
      } else if (codeExtensions.includes(extname(file.name))) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const language = detectLanguage(file.name);
          const lineCount = content.split('\n').length;
          const stats = statSync(fullPath);

          const imports = extractImports(content, language);
          entries.push({
            path: relPath,
            language,
            lineCount,
            exports: extractExports(content, language),
            imports: imports.external,
            localImports: imports.local,
            size: stats.size,
          });
        } catch {
          // Skip files we can't read
        }
      }
    }
  } catch {
    // Ignore directory read errors
  }

  return entries;
}

/**
 * Group files into modules by directory structure
 */
function groupIntoModules(files: FileEntry[]): ModuleEntry[] {
  const modules = new Map<string, string[]>();

  for (const file of files) {
    const parts = file.path.split('/');
    const moduleName = parts.length > 1 ? parts[0] : 'root';

    if (!modules.has(moduleName)) {
      modules.set(moduleName, []);
    }
    modules.get(moduleName)!.push(file.path);
  }

  return Array.from(modules.entries()).map(([name, files]) => ({
    name,
    files,
    description: `Module ${name} with ${files.length} files`,
  }));
}

/**
 * Generate a code map by scanning the project
 */
export function generateCodeMap(cwd: string): CodeMap {
  if (!existsSync(cwd)) {
    throw new Error(`Directory not found: ${cwd}`);
  }

  const files = walkDirectory(cwd, cwd);
  const modules = groupIntoModules(files);
  const totalLines = files.reduce((sum, f) => sum + f.lineCount, 0);

  return {
    projectRoot: cwd,
    files,
    modules,
    generatedAt: new Date().toISOString(),
    totalFiles: files.length,
    totalLines,
  };
}

function normalizeMapPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function withoutKnownExt(path: string): string {
  return normalizeMapPath(path).replace(/\.(tsx?|jsx?|py|go|rs|java|c|cpp|h|hpp|json|ya?ml)$/i, '');
}

function localImportTarget(fromPath: string, specifier: string): string {
  const fromDir = dirname(fromPath).replace(/\\/g, '/');
  return normalizeMapPath(join(fromDir, specifier));
}

function buildPathLookup(files: FileEntry[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const file of files) {
    const path = normalizeMapPath(file.path);
    const stem = withoutKnownExt(path);
    lookup.set(path, file.path);
    lookup.set(stem, file.path);
    if (basename(stem) === 'index') {
      lookup.set(dirname(stem).replace(/\\/g, '/'), file.path);
    }
  }
  return lookup;
}

function resolveLocalImport(fromPath: string, specifier: string, lookup: Map<string, string>): string | null {
  const target = localImportTarget(fromPath, specifier);
  const stem = withoutKnownExt(target);
  return lookup.get(target)
    ?? lookup.get(stem)
    ?? lookup.get(`${stem}/index`)
    ?? null;
}

function queryTerms(query: string | undefined): string[] {
  return Array.from(new Set(String(query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)))
    .slice(0, 20);
}

function rankCodeMapFiles(map: CodeMap, query?: string): RankedFile[] {
  const lookup = buildPathLookup(map.files);
  const inbound = new Map<string, number>();
  for (const file of map.files) inbound.set(file.path, 0);

  for (const file of map.files) {
    for (const spec of file.localImports ?? []) {
      const target = resolveLocalImport(file.path, spec, lookup);
      if (target && target !== file.path) {
        inbound.set(target, (inbound.get(target) ?? 0) + 1);
      }
    }
  }

  const terms = queryTerms(query);
  const entrypointRe = /(^|\/)(index|main|app|server|cli|grawkus)\.(tsx?|jsx?|py|go|rs|java)$/i;
  return map.files.map((file) => {
    const inboundCount = inbound.get(file.path) ?? 0;
    let score = 1;
    score += Math.min(file.exports.length, 12) * 2;
    score += inboundCount * 5;
    score += Math.min((file.localImports ?? []).length, 10);
    if (entrypointRe.test(file.path)) score += 8;
    if (file.path.includes('/test') || file.path.includes('.test.') || file.path.includes('.spec.')) score -= 2;

    const haystack = `${file.path} ${file.language} ${file.exports.join(' ')}`.toLowerCase();
    for (const term of terms) {
      if (haystack.includes(term)) score += 6;
    }
    return { file, score, inbound: inboundCount };
  }).sort((a, b) => b.score - a.score || b.inbound - a.inbound || a.file.path.localeCompare(b.file.path));
}

function renderRepoMap(map: CodeMap, ranked: RankedFile[], maxFiles: number, maxChars: number): string | null {
  if (map.totalFiles === 0) return null;
  const lines: string[] = [
    '<repo_map>',
    `Project outline: ${map.totalFiles} code/config files, ${map.totalLines.toLocaleString()} lines, ${map.modules.length} top-level modules.`,
    'Ranked by local dependency references, exported symbols, entrypoint names, and current request terms. Use read_file/grep for full source before editing.',
  ];

  for (const item of ranked.slice(0, maxFiles)) {
    const symbols = item.file.exports.length > 0
      ? ` exports: ${item.file.exports.slice(0, 8).join(', ')}${item.file.exports.length > 8 ? ', ...' : ''}`
      : '';
    const deps = item.inbound > 0 ? ` inbound:${item.inbound}` : '';
    const line = `- ${item.file.path} (${item.file.language}, ${item.file.lineCount} lines${deps})${symbols}`;
    const projected = [...lines, line, '</repo_map>'].join('\n');
    if (projected.length > maxChars) break;
    lines.push(line);
  }

  if (lines.length <= 3) return null;
  lines.push('</repo_map>');
  return lines.join('\n');
}

export function buildAutoRepoMapBlock(
  cwd: string,
  userQuery?: string,
  options: RepoMapOptions = {},
): string | null {
  if (process.env.GRAWKUS_REPO_MAP === '0') return null;
  const minFiles = options.minFiles ?? 5;
  const maxFiles = options.maxFiles ?? 24;
  const maxChars = options.maxChars ?? 6_000;
  const cacheKey = `${cwd}\0${userQuery ?? ''}\0${minFiles}\0${maxFiles}\0${maxChars}`;
  const cached = AUTO_REPO_MAP_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < AUTO_REPO_MAP_TTL_MS) return cached.block;

  let block: string | null = null;
  try {
    const map = generateCodeMap(cwd);
    if (map.totalFiles >= minFiles) {
      block = renderRepoMap(map, rankCodeMapFiles(map, userQuery), maxFiles, maxChars);
    }
  } catch {
    block = null;
  }

  AUTO_REPO_MAP_CACHE.set(cacheKey, { createdAt: Date.now(), block });
  return block;
}

/**
 * Save code map to disk
 */
export function saveCodeMap(cwd: string, map: CodeMap): void {
  const codemapDir = getProjectStateDir(cwd);
  if (!existsSync(codemapDir)) {
    mkdirSync(codemapDir, { recursive: true });
  }

  const codemapFile = join(codemapDir, 'codemap.json');
  writeFileSync(codemapFile, JSON.stringify(map, null, 2), 'utf-8');
}

/**
 * Load code map from disk
 */
export function loadCodeMap(cwd: string): CodeMap | null {
  const codemapFile = join(getProjectStateDir(cwd), 'codemap.json');
  if (!existsSync(codemapFile)) {
    return null;
  }

  try {
    const content = readFileSync(codemapFile, 'utf-8');
    return JSON.parse(content) as CodeMap;
  } catch {
    return null;
  }
}

/**
 * Check if code map is stale (any source files modified since generation)
 */
export function isCodeMapStale(cwd: string): boolean {
  const map = loadCodeMap(cwd);
  if (!map) return true;

  const mapTime = new Date(map.generatedAt).getTime();

  try {
    // Check if any source files are newer than the map
    const result = execSync(
      `find "${cwd}/src" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\) -newermt "${map.generatedAt}" 2>/dev/null | head -1`,
      { encoding: 'utf-8', timeout: 5_000 }
    );

    return result.trim().length > 0;
  } catch {
    return true;
  }
}

/**
 * Pretty-print the code map
 */
export function printCodeMap(map: CodeMap): void {
  console.log(chalk.cyan('\n📊 Code Map'));
  console.log(chalk.gray(`Generated: ${new Date(map.generatedAt).toLocaleString()}\n`));

  console.log(chalk.blue('Project Statistics:'));
  console.log(chalk.gray(`  Total files: ${map.totalFiles}`));
  console.log(chalk.gray(`  Total lines: ${map.totalLines.toLocaleString()}`));
  console.log(chalk.gray(`  Modules: ${map.modules.length}\n`));

  console.log(chalk.blue('Modules:'));
  for (const module of map.modules.slice(0, 10)) {
    const files = module.files.slice(0, 3).join(', ');
    const more = module.files.length > 3 ? ` (+${module.files.length - 3} more)` : '';
    console.log(chalk.gray(`  ${module.name}: ${files}${more}`));
  }

  console.log(chalk.blue('\nTop Files (by line count):'));
  const sorted = [...map.files].sort((a, b) => b.lineCount - a.lineCount);
  for (const file of sorted.slice(0, 10)) {
    console.log(chalk.gray(`  ${file.path}: ${file.lineCount} lines`));
  }
}

/**
 * Build a code map context string for system prompt injection
 */
export function buildCodemapContext(cwd: string): string {
  const map = loadCodeMap(cwd);
  if (!map) {
    return '';
  }

  let context = '\n## Project Structure\n';

  context += `**Statistics:**\n`;
  context += `- Total files: ${map.totalFiles}\n`;
  context += `- Total lines of code: ${map.totalLines.toLocaleString()}\n`;
  context += `- Modules: ${map.modules.length}\n\n`;

  context += `**Module Overview:**\n`;
  for (const module of map.modules) {
    context += `- \`${module.name}\`: ${module.files.length} files\n`;
  }

  context += `\n**Key Exports:**\n`;
  const topExports = map.files
    .filter((f) => f.exports.length > 0)
    .slice(0, 5)
    .flatMap((f) => f.exports.map((e) => `\`${f.path}#${e}\``));

  if (topExports.length > 0) {
    context += topExports.join(', ') + '\n';
  }

  context += `\n**External Dependencies:**\n`;
  const deps = new Set<string>();
  for (const file of map.files) {
    for (const imp of file.imports) {
      deps.add(imp);
    }
  }
  Array.from(deps)
    .slice(0, 15)
    .forEach((dep) => {
      context += `- \`${dep}\`\n`;
    });

  return context;
}

/**
 * Print code map generation status
 */
export function printCodemapStatus(cwd: string): void {
  const map = loadCodeMap(cwd);
  const stale = isCodeMapStale(cwd);

  console.log(chalk.cyan('\n📋 Code Map Status'));
  if (map) {
    console.log(chalk.green(`✓ Code map exists (${map.totalFiles} files)`));
    console.log(chalk.gray(`  Generated: ${new Date(map.generatedAt).toLocaleString()}`));
    if (stale) {
      console.log(chalk.yellow('  ⚠ Code map is stale (source files have been modified)'));
    }
  } else {
    console.log(chalk.gray('✗ No code map found'));
    console.log(chalk.gray('  Run: generateCodeMap(cwd) then saveCodeMap(cwd, map)'));
  }
  console.log();
}
