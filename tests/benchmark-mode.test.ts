import { describe, expect, it } from 'vitest';
import {
  buildBenchmarkPrompt,
  normalizeBenchmarkProfile,
  splitBenchmarkArgs,
} from '../src/evaluation.js';
import { MODES } from '../src/modes.js';

describe('benchmark mode and prompt', () => {
  it('registers a benchmark mode with verification and leakage guidance', () => {
    const mode = MODES.benchmark;
    expect(mode.description).toContain('SWE-bench');
    expect(mode.systemPromptAddition).toContain('Verify');
    expect(mode.systemPromptAddition).toContain('gold patches');
    expect(mode.systemPromptAddition).toContain('benchmark_context');
    expect(mode.suggestedTools).toContain('bash');
    expect(mode.suggestedTools).toContain('benchmark_context');
    expect(mode.suggestedTools).toContain('todo_write');
    expect(mode.suggestedTools).toContain('memory_search');
    expect(mode.suggestedTools).toContain('benchmark_repo_catalog');
    expect(mode.suggestedTools).toContain('github_repo_digest');
    expect(mode.systemPromptAddition).toContain('github_kind:"all"');
    expect(mode.systemPromptAddition).toContain('kaggle_kind:"both"');
    expect(mode.systemPromptAddition).toContain('recent_days:90');
    expect(mode.systemPromptAddition).toContain('format:"json"');
    expect(mode.systemPromptAddition).toContain('replay=');
    expect(mode.systemPromptAddition).toContain('structured digest');
    expect(mode.systemPromptAddition).toContain('benchmark_repo_catalog');
    expect(mode.systemPromptAddition).toContain('github_repo_digest');
  });

  it('normalizes benchmark profile aliases', () => {
    expect(normalizeBenchmarkProfile('swe')).toBe('swe-bench');
    expect(normalizeBenchmarkProfile('swebench')).toBe('swe-bench');
    expect(normalizeBenchmarkProfile('tbench')).toBe('terminal-bench');
    expect(normalizeBenchmarkProfile('terminalworld')).toBe('terminalworld');
    expect(normalizeBenchmarkProfile('terminal-world')).toBe('terminalworld');
    expect(normalizeBenchmarkProfile('tw')).toBe('terminalworld');
    expect(normalizeBenchmarkProfile('contextbench')).toBe('swe-context');
    expect(normalizeBenchmarkProfile('swechain')).toBe('swe-chain');
    expect(normalizeBenchmarkProfile('swe-cycle')).toBe('swe-cycle');
    expect(normalizeBenchmarkProfile('full-cycle')).toBe('swe-cycle');
    expect(normalizeBenchmarkProfile('swe-judge')).toBe('swe-cycle');
    expect(normalizeBenchmarkProfile('ci-repair-bench')).toBe('ci-repair');
    expect(normalizeBenchmarkProfile('swe-ci')).toBe('swe-ci');
    expect(normalizeBenchmarkProfile('swecibench')).toBe('swe-ci');
    expect(normalizeBenchmarkProfile('swe-ci-bench')).toBe('swe-ci');
    expect(normalizeBenchmarkProfile('swe-prbench')).toBe('swe-prbench');
    expect(normalizeBenchmarkProfile('prbench')).toBe('swe-prbench');
    expect(normalizeBenchmarkProfile('pull-request-review')).toBe('swe-prbench');
    expect(normalizeBenchmarkProfile('tml-bench')).toBe('tml-bench');
    expect(normalizeBenchmarkProfile('kaggle-ml')).toBe('tml-bench');
    expect(normalizeBenchmarkProfile('tabular-ml')).toBe('tml-bench');
    expect(normalizeBenchmarkProfile('pi-bench')).toBe('pi-bench');
    expect(normalizeBenchmarkProfile('proactive-assistant')).toBe('pi-bench');
    expect(normalizeBenchmarkProfile('hidden-intent')).toBe('pi-bench');
    expect(normalizeBenchmarkProfile('wildclawbench')).toBe('wildclaw');
    expect(normalizeBenchmarkProfile('arc-prize')).toBe('arc-agi');
    expect(normalizeBenchmarkProfile('spec-bench')).toBe('specbench');
    expect(normalizeBenchmarkProfile('rhb')).toBe('reward-hacking');
    expect(normalizeBenchmarkProfile('roadmap-bench')).toBe('roadmapbench');
    expect(normalizeBenchmarkProfile('saas-bench')).toBe('saasbench');
    expect(normalizeBenchmarkProfile('swebenchmobile')).toBe('swe-bench-mobile');
    expect(normalizeBenchmarkProfile('swe-webdev-bench')).toBe('webdevbench');
    expect(normalizeBenchmarkProfile('vibe-coding')).toBe('webdevbench');
    expect(normalizeBenchmarkProfile('app-world')).toBe('appworld');
    expect(normalizeBenchmarkProfile('browsecomp-plus')).toBe('browsecomp');
    expect(normalizeBenchmarkProfile('tau-bench')).toBe('tau2');
    expect(normalizeBenchmarkProfile('tau2-airline')).toBe('tau2');
    expect(normalizeBenchmarkProfile('unknown')).toBe('auto');
  });

  it('splits optional benchmark profile from task text', () => {
    expect(splitBenchmarkArgs('swe-bench fix django issue')).toEqual({
      profile: 'swe-bench',
      task: 'fix django issue',
    });
    expect(splitBenchmarkArgs('terminal-bench train a model')).toEqual({
      profile: 'terminal-bench',
      task: 'train a model',
    });
    expect(splitBenchmarkArgs('terminalworld create /app/result.txt')).toEqual({
      profile: 'terminalworld',
      task: 'create /app/result.txt',
    });
    expect(splitBenchmarkArgs('swe-chain upgrade package graph')).toEqual({
      profile: 'swe-chain',
      task: 'upgrade package graph',
    });
    expect(splitBenchmarkArgs('swe-cycle solve full lifecycle issue')).toEqual({
      profile: 'swe-cycle',
      task: 'solve full lifecycle issue',
    });
    expect(splitBenchmarkArgs('ci-repair fix failing github actions')).toEqual({
      profile: 'ci-repair',
      task: 'fix failing github actions',
    });
    expect(splitBenchmarkArgs('swe-ci maintain ci loop')).toEqual({
      profile: 'swe-ci',
      task: 'maintain ci loop',
    });
    expect(splitBenchmarkArgs('swe-prbench review pull request feedback')).toEqual({
      profile: 'swe-prbench',
      task: 'review pull request feedback',
    });
    expect(splitBenchmarkArgs('tml-bench build valid sample_submission baseline')).toEqual({
      profile: 'tml-bench',
      task: 'build valid sample_submission baseline',
    });
    expect(splitBenchmarkArgs('pi-bench resolve latent user intent')).toEqual({
      profile: 'pi-bench',
      task: 'resolve latent user intent',
    });
    expect(splitBenchmarkArgs('wildclaw solve BrowseComp task')).toEqual({
      profile: 'wildclaw',
      task: 'solve BrowseComp task',
    });
    expect(splitBenchmarkArgs('arc-agi solve grid abstraction')).toEqual({
      profile: 'arc-agi',
      task: 'solve grid abstraction',
    });
    expect(splitBenchmarkArgs('specbench satisfy full spec')).toEqual({
      profile: 'specbench',
      task: 'satisfy full spec',
    });
    expect(splitBenchmarkArgs('reward-hacking solve without evaluator shortcuts')).toEqual({
      profile: 'reward-hacking',
      task: 'solve without evaluator shortcuts',
    });
    expect(splitBenchmarkArgs('roadmapbench implement version upgrade')).toEqual({
      profile: 'roadmapbench',
      task: 'implement version upgrade',
    });
    expect(splitBenchmarkArgs('saasbench add billing workflow')).toEqual({
      profile: 'saasbench',
      task: 'add billing workflow',
    });
    expect(splitBenchmarkArgs('swe-bench-mobile implement iOS feature')).toEqual({
      profile: 'swe-bench-mobile',
      task: 'implement iOS feature',
    });
    expect(splitBenchmarkArgs('webdevbench build production app workflow')).toEqual({
      profile: 'webdevbench',
      task: 'build production app workflow',
    });
    expect(splitBenchmarkArgs('appworld update calendar records')).toEqual({
      profile: 'appworld',
      task: 'update calendar records',
    });
    expect(splitBenchmarkArgs('browsecomp answer source-grounded question')).toEqual({
      profile: 'browsecomp',
      task: 'answer source-grounded question',
    });
    expect(splitBenchmarkArgs('tau2 resolve customer policy request')).toEqual({
      profile: 'tau2',
      task: 'resolve customer policy request',
    });
    expect(splitBenchmarkArgs('fix parser bug')).toEqual({
      profile: 'auto',
      task: 'fix parser bug',
    });
  });

  it('builds SWE-bench prompts around patches, tests, and anti-leakage', () => {
    const prompt = buildBenchmarkPrompt('fix failing pandas issue', 'C:/repo', 'swe-bench');
    expect(prompt).toContain('Working directory: C:/repo');
    expect(prompt).toContain('SWE-bench / SWE-rebench');
    expect(prompt).toContain('source patch');
    expect(prompt).toContain('fail-to-pass tests');
    expect(prompt).toContain('Do not inspect gold patches');
    expect(prompt).toContain('benchmark_context');
    expect(prompt).toContain('Automatic Preflight Snapshot');
    expect(prompt).toContain('Source-Grounded Method Stack');
    expect(prompt).toContain('localization dossier');
    expect(prompt).toContain('research_sources');
    expect(prompt).toContain('github_kind:"all"');
    expect(prompt).toContain('kind:"all"');
    expect(prompt).toContain('kaggle_kind:"both"');
    expect(prompt).toContain('recent_days:90');
    expect(prompt).toContain('format:"json"');
    expect(prompt).toContain('structured source digest');
    expect(prompt).toContain('benchmark_repo_catalog');
    expect(prompt).toContain('github_repo_digest');
    expect(prompt).toContain('replay=');
    expect(prompt).toContain('Verify under benchmark pressure');
  });

  it('builds Terminal-Bench prompts around verifier-driven terminal work', () => {
    const prompt = buildBenchmarkPrompt('complete the sandbox task', '/workspace', 'terminal-bench');
    expect(prompt).toContain('Terminal-Bench style terminal task');
    expect(prompt).toContain('task verifier passing');
    expect(prompt).toContain('oracle/reference solution');
    expect(prompt).toContain('test script');
  });

  it('builds TerminalWorld prompts around artifact-oriented terminal workflows', () => {
    const prompt = buildBenchmarkPrompt('complete tw_100135 and write /app/result.txt', '/workspace', 'terminalworld');
    expect(prompt).toContain('TerminalWorld style in-the-wild terminal workflow');
    expect(prompt).toContain('outcome-oriented instruction');
    expect(prompt).toContain('solve.sh');
    expect(prompt).toContain('persistent artifacts');
    expect(prompt).toContain('/app');
  });

  it('builds context prompts that use memory as verified hypotheses', () => {
    const prompt = buildBenchmarkPrompt('reuse prior fix pattern', '/workspace', 'swe-context');
    expect(prompt).toContain('SWE-ContextBench');
    expect(prompt).toContain('Search project/global memory');
    expect(prompt).toContain('hypothesis');
    expect(prompt).toContain('bounded replay checkpoints');
    expect(prompt).toContain('validating it against current files');
  });

  it('builds SWE-Chain prompts around dependency upgrade continuity', () => {
    const prompt = buildBenchmarkPrompt('upgrade chained package versions', '/workspace', 'swe-chain');
    expect(prompt).toContain('SWE-Chain style chained package upgrade');
    expect(prompt).toContain('package manager and lockfile');
    expect(prompt).toContain('release-note breaking changes');
    expect(prompt).toContain('subsequent chain steps');
  });

  it('builds SWE-Cycle prompts around full issue-resolution lifecycle', () => {
    const prompt = buildBenchmarkPrompt('solve FullCycle bare repository issue', '/workspace', 'swe-cycle');
    expect(prompt).toContain('SWE-Cycle / SWE-Judge full issue-resolution lifecycle');
    expect(prompt).toContain('environment reconstruction');
    expect(prompt).toContain('verification-test generation');
    expect(prompt).toContain('run_script');
    expect(prompt).toContain('static+dynamic verifier');
  });

  it('builds CI-Repair prompts around workflow reconstruction', () => {
    const prompt = buildBenchmarkPrompt('repair the failing CI workflow', '/workspace', 'ci-repair');
    expect(prompt).toContain('CI-Repair style repository workflow validation');
    expect(prompt).toContain('Reconstruct CI locally');
    expect(prompt).toContain('services, containers, matrix language versions');
    expect(prompt).toContain('missing-secret cases');
  });

  it('builds SWE-CI prompts around continuous maintenance loops', () => {
    const prompt = buildBenchmarkPrompt('maintain evolving CI loop', '/workspace', 'swe-ci');
    expect(prompt).toContain('SWE-CI style CI-loop codebase maintenance');
    expect(prompt).toContain('run_tests');
    expect(prompt).toContain('define_requirements');
    expect(prompt).toContain('modify_code');
    expect(prompt).toContain('current/target commit');
  });

  it('builds SWE-PRBench prompts around diff-first review quality', () => {
    const prompt = buildBenchmarkPrompt('review pull request for missed human feedback', '/workspace', 'swe-prbench');
    expect(prompt).toContain('SWE-PRBench / pull request review quality task');
    expect(prompt).toContain('code review, not patch generation');
    expect(prompt).toContain('diff-first');
    expect(prompt).toContain('Type1_Direct');
    expect(prompt).toContain('Type2_Contextual');
    expect(prompt).toContain('severity-rated review findings');
    expect(prompt).toContain('hidden human feedback');
    expect(prompt).toContain('Do not inspect gold patches');
  });

  it('builds TML-Bench prompts around valid Kaggle tabular submissions', () => {
    const prompt = buildBenchmarkPrompt('train a tabular ML baseline and write sample_submission.csv', '/workspace', 'tml-bench');
    expect(prompt).toContain('TML-Bench / Kaggle-style tabular ML task');
    expect(prompt).toContain('sample_submission schema');
    expect(prompt).toContain('data contract');
    expect(prompt).toContain('honest validation split');
    expect(prompt).toContain('hidden labels');
    expect(prompt).toContain('private holdout');
    expect(prompt).toContain('exact columns/order');
    expect(prompt).toContain('valid baseline');
  });

  it('builds Pi-Bench prompts around proactive personal assistant context', () => {
    const prompt = buildBenchmarkPrompt('infer hidden intent from user profile and app context', '/workspace', 'pi-bench');
    expect(prompt).toContain('Pi-Bench / proactive personal assistant task');
    expect(prompt).toContain('context contract');
    expect(prompt).toContain('proactivity ledger');
    expect(prompt).toContain('hidden/latent intents');
    expect(prompt).toContain('clarifying question');
    expect(prompt).toContain('Do not inspect hidden intents');
  });

  it('builds WildClawBench prompts around native-runtime agent contracts', () => {
    const prompt = buildBenchmarkPrompt('solve BrowseComp and safety alignment task', '/workspace', 'wildclaw');
    expect(prompt).toContain('WildClawBench style native-runtime agent task');
    expect(prompt).toContain('sub-benchmark');
    expect(prompt).toContain('action schema');
    expect(prompt).toContain('browser/search/email/calendar/API');
    expect(prompt).toContain('hidden grading scripts');
  });

  it('builds ARC-AGI prompts around interactive exploration and no leakage', () => {
    const prompt = buildBenchmarkPrompt('solve the Kaggle ARC environment', '/workspace', 'arc-agi');
    expect(prompt).toContain('ARC-AGI-3 / ARC Prize');
    expect(prompt).toContain('interactive environment');
    expect(prompt).toContain('train/public versus hidden evaluation boundary');
    expect(prompt).toContain('output artifact');
    expect(prompt).toContain('Do not hardcode hidden answers');
  });

  it('builds SpecBench prompts around visible tests and held-out behavior', () => {
    const prompt = buildBenchmarkPrompt('pass visible tests without reward hacking', '/workspace', 'specbench');
    expect(prompt).toContain('SpecBench style long-horizon specification-compliance task');
    expect(prompt).toContain('visible tests as necessary but not sufficient');
    expect(prompt).toContain('natural-language specification');
    expect(prompt).toContain('hardcoded sample inputs');
    expect(prompt).toContain('specification checklist items remain incomplete');
  });

  it('builds reward-hacking prompts around evaluation integrity', () => {
    const prompt = buildBenchmarkPrompt('avoid evaluator shortcuts', '/workspace', 'reward-hacking');
    expect(prompt).toContain('Reward Hacking Benchmark / evaluation-integrity task');
    expect(prompt).toContain('tool-use integrity benchmark');
    expect(prompt).toContain('tamper with evaluators');
    expect(prompt).toContain('score/result files');
    expect(prompt).toContain('train/test or public/private boundaries');
  });

  it('builds long-horizon benchmark prompts around roadmap coverage', () => {
    const roadmap = buildBenchmarkPrompt('implement target version roadmap', '/workspace', 'roadmapbench');
    expect(roadmap).toContain('RoadmapBench style long-horizon version-upgrade task');
    expect(roadmap).toContain('multi-target roadmap');
    expect(roadmap).toContain('milestone checklist');
    expect(roadmap).toContain('broad integration/build/test');

    const saas = buildBenchmarkPrompt('build enterprise SaaS workflow', '/workspace', 'saasbench');
    expect(saas).toContain('SaaSBench style long-horizon enterprise SaaS engineering task');
    expect(saas).toContain('multi-component SaaS work');
    expect(saas).toContain('migrations');
    expect(saas).toContain('integration/e2e/API/migration verifier');

    const mobile = buildBenchmarkPrompt('implement iOS feature from PRD', '/workspace', 'swe-bench-mobile');
    expect(mobile).toContain('SWE-Bench Mobile style industrial mobile development task');
    expect(mobile).toContain('PRDs, screenshots/Figma references');
    expect(mobile).toContain('defensive programming');
    expect(mobile).toContain('xcodebuild');

    const webdev = buildBenchmarkPrompt('build full-stack web app with canary requirements', '/workspace', 'webdevbench');
    expect(webdev).toContain('SWE-WebDevBench style full-stack app-agency task');
    expect(webdev).toContain('canary-requirement checklist');
    expect(webdev).toContain('frontend and backend together');
    expect(webdev).toContain('production-readiness or security/infrastructure check');

    const sweci = buildBenchmarkPrompt('maintain codebase across target commits', '/workspace', 'swe-ci');
    expect(sweci).toContain('SWE-CI style CI-loop codebase maintenance');
    expect(sweci).toContain('test gaps');
    expect(sweci).toContain('pass counts improved');
  });

  it('builds Open Agent general-task prompts around actions, sources, and policy', () => {
    const appworld = buildBenchmarkPrompt('complete the AppWorld calendar workflow', '/workspace', 'appworld');
    expect(appworld).toContain('AppWorld style stateful app-environment task');
    expect(appworld).toContain('action/state ledger');
    expect(appworld).toContain('persistent state');

    const browsecomp = buildBenchmarkPrompt('answer the BrowseComp+ research question', '/workspace', 'browsecomp');
    expect(browsecomp).toContain('BrowseComp+ style difficult web-research task');
    expect(browsecomp).toContain('source-grounded research');
    expect(browsecomp).toContain('cross-check claims');

    const tau2 = buildBenchmarkPrompt('handle a tau2 airline customer request', '/workspace', 'tau2');
    expect(tau2).toContain('tau2 / Tau-Bench style policy-bound customer workflow');
    expect(tau2).toContain('domain policy');
    expect(tau2).toContain('available action schemas');
  });
});
