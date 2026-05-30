/**
 * Rules engine — per-language coding standards.
 * Loads rules from ~/.grawkus/rules/ and injects into system prompt.
 * Ships with built-in presets for common languages.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getConfigDir } from './config.js';

const RULES_DIR = join(getConfigDir(), 'rules');

export interface RuleSet {
  language: string;
  rules: string;
}

// ── Built-in rule presets ─────────────────────────────────
const BUILTIN_RULES: Record<string, string> = {
  typescript: `# TypeScript Rules
- Use strict mode; enable all strict compiler options
- Prefer const over let; never use var
- Use explicit return types on exported functions
- Use interfaces for object shapes, types for unions/intersections
- Prefer readonly arrays and properties where possible
- Use nullish coalescing (??) over OR (||) for defaults
- Use optional chaining (?.) for deep property access
- Handle all Promise rejections — no floating promises
- Use template literals over string concatenation
- Use ESM imports (import/export), not CommonJS (require)
- File naming: kebab-case for files, PascalCase for components/classes
- Max file length: 300 lines — split if larger
- Prefer early returns over deeply nested conditionals`,

  python: `# Python Rules
- Follow PEP 8 style guidelines
- Use type hints on all function signatures
- Use dataclasses or Pydantic for structured data
- Prefer f-strings over .format() or % formatting
- Use pathlib.Path instead of os.path for file operations
- Use context managers (with) for resource management
- Use list/dict/set comprehensions where readable
- Prefer enumerate() over range(len())
- Never use mutable default arguments (use None + factory)
- Use logging module, not print(), for non-user-facing output
- Max function length: 30 lines — extract if larger
- Write docstrings for all public functions (Google style)`,

  go: `# Go Rules
- Follow Effective Go and Go Proverbs
- Use gofmt/goimports for formatting
- Handle every error — no _ for errors unless explicitly justified
- Use short variable declarations (:=) inside functions
- Keep interfaces small — 1-3 methods, defined where used
- Use context.Context as the first parameter for long-running ops
- Use table-driven tests
- Prefer returning errors over panicking
- Use defer for cleanup
- Package naming: short, lowercase, no underscores
- Avoid init() functions — prefer explicit initialization
- Use struct embedding for composition, not inheritance`,

  rust: `# Rust Rules
- Follow Rust API Guidelines (RFC 430)
- Use clippy lints: #![warn(clippy::all)]
- Prefer &str over String for function parameters
- Use Result<T, E> for fallible operations, not panics
- Implement Display for error types
- Use iterators and combinators over manual loops where clear
- Prefer owned types in struct fields, borrows in function params
- Use derive macros for Debug, Clone, PartialEq where appropriate
- Keep unsafe blocks minimal and well-documented
- Use cargo fmt for formatting
- Prefer match over if-let chains for >2 variants`,

  java: `# Java Rules
- Follow Google Java Style Guide
- Use records for value objects (Java 16+)
- Use var for local variables with clear initialization
- Prefer List.of(), Map.of() over mutable collections
- Use Optional instead of null for potentially absent values
- Use try-with-resources for all Closeable resources
- Prefer streams over explicit loops for collection transforms
- Use @Override annotation always
- Final fields by default; minimize mutability
- One class per file; class name matches filename
- Use SLF4J for logging`,

  kotlin: `# Kotlin Rules
- Follow Kotlin Coding Conventions
- Use data classes for value objects
- Prefer val over var — immutability by default
- Use sealed classes for restricted hierarchies
- Use when instead of if-else chains (>2 branches)
- Use scope functions (let, run, apply, also) appropriately
- Use coroutines for async — avoid callbacks
- Prefer extension functions for utility operations
- Use string templates over concatenation
- Use named arguments for functions with >3 parameters`,

  cpp: `# C++ Rules
- Follow C++ Core Guidelines
- Use smart pointers (unique_ptr, shared_ptr) — no raw owning pointers
- Use RAII for resource management
- Prefer references over pointers where nullability is not needed
- Use const correctly and consistently
- Use auto for complex types where the type is obvious from context
- Prefer range-based for loops
- Use std::string_view for non-owning string parameters
- Use [[nodiscard]] for functions where ignoring return is an error
- Use std::optional for values that may not exist
- Keep headers minimal — forward-declare where possible
- Use namespaces to avoid name collisions`,

  php: `# PHP Rules
- Use PHP 8.1+ features: enums, fibers, readonly properties
- Use strict types: declare(strict_types=1) in every file
- Use type declarations for all parameters, return types, and properties
- Follow PSR-12 coding style
- Use constructor promotion for simple classes
- Use match() over switch for value mapping
- Use null coalescing (??) and nullsafe (?->) operators
- Use named arguments for clarity
- Prefer arrays + array functions over manual loops
- Use Composer autoloading (PSR-4)`,

  sql: `# SQL Rules
- Use parameterized queries to prevent injection
- Avoid SELECT * — specify needed columns
- Use proper indexes on WHERE, JOIN, ORDER BY columns
- Avoid N+1 query patterns — use joins or eager loading
- Write migrations that are reversible
- Use foreign keys for referential integrity
- Follow naming conventions: snake_case for tables/columns
- Add CHECK constraints for business rule validation
- Use transactions for multi-step operations
- Document complex queries with comments`,

  csharp: `# C# Rules
- Follow Microsoft C# Coding Conventions
- Use PascalCase for public members, camelCase for private
- Use LINQ where appropriate over manual loops
- Use async/await for I/O operations
- Use nullable reference types (C# 8+)
- Prefer pattern matching in switch statements
- Use dependency injection for testability
- Follow SOLID principles
- Use records for immutable data types
- Document public APIs with XML comments`,
};

function ensureDir(): void {
  mkdirSync(RULES_DIR, { recursive: true });
}

/**
 * Load rules for a specific language.
 * Checks user rules first, falls back to built-in.
 */
