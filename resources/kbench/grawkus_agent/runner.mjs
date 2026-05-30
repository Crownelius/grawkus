#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const startedAt = Date.now();

function emit(output) {
  process.stdout.write(JSON.stringify(output));
}

function fail(status, message, extra = {}) {
  emit({
    ok: false,
    status,
    failureKind: status,
    finalText: message,
    elapsedMs: Date.now() - startedAt,
    artifacts: [],
    error: { message },
    ...extra,
  });
}

function readInput() {
  const inputPath = process.env.KBENCH_ADAPTER_INPUT;
  const raw = inputPath ? readFileSync(inputPath, 'utf8') : readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

function redact(text) {
  return String(text || '')
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, 'sk-or-v1-[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-[REDACTED]')
    .replace(/hf_[A-Za-z0-9]{16,}/g, 'hf_[REDACTED]')
    .replace(/KGAT_[A-Za-z0-9]{16,}/g, 'KGAT_[REDACTED]')
    .replace(/npm_[A-Za-z0-9]{16,}/g, 'npm_[REDACTED]');
}

function truncate(text, max) {
  const safe = redact(text);
  if (safe.length <= max) return safe;
  return `${safe.slice(0, max - 80)}\n...[truncated ${safe.length - (max - 80)} chars]`;
}

function splitCommand(command) {
  const parts = [];
  let cur = '';
  let quote = null;
  let escaped = false;
  for (const ch of command.trim()) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        parts.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function profileForBenchmark(benchmark) {
  const slug = String(benchmark || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (slug === 'swe' || slug === 'swebench') return 'swe-bench';
  if (slug === 'tb2' || slug === 'terminalbench') return 'terminal-bench';
  if (slug === 'terminalworld' || slug === 'terminalworldbench' || slug === 'tw' || slug === 'tworld') return 'terminalworld';
  if (slug === 'swechain' || slug === 'chain' || slug === 'upgrade') return 'swe-chain';
  if (slug === 'swecycle' || slug === 'swecyclebench' || slug === 'fullcycle' || slug === 'swejudge') return 'swe-cycle';
  if (slug === 'sweci' || slug === 'swecibench') return 'swe-ci';
  if (slug === 'swepr' || slug === 'sweprbench' || slug === 'prbench' || slug === 'prreview' || slug === 'pullrequestreview' || slug === 'codereviewbench') return 'swe-prbench';
  if (slug === 'tml' || slug === 'tmlbench' || slug === 'tabularml' || slug === 'kaggleml' || slug === 'kagglebench' || slug === 'datascience') return 'tml-bench';
  if (slug === 'pi' || slug === 'pibench' || slug === 'proactive' || slug === 'proactiveassistant' || slug === 'personalassistant' || slug === 'hiddenintent') return 'pi-bench';
  if (slug === 'cirepair' || slug === 'cirepairbench' || slug === 'ci') return 'ci-repair';
  if (slug === 'wildclaw' || slug === 'wildclawbench' || slug === 'wcbench') return 'wildclaw';
  if (slug === 'arc' || slug === 'arcagi' || slug === 'arcagi3' || slug === 'arcprize') return 'arc-agi';
  if (slug === 'spec' || slug === 'specbench' || slug === 'speccompliance') return 'specbench';
  if (slug === 'rhb' || slug === 'rewardhack' || slug === 'rewardhacking' || slug === 'rewardhackingagents') return 'reward-hacking';
  if (slug === 'roadmap' || slug === 'roadmapbench' || slug === 'longhorizon' || slug === 'versionupgrade') return 'roadmapbench';
  if (slug === 'saas' || slug === 'saasbench' || slug === 'enterprise') return 'saasbench';
  if (slug === 'mobile' || slug === 'swebenchmobile' || slug === 'swemobile' || slug === 'ios') return 'swe-bench-mobile';
  if (slug === 'webdev' || slug === 'webdevbench' || slug === 'swewebdev' || slug === 'swewebdevbench' || slug === 'vibecoding') return 'webdevbench';
  if (slug === 'app' || slug === 'appworld' || slug === 'appworldbench') return 'appworld';
  if (slug === 'browsecomp' || slug === 'browsecompplus' || slug === 'deepresearch' || slug === 'webresearch') return 'browsecomp';
  if (slug === 'tau' || slug === 'tau2' || slug === 'taubench' || slug === 'taubench2' || slug.startsWith('tau2') || slug.startsWith('taubench')) return 'tau2';
  return 'generic';
}

function collectTraceRefs(traceDir) {
  const refs = [];
  if (!traceDir || !existsSync(traceDir)) return refs;
  const stack = [traceDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === 'summary.json' || entry.name === 'trace.jsonl') {
        refs.push({
          kind: entry.name === 'trace.jsonl' ? 'cawdex-tool-trace' : 'cawdex-summary',
          path: full,
          contentType: entry.name.endsWith('.jsonl') ? 'application/jsonl' : 'application/json',
          description: `Cawdex ${entry.name}`,
        });
      }
    }
  }
  return refs;
}

