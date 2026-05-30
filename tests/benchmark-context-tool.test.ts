import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { BenchmarkContextTool } from '../src/tools/benchmark-context.js';
import { getToolByName } from '../src/tools/index.js';
import { addDrawer } from '../src/mempalace/index.js';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'grawkus-bench-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  delete process.env.GRAWKUS_BENCHMARK_TRACE_DIR;
  delete process.env.GRAWKUS_BENCHMARK_EXPERIENCE;
  delete process.env.GRAWKUS_BENCHMARK_PROBE_NETWORK;
  delete process.env.HF_HUB_OFFLINE;
  delete process.env.TRANSFORMERS_OFFLINE;
  delete process.env.PIP_NO_INDEX;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_API_TOKEN;
  delete process.env.HF_TOKEN;
  delete process.env.KAGGLE_API_TOKEN;
  delete process.env.KAGGLE_TOKEN;
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('benchmark_context tool', () => {
  it('is registered as a read-only tool', () => {
    const tool = getToolByName('benchmark_context');
    expect(tool).toBe(BenchmarkContextTool);
    expect(tool?.isReadOnly).toBe(true);
    expect(tool?.isDestructive).toBe(false);
    expect((tool?.parameters.properties as Record<string, unknown>).probe_network).toBeDefined();
  });

  it('summarizes manifests, likely verifiers, task files, and oracle candidates', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'tests'));
    mkdirSync(join(root, 'oracle'));
    mkdirSync(join(root, 'solution'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    const traceDir = join(root, '.grawkus', 'benchmark-runs');
    const priorRunDir = join(traceDir, '2026-05-26-prior');
    const failedPriorRunDir = join(traceDir, '2026-05-26-failed-prior');
    mkdirSync(priorRunDir, { recursive: true });
    mkdirSync(failedPriorRunDir, { recursive: true });
    process.env.GRAWKUS_BENCHMARK_TRACE_DIR = traceDir;
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      scripts: {
        test: 'vitest run',
        build: 'tsc',
        start: 'node src/server.js',
      },
    }, null, 2));
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    writeFileSync(join(root, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
    writeFileSync(join(root, 'uv.lock'), '');
    writeFileSync(join(root, 'go.mod'), 'module example.com/fixture\n');
    writeFileSync(join(root, 'pom.xml'), '<project></project>\n');
    writeFileSync(join(root, 'mvnw'), '#!/bin/sh\n');
    writeFileSync(join(root, 'build.gradle.kts'), 'plugins { java }\n');
    writeFileSync(join(root, 'gradlew'), '#!/bin/sh\n');
    writeFileSync(join(root, 'fixture.sln'), '\n');
    writeFileSync(join(root, 'Makefile'), 'verify:\n\tpytest\n');
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), [
      'name: CI',
      'on: [push, pull_request]',
      'env:',
      '  NODE_ENV: test',
      '  DATABASE_URL: postgres://postgres:postgres@localhost:5432/app',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    container: node:20',
      '    services:',
      '      postgres:',
      '        image: postgres:16',
      '        env:',
      '          POSTGRES_PASSWORD: postgres',
      '        ports:',
      '          - 5432:5432',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-node@v4',
      '      - uses: actions/cache@v4',
      '      - run: pnpm install --frozen-lockfile',
      '      - run: pnpm run test',
      '      - run: |',
      '          python -m pytest tests/test_app.py',
      '          pnpm run build',
      '',
    ].join('\n'));
    writeFileSync(join(root, '.gitlab-ci.yml'), [
      'image: python:3.12',
      'variables:',
      '  PIP_CACHE_DIR: .cache/pip',
      'services:',
      '  - redis:7',
      '  - name: mysql:8',
      'test:',
      '  script:',
      '    - pytest',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'TASK.md'), [
      '# Task',
      'Fix the task.',
      '',
      '## Acceptance Criteria',
      '- Preserve the CSV export format exactly.',
      '- Must show billing totals with two decimal places.',
      '- Do not change the public API route names.',
      '- No code changes are required if the verifier already passes.',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'task.yaml'), [
      'descriptions:',
      '  - key: base',
      '    description: |',
      '      Create /app/filled_form.pdf exactly.',
      '      Include sha256 without a hyphen in the verification output.',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'task.toml'), 'schema_version = "1.1"\n');
    writeFileSync(join(root, 'instruction.md'), 'Fix the Harbor task.\n');
    writeFileSync(join(root, 'Dockerfile'), 'FROM ubuntu:24.04\n');
    writeFileSync(join(root, 'docker-compose.yaml'), 'services:\n  client:\n    build: .\n');
    writeFileSync(join(root, 'solve.sh'), '#!/bin/bash\necho oracle\n');
    writeFileSync(join(root, 'run-tests.sh'), '#!/bin/bash\npython -m pytest tests/test_outputs.py -rA\n');
    writeFileSync(join(root, 'solution', 'solve.sh'), '#!/bin/bash\ntrue\n');
    writeFileSync(join(root, 'src', 'index.ts'), 'export const ok = true;\n');
    writeFileSync(join(root, 'src', 'server.js'), 'require("http").createServer().listen(3000);\n');
    writeFileSync(join(root, 'src', 'bitcoin_service.py'), 'print("service")\n');
    writeFileSync(join(root, 'src', 'Fixture.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>\n');
    writeFileSync(join(root, 'tests', 'test_app.py'), 'def test_ok(): assert True\n');
    writeFileSync(join(root, 'tests', 'test_outputs.py'), 'def test_output(): assert True\n');
    writeFileSync(join(root, 'tests', 'test.sh'), '#!/bin/bash\npytest /tests/test_outputs.py\n');
    writeFileSync(join(root, 'oracle', 'solution.txt'), 'do not read unless allowed\n');
    writeFileSync(join(priorRunDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-26T12:00:00.000Z',
      verificationCommands: ['pnpm run test', 'python -m pytest'],
      changedFiles: ['src/index.ts', 'tests/test_app.py'],
      worktreeChangedFiles: ['src/index.ts'],
      usage: {
        totalTokens: 3700,
        estimatedCostUsd: 0,
      },
      verificationEvidence: {
        failureSignatures: [{
          seq: 4,
          command: 'pnpm run test',
          framework: 'vitest',
          tests: ['billing totals render with fixed decimals'],
          files: ['src/index.ts'],
          errors: ['AssertionError: expected 12.3 to equal 12.30'],
          raw: 'billing total mismatch',
        }],
      },
      trajectoryQuality: {
        processScore: 96,
        successfulVerificationCount: 2,
        taskContractSignalCount: 4,
        taskContractChecklistAfterContext: true,
        taskContractChecklistComplete: true,
        processDefects: [],
      },
    }, null, 2));
    writeFileSync(join(priorRunDir, 'trace.jsonl'), [
      JSON.stringify({
        seq: 1,
        tool: 'benchmark_context',
        target: root,
        status: 'ok',
        verification: false,
        elapsedMs: 50,
        inputPreview: JSON.stringify({ path: root }),
        outputPreview: 'context',
      }),
      JSON.stringify({
        seq: 2,
        tool: 'read_file',
        target: 'src/index.ts',
        status: 'ok',
        verification: false,
        elapsedMs: 20,
        inputPreview: JSON.stringify({ file_path: 'src/index.ts' }),
        outputPreview: 'export const ok = true;',
      }),
      JSON.stringify({
        seq: 3,
        tool: 'grep',
        target: '/billing/ in src',
        status: 'ok',
        verification: false,
        elapsedMs: 20,
        inputPreview: JSON.stringify({ pattern: 'billing', path: 'src/index.ts' }),
        outputPreview: 'src/index.ts:1: billing',
      }),
      JSON.stringify({
        seq: 4,
        tool: 'bash',
        target: '$ pnpm run test',
        status: 'error',
        verification: true,
        elapsedMs: 200,
        inputPreview: JSON.stringify({ command: 'pnpm run test' }),
        outputPreview: 'FAIL billing totals render with fixed decimals',
      }),
      JSON.stringify({
        seq: 5,
        tool: 'edit_file',
        target: 'src/index.ts',
        status: 'ok',
        verification: false,
        elapsedMs: 10,
        inputPreview: JSON.stringify({ file_path: 'src/index.ts' }),
        outputPreview: 'ok',
      }),
    ].join('\n') + '\n');
    writeFileSync(join(failedPriorRunDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-26T13:00:00.000Z',
      verificationCommands: ['pnpm run test'],
      changedFiles: ['src/index.ts'],
      usage: {
        totalTokens: 9000,
        estimatedCostUsd: 0,
      },
      finalAnswerEvidence: {
        claimsIncomplete: true,
        unsupportedPassingClaim: true,
      },
      trajectoryQuality: {
        processScore: 42,
        successfulVerificationCount: 0,
        processDefects: [
          { code: 'blind_repair_after_failed_verifier' },
          { code: 'no_passing_post_edit_validation' },
        ],
      },
    }, null, 2));

    const result = await BenchmarkContextTool.call({ path: root, probe_network: false }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('# Benchmark Context');
    expect(result.output).toContain('package.json');
    expect(result.output).toContain('TASK.md');
    expect(result.output).toContain('task.yaml');
    expect(result.output).toContain('task.toml');
    expect(result.output).toContain('instruction.md');
    expect(result.output).toContain('Task Instruction Excerpts');
    expect(result.output).toContain('task.yaml:4: description: Create /app/filled_form.pdf exactly.');
    expect(result.output).toContain('task.yaml:5: description: Include sha256 without a hyphen in the verification output.');
    expect(result.output).toContain('Use these exact lines as the initial task contract');
    expect(result.output).toContain('Task Contract Signals');
    expect(result.output).toContain('Preserve the CSV export format exactly.');
    expect(result.output).toContain('Must show billing totals with two decimal places.');
    expect(result.output).toContain('Include sha256 without a hyphen in the verification output.');
    expect(result.output).toContain('Do not change the public API route names.');
    expect(result.output).toContain('No code changes are required if the verifier already passes.');
    expect(result.output).toContain('bash run-tests.sh');
    expect(result.output).toContain('bash tests/test.sh');
    expect(result.output).toContain('python -m pytest tests/test_outputs.py -rA');
    expect(result.output).toContain('pnpm run test');
    expect(result.output).toContain('CI Workflow Hints');
    expect(result.output).toContain('ci workflow: .github/workflows/ci.yml');
    expect(result.output).toContain('ci env: .github/workflows/ci.yml:4: NODE_ENV');
    expect(result.output).toContain('ci env: .github/workflows/ci.yml:5: DATABASE_URL');
    expect(result.output).toContain('ci env: .github/workflows/ci.yml:14: POSTGRES_PASSWORD');
    expect(result.output).not.toContain('postgres://postgres');
    expect(result.output).not.toContain('POSTGRES_PASSWORD: postgres');
    expect(result.output).toContain('ci setup: .github/workflows/ci.yml:19: actions/setup-node@v4');
    expect(result.output).toContain('ci setup: .github/workflows/ci.yml:20: actions/cache@v4');
    expect(result.output).toContain('ci service: .github/workflows/ci.yml:11: postgres');
    expect(result.output).toContain('ci container: .github/workflows/ci.yml:9: node:20');
    expect(result.output).toContain('ci image: .github/workflows/ci.yml:12: postgres:16');
    expect(result.output).toContain('ci image: .gitlab-ci.yml:1: python:3.12');
    expect(result.output).toContain('ci env: .gitlab-ci.yml:3: PIP_CACHE_DIR');
    expect(result.output).toContain('ci service: .gitlab-ci.yml:5: redis:7');
    expect(result.output).toContain('ci image: .gitlab-ci.yml:5: redis:7');
    expect(result.output).toContain('ci service: .gitlab-ci.yml:6: mysql:8');
    expect(result.output).toContain('ci run: .github/workflows/ci.yml:21: pnpm install --frozen-lockfile');
    expect(result.output).toContain('ci verifier: .github/workflows/ci.yml:22: pnpm run test');
    expect(result.output).toContain('ci verifier candidates: pnpm run test | python -m pytest tests/test_app.py && pnpm run build');
    expect(result.output).toContain('CI environment: workflow setup/env/service/container hints were detected');
    expect(result.output).toContain('CI contract: workflow run commands were detected');
    expect(result.output).toContain('reconstruct required CI setup/env/services');
    expect(result.output).toContain('include relevant CI test/build/lint commands');
    expect(result.output).toContain('uv run python -m pytest');
    expect(result.output).toContain('python -m pytest');
    expect(result.output).toContain('go test ./...');
    expect(result.output).toContain('./mvnw test');
    expect(result.output).toContain('./gradlew test');
    expect(result.output).toContain('dotnet test');
    expect(result.output).toContain('make verify');
    expect(result.output).toContain('oracle/solution.txt');
    expect(result.output).toContain('Read-With-Care Candidates');
    expect(result.output).toContain('Benchmark Harness Artifacts');
    expect(result.output).toContain('Benchmark Harness Hints');
    expect(result.output).toContain('Terminal-Bench layout detected');
    expect(result.output).toContain('TerminalWorld layout detected');
    expect(result.output).toContain('Harbor task layout detected');
    expect(result.output).toContain('solve.sh');
    expect(result.output).toContain('solution artifact detected');
    expect(result.output).toContain('Environment Reconstruction Plan');
    expect(result.output).toContain('setup: pnpm install --frozen-lockfile');
    expect(result.output).toContain('setup: uv sync');
    expect(result.output).toContain('setup: go mod download');
    expect(result.output).toContain('setup: ./mvnw dependency:go-offline');
    expect(result.output).toContain('setup: ./gradlew dependencies');
    expect(result.output).toContain('setup: dotnet restore');
    expect(result.output).toContain('setup: docker compose config');
    expect(result.output).toContain('ci setup: mirror workflow setup/env/service/container hints before relying on CI-only verifier failures.');
    expect(result.output).toContain('Use these setup/restore commands before interpreting missing dependency');
    expect(result.output).toContain('Runtime Environment Hints');
    expect(result.output).toContain('uv project detected');
    expect(result.output).toContain('Go module detected');
    expect(result.output).toContain('Maven project detected');
    expect(result.output).toContain('Gradle project detected');
    expect(result.output).toContain('.NET environment hint');
    expect(result.output).toContain('network/offline hint');
    expect(result.output).toContain('Toolchain Probe');
    expect(result.output).toContain('process node: executable=');
    expect(result.output).toContain('package manager expectation: pnpm');
    expect(result.output).toContain('uv verification reminder');
    expect(result.output).toContain('Network / Offline Probe');
    expect(result.output).toContain('network probe: skipped');
    expect(result.output).toContain('Use the toolchain probe to catch PATH, virtualenv, package-manager, and offline/network mismatches');
    expect(result.output).toContain('Service Persistence Hints');
    expect(result.output).toContain('start: node src/server.js');
    expect(result.output).toContain('src/bitcoin_service.py');
    expect(result.output).toContain('background:true');
    expect(result.output).toContain('detached tmux');
    expect(result.output).toContain('Benchmark Method Hints');
    expect(result.output).toContain('planner -> navigator -> editor -> executor');
    expect(result.output).toContain('localization dossier');
    expect(result.output).toContain('decision observability');
    expect(result.output).toContain('Prediction: <change> should make <verifier/behavior> pass');
    expect(result.output).toContain('task instruction excerpts and full instruction files');
    expect(result.output).toContain('source research trigger');
    expect(result.output).toContain('source research digest');
    expect(result.output).toContain('benchmark repo catalog');
    expect(result.output).toContain('benchmark_repo_catalog');
    expect(result.output).toContain('source repository digest');
    expect(result.output).toContain('github_repo_digest');
    expect(result.output).toContain('Source Research Action Plan');
    expect(result.output).toContain('call research_sources:');
    expect(result.output).toContain('"github_kind":"all"');
    expect(result.output).toContain('"kaggle_kind":"both"');
    expect(result.output).toContain('call benchmark_repo_catalog:');
    expect(result.output).toContain('source auth readiness:');
    expect(result.output).toContain('Terminal-Bench Source Catalog Hints');
    expect(result.output).toContain('catalog seed: no exact packaged repo match');
    expect(result.output).toContain('catalog gaps: use benchmark_repo_catalog');
    expect(result.output).toContain('github_kind:"all"');
    expect(result.output).toContain('kind:"all"');
    expect(result.output).toContain('kaggle_kind:"both"');
    expect(result.output).toContain('recent_days:90');
    expect(result.output).toContain('format:"json"');
    expect(result.output).toContain('Prior Benchmark Experience Hints');
    expect(result.output).toContain('previous run: 2026-05-26T12:00:00.000Z');
    expect(result.output).toContain('process_score=96');
    expect(result.output).toContain('success_verifiers=2');
    expect(result.output).toContain('verifiers=pnpm run test | python -m pytest');
    expect(result.output).toContain('changed=src/index.ts, tests/test_app.py');
    expect(result.output).toContain('replay=read_file#2 src/index.ts | grep#3 /billing/ in src | failing_verifier#4 pnpm run test');
    expect(result.output).toContain('failures=pnpm run test tests=billing totals render with fixed decimals files=src/index.ts errors=AssertionError: expected 12.3 to equal 12.30');
    expect(result.output).toContain('contract=signals:4,checklist_after_context:true,complete:true');
    expect(result.output).toContain('usage=3700 tokens/$0.0000');
    expect(result.output).toContain('Treat prior experience as a cost-saving heuristic only');
    expect(result.output).toContain('Prior Benchmark Experience Warnings');
    expect(result.output).toContain('avoid prior run: 2026-05-26T13:00:00.000Z');
    expect(result.output).toContain('reason=no successful verifier|low process score 42|defects=blind_repair_after_failed_verifier|no_passing_post_edit_validation|final answer incomplete or blocked');
    expect(result.output).toContain('unsupported final verification claim');
    expect(result.output).toContain('Do not copy these prior patterns without fresh current-task evidence');
    expect(result.output).toContain('Convert task instruction excerpts and task contract signals into a short todo checklist');
    expect(result.output).toContain('Before each non-trivial edit, write a one-line `Prediction:`');
    expect(result.output).toContain('reuse only the method-level lesson');
    expect(result.output).toContain('replay only the relevant read/search/verifier steps');
    expect(result.output).toContain('avoid any prior patterns listed as warnings');
  }, 15_000);

  it('ranks packaged Terminal-Bench public-repo and no-source catalog hints from task focus', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'TASK.md'), [
      '# Task',
      'Improve benchmark source mining for public agents.',
      'Compare against OpenHands and SageAgent before adding new leaderboard guidance.',
      '',
    ].join('\n'));

    const result = await BenchmarkContextTool.call({
      path: root,
      probe_network: false,
      task: 'Terminal-Bench leaderboard source mining for OpenHands and SageAgent',
    }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Terminal-Bench Source Catalog Hints');
    expect(result.output).toContain('catalog match: OpenHands [official');
    expect(result.output).toContain('repos=OpenHands/openhands');
    expect(result.output).toContain('next=github_repo_digest repo=OpenHands/openhands');
    expect(result.output).toContain('Source Research Action Plan');
    expect(result.output).toContain('research query: "Terminal-Bench leaderboard source mining for OpenHands and SageAgent"');
    expect(result.output).toContain('call research_sources: {"query":"Terminal-Bench leaderboard source mining for OpenHands and SageAgent"');
    expect(result.output).toContain('call benchmark_repo_catalog: {"query":"Terminal-Bench leaderboard source mining for OpenHands and SageAgent","status":"all","limit":12}');
    expect(result.output).toContain('call github_repo_digest: {"repo":"OpenHands/openhands","max_files":500,"max_text_files":6}');
    expect(result.output).toContain('catalog gap: SageAgent [unverified');
    expect(result.output).toContain('repos=(none verified)');
    expect(result.output).toContain('do not overclaim a public repo');
  });

  it('emits a credential-safe exact source research action plan', async () => {
    const root = makeRoot();
    const githubToken = ['gh', 'plan', 'marker'].join('_');
    const hfToken = ['hf', 'plan', 'marker'].join('_');
    const kaggleToken = ['kg', 'plan', 'marker'].join('_');
    process.env.GITHUB_TOKEN = githubToken;
    process.env.HF_TOKEN = hfToken;
    process.env.KAGGLE_API_TOKEN = kaggleToken;
    writeFileSync(join(root, 'TASK.md'), [
      '# Task',
      'Improve agent leaderboard methodology using newest arXiv, GitHub, Hugging Face, and Kaggle evidence.',
      '',
    ].join('\n'));

    const result = await BenchmarkContextTool.call({
      path: root,
      probe_network: false,
      task: 'agent leaderboard methodology newest science',
    }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Source Research Action Plan');
    expect(result.output).toContain('research query: "agent leaderboard methodology newest science"');
    expect(result.output).toContain('source auth readiness: GitHub=found; Hugging Face=found; Kaggle=found; Kaggle competitions=enabled; missing=none');
    expect(result.output).toContain('call research_sources: {"query":"agent leaderboard methodology newest science","source":"all","github_kind":"all","kind":"all","kaggle_kind":"both","recent_days":90,"limit":5,"format":"json"}');
    expect(result.output).toContain('Run these read-only calls before relying on newest science');
    expect(result.output).not.toContain(githubToken);
    expect(result.output).not.toContain(hfToken);
    expect(result.output).not.toContain(kaggleToken);
  });

  it('routes prior source-mining catalog hits without repo digests to warnings', async () => {
    const root = makeRoot();
    const traceDir = join(root, '.grawkus', 'benchmark-runs');
    const priorRunDir = join(traceDir, '2026-05-27-source-mining-missing-digest');
    mkdirSync(priorRunDir, { recursive: true });
    process.env.GRAWKUS_BENCHMARK_TRACE_DIR = traceDir;
    writeFileSync(join(root, 'TASK.md'), [
      '# Task',
      'Improve Terminal-Bench leaderboard source mining for Codex CLI.',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'README.md'), '# Source mining notes\n');
    writeFileSync(join(priorRunDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T10:30:00.000Z',
      verificationCommands: ['npm test'],
      changedFiles: ['README.md'],
      usage: {
        totalTokens: 900,
        estimatedCostUsd: 0,
      },
      trajectoryQuality: {
        processScore: 96,
        successfulVerificationCount: 1,
        processDefects: [],
        sourceMiningCoverage: {
          catalogCallCount: 1,
          repoDigestCallCount: 0,
          catalogUsed: true,
          repoDigestUsed: false,
          catalogQueries: ['codex status:official'],
          catalogPositiveMatchCount: 1,
          catalogGapCount: 0,
          catalogPositiveProjects: ['Codex CLI'],
          catalogGapProjects: [],
          catalogRepos: ['openai/codex'],
          repoDigestRepos: [],
          contextCatalogHintCount: 0,
          contextCatalogGapCount: 0,
        },
      },
      experienceCard: {
        version: 1,
        replayCheckpoints: [],
        failureSignatures: [],
        sourceMiningCoverage: {
          catalogCallCount: 1,
          repoDigestCallCount: 0,
          catalogUsed: true,
          repoDigestUsed: false,
          catalogQueries: ['codex status:official'],
          catalogPositiveMatchCount: 1,
          catalogGapCount: 0,
          catalogPositiveProjects: ['Codex CLI'],
          catalogGapProjects: [],
          catalogRepos: ['openai/codex'],
          repoDigestRepos: [],
          contextCatalogHintCount: 0,
          contextCatalogGapCount: 0,
        },
        verificationCommands: ['npm test'],
        changedFiles: ['README.md'],
        warnings: [],
      },
    }, null, 2));

    const result = await BenchmarkContextTool.call({
      path: root,
      probe_network: false,
      task: 'Terminal-Bench leaderboard source mining for Codex CLI',
    }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Prior Benchmark Experience Warnings');
    expect(result.output).toContain('avoid prior run: 2026-05-27T10:30:00.000Z');
    expect(result.output).toContain('reason=source_mining_catalog_without_digest=Codex CLI');
    expect(result.output).toContain('source_mining=catalog_calls:1,repo_digest_calls:0,context_hints:0,context_gaps:0,matches:1,gaps:0,projects:Codex CLI,catalog_repos:openai/codex,queries:codex status:official');
  });

  it('surfaces offline environment indicators without leaking env values', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'npm test' } }));
    process.env.HF_HUB_OFFLINE = '1';
    process.env.PIP_NO_INDEX = 'https://example.invalid/private-index';

    const result = await BenchmarkContextTool.call({ path: root, probe_network: false }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Network / Offline Probe');
    expect(result.output).toContain('network env indicators: HF_HUB_OFFLINE=set, PIP_NO_INDEX=set');
    expect(result.output).not.toContain('example.invalid');
    expect(result.output).toContain('network probe: skipped');
  });

  it('uses summary experience-card replay checkpoints when trace.jsonl is absent', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'src'));
    const traceDir = join(root, '.grawkus', 'benchmark-runs');
    const priorRunDir = join(traceDir, '2026-05-27-card-prior');
    mkdirSync(priorRunDir, { recursive: true });
    process.env.GRAWKUS_BENCHMARK_TRACE_DIR = traceDir;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    writeFileSync(join(root, 'TASK.md'), [
      '# Task',
      '',
      '## Acceptance Criteria',
      '- Must show billing totals with two decimal places.',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'src', 'app.ts'), 'export const total = 12.3;\n');
    writeFileSync(join(priorRunDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T09:00:00.000Z',
      verificationCommands: ['npm test'],
      changedFiles: ['src/app.ts'],
      usage: {
        totalTokens: 1200,
        estimatedCostUsd: 0,
      },
      trajectoryQuality: {
        processScore: 95,
        successfulVerificationCount: 1,
        processDefects: [],
      },
      experienceCard: {
        version: 1,
        replayCheckpoints: [
          { seq: 2, tool: 'read_file', target: 'src/app.ts', reason: 'file_context', score: 11 },
          { seq: 3, tool: 'bash', target: 'npm test', reason: 'failing_verifier', score: 12 },
        ],
        failureSignatures: [{
          seq: 3,
          command: 'npm test',
          framework: 'vitest',
          tests: ['billing totals render with fixed decimals'],
          files: ['src/app.ts'],
          errors: ['AssertionError: expected 12.3 to equal 12.30'],
          raw: 'billing total mismatch',
        }],
        sourceResearchCoverage: {
          callCount: 1,
          arxiv: true,
          github: true,
          huggingface: true,
          kaggle: true,
          sourceHitCount: 4,
          sourceErrorCount: 0,
          githubKinds: ['repositories', 'issues'],
          huggingFaceKinds: ['papers'],
          kaggleKinds: ['competitions'],
          resultSources: ['arxiv', 'github_repo', 'hf_paper', 'kaggle_competition'],
          topUrls: [
            'https://arxiv.org/abs/2602.08316',
            'https://github.com/example/benchmark-agent',
          ],
          recentDays: [90],
          freshTargetedCoverage: true,
          kaggleCompetitionsSkipped: false,
          coverageNotes: ['targeted benchmark coverage requested'],
          completeTargetedCoverage: true,
        },
        sourceMiningCoverage: {
          catalogCallCount: 1,
          repoDigestCallCount: 1,
          catalogUsed: true,
          repoDigestUsed: true,
          catalogQueries: ['openhands status:all'],
          catalogPositiveMatchCount: 1,
          catalogGapCount: 1,
          catalogPositiveProjects: ['OpenHands'],
          catalogGapProjects: ['SageAgent'],
          catalogRepos: ['OpenHands/openhands'],
          repoDigestRepos: ['OpenHands/openhands'],
          contextCatalogHintCount: 2,
          contextCatalogGapCount: 1,
        },
        proactivity: {
          detected: true,
          risk: false,
          signalCount: 0,
          signals: [],
          contextContract: {
            profile: true,
            history: true,
            files: true,
            appState: true,
            tools: true,
            preferences: true,
            coverageCount: 6,
          },
          hiddenIntentEvidence: true,
          clarificationEvidence: true,
          privacyEvidence: true,
          completionEvidence: true,
          actionCount: 1,
        },
        taskContract: {
          signalCount: 2,
          signals: [
            'TASK.md: Must show billing totals with two decimal places.',
          ],
          checklistAfterContext: true,
          checklistComplete: true,
          incompleteCount: 0,
          incompleteItems: [],
        },
        environmentReconstruction: {
          setupFailureCount: 1,
          unresolvedSetupFailureCount: 0,
          setupCount: 1,
          successfulSetupCount: 1,
          setupEvents: [{
            seq: 4,
            command: 'npm ci',
            status: 'ok',
            kind: 'node package install',
          }],
          setupFailures: [{
            seq: 3,
            command: 'npm test',
            reason: 'javascript dependency or build artifact missing',
            evidence: "Error: Cannot find module 'vitest'",
          }],
          unresolvedSetupFailures: [],
        },
        dependencyUpgrade: {
          manifestEditCount: 1,
          lockfileEditCount: 1,
          manifestEdits: [{
            seq: 5,
            tool: 'apply_patch',
            target: 'package.json',
            ecosystem: 'node',
            kind: 'manifest',
          }],
          lockfileEdits: [{
            seq: 5,
            tool: 'apply_patch',
            target: 'package-lock.json',
            ecosystem: 'node',
            kind: 'lockfile',
          }],
          setupAfterManifestEdit: true,
          passingSetupAfterManifestEdit: true,
          validationAfterManifestEdit: true,
          passingValidationAfterManifestEdit: true,
          firstSetupAfterManifestEditSeq: 6,
          firstValidationAfterManifestEditSeq: 7,
        },
        decisionObservability: {
          editCount: 1,
          predictedEditCount: 1,
          verifiedPredictionCount: 1,
          editPredictions: [{
            editSeq: 5,
            tool: 'edit_file',
            target: 'src/app.ts',
            prediction: 'formatting total should satisfy billing assertion',
            nextVerifierSeq: 6,
            nextVerifierStatus: 'ok',
            nextVerifierCommand: 'npm test',
          }],
        },
        validationReliability: {
          lastEditSeq: 5,
          finalEditVerificationCount: 2,
          finalEditPassingVerificationCount: 2,
          stableValidationAfterLastEdit: true,
          broadValidationAfterLastEdit: true,
          passingBroadValidationAfterLastEdit: true,
          ciValidationAfterLastEdit: false,
          passingCiValidationAfterLastEdit: false,
          postEditRegressionCycleCount: 0,
          lastPostEditVerificationSeq: 7,
          lastPostEditVerificationStatus: 'ok',
          finalVerifierCommands: ['npm test', 'npm run build'],
        },
        contextUtilization: {
          inspectCount: 4,
          hitCount: 3,
          missCount: 1,
          utilizationPercent: 75,
          risk: false,
          missEvents: [{
            seq: 2,
            tool: 'read_file',
            target: 'src/unrelated.ts',
            reason: 'local read/search/list inspection did not match any edited source target',
          }],
          preEditInspectCount: 4,
          preEditHitCount: 3,
          preEditMissCount: 1,
          preEditUtilizationPercent: 75,
          preEditBloatRisk: false,
          preEditBloatEvents: [{
            seq: 2,
            tool: 'read_file',
            target: 'src/unrelated.ts',
            reason: 'pre-edit local read/search/list inspection did not match any eventual edited source target',
          }],
        },
        runEfficiency: {
          toolCallCount: 8,
          totalToolElapsedMs: 620000,
          maxToolElapsedMs: 300000,
          slowToolCallCount: 2,
          usageCallCount: 2,
          totalTokens: 1200,
          estimatedCostUsd: 0,
          successfulVerificationCount: 1,
          processScore: 95,
          processDefectCount: 0,
          warningCount: 0,
          invalidToolActionCount: 0,
          invalidToolActionPercent: 0,
          costEfficiencyRisk: false,
          timeEfficiencyRisk: true,
        },
        verificationCommands: ['npm test'],
        changedFiles: ['src/app.ts'],
        warnings: [],
      },
    }, null, 2));

    const result = await BenchmarkContextTool.call({ path: root }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('previous run: 2026-05-27T09:00:00.000Z');
    expect(result.output).toContain('replay=read_file#2 src/app.ts | failing_verifier#3 npm test');
    expect(result.output).toContain('failures=npm test tests=billing totals render with fixed decimals files=src/app.ts errors=AssertionError: expected 12.3 to equal 12.30');
    expect(result.output).toContain('contract_overlap=TASK.md: Must show billing totals with two decimal places.');
    expect(result.output).toContain('contract=signals:2,checklist_after_context:true,complete:true');
    expect(result.output).toContain('environment=setup_failures:1,unresolved:0,setup:1,setup_ok:1,commands:npm ci,failures:javascript dependency or build artifact missing');
    expect(result.output).toContain('dependency=manifests:1,lockfiles:1,setup:true,setup_ok:true,validation:true,validation_ok:true,targets:node:package.json|node:package-lock.json');
    expect(result.output).toContain('decision=edits:1,predicted:1,verified:1,predictions:#5 src/app.ts -> ok: formatting total should satisfy billing assertion');
    expect(result.output).toContain('reliability=final_verifiers:2,final_ok:2,stable:true,broad_ok:true,ci_ok:false,regressions:0,post_success_mutations:0,latest:ok,commands:npm test|npm run build');
    expect(result.output).toContain('context=inspects:4,hits:3,misses:1,utilization:75.00%,risk:false,unused:read_file#2 src/unrelated.ts,pre_edit:3/4,pre_edit_utilization:75.00%,pre_edit_bloat:false,pre_edit_unused:read_file#2 src/unrelated.ts');
    expect(result.output).toContain('source_research=calls:1,hits:4,errors:0,sources:arxiv|github|huggingface|kaggle,github:repositories|issues,hf:papers,kaggle:competitions,result_sources:arxiv|github_repo|hf_paper|kaggle_competition,targeted:true,fresh:true,kaggle_skipped:false,recent_days:90,top:https://arxiv.org/abs/2602.08316|https://github.com/example/benchmark-agent,notes:targeted benchmark coverage requested');
    expect(result.output).toContain('source_mining=catalog_calls:1,repo_digest_calls:1,context_hints:2,context_gaps:1,matches:1,gaps:1,projects:OpenHands,gap_projects:SageAgent,catalog_repos:OpenHands/openhands,repo_digests:OpenHands/openhands,queries:openhands status:all');
    expect(result.output).toContain('proactivity=detected:true,risk:false,signals:0,context:6/6,hidden_intent:true,clarification:true,privacy:true,completion:true,actions:1');
    expect(result.output).toContain('efficiency=tools:8,tool_elapsed_ms:620000,slow_tools:2,usage_calls:2,tokens:1200,cost:$0.0000,cost_risk:false,time_risk:true,invalid:0,invalid_pct:0.00,success_verifiers:1,process_score:95,process_defects:0,warnings:0');
  }, 15_000);

  it('routes trajectory-cleanup risky prior runs to prior-experience warnings', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'src'), { recursive: true });
    const traceDir = join(root, '.grawkus', 'benchmark-runs');
    const priorRunDir = join(traceDir, '2026-05-27-noisy-prior');
    mkdirSync(priorRunDir, { recursive: true });
    process.env.GRAWKUS_BENCHMARK_TRACE_DIR = traceDir;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    writeFileSync(join(root, 'TASK.md'), '- Must show billing totals with two decimal places.\n');
    writeFileSync(join(root, 'src', 'app.ts'), 'export const total = 12.3;\n');
    writeFileSync(join(priorRunDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T09:30:00.000Z',
      verificationCommands: ['npm test'],
      changedFiles: ['src/app.ts'],
      usage: {
        totalTokens: 2400,
        estimatedCostUsd: 0,
      },
      trajectoryQuality: {
        processScore: 90,
        successfulVerificationCount: 1,
        processDefects: [
          { code: 'trajectory_cleanup_needed' },
        ],
        trajectoryCleanupRisk: true,
        trajectoryCleanupEventCount: 2,
        trajectoryCleanupNoisyOutputCount: 1,
        trajectoryCleanupDuplicateOutputCount: 1,
        trajectoryCleanupOversizedOutputCount: 0,
      },
      experienceCard: {
        trajectoryCleanup: {
          risk: true,
          eventCount: 2,
          noisyOutputCount: 1,
          base64OutputCount: 1,
          highEntropyOutputCount: 0,
          duplicateOutputCount: 1,
          oversizedOutputCount: 0,
          events: [
            { seq: 4, tool: 'read_file', target: 'tmp/screenshot.txt', reason: 'base64_blob', evidence: 'output contains a base64 blob' },
            { seq: 6, tool: 'read_file', target: 'src/app.ts', reason: 'duplicate_output', duplicateOfSeq: 5, evidence: 'output repeats grep#5' },
          ],
        },
      },
    }, null, 2));

    const result = await BenchmarkContextTool.call({ path: root }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('avoid prior run: 2026-05-27T09:30:00.000Z');
    expect(result.output).toContain('reason=defects=trajectory_cleanup_needed|trajectory_cleanup=2');
    expect(result.output).toContain('cleanup=events:2,noisy:1,base64:1,entropy:0,duplicates:1,oversized:0,risk:true');
    expect(result.output).toContain('signals:base64_blob read_file#4 tmp/screenshot.txt | duplicate_output read_file#6 src/app.ts repeat_of:#5');
  }, 15_000);

  it('routes missing root-cause prior runs to prior-experience warnings', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'src'), { recursive: true });
    const traceDir = join(root, '.grawkus', 'benchmark-runs');
    const priorRunDir = join(traceDir, '2026-05-27-root-cause-prior');
    mkdirSync(priorRunDir, { recursive: true });
    process.env.GRAWKUS_BENCHMARK_TRACE_DIR = traceDir;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    writeFileSync(join(root, 'TASK.md'), '- Must trim parser input.\n');
    writeFileSync(join(root, 'src', 'parser.ts'), 'export const parse = (input: string) => input;\n');
    writeFileSync(join(priorRunDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T09:45:00.000Z',
      verificationCommands: ['npm test -- parser'],
      changedFiles: ['src/parser.ts'],
      usage: {
        totalTokens: 1800,
        estimatedCostUsd: 0,
      },
      trajectoryQuality: {
        processScore: 90,
        successfulVerificationCount: 1,
        processDefects: [
          { code: 'missing_root_cause_hypothesis' },
        ],
        rootCauseHypothesisRecorded: false,
        rootCauseHypothesisRisk: true,
        rootCauseHypothesisSignalCount: 1,
      },
      experienceCard: {
        rootCauseHypothesis: {
          recorded: false,
          risk: true,
          signalCount: 1,
          signals: [{
            seq: 4,
            editSeq: 4,
            failedVerificationSeq: 3,
            reason: 'missing_root_cause_before_repair_edit',
            evidence: 'failed verifier #3 npm test -- parser was followed by edit_file#4 src/parser.ts without a diagnosis',
          }],
        },
      },
    }, null, 2));

    const result = await BenchmarkContextTool.call({ path: root }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('avoid prior run: 2026-05-27T09:45:00.000Z');
    expect(result.output).toContain('reason=defects=missing_root_cause_hypothesis|root_cause_missing=1');
    expect(result.output).toContain('root_cause=recorded:false,risk:true,signals:1');
    expect(result.output).toContain('evidence:missing_root_cause_before_repair_edit fail#3 edit#4');
  }, 15_000);

  it('routes missing targeted-fix prior runs to prior-experience warnings', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'src'), { recursive: true });
    const traceDir = join(root, '.grawkus', 'benchmark-runs');
    const priorRunDir = join(traceDir, '2026-05-27-targeted-fix-prior');
    mkdirSync(priorRunDir, { recursive: true });
    process.env.GRAWKUS_BENCHMARK_TRACE_DIR = traceDir;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    writeFileSync(join(root, 'TASK.md'), '- Must trim parser input.\n');
    writeFileSync(join(root, 'src', 'parser.ts'), 'export const parse = (input: string) => input;\n');
    writeFileSync(join(priorRunDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T09:50:00.000Z',
      verificationCommands: ['npm test -- parser'],
      changedFiles: ['src/parser.ts'],
      usage: {
        totalTokens: 1800,
        estimatedCostUsd: 0,
      },
      trajectoryQuality: {
        processScore: 90,
        successfulVerificationCount: 1,
        processDefects: [
          { code: 'missing_targeted_fix_manifest' },
        ],
      },
      changeEvaluation: {
        status: 'confirmed',
        accepted: true,
        editCount: 1,
        predictedEditCount: 1,
        targetedFixCount: 0,
        missingTargetedFixCount: 1,
        regressionForecastCount: 1,
        missingRegressionForecastCount: 0,
        confirmedPredictionCount: 1,
        contradictedPredictionCount: 0,
        unverifiedPredictionCount: 0,
        regressionCycleCount: 0,
      },
      experienceCard: {
        decisionObservability: {
          editCount: 1,
          predictedEditCount: 1,
          verifiedPredictionCount: 1,
          targetedFixCount: 0,
          missingTargetedFixCount: 1,
          regressionForecastCount: 1,
          missingRegressionForecastCount: 0,
          editPredictions: [{
            editSeq: 4,
            tool: 'edit_file',
            target: 'src/parser.ts',
            prediction: 'trimming parser input should pass parser tests',
            targetedFix: null,
            requiresTargetedFix: true,
            predictedRegression: 'tokenizer whitespace behavior could change',
            nextVerifierSeq: 5,
            nextVerifierStatus: 'ok',
            nextVerifierCommand: 'npm test -- parser',
          }],
        },
      },
    }, null, 2));

    const result = await BenchmarkContextTool.call({ path: root }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('avoid prior run: 2026-05-27T09:50:00.000Z');
    expect(result.output).toContain('reason=defects=missing_targeted_fix_manifest|missing_targeted_fixes=1');
    expect(result.output).toContain('decision=edits:1,predicted:1,verified:1,targeted_fixes:0,missing_targeted_fixes:1');
  }, 15_000);

  it('routes undiagnosed failure-onset prior runs to prior-experience warnings', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'src'), { recursive: true });
    const traceDir = join(root, '.grawkus', 'benchmark-runs');
    const priorRunDir = join(traceDir, '2026-05-27-failure-onset-prior');
    mkdirSync(priorRunDir, { recursive: true });
    process.env.GRAWKUS_BENCHMARK_TRACE_DIR = traceDir;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    writeFileSync(join(root, 'TASK.md'), '- Must trim parser input.\n');
    writeFileSync(join(root, 'src', 'parser.ts'), 'export const parse = (input: string) => input;\n');
    writeFileSync(join(priorRunDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T09:55:00.000Z',
      verificationCommands: ['npm test -- parser'],
      changedFiles: ['src/parser.ts'],
      usage: {
        totalTokens: 1800,
        estimatedCostUsd: 0,
      },
      trajectoryQuality: {
        processScore: 88,
        successfulVerificationCount: 1,
        processDefects: [
          { code: 'undiagnosed_failure_onset_loop' },
        ],
        failureOnset: {
          detected: true,
          risk: true,
          category: 'repair_loop',
          failedVerificationSeq: 3,
          suspectedOnsetSeq: 3,
          diagnosisRecorded: false,
          downstreamRepairCount: 1,
          blindRepairCount: 0,
          unalignedRepairCount: 0,
          repeatedVerifierCount: 2,
          regressionCycleCount: 0,
          evidence: ['failed_verifier=#3 command=npm test -- parser status=error', 'failure_files=src/parser.ts'],
          recommendedAction: 'avoid_redundant_rerun',
        },
        trajectoryTriage: {
          informative: true,
          score: 12,
          signalCount: 1,
          categories: { interaction: 0, execution: 1, environment: 0 },
          signals: [{
            category: 'execution',
            kind: 'loop',
            severity: 'high',
            seq: 3,
            evidence: 'redundant_verifiers=2',
          }],
          summary: 'execution/loop:high',
        },
      },
      experienceCard: {
        failureOnset: {
          detected: true,
          risk: true,
          category: 'repair_loop',
          failedVerificationSeq: 3,
          suspectedOnsetSeq: 3,
          diagnosisRecorded: false,
          downstreamRepairCount: 1,
          blindRepairCount: 0,
          unalignedRepairCount: 0,
          repeatedVerifierCount: 2,
          regressionCycleCount: 0,
          evidence: ['failed_verifier=#3 command=npm test -- parser status=error', 'failure_files=src/parser.ts'],
          recommendedAction: 'avoid_redundant_rerun',
        },
        trajectoryTriage: {
          informative: true,
          score: 12,
          signalCount: 1,
          categories: { interaction: 0, execution: 1, environment: 0 },
          signals: [{
            category: 'execution',
            kind: 'loop',
            severity: 'high',
            seq: 3,
            evidence: 'redundant_verifiers=2',
          }],
          summary: 'execution/loop:high',
        },
      },
    }, null, 2));

    const result = await BenchmarkContextTool.call({ path: root }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('avoid prior run: 2026-05-27T09:55:00.000Z');
    expect(result.output).toContain('reason=defects=undiagnosed_failure_onset_loop|failure_onset=repair_loop:avoid_redundant_rerun');
    expect(result.output).toContain('failure_onset=detected:true,category:repair_loop,risk:true,diagnosed:false,failed:#3,onset:#3,repairs:1');
    expect(result.output).toContain('triage=score:12,informative:true,signals:1,categories:0/1/0');
    expect(result.output).toContain('evidence:failed_verifier=#3 command=npm test -- parser status=error');
  }, 15_000);

  it('routes context-bloated prior runs to prior-experience warnings', async () => {
    const root = makeRoot();
    const traceDir = join(root, '.grawkus', 'benchmark-runs');
    const bloatedPriorDir = join(traceDir, '2026-05-27-bloated-context');
    const disciplinedPriorDir = join(traceDir, '2026-05-27-disciplined-context');
    mkdirSync(bloatedPriorDir, { recursive: true });
    mkdirSync(disciplinedPriorDir, { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    process.env.GRAWKUS_BENCHMARK_TRACE_DIR = traceDir;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'npm test' } }));
    writeFileSync(join(root, 'TASK.md'), [
      '# Task',
      '',
      '## Acceptance Criteria',
      '- Must preserve parser behavior while fixing date handling.',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'src', 'parser.ts'), 'export const parser = true;\n');

    writeFileSync(join(bloatedPriorDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T12:00:00.000Z',
      verificationCommands: ['npm test'],
      changedFiles: ['src/parser.ts'],
      trajectoryQuality: {
        processScore: 99,
        successfulVerificationCount: 2,
        processDefects: [],
      },
      experienceCard: {
        contextUtilization: {
          inspectCount: 7,
          hitCount: 1,
          missCount: 6,
          utilizationPercent: 14.29,
          risk: true,
          missEvents: [{
            seq: 2,
            tool: 'read_file',
            target: 'src/unrelated.ts',
            reason: 'local read/search/list inspection did not match any edited source target',
          }],
          preEditInspectCount: 7,
          preEditHitCount: 1,
          preEditMissCount: 6,
          preEditUtilizationPercent: 14.29,
          preEditBloatRisk: true,
          preEditBloatEvents: [{
            seq: 3,
            tool: 'grep',
            target: 'docs/archive.md',
            reason: 'pre-edit local read/search/list inspection did not match any eventual edited source target',
          }],
        },
      },
    }, null, 2));

    writeFileSync(join(disciplinedPriorDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T12:05:00.000Z',
      verificationCommands: ['npm test'],
      changedFiles: ['src/parser.ts'],
      trajectoryQuality: {
        processScore: 94,
        successfulVerificationCount: 1,
        processDefects: [],
      },
      experienceCard: {
        contextUtilization: {
          inspectCount: 5,
          hitCount: 4,
          missCount: 1,
          utilizationPercent: 80,
          risk: false,
          preEditInspectCount: 5,
          preEditHitCount: 4,
          preEditMissCount: 1,
          preEditUtilizationPercent: 80,
          preEditBloatRisk: false,
        },
      },
    }, null, 2));

    const result = await BenchmarkContextTool.call({ path: root, probe_network: false }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('avoid prior run: 2026-05-27T12:00:00.000Z');
    expect(result.output).toContain('reason=low_context_utilization=1/7|pre_edit_context_bloat=1/7');
    expect(result.output).toContain('context=inspects:7,hits:1,misses:6,utilization:14.29%,risk:true,unused:read_file#2 src/unrelated.ts,pre_edit:1/7,pre_edit_utilization:14.29%,pre_edit_bloat:true,pre_edit_unused:grep#3 docs/archive.md');
    expect(result.output).not.toContain('previous run: 2026-05-27T12:00:00.000Z');
    expect(result.output).toContain('previous run: 2026-05-27T12:05:00.000Z');
    expect(result.output).toContain('context=inspects:5,hits:4,misses:1,utilization:80.00%,risk:false,pre_edit:4/5,pre_edit_utilization:80.00%,pre_edit_bloat:false');
  }, 15_000);

  it('ranks complete Pi-Bench proactivity evidence ahead of generic prior runs', async () => {
    const root = makeRoot();
    const traceDir = join(root, '.grawkus', 'benchmark-runs');
    const completePriorDir = join(traceDir, '2026-05-27-complete-pibench');
    const genericPriorDir = join(traceDir, '2026-05-27-generic-prior');
    const riskyPriorDir = join(traceDir, '2026-05-27-risky-pibench');
    mkdirSync(completePriorDir, { recursive: true });
    mkdirSync(genericPriorDir, { recursive: true });
    mkdirSync(riskyPriorDir, { recursive: true });
    process.env.GRAWKUS_BENCHMARK_TRACE_DIR = traceDir;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'npm test' } }));
    writeFileSync(join(root, 'TASK.md'), [
      '# Task',
      '',
      'Pi-Bench proactive personal assistant scenario.',
      '',
      '## Acceptance Criteria',
      '- Must infer hidden intent from user profile, message history, current app context, files, and preferences.',
      '- Must record whether clarification is needed and review privacy risk before acting.',
      '- Must produce observable completion evidence.',
      '',
    ].join('\n'));

    writeFileSync(join(completePriorDir, 'summary.json'), JSON.stringify({
      cwd: join(root, '..', 'other-pibench-workspace'),
      endedAt: '2026-05-27T10:00:00.000Z',
      verificationCommands: ['custom pibench verifier'],
      changedFiles: ['assistant/actions.ts'],
      trajectoryQuality: {
        processScore: 94,
        successfulVerificationCount: 1,
        processDefects: [],
      },
      experienceCard: {
        proactivity: {
          detected: true,
          risk: false,
          signalCount: 0,
          signals: [],
          contextContract: {
            profile: true,
            history: true,
            files: true,
            appState: true,
            tools: true,
            preferences: true,
            coverageCount: 6,
          },
          hiddenIntentEvidence: true,
          clarificationEvidence: true,
          privacyEvidence: true,
          completionEvidence: true,
          actionCount: 2,
        },
      },
    }, null, 2));

    writeFileSync(join(genericPriorDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T10:05:00.000Z',
      verificationCommands: ['custom verifier'],
      changedFiles: ['src/index.ts'],
      trajectoryQuality: {
        processScore: 99,
        successfulVerificationCount: 1,
        processDefects: [],
      },
    }, null, 2));

    writeFileSync(join(riskyPriorDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T10:10:00.000Z',
      verificationCommands: ['custom pibench verifier'],
      changedFiles: ['assistant/actions.ts'],
      trajectoryQuality: {
        processScore: 92,
        successfulVerificationCount: 1,
        processDefects: [
          { code: 'pibench_proactivity_ledger_risk' },
        ],
      },
      experienceCard: {
        proactivity: {
          detected: true,
          risk: true,
          signalCount: 2,
          signals: [
            { reason: 'missing_hidden_intent_hypothesis', target: 'hidden-intent hypotheses' },
          ],
          contextContract: {
            profile: true,
            history: false,
            files: false,
            appState: false,
            tools: false,
            preferences: false,
            coverageCount: 1,
          },
          hiddenIntentEvidence: false,
          clarificationEvidence: false,
          privacyEvidence: false,
          completionEvidence: true,
          actionCount: 1,
        },
      },
    }, null, 2));

    const result = await BenchmarkContextTool.call({ path: root, probe_network: false }, process.cwd());

    expect(result.isError).toBe(false);
    const completeIndex = result.output.indexOf('previous run: 2026-05-27T10:00:00.000Z');
    const genericIndex = result.output.indexOf('previous run: 2026-05-27T10:05:00.000Z');
    expect(completeIndex).toBeGreaterThan(-1);
    expect(genericIndex).toBeGreaterThan(-1);
    expect(completeIndex).toBeLessThan(genericIndex);
    expect(result.output).toContain('proactivity=detected:true,risk:false,signals:0,context:6/6,hidden_intent:true,clarification:true,privacy:true,completion:true,actions:2');
    expect(result.output).toContain('avoid prior run: 2026-05-27T10:10:00.000Z');
    expect(result.output).toContain('reason=defects=pibench_proactivity_ledger_risk');
    expect(result.output).toContain('proactivity=detected:true,risk:true,signals:2,context:1/6,hidden_intent:false,clarification:false,privacy:false,completion:true,actions:1');
  }, 15_000);

  it('routes rejected AHE change evaluations to prior-experience warnings', async () => {
    const root = makeRoot();
    const traceDir = join(root, '.grawkus', 'benchmark-runs');
    const rejectedPriorDir = join(traceDir, '2026-05-27-rejected-change-evaluation');
    const pendingPriorDir = join(traceDir, '2026-05-27-pending-change-evaluation');
    const confirmedPriorDir = join(traceDir, '2026-05-27-confirmed-change-evaluation');
    mkdirSync(rejectedPriorDir, { recursive: true });
    mkdirSync(pendingPriorDir, { recursive: true });
    mkdirSync(confirmedPriorDir, { recursive: true });
    process.env.GRAWKUS_BENCHMARK_TRACE_DIR = traceDir;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'npm test' } }));
    writeFileSync(join(root, 'TASK.md'), [
      '# Task',
      '',
      '## Acceptance Criteria',
      '- Must preserve the parser regression behavior.',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'parser.ts'), 'export const parser = true;\n');

    writeFileSync(join(rejectedPriorDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T11:00:00.000Z',
      verificationCommands: ['npm test'],
      changedFiles: ['parser.ts'],
      trajectoryQuality: {
        processScore: 98,
        successfulVerificationCount: 2,
        processDefects: [],
      },
      changeEvaluation: {
        status: 'contradicted',
        accepted: false,
        editCount: 1,
        predictedEditCount: 1,
        regressionForecastCount: 1,
        missingRegressionForecastCount: 0,
        unpredictedEditCount: 0,
        confirmedPredictionCount: 0,
        contradictedPredictionCount: 1,
        unverifiedPredictionCount: 0,
        regressionCycleCount: 1,
        broadRegressionFailureCount: 1,
        recommendedAction: 'Inspect the failed verifier and repair or revert.',
      },
      experienceCard: {
        decisionObservability: {
          editCount: 1,
          predictedEditCount: 1,
          verifiedPredictionCount: 0,
          regressionForecastCount: 1,
          missingRegressionForecastCount: 0,
        },
      },
    }, null, 2));

    writeFileSync(join(pendingPriorDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T11:03:00.000Z',
      verificationCommands: ['npm test'],
      changedFiles: ['parser.ts'],
      trajectoryQuality: {
        processScore: 99,
        successfulVerificationCount: 2,
        processDefects: [],
      },
      changeEvaluation: {
        status: 'pending_verification',
        accepted: null,
        editCount: 1,
        predictedEditCount: 1,
        regressionForecastCount: 1,
        missingRegressionForecastCount: 0,
        unpredictedEditCount: 0,
        confirmedPredictionCount: 0,
        contradictedPredictionCount: 0,
        unverifiedPredictionCount: 1,
        regressionCycleCount: 0,
        broadRegressionFailureCount: 0,
      },
    }, null, 2));

    writeFileSync(join(confirmedPriorDir, 'summary.json'), JSON.stringify({
      cwd: root,
      endedAt: '2026-05-27T11:05:00.000Z',
      verificationCommands: ['npm test'],
      changedFiles: ['parser.ts'],
      trajectoryQuality: {
        processScore: 92,
        successfulVerificationCount: 1,
        processDefects: [],
      },
      changeEvaluation: {
        status: 'confirmed',
        accepted: true,
        editCount: 1,
        predictedEditCount: 1,
        regressionForecastCount: 1,
        missingRegressionForecastCount: 0,
        unpredictedEditCount: 0,
        confirmedPredictionCount: 1,
        contradictedPredictionCount: 0,
        unverifiedPredictionCount: 0,
        regressionCycleCount: 0,
        broadRegressionFailureCount: 0,
      },
    }, null, 2));

    const result = await BenchmarkContextTool.call({ path: root, probe_network: false }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('avoid prior run: 2026-05-27T11:00:00.000Z');
    expect(result.output).toContain('reason=change_evaluation=contradicted|contradicted_predictions=1|regression_cycles=1|broad_regression_failures=1');
    expect(result.output).toContain('decision=edits:1,predicted:1,verified:0,regression_forecasts:1,missing_regression_forecasts:0,change_status:contradicted,accepted:false,unpredicted:0,contradicted:1,unverified:0,regressions:1');
    expect(result.output).toContain('avoid prior run: 2026-05-27T11:03:00.000Z');
    expect(result.output).toContain('reason=change_evaluation=pending_verification|unverified_predictions=1');
    expect(result.output).toContain('decision=edits:1,predicted:1,verified:0,regression_forecasts:1,missing_regression_forecasts:0,change_status:pending_verification,accepted:null,unpredicted:0,contradicted:0,unverified:1,regressions:0');
    expect(result.output).not.toContain('previous run: 2026-05-27T11:00:00.000Z');
    expect(result.output).not.toContain('previous run: 2026-05-27T11:03:00.000Z');
    expect(result.output).toContain('previous run: 2026-05-27T11:05:00.000Z');
    expect(result.output).toContain('decision=edits:1,predicted:1,verified:1,regression_forecasts:1,missing_regression_forecasts:0,change_status:confirmed,accepted:true,unpredicted:0,contradicted:0,unverified:0,regressions:0');
  }, 15_000);

  it('surfaces bounded MemPalace memories as benchmark hypotheses', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'billing-fixture',
      scripts: { test: 'vitest run' },
    }));
    writeFileSync(join(root, 'TASK.md'), [
      '# Task',
      '',
      '## Acceptance Criteria',
      '- Must show billing totals with two decimal places.',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'src', 'app.ts'), 'export const total = 12.3;\n');
    addDrawer({
      wing: 'projects',
      room: 'billing-fixture',
      content: 'billing-fixture lesson: totals should be formatted with fixed two decimal places before rendering invoices.',
      tags: ['billing-fixture', 'benchmark', 'formatting'],
      importance: 0.9,
      scope: 'project',
      cwd: root,
    });

    const result = await BenchmarkContextTool.call({ path: root }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Relevant MemPalace Memories');
    expect(result.output).toContain('project:projects/billing-fixture');
    expect(result.output).toContain('totals should be formatted with fixed two decimal places');
    expect(result.output).toContain('Treat MemPalace memories as hypotheses');
    expect(result.output).toContain('verify each remembered fact against current files');
  });

  it('reports missing paths as errors', async () => {
    const result = await BenchmarkContextTool.call({ path: join(tmpdir(), 'definitely-missing-grawkus') }, process.cwd());
    expect(result.isError).toBe(true);
    expect(result.output).toContain('path does not exist');
  });
});
