# Skill Templates for Grawkus CLI

> Generated from analysis of git history, source conventions, and recurring development workflows.
> Each skill is a reusable prompt template with `{{placeholders}}` for dynamic values.

---

## Skill 1: `feature-dev-workflow`

**Description**: End-to-end feature development workflow — from planning through implementation, testing, and commit.

**Trigger Patterns**: "add feature", "new feature", "implement", "create module", "build feature"

**Steps**:
1. **Understand context** — Read existing code in `{{MODULE_PATH}}` and `{{RELATED_FILES}}` to understand patterns.
2. **Plan changes** — List every file that needs to change and what each change involves.
3. **Create source file** — Write `{{FILE_PATH}}.ts` following the module pattern: JSDoc header, imports (node → external → internal), exported interfaces/types, implementation, exports.
4. **Write tests first** — Create `{{TEST_PATH}}.test.ts` using vitest with RED → GREEN → REFACTOR cycle.
5. **Implement to pass tests** — Write minimal code to make each test pass.
6. **Build and verify** — Run `npx tsc --noEmit` then `npx vitest run`.
7. **Commit** — Stage changes, generate commit message with `/commit`.

**Commands**:
```bash
touch src/{{MODULE_NAME}}.ts
touch tests/{{MODULE_NAME}}.test.ts
npx tsc --noEmit
npx vitest run tests/{{MODULE_NAME}}.test.ts
git add src/{{MODULE_NAME}}.ts tests/{{MODULE_NAME}}.test.ts
```

**Validation**:
- `npx tsc --noEmit` passes with zero errors
- `npx vitest run` shows all tests passing
- Coverage report shows new lines covered
- Commit message follows: `feat: <description>`

---

## Skill 2: `bugfix-workflow`

**Description**: Systematic bug fix — reproduce, isolate, fix, verify, document.

**Trigger Patterns**: "fix bug", "bug fix", "fix issue", "resolve error", "patch"

**Steps**:
1. **Reproduce** — Identify exact conditions and error output.
2. **Isolate root cause** — Use `grep`, `read_file`, `git blame` to trace to specific file/line.
3. **Write failing test** — Minimal reproduction in `tests/bug-{{ISSUE_ID}}.test.ts`.
4. **Apply fix** — Minimal change to source file.
5. **Verify** — Run failing test to confirm pass. Run full suite for regressions.
6. **Add regression test** — Cover the specific bug scenario permanently.
7. **Commit** — `fix:` prefix, reference issue number.

**Commands**:
```bash
git blame -L {{START}},{{END}} src/{{FILE}}.ts
grep -rn "{{ERROR_PATTERN}}" src/
touch tests/bug-{{ISSUE_ID}}.test.ts
npx vitest run
git commit -m "fix: {{DESCRIPTION}} (#{{ISSUE_NUMBER}})"
```

**Validation**:
- Reproduction test passes with fix
- Full test suite passes (no regressions)
- `npx tsc --noEmit` still clean
- Commit message: `fix: <what was wrong> (#<issue>)`

---

## Skill 3: `refactor-workflow`

**Description**: Code refactoring — improve structure without changing behavior.

**Trigger Patterns**: "refactor", "cleanup", "restructure", "simplify", "improve code quality"

**Steps**:
1. **Identify target** — Determine what needs refactoring. Read code thoroughly.
2. **Check tests** — Ensure tests exist. Write characterization tests if missing.
3. **Plan** — Describe what will change vs. stay the same. Note risks.
4. **Apply refactoring** — Make structural changes preserving behavior.
5. **Run tests incrementally** — Verify nothing breaks after each change.
6. **Review diff** — `git diff` to review all changes.
7. **Commit** — `refactor:` prefix.

**Commands**:
```bash
npx vitest run --reporter=verbose
npx vitest run tests/{{MODULE_NAME}}.test.ts
git diff --stat
git diff src/{{FILE}}.ts
git commit -m "refactor: {{WHAT_CHANGED}}"
```