function readLatestTraceSummary(traceDir) {
  if (!traceDir || !existsSync(traceDir)) return null;
  const summaries = [];
  const stack = [traceDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === 'summary.json') {
        try {
          const summary = JSON.parse(readFileSync(full, 'utf8'));
          const endedAtMs = Number.isFinite(Date.parse(summary.endedAt)) ? Date.parse(summary.endedAt) : 0;
          const mtimeMs = statSync(full).mtimeMs;
          summaries.push({ path: full, summary, sortKey: endedAtMs || mtimeMs });
        } catch {
          // Ignore malformed or partially-written trace summaries.
        }
      }
    }
  }
  summaries.sort((a, b) => b.sortKey - a.sortKey);
  return summaries[0] || null;
}

function compactTraceSummary(traceSummary) {
  if (!traceSummary) return undefined;
  const summary = traceSummary.summary || {};
  const quality = summary.trajectoryQuality || {};
  const experienceCard = compactExperienceCard(summary.experienceCard);
  return {
    path: traceSummary.path,
    verificationCount: summary.verificationCount,
    verificationCommands: Array.isArray(summary.verificationCommands) ? summary.verificationCommands.slice(0, 20) : [],
    verificationEvidence: summary.verificationEvidence,
    finalAnswerEvidence: summary.finalAnswerEvidence,
    usage: summary.usage,
    experienceCard,
    agentContextCompilation: compactAgentContextCompilation(summary.agentContextCompilation),
    changeEvaluation: compactChangeEvaluation(summary.changeEvaluation),
    submissionBundleManifest: compactSubmissionBundleManifest(summary.submissionBundleManifest),
    changedFiles: Array.isArray(summary.changedFiles) ? summary.changedFiles.slice(0, 100) : [],
    worktreeChangedFiles: Array.isArray(summary.worktreeChangedFiles) ? summary.worktreeChangedFiles.slice(0, 100) : [],
    artifacts: Array.isArray(summary.artifacts) ? summary.artifacts.slice(0, 20) : [],
    trajectoryQuality: {
      benchmarkContextUsed: quality.benchmarkContextUsed,
      usageCallCount: quality.usageCallCount,
      usageTotalTokens: quality.usageTotalTokens,
      usageEstimatedCostUsd: quality.usageEstimatedCostUsd,
      costEfficiencyRisk: quality.costEfficiencyRisk,
      totalToolElapsedMs: quality.totalToolElapsedMs,
      maxToolElapsedMs: quality.maxToolElapsedMs,
      slowToolCallCount: quality.slowToolCallCount,
      slowToolEvents: Array.isArray(quality.slowToolEvents) ? quality.slowToolEvents.slice(0, 20) : [],
      timeEfficiencyRisk: quality.timeEfficiencyRisk,
      invalidToolActionCount: quality.invalidToolActionCount,
      invalidToolActionPercent: quality.invalidToolActionPercent,
      invalidToolActionEvents: Array.isArray(quality.invalidToolActionEvents) ? quality.invalidToolActionEvents.slice(0, 20) : [],
      localizationBeforeFirstEdit: quality.localizationBeforeFirstEdit,
      failingReproductionBeforeFirstEdit: quality.failingReproductionBeforeFirstEdit,
      passingValidationAfterFirstEdit: quality.passingValidationAfterFirstEdit,
      validationAfterLastEdit: quality.validationAfterLastEdit,
      passingValidationAfterLastEdit: quality.passingValidationAfterLastEdit,
      finalEditVerificationCount: quality.finalEditVerificationCount,
      finalEditPassingVerificationCount: quality.finalEditPassingVerificationCount,
      stableValidationAfterLastEdit: quality.stableValidationAfterLastEdit,
      broadValidationAfterLastEdit: quality.broadValidationAfterLastEdit,
      passingBroadValidationAfterLastEdit: quality.passingBroadValidationAfterLastEdit,
      successfulVerificationCount: quality.successfulVerificationCount,
      failedVerificationCount: quality.failedVerificationCount,
      incompleteVerifierCount: quality.incompleteVerifierCount,
      incompleteVerifierEvents: Array.isArray(quality.incompleteVerifierEvents) ? quality.incompleteVerifierEvents.slice(0, 20) : [],
      inconclusiveVerifierEvents: Array.isArray(quality.inconclusiveVerifierEvents) ? quality.inconclusiveVerifierEvents.slice(0, 20) : [],
      environmentSetupFailureCount: quality.environmentSetupFailureCount,
      environmentSetupFailureEvents: Array.isArray(quality.environmentSetupFailureEvents) ? quality.environmentSetupFailureEvents.slice(0, 20) : [],
      unresolvedEnvironmentSetupFailureCount: quality.unresolvedEnvironmentSetupFailureCount,
      unresolvedEnvironmentSetupFailureEvents: Array.isArray(quality.unresolvedEnvironmentSetupFailureEvents) ? quality.unresolvedEnvironmentSetupFailureEvents.slice(0, 20) : [],
      environmentSetupCount: quality.environmentSetupCount,
      successfulEnvironmentSetupCount: quality.successfulEnvironmentSetupCount,
      environmentSetupEvents: Array.isArray(quality.environmentSetupEvents) ? quality.environmentSetupEvents.slice(0, 20) : [],
      dependencyManifestEditCount: quality.dependencyManifestEditCount,
      dependencyLockfileEditCount: quality.dependencyLockfileEditCount,
      dependencyManifestEditEvents: Array.isArray(quality.dependencyManifestEditEvents) ? quality.dependencyManifestEditEvents.slice(0, 20) : [],
      dependencyLockfileEditEvents: Array.isArray(quality.dependencyLockfileEditEvents) ? quality.dependencyLockfileEditEvents.slice(0, 20) : [],
      dependencySetupAfterManifestEdit: quality.dependencySetupAfterManifestEdit,
      passingDependencySetupAfterManifestEdit: quality.passingDependencySetupAfterManifestEdit,
      dependencyValidationAfterManifestEdit: quality.dependencyValidationAfterManifestEdit,
      passingDependencyValidationAfterManifestEdit: quality.passingDependencyValidationAfterManifestEdit,
      firstDependencySetupAfterManifestEditSeq: quality.firstDependencySetupAfterManifestEditSeq,
      firstDependencyValidationAfterManifestEditSeq: quality.firstDependencyValidationAfterManifestEditSeq,
      skillViewCount: quality.skillViewCount,
      skillViewEvents: Array.isArray(quality.skillViewEvents) ? quality.skillViewEvents.slice(0, 20) : [],
      skillNames: Array.isArray(quality.skillNames) ? quality.skillNames.slice(0, 20) : [],
      skillLoadedBeforeLocalContext: quality.skillLoadedBeforeLocalContext,
      excessiveSkillViewCount: quality.excessiveSkillViewCount,
      ciWorkflowCommandCount: quality.ciWorkflowCommandCount,
      ciVerifierCommands: Array.isArray(quality.ciVerifierCommands) ? quality.ciVerifierCommands.slice(0, 20) : [],
      ciValidationAfterFirstEdit: quality.ciValidationAfterFirstEdit,
      passingCiValidationAfterFirstEdit: quality.passingCiValidationAfterFirstEdit,
      ciValidationAfterLastEdit: quality.ciValidationAfterLastEdit,
      passingCiValidationAfterLastEdit: quality.passingCiValidationAfterLastEdit,
      firstCiValidationAfterFirstEditSeq: quality.firstCiValidationAfterFirstEditSeq,
      sourceResearchCoverage: quality.sourceResearchCoverage,
      taskContractSignalCount: quality.taskContractSignalCount,
      taskContractChecklistUsed: quality.taskContractChecklistUsed,
      taskContractChecklistAfterContext: quality.taskContractChecklistAfterContext,
      taskContractChecklistComplete: quality.taskContractChecklistComplete,
      latestTodoSeq: quality.latestTodoSeq,
      todoIncompleteCount: quality.todoIncompleteCount,
      todoIncompleteItems: Array.isArray(quality.todoIncompleteItems) ? quality.todoIncompleteItems.slice(0, 20) : [],
      taskAlignmentRisk: quality.taskAlignmentRisk,
      taskAlignmentSignalCount: quality.taskAlignmentSignalCount,
      taskAlignmentSignals: Array.isArray(quality.taskAlignmentSignals) ? quality.taskAlignmentSignals.slice(0, 20) : [],
      specComplianceRisk: quality.specComplianceRisk,
      specComplianceSignalCount: quality.specComplianceSignalCount,
      specComplianceSignals: Array.isArray(quality.specComplianceSignals) ? quality.specComplianceSignals.slice(0, 20) : [],
      rewardHackRisk: quality.rewardHackRisk,
      rewardHackSignalCount: quality.rewardHackSignalCount,
      rewardHackSignals: Array.isArray(quality.rewardHackSignals) ? quality.rewardHackSignals.slice(0, 20) : [],
      longHorizonRisk: quality.longHorizonRisk,
      longHorizonSignalCount: quality.longHorizonSignalCount,
      longHorizonSignals: Array.isArray(quality.longHorizonSignals) ? quality.longHorizonSignals.slice(0, 20) : [],
      proactivityDetected: quality.proactivityDetected,
      proactivityRisk: quality.proactivityRisk,
      proactivitySignalCount: quality.proactivitySignalCount,
      proactivitySignals: Array.isArray(quality.proactivitySignals) ? quality.proactivitySignals.slice(0, 20) : [],
      proactivityContextContract: quality.proactivityContextContract,
      proactivityHiddenIntentEvidence: quality.proactivityHiddenIntentEvidence,
      proactivityClarificationEvidence: quality.proactivityClarificationEvidence,
      proactivityPrivacyEvidence: quality.proactivityPrivacyEvidence,
      proactivityCompletionEvidence: quality.proactivityCompletionEvidence,
      proactivityActionCount: quality.proactivityActionCount,
      noEditContractDetected: quality.noEditContractDetected,
      editAfterNoEditContract: quality.editAfterNoEditContract,
      lastEditSeq: quality.lastEditSeq,
      editTargetCount: quality.editTargetCount,
      localizedEditTargetCount: quality.localizedEditTargetCount,
      unlocalizedEditTargetEvents: Array.isArray(quality.unlocalizedEditTargetEvents) ? quality.unlocalizedEditTargetEvents.slice(0, 20) : [],
      contextUtilizationInspectCount: quality.contextUtilizationInspectCount,
      contextUtilizationHitCount: quality.contextUtilizationHitCount,
      contextUtilizationMissCount: quality.contextUtilizationMissCount,
      contextUtilizationPercent: quality.contextUtilizationPercent,
      contextUtilizationRisk: quality.contextUtilizationRisk,
      contextUtilizationMissEvents: Array.isArray(quality.contextUtilizationMissEvents) ? quality.contextUtilizationMissEvents.slice(0, 20) : [],
      preEditContextInspectCount: quality.preEditContextInspectCount,
      preEditContextHitCount: quality.preEditContextHitCount,
      preEditContextMissCount: quality.preEditContextMissCount,
      preEditContextUtilizationPercent: quality.preEditContextUtilizationPercent,
      contextBloatRisk: quality.contextBloatRisk,
      contextBloatEventCount: quality.contextBloatEventCount,
      contextBloatEvents: Array.isArray(quality.contextBloatEvents) ? quality.contextBloatEvents.slice(0, 20) : [],
      evidenceGroundingRisk: quality.evidenceGroundingRisk,
      evidenceGroundingEventCount: quality.evidenceGroundingEventCount,
      evidenceGroundingEvents: Array.isArray(quality.evidenceGroundingEvents) ? quality.evidenceGroundingEvents.slice(0, 20) : [],
      broadEditContractDetected: quality.broadEditContractDetected,
      largeEditSurfaceTargetCount: quality.largeEditSurfaceTargetCount,
      largeEditSurfaceTargets: Array.isArray(quality.largeEditSurfaceTargets) ? quality.largeEditSurfaceTargets.slice(0, 40) : [],
      redundantToolCallCount: quality.redundantToolCallCount,
      redundantToolCallEvents: Array.isArray(quality.redundantToolCallEvents) ? quality.redundantToolCallEvents.slice(0, 20) : [],
      redundantVerifierCount: quality.redundantVerifierCount,
      redundantVerifierEvents: Array.isArray(quality.redundantVerifierEvents) ? quality.redundantVerifierEvents.slice(0, 20) : [],
      blindRepairCount: quality.blindRepairCount,
      blindRepairEvents: Array.isArray(quality.blindRepairEvents) ? quality.blindRepairEvents.slice(0, 20) : [],
      failureAlignedRepairCount: quality.failureAlignedRepairCount,
      failureUnalignedRepairCount: quality.failureUnalignedRepairCount,
      failureUnalignedRepairEvents: Array.isArray(quality.failureUnalignedRepairEvents) ? quality.failureUnalignedRepairEvents.slice(0, 20) : [],
      postEditRegressionCycleCount: quality.postEditRegressionCycleCount,
      postEditRegressionCycleEvents: Array.isArray(quality.postEditRegressionCycleEvents) ? quality.postEditRegressionCycleEvents.slice(0, 20) : [],
      postSuccessMutationCount: quality.postSuccessMutationCount,
      postSuccessMutationEvents: Array.isArray(quality.postSuccessMutationEvents) ? quality.postSuccessMutationEvents.slice(0, 20) : [],
      predictedEditCount: quality.predictedEditCount,
      unpredictedEditCount: quality.unpredictedEditCount,
      contradictedEditPredictionCount: quality.contradictedEditPredictionCount,
      unverifiedEditPredictionCount: quality.unverifiedEditPredictionCount,
      decisionObservabilityRisk: quality.decisionObservabilityRisk,
      scratchArtifactPermissionDetected: quality.scratchArtifactPermissionDetected,
      scratchArtifactEvents: Array.isArray(quality.scratchArtifactEvents) ? quality.scratchArtifactEvents.slice(0, 20) : [],
      postEditDiffReview: quality.postEditDiffReview,
      diffReviewAfterLastEdit: quality.diffReviewAfterLastEdit,
      firstPostEditDiffReviewSeq: quality.firstPostEditDiffReviewSeq,
      firstDiffReviewAfterLastEditSeq: quality.firstDiffReviewAfterLastEditSeq,
      broadValidationAfterFirstEdit: quality.broadValidationAfterFirstEdit,
      passingBroadValidationAfterFirstEdit: quality.passingBroadValidationAfterFirstEdit,
      firstBroadValidationAfterFirstEditSeq: quality.firstBroadValidationAfterFirstEditSeq,
      lastPostEditVerificationSeq: quality.lastPostEditVerificationSeq,
      lastPostEditVerificationStatus: quality.lastPostEditVerificationStatus,
      lastPostEditVerificationConclusiveFailure: quality.lastPostEditVerificationConclusiveFailure,
      firstConclusiveFailedVerificationSeq: quality.firstConclusiveFailedVerificationSeq,
      testEditPermissionDetected: quality.testEditPermissionDetected,
      testHarnessEditEvents: Array.isArray(quality.testHarnessEditEvents) ? quality.testHarnessEditEvents.slice(0, 20) : [],
      processScore: quality.processScore,
      processDefects: Array.isArray(quality.processDefects) ? quality.processDefects.slice(0, 20) : [],
      warnings: Array.isArray(quality.warnings) ? quality.warnings.slice(0, 20) : [],
    },
  };
}