export function loadRules(language: string): string | null {
  ensureDir();
  const userFile = join(RULES_DIR, `${language}.md`);
  if (existsSync(userFile)) {
    return readFileSync(userFile, 'utf-8');
  }
  return BUILTIN_RULES[language] || null;
}

/**
 * Save custom rules for a language.
 */
export function saveRules(language: string, rules: string): void {
  ensureDir();
  writeFileSync(join(RULES_DIR, `${language}.md`), rules, 'utf-8');
}

/**
 * List all available rule sets (built-in + custom).
 */
export function listRuleSets(): { language: string; source: 'builtin' | 'custom' }[] {
  ensureDir();
  const result: { language: string; source: 'builtin' | 'custom' }[] = [];

  // Custom rules
  const customFiles = readdirSync(RULES_DIR).filter((f) => f.endsWith('.md'));
  for (const f of customFiles) {
    result.push({ language: f.replace('.md', ''), source: 'custom' });
  }

  // Built-in (not overridden)
  for (const lang of Object.keys(BUILTIN_RULES)) {
    if (!result.find((r) => r.language === lang)) {
      result.push({ language: lang, source: 'builtin' });
    }
  }

  return result.sort((a, b) => a.language.localeCompare(b.language));
}

// Centralized extension → language map. Used by all three detection
// paths (whole-repo scan, user-query scan, git-diff scan) so they stay
// consistent.
const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'typescript', '.jsx': 'typescript',
  '.mjs': 'typescript', '.cjs': 'typescript',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.h': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.swift': 'swift',
  '.dart': 'dart',
  '.fs': 'fsharp', '.fsx': 'fsharp',
  '.sql': 'sql',
};

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot).toLowerCase();
}

/**
 * Auto-detect languages in the project by file extensions.
 * Broad scan — walks the whole cwd. Used as the fallback when targeted
 * detection (query + git diff) finds nothing.
 */
export function detectLanguages(cwd: string): string[] {
  const detected = new Set<string>();
  try {
    const files = readdirSync(cwd, { recursive: true, withFileTypes: true });
    for (const f of files as any[]) {
      if (!f.isFile()) continue;
      const lang = EXT_TO_LANG[extOf(f.name)];
      if (lang) detected.add(lang);
      if (detected.size >= 5) break; // enough
    }
  } catch {
    // can't read dir
  }
  return Array.from(detected);
}

/**
 * Detect languages mentioned in a free-form user message via file-path
 * extensions. Matches paths like `src/foo.ts`, `~/Downloads/bar.py`,
 * `C:\\path\\baz.go`. Ignores bare extensions like ".ts" alone — they're
 * too often false positives (version strings, regex patterns).
 */
export function detectLanguagesFromQuery(query: string): string[] {
  const detected = new Set<string>();
  if (!query) return [];
  // Match path-like tokens: at least one [\w/\\.-] before the extension
  const pathRe = /[\w/\\.-]+(\.[a-z]{1,5})\b/gi;
  let m;
  while ((m = pathRe.exec(query)) !== null) {
    const lang = EXT_TO_LANG[m[1].toLowerCase()];
    if (lang) detected.add(lang);
  }
  return [...detected];
}

/**
 * Detect languages from files changed in the working tree. Uses
 * `git diff --name-only HEAD` (uncommitted + staged) and falls back to
 * `git status --porcelain` if the diff command fails. Times out fast
 * to never block startup.
 */