**Validation**:
- All existing tests pass
- No new TypeScript warnings
- Code complexity reduced (fewer lines, clearer names, less duplication)
- Commit message: `refactor: <what improved>`

---

## Skill 4: `test-add-workflow`

**Description**: Add tests for existing untested or under-tested code.

**Trigger Patterns**: "add test", "write test", "test coverage", "increase coverage", "TDD"

**Steps**:
1. **Identify target** — Find file needing tests. Check coverage with `/coverage`.
2. **Read source** — Understand all exported functions, edge cases, error paths.
3. **Write failing tests** — For each behavior, describe expected outcome.
4. **Run tests** — Verify they fail for uncovered behavior.
5. **Add edge cases** — null inputs, empty arrays, boundary values, error conditions.
6. **Check coverage** — Run coverage report.
7. **Commit** — `test:` prefix.

**Commands**:
```bash
npx vitest run --reporter=coverage
touch tests/{{MODULE_NAME}}.test.ts
npx vitest run tests/{{MODULE_NAME}}.test.ts --reporter=verbose
npx vitest run --reporter=coverage --coverage
git commit -m "test: add tests for {{MODULE_NAME}}"
```

**Validation**:
- All new tests pass
- Coverage increased for target module
- Edge cases covered (null, empty, boundary, error)
- Commit message: `test: <what is tested>`

---

## Skill 5: `code-review-workflow`

**Description**: Structured code review — analyze diff for correctness, security, performance, maintainability.

**Trigger Patterns**: "review", "code review", "PR review", "diff review"

**Steps**:
1. **Get diff** — `git diff` or `/diff`.
2. **Review correctness** — Logic errors, edge cases, off-by-one.
3. **Review security** — Injection, XSS, secrets, path traversal.
4. **Review performance** — N+1 queries, unbounded loops, memory leaks.
5. **Review maintainability** — Naming, complexity, dead code, duplication.
6. **Review testing** — Adequate tests? Untested scenarios?
7. **Provide feedback** — Severity: CRITICAL / HIGH / MEDIUM / LOW / NIT.
8. **Verdict** — APPROVE / REQUEST CHANGES / NEEDS DISCUSSION.

**Commands**:
```bash
git diff --stat
git diff src/{{FILE}}.ts
# Use /review in Grawkus for AI-assisted review
```

**Validation**:
- Each file in diff examined
- Issues categorized by severity with line numbers
- Fix suggestions for every issue
- Overall verdict given

---

## Skill 6: `module-creation-workflow`

**Description**: Create a new self-contained module following Grawkus conventions.

**Trigger Patterns**: "create module", "new module", "add module", "scaffold"

**Steps**:
1. **Define interface** — TypeScript interfaces/types for public API.
2. **Implement functions** — Pure functions, error handling, JSDoc comments.
3. **Create tests** — `describe/it/beforeEach` pattern matching existing tests.
4. **Export from index** — Add to `src/index.ts` if needed.
5. **Build and verify** — `npx tsc` then `npx vitest run`.
6. **Commit** — `feat: add {{MODULE_NAME}} module`.

**Commands**:
```bash
touch src/{{MODULE_NAME}}.ts
touch tests/{{MODULE_NAME}}.test.ts
npx tsc --noEmit
npx vitest run tests/{{MODULE_NAME}}.test.ts
git add src/{{MODULE_NAME}}.ts tests/{{MODULE_NAME}}.test.ts
git commit -m "feat: add {{MODULE_NAME}} module"
```

**Validation**:
- Compiles without TypeScript errors
- All tests pass
- Follows existing patterns (see `src/counter.ts` reference)
- Exported functions have JSDoc
- Interfaces defined for all public data structures

---

## Skill 7: `ecc-integration-workflow`

**Description**: Install, update, or troubleshoot ECC resources — skills, agents, commands, rules, hooks.

**Trigger Patterns**: "install ECC", "ecc-install", "ECC resources", "update ECC"