function compactAgentContextCompilation(compilation) {
  if (!compilation || typeof compilation !== 'object' || Array.isArray(compilation)) return undefined;
  const metadata = compilation.metadata && typeof compilation.metadata === 'object' && !Array.isArray(compilation.metadata)
    ? compilation.metadata
    : {};
  return {
    version: compilation.version,
    format: compilation.format,
    task: truncate(compilation.task || '', 2000),
    context: truncate(compilation.context || '', 5000),
    answer: truncate(compilation.answer || '', 2500),
    metadata: {
      sessionId: metadata.sessionId,
      mode: metadata.mode,
      provider: metadata.provider,
      model: metadata.model,
      eventCount: metadata.eventCount,
      contextEventCount: metadata.contextEventCount,
      verificationStatus: metadata.verificationStatus,
      successfulVerificationCount: metadata.successfulVerificationCount,
      processScore: metadata.processScore,
      usageTotalTokens: metadata.usageTotalTokens,
      estimatedCostUsd: metadata.estimatedCostUsd,
      changedFiles: Array.isArray(metadata.changedFiles) ? metadata.changedFiles.slice(0, 100) : [],
      verificationCommands: Array.isArray(metadata.verificationCommands) ? metadata.verificationCommands.slice(0, 20) : [],
      sourceResearchCoverage: metadata.sourceResearchCoverage,
      warnings: Array.isArray(metadata.warnings) ? metadata.warnings.slice(0, 20) : [],
    },
  };
}