export function detectLanguagesFromGit(cwd: string): string[] {
  const detected = new Set<string>();
  try {
    // Dynamic require so this module stays usable in non-git contexts
    // without importing the child_process spawn cost unnecessarily.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const out = execSync('git diff --name-only HEAD 2>nul || git status --porcelain', {
      cwd, timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8',
    });
    for (const line of out.split('\n')) {
      // Strip git-status porcelain prefix (XY space)
      const path = line.replace(/^[\sMADRCU?!]+/, '').trim();
      if (!path) continue;
      const lang = EXT_TO_LANG[extOf(path)];
      if (lang) detected.add(lang);
    }
  } catch {
    // Not a git repo, no changes, or git unavailable — silent
  }
  return [...detected];
}

/**
 * Build rules section for system prompt. Detection prefers TARGETED
 * sources (user query + git diff) over a broad repo scan, so polyglot
 * repos don't have to inject every language's rules on every turn.
 *
 *   priority 1: file paths mentioned in the user's current message
 *   priority 2: files changed in the working tree (git diff)
 *   fallback:   broad recursive scan of cwd (the old behavior)
 *
 * Returns "" if no languages detected at all. Total injected length
 * capped at ~3000 chars to avoid bloat (rules-per-language are usually
 * 500-1500 chars each, so 3-4 languages fit comfortably).
 */
export function buildRulesPrompt(cwd: string, userQuery?: string): string {
  let languages: string[] = [];

  // Priority 1+2: query + git
  const fromQuery = userQuery ? detectLanguagesFromQuery(userQuery) : [];
  const fromGit = detectLanguagesFromGit(cwd);
  const targeted = [...new Set([...fromQuery, ...fromGit])];

  if (targeted.length > 0) {
    languages = targeted;
  } else {
    // Fallback to broad scan
    languages = detectLanguages(cwd);
  }

  if (languages.length === 0) return '';

  const sections: string[] = [];
  let totalLen = 0;
  const CAP = 3000;
  for (const lang of languages) {
    const rules = loadRules(lang);
    if (!rules) continue;
    if (totalLen + rules.length > CAP && sections.length > 0) break;
    sections.push(rules);
    totalLen += rules.length;
  }

  if (sections.length === 0) return '';
  return `\n# Coding Standards\n${sections.join('\n\n')}`;
}

/**
 * Get detailed coding rules for a specific language.
 * Loads custom rules if available, falls back to comprehensive built-in rules.
 */
