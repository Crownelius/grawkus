/**
 * Language-specific agent system — review and build-fix prompts for every major language.
 * Each agent provides targeted code review checklists, common antipatterns,
 * and severity-rated findings for its specific language ecosystem.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Language Detection ────────────────────────────────────
export function detectProjectLanguage(cwd: string): string {
  const fileExtMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'typescript',
    '.jsx': 'typescript',
    '.py': 'python',
    '.pyw': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.h': 'cpp',
    '.hpp': 'cpp',
    '.php': 'php',
    '.sql': 'sql',
    '.cs': 'csharp',
  };

  const configFileMap: Record<string, string> = {
    'tsconfig.json': 'typescript',
    'package.json': 'typescript',
    'Cargo.toml': 'rust',
    'go.mod': 'go',
    'pyproject.toml': 'python',
    'setup.py': 'python',
    'requirements.txt': 'python',
    'pom.xml': 'java',
    'build.gradle': 'java',
    'build.gradle.kts': 'kotlin',
    'Gemfile': 'ruby',
    'composer.json': 'php',
    'CMakeLists.txt': 'cpp',
    'Makefile': 'cpp',
    '.csproj': 'csharp',
    '.sln': 'csharp',
  };

  // Check config files first (highest priority)
  for (const [file, lang] of Object.entries(configFileMap)) {
    if (existsSync(join(cwd, file))) {
      return lang;
    }
  }

  // Scan source files for extensions
  const counts: Record<string, number> = {};
  try {
    const files = readdirSync(cwd, { recursive: true, withFileTypes: true });
    for (const f of files as any[]) {
      if (!f.isFile()) continue;
      const name: string = f.name;
      if (name.startsWith('.')) continue;
      const ext = name.slice(name.lastIndexOf('.'));
      const lang = fileExtMap[ext];
      if (lang) counts[lang] = (counts[lang] || 0) + 1;
    }
  } catch {
    // can't read dir
  }

  // Return the most common language
  if (Object.keys(counts).length > 0) {
    return Object.entries(counts).sort(([, a], [, b]) => b - a)[0][0];
  }

  return 'typescript'; // default fallback
}

// ── TypeScript/JavaScript Review Agent ────────────────────
export function buildTSReviewPrompt(cwd: string, target?: string): string {
  return `Perform a detailed TypeScript/JavaScript code review.

**Project Path**: ${cwd}
${target ? `**Target Files/Diff**: ${target}` : ''}

## Review Checklist

### Type Safety (CRITICAL severity)
- [ ] Strict mode enabled? Check tsconfig.json for "strict": true
- [ ] No \`any\` types — all parameters and returns have explicit types
- [ ] All function parameters typed, especially for external API calls
- [ ] Union types use discriminated unions, not implicit type narrowing
- [ ] No implicit \`any\` from \`Object\` or untyped spread
- [ ] Generic constraints are properly defined (e.g., \`T extends X\`)

### Null/Undefined Safety (HIGH severity)
- [ ] Use \`??\` (nullish coalescing) instead of \`||\` for defaults
- [ ] Use optional chaining (\`?.\`) for deep property access
- [ ] Non-null assertions (!) justified and documented
- [ ] Discriminated unions handle all branches explicitly
- [ ] No assumption that values exist — check guards present
- [ ] Consider \`Result<T, E>\` or \`Option<T>\` patterns for error cases

### Promise & Async Patterns (HIGH severity)
- [ ] No floating promises — all promises are awaited or explicitly .catch()
- [ ] Async functions declared explicitly, no implicit Promise returns
- [ ] Error handling in .catch() blocks or try-catch
- [ ] Race conditions handled when using Promise.all/race
- [ ] No \`void\` returns from async functions in callbacks
- [ ] Timeouts set for long-running async operations

### ESM Import Standards (MEDIUM severity)
- [ ] Use \`import/export\` (ESM), not \`require\` (CommonJS)
- [ ] Import order: Node built-ins, packages, then local files
- [ ] Named imports used where appropriate (not \`import *\`)
- [ ] No circular imports
- [ ] File extensions included in relative imports (.js/.ts)

### Code Quality (MEDIUM severity)
- [ ] Max function length ~50 lines — extract if larger
- [ ] Max file length ~300 lines — split if larger
- [ ] No console.log in production — use logger
- [ ] Avoid deeply nested conditionals — use early returns
- [ ] DRY: duplicated logic extracted to functions
- [ ] No magic numbers — use named constants

### Performance (MEDIUM severity)
- [ ] N+1 queries avoided in database loops
- [ ] Memoization used for expensive computations
- [ ] Event listeners cleaned up (removeEventListener)
- [ ] No memory leaks in subscriptions — unsubscribe on cleanup
- [ ] Reasonable algorithm complexity for datasets
- [ ] Large objects not held in memory unnecessarily

### Testing & Documentation (MEDIUM severity)
- [ ] Unit tests for critical functions exist
- [ ] Happy path and edge cases tested
- [ ] Public functions have JSDoc comments
- [ ] Complex logic has inline comments explaining "why"
- [ ] Error messages are helpful and actionable

### Common Antipatterns (NIT to HIGH severity)
- [ ] No \`==\` (use \`===\` always)
- [ ] No bare \`try-catch\` (catch all errors without handling)
- [ ] No mutable default arguments
- [ ] No reassignment of parameters
- [ ] No var declarations (use const/let)
- [ ] No hardcoded values in strings (config/constants)

## Output Format

For each issue found:
\`\`\`
[File:Line] SEVERITY — Issue Description
Why: Explain the problem
Fix: How to resolve it
Example: Show the corrected code
\`\`\`

End with summary:
- Total issues by severity (CRITICAL / HIGH / MEDIUM / LOW / NIT)
- Top 3 recommendations
- Overall verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION`;
}

// ── Python Review Agent ────────────────────────────────────
export function buildPyReviewPrompt(cwd: string, target?: string): string {
  return `Perform a detailed Python code review following PEP 8 and modern best practices.

**Project Path**: ${cwd}
${target ? `**Target Files/Diff**: ${target}` : ''}

## Review Checklist

### Type Hints (CRITICAL severity)
- [ ] All function parameters have type hints
- [ ] All function return types annotated
- [ ] Class attributes typed (using typing annotations or PEP 526)
- [ ] Complex types use type aliases for clarity
- [ ] Type hints are checked with mypy (or pyright)
- [ ] No implicit \`Any\` types without justification

### PEP 8 Style (MEDIUM severity)
- [ ] 4-space indentation (not tabs)
- [ ] Line length ≤ 79 characters (100 for comments)
- [ ] CamelCase for classes, snake_case for functions/variables
- [ ] UPPER_SNAKE_CASE for constants
- [ ] No trailing whitespace
- [ ] Blank lines: 2 between top-level functions/classes, 1 between methods

### String & F-String Usage (MEDIUM severity)
- [ ] Use f-strings over .format() or % formatting
- [ ] No hardcoded strings in business logic (use constants/config)
- [ ] Docstrings use triple quotes and follow Google style
- [ ] Raw strings (r"...") for regex patterns
- [ ] No string concatenation in loops (use list + join)

### Async & Concurrency (HIGH severity)
- [ ] async/await used correctly (not mixing with threading carelessly)
- [ ] asyncio event loop managed properly
- [ ] No blocking I/O in async functions
- [ ] Timeout handling for async operations
- [ ] Concurrent tasks properly awaited (asyncio.gather)
- [ ] Thread safety considered if using threading/multiprocessing

### Exception Handling (HIGH severity)
- [ ] Specific exceptions caught (never bare \`except:\`)
- [ ] Finally blocks used for cleanup (or context managers)
- [ ] Custom exceptions defined where needed
- [ ] No silent swallowing of exceptions
- [ ] Exceptions logged with context before re-raising
- [ ] Context managers (with statement) for resource management

### Pathlib & File I/O (MEDIUM severity)
- [ ] Use \`pathlib.Path\` instead of \`os.path\`
- [ ] File operations use context managers (\`with open(...)\`)
- [ ] Encoding explicitly specified (utf-8)
- [ ] No hardcoded paths — use config/environment
- [ ] Existence checks before file operations

### Function & Code Quality (MEDIUM severity)
- [ ] Max function length ~30 lines — extract if larger
- [ ] Functions have single responsibility
- [ ] No more than 3-4 parameters (use dataclass if more)
- [ ] DRY: repeated logic extracted to functions
- [ ] Comprehensions readable (not overly nested)
- [ ] Generator expressions used for large datasets

### Data Structures & Best Practices (MEDIUM severity)
- [ ] Use dataclasses or Pydantic for structured data
- [ ] Prefer \`dict.get(key)\` over \`key in dict\` checks
- [ ] Use \`enumerate()\` instead of \`range(len())\`
- [ ] List/dict/set comprehensions preferred over loops
- [ ] No mutable default arguments (use None + factory pattern)
- [ ] Immutable sequences (tuples) for fixed data

### Testing & Documentation (MEDIUM severity)
- [ ] Docstrings on all public functions/classes
- [ ] Unit tests cover happy path and edge cases
- [ ] Test fixtures/factories for test data
- [ ] No \`print()\` statements in production (use logging)
- [ ] Logging configured with proper levels (DEBUG, INFO, WARNING, ERROR)
- [ ] README documents setup and usage

### Performance (MEDIUM severity)
- [ ] N+1 queries avoided (use select_related/prefetch_related for ORM)
- [ ] Large lists not loaded entirely when pagination possible
- [ ] Expensive operations not in loops
- [ ] Caching used for repeated calculations
- [ ] Algorithm complexity reasonable for dataset size

## Output Format

For each issue found:
\`\`\`
[File:Line] SEVERITY — Issue Description
Why: Explain the problem
Fix: How to resolve it
Example: Show corrected code
\`\`\`

End with summary:
- Issues by severity (CRITICAL / HIGH / MEDIUM / LOW / NIT)
- Top 3 recommendations
- Overall verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION`;
}

// ── Go Review Agent ───────────────────────────────────────
export function buildGoReviewPrompt(cwd: string, target?: string): string {
  return `Perform a detailed Go code review following Effective Go and Go Proverbs.

**Project Path**: ${cwd}
${target ? `**Target Files/Diff**: ${target}` : ''}

## Review Checklist

### Error Handling (CRITICAL severity)
- [ ] All errors returned (no \`_ = err\` unless explicitly justified with comment)
- [ ] Errors wrapped with context (\`fmt.Errorf("doing X: %w", err)\`)
- [ ] Custom error types defined for domain errors
- [ ] No panic in libraries (only main/tests)
- [ ] Error handling is consistent across functions
- [ ] Error messages are helpful and actionable

### Interface & Struct Design (HIGH severity)
- [ ] Interfaces small (1-3 methods, defined where used)
- [ ] Receiver type correct (value vs pointer)
- [ ] No unnecessary interface satisfaction checks
- [ ] Struct embedding used for composition
- [ ] Public/private (exported/unexported) symbols consistent
- [ ] Methods on pointers when they modify receiver

### Context Usage (HIGH severity)
- [ ] Context.Context is first parameter for long-running operations
- [ ] Context cancellation respected in loops
- [ ] Timeouts set on contexts where appropriate
- [ ] Context not stored in struct fields (passed as param)
- [ ] No context.Background() in production code (use passed context)

### Goroutines & Concurrency (HIGH severity)
- [ ] Goroutine leaks prevented (always channel close/cancel)
- [ ] WaitGroup or context used to coordinate goroutines
- [ ] No data races (use go run -race to verify)
- [ ] Channels properly closed (only sender closes)
- [ ] Select blocks use timeout or context for deadlock prevention
- [ ] Shared memory access protected by sync.Mutex or channels

### Code Style & Formatting (MEDIUM severity)
- [ ] gofmt applied (files auto-formatted)
- [ ] goimports run (unused imports removed, needed imports added)
- [ ] No blank lines in code blocks
- [ ] Function comments start with function name
- [ ] Package comments explain package purpose
- [ ] Comments explain "why", not "what"

### Function & File Structure (MEDIUM severity)
- [ ] Public functions appear before private in file
- [ ] Max function complexity reasonable
- [ ] No duplicate logic — extract to helpers
- [ ] Single responsibility principle
- [ ] Related functions in same package
- [ ] Tests in same package with \`_test.go\` suffix

### Testing Strategy (MEDIUM severity)
- [ ] Table-driven tests used for multiple scenarios
- [ ] Subtests used for clarity (\`t.Run("scenario", ...)\`)
- [ ] Test coverage for critical paths
- [ ] No external dependencies in unit tests (use mocks)
- [ ] Benchmarks for performance-critical code
- [ ] Fuzz tests for parsing/validation

### Common Patterns (MEDIUM severity)
- [ ] defer used for cleanup (files, locks, etc.)
- [ ] Type assertions checked (\`v, ok := x.(Type)\`)
- [ ] No init() functions (prefer explicit initialization)
- [ ] Package naming: short, lowercase, no underscores
- [ ] Constants and vars grouped logically
- [ ] Enums implemented with iota

### Performance (LOW severity)
- [ ] Allocations minimized in hot loops
- [ ] String building uses strings.Builder, not concatenation
- [ ] Unnecessary allocations avoided
- [ ] Reasonable algorithm complexity

## Output Format

For each issue found:
\`\`\`
[File:Line] SEVERITY — Issue Description
Why: Explain the problem
Fix: How to resolve it
Example: Show corrected code
\`\`\`

End with summary:
- Issues by severity (CRITICAL / HIGH / MEDIUM / LOW / NIT)
- Top 3 recommendations
- Overall verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION`;
}

// ── Rust Review Agent ─────────────────────────────────────
export function buildRustReviewPrompt(cwd: string, target?: string): string {
  return `Perform a detailed Rust code review following Rust API Guidelines and Clippy lints.

**Project Path**: ${cwd}
${target ? `**Target Files/Diff**: ${target}` : ''}

## Review Checklist

### Ownership & Lifetimes (CRITICAL severity)
- [ ] Ownership rules followed (move vs copy)
- [ ] Lifetimes explicitly annotated where needed
- [ ] No dangling references
- [ ] String slices (\`&str\`) for non-owned string parameters
- [ ] \`&[T]\` instead of \`&Vec<T>\` for function parameters
- [ ] Lifetimes don't leak implementation details to callers

### Error Handling (CRITICAL severity)
- [ ] All fallible operations return \`Result<T, E>\`
- [ ] Error types implement Display and Error traits
- [ ] Error context added with ? operator properly
- [ ] Custom error types for domain errors
- [ ] No panics in library code (only tests/main)
- [ ] expect()/unwrap() only in tests or with justification

### Smart Pointers (HIGH severity)
- [ ] \`unique_ptr\` equivalent (\`Box<T>\`) for owned allocations
- [ ] \`shared_ptr\` equivalent (\`Arc<T>\`) for shared ownership
- [ ] \`Rc<T>\` vs \`Arc<T>\` chosen correctly
- [ ] Circular references broken with \`Weak<T>\`
- [ ] Reference counting overhead justified
- [ ] No raw pointers unless using unsafe

### Unsafe Blocks (HIGH severity)
- [ ] Unsafe blocks minimal and well-documented
- [ ] Safety invariants documented above unsafe blocks
- [ ] All unsafe operations justified with comments
- [ ] Bounds checking done before pointer dereference
- [ ] No undefined behavior possible
- [ ] Consider safe abstractions instead of unsafe

### Clippy Lints (MEDIUM severity)
- [ ] \`#![warn(clippy::all)]\` enabled (or strict superset)
- [ ] No \`clone()\` used unnecessarily
- [ ] \`map().collect()\` chains are clear and efficient
- [ ] match over if-let chains for >2 variants
- [ ] Function complexity reasonable
- [ ] No premature optimization

### Const Correctness (HIGH severity)
- [ ] const used for true compile-time constants
- [ ] Mutable references used only when mutation needed
- [ ] Associated consts used for type-scoped constants
- [ ] const generics used appropriately (Rust 1.51+)

### Code Quality & Style (MEDIUM severity)
- [ ] cargo fmt applied (consistent formatting)
- [ ] rustfmt.toml configured appropriately
- [ ] Naming follows Rust conventions (snake_case functions, CamelCase types)
- [ ] Public API items have documentation comments
- [ ] Examples in doc comments run under cargo test --doc
- [ ] Private items documented if complex

### Testing & Documentation (MEDIUM severity)
- [ ] Unit tests in same file with #[cfg(test)]
- [ ] Integration tests in tests/ directory
- [ ] Doc tests included for public API
- [ ] All public functions documented
- [ ] Examples provided for non-obvious APIs
- [ ] SAFETY comments for all unsafe blocks

### Trait & Generic Design (MEDIUM severity)
- [ ] Traits are cohesive (single responsibility)
- [ ] Generic constraints expressed properly
- [ ] Trait bounds clear in signatures
- [ ] Orphan rule followed (no blanket implementations)
- [ ] Associated types used to avoid over-generalization

### Performance (MEDIUM severity)
- [ ] No unnecessary allocations in hot paths
- [ ] Iterator chains preferred over loops
- [ ] SIMD opportunities considered
- [ ] Lazy evaluation used where beneficial
- [ ] Profile before optimizing

## Output Format

For each issue found:
\`\`\`
[File:Line] SEVERITY — Issue Description
Why: Explain the problem
Fix: How to resolve it
Example: Show corrected code
\`\`\`

End with summary:
- Issues by severity (CRITICAL / HIGH / MEDIUM / LOW / NIT)
- Top 3 recommendations
- Overall verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION`;
}

// ── Java Review Agent ─────────────────────────────────────
export function buildJavaReviewPrompt(cwd: string, target?: string): string {
  return `Perform a detailed Java code review following Google Java Style Guide and Spring best practices.

**Project Path**: ${cwd}
${target ? `**Target Files/Diff**: ${target}` : ''}

## Review Checklist

### Null Safety (CRITICAL severity)
- [ ] Optional<T> used instead of null returns
- [ ] Optional.orElse() or orElseThrow() for null handling
- [ ] No .get() without isPresent() check
- [ ] @Nullable/@NonNull annotations used
- [ ] @SpringBootTest or @ExtendWith for Spring tests
- [ ] No NullPointerException in tests

### Resource Management (HIGH severity)
- [ ] try-with-resources for all Closeable resources
- [ ] No try-finally for resource cleanup (use try-with)
- [ ] Connection/Statement properly closed
- [ ] File streams closed in try-with-resources
- [ ] No resource leaks in exception paths

### Collections & Streams (HIGH severity)
- [ ] Stream operations preferred over explicit loops
- [ ] List.of()/Map.of()/Set.of() for immutable collections
- [ ] Not creating new lists/maps unnecessarily
- [ ] Terminal operations present in streams (not lazy)
- [ ] flatMap not over-nested for readability
- [ ] Collectors used appropriately (toList, groupingBy, etc.)

### Spring Boot Patterns (HIGH severity)
- [ ] @Autowired only on constructor (not fields)
- [ ] Constructor injection preferred
- [ ] No circular dependencies
- [ ] @Service/@Repository/@Controller used correctly
- [ ] @Transactional scoped appropriately (not on getters)
- [ ] @ConfigurationProperties for external config
- [ ] Proper exception handling with @ControllerAdvice

### JPA & ORM (HIGH severity)
- [ ] Lazy loading avoided (use fetch joins when needed)
- [ ] N+1 query problem addressed with joins
- [ ] Entities not modified outside transaction
- [ ] @Transactional readOnly=true for queries
- [ ] Proper cascade configuration (avoid cascading deletes)
- [ ] No business logic in entity constructors

### Code Style & Conventions (MEDIUM severity)
- [ ] 4-space indentation
- [ ] max 100 chars per line
- [ ] CamelCase for classes, camelCase for variables
- [ ] UPPER_SNAKE_CASE for constants
- [ ] @Override annotation always present
- [ ] Comments explain "why", not "what"

### Type Safety (MEDIUM severity)
- [ ] Generic type bounds appropriate (<T extends SomeClass>)
- [ ] Wildcard types used appropriately (? extends, ? super)
- [ ] Unchecked casts minimized and justified
- [ ] Type erasure understood (no instanceof with generics)
- [ ] Raw types not used

### Testing & Documentation (MEDIUM severity)
- [ ] JUnit 5 tests with @Test annotation
- [ ] Mocks/stubs for external dependencies
- [ ] Test names describe what is tested
- [ ] Arrange-Act-Assert pattern in tests
- [ ] Public classes/methods documented with JavaDoc
- [ ] @param, @return, @throws documented in JavaDoc

### Object-Oriented Design (MEDIUM severity)
- [ ] Inheritance used sparingly (prefer composition)
- [ ] Final classes/methods for immutables
- [ ] Immutable objects preferred
- [ ] Encapsulation maintained (private fields, public getters)
- [ ] SOLID principles followed
- [ ] No god classes (single responsibility)

### Performance & Caching (MEDIUM severity)
- [ ] Caching strategy documented
- [ ] @Cacheable used appropriately with TTL
- [ ] Batch operations used for bulk inserts/updates
- [ ] Index hints provided for complex queries
- [ ] N+1 queries eliminated
- [ ] Unnecessary database calls avoided

## Output Format

For each issue found:
\`\`\`
[File:Line] SEVERITY — Issue Description
Why: Explain the problem
Fix: How to resolve it
Example: Show corrected code
\`\`\`

End with summary:
- Issues by severity (CRITICAL / HIGH / MEDIUM / LOW / NIT)
- Top 3 recommendations
- Overall verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION`;
}

// ── C++ Review Agent ──────────────────────────────────────
export function buildCppReviewPrompt(cwd: string, target?: string): string {
  return `Perform a detailed C++ code review following C++ Core Guidelines.

**Project Path**: ${cwd}
${target ? `**Target Files/Diff**: ${target}` : ''}

## Review Checklist

### Memory Management (CRITICAL severity)
- [ ] Smart pointers (unique_ptr/shared_ptr) for all ownership
- [ ] No raw owning pointers
- [ ] RAII pattern used (resource acquired = initialization)
- [ ] No manual new/delete
- [ ] std::make_unique/make_shared preferred
- [ ] Move semantics used to avoid copies
- [ ] No memory leaks possible in exception paths

### Const Correctness (HIGH severity)
- [ ] const methods when no modification
- [ ] const references for parameters (non-owned)
- [ ] const correctness propagates up call chain
- [ ] mutable only for truly mutable state
- [ ] const data members by default
- [ ] const correctness in templates

### Pointer & Reference Safety (HIGH severity)
- [ ] std::string_view for non-owning string parameters
- [ ] References preferred over pointers where nullability not needed
- [ ] Pointer arithmetic minimized (use span, range)
- [ ] Null pointer checks before dereference
- [ ] Bounds checking in array operations
- [ ] std::optional<T&> for optional references

### RAII & Resource Management (HIGH severity)
- [ ] Destructors properly cleanup resources
- [ ] Copy/move constructors & assignment defined correctly
- [ ] No resource leaks in exception scenarios
- [ ] Custom deleters for non-standard resources
- [ ] scopedexit pattern for cleanup
- [ ] File handles/network sockets closed

### Class Design (HIGH severity)
- [ ] Single Responsibility Principle
- [ ] Virtual destructors for base classes
- [ ] No implicit conversions unless intentional
- [ ] Constexpr used for compile-time evaluation
- [ ] Access specifiers (public/private/protected) appropriate
- [ ] Deleted copy/move constructors when appropriate

### STL & Standard Library (MEDIUM severity)
- [ ] std::vector preferred for dynamic arrays
- [ ] std::string for text (not char arrays)
- [ ] std::array for fixed-size arrays
- [ ] std::map/unordered_map for key-value
- [ ] Iterator validity understood
- [ ] Range-based for loops preferred
- [ ] Algorithm library used where applicable

### Error Handling (MEDIUM severity)
- [ ] Exceptions preferred to error codes
- [ ] Exception safety guaranteed (strong or basic)
- [ ] noexcept used appropriately
- [ ] Custom exception types for domain errors
- [ ] Exception specifications avoided (noexcept only)
- [ ] Exception handling path tested

### Code Quality (MEDIUM severity)
- [ ] clang-format applied (consistent style)
- [ ] no using namespace std (except in function scope)
- [ ] Names meaningful and consistent
- [ ] Functions single responsibility
- [ ] Complexity reasonable
- [ ] Magic numbers replaced with constants
- [ ] Comments explain non-obvious logic

### Testing & Documentation (MEDIUM severity)
- [ ] Unit tests for critical functions
- [ ] Integration tests for module interactions
- [ ] Doxygen/standard doc comments on public API
- [ ] Examples for complex APIs
- [ ] Build/usage documented in README
- [ ] Valgrind/AddressSanitizer used for testing

### Template Metaprogramming (MEDIUM severity)
- [ ] Template complexity justified
- [ ] SFINAE/concepts used for overload resolution
- [ ] Template instantiation bloat minimized
- [ ] Explicit instantiations documented
- [ ] compile_time checks (static_assert) used
- [ ] C++20 concepts preferred over enable_if

### Performance (MEDIUM severity)
- [ ] Move semantics used to avoid copies
- [ ] Unnecessary allocations avoided
- [ ] Algorithm complexity appropriate
- [ ] Profiling done before optimization
- [ ] Cache-friendly data layout considered
- [ ] Inline hints used judiciously

## Output Format

For each issue found:
\`\`\`
[File:Line] SEVERITY — Issue Description
Why: Explain the problem
Fix: How to resolve it
Example: Show corrected code
\`\`\`

End with summary:
- Issues by severity (CRITICAL / HIGH / MEDIUM / LOW / NIT)
- Top 3 recommendations
- Overall verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION`;
}

// ── Kotlin Review Agent ───────────────────────────────────
export function buildKotlinReviewPrompt(cwd: string, target?: string): string {
  return `Perform a detailed Kotlin code review following Kotlin Coding Conventions.

**Project Path**: ${cwd}
${target ? `**Target Files/Diff**: ${target}` : ''}

## Review Checklist

### Null Safety (CRITICAL severity)
- [ ] Non-nullable types preferred (T over T?)
- [ ] Safe calls (.?) and not-null asserts (!) justified
- [ ] Elvis operator (?:) used appropriately
- [ ] Nullable types handled explicitly
- [ ] No !! unless in tests
- [ ] lateinit used only when unavoidable

### Data Classes & Immutability (HIGH severity)
- [ ] data class used for value objects
- [ ] val used by default (var only when needed)
- [ ] copy() method used for modifications (immutable pattern)
- [ ] Destructuring used for data class decomposition
- [ ] Private constructors for singletons
- [ ] Sealed classes for restricted hierarchies

### Coroutines (HIGH severity)
- [ ] Coroutines used for async instead of callbacks
- [ ] Proper scope (GlobalScope avoided)
- [ ] Exception handling in coroutine scopes
- [ ] Cancellation properly handled
- [ ] launch vs async used correctly
- [ ] Job/Task awaited properly

### Control Flow & Expressions (HIGH severity)
- [ ] when instead of if-else chains (>2 branches)
- [ ] when uses all branches (exhaustive or else)
- [ ] Scope functions (let, run, apply, also) used appropriately
- [ ] if-expression returns values where possible
- [ ] No unnecessary nested blocks
- [ ] early returns for guard conditions

### Extension Functions (MEDIUM severity)
- [ ] Extension functions for utility operations
- [ ] Receiver clarity in extension scopes
- [ ] No extension functions on Any/Object
- [ ] Documented for non-obvious purposes
- [ ] Scope functions (with, let) used correctly

### Collections & Sequences (MEDIUM severity)
- [ ] listOf/mapOf/setOf for immutable collections
- [ ] Sequences used for lazy evaluation
- [ ] map/filter/reduce chains clear and efficient
- [ ] groupBy for grouping operations
- [ ] associate for creating maps from collections
- [ ] Any unnecessary list conversions avoided

### Lambda & Functional Style (MEDIUM severity)
- [ ] Single-expression lambdas preferred
- [ ] it implicit parameter used
- [ ] Function types clear in signatures
- [ ] Higher-order functions well-documented
- [ ] DSLs used appropriately (builders)
- [ ] filter/map chains readable

### String Interpolation (MEDIUM severity)
- [ ] String templates used over concatenation
- [ ] Template expressions wrapped in ${'${...}'}
- [ ] Triple quotes for multiline strings
- [ ] Raw strings (""" """) for regex/JSON
- [ ] No string building in loops

### Testing & Documentation (MEDIUM severity)
- [ ] JUnit 5 tests with @Test
- [ ] Mockk or similar for mocking
- [ ] Test names describe behavior
- [ ] Arrange-Act-Assert pattern
- [ ] Doc comments on public APIs
- [ ] KDoc used for documentation

### Spring Boot Integration (MEDIUM severity)
- [ ] @SpringBootTest or @ExtendWith for tests
- [ ] Constructor injection preferred
- [ ] No @Autowired on properties
- [ ] data class for config properties
- [ ] Proper @Transactional usage
- [ ] @ControllerAdvice for exception handling

### Code Style & Conventions (MEDIUM severity)
- [ ] ktlint applied (consistent formatting)
- [ ] No redundant modifiers (public, final)
- [ ] Proper naming (camelCase, PascalCase for classes)
- [ ] Comments explain "why" not "what"
- [ ] Function length reasonable (<30 lines)
- [ ] File length reasonable (<300 lines)

## Output Format

For each issue found:
\`\`\`
[File:Line] SEVERITY — Issue Description
Why: Explain the problem
Fix: How to resolve it
Example: Show corrected code
\`\`\`

End with summary:
- Issues by severity (CRITICAL / HIGH / MEDIUM / LOW / NIT)
- Top 3 recommendations
- Overall verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION`;
}

// ── PHP Review Agent ──────────────────────────────────────
export function buildPhpReviewPrompt(cwd: string, target?: string): string {
  return `Perform a detailed PHP code review following PSR standards and Laravel best practices.

**Project Path**: ${cwd}
${target ? `**Target Files/Diff**: ${target}` : ''}

## Review Checklist

### Type Safety (CRITICAL severity)
- [ ] declare(strict_types=1) at top of every file
- [ ] All function parameters typed
- [ ] All function return types specified
- [ ] Class properties typed
- [ ] No use of mixed type (be specific)
- [ ] Type checking enabled (mypy/phpstan)

### Null Safety (HIGH severity)
- [ ] Null coalescing (??) over isset checks
- [ ] Nullsafe operator (?->) for deep access
- [ ] Optional<T> pattern or explicit null handling
- [ ] No silent null failures
- [ ] Type hints include ? for nullable types
- [ ] Early returns for guard conditions

### PSR Standards (HIGH severity)
- [ ] PSR-1: Basic Coding Standard followed
- [ ] PSR-12: Extended Coding Style followed
- [ ] PSR-4: Autoloading (Composer) used
- [ ] PHP_EOL for line endings
- [ ] 4-space indentation
- [ ] CamelCase for classes, camelCase for methods/variables

### Eloquent & Database Patterns (HIGH severity)
- [ ] Model relationships defined clearly
- [ ] Eager loading used (with()) to prevent N+1
- [ ] Proper use of select() for specific columns
- [ ] Scopes used for reusable query logic
- [ ] Soft deletes used when appropriate
- [ ] Mass assignment protected ($guarded, $fillable)

### Validation & Request Handling (HIGH severity)
- [ ] Form request validation classes used
- [ ] Validate all user input
- [ ] Validation messages customized
- [ ] Gate/Policy authorization checks
- [ ] CSRF protection enabled
- [ ] SQL injection prevention (parameterized queries)

### Error Handling (HIGH severity)
- [ ] Specific exception types caught
- [ ] Custom exception classes for domain errors
- [ ] Try-catch blocks don't swallow errors silently
- [ ] Proper logging of exceptions
- [ ] HTTP exception codes correct
- [ ] Error messages helpful to user

### Laravel Patterns (HIGH severity)
- [ ] Service/Repository pattern for business logic
- [ ] Middleware for cross-cutting concerns
- [ ] Jobs/Queues for async work
- [ ] Facades used appropriately
- [ ] Providers register services correctly
- [ ] Config values injected via constructor

### String & Text (MEDIUM severity)
- [ ] Heredoc/Nowdoc for multiline strings
- [ ] String interpolation clear
- [ ] No hardcoded strings in code
- [ ] String matching case-sensitive when needed
- [ ] Encoding specified for functions (e.g., mb_strlen)
- [ ] UTF-8 handling correct for multilingual apps

### Collections & Arrays (MEDIUM severity)
- [ ] Collection methods preferred over array functions
- [ ] array_map/filter over manual loops
- [ ] Spread operator used appropriately
- [ ] array_keys/array_values for key/value iteration
- [ ] Null coalescing in array access ([...] ?? default)
- [ ] Named array keys for clarity

### Testing & Documentation (MEDIUM severity)
- [ ] PHPUnit tests for critical functions
- [ ] Feature tests for workflows
- [ ] Mocking used for external dependencies
- [ ] Assertions clear and meaningful
- [ ] PHPDoc comments on public methods
- [ ] README documents setup and usage

### Code Quality & Performance (MEDIUM severity)
- [ ] No hardcoded values (use config/constants)
- [ ] Max function length ~30 lines
- [ ] Single Responsibility Principle
- [ ] DRY: no code duplication
- [ ] Memory usage reasonable (no memory leaks)
- [ ] N+1 query problems addressed

### Security Best Practices (HIGH severity)
- [ ] Input validation on all user data
- [ ] Output escaping (htmlspecialchars, blade {{...}})
- [ ] Authentication/authorization checks
- [ ] CSRF tokens used
- [ ] Password hashing (bcrypt/argon2)
- [ ] Secrets not in code or version control

## Output Format

For each issue found:
\`\`\`
[File:Line] SEVERITY — Issue Description
Why: Explain the problem
Fix: How to resolve it
Example: Show corrected code
\`\`\`

End with summary:
- Issues by severity (CRITICAL / HIGH / MEDIUM / LOW / NIT)
- Top 3 recommendations
- Overall verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION`;
}

// ── Database Review Agent ─────────────────────────────────
export function buildDbReviewPrompt(cwd: string, target?: string): string {
  return `Perform a detailed database code/schema review for SQL, migrations, and queries.

**Project Path**: ${cwd}
${target ? `**Target Files/Diff**: ${target}` : ''}

## Review Checklist

### SQL Injection & Security (CRITICAL severity)
- [ ] Parameterized queries used (? placeholders or named params)
- [ ] No string interpolation in SQL
- [ ] Input validation before SQL operations
- [ ] User input never directly in WHERE clauses
- [ ] SQL comments not from user input
- [ ] Proper escaping if concatenation unavoidable
- [ ] Prepared statements cached/reused

### Query Performance (CRITICAL severity)
- [ ] N+1 query problem identified and addressed
- [ ] Indexes on WHERE, JOIN, ORDER BY columns
- [ ] SELECT * avoided (specify columns needed)
- [ ] Pagination used for large result sets
- [ ] EXPLAIN PLAN reviewed for complex queries
- [ ] Join order reasonable for query optimizer
- [ ] Subqueries not in SELECT list (use JOIN instead)

### Schema Design (HIGH severity)
- [ ] Proper primary keys defined
- [ ] Foreign keys establish referential integrity
- [ ] Data types appropriate for values
- [ ] NOT NULL constraints where needed
- [ ] Unique constraints on natural keys
- [ ] No excessive denormalization (3NF minimum)
- [ ] No magic numbers as IDs (use surrogates)

### Migrations (HIGH severity)
- [ ] Migrations are reversible (up/down)
- [ ] Migrations handle schema changes safely
- [ ] Data migrations include rollback path
- [ ] Migrations tested for up and down
- [ ] Migration order dependencies documented
- [ ] Breaking changes to schema documented
- [ ] Backward compatibility maintained during migration

### Supabase RLS (HIGH severity if applicable)
- [ ] Row Level Security policies defined
- [ ] auth.uid() used for user isolation
- [ ] RLS policies tested for security
- [ ] Policies not overly permissive
- [ ] authenticated/anon roles separated
- [ ] Service role distinguished from user role

### Constraints & Validation (HIGH severity)
- [ ] CHECK constraints enforce business rules
- [ ] DEFAULT values set appropriately
- [ ] Generated columns for computed data
- [ ] GENERATED ALWAYS for audit columns
- [ ] UNIQUE constraints prevent duplicates
- [ ] FK constraints cascade appropriately

### Transaction Handling (MEDIUM severity)
- [ ] Transactions used for multi-step operations
- [ ] Isolation level appropriate (READ COMMITTED typical)
- [ ] Deadlock prevention considered
- [ ] Rollback logic in case of failure
- [ ] No long-running transactions
- [ ] Connection pooling considered for performance

### NULL Handling (MEDIUM severity)
- [ ] NULL vs empty string distinguished
- [ ] COALESCE used appropriately
- [ ] IFNULL/NULLIF used where needed
- [ ] NOT NULL constraints explicit
- [ ] NULL handling in comparisons (IS NULL, not = NULL)
- [ ] Database NULL behavior matches application

### Indexing Strategy (MEDIUM severity)
- [ ] Indexes on frequently filtered columns
- [ ] Composite indexes for multi-column filters
- [ ] Index cardinality considered
- [ ] Covering indexes for hot queries
- [ ] No redundant indexes
- [ ] Index maintenance cost vs benefit evaluated

### Data Integrity (MEDIUM severity)
- [ ] Audit columns (created_at, updated_at) tracked
- [ ] Soft deletes used for historical data
- [ ] Data archival strategy documented
- [ ] Backup/restore tested
- [ ] Data validation rules consistent
- [ ] Temporal data handled correctly

### Scalability Considerations (MEDIUM severity)
- [ ] Sharding strategy documented if needed
- [ ] Replication setup for HA
- [ ] Connection pool sizing appropriate
- [ ] Query results cached where beneficial
- [ ] Read replicas leveraged for reporting
- [ ] Growth projections documented

## Output Format

For each issue found:
\`\`\`
[File:Line] SEVERITY — Issue Description
Why: Explain the problem
Fix: How to resolve it
Example: Show corrected SQL/migration
\`\`\`

End with summary:
- Issues by severity (CRITICAL / HIGH / MEDIUM / LOW / NIT)
- Performance recommendations
- Security recommendations
- Overall verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION`;
}

// ── TypeScript Build Fix Agent ────────────────────────────
export function buildTSBuildFixPrompt(cwd: string, errors?: string): string {
  const strategy = errors
    ? `The following TypeScript build errors were captured:

\`\`\`
${errors.slice(0, 5000)}
\`\`\`

Analyze and fix them one at a time.`
    : `Run \`npx tsc --noEmit\` in ${cwd} and capture the output.
If there are errors, analyze them and fix them one at a time.
After each fix, re-run the build to verify.`;

  return `${strategy}

## Error Resolution Process

For each TypeScript error found:

1. **Parse the error message**
   - Extract file path and line number
   - Identify error code (TS1234, etc.)
   - Understand the root cause

2. **Fix the error** — Common fixes:
   - **TS7053**: Index signature missing — add Record<string, T> or explicit index type
   - **TS2339**: Property missing — add to type definition or interface
   - **TS2322**: Type mismatch — ensure types are compatible or cast explicitly
   - **TS2345**: Argument type incorrect — check function signature
   - **TS2304**: Name not found — check imports or global declarations
   - **TS2571**: Cannot invoke (not a function) — verify the value is callable
   - **TS2722**: Argument of optional — use non-null assertion or guard
   - **TS18048**: Value is not accessible — check null/undefined safety

3. **Verify**
   - Run \`npx tsc --noEmit\` again
   - Confirm error is resolved
   - No new errors introduced

4. **Repeat** until build succeeds

## Common Patterns

**Missing Type Definition**:
\`\`\`typescript
// Bad
const x = {}; // x is type {}
x.foo = 1;    // Error: property foo doesn't exist

// Good
const x: Record<string, number> = {};
x.foo = 1;
\`\`\`

**Null Safety**:
\`\`\`typescript
// Bad
const val = getValue(); // might be null
console.log(val.length); // Error: possibly null

// Good
const val = getValue();
if (val) {
  console.log(val.length);
}
\`\`\`

**Type Assertion**:
\`\`\`typescript
// Bad
const x = fetch(url); // Promise<Response>
x.json();              // Error: no such property

// Good
const res = await fetch(url);
const data = await res.json();
\`\`\`

Be methodical: fix errors from top to bottom (earlier errors may affect later ones).`;
}

// ── Go Build Fix Agent ────────────────────────────────────
export function buildGoBuildFixPrompt(cwd: string, errors?: string): string {
  const strategy = errors
    ? `The following Go build errors were captured:

\`\`\`
${errors.slice(0, 5000)}
\`\`\`

Analyze and fix them one at a time.`
    : `Run \`go build ./...\` in ${cwd} and capture the output.
If there are errors, analyze them and fix them one at a time.
After each fix, re-run the build to verify.`;

  return `${strategy}

## Error Resolution Process

For each Go error:

1. **Parse the error message**
   - Extract file path and line number
   - Identify error category
   - Understand the root cause

2. **Fix the error** — Common fixes:
   - **undefined: X** — Import missing or name misspelled. Check package.
   - **cannot use X as Y** — Type mismatch. Check types match or cast.
   - **X redeclared** — Variable/function declared twice. Remove duplicate.
   - **X is not exported** — Use lowercase for unexported, uppercase for exported
   - **assignment to entry in nil map** — Initialize map before use (make(map[K]V))
   - **cannot index X** — X is not indexable (array/slice/map)
   - **missing return statement** — All code paths must return
   - **unused variable X** — Remove if unused, use _ if intentional

3. **Verify**
   - Run \`go build ./...\` again
   - Confirm error is resolved
   - No new errors introduced

4. **Repeat** until build succeeds

## Common Patterns

**Import Missing**:
\`\`\`go
// Bad
func main() {
  fmt.Println("hi") // Error: undefined fmt
}

// Good
import "fmt"

func main() {
  fmt.Println("hi")
}
\`\`\`

**Type Mismatch**:
\`\`\`go
// Bad
var x int = "hello" // Error: cannot use string as int

// Good
var x string = "hello"
// or
var y int = 42
\`\`\`

**Nil Map**:
\`\`\`go
// Bad
var m map[string]int
m["key"] = 1 // Error: assignment to entry in nil map

// Good
m := make(map[string]int)
m["key"] = 1
\`\`\`

**Unused Variable**:
\`\`\`go
// Bad
x := 1 // Error: x declared but not used

// Good
x := 1
fmt.Println(x) // or remove x if not needed
// or
_ = 1 // if intentionally unused
\`\`\`

Be methodical and compile after each fix.`;
}

// ── Rust Build Fix Agent ──────────────────────────────────
export function buildRustBuildFixPrompt(cwd: string, errors?: string): string {
  const strategy = errors
    ? `The following Rust build errors were captured:

\`\`\`
${errors.slice(0, 5000)}
\`\`\`

Analyze and fix them one at a time.`
    : `Run \`cargo build\` in ${cwd} and capture the output.
If there are errors, analyze them and fix them one at a time.
After each fix, re-run cargo build to verify.`;

  return `${strategy}

## Error Resolution Process

For each Rust error:

1. **Parse the error message**
   - Read error code (E0xxx)
   - Extract file path and line number
   - Understand the error description

2. **Fix the error** — Common fixes:
   - **E0425: cannot find value** — Variable not in scope or misspelled
   - **E0433: cannot find module** — Module not imported or doesn't exist
   - **E0308: mismatched types** — Return type, argument type incorrect
   - **E0382: use of moved value** — Ownership issue. Use references or clone.
   - **E0502: cannot borrow as mutable** — Immutable borrow still in scope
   - **E0507: cannot move out** — Move from non-Copy type. Use references.
   - **E0599: no method named** — Method doesn't exist on type
   - **E0277: trait not implemented** — Type doesn't implement required trait

3. **Verify**
   - Run \`cargo build\` again
   - Confirm error is resolved
   - No new errors introduced

4. **Repeat** until build succeeds

## Common Patterns

**Ownership/Move**:
\`\`\`rust
// Bad
let s = String::from("hello");
let s2 = s;
println!("{}", s); // Error: s was moved

// Good
let s = String::from("hello");
let s2 = &s; // Borrow instead of move
println!("{}", s); // OK
\`\`\`

**Type Mismatch**:
\`\`\`rust
// Bad
fn foo() -> i32 {
  "hello" // Error: expected i32, found &str
}

// Good
fn foo() -> &'static str {
  "hello"
}
\`\`\`

**Import Missing**:
\`\`\`rust
// Bad
fn main() {
  println!("hi"); // Error: println! not in scope (in no_std context)
}

// Good
use std::println; // or ensure std library available
fn main() {
  println!("hi");
}
\`\`\`

**Borrow Checker**:
\`\`\`rust
// Bad
let mut x = 1;
let r1 = &x;
let r2 = &mut x; // Error: cannot borrow as mutable while immutable borrow exists

// Good
let mut x = 1;
{
  let r1 = &x;
  println!("{}", r1);
} // r1 goes out of scope
let r2 = &mut x; // OK
\`\`\`

Be methodical and follow the compiler's guidance.`;
}

// ── Java Build Fix Agent ──────────────────────────────────
export function buildJavaBuildFixPrompt(cwd: string, errors?: string): string {
  const strategy = errors
    ? `The following Java build errors were captured:

\`\`\`
${errors.slice(0, 5000)}
\`\`\`

Analyze and fix them one at a time.`
    : `Run \`mvn clean compile\` or \`gradle build\` in ${cwd} and capture the output.
If there are errors, analyze them and fix them one at a time.
After each fix, re-run the build to verify.`;

  return `${strategy}

## Error Resolution Process

For each Java error:

1. **Parse the error message**
   - Extract file path and line number
   - Identify error category (compilation, missing dependency, etc.)
   - Understand the root cause

2. **Fix the error** — Common fixes:
   - **cannot find symbol** — Missing import or undefined variable/method
   - **incompatible types** — Type mismatch in assignment or method call
   - **missing return statement** — Method must return value on all paths
   - **method not found** — Check method name, parameters, and receiver type
   - **type mismatch** — Generic types, inheritance issues
   - **duplicate class** — Class defined in multiple files or same file
   - **does not override abstract method** — Implement abstract methods

3. **Verify**
   - Run build command again
   - Confirm error is resolved
   - No new errors introduced

4. **Repeat** until build succeeds

## Common Patterns

**Missing Import**:
\`\`\`java
// Bad
public class Main {
  public static void main(String[] args) {
    List<String> items = new ArrayList<>(); // Error: List not found
  }
}

// Good
import java.util.*;

public class Main {
  public static void main(String[] args) {
    List<String> items = new ArrayList<>();
  }
}
\`\`\`

**Type Mismatch**:
\`\`\`java
// Bad
int x = "hello"; // Error: incompatible types

// Good
String x = "hello";
\`\`\`

**Missing Override**:
\`\`\`java
// Bad
class Child extends Parent {
  public void method() { } // Error: missing @Override
}

// Good
class Child extends Parent {
  @Override
  public void method() { }
}
\`\`\`

Be methodical and fix errors from top to bottom.`;
}

// ── C++ Build Fix Agent ───────────────────────────────────
export function buildCppBuildFixPrompt(cwd: string, errors?: string): string {
  const strategy = errors
    ? `The following C++ build errors were captured:

\`\`\`
${errors.slice(0, 5000)}
\`\`\`

Analyze and fix them one at a time.`
    : `Run \`cmake --build .\` or \`make\` in ${cwd} and capture the output.
If there are errors, analyze them and fix them one at a time.
After each fix, re-run the build to verify.`;

  return `${strategy}

## Error Resolution Process

For each C++ error:

1. **Parse the error message**
   - Extract file path and line number
   - Identify error category (compilation, linker, etc.)
   - Understand the root cause

2. **Fix the error** — Common fixes:
   - **undefined reference to** — Linker error. Link required library or define function.
   - **no matching function for call** — Function not found or parameter mismatch
   - **invalid use of** — Template, non-const reference, etc.
   - **error: expected primary-expression** — Syntax error
   - **was not declared in this scope** — Variable/function not in scope
   - **incomplete type** — Forward declaration instead of definition
   - **private within this context** — Access control issue

3. **Verify**
   - Run build command again
   - Confirm error is resolved
   - No new errors introduced

4. **Repeat** until build succeeds

## Common Patterns

**Undefined Reference**:
\`\`\`cpp
// Bad (missing #include or link)
// Error: undefined reference to 'foo'
int foo(); // Declaration
int main() { foo(); } // Definition missing or not linked

// Good
void foo() { } // Definition

int main() { foo(); }
\`\`\`

**Function Not Found**:
\`\`\`cpp
// Bad
void foo(int x, int y);
int main() { foo(1); } // Error: no matching function (missing parameter)

// Good
void foo(int x, int y);
int main() { foo(1, 2); }
\`\`\`

**Template Issues**:
\`\`\`cpp
// Bad (incomplete type)
class Foo; // Forward declaration only
void bar(Foo f) {} // Error: incomplete type

// Good
class Foo {}; // Definition
void bar(Foo f) {}
\`\`\`

**Const Issues**:
\`\`\`cpp
// Bad
void foo(int& x);
const int y = 5;
foo(y); // Error: cannot bind const to non-const reference

// Good
void foo(const int& x);
const int y = 5;
foo(y); // OK
\`\`\`

Be methodical and check link flags in CMakeLists.txt if linker errors.`;
}

// ── PyTorch Build Fix Agent ───────────────────────────────
export function buildPyTorchBuildFixPrompt(cwd: string, errors?: string): string {
  const strategy = errors
    ? `The following PyTorch/CUDA training errors were captured:

\`\`\`
${errors.slice(0, 5000)}
\`\`\`

Analyze and fix them one at a time.`
    : `Run training script in ${cwd} and capture errors.
If there are errors, analyze them and fix them one at a time.
After each fix, re-run to verify.`;

  return `${strategy}

## Error Resolution Process

For each PyTorch/CUDA error:

1. **Parse the error message**
   - Identify error type (CUDA, OOM, import, runtime, etc.)
   - Extract file path and line number
   - Understand the root cause

2. **Fix the error** — Common fixes:
   - **RuntimeError: CUDA out of memory** — Reduce batch size, model size, or clear cache
   - **ImportError: No module named 'torch'** — Install PyTorch: \`pip install torch\`
   - **CUDA runtime error: no kernel image** — CUDA compute capability mismatch
   - **RuntimeError: Expected all tensors** — Device mismatch (CPU vs GPU)
   - **IndexError: invalid index** — Tensor shape or indexing error
   - **ValueError: expected 4D tensor** — Wrong tensor shape
   - **UserWarning: volatile** — Use torch.no_grad() instead

3. **Verify**
   - Run training script again
   - Confirm error is resolved
   - Monitor GPU memory usage

4. **Repeat** until training succeeds

## Common Patterns

**CUDA Out of Memory**:
\`\`\`python
# Bad
batch_size = 512
model = LargeModel()
for batch in data:
  optimizer.zero_grad()
  out = model(batch.cuda()) # Error: CUDA out of memory

# Good
batch_size = 32 # Smaller batch
model = model.cuda()
for batch in data:
  batch = batch.cuda()
  optimizer.zero_grad()
  out = model(batch)
  loss = criterion(out, target)
  loss.backward()
  optimizer.step()
\`\`\`

**Device Mismatch**:
\`\`\`python
# Bad
model = MyModel()
x = torch.randn(10).cuda()
out = model(x) # Error: Expected all tensors on same device

# Good
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = MyModel().to(device)
x = torch.randn(10).to(device)
out = model(x)
\`\`\`

**Shape Mismatch**:
\`\`\`python
# Bad
x = torch.randn(3, 224, 224) # Missing batch dimension
out = model(x) # Error: Expected 4D tensor

# Good
x = torch.randn(1, 3, 224, 224) # Batch of 1
out = model(x)
\`\`\`

**Gradient Computation**:
\`\`\`python
# Bad
with torch.no_grad():
  out = model(x)
loss = criterion(out, y)
loss.backward() # Error: leaf variable that requires grad is being used

# Good
out = model(x)
loss = criterion(out, y)
loss.backward()
\`\`\`

Be methodical: check CUDA availability, memory usage, tensor shapes.`;
}

// ── Auto-Detect Review Agent ──────────────────────────────
export function buildAutoReviewPrompt(cwd: string, target?: string): string {
  const lang = detectProjectLanguage(cwd);

  switch (lang) {
    case 'typescript':
      return buildTSReviewPrompt(cwd, target);
    case 'python':
      return buildPyReviewPrompt(cwd, target);
    case 'go':
      return buildGoReviewPrompt(cwd, target);
    case 'rust':
      return buildRustReviewPrompt(cwd, target);
    case 'java':
      return buildJavaReviewPrompt(cwd, target);
    case 'cpp':
      return buildCppReviewPrompt(cwd, target);
    case 'kotlin':
      return buildKotlinReviewPrompt(cwd, target);
    case 'php':
      return buildPhpReviewPrompt(cwd, target);
    case 'sql':
      return buildDbReviewPrompt(cwd, target);
    default:
      return buildTSReviewPrompt(cwd, target);
  }
}