function compactChangeEvaluation(changeEvaluation) {
  if (!changeEvaluation || typeof changeEvaluation !== 'object' || Array.isArray(changeEvaluation)) return undefined;
  return {
    version: changeEvaluation.version,
    format: changeEvaluation.format,
    status: changeEvaluation.status,
    accepted: changeEvaluation.accepted,
    reason: truncate(changeEvaluation.reason || '', 500),
    editCount: changeEvaluation.editCount,
    predictedEditCount: changeEvaluation.predictedEditCount,
    unpredictedEditCount: changeEvaluation.unpredictedEditCount,
    confirmedPredictionCount: changeEvaluation.confirmedPredictionCount,
    contradictedPredictionCount: changeEvaluation.contradictedPredictionCount,
    unverifiedPredictionCount: changeEvaluation.unverifiedPredictionCount,
    decisionCoveragePercent: changeEvaluation.decisionCoveragePercent,
    regressionCycleCount: changeEvaluation.regressionCycleCount,
    broadRegressionFailureCount: changeEvaluation.broadRegressionFailureCount,
    predictions: Array.isArray(changeEvaluation.predictions) ? changeEvaluation.predictions.slice(0, 20) : [],
    unpredictedEdits: Array.isArray(changeEvaluation.unpredictedEdits) ? changeEvaluation.unpredictedEdits.slice(0, 20) : [],
    regressionCycles: Array.isArray(changeEvaluation.regressionCycles) ? changeEvaluation.regressionCycles.slice(0, 20) : [],
    recommendedAction: truncate(changeEvaluation.recommendedAction || '', 500),
  };
}

function compactSubmissionBundleManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return undefined;
  return {
    version: manifest.version,
    format: manifest.format,
    submissionReady: manifest.submissionReady,
    reason: truncate(manifest.reason || '', 500),
    officialResultRequired: manifest.officialResultRequired,
    missingOfficialFields: Array.isArray(manifest.missingOfficialFields) ? manifest.missingOfficialFields.slice(0, 20) : [],
    benchmark: manifest.benchmark,
    benchmarkName: manifest.benchmarkName,
    sessionId: manifest.sessionId,
    provider: manifest.provider,
    model: manifest.model,
    summaryContainer: manifest.summaryContainer,
    artifacts: Array.isArray(manifest.artifacts) ? manifest.artifacts.slice(0, 50) : [],
    verification: manifest.verification,
    usage: manifest.usage,
    process: manifest.process,
    leaderboardDraft: manifest.leaderboardDraft,
  };
}

function compactExperienceCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return undefined;
  return {
    version: card.version,
    replayCheckpoints: Array.isArray(card.replayCheckpoints) ? card.replayCheckpoints.slice(0, 20) : [],
    failureSignatures: Array.isArray(card.failureSignatures) ? card.failureSignatures.slice(0, 10) : [],
    sourceResearchCoverage: card.sourceResearchCoverage,
    taskContract: card.taskContract,
    taskAlignment: compactRiskSignalBlock(card.taskAlignment),
    specCompliance: compactRiskSignalBlock(card.specCompliance),
    rewardHack: compactRiskSignalBlock(card.rewardHack),
    longHorizon: compactRiskSignalBlock(card.longHorizon),
    proactivity: compactProactivity(card.proactivity),
    environmentReconstruction: compactEnvironmentReconstruction(card.environmentReconstruction),
    dependencyUpgrade: compactDependencyUpgrade(card.dependencyUpgrade),
    decisionObservability: compactDecisionObservability(card.decisionObservability),
    validationReliability: compactValidationReliability(card.validationReliability),
    contextUtilization: compactContextUtilization(card.contextUtilization),
    runEfficiency: compactRunEfficiency(card.runEfficiency),
    verificationCommands: Array.isArray(card.verificationCommands) ? card.verificationCommands.slice(0, 20) : [],
    changedFiles: Array.isArray(card.changedFiles) ? card.changedFiles.slice(0, 100) : [],
    warnings: Array.isArray(card.warnings) ? card.warnings.slice(0, 20) : [],
  };
}

