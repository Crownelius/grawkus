import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'grawkus-kbench-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('KBench adapter packaging', () => {
  const adapterDir = join(process.cwd(), 'resources', 'kbench', 'grawkus_agent');
  const manifestPath = join(adapterDir, 'adapter.manifest.json');
  const runnerPath = join(adapterDir, 'runner.mjs');

  it('ships a KBench manifest and runner', () => {
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(runnerPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest).toMatchObject({
      schemaVersion: 'kbench.adapter/v1',
      id: 'grawkus',
      kind: 'node',
      entry: './runner.mjs',
    });
    expect(manifest.supportedBenchmarks).toEqual(['swe', 'tb2', 'sae']);
    expect(manifest.capabilities.runModes).toEqual(['task']);
    expect(manifest.capabilities.machineReadableStdout).toBe(true);
    const runner = readFileSync(runnerPath, 'utf-8');
    expect(runner).toContain('GRAWKUS_BASH_TIMEOUT_MS');
    expect(runner).toContain("'swe-chain'");
    expect(runner).toContain("'swe-cycle'");
    expect(runner).toContain("'swe-ci'");
    expect(runner).toContain("'terminalworld'");
    expect(runner).toContain("'swe-prbench'");
    expect(runner).toContain("'tml-bench'");
    expect(runner).toContain("'pi-bench'");
    expect(runner).toContain('compactProactivity');
    expect(runner).toContain('proactivitySignalCount');
    expect(runner).toContain("'ci-repair'");
    expect(runner).toContain("'wildclaw'");
    expect(runner).toContain("'arc-agi'");
    expect(runner).toContain("'specbench'");
    expect(runner).toContain("'reward-hacking'");
    expect(runner).toContain("'roadmapbench'");
    expect(runner).toContain("'saasbench'");
    expect(runner).toContain("'swe-bench-mobile'");
    expect(runner).toContain("'webdevbench'");
    expect(runner).toContain("'appworld'");
    expect(runner).toContain("'browsecomp'");
    expect(runner).toContain("'tau2'");
  });

  it('prints the packaged KBench adapter directory from the CLI wrapper', () => {
    const out = execFileSync('node', ['bin/grawkus.js', '--print-kbench-adapter'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    }).trim();
    expect(normalize(out)).toBe(normalize(adapterDir));
  });

  it('runs the adapter protocol against a fake grawkus command', () => {
    const dir = tempDir();
    const fakeAgent = join(dir, 'fake-agent.mjs');
    writeFileSync(join(dir, 'fixture.txt'), 'before\n', 'utf-8');
    spawnSync('git', ['init'], { cwd: dir, encoding: 'utf-8' });
    spawnSync('git', ['add', 'fixture.txt'], { cwd: dir, encoding: 'utf-8' });
    spawnSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Test User', 'commit', '-m', 'baseline'], { cwd: dir, encoding: 'utf-8' });
    writeFileSync(fakeAgent, [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'writeFileSync("fixture.txt", "after\\n", "utf-8");',
      'writeFileSync("new-file.txt", "new content\\n", "utf-8");',
      'const traceDir = process.env.GRAWKUS_BENCHMARK_TRACE_DIR;',
      'if (traceDir) {',
      '  const runDir = join(traceDir, "fixture-run");',
      '  mkdirSync(runDir, { recursive: true });',
      '  writeFileSync(join(runDir, "summary.json"), JSON.stringify({',
      '    endedAt: "2026-05-26T10:00:00.000Z",',
      '    verificationCount: 1,',
      '    verificationCommands: ["npm test"],',
      '    verificationEvidence: { lastVerificationSeq: 7, lastVerificationStatus: "ok", extracted: [{ framework: "vitest", passed: 3, total: 3 }] },',
      '    finalAnswerEvidence: { mentionsVerification: true, claimsPassingVerification: true, claimsNoVerificationRun: false, claimsIncomplete: false, claimsBlocked: false, finalAnswerCompletion: "unknown", unsupportedPassingClaim: false, contradictedPassingClaim: false, staleNoVerificationClaim: false, latestVerificationStatus: "ok", lastSuccessfulVerificationSeq: 7, verificationCount: 1, warnings: [] },',
      '    usage: { callCount: 2, promptTokens: 3000, completionTokens: 700, totalTokens: 3700, estimatedCostUsd: 0, byModel: [{ model: "openrouter/free", calls: 2, promptTokens: 3000, completionTokens: 700, totalTokens: 3700, estimatedCostUsd: 0 }] },',
      '    agentContextCompilation: { version: 1, format: "grawkus-agent-context-compilation-v1", task: "Fix the fixture bug", context: "Task: Fix the fixture bug\\nTool observations:\\n- #1 read_file ok: fixture.txt", answer: "All checks passed.\\nLatest verifier status: ok.", metadata: { sessionId: "fixture-run", mode: "benchmark", provider: "OpenRouter", model: "openrouter/free", eventCount: 7, contextEventCount: 3, verificationStatus: "ok", successfulVerificationCount: 1, processScore: 100, usageTotalTokens: 3700, estimatedCostUsd: 0, changedFiles: ["fixture.txt"], verificationCommands: ["npm test"], sourceResearchCoverage: { callCount: 1, sourceHitCount: 4, freshTargetedCoverage: true }, warnings: [] } },',
      '    changeEvaluation: { version: 1, format: "grawkus-change-evaluation-v1", source: "grawkus benchmark trace", createdAt: "2026-05-26T10:00:00.000Z", status: "confirmed", accepted: true, reason: "Every predicted edit was followed by passing verifier evidence and no post-edit regression cycle was detected.", editCount: 1, predictedEditCount: 1, unpredictedEditCount: 0, confirmedPredictionCount: 1, contradictedPredictionCount: 0, unverifiedPredictionCount: 0, decisionCoveragePercent: 100, regressionCycleCount: 0, broadRegressionFailureCount: 0, predictions: [{ editSeq: 5, tool: "edit_file", target: "fixture.txt", prediction: "updating fixture should pass npm test", nextVerifierSeq: 7, nextVerifierStatus: "ok", nextVerifierCommand: "npm test", verdict: "confirmed", evidence: "next verifier #7 passed: npm test" }], unpredictedEdits: [], regressionCycles: [], recommendedAction: "Keep this change as reusable experience." },',
      '    submissionBundleManifest: { version: 1, format: "grawkus-submission-bundle-manifest-v1", source: "grawkus benchmark trace", createdAt: "2026-05-26T10:00:00.000Z", submissionReady: false, reason: "Not submission-ready: official harness score required.", officialResultRequired: true, missingOfficialFields: ["benchmark_score", "successful_sessions", "session_results"], benchmark: "swebench", benchmarkName: "SWE-bench", sessionId: "fixture-run", mode: "benchmark", provider: "OpenRouter", model: "openrouter/free", summaryContainer: { path: "summary.json", contentType: "application/json", hashNote: "summary.json embeds this manifest" }, artifacts: [{ kind: "trace-jsonl", path: "trace.jsonl", contentType: "application/jsonl", description: "trace", role: "raw event trace for replay and audit", requiredForClaim: true, sizeBytes: 12, sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }], verification: { count: 1, latestStatus: "ok", successfulCount: 1, commands: ["npm test"] }, usage: { callCount: 2, totalTokens: 3700, estimatedCostUsd: 0 }, process: { score: 100, warningCount: 0, defectCount: 0, invalidToolActionCount: 1, invalidToolActionPercent: 4.35 }, leaderboardDraft: { submissionReady: false, reason: "official score required", missingOfficialFields: ["benchmark_score"] } },',
      '    experienceCard: { version: 1, replayCheckpoints: [{ seq: 1, tool: "read_file", target: "fixture.txt", reason: "file_context", score: 11 }, { seq: 3, tool: "bash", target: "npm test", reason: "failing_verifier", score: 12 }], failureSignatures: [{ seq: 3, command: "npm test", framework: "vitest", tests: ["fixture regression"], files: ["fixture.txt"], errors: ["AssertionError: expected before to equal after"], raw: "fixture mismatch" }], sourceResearchCoverage: { callCount: 1, sourceHitCount: 4, sourceErrorCount: 0, arxiv: true, github: true, huggingface: true, kaggle: true, freshTargetedCoverage: true, completeTargetedCoverage: true }, taskContract: { signalCount: 2, checklistAfterContext: true, checklistComplete: true, incompleteCount: 0 }, taskAlignment: { risk: false, signalCount: 0, signals: [] }, rewardHack: { risk: false, signalCount: 0, signals: [] }, environmentReconstruction: { setupFailureCount: 1, unresolvedSetupFailureCount: 0, setupCount: 1, successfulSetupCount: 1, setupEvents: [{ seq: 4, command: "npm ci", status: "ok", kind: "node package install" }], setupFailures: [{ seq: 3, command: "npm test", reason: "javascript dependency or build artifact missing", evidence: "Error: Cannot find module vitest" }], unresolvedSetupFailures: [] }, dependencyUpgrade: { manifestEditCount: 1, lockfileEditCount: 1, manifestEdits: [{ seq: 5, tool: "apply_patch", target: "package.json", ecosystem: "node", kind: "manifest" }], lockfileEdits: [{ seq: 5, tool: "apply_patch", target: "package-lock.json", ecosystem: "node", kind: "lockfile" }], setupAfterManifestEdit: true, passingSetupAfterManifestEdit: true, validationAfterManifestEdit: true, passingValidationAfterManifestEdit: true, firstSetupAfterManifestEditSeq: 6, firstValidationAfterManifestEditSeq: 7 }, decisionObservability: { editCount: 1, predictedEditCount: 1, verifiedPredictionCount: 1, editPredictions: [{ editSeq: 5, tool: "edit_file", target: "fixture.txt", prediction: "updating fixture should pass npm test", nextVerifierSeq: 7, nextVerifierStatus: "ok", nextVerifierCommand: "npm test" }] }, validationReliability: { lastEditSeq: 5, finalEditVerificationCount: 2, finalEditPassingVerificationCount: 2, stableValidationAfterLastEdit: true, broadValidationAfterLastEdit: true, passingBroadValidationAfterLastEdit: true, ciValidationAfterLastEdit: true, passingCiValidationAfterLastEdit: true, postEditRegressionCycleCount: 0, lastPostEditVerificationSeq: 7, lastPostEditVerificationStatus: "ok", finalVerifierCommands: ["npm test", "npm run build"] }, contextUtilization: { inspectCount: 6, hitCount: 2, missCount: 4, utilizationPercent: 33.33, risk: true, missEvents: [{ seq: 2, tool: "read_file", target: "src/unrelated-a.ts", reason: "local read/search/list inspection did not match any edited source target" }] }, runEfficiency: { toolCallCount: 9, usageCallCount: 2, totalTokens: 3700, estimatedCostUsd: 0, successfulVerificationCount: 1, processScore: 100, processDefectCount: 0, warningCount: 0, invalidToolActionCount: 1, invalidToolActionPercent: 4.35, costEfficiencyRisk: false }, verificationCommands: ["npm test"], changedFiles: ["fixture.txt", "new-file.txt"], warnings: [] },',
      '    changedFiles: ["fixture.txt"],',
      '    worktreeChangedFiles: ["fixture.txt", "new-file.txt"],',
      '    artifacts: [{ kind: "patch", path: "worktree.patch", contentType: "text/x-diff", description: "patch" }],',
      '    trajectoryQuality: { benchmarkContextUsed: true, usageCallCount: 2, usageTotalTokens: 3700, usageEstimatedCostUsd: 0, costEfficiencyRisk: false, invalidToolActionCount: 1, invalidToolActionPercent: 4.35, invalidToolActionEvents: [{ seq: 4, tool: "web_search_exa", reason: "unknown_tool", evidence: "tool missing" }], localizationBeforeFirstEdit: true, failingReproductionBeforeFirstEdit: true, passingValidationAfterFirstEdit: true, validationAfterLastEdit: true, passingValidationAfterLastEdit: true, finalEditVerificationCount: 2, finalEditPassingVerificationCount: 2, stableValidationAfterLastEdit: true, broadValidationAfterLastEdit: true, passingBroadValidationAfterLastEdit: true, successfulVerificationCount: 1, failedVerificationCount: 0, incompleteVerifierCount: 0, incompleteVerifierEvents: [], inconclusiveVerifierEvents: [], environmentSetupFailureCount: 0, environmentSetupFailureEvents: [], unresolvedEnvironmentSetupFailureCount: 0, unresolvedEnvironmentSetupFailureEvents: [], environmentSetupCount: 0, successfulEnvironmentSetupCount: 0, environmentSetupEvents: [], skillViewCount: 1, skillViewEvents: [{ seq: 2, name: "Python Patterns" }], skillNames: ["Python Patterns"], skillLoadedBeforeLocalContext: false, excessiveSkillViewCount: false, ciWorkflowCommandCount: 1, ciVerifierCommands: ["npm test"], ciValidationAfterFirstEdit: true, passingCiValidationAfterFirstEdit: true, ciValidationAfterLastEdit: true, passingCiValidationAfterLastEdit: true, firstCiValidationAfterFirstEditSeq: 7, sourceResearchCoverage: { callCount: 0 }, taskContractSignalCount: 0, taskContractChecklistUsed: false, taskContractChecklistAfterContext: null, taskContractChecklistComplete: null, latestTodoSeq: null, todoIncompleteCount: 0, todoIncompleteItems: [], taskAlignmentRisk: false, taskAlignmentSignalCount: 0, taskAlignmentSignals: [], rewardHackRisk: false, rewardHackSignalCount: 0, rewardHackSignals: [], noEditContractDetected: false, editAfterNoEditContract: false, lastEditSeq: 5, editTargetCount: 0, localizedEditTargetCount: 0, unlocalizedEditTargetEvents: [], contextUtilizationInspectCount: 6, contextUtilizationHitCount: 2, contextUtilizationMissCount: 4, contextUtilizationPercent: 33.33, contextUtilizationRisk: true, contextUtilizationMissEvents: [{ seq: 2, tool: "read_file", target: "src/unrelated-a.ts", reason: "local read/search/list inspection did not match any edited source target" }], broadEditContractDetected: false, largeEditSurfaceTargetCount: 0, largeEditSurfaceTargets: [], redundantToolCallCount: 0, redundantToolCallEvents: [], redundantVerifierCount: 0, redundantVerifierEvents: [], blindRepairCount: 0, blindRepairEvents: [], failureAlignedRepairCount: 1, failureUnalignedRepairCount: 1, failureUnalignedRepairEvents: [{ failedVerificationSeq: 3, editSeq: 5, command: "npm test", failureFiles: ["src/app.ts"], inspectedTargets: ["src/config.ts"], editTarget: "src/config.ts", reason: "repair inspected only targets that did not match parsed source failure files before editing elsewhere" }], postEditRegressionCycleCount: 1, postEditRegressionCycleEvents: [{ firstPassingSeq: 5, failingSeq: 6, recoveryPassingSeq: 7, failingCommand: "npm test", recoveryCommand: "npm test", broadFailure: true }], scratchArtifactPermissionDetected: false, scratchArtifactEvents: [], postEditDiffReview: null, diffReviewAfterLastEdit: null, firstPostEditDiffReviewSeq: null, firstDiffReviewAfterLastEditSeq: null, broadValidationAfterFirstEdit: null, passingBroadValidationAfterFirstEdit: null, firstBroadValidationAfterFirstEditSeq: null, lastPostEditVerificationSeq: 7, lastPostEditVerificationStatus: "ok", lastPostEditVerificationConclusiveFailure: false, firstConclusiveFailedVerificationSeq: 3, testEditPermissionDetected: false, testHarnessEditEvents: [], processScore: 100, processDefects: [], warnings: [] }',
      '  }), "utf-8");',
      '  writeFileSync(join(runDir, "trace.jsonl"), "", "utf-8");',
      '}',
      'process.stdout.write("fake grawkus complete sk-or-v1-dummysecret\\n");',
      'process.stderr.write("fake diagnostic hf_abcdefghijklmnop\\n");',
    ].join('\n'), 'utf-8');
    const payload = {
      mode: 'task',
      task: {
        benchmark: 'swe',
        instanceId: 'fixture',
        instruction: 'Fix the fixture bug npm_abcdefghijklmnop',
        env: { workdir: dir },
      },
      env: { workdir: dir },
      config: {
        modelName: 'openrouter/free',
        storeDir: dir,
      },
    };

    const result = spawnSync('node', [runnerPath], {
      cwd: process.cwd(),
      input: JSON.stringify(payload),
      encoding: 'utf-8',
      env: {
        ...process.env,
        GRAWKUS_KBENCH_COMMAND: `node ${fakeAgent}`,
      },
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.status).toBe('ok');
    expect(output.finalText).toContain('fake grawkus complete');
    expect(output.benchmarkResult.profile).toBe('swe-bench');
    expect(output.benchmarkResult.verificationEvidence).toMatchObject({
      lastVerificationSeq: 7,
      lastVerificationStatus: 'ok',
    });
    expect(output.benchmarkResult.traceSummary.finalAnswerEvidence).toMatchObject({
      mentionsVerification: true,
      claimsPassingVerification: true,
      claimsIncomplete: false,
      claimsBlocked: false,
      finalAnswerCompletion: 'unknown',
      unsupportedPassingClaim: false,
      contradictedPassingClaim: false,
      latestVerificationStatus: 'ok',
      lastSuccessfulVerificationSeq: 7,
    });
    expect(output.benchmarkResult.usage).toMatchObject({
      callCount: 2,
      promptTokens: 3000,
      completionTokens: 700,
      totalTokens: 3700,
      estimatedCostUsd: 0,
    });
    expect(output.benchmarkResult.traceSummary.verificationCommands).toEqual(['npm test']);
    expect(output.benchmarkResult.traceSummary.usage.byModel).toEqual([
      {
        model: 'openrouter/free',
        calls: 2,
        promptTokens: 3000,
        completionTokens: 700,
        totalTokens: 3700,
        estimatedCostUsd: 0,
      },
    ]);
    expect(output.benchmarkResult.traceSummary.agentContextCompilation).toMatchObject({
      version: 1,
      format: 'grawkus-agent-context-compilation-v1',
      task: 'Fix the fixture bug',
      metadata: {
        model: 'openrouter/free',
        verificationStatus: 'ok',
        usageTotalTokens: 3700,
        changedFiles: ['fixture.txt'],
        verificationCommands: ['npm test'],
      },
    });
    expect(output.benchmarkResult.traceSummary.agentContextCompilation.context).toContain('Tool observations');
    expect(output.benchmarkResult.traceSummary.changeEvaluation).toMatchObject({
      version: 1,
      format: 'grawkus-change-evaluation-v1',
      status: 'confirmed',
      accepted: true,
      editCount: 1,
      predictedEditCount: 1,
      confirmedPredictionCount: 1,
      decisionCoveragePercent: 100,
      predictions: [{
        verdict: 'confirmed',
        evidence: 'next verifier #7 passed: npm test',
      }],
    });
    expect(output.benchmarkResult.traceSummary.submissionBundleManifest).toMatchObject({
      version: 1,
      format: 'grawkus-submission-bundle-manifest-v1',
      submissionReady: false,
      officialResultRequired: true,
      missingOfficialFields: ['benchmark_score', 'successful_sessions', 'session_results'],
      verification: {
        count: 1,
        latestStatus: 'ok',
        successfulCount: 1,
      },
      usage: {
        totalTokens: 3700,
      },
    });
    expect(output.benchmarkResult.traceSummary.submissionBundleManifest.artifacts).toEqual([
      expect.objectContaining({
        kind: 'trace-jsonl',
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        requiredForClaim: true,
      }),
    ]);
    expect(output.benchmarkResult.experienceCard).toMatchObject({
      version: 1,
      replayCheckpoints: [
        { seq: 1, tool: 'read_file', target: 'fixture.txt', reason: 'file_context', score: 11 },
        { seq: 3, tool: 'bash', target: 'npm test', reason: 'failing_verifier', score: 12 },
      ],
      taskContract: {
        signalCount: 2,
        checklistAfterContext: true,
        checklistComplete: true,
        incompleteCount: 0,
      },
      taskAlignment: {
        risk: false,
        signalCount: 0,
        signals: [],
      },
      rewardHack: {
        risk: false,
        signalCount: 0,
        signals: [],
      },
      sourceResearchCoverage: {
        callCount: 1,
        sourceHitCount: 4,
        freshTargetedCoverage: true,
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
      },
      dependencyUpgrade: {
        manifestEditCount: 1,
        lockfileEditCount: 1,
        setupAfterManifestEdit: true,
        passingSetupAfterManifestEdit: true,
        validationAfterManifestEdit: true,
        passingValidationAfterManifestEdit: true,
        firstSetupAfterManifestEditSeq: 6,
        firstValidationAfterManifestEditSeq: 7,
        manifestEdits: [{
          seq: 5,
          tool: 'apply_patch',
          target: 'package.json',
          ecosystem: 'node',
          kind: 'manifest',
        }],
      },
      decisionObservability: {
        editCount: 1,
        predictedEditCount: 1,
        verifiedPredictionCount: 1,
        editPredictions: [{
          editSeq: 5,
          tool: 'edit_file',
          target: 'fixture.txt',
          prediction: 'updating fixture should pass npm test',
          nextVerifierSeq: 7,
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
        ciValidationAfterLastEdit: true,
        passingCiValidationAfterLastEdit: true,
        postEditRegressionCycleCount: 0,
        lastPostEditVerificationSeq: 7,
        lastPostEditVerificationStatus: 'ok',
        finalVerifierCommands: ['npm test', 'npm run build'],
      },
      contextUtilization: {
        inspectCount: 6,
        hitCount: 2,
        missCount: 4,
        utilizationPercent: 33.33,
        risk: true,
        missEvents: [{
          seq: 2,
          tool: 'read_file',
          target: 'src/unrelated-a.ts',
          reason: 'local read/search/list inspection did not match any edited source target',
        }],
      },
      runEfficiency: {
        toolCallCount: 9,
        usageCallCount: 2,
        totalTokens: 3700,
        estimatedCostUsd: 0,
        successfulVerificationCount: 1,
        processScore: 100,
        processDefectCount: 0,
        warningCount: 0,
        invalidToolActionCount: 1,
        invalidToolActionPercent: 4.35,
        costEfficiencyRisk: false,
      },
      verificationCommands: ['npm test'],
      changedFiles: ['fixture.txt', 'new-file.txt'],
    });
    expect(output.benchmarkResult.traceSummary.experienceCard.failureSignatures[0]).toMatchObject({
      command: 'npm test',
      tests: ['fixture regression'],
      files: ['fixture.txt'],
    });
    expect(output.benchmarkResult.traceSummary.trajectoryQuality).toMatchObject({
      benchmarkContextUsed: true,
      usageCallCount: 2,
      usageTotalTokens: 3700,
      usageEstimatedCostUsd: 0,
      costEfficiencyRisk: false,
      invalidToolActionCount: 1,
      invalidToolActionPercent: 4.35,
      invalidToolActionEvents: [{ seq: 4, tool: 'web_search_exa', reason: 'unknown_tool', evidence: 'tool missing' }],
      passingValidationAfterFirstEdit: true,
      validationAfterLastEdit: true,
      passingValidationAfterLastEdit: true,
      finalEditVerificationCount: 2,
      finalEditPassingVerificationCount: 2,
      stableValidationAfterLastEdit: true,
      broadValidationAfterLastEdit: true,
      passingBroadValidationAfterLastEdit: true,
      taskContractSignalCount: 0,
      taskContractChecklistUsed: false,
      taskContractChecklistAfterContext: null,
      taskContractChecklistComplete: null,
      latestTodoSeq: null,
      todoIncompleteCount: 0,
      todoIncompleteItems: [],
      incompleteVerifierCount: 0,
      incompleteVerifierEvents: [],
      inconclusiveVerifierEvents: [],
      environmentSetupFailureCount: 0,
      environmentSetupFailureEvents: [],
      unresolvedEnvironmentSetupFailureCount: 0,
      unresolvedEnvironmentSetupFailureEvents: [],
      environmentSetupCount: 0,
      successfulEnvironmentSetupCount: 0,
      environmentSetupEvents: [],
      skillViewCount: 1,
      skillViewEvents: [{ seq: 2, name: 'Python Patterns' }],
      skillNames: ['Python Patterns'],
      skillLoadedBeforeLocalContext: false,
      excessiveSkillViewCount: false,
      ciWorkflowCommandCount: 1,
      ciVerifierCommands: ['npm test'],
      ciValidationAfterFirstEdit: true,
      passingCiValidationAfterFirstEdit: true,
      ciValidationAfterLastEdit: true,
      passingCiValidationAfterLastEdit: true,
      firstCiValidationAfterFirstEditSeq: 7,
      taskAlignmentRisk: false,
      taskAlignmentSignalCount: 0,
      taskAlignmentSignals: [],
      rewardHackRisk: false,
      rewardHackSignalCount: 0,
      rewardHackSignals: [],
      noEditContractDetected: false,
      editAfterNoEditContract: false,
      lastEditSeq: 5,
      editTargetCount: 0,
      localizedEditTargetCount: 0,
      unlocalizedEditTargetEvents: [],
      contextUtilizationInspectCount: 6,
      contextUtilizationHitCount: 2,
      contextUtilizationMissCount: 4,
      contextUtilizationPercent: 33.33,
      contextUtilizationRisk: true,
      contextUtilizationMissEvents: [{
        seq: 2,
        tool: 'read_file',
        target: 'src/unrelated-a.ts',
        reason: 'local read/search/list inspection did not match any edited source target',
      }],
      broadEditContractDetected: false,
      largeEditSurfaceTargetCount: 0,
      largeEditSurfaceTargets: [],
      redundantToolCallCount: 0,
      redundantToolCallEvents: [],
      redundantVerifierCount: 0,
      redundantVerifierEvents: [],
      blindRepairCount: 0,
      blindRepairEvents: [],
      failureAlignedRepairCount: 1,
      failureUnalignedRepairCount: 1,
      failureUnalignedRepairEvents: [{
        failedVerificationSeq: 3,
        editSeq: 5,
        command: 'npm test',
        failureFiles: ['src/app.ts'],
        inspectedTargets: ['src/config.ts'],
        editTarget: 'src/config.ts',
        reason: 'repair inspected only targets that did not match parsed source failure files before editing elsewhere',
      }],
      postEditRegressionCycleCount: 1,
      postEditRegressionCycleEvents: [{
        firstPassingSeq: 5,
        failingSeq: 6,
        recoveryPassingSeq: 7,
        failingCommand: 'npm test',
        recoveryCommand: 'npm test',
        broadFailure: true,
      }],
      scratchArtifactPermissionDetected: false,
      scratchArtifactEvents: [],
      postEditDiffReview: null,
      diffReviewAfterLastEdit: null,
      firstPostEditDiffReviewSeq: null,
      firstDiffReviewAfterLastEditSeq: null,
      broadValidationAfterFirstEdit: null,
      passingBroadValidationAfterFirstEdit: null,
      firstBroadValidationAfterFirstEditSeq: null,
      lastPostEditVerificationSeq: 7,
      lastPostEditVerificationStatus: 'ok',
      lastPostEditVerificationConclusiveFailure: false,
      firstConclusiveFailedVerificationSeq: 3,
      testEditPermissionDetected: false,
      testHarnessEditEvents: [],
      processScore: 100,
      processDefects: [],
    });
    expect(output.artifacts.some((a: { kind: string }) => a.kind === 'stdout')).toBe(true);
    expect(output.artifacts.some((a: { kind: string }) => a.kind === 'grawkus-summary')).toBe(true);
    expect(output.artifacts.some((a: { kind: string }) => a.kind === 'grawkus-tool-trace')).toBe(true);
    expect(output.artifacts.some((a: { kind: string }) => a.kind === 'patch')).toBe(true);
    expect(output.artifacts.some((a: { kind: string }) => a.kind === 'git-status')).toBe(true);
    const instructionArtifact = output.artifacts.find((a: { kind: string }) => a.kind === 'instruction');
    const instructionText = readFileSync(instructionArtifact.path, 'utf-8');
    expect(instructionText).toContain('Fix the fixture bug');
    expect(instructionText).toContain('npm_[REDACTED]');
    expect(instructionText).not.toContain('npm_abcdefghijklmnop');
    const stdoutArtifact = output.artifacts.find((a: { kind: string }) => a.kind === 'stdout');
    const stdoutText = readFileSync(stdoutArtifact.path, 'utf-8');
    expect(stdoutText).toContain('fake grawkus complete');
    expect(stdoutText).toContain('sk-or-v1-[REDACTED]');
    expect(stdoutText).not.toContain('sk-or-v1-dummysecret');
    const stderrArtifact = output.artifacts.find((a: { kind: string }) => a.kind === 'stderr');
    const stderrText = readFileSync(stderrArtifact.path, 'utf-8');
    expect(stderrText).toContain('fake diagnostic');
    expect(stderrText).toContain('hf_[REDACTED]');
    expect(stderrText).not.toContain('hf_abcdefghijklmnop');
    const patchArtifact = output.artifacts.find((a: { kind: string }) => a.kind === 'patch');
    const patchText = readFileSync(patchArtifact.path, 'utf-8');
    expect(patchText).toContain('+after');
    expect(patchText).toContain('new-file.txt');
    expect(patchText).toContain('new content');
  });

  it('returns unsupported_capability JSON for session mode', () => {
    const result = spawnSync('node', [runnerPath], {
      cwd: process.cwd(),
      input: JSON.stringify({ mode: 'session', session: { benchmark: 'tau', instanceId: 'fixture' }, config: {} }),
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.status).toBe('unsupported_capability');
  });
});