export function getLanguageRules(language: string): string {
  // Load custom rules if available
  const customRules = loadRules(language);
  if (customRules) {
    return customRules;
  }

  // Return comprehensive built-in rules with additional detail
  const detailedRules: Record<string, string> = {
    typescript: `# TypeScript Code Standards

## Type System & Strict Mode
- Enforce \`"strict": true\` in tsconfig.json for all strict compiler options
- Prefer const over let; never use var for any reason
- Explicitly declare return types on all exported functions and public methods
- Use interfaces for object shapes and contracts; use types for unions, intersections, and aliases
- Prefer readonly arrays and properties to prevent accidental mutations
- Always provide explicit generic type parameters; don't rely on inference for complex types
- Use discriminated unions for type-safe pattern matching

## Null & Undefined Safety
- Use nullish coalescing (??) over logical OR (||) for proper falsy value handling
- Use optional chaining (?.) for deep property access
- Avoid non-null assertions (!) unless absolutely necessary and well-documented
- Handle all Promise rejections—no floating promises
- Never assume values exist; always add type guards or assertions

## Async Patterns & Promises
- Mark async operations with explicit async/await or return Promise<T>
- Handle all .catch() blocks; use try-catch in async functions
- Ensure Promise.all() and Promise.race() have error handling
- Set timeouts on long-running async operations
- Avoid mixing callbacks with promises

## Imports & Module System
- Use ESM (import/export); never CommonJS (require)
- Import order: Node.js built-ins → npm packages → local files
- Use named imports when importing specific exports
- Avoid circular dependencies—refactor shared logic to a common module
- Include file extensions in relative imports (.js, .ts)
- Use index.ts for directory exports to control public API

## Code Organization & Naming
- Max function length: 50 lines; extract if larger
- Max file length: 300 lines; split into multiple files if exceeded
- Use kebab-case for filenames, PascalCase for classes/components
- Use camelCase for functions and variables
- Use UPPER_SNAKE_CASE for constants
- Place public functions before private in file order

## Code Quality & Maintainability
- No console.log in production—use a logger (winston, pino, etc.)
- Avoid deeply nested conditionals; use early returns for guard clauses
- DRY: extract duplicated logic into reusable functions
- No magic numbers—use named constants with descriptive names
- Add comments explaining "why", not "what"
- Keep cyclomatic complexity reasonable (<5 per function)

## Performance & Memory
- Avoid N+1 database queries by batch loading or joining data
- Memoize expensive computations (use memoization libraries)
- Remove event listeners (removeEventListener) to prevent memory leaks
- Unsubscribe from subscriptions in cleanup functions
- Don't hold large objects in memory longer than necessary

## Testing
- Write unit tests for all business logic and utilities
- Cover happy paths and at least 3 edge cases per function
- Add JSDoc comments to public functions with @param, @returns, @throws
- Document non-obvious logic with inline comments`,

    python: `# Python Code Standards

## Type Hints & Static Typing
- Add type hints to all function parameters and return types
- Use type hints on class attributes using typing module or PEP 526
- Use complex type aliases (TypeAlias) for clarity
- Run mypy or pyright to validate types
- Use Union[X, Y] or X | Y (3.10+) for multiple types
- Never use implicit Any—always be explicit

## PEP 8 Compliance
- Use 4 spaces for indentation; never tabs
- Keep lines ≤79 characters (100 for comments/docstrings)
- Use CamelCase for classes; snake_case for functions and variables
- Use UPPER_SNAKE_CASE for module-level constants
- Place 2 blank lines between top-level definitions, 1 between methods
- Use trailing commas in multi-line collections

## Strings & Documentation
- Always use f-strings (f"...") for string formatting
- Never use % formatting or .format() unless f-string unavailable
- Write docstrings in Google style for all public functions/classes
- Use triple double quotes (""") for docstrings
- Use raw strings (r"...") for regex patterns
- Avoid string concatenation in loops—collect in list, then join

## Async & Concurrency
- Use async/await; don't mix with threading without careful consideration
- Manage asyncio event loop explicitly; understand run_until_complete
- Never block I/O in async functions (no time.sleep(); use asyncio.sleep())
- Set timeouts on all async operations using asyncio.wait_for()
- Use asyncio.gather() or asyncio.TaskGroup for concurrent tasks
- Understand GIL implications when using threading

## Exception Handling
- Never use bare except:; always catch specific exceptions
- Use custom exception classes for domain errors
- Use finally blocks for cleanup or context managers (with statement)
- Log exceptions with context before re-raising
- Don't silently swallow exceptions
- Use context managers for all resource management

## File I/O & Paths
- Always use pathlib.Path instead of os.path
- Use context managers for file operations: with open(...) as f:
- Always specify encoding explicitly (utf-8 is typical)
- Never hardcode absolute paths—use config or environment variables
- Check file existence before operations using if path.exists()

## Data Structures & Functions
- Limit function length to ~30 lines; extract if larger
- Limit function parameters to 3-4; use dataclass if more needed
- Never use mutable defaults: def foo(items=[]) is wrong; use None + factory
- Prefer dataclasses or Pydantic for structured data
- Use enumerate() instead of range(len())
- Use list/dict/set comprehensions for readability
- Use generator expressions for large datasets

## Testing & Documentation
- Write docstrings for all public functions using Google style
- Use pytest for unit tests; organize with fixtures and markers
- Cover happy paths, edge cases, and error conditions
- Use mocks/patches to isolate external dependencies
- Never use print() in production—use logging module
- Configure logging with proper levels: DEBUG, INFO, WARNING, ERROR

## Performance & Best Practices
- Avoid N+1 queries using select_related() or prefetch_related() in ORMs
- Use pagination for large result sets
- Cache expensive computations (consider functools.lru_cache)
- Avoid algorithms with O(n²) or worse without justification
- Profile before optimizing`,

    go: `# Go Code Standards

## Error Handling (Go Proverbs: "Errors are values")
- Always handle every error; use _ = err only with explicit justification comment
- Wrap errors with context: fmt.Errorf("doing X: %w", err)
- Define custom error types for domain-specific errors
- Never panic in libraries; only in main or tests
- Provide helpful error messages to users
- Use error chains to understand error context

## Interface Design & Struct Composition
- Keep interfaces small: 1-3 methods, defined where they're needed
- Prefer composition over inheritance; use embedding for type reuse
- Use pointer receivers when modifying receiver; value otherwise
- Don't create interfaces for every type; only when needed
- Use unexported (lowercase) fields by default; export only what's public
- Document exported identifiers with comments starting with the name

## Context & Concurrency
- Pass context.Context as the first parameter in long-running functions
- Always respect context cancellation in loops
- Set timeouts on contexts: ctx, cancel := context.WithTimeout(ctx, time.Minute)
- Never store context in struct fields; pass as parameter
- Use context.Background() only at application entry point
- Never block indefinitely—always have timeout or cancellation

## Goroutines & Channel Safety
- Prevent goroutine leaks by ensuring all goroutines exit
- Use sync.WaitGroup or context cancellation to coordinate goroutines
- Test with go run -race to detect data races
- Always close channels from the sender; receivers don't close
- Use select with timeout to prevent deadlocks
- Protect shared memory with sync.Mutex or use channels

## Code Style & Organization
- Run gofmt automatically; never commit unformatted code
- Run goimports to organize imports correctly
- Keep function comments at the top, starting with function name
- Document packages with a package comment at the top of the file
- Group related code; use blank lines to separate logical blocks
- File structure: package comment → imports → constants → vars → types → interfaces → functions

## Function & File Structure
- Place exported functions before unexported ones
- Keep functions focused on a single task
- Table-driven tests for testing multiple scenarios
- Use subtests (t.Run) for test clarity and isolation
- Max cyclomatic complexity ~5; refactor if exceeded
- Package names: short, lowercase, no underscores

## Testing Strategy
- Use table-driven tests: test different inputs with same logic
- Use t.Run for subtests and clearer test organization
- Mock external dependencies; unit tests shouldn't call external services
- Write benchmarks for performance-critical code
- Fuzz tests for parsers and validators
- Test error paths, not just happy paths

## Common Go Patterns
- Use defer for cleanup (files, locks, connections)
- Check type assertions with v, ok := x.(Type)
- Avoid init() functions; prefer explicit initialization
- Use iota for enum-like constants
- Prefer if err != nil { return err } over else blocks`,

    rust: `# Rust Code Standards

## Ownership & Lifetimes
- Understand and follow Rust's ownership rules strictly
- Annotate lifetimes explicitly when the compiler can't infer
- Use references (&T) for non-owning access; Box<T> for owned allocations
- Pass &str instead of &String for function parameters
- Pass &[T] instead of &Vec<T> for function parameters
- Use &T for immutable access; &mut T for exclusive mutable access

## Error Handling & Results
- Use Result<T, E> for all fallible operations—never panic in libraries
- Implement Error + Display traits for custom error types
- Use the ? operator for error propagation
- Add context to errors when wrapping
- Never use unwrap() or expect() in production code (tests OK)
- Consider custom error types instead of generic String errors

## Smart Pointers & Memory Safety
- Use Box<T> for owned heap allocations
- Use Arc<T> for shared ownership; Rc<T> only in single-threaded contexts
- Break circular references with Weak<T>
- Understand Arc overhead and use judiciously
- Never use raw pointers (*const T, *mut T) outside unsafe blocks
- Never hold references across .await points without understanding

## Unsafe Code
- Minimize unsafe blocks; they should be last resort
- Document safety invariants above every unsafe block
- Include a SAFETY comment explaining why it's safe
- Verify bounds before any pointer dereference
- Use high-level safe abstractions instead of unsafe when possible
- Review unsafe code with extra scrutiny during code review

## Const Correctness & Generics
- Use const for compile-time constant values
- Use const fn for functions that can run at compile time
- Use const generics for compile-time parameterization
- Annotate mutable references only when mutation happens
- Use &self for immutable methods; &mut self for mutating
- Default to immutable bindings (let, not let mut)

## Clippy & Code Quality
- Enable #![warn(clippy::all)] or stricter in lib.rs/main.rs
- Address all clippy warnings; understand before dismissing
- Use cargo clippy to find idiomatic Rust patterns
- Apply rustfmt for consistent formatting
- Keep function length reasonable; extract if complex
- DRY: refactor duplicated logic into helpers

## Code Style & Documentation
- Use snake_case for functions/variables, CamelCase for types/traits
- Run cargo fmt before committing
- Document all public functions with /// doc comments
- Include examples in doc comments; they're compiled with cargo test --doc
- Add SAFETY comments for all unsafe blocks explaining why it's safe
- Write INVARIANT comments for complex data structures

## Testing & Verification
- Write unit tests in modules with #[cfg(test)]
- Write integration tests in tests/ directory
- Include examples in doc comments with /// \`\`\`
- Test error paths and edge cases
- Use property-based testing (proptest) for combinatorial coverage
- Profile before optimizing; use cargo flamegraph

## Trait & Generic Design
- Keep traits cohesive; single responsibility
- Use explicit generic bounds: fn foo<T: Clone + Display>(...)
- Use associated types to avoid over-generalization
- Follow orphan rule: implement foreign traits only on local types
- Use HRTB (for<'a>) for advanced lifetime scenarios
- Prefer composition over trait objects when possible`,

    java: `# Java Code Standards

## Null Safety & Optional
- Use Optional<T> instead of returning null
- Use Optional.orElse(), orElseThrow(), orElseGet()
- Never call Optional.get() without isPresent() check
- Use @Nullable/@NonNull annotations for clarity
- Handle NullPointerException in tests
- Understand Optional is not a general-purpose wrapper

## Resource Management (Try-With-Resources)
- Always use try-with-resources for Closeable resources
- Never use try-finally for resource cleanup
- Connection/Statement always closed in try-with-resources
- Stream/Reader/Writer closed in try-with-resources
- Test for resource leaks with tools like NetBeans Profiler

## Collections & Streams
- Prefer Stream API over explicit loops for transformations
- Use List.of(), Map.of(), Set.of() for immutable collections
- Never create unnecessary new ArrayList/HashMap
- Terminal operations required in Stream chains
- Avoid nested flatMap; limit depth for readability
- Use Collectors.groupingBy, toMap, etc. appropriately

## Spring Boot & Dependency Injection
- Constructor injection preferred over @Autowired on fields
- Use @Autowired on constructor for single dependency
- Avoid circular dependencies; refactor if found
- Use @Service, @Repository, @Controller on appropriate classes
- @Transactional on service methods, not on getters
- Use @ConfigurationProperties for externalized configuration

## JPA & ORM Patterns
- Use fetch joins to prevent N+1 query problems
- Avoid lazy loading issues; use eager loading when needed
- Ensure entities only modified within transactions
- Set @Transactional(readOnly=true) on query methods
- Careful with cascade configuration—avoid unintended deletes
- Use projections for read-only queries

## Code Style & Conventions
- 4-space indentation; never tabs
- Max 100 characters per line
- CamelCase for classes; camelCase for methods/variables
- UPPER_SNAKE_CASE for constants
- Always use @Override annotation
- Comments explain "why", not "what"

## Type Safety & Generics
- Specify generic type bounds: <T extends SomeClass>
- Use wildcard types appropriately: ? extends, ? super
- Minimize unchecked casts; document when necessary
- Never use raw types (List instead of List<String>)
- Understand type erasure implications

## Testing
- Use JUnit 5 with @Test annotations
- Mock external dependencies with Mockito
- Test names describe what is tested
- Follow Arrange-Act-Assert pattern
- Document public APIs with Javadoc
- Use @param, @return, @throws in Javadoc

## Object-Oriented Design
- Use inheritance sparingly; prefer composition
- Mark immutable classes as final
- Encapsulate fields; provide getters
- Follow SOLID principles
- Single Responsibility per class
- No "god classes" with too many responsibilities`,

    cpp: `# C++ Code Standards

## Memory Management (RAII, Smart Pointers)
- Use std::unique_ptr for single ownership
- Use std::shared_ptr for shared ownership
- Never use raw owning pointers (new/delete)
- Use std::make_unique/make_shared
- Ensure all resources have destructors
- No memory leaks possible even in exception paths

## Const Correctness
- Mark methods const when they don't modify state
- Use const references: const T& for parameters
- Propagate const correctness up the call chain
- Use mutable only for truly mutable implementation details
- Mark data members const by default
- const in templates: template<const T>

## Pointer & Reference Safety
- Use std::string_view for non-owning string parameters
- Prefer references over pointers when nullability unnecessary
- Use bounds checking in array operations
- Check pointers before dereference
- Use std::span<T> for array ranges (C++20)
- Use std::optional<T> for optional values

## RAII & Destructors
- Every resource has a constructor (acquire) and destructor (release)
- Define move constructor and move assignment
- Copy constructor and assignment operator when deep copying needed
- No resource leaks in exception paths
- Use scopedexits pattern for cleanup
- RAII applies to locks, files, network connections, memory

## Standard Library
- Use std::vector for dynamic arrays
- Use std::string for text (not char arrays)
- Use std::array for fixed-size arrays
- Use std::map/unordered_map for key-value
- Understand iterator validity before/after operations
- Use range-based for loops: for(auto& x : container)
- Use <algorithm> library functions

## Error Handling
- Exceptions preferred to error codes in modern C++
- Provide strong or basic exception safety guarantee
- Use noexcept appropriately; default to not noexcept
- Custom exception types for domain errors
- Avoid exception specifications; use noexcept only
- Test exception paths in unit tests

## Code Style & Quality
- Run clang-format automatically; never commit unformatted code
- Never use using namespace std (except in function scope)
- Meaningful variable/function names
- Single responsibility per function
- Reasonable cyclomatic complexity
- Named constants instead of magic numbers
- Comments explain non-obvious logic

## Testing & Documentation
- Unit tests for critical functions
- Integration tests for module interactions
- Doxygen comments for public API
- Include examples for complex APIs
- README explains build and usage
- Use Valgrind/AddressSanitizer for testing

## Template Metaprogramming
- Template complexity justified
- Use SFINAE or C++20 concepts for overload resolution
- Minimize template instantiation bloat
- Document explicit instantiations
- Use static_assert for compile-time checks
- C++20 concepts preferred over enable_if

## Performance
- Use move semantics to avoid copies
- Minimize allocations in hot loops
- Reasonable algorithm complexity
- Profile before optimizing
- Cache-friendly data layout
- Inline hints used conservatively`,

    kotlin: `# Kotlin Code Standards

## Null Safety & Type System
- Non-nullable types (T) preferred; nullable (T?) explicit
- Safe calls (.?) and assertions (!!); assert only in tests
- Elvis operator (?:) for defaults
- Use val by default; var only when needed
- lateinit for late initialization; lazy for computed values
- Never use !!

## Data Classes & Immutability
- data class for value objects with auto-generated equals, hashCode, toString
- Use copy() for "modifications" (maintains immutability)
- val everywhere; var sparingly
- Destructuring: val (x, y) = pair
- Private constructors for controlled creation
- sealed class for restricted hierarchies

## Coroutines & Async
- async/await instead of callbacks
- Proper scope: GlobalScope avoided; use lifecycle scopes
- Exception handling in coroutine builders
- Cancellation respected in loops
- launch vs async: launch for fire-and-forget, async for results
- Job/Task properly awaited

## Control Flow & When Expressions
- when instead of if-else chains (>2 branches)
- when exhaustive or explicit else
- Scope functions (let, run, apply, also) appropriately used
- if-expressions return values when possible
- Early returns to avoid nesting
- Guard clauses instead of nested blocks

## Extension Functions & Higher-Order Functions
- Extension functions for utility operations
- Receiver clarity in extension scopes
- No extensions on Any/Object
- Lambdas single-expression when possible
- it implicit parameter understood
- Function types clear in signatures

## Collections & Sequences
- listOf, mapOf, setOf for immutable collections
- Sequences for lazy evaluation chains
- map/filter/reduce chains clear and efficient
- groupBy for grouping; associate for map creation
- No unnecessary list conversions
- forEach/forEachIndexed over manual loops

## Strings & Text
- String templates (with ${'${}'}) instead of concatenation
- Triple quotes (""" """) for multiline
- Raw strings for regex/JSON
- No string building in loops

## Testing & Spring Integration
- JUnit 5 with @Test
- Mockk or similar for mocking
- Test names describe behavior
- Arrange-Act-Assert pattern
- KDoc for public APIs
- @SpringBootTest for integration tests

## Code Style & Conventions
- ktlint for consistent formatting
- No redundant modifiers (public, final)
- camelCase for functions; PascalCase for types
- Comments explain "why" not "what"
- Function length ~30 lines; file length ~300 lines
- Named arguments for functions with >3 parameters`,

    php: `# PHP Code Standards

## Type Safety & Strict Types
- declare(strict_types=1) at the top of EVERY file
- Type all parameters and return types
- Type class properties
- Avoid mixed type; be specific
- Use typed properties (PHP 7.4+)
- Static analysis with phpstan or psalm

## Null Safety & Error Handling
- Null coalescing (??) over isset checks
- Nullsafe operator (?->) for deep property access
- No silent null failures
- Type hints include ? for nullable types
- Guard clauses for early returns
- Specific exception handling, not catch(Exception)

## PSR Standards & Code Style
- PSR-1: Basic Coding Standard
- PSR-12: Extended Coding Style
- PSR-4: Autoloading via Composer
- 4-space indentation
- CamelCase for classes; camelCase for methods
- php_eol for line endings

## Modern PHP Features (8.1+)
- Enums for restricted value sets
- Readonly properties for immutability
- Match expressions instead of switch
- Named arguments for clarity
- Constructor promotion (public __construct(private string $name))
- Fibers for async control flow

## Eloquent & Database
- Model relationships defined clearly
- Eager loading (with()) prevents N+1
- select() for specific columns
- Query scopes for reusable logic
- Soft deletes for historical data
- Mass assignment protection ($guarded, $fillable)

## Validation & Security
- Request validation classes for input
- Validate ALL user input
- Custom validation messages
- Gate/Policy for authorization
- CSRF protection enabled
- Parameterized queries (ORM handles this)

## Collections & Functional
- Illuminate\Support\Collection methods
- map/filter/reduce for transformations
- array functions for simple operations
- No manual loops when collection methods suffice
- Null-safe operations with collection methods
- Type-safe collection usage

## Laravel Patterns
- Service/Repository for business logic
- Middleware for cross-cutting concerns
- Jobs/Queues for async operations
- Service providers for registration
- Facades appropriately used
- Dependency injection via constructor

## Testing
- PHPUnit for unit tests
- Feature tests for user workflows
- Mocking external dependencies
- Test database transactions
- Meaningful assertion messages
- Good test organization

## Documentation & Strings
- Docblock comments on public methods
- README explains setup and usage
- PHPDoc for parameter/return types
- Heredoc/Nowdoc for multiline strings
- No hardcoded values (use config)
- Localization for user-facing strings`,

    sql: `# SQL Code Standards

## Security (SQL Injection Prevention)
- Always use parameterized queries (? or :name)
- Never string-interpolate user input
- Input validation before SQL operations
- User input never directly in WHERE/SELECT
- Prepared statements cached and reused
- Stored procedures with parameter binding
- ORM systems with parameterization

## Query Optimization
- N+1 query prevention; use JOINs
- SELECT specific columns, never SELECT *
- Pagination for large result sets
- EXPLAIN PLAN for complex queries
- Indexes on WHERE, JOIN, ORDER BY columns
- Join order matters for optimizer
- Subqueries not in SELECT list

## Schema Design & Constraints
- Primary keys on every table
- Foreign keys establish relationships
- Data types match actual values
- NOT NULL constraints explicit
- UNIQUE constraints for natural keys
- Normalization (3NF minimum)
- No magic numbers as IDs

## Migrations & Version Control
- Migrations reversible (up/down)
- Schema changes safe (add before remove)
- Data migrations with rollback path
- Test migrations up and down
- Breaking changes documented
- Backward compatibility maintained
- One migration per change

## Performance & Indexing
- Indexes on high-cardinality columns
- Composite indexes for multi-column filters
- Covering indexes for hot queries
- No redundant indexes
- Index maintenance cost considered
- Statistics updated regularly

## Data Integrity & Testing
- Audit columns (created_at, updated_at)
- Soft deletes for historical data
- Archival strategy documented
- Backup/restore tested
- Consistent validation rules
- Temporal data handled correctly

## Comments & Documentation
- Comments on complex queries
- Document table purposes
- Explain non-obvious indexes
- Record any known performance issues
- Database version requirements noted`,

    csharp: `# C# Code Standards

## Code Style & Conventions
- Follow Microsoft C# Coding Conventions
- PascalCase for public members; camelCase for private
- 4-space indentation
- Meaningful names for all identifiers
- Max function length ~30 lines
- Single Responsibility Principle

## Language Features
- LINQ for collection queries (not loops)
- async/await for I/O operations
- Nullable reference types (C# 8+)
- Pattern matching in switch statements
- Records for immutable data types
- Tuples for returning multiple values
- String interpolation ($"...")

## Null Safety
- Enable nullable reference types in csproj
- Non-null types by default; ? for nullable
- Use null-conditional operators (?., ?[])
- Guard clauses for null checks
- Null coalescing (??) for defaults

## Dependency Injection & Architecture
- Constructor injection for dependencies
- Interface-based design
- Dependency Injection containers
- Inversion of Control pattern
- SOLID principles

## Testing & Documentation
- Unit tests with xUnit or NUnit
- Mock dependencies with Moq
- Test names describe behavior
- Integration tests for workflows
- XML documentation on public APIs
- Examples in documentation

## async/await & Threading
- async/await for I/O operations
- ConfigureAwait(false) in libraries
- Proper exception handling in async
- Avoid sync-over-async patterns
- Task.Run for CPU-bound work
- Cancellation tokens passed through

## Collections & Generics
- LINQ over manual loops
- Generic constraints explicit
- Immutable collections for safety
- IEnumerable for lazy evaluation
- Choose collection type by use case
- No unnecessary allocations`,
  };

  return detailedRules[language] || BUILTIN_RULES[language] || `# Rules for ${language}\n(No rules defined for this language)`;
}

export function printRules(): void {
  const sets = listRuleSets();
  console.log(chalk.cyan(`\n  Rule Sets (${sets.length}):`));
  for (const s of sets) {
    console.log(chalk.dim(`  ${s.language.padEnd(15)} [${s.source}]`));
  }
  console.log(chalk.dim('  \n  Custom rules: ~/.grawkus/rules/<language>.md'));
  console.log();
}