function compactRiskSignalBlock(block) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return undefined;
  return {
    risk: block.risk,
    signalCount: block.signalCount,
    signals: Array.isArray(block.signals) ? block.signals.slice(0, 20) : [],
  };
}

function compactProactivity(proactivity) {
  if (!proactivity || typeof proactivity !== 'object' || Array.isArray(proactivity)) return undefined;
  return {
    detected: proactivity.detected,
    risk: proactivity.risk,
    signalCount: proactivity.signalCount,
    signals: Array.isArray(proactivity.signals) ? proactivity.signals.slice(0, 20) : [],
    contextContract: proactivity.contextContract,
    hiddenIntentEvidence: proactivity.hiddenIntentEvidence,
    clarificationEvidence: proactivity.clarificationEvidence,
    privacyEvidence: proactivity.privacyEvidence,
    completionEvidence: proactivity.completionEvidence,
    actionCount: proactivity.actionCount,
  };
}

function compactRunEfficiency(runEfficiency) {
  if (!runEfficiency || typeof runEfficiency !== 'object' || Array.isArray(runEfficiency)) return undefined;
  return {
    toolCallCount: runEfficiency.toolCallCount,
    totalToolElapsedMs: runEfficiency.totalToolElapsedMs,
    maxToolElapsedMs: runEfficiency.maxToolElapsedMs,
    slowToolCallCount: runEfficiency.slowToolCallCount,
    usageCallCount: runEfficiency.usageCallCount,
    totalTokens: runEfficiency.totalTokens,
    estimatedCostUsd: runEfficiency.estimatedCostUsd,
    successfulVerificationCount: runEfficiency.successfulVerificationCount,
    processScore: runEfficiency.processScore,
    processDefectCount: runEfficiency.processDefectCount,
    warningCount: runEfficiency.warningCount,
    invalidToolActionCount: runEfficiency.invalidToolActionCount,
    invalidToolActionPercent: runEfficiency.invalidToolActionPercent,
    costEfficiencyRisk: runEfficiency.costEfficiencyRisk,
    timeEfficiencyRisk: runEfficiency.timeEfficiencyRisk,
    slowToolEvents: Array.isArray(runEfficiency.slowToolEvents) ? runEfficiency.slowToolEvents.slice(0, 12) : [],
  };
}

function compactContextUtilization(contextUtilization) {
  if (!contextUtilization || typeof contextUtilization !== 'object' || Array.isArray(contextUtilization)) return undefined;
  return {
    inspectCount: contextUtilization.inspectCount,
    hitCount: contextUtilization.hitCount,
    missCount: contextUtilization.missCount,
    utilizationPercent: contextUtilization.utilizationPercent,
    risk: contextUtilization.risk,
    missEvents: Array.isArray(contextUtilization.missEvents) ? contextUtilization.missEvents.slice(0, 12) : [],
  };
}

function compactValidationReliability(validationReliability) {
  if (!validationReliability || typeof validationReliability !== 'object' || Array.isArray(validationReliability)) return undefined;
  return {
    lastEditSeq: validationReliability.lastEditSeq,
    finalEditVerificationCount: validationReliability.finalEditVerificationCount,
    finalEditPassingVerificationCount: validationReliability.finalEditPassingVerificationCount,
    stableValidationAfterLastEdit: validationReliability.stableValidationAfterLastEdit,
    broadValidationAfterLastEdit: validationReliability.broadValidationAfterLastEdit,
    passingBroadValidationAfterLastEdit: validationReliability.passingBroadValidationAfterLastEdit,
    ciValidationAfterLastEdit: validationReliability.ciValidationAfterLastEdit,
    passingCiValidationAfterLastEdit: validationReliability.passingCiValidationAfterLastEdit,
    postEditRegressionCycleCount: validationReliability.postEditRegressionCycleCount,
    lastPostEditVerificationSeq: validationReliability.lastPostEditVerificationSeq,
    lastPostEditVerificationStatus: validationReliability.lastPostEditVerificationStatus,
    finalVerifierCommands: Array.isArray(validationReliability.finalVerifierCommands) ? validationReliability.finalVerifierCommands.slice(0, 12) : [],
  };
}

function compactDecisionObservability(decisionObservability) {
  if (!decisionObservability || typeof decisionObservability !== 'object' || Array.isArray(decisionObservability)) return undefined;
  return {
    editCount: decisionObservability.editCount,
    predictedEditCount: decisionObservability.predictedEditCount,
    verifiedPredictionCount: decisionObservability.verifiedPredictionCount,
    editPredictions: Array.isArray(decisionObservability.editPredictions) ? decisionObservability.editPredictions.slice(0, 12) : [],
  };
}