**Steps**:
1. **Check state** — Run `/ecc` to see installed counts and version.
2. **Pull upstream** — If `resources/ecc/` needs updating, pull from upstream repo.
3. **Reinstall** — Run `/ecc-install` to reimport all resources idempotently.
4. **Verify** — Check each category: `/ecc-skills`, `/ecc-agents`, `/ecc-commands`.
5. **Check hooks** — Verify hooks seeded in `~/.grawkus/hooks.json`.
6. **Test a skill** — Trigger a known ECC skill by mentioning its topic.

**Commands**:
```bash
/ecc
/ecc-install
/ecc-skills
/ecc-agents
/ecc-commands
```

**Validation**:
- `/ecc` shows expected counts
- No errors in install output
- Hooks contain `__ecc__` tagged entries
- Skill trigger matching works in a test prompt

---

## Skill 8: `config-change-workflow`

**Description**: Safely modify Grawkus configuration — API keys, providers, models, permissions.

**Trigger Patterns**: "change config", "update config", "set model", "change provider", "config"

**Steps**:
1. **Read current config** — `read_file` on `~/.grawkus/config.json` or use `/config`.
2. **Validate change** — Ensure the new value is valid (URL format, known provider, valid model).
3. **Apply change** — Edit `config.json` or use Grawkus's `/model`, `/provider`, `/perm` commands.
4. **Verify** — Reload config and confirm the change took effect.
5. **Test connection** — Send a test message to verify the new provider/model works.

**Commands**:
```bash
cat ~/.grawkus/config.json
# Edit via /model, /provider, /perm slash commands
# Or edit config.json directly:
# Change "model": "anthropic/claude-sonnet-4" → "model": "{{NEW_MODEL}}"
```

**Validation**:
- Config file is valid JSON
- `loadConfig()` returns the updated values
- Test message succeeds with new provider/model
- No unexpected fields introduced

---

## Skill 9: `hook-management-workflow`

**Description**: Add, remove, or modify hooks for PreToolUse, PostToolUse, SessionStart, SessionStop events.

**Trigger Patterns**: "add hook", "remove hook", "hooks", "hook config"

**Steps**:
1. **List current hooks** — `list_hooks` or read `~/.grawkus/hooks.json`.
2. **Define new hook** — Specify event, match pattern, command, timeout, blocking.
3. **Add hook** — Use `/hooks add` or edit hooks.json directly.
4. **Test hook** — Trigger the matched event to verify the hook fires correctly.
5. **Remove if needed** — Use `/hooks remove <index>` or edit hooks.json.

**Commands**:
```bash
cat ~/.grawkus/hooks.json
# Add hook entry:
# { "event": "PreToolUse", "match": "bash", "command": "node guard.js", "blocking": true }
```

**Validation**:
- hooks.json is valid JSON after edit
- Hook fires on matching event
- Blocking hooks actually block when expected
- No duplicate hooks for same event+match

---

## Skill 10: `build-and-release-workflow`

**Description**: Full build, test, and release cycle for Grawkus itself.

**Trigger Patterns**: "build", "release", "publish", "npm publish", "deploy"

**Steps**:
1. **Run full test suite** — `npx vitest run` with coverage.
2. **Type-check** — `npx tsc --noEmit`.
3. **Build** — `npx tsc` to compile to `dist/`.
4. **Verify build output** — Check `dist/` has all expected `.js` and `.d.ts` files.
5. **Bump version** — Update `package.json` version.
6. **Commit and tag** — `git commit` with `chore:` prefix, `git tag vX.Y.Z`.
7. **Publish** — `npm publish`.

**Commands**:
```bash
npx vitest run --reporter=coverage
npx tsc --noEmit
npx tsc
ls dist/*.js | wc -l
# Update package.json version
git add -A
git commit -m "chore: release v{{VERSION}}"
git tag v{{VERSION}}
npm publish
```

**Validation**:
- All tests pass with coverage >= 80%
- Zero TypeScript errors
- `dist/` contains all expected compiled files
- Package version bumped correctly
- npm publish succeeds