function compactEnvironmentReconstruction(environmentReconstruction) {
  if (!environmentReconstruction || typeof environmentReconstruction !== 'object' || Array.isArray(environmentReconstruction)) return undefined;
  return {
    setupFailureCount: environmentReconstruction.setupFailureCount,
    unresolvedSetupFailureCount: environmentReconstruction.unresolvedSetupFailureCount,
    setupCount: environmentReconstruction.setupCount,
    successfulSetupCount: environmentReconstruction.successfulSetupCount,
    setupEvents: Array.isArray(environmentReconstruction.setupEvents) ? environmentReconstruction.setupEvents.slice(0, 12) : [],
    setupFailures: Array.isArray(environmentReconstruction.setupFailures) ? environmentReconstruction.setupFailures.slice(0, 12) : [],
    unresolvedSetupFailures: Array.isArray(environmentReconstruction.unresolvedSetupFailures) ? environmentReconstruction.unresolvedSetupFailures.slice(0, 12) : [],
  };
}

function compactDependencyUpgrade(dependencyUpgrade) {
  if (!dependencyUpgrade || typeof dependencyUpgrade !== 'object' || Array.isArray(dependencyUpgrade)) return undefined;
  return {
    manifestEditCount: dependencyUpgrade.manifestEditCount,
    lockfileEditCount: dependencyUpgrade.lockfileEditCount,
    manifestEdits: Array.isArray(dependencyUpgrade.manifestEdits) ? dependencyUpgrade.manifestEdits.slice(0, 12) : [],
    lockfileEdits: Array.isArray(dependencyUpgrade.lockfileEdits) ? dependencyUpgrade.lockfileEdits.slice(0, 12) : [],
    setupAfterManifestEdit: dependencyUpgrade.setupAfterManifestEdit,
    passingSetupAfterManifestEdit: dependencyUpgrade.passingSetupAfterManifestEdit,
    validationAfterManifestEdit: dependencyUpgrade.validationAfterManifestEdit,
    passingValidationAfterManifestEdit: dependencyUpgrade.passingValidationAfterManifestEdit,
    firstSetupAfterManifestEditSeq: dependencyUpgrade.firstSetupAfterManifestEditSeq,
    firstValidationAfterManifestEditSeq: dependencyUpgrade.firstValidationAfterManifestEditSeq,
  };
}

function collectGitArtifactRefs(workdir, artifactRoot) {
  const refs = [];
  if (!workdir || !existsSync(workdir)) return refs;

  const gitCheck = spawnSync('git', ['-C', workdir, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 64 * 1024,
  });
  if (gitCheck.status !== 0 || !String(gitCheck.stdout || '').trim().startsWith('true')) {
    return refs;
  }

  const diff = buildWorktreePatch(workdir);
  if (diff.trim()) {
    const patchPath = join(artifactRoot, 'cawdex.patch');
    writeFileSync(patchPath, redact(diff), 'utf8');
    refs.push({
      kind: 'patch',
      path: patchPath,
      contentType: 'text/x-diff',
      description: 'Redacted git diff after Cawdex run.',
    });
  }

  const status = spawnSync('git', ['-C', workdir, 'status', '--short'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 512 * 1024,
  });
  if (status.stdout && status.stdout.trim()) {
    const statusPath = join(artifactRoot, 'git-status.txt');
    writeFileSync(statusPath, redact(status.stdout), 'utf8');
    refs.push({
      kind: 'git-status',
      path: statusPath,
      contentType: 'text/plain',
      description: 'Redacted git status after Cawdex run.',
    });
  }

  return refs;
}

function runGit(workdir, args, options = {}) {
  const result = spawnSync('git', ['-C', workdir, ...args], {
    encoding: 'utf8',
    timeout: options.timeout || 5000,
    maxBuffer: options.maxBuffer || 1024 * 1024,
  });
  if (result.error) return '';
  if (result.status !== 0 && !(options.allowDiffExit && result.status === 1)) return '';
  return result.stdout || '';
}

function buildWorktreePatch(workdir) {
  const parts = [
    runGit(workdir, ['diff', '--binary', '--no-ext-diff'], { timeout: 10000, maxBuffer: 20 * 1024 * 1024 }),
    runGit(workdir, ['diff', '--cached', '--binary', '--no-ext-diff'], { timeout: 10000, maxBuffer: 20 * 1024 * 1024 }),
    ...collectUntrackedDiffs(workdir),
  ].map((part) => part.trim()).filter(Boolean);
  return parts.join('\n\n') + (parts.length ? '\n' : '');
}

function collectUntrackedDiffs(workdir) {
  const raw = runGit(workdir, ['ls-files', '--others', '--exclude-standard', '-z']);
  const files = raw.split('\0').map((file) => file.trim()).filter(Boolean).slice(0, 80);
  return files
    .map((file) => runGit(workdir, ['diff', '--no-index', '--binary', '--no-ext-diff', '--', '/dev/null', file], {
      timeout: 5000,
      maxBuffer: 5 * 1024 * 1024,
      allowDiffExit: true,
    }))
    .filter((diff) => diff.trim());
}

let payload;
try {
  payload = readInput();
} catch (err) {
  fail('invalid_adapter', `Could not read adapter input: ${err?.message || err}`);
  process.exit(0);
}

if (payload.mode !== 'task') {
  fail('unsupported_capability', 'Cawdex KBench adapter currently supports task mode only.');
  process.exit(0);
}

const task = payload.task || {};
const config = payload.config || {};
const env = payload.env || task.env || {};
const taskEnv = task.env || {};
const benchmark = task.benchmark || 'swe';
const instruction = String(task.instruction || '').trim();
const profile = profileForBenchmark(benchmark);
const prompt = `/benchmark ${profile} ${instruction}`;
const workdir = config.workDir || env.workdir || env.repoPath || taskEnv.workdir || taskEnv.repoPath || process.cwd();
const artifactRoot = config.storeDir
  || process.env.CAWDEX_KBENCH_ARTIFACT_DIR
  || (() => {
    const dir = join(tmpdir(), `cawdex-kbench-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  })();
mkdirSync(artifactRoot, { recursive: true });

const stdoutPath = join(artifactRoot, 'cawdex.stdout.txt');
const stderrPath = join(artifactRoot, 'cawdex.stderr.txt');
const instructionPath = join(artifactRoot, 'instruction.txt');
const traceDir = join(artifactRoot, 'cawdex-trace');
mkdirSync(dirname(stdoutPath), { recursive: true });
writeFileSync(instructionPath, redact(instruction), 'utf8');

const commandParts = splitCommand(process.env.CAWDEX_KBENCH_COMMAND || process.env.CAWDEX_KBENCH_COMMAND || 'cawdex');
if (!commandParts.length) {
  fail('invalid_adapter', 'CAWDEX_KBENCH_COMMAND resolved to an empty command.');
  process.exit(0);
}

const [command, ...prefixArgs] = commandParts;
const args = [
  ...prefixArgs,
  '--prompt', prompt,
  '--perm', process.env.CAWDEX_KBENCH_PERMISSION || 'yolo',
  '--output-format', 'text',
  '--benchmark-trace-dir', traceDir,
];
if (config.modelName) args.push('--model', String(config.modelName));
if (config.temperature !== undefined) args.push('--temperature', String(config.temperature));
if (config.baseUrl) args.push('--base-url', String(config.baseUrl));
if (config.apiKeyEnv) args.push('--api-key-env', String(config.apiKeyEnv));
if (process.env.CAWDEX_KBENCH_EXTRA_ARGS) {
  args.push(...splitCommand(process.env.CAWDEX_KBENCH_EXTRA_ARGS));
}

const childEnv = {
  ...process.env,
  CAWDEX_BENCHMARK_TRACE: '1',
  CAWDEX_BENCHMARK_TRACE_DIR: traceDir,
  CAWDEX_BASH_TIMEOUT_MS: process.env.CAWDEX_BASH_TIMEOUT_MS || '300000',
};
for (const [key, value] of Object.entries(env.envVars || {})) {
  if (typeof value === 'string') childEnv[key] = value;
}
for (const [key, value] of Object.entries(taskEnv.envVars || {})) {
  if (typeof value === 'string') childEnv[key] = value;
}

const result = spawnSync(command, args, {
  cwd: existsSync(workdir) ? workdir : process.cwd(),
  env: childEnv,
  encoding: 'utf8',
  timeout: typeof config.timeoutMs === 'number' && config.timeoutMs > 0 ? config.timeoutMs : undefined,
  maxBuffer: 20 * 1024 * 1024,
});

const stdout = result.stdout || '';
const stderr = result.stderr || '';
writeFileSync(stdoutPath, redact(stdout), 'utf8');
writeFileSync(stderrPath, redact(stderr), 'utf8');
const elapsedMs = Date.now() - startedAt;
const timedOut = result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM';
const exitCode = typeof result.status === 'number' ? result.status : (timedOut ? 124 : 1);
const ok = exitCode === 0;
const traceRefs = collectTraceRefs(traceDir);
const traceSummary = compactTraceSummary(readLatestTraceSummary(traceDir));
const workdirUsed = existsSync(workdir) ? workdir : process.cwd();
const gitRefs = collectGitArtifactRefs(workdirUsed, artifactRoot);
const stdoutLines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const finalText = stdoutLines.at(-1) || stdout.trim() || (ok ? 'Cawdex completed.' : 'Cawdex produced no stdout.');
const artifacts = [
  { kind: 'instruction', path: instructionPath, contentType: 'text/plain', description: 'KBench task instruction passed to Cawdex.' },
  { kind: 'stdout', path: stdoutPath, contentType: 'text/plain', description: 'Cawdex stdout.' },
  { kind: 'stderr', path: stderrPath, contentType: 'text/plain', description: 'Cawdex stderr.' },
  ...gitRefs,
  ...traceRefs,
];

const output = {
  ok,
  status: ok ? 'ok' : (timedOut ? 'timeout' : 'agent_error'),
  failureKind: ok ? undefined : (timedOut ? 'timeout' : `exit_${exitCode}`),
  finalText: truncate(finalText, 4000),
  elapsedMs,
  artifacts,
  trace: traceRefs.length ? { native: traceRefs } : undefined,
  benchmarkResult: {
    mode: 'cawdex-kbench',
    benchmark,
    profile,
    exitCode,
    workdir: workdirUsed,
    traceSummary,
    verificationEvidence: traceSummary?.verificationEvidence,
    experienceCard: traceSummary?.experienceCard,
    usage: traceSummary?.usage,
  },
  error: ok ? undefined : {
    message: truncate(stderr.trim() || stdout.trim() || result.error?.message || `Cawdex exited with code ${exitCode}`, 2000),
  },
};

emit(output);
