#!/usr/bin/env node
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFileSync as fsReadFileSync, writeFileSync as fsWriteFileSync, unlinkSync as fsUnlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BRAND_LOCKUP, BRAND_NAME } from './brand.js';
import { initDebug, emit as dbgEmit, setDebugLevel, getDebugStatus, tailDebug, type DebugLevel } from './debug.js';
import chalk from 'chalk';
import { loadConfig, saveConfig, configExists, getConfigDir, loadConfigFromEnv, applyRuntimeConfigOverrides } from './config.js';
import { resetClient } from './api.js';
import { explainPermission } from './permissions.js';
import {
  CHATGPT_CODEX_BASE_URL,
  getOpenAICodexAuthStatus,
  runCodexLogin,
} from './openai-oauth.js';
import { formatOpenAICodexSmokeResult, runOpenAICodexSmokeTest } from './openai-smoke.js';
import { isKnownFlakyOpenRouterModel, isTurnCancelKeySequence, runQuery } from './query.js';
import { ALL_TOOLS } from './tools/index.js';
import { buildHarnessComponentsReport } from './tools/harness-components.js';
import { buildContextBrief, buildContextDossier } from './context-brief.js';
import { formatAgentsInstructionsReport } from './agents-md.js';
import { GitHubRepoDigestTool } from './tools/github-repo-digest.js';
import { ResearchSourcesTool } from './tools/research-sources.js';
import {
  decodeBenchmarkReposSentinel,
  encodeBenchmarkReposSentinel,
  formatBenchmarkRepoCatalog,
  formatBenchmarkRepoCatalogUsage,
  parseBenchmarkRepoCatalogCommandArgs,
} from './benchmark-repos.js';
import {
  decodeRepoDigestSentinel,
  encodeRepoDigestSentinel,
  formatRepoDigestCommandUsage,
  parseRepoDigestCommandArgs,
} from './repo-command.js';
import {
  decodeSourcesSentinel,
  encodeSourcesSentinel,
  formatSourceCommandUsage,
  parseSourceCommandArgs,
} from './source-command.js';
import type { GrawkusConfig, Message } from './types.js';
import { PROVIDERS } from './types.js';
// New systems
import { createSession, autoSave, listSessions, loadSession, deleteSession, saveSession, generateSessionId, resolveSessionRef, type Session } from './sessions.js';
import { initHooksDir, runHooks, listHooks, saveHooksConfig, clearQuarantinedHooks } from './hooks.js';
import { printUsageSummary, setBudget } from './cost-tracker.js';
import { printSecurityWarning, scanCommand } from './security.js';
import {
  getCompactionStats,
  OPENROUTER_FREE_ROUTER_SAFE_CONTEXT_WINDOW_TOKENS,
  OPENROUTER_UNKNOWN_FREE_MODEL_CONTEXT_WINDOW_TOKENS,
} from './compaction.js';
import { extractPatterns, printInstinctStatus, pruneExpired, listInstincts, exportInstincts, importInstincts } from './learning.js';
import { MODES, type Mode, listModes, normalizeModeName } from './modes.js';
import {
  printModelOptions,
  switchModel,
  classifyComplexity,
  routeModel,
  parseRouteRole,
  isValidRouteRole,
  type RouteRole,
} from './model-router.js';
import {
  deleteModelAlias,
  formatModelResolution,
  formatTurnOverride,
  listModelAliases,
  normalizeReasoningEffort,
  parseModelOnce,
  resolveModelReference,
  setModelAlias,
  tokenizeModelCommandArgs,
  type ModelTurnOverride,
} from './model-aliases.js';
import { buildCommitPrompt, buildPRPrompt, printDiff, printLog, isGitRepo } from './git-workflow.js';
import {
  buildReviewPrompt, buildTDDPrompt, buildSecurityReviewPrompt, runAudit, printAuditReport,
  buildPlanPrompt, buildE2EPrompt, buildBuildFixPrompt, buildEvalPrompt, buildUpdateDocsPrompt,
  buildBenchmarkPrompt, splitBenchmarkArgs,
} from './evaluation.js';
import { buildDoctorReport, formatDoctorReport, runDoctorCli } from './doctor.js';
import { printRules } from './rules.js';
import { buildOrchestrationPrompt, runParallel, mergeResults, printOrchestrationStatus, type SubAgent } from './orchestration.js';
import { printBanner as printThemedBanner, theme, sym, formatDuration, installScreenReaderDispatch, uninstallScreenReaderDispatch, setPalette, getPaletteId, listPalettes, resolvePaletteId, PALETTES, expandLastThinking, printForgeHeader } from './theme.js';
import { saveExport, type ExportFormat } from './export.js';
// New feature modules
import { buildVerifyPrompt, saveCheckpoint, listCheckpoints, restoreCheckpoint } from './verification.js';
import { detectPackageManager, detectTestRunner, detectBuildTool } from './package-detect.js';
import { buildCoveragePrompt, printCoverageSummary } from './coverage.js';
import { buildRefactorPrompt, buildCleanupPrompt } from './refactor.js';
import { buildDocsUpdatePrompt, detectDocFiles } from './docs-sync.js';
import { listSkills, findSkill, applySkill, printSkillList, evolveInstinctsToSkills } from './skills.js';
import { onSessionStart, onSessionEnd, printMemoryStatus, searchMemory } from './memory.js';
import { incrementCounter, decrementCounter, resetCounter, getCounter } from './counter.js';
import { isOpenRouterFreeModelId, type OpenRouterModel } from './openrouter-models.js';
import {
  createUser,
  listUsers,
  getUser,
  getActiveUser,
  setActiveUser,
  updateUser,
  deleteUser,
  setUserMetadata,
  getUserMetadata,
  printUserList,
  buildUserContext,
} from './users.js';
import { shouldSuggestCompaction } from './strategic-compaction.js';
import { login, logout, getAuthenticatedUser, registerPassword, hasPassword } from './login.js';
// Language-specific agents & review
import {
  buildTSReviewPrompt, buildPyReviewPrompt, buildGoReviewPrompt, buildRustReviewPrompt,
  buildJavaReviewPrompt, buildCppReviewPrompt, buildKotlinReviewPrompt, buildPhpReviewPrompt,
  buildDbReviewPrompt, buildAutoReviewPrompt,
  buildTSBuildFixPrompt, buildGoBuildFixPrompt, buildRustBuildFixPrompt,
  buildJavaBuildFixPrompt, buildCppBuildFixPrompt, buildPyTorchBuildFixPrompt,
} from './agents.js';
// Autonomous loops & DAG orchestration
import {
  buildPRLoopPrompt, buildDAGPrompt, buildMultiPlanPrompt, buildMultiExecutePrompt,
  buildMultiBackendPrompt, buildMultiFrontendPrompt, buildLoopOperatorPrompt,
} from './autonomous-loops.js';
import { handlePromodeSlash, enablePromodeMode, pausePromodeIfLeavingMode } from './promode/slash.js';
import { PROMODE_ACTIVATE_SENTINEL, runPromodeActivationConsent } from './promode/consent.js';
import {
  registerPromodeReplBridge,
  startPromodeFromRepl,
  afterReplTurnPromode,
} from './promode/repl-bridge.js';
import { runHeadlessPromodeCron } from './promode/headless.js';
import { loadPromodeState } from './promode/state.js';
// Search-first research workflow
import { buildSearchFirstPrompt, buildDocsLookupPrompt, buildSourceResearchPrompt } from './search-first.js';
// Codemaps
import { generateCodeMap, saveCodeMap, printCodeMap, printCodemapStatus, buildCodemapContext } from './codemaps.js';
// Skill creation from git patterns
import { buildSkillCreatePrompt, analyzeGitPatterns, printGitPatterns, printGitWorkflowSummary } from './skill-create.js';
// Content engine
import {
  buildArticlePrompt, buildSlidePrompt, buildContentRepurposePrompt,
  buildMarketResearchPrompt, buildInvestorDeckPrompt, buildInvestorOutreachPrompt,
  buildCodeQualityPrompt, buildSkillStocktakePrompt, buildChiefOfStaffPrompt,
} from './content-engine.js';
// Hook controls
import { printHookControlStatus, getHookProfile } from './hook-controls.js';
// PM2 manager
import { buildPM2Prompt, isPM2Available, listPM2Services } from './pm2-manager.js';
// ECC (everything-claude-code) integration
import {
  installEcc, getEccCommandPrompt, loadEccState, eccResourcesAvailable, reseedEccHooks, BUNDLE_VERSION as ECC_BUNDLE_VERSION, listEccCommands,
} from './ecc.js';
// Walkthrough — agent-led tour of Grawkus (/walkthrough, /tour, /guide)
import { buildWalkthroughPrompt } from './walkthrough.js';
// Stitch (Google's AI UI/UX design tool) — /stitch, /stitch-config, /stitch-tools
import { buildStitchPrompt, buildStitchToolsPrompt, saveStitchConfig, printStitchStatus, stitchConfigured } from './stitch.js';
// MemPalace memory subsystem — wings/rooms/drawers/tunnels/KG, both global + project stores
import * as mempalace from './mempalace/index.js';
// Curator — periodic skill consolidation pass (/curate)
import { runCurator } from './curator.js';
// Sandbox — OS-native isolation for bash tool (/sandbox)
import { status as sandboxStatus } from './sandbox.js';
// API key rotation pool (/keys)
import { listStatus as keyPoolStatus, setPool as syncKeyPool } from './key-rotation.js';
// Agentic swarm — fan-out concurrent agents on the same task (/swarm)
import {
  buildSwarmAgentTask,
  buildSwarmHandoffPrompt,
  buildSwarmPlan,
  clampSwarmMaxAgents,
  decodeSwarmSentinel,
  encodeSwarmSentinel,
  formatSwarmResults,
  parseSwarmCommandArgs,
  resolveAgents,
  runSwarm,
  type SwarmPlan,
} from './swarm.js';
// Voice / accessibility — built-in dictation (Whisper) + readout (ElevenLabs)
import {
  printVoiceStatus, isVoiceEnabled, getTtsConfig, getSttConfig, getAccessibilityConfig,
  speakAssistantResponse, speak, dictateOnce, DEFAULT_ASSISTANT_VOICE, DEFAULT_USER_VOICE,
} from './voice.js';
import { isFfmpegAvailable, audioCue, startRecording, probeMic, micProbeMessage, type RecordController } from './audio.js';
import { applyScreenReader, summarize } from './accessibility.js';
import { COMMAND_CATALOG, allSlashCommandNames, completeSlashCommandNames, resolveCommandEntry, suggestCommandEntries } from './command-palette.js';
import { inlineSuggest, resolveInlineSuggestQuestionInput, type InlineSuggestAcceptedCommand, type InlineSuggestResult } from './inline-suggest.js';
import { normalizeTypeaheadDraftForPrompt } from './prompt-buffer.js';
import { maybeInstantAnswer } from './instant-answer.js';
import { maybeCreateInstantArtifact } from './instant-artifact.js';
import { buildAheManifest, parseAheManifestArgs } from './ahe-manifest.js';
import { buildLifespanReport, formatLifespanReport, parseLifespanArgs } from './lifespan.js';
import { buildCommandAuditReport, formatCommandAuditReport, parseCommandAuditArgs } from './command-audit.js';
import { getCurrentVersion, startStartupUpdateCheck } from './updater.js';
import {
  importStatus,
  previewImport,
  rollbackImport,
  runImport,
  scanImportSources,
  type ImportSource,
} from './imports.js';
import {
  activateFooter,
  askWithFooterPrompt,
  buildFooterSnapshot,
  deactivateFooter,
  isFooterActive,
  setFooterActivity,
  shouldUseFixedFooter,
  updateFooter,
  writeFooterSubmittedLine,
  writeScrollableLine,
} from './fixed-footer.js';

/**
 * Unified prompt resolver — prefers the bundled ECC prompt for a given
 * intent and falls back to the built-in builder when ECC isn't installed.
 * Keeps the user-facing surface to ONE command per intent (e.g. /tdd, not
 * /tdd vs /ecc-tdd). When ECC supplies the prompt, the user's args are
 * appended under a "## User Input" section so the model still sees them.
 */
function buildUnifiedPrompt(eccName: string, args: string, builtin: () => string): string {
  const ecc = getEccCommandPrompt(eccName);
  if (!ecc) return builtin();
  return args.trim() ? `${ecc}\n\n## User Input\n\n${args}` : ecc;
}

function printLocalResponse(message: string): void {
  if (!isFooterActive()) {
    console.log(theme.primary(message));
    return;
  }
  for (const line of message.split(/\r?\n/)) {
    writeScrollableLine(line ? theme.primary(line) : '');
  }
}

function openRouterContextHintForModel(model: string, catalogModel?: Pick<OpenRouterModel, 'contextLength'> | null): number | undefined {
  const id = model.trim().toLowerCase();
  if (id === 'openrouter/free') return OPENROUTER_FREE_ROUTER_SAFE_CONTEXT_WINDOW_TOKENS;
  if (catalogModel?.contextLength && catalogModel.contextLength > 0) return Math.floor(catalogModel.contextLength);
  if (isOpenRouterFreeModelId(id)) return OPENROUTER_UNKNOWN_FREE_MODEL_CONTEXT_WINDOW_TOKENS;
  return undefined;
}

function applyModelSelection(
  config: GrawkusConfig,
  model: string,
  catalogModel?: Pick<OpenRouterModel, 'contextLength'> | null,
): void {
  config.model = model;
  if (!/openrouter/i.test(config.provider)) return;

  const contextHint = openRouterContextHintForModel(model, catalogModel);
  if (contextHint) {
    config.contextWindowTokens = contextHint;
  } else {
    delete config.contextWindowTokens;
  }
}

function clipSetupValue(value: string, max = 120): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length <= max ? single : single.slice(0, max - 1) + '…';
}

async function runSwarmSetupWizard(rl: readline.Interface, plan: SwarmPlan, config: GrawkusConfig): Promise<SwarmPlan> {
  if (!stdin.isTTY || process.env.GRAWKUS_SWARM_WIZARD === '0' || config.swarm?.setupWizard === false) return plan;
  const next: SwarmPlan = {
    ...plan,
    setup: { ...plan.setup },
  };
  const ask = async (label: string, current: string): Promise<string> => {
    const prompt = theme.dim(`  ${label}`) + theme.syntaxPunctuation(` [${clipSetupValue(current)}]: `);
    const answer = (await rl.question(prompt)).trim();
    return answer || current;
  };

  console.log(theme.header('  Swarm setup'));
  console.log(theme.dim('  Press Enter to accept an inferred value, or type a correction.'));
  next.setup.goal = await ask('Goal', next.setup.goal);
  next.setup.budget = await ask('Budget/time', next.setup.budget);
  next.setup.target = await ask('Target platform/stack', next.setup.target);
  next.setup.assets = await ask('Starting assets/resources', next.setup.assets);
  next.setup.quality = await ask('Quality bar/release target', next.setup.quality);
  return next;
}

// ── Setup Wizard ──────────────────────────────────────────
function printCommandHelp(query: string): void {
  const resolved = resolveCommandEntry(query);
  const h = theme.header;
  const d = theme.dim;
  const c = theme.command;

  if (!resolved) {
    const suggestions = suggestCommandEntries(query, 5);
    console.log(chalk.yellow(`  Unknown command: ${query.trim() || '(empty)'}`));
    if (suggestions.length > 0) {
      console.log(d('  Did you mean: ') + suggestions.map((entry) => c(entry.command)).join(d(', ')));
    } else {
      console.log(d('  Run /help for the full command reference or type / to search commands.'));
    }
    return;
  }

  const { entry, alias } = resolved;
  console.log(h(`\n  ${entry.command}`));
  if (alias) console.log(d('  Alias: ') + c(alias) + d(` -> ${entry.command}`));
  console.log(d('  Category: ') + entry.category);
  console.log(d('  Usage:    ') + c(entry.usage ?? entry.command));
  if (entry.aliases && entry.aliases.length > 0) {
    console.log(d('  Aliases:  ') + entry.aliases.map((item) => c(item)).join(d(', ')));
  }
  console.log(d('  Summary:  ') + entry.description);
  console.log(d('\n  Tip: type / to search commands, then Enter to place the selected command in the prompt.\n'));
}

function printUnknownSlashCommand(cmd: string): void {
  const suggestions = suggestCommandEntries(cmd, 5);
  const d = theme.dim;
  const c = theme.command;

  console.log(d(`  Unknown command: ${cmd}.`));
  if (suggestions.length === 0) {
    console.log(d('  Type /help for the full command reference or / to search commands.'));
    return;
  }

  console.log(d('  Did you mean: ') + suggestions.map((entry) => c(entry.command)).join(d(', ')));
  console.log(d('  Try: ') + c(`/help ${suggestions[0].command}`) + d(' for exact usage.'));
}

async function promptSecretLine(rl: readline.Interface, prompt: string, existingValue = ''): Promise<string> {
  const suffix = existingValue ? ' [stored; Enter keeps it]' : '';
  const label = `${prompt}${suffix}: `;

  if (!stdin.isTTY || !stdout.isTTY) {
    const answer = await rl.question(chalk.yellow(label));
    return answer.trim() || existingValue;
  }

  return new Promise<string>((resolve) => {
    let value = '';
    const wasRaw = stdin.isRaw;
    const keypressListeners = stdin.listeners('keypress').slice() as TaggedKeypressListener[];
    const detached = keypressListeners.filter((listener) => !listener.__grawkusHotkey__);

    function render(): void {
      const shown = value ? '*'.repeat(Math.min(value.length, 16)) : '';
      stdout.write(`\r\x1b[2K${chalk.yellow(label)}${chalk.dim(shown)}`);
    }

    function cleanup(): void {
      stdin.removeListener('data', onData);
      for (const listener of detached) stdin.on('keypress', listener);
      try { stdin.setRawMode(wasRaw); } catch { /* noop */ }
      stdout.write('\n');
    }

    function done(nextValue: string): void {
      cleanup();
      resolve(nextValue.trim() || existingValue);
    }

    function onData(buf: Buffer): void {
      if (buf.length === 1 && buf[0] === 0x03) {
        cleanup();
        process.exit(130);
      }
      if (buf.length === 1 && buf[0] === 0x1B) {
        done(existingValue);
        return;
      }
      if (buf.length === 1 && (buf[0] === 0x0D || buf[0] === 0x0A)) {
        done(value);
        return;
      }
      if (buf.length === 1 && (buf[0] === 0x7F || buf[0] === 0x08)) {
        value = value.slice(0, -1);
        render();
        return;
      }
      const text = buf.toString('utf8').replace(/[^\x20-\x7E]/g, '');
      if (text) {
        value += text;
        render();
      }
    }

    for (const listener of detached) stdin.removeListener('keypress', listener);
    try { stdin.setRawMode(true); } catch { /* noop */ }
    stdin.resume();
    stdin.on('data', onData);
    render();
  });
}

async function runAppearanceWizard(rl: readline.Interface, config: GrawkusConfig): Promise<void> {
  const themeChoices: ConfigChoice<'full' | 'compact' | 'minimal'>[] = [
    { label: 'full', detail: 'banner and full context on launch', value: 'full' },
    { label: 'compact', detail: 'same banner, tighter future surfaces', value: 'compact' },
    { label: 'minimal', detail: 'small launch header', value: 'minimal' },
  ];
  const currentTheme = config.theme || 'full';
  const themeDefault = Math.max(0, themeChoices.findIndex((choice) => choice.value === currentTheme));
  const selectedTheme = await selectConfigChoice(rl, 'Display theme', themeChoices, {
    defaultIndex: themeDefault,
    fallbackPrompt: `  Display theme [${themeDefault + 1}]: `,
    parseFallback: (answer, defaultIndex) => {
      const raw = (answer || String(defaultIndex + 1)).trim().toLowerCase();
      const byName = themeChoices.find((choice) => choice.value === raw);
      if (byName) return byName.value;
      return themeChoices[Number.parseInt(raw, 10) - 1]?.value;
    },
  });

  const paletteChoices = listPalettes().map((meta) => ({
    label: meta.id,
    detail: meta.description,
    value: meta.id,
  }));
  const currentPalette = getPaletteId();
  const paletteDefault = Math.max(0, paletteChoices.findIndex((choice) => choice.value === currentPalette));
  const selectedPalette = await selectConfigChoice(rl, 'Color palette', paletteChoices, {
    defaultIndex: paletteDefault,
    fallbackPrompt: `  Color palette [${paletteDefault + 1}]: `,
    parseFallback: (answer, defaultIndex) => {
      const raw = (answer || String(defaultIndex + 1)).trim().toLowerCase();
      const resolved = resolvePaletteId(raw);
      if (resolved) return resolved;
      return paletteChoices[Number.parseInt(raw, 10) - 1]?.value;
    },
  });

  config.theme = selectedTheme;
  setPalette(selectedPalette);
  config.palette = selectedPalette;
  saveConfig(config);
  console.log(theme.brandBold(`  ${sym.mark} Appearance: ${selectedTheme} / ${selectedPalette}`));
  console.log(theme.dim('  Brand · ') + theme.brand('brand') + theme.dim(' · ') + theme.success('success') + theme.dim(' · ') + theme.warning('warning') + theme.dim(' · ') + theme.error('error') + theme.dim(' · ') + theme.command('command'));
}

async function setupWizard(rl: readline.Interface, currentConfig?: GrawkusConfig): Promise<GrawkusConfig> {
  console.log(chalk.bold.cyan(`\n  ${BRAND_NAME} — First-time Setup\n`));
  const providerKeys = Object.keys(PROVIDERS);
  const normalizeProvider = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const currentProviderKey = normalizeProvider(currentConfig?.provider ?? '');
  const currentProviderIndex = providerKeys.findIndex((key) => {
    const p = PROVIDERS[key];
    return normalizeProvider(key) === currentProviderKey || normalizeProvider(p.name) === currentProviderKey;
  });
  const defaultProviderIndex = currentProviderIndex >= 0 ? currentProviderIndex : 0;
  const providerKey = await selectConfigChoice(rl, 'Choose a provider', providerKeys.map((key) => {
    const p = PROVIDERS[key];
    return {
      label: p.name,
      detail: p.baseURL || 'you provide',
      value: key,
    };
  }), {
    defaultIndex: defaultProviderIndex,
    fallbackPrompt: `\n  Provider [${defaultProviderIndex + 1}]: `,
  });
  const provider = PROVIDERS[providerKey];

  let baseURL = provider.baseURL;
  if (providerKey === 'custom') {
    const currentBaseURL = currentConfig?.baseURL?.trim();
    baseURL = await rl.question(chalk.yellow(`  Base URL${currentBaseURL ? ` [${currentBaseURL}]` : ''}: `));
    if (!baseURL.trim() && currentBaseURL) baseURL = currentBaseURL;
  }

  let apiKey = '';
  let openaiAuth: GrawkusConfig['openaiAuth'];
  const sameProvider = normalizeProvider(currentConfig?.provider ?? '') === normalizeProvider(provider.name);
  if (provider.requiresKey) {
    apiKey = await promptSecretLine(
      rl,
      `  API Key for ${provider.name}`,
      sameProvider ? currentConfig?.apiKey ?? '' : '',
    );
  }
  if (providerKey === 'openai-codex') {
    openaiAuth = {
      type: 'codex_oauth',
      useCodexAuthFile: true,
      chatgptBaseURL: CHATGPT_CODEX_BASE_URL,
    };
    const status = getOpenAICodexAuthStatus({ openaiAuth } as GrawkusConfig);
    console.log('');
    if (status.available) {
      console.log(chalk.green(`  Codex OAuth: found ${status.source === 'env' ? 'environment token' : status.authPath}`));
      if (status.email) console.log(chalk.dim(`  Account: ${status.email}`));
    } else {
      console.log(chalk.yellow('  Codex OAuth token not found yet.'));
      console.log(chalk.dim(`  After setup, run /openai-login or run "codex login". ${BRAND_NAME} will read ~/.codex/auth.json.`));
    }
  }

  let model = sameProvider && currentConfig?.model ? currentConfig.model : provider.defaultModel;
  const modelInput = await rl.question(chalk.yellow(`  Model [${model}]: `));
  if (modelInput.trim()) model = modelInput.trim();

  // Warn only. The user-selected model is part of their config and must
  // never be silently replaced by a "safer" default.
  if (isKnownFlakyOpenRouterModel({ provider: provider.name, model })) {
    console.log('');
    console.log(chalk.yellow(`  ⚠  "${model}" is known to stall badly in interactive OpenRouter sessions`));
    console.log(chalk.yellow(`     or return empty / "ERROR" responses. Keeping your selected model.`));
    console.log(chalk.dim('     Configure /fallback explicitly if you want an automatic retry after a real failure.'));
    console.log('');
  }
  if (providerKey === 'openrouter' && !isOpenRouterFreeModelId(model)) {
    console.log('');
    console.log(chalk.yellow(`  Note: "${model}" may require OpenRouter credits.`));
    console.log(chalk.dim('  Free-tier-safe default: openrouter/free'));
    console.log(chalk.dim('  Free variants usually end with :free. Switch later with /openrouter-free or /model <id>.'));
    console.log('');
  }

  let fallbackModel: string | undefined;
  if (providerKey === 'openrouter') {
    const currentFallback = sameProvider ? currentConfig?.fallbackModel : undefined;
    const fallbackDefaultIndex = currentFallback === PROVIDERS.openrouter.defaultModel
      ? 1
      : currentFallback
        ? 2
        : 0;
    console.log(chalk.white('  OpenRouter fallback'));
    console.log(chalk.dim('  Fallback retries can hide a bad primary model by silently switching to another model.'));
    console.log(chalk.dim('  Choose explicitly; you can change this later with /fallback.'));
    const fallbackChoice = await selectConfigChoice(rl, 'Fallback behavior', [
      { label: 'Disable fallback', detail: 'show the primary model failure; never switch to free automatically', value: 'off' as const },
      { label: 'Use openrouter/free', detail: 'retry once with the free router on timeout, empty, or cryptic errors', value: 'free' as const },
      { label: 'Custom fallback model', detail: 'enter a specific OpenRouter model id', value: 'custom' as const },
    ], {
      defaultIndex: fallbackDefaultIndex,
      fallbackPrompt: `  Fallback behavior [${fallbackDefaultIndex + 1}]: `,
      parseFallback: (answer, defaultIndex) => {
        const raw = (answer || String(defaultIndex + 1)).trim().toLowerCase();
        if (['off', 'none', 'disable', 'disabled', 'no', 'n', '1'].includes(raw)) return 'off';
        if (['free', 'openrouter/free', 'yes', 'y', '2'].includes(raw)) return 'free';
        if (['custom', 'model', '3'].includes(raw)) return 'custom';
        return undefined;
      },
    });
    if (fallbackChoice === 'free') fallbackModel = PROVIDERS.openrouter.defaultModel;
    if (fallbackChoice === 'custom') {
      const customFallback = currentFallback && currentFallback !== PROVIDERS.openrouter.defaultModel
        ? currentFallback
        : '';
      const answer = await rl.question(chalk.yellow(`  Fallback model${customFallback ? ` [${customFallback}]` : ''}: `));
      fallbackModel = answer.trim() || customFallback || undefined;
    }
    console.log('');
  }

  const permissionChoices: ConfigChoice<'ask' | 'auto' | 'yolo'>[] = [
    { label: 'ask', detail: 'prompt before writes/commands (safest)', value: 'ask' },
    { label: 'auto', detail: 'auto-approve reads, ask for destructive', value: 'auto' },
    { label: 'yolo', detail: 'approve everything (fastest)', value: 'yolo' },
  ];
  const currentPermIndex = permissionChoices.findIndex((choice) => choice.value === (currentConfig?.permissionMode ?? 'ask'));
  const defaultPermIndex = currentPermIndex >= 0 ? currentPermIndex : 0;
  const permMode = await selectConfigChoice(rl, 'Permission mode', permissionChoices, {
    defaultIndex: defaultPermIndex,
    fallbackPrompt: `  Permission mode [${defaultPermIndex + 1}]: `,
    parseFallback: (answer, defaultIndex) => {
      const raw = (answer || String(defaultIndex + 1)).trim().toLowerCase();
      const byName = permissionChoices.find((choice) => choice.value === raw);
      if (byName) return byName.value;
      const byNumber = permissionChoices[Number.parseInt(raw, 10) - 1];
      return byNumber?.value;
    },
  });

  // /config stays focused on the main live controls: model/fallback,
  // permissions, and swarm. Other subsystems keep their own commands.
  console.log(chalk.white('\n  Swarm settings'));
  console.log(chalk.dim('  Defaults for /swarm <task>. Per-task setup still comes from the task text.'));
  const swarmWizardDefaultIndex = currentConfig?.swarm?.setupWizard === false ? 1 : 0;
  const swarmSetupWizard = await selectConfigChoice(rl, 'Swarm setup wizard', [
    { label: 'Enable', detail: 'ask goal/budget/stack/assets/quality before natural /swarm tasks', value: true },
    { label: 'Disable', detail: 'infer setup fields without asking', value: false },
  ], {
    defaultIndex: swarmWizardDefaultIndex,
    fallbackPrompt: `  Swarm setup wizard? [${swarmWizardDefaultIndex === 0 ? 'Y/n' : 'y/N'}]: `,
    parseFallback: (answer, defaultIndex) => {
      const raw = answer.trim().toLowerCase();
      if (!raw) return defaultIndex === 0;
      if (raw.startsWith('n')) return false;
      if (raw.startsWith('y')) return true;
      const byNumber = Number.parseInt(raw, 10);
      if (byNumber === 1) return true;
      if (byNumber === 2) return false;
      return undefined;
    },
  });

  const currentMaxAgents = clampSwarmMaxAgents(currentConfig?.swarm?.maxAgents);
  const maxAgentsAnswer = await rl.question(chalk.yellow(`  Max swarm agents [${currentMaxAgents}]: `));
  const maxAgents = maxAgentsAnswer.trim()
    ? clampSwarmMaxAgents(Number.parseInt(maxAgentsAnswer.trim(), 10))
    : currentMaxAgents;
  const askOptionalSwarmDefault = async (label: string, current?: string): Promise<string | undefined> => {
    const answer = await rl.question(chalk.yellow(`  ${label}${current ? ` [${current}]` : ''}: `));
    return answer.trim() || current || undefined;
  };
  const defaultBudget = await askOptionalSwarmDefault('Default budget/time', currentConfig?.swarm?.defaultBudget);
  const defaultTarget = await askOptionalSwarmDefault('Default target platform/stack', currentConfig?.swarm?.defaultTarget);
  const defaultAssets = await askOptionalSwarmDefault('Default starting assets/resources', currentConfig?.swarm?.defaultAssets);
  const defaultQuality = await askOptionalSwarmDefault('Default quality bar/release target', currentConfig?.swarm?.defaultQuality);

  console.log(chalk.white('\n  Import settings'));
  console.log(chalk.dim('  Defaults for /import and optional startup auto-sync.'));
  const importSourceChoices: ConfigChoice<'auto' | 'claude' | 'codex' | 'mempalace'>[] = [
    { label: 'Auto-detect', detail: 'scan all supported sources and import what is available', value: 'auto' },
    { label: 'Claude', detail: 'prefer ~/.claude/projects exports', value: 'claude' },
    { label: 'Codex', detail: 'prefer ~/.codex/sessions exports', value: 'codex' },
    { label: 'MemPalace', detail: 'prefer ~/.mempalace notes and identity files', value: 'mempalace' },
  ];
  const currentImportSource = currentConfig?.import?.defaultSource ?? 'auto';
  const importSourceDefaultIndex = Math.max(0, importSourceChoices.findIndex((c) => c.value === currentImportSource));
  const defaultImportSource = await selectConfigChoice(rl, 'Import default source', importSourceChoices, {
    defaultIndex: importSourceDefaultIndex,
    fallbackPrompt: `  Import default source [${importSourceDefaultIndex + 1}]: `,
    parseFallback: (answer, defaultIndex) => {
      const raw = (answer || String(defaultIndex + 1)).trim().toLowerCase();
      const byName = importSourceChoices.find((choice) => choice.value === raw);
      if (byName) return byName.value;
      const byNumber = importSourceChoices[Number.parseInt(raw, 10) - 1];
      return byNumber?.value;
    },
  });
  const autoSyncDefaultIndex = currentConfig?.import?.autoSyncOnStartup ? 0 : 1;
  const autoSyncOnStartup = await selectConfigChoice(rl, 'Import auto-sync on startup', [
    { label: 'Enable', detail: 'run /import run <source> --limit N once at startup', value: true },
    { label: 'Disable', detail: 'import only when requested via /import run', value: false },
  ], {
    defaultIndex: autoSyncDefaultIndex,
    fallbackPrompt: `  Import auto-sync? [${autoSyncDefaultIndex === 0 ? 'Y/n' : 'y/N'}]: `,
    parseFallback: (answer, defaultIndex) => {
      const raw = answer.trim().toLowerCase();
      if (!raw) return defaultIndex === 0;
      if (raw.startsWith('n')) return false;
      if (raw.startsWith('y')) return true;
      const byNumber = Number.parseInt(raw, 10);
      if (byNumber === 1) return true;
      if (byNumber === 2) return false;
      return undefined;
    },
  });
  const currentSyncLimit = Math.max(10, Math.min(5000, Number(currentConfig?.import?.syncLimit ?? 200)));
  const syncLimitAnswer = await rl.question(chalk.yellow(`  Import sync limit [${currentSyncLimit}]: `));
  const importSyncLimit = syncLimitAnswer.trim()
    ? Math.max(10, Math.min(5000, Number.parseInt(syncLimitAnswer.trim(), 10) || currentSyncLimit))
    : currentSyncLimit;

  const config: GrawkusConfig = {
    ...(currentConfig ?? {}),
    apiKey,
    baseURL,
    model,
    provider: provider.name,
    maxTokens: currentConfig?.maxTokens ?? 8192,
    temperature: currentConfig?.temperature ?? 0.3,
    permissionMode: permMode,
    swarm: {
      setupWizard: swarmSetupWizard,
      maxAgents,
      ...(defaultBudget ? { defaultBudget } : {}),
      ...(defaultTarget ? { defaultTarget } : {}),
      ...(defaultAssets ? { defaultAssets } : {}),
      ...(defaultQuality ? { defaultQuality } : {}),
    },
    import: {
      defaultSource: defaultImportSource,
      autoSyncOnStartup,
      syncLimit: importSyncLimit,
    },
  };
  if (fallbackModel) config.fallbackModel = fallbackModel;
  else delete config.fallbackModel;
  if (openaiAuth) config.openaiAuth = openaiAuth;
  else delete config.openaiAuth;
  applyModelSelection(config, model);

  saveConfig(config);
  console.log(chalk.green(`\n  Config saved to ${getConfigDir()}/config.json`));
  console.log(chalk.dim(`  Configured: /model, /fallback, /perm, /swarm, and /import defaults. Memory stays under /memory.`));
  console.log();
  return config;
}

/**
 * Pretty-print a resumed session's conversation history to stdout so
 * the user can actually READ what was said before, not just see a
 * "Resumed: 4 messages" line on a blank screen. The model already has
 * the full message array in memory (that's what /resume restores) —
 * this is purely a user-facing replay.
 *
 * Format choices match the live REPL's rendering as closely as
 * possible so resumed scrollback feels continuous with new turns:
 *
 *   user      → "› <content>" (matches the live user-line echo)
 *   assistant → text rendered in theme.primary color, like streaming
 *   tool      → compact one-line card "● <tool> → <output preview>"
 *   system    → skipped (those are auto-injected context, not user-facing)
 *
 * Tool outputs are truncated to 200 chars to keep the replay
 * scannable. Users can re-run the actual tool if they need the full
 * output. Assistant content is printed in full because that's the
 * conversation the user wants to review.
 */
function printResumedHistory(messages: Message[], sessionName: string): void {
  const d = theme.dim;
  const sep = '─'.repeat(60);

  // Count by role first so we can surface gaps. A session with
  // 5 user / 0 assistant is almost certainly an artifact of older
  // autosave bugs (Ctrl+C during streaming, steer-before-text-streamed,
  // etc.) — make it visible to the user instead of silently leaving
  // them confused about why "/resume" only shows their own messages.
  const counts = { user: 0, assistant: 0, tool: 0, system: 0, empty: 0 };
  for (const m of messages) {
    counts[m.role]++;
    if (m.role === 'assistant') {
      const hasText = typeof m.content === 'string' && m.content.trim().length > 0;
      const hasTools = m.tool_calls && m.tool_calls.length > 0;
      if (!hasText && !hasTools) counts.empty++;
    }
  }

  console.log('');
  console.log(d(sep));
  console.log(d(`  Resumed conversation: ${sessionName}`));
  console.log(d(`  ${messages.length} messages  ·  ${counts.user} user · ${counts.assistant} assistant · ${counts.tool} tool` +
    (counts.system > 0 ? ` · ${counts.system} system` : '')));
  // Flag suspicious imbalance — a healthy chain has assistant ≈ user.
  // 0 assistant turns means the model's responses never made it to
  // disk (older bug, fixed in v1.30+). The file is what it is; warn so
  // the user understands they're seeing a partial replay.
  if (counts.user > 0 && counts.assistant === 0) {
    console.log(theme.warning(`  ⚠  No assistant turns in this session — likely lost to an older autosave bug.`));
    console.log(d(`     Newer sessions save reliably; this one's history is partial.`));
  } else if (counts.empty > 0) {
    console.log(d(`  (${counts.empty} empty assistant turn${counts.empty > 1 ? 's' : ''} — likely from interrupted streams)`));
  }
  console.log(d(sep));

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'system') continue;  // injected context, not user-facing
    if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      // Match the live REPL's user echo: "› <text>" in plain white,
      // separated from prior content by a single blank line for
      // scanability.
      console.log('');
      console.log(theme.dim('› ') + chalk.white(m.content));
      continue;
    }
    if (m.role === 'assistant') {
      const text = typeof m.content === 'string' ? m.content : '';
      const hasText = text.trim().length > 0;
      const hasTools = m.tool_calls && m.tool_calls.length > 0;
      if (hasText) {
        console.log('');
        console.log(theme.primary(text));
      }
      // Render tool_calls that came with this assistant message as
      // compact one-liners — full args + outputs would balloon the
      // replay. The full data is on disk in the session JSON if the
      // user needs to inspect it (`cat ~/.grawkus/sessions/<id>.json`).
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          const args = (tc.function.arguments || '').slice(0, 80);
          console.log(d(`  ● ${tc.function.name}(${args}${args.length >= 80 ? '…' : ''})`));
        }
      }
      // Empty assistant message — print a placeholder so the user
      // sees the turn structure instead of silent skip. These come
      // from interrupted streams (Ctrl+G / Esc / Ctrl+C) where no
      // tokens arrived before the abort.
      if (!hasText && !hasTools) {
        console.log('');
        console.log(d('  (empty assistant turn — stream interrupted before any response)'));
      }
      continue;
    }
    if (m.role === 'tool' && typeof m.content === 'string') {
      // The tool result. Truncate aggressively because tool outputs
      // (esp. bash) routinely run thousands of chars and would drown
      // the user's terminal.
      const preview = m.content.length > 200
        ? m.content.slice(0, 200) + d(`…[+${m.content.length - 200}b]`)
        : m.content;
      console.log(d(`    ↳ ${preview.replace(/\n+/g, ' ').slice(0, 200)}`));
      continue;
    }
  }
  console.log('');
  console.log(d(sep));
  console.log('');
}

/**
 * Render the decorative prompt parts (session timer + mode tag)
 * via direct stdout writes, then call rl.question with ONLY the
 * raw glyph + a trailing space.
 *
 * Why: readline counts every byte of its prompt argument toward
 * cursor-positioning math, including ANSI color escape sequences
 * which take ~10 chars to emit but contribute 0 visible width.
 * When the user's typed input crosses the terminal's wrap boundary,
 * readline does `cursorTo + clearScreenDown + redraw`. If its
 * prompt-width count is off, the redraw lands on the wrong row and
 * the visible prompt prefix gets duplicated mid-line (observed in
 * user testing on Windows ConHost with our themed `[5s] [design] ❯`
 * prompt).
 *
 * The fix: bypass readline's accounting for the decorative parts.
 * Write them directly via process.stdout.write (terminal handles
 * them as cursor-visible output, readline never sees them). Pass
 * only the bare glyph (no ANSI codes) to rl.question. With the
 * prompt argument now byte-accurate to its visible width, the
 * wrap-redraw math is correct.
 *
 * Trade-offs:
 *   - If the user edits the line (backspace, Ctrl+U, etc.), the
 *     decorative prefix doesn't update — but it doesn't NEED to,
 *     it's not part of the input.
 *   - Screen readers still see the decorative tags (they're plain
 *     stdout output) AND the glyph (as the actual prompt).
 *   - In screen-reader mode the caller passes an empty sessionTag
 *     and modeTag, so this is effectively a no-op there.
 */
async function askWithDecoratedPrompt(
  rl: readline.Interface,
  sessionTag: string,
  modeTag: string,
  promptGlyph: string,
  prefill: string = '',
): Promise<string> {
  if (isFooterActive()) {
    return askWithFooterPrompt(rl, prefill, { echoSubmittedLine: false });
  }
  const decorative = sessionTag + modeTag;
  if (decorative.length > 0) {
    process.stdout.write(decorative);
  }
  // theme.prompt wraps in ANSI codes; we keep the styled glyph for
  // visual continuity, but the rest of readline's prompt argument
  // is now a single short colored string instead of three. The
  // remaining mismatch (color codes around the glyph) is bounded
  // and small enough that wrap math stays correct for typical
  // terminal widths.
  const answer = rl.question(theme.prompt(promptGlyph));
  if (prefill) {
    setImmediate(() => {
      const line = prefill.replace(/\r?\n/g, ' ');
      try {
        const rlAny = rl as unknown as { write?: (data: string) => void };
        if (typeof rlAny.write === 'function') {
          rlAny.write(line);
          return;
        }
      } catch { /* fall through */ }
      try {
        setReadlineBuffer(rl, line);
        process.stdout.write(line);
      } catch { /* noop */ }
    });
  }
  return answer;
}

function ansiVisibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function setReadlineBuffer(
  rl: readline.Interface,
  line: string,
): void {
  const rlAny = rl as unknown as { line: string; cursor: number };
  rlAny.line = line;
  rlAny.cursor = line.length;
}

interface ConfigChoice<T> {
  label: string;
  detail?: string;
  value: T;
}

type TaggedKeypressListener = ((...args: unknown[]) => void) & { __grawkusHotkey__?: boolean };

interface SlashPickerState {
  promise: Promise<InlineSuggestResult>;
  startedAtMs: number;
}

async function selectConfigChoice<T>(
  rl: readline.Interface,
  title: string,
  choices: ConfigChoice<T>[],
  options: {
    defaultIndex?: number;
    fallbackPrompt?: string;
    parseFallback?: (answer: string, defaultIndex: number) => T | undefined;
  } = {},
): Promise<T> {
  const defaultIndex = Math.max(0, Math.min(options.defaultIndex ?? 0, choices.length - 1));

  if (!stdin.isTTY || !stdout.isTTY) {
    console.log(chalk.white(`\n  ${title}:\n`));
    choices.forEach((choice, i) => {
      console.log(chalk.white(`  ${i + 1}. ${choice.label}`) + (choice.detail ? chalk.dim(` (${choice.detail})`) : ''));
    });
    const answer = await rl.question(chalk.yellow(options.fallbackPrompt ?? `\n  Choice [${defaultIndex + 1}]: `));
    const parsed = options.parseFallback?.(answer, defaultIndex);
    if (parsed !== undefined) return parsed;
    const idx = Number.parseInt(answer || String(defaultIndex + 1), 10) - 1;
    return choices[Math.max(0, Math.min(idx, choices.length - 1))].value;
  }

  return new Promise<T>((resolve) => {
    let selected = defaultIndex;
    let typed = '';
    let renderedRows = 0;
    const wasRaw = stdin.isRaw;
    const keypressListeners = stdin.listeners('keypress').slice() as TaggedKeypressListener[];
    const detached = keypressListeners.filter((listener) => !listener.__grawkusHotkey__);

    function clearRendered(): void {
      for (let i = 0; i < renderedRows; i++) {
        stdout.write('\x1b[1A\r\x1b[2K');
      }
      renderedRows = 0;
    }

    function line(text = ''): void {
      stdout.write(`${text}\n`);
      renderedRows++;
    }

    function render(): void {
      clearRendered();
      line(chalk.white(`  ${title}`));
      line('');
      choices.forEach((choice, i) => {
        const marker = i === selected ? chalk.inverse(' > ') : '   ';
        const index = chalk.dim(`${i + 1}.`.padStart(3));
        const detail = choice.detail ? chalk.dim(`  ${choice.detail}`) : '';
        const label = i === selected ? chalk.bold(choice.label) : choice.label;
        line(`${marker} ${index} ${label}${detail}`);
      });
      line('');
      const typedHint = typed ? ` number: ${typed}` : ` default: ${defaultIndex + 1}`;
      line(chalk.dim(`  Up/Down choose, Enter select, 1-${choices.length} jump, Esc keeps default;${typedHint}`));
    }

    function cleanup(): void {
      stdin.removeListener('data', onData);
      for (const listener of detached) stdin.on('keypress', listener);
      try { stdin.setRawMode(wasRaw); } catch { /* noop */ }
      clearRendered();
    }

    function done(value: T): void {
      cleanup();
      const selectedChoice = choices.find((choice) => choice.value === value);
      stdout.write(chalk.dim(`  ${title}: `) + chalk.white(selectedChoice?.label ?? String(value)) + '\n');
      resolve(value);
    }

    function onData(buf: Buffer): void {
      if (buf.length === 1 && buf[0] === 0x03) {
        cleanup();
        process.exit(130);
      }
      if (buf.length === 1 && buf[0] === 0x1B) {
        done(choices[defaultIndex].value);
        return;
      }
      if (buf.length === 1 && (buf[0] === 0x0D || buf[0] === 0x0A)) {
        if (typed) {
          const idx = Number.parseInt(typed, 10) - 1;
          done(choices[Math.max(0, Math.min(idx, choices.length - 1))].value);
          return;
        }
        done(choices[selected].value);
        return;
      }
      if (buf.length === 1 && (buf[0] === 0x7F || buf[0] === 0x08)) {
        typed = typed.slice(0, -1);
        render();
        return;
      }
      if (buf.length >= 3 && buf[0] === 0x1B && buf[1] === 0x5B) {
        const code = buf[2];
        if (code === 0x41) selected = (selected - 1 + choices.length) % choices.length;
        else if (code === 0x42) selected = (selected + 1) % choices.length;
        else if (code === 0x48) selected = 0;
        else if (code === 0x46) selected = choices.length - 1;
        render();
        return;
      }
      const text = buf.toString('utf8').replace(/[^\x20-\x7E]/g, '');
      if (/^\d+$/.test(text)) {
        typed = (typed + text).slice(0, 2);
        const idx = Number.parseInt(typed, 10) - 1;
        if (idx >= 0 && idx < choices.length) selected = idx;
        render();
      }
    }

    for (const listener of detached) stdin.removeListener('keypress', listener);
    try { stdin.setRawMode(true); } catch { /* noop */ }
    stdin.resume();
    stdin.on('data', onData);
    render();
  });
}

/**
 * Parse a slash command into (cmd, args).
 *
 * Args normalization: leading + trailing angle brackets are stripped
 * automatically. The /help text uses `<arg>` as placeholder syntax
 * (e.g. `/resume <session-id>`, `/model <name>`), and users routinely
 * paste the placeholder literally — `/resume <abc123>` instead of
 * `/resume abc123`. Stripping at the parser level means every
 * command gets the same forgiving treatment without each handler
 * having to defensively unwrap.
 *
 * Quotes / brackets other than `<>` are intentionally NOT stripped
 * here. Some commands legitimately take quoted strings (e.g.
 * `/article "How to be a vibe coder"`) — those commands should
 * handle their own quote semantics. Only the `<>` placeholder
 * pattern is normalized universally.
 */
function parseSlashCommand(input: string): { cmd: string; args: string } {
  const trimmed = input.trim();
  const spaceIdx = trimmed.indexOf(' ');

  if (spaceIdx === -1) {
    return { cmd: trimmed.toLowerCase(), args: '' };
  }

  const cmd = trimmed.slice(0, spaceIdx).toLowerCase();
  let argsRaw = trimmed.slice(spaceIdx + 1).trim();

  // Strip leading + trailing `<>` if they wrap the entire arg
  // string. Keeps `<>` inside the arg untouched (e.g. paths with
  // angle brackets in regex-style queries) — only the outermost
  // wrap is removed.
  if (argsRaw.startsWith('<') && argsRaw.endsWith('>') && argsRaw.length > 2) {
    argsRaw = argsRaw.slice(1, -1).trim();
  }

  return { cmd, args: argsRaw };
}

// ── Slash Commands ────────────────────────────────────────
// Exported so smoke tests can dispatch commands directly without spawning a
// readline REPL or burning LLM tokens. Returns shape is stable contract:
//   { handled: true }              — local command, output printed to stdout
//   { handled: false, injectPrompt } — LLM-driven, prompt ready to send
export interface SlashCommandResult {
  handled: boolean;
  shouldExit?: boolean;
  newMessages?: Message[];
  injectPrompt?: string;
  turnOverride?: ModelTurnOverride | null;
  routeRole?: RouteRole | null;
}

export function handleSlashCommand(
  input: string,
  config: GrawkusConfig,
  messages: Message[],
  session: Session,
  mode: { current: Mode },
): SlashCommandResult {
  const parsed = parseSlashCommand(input);
  const resolved = resolveCommandEntry(parsed.cmd);
  const cmd = resolved?.entry.command ?? parsed.cmd;
  const args = parsed.args;

  switch (cmd) {
    // ── Help ──────────────────────────────────────────
    case '/help': {
      const h = theme.header;
      const d = theme.dim;
      const c = theme.command;
      if (args.trim()) {
        printCommandHelp(args);
        return { handled: true };
      }
      // Inline status line: confirms ECC is on (and how many skills it brings)
      // without giving it its own section. ECC has no user-facing commands;
      // it works automatically.
      const eccState = loadEccState();
      if (eccState) {
        console.log(d(`\n  ECC: `) + theme.toolStatus('✓ enabled') + d(` — ${eccState.counts.skills} skills, ${eccState.counts.agents} agents, ${eccState.counts.commands + eccState.counts.prompts} workflows auto-loaded`));
      }
      console.log(h('\n  ── General ──'));
      console.log(d('  ') + c('/help') + d('             — this help'));
      console.log(d('  ') + c('/config') + d('           — reconfigure provider/model/key'));
      console.log(d('  ') + c('/theme [mode]') + d('     — toggle display mode (full/compact/minimal)'));
      console.log(d('  ') + c('/palette [id]') + d('     — switch color palette; run /palettes to list'));
      console.log(d('  ') + c('/palettes') + d('         — list available color palettes with preview'));
      console.log(d('  ') + c('/footer [sub]') + d('    — customize the fixed bottom footer and startup prompt'));
      console.log(d('  ') + c('/clear') + d('            — clear conversation'));
      console.log(d('  ') + c('/back [n]') + d('         — rewind to before the nth most-recent user turn (no arg lists turns)'));
      console.log(d('  ') + c('/fork [name]') + d('      — branch current conversation; previous session reachable via /resume (alias: /branch)'));
      console.log(d('  ') + c('/btw <question>') + d('   — side question, model knows not to factor into the main thread'));
      console.log(d('  ') + c('/editor [seed]') + d('    — open $EDITOR / $VISUAL on a tempfile for long prompts (alias: /edit-prompt)'));
      console.log(d('  ') + c('/history') + d('          — message count & token estimate'));
      console.log(d('  ') + c('/export [fmt]') + d('     — export conversation (md/json/txt)'));
      console.log(d('  ') + c('/exit') + d('             — quit (alias: /quit)'));
      console.log(d('  ') + c('/walkthrough') + d('      — agent-led tour of Grawkus (aliases: /tour, /guide)'));
      console.log(d('  ') + c('!<cmd>') + d('            — run shell command directly'));
      console.log(h('\n  ── Productivity hotkeys ──'));
      console.log(d('  ') + c('Shift+Tab') + d('         — cycle permission modes (ask → auto → yolo)'));
      console.log(d('  ') + c('Esc') + d('               — interrupt current turn (alias for Ctrl+G steer; both work)'));
      console.log(d('  ') + c('Esc Esc') + d('           — rewind to the previous user turn (at empty prompt)'));
      console.log(d('  ') + c('Alt+,  /  Alt+.') + d('   — temperature − / + by 0.1 (more careful / more creative)'));
      console.log(d('  ') + c('Ctrl+G') + d('            — steer (legacy alias for Esc)'));
      console.log(h('\n  ── Model & Provider ──'));
      console.log(d('  ') + c('/model [name]') + d('     — switch or show model'));
      console.log(d('  ') + c('/models') + d('           — list available models for provider'));
      console.log(d('  ') + c('/fallback [model]') + d(' — set/show the model auto-retried on cryptic provider errors'));
      console.log(d('  ') + c('/openrouter-free') + d('  — switch to OpenRouter free-tier router'));
      console.log(d('  ') + c('/provider') + d('         — show provider info'));
      console.log(d('  ') + c('/openai-login') + d('     — authenticate OpenAI Codex OAuth via Codex CLI'));
      console.log(d('  ') + c('/openai-login smoke') + d(' — test OAuth request + streaming'));
      console.log(d('  ') + c('/keys [add|rm]') + d('    — multi-key rotation pool (e.g. several OpenRouter accounts)'));
      console.log(d('  ') + c('/route [role]') + d('       — auto-route model based on next message'));
      console.log(h('\n  ── Modes ──'));
      console.log(d('  ') + c('/mode [name]') + d('      — switch mode (dev/review/tdd/research/plan/debug/architect/sentience/promode/design)'));
      console.log(d('  ') + c('/promode [on|off|stop|cron]') + d(' — ProMode TILW loop; /task /idea /like /want'));
      console.log(d('  ') + c('/modes') + d('            — list all modes (read-only; use /mode <name> to switch)'));
      console.log(d('  ') + c('/sentience') + d('        — self-improving learning loop (alias: /hermes)'));
      console.log(d('  ') + c('/design [task]') + d('    — switch to design mode (Stitch-powered UI generation); optional task to start immediately'));
      console.log(h('\n  ── Session ──'));
      console.log(d('  ') + c('/sessions') + d('         — list saved sessions'));
      console.log(d('  ') + c('/save [name]') + d('      — save current session'));
      console.log(d('  ') + c('/resume <id>') + d('      — resume a saved session'));
      console.log(d('  ') + c('/delete <id>') + d('      — delete a session'));
      console.log(d('  ') + c('/import [sub]') + d('      — import Claude/Codex/MemPalace history and memory'));
      console.log(h('\n  ── Git ──'));
      console.log(d('  ') + c('/commit') + d('           — AI-generated commit'));
      console.log(d('  ') + c('/pr') + d('               — AI-generated pull request'));
      console.log(d('  ') + c('/diff') + d('             — show git diff'));
      console.log(d('  ') + c('/log') + d('              — show git log'));
      console.log(h('\n  ── Code Quality ──'));
      console.log(d('  ') + c('/review [target]') + d('  — AI code review (uses ECC prompt, language-agnostic)'));
      console.log(d('  ') + c('/auto-review') + d('      — same, but adds a language-specific lens (auto-detected)'));
      console.log(d('  ') + c('/tdd <desc>') + d('       — test-driven development'));
      console.log(d('  ') + c('/security-review') + d('  — security audit'));
      console.log(d('  ') + c('/audit') + d('            — harness audit (score project health)'));
      console.log(d('  ') + c('/doctor') + d('           — install/config/benchmark readiness check'));
      console.log(d('  ') + c('/verify [cmd]') + d('     — run tests, fix failures, repeat until green'));
      console.log(d('  ') + c('/build-fix') + d('        — auto-detect language & fix build errors'));
      console.log(d('  ') + c('/test-coverage') + d('    — analyze test coverage, suggest tests'));
      console.log(d('  ') + c('/refactor [target]') + d(' — dead code detection & cleanup'));
      console.log(d('  ') + c('/hunt-silent') + d('      — silent-failure-hunter agent (empty catch, log-and-forget, etc.)'));
      console.log(d('  ') + c('/explore') + d('          — code-explorer agent (codebase reconnaissance pass)'));
      console.log(d('  ') + c('/types') + d('            — type-design-analyzer agent (type system + API shape critique)'));
      console.log(d('  ') + c('/architect <task>') + d(' — code-architect agent (structural critique). Distinct from /mode architect.'));
      console.log(d('  ') + c('/simplify') + d('         — code-simplifier agent (find + collapse incidental complexity)'));
      console.log(d('  ') + c('/e2e <feature>') + d('    — generate E2E tests'));
      console.log(d('  ') + c('/eval <criteria>') + d('  — evaluate project against criteria'));
      console.log(d('  ') + c('/benchmark <task>') + d(' — benchmark-grade issue/terminal run'));
      console.log(h('\n  ── Tools & Config ──'));
      console.log(d('  ') + c('/tools') + d('            — list tools'));
      console.log(d('  ') + c('/harness') + d('          — file-level harness component map'));
      console.log(d('  ') + c('/command-audit') + d('    — audit slash command catalog, handlers, and smoke coverage'));
      console.log(d('  ') + c('/rules') + d('            — show coding rules'));
      console.log(d('  ') + c('/perm <mode>') + d('      — set permission mode (ask/auto/yolo); no arg shows current + always-allow list'));
      console.log(d('  ') + c('/perm why <tool>') + d(' — explain whether a tool call allows, prompts, or blocks'));
      console.log(d('  ') + c('/perm-reset') + d('       — clear the per-tool always-allow list'));
      console.log(d('  ') + c('/sandbox [level]') + d('  — OS-native bash sandbox (off / standard / strict)'));
      console.log(d('  ') + c('/dry-run') + d('          — toggle dry-run mode'));
      console.log(d('  ') + c('/thinking') + d('         — toggle thinking display (live + auto-collapse)'));
      console.log(d('  ') + c('/think') + d('            — re-expand the most recent collapsed thinking'));
      console.log(d('  ') + c('/cd <path>') + d('        — change directory'));
      console.log(d('  ') + c('/hooks') + d('            — list configured hooks'));
      console.log(d('  ') + c('/reset-hooks') + d('      — wipe hooks.json and re-seed ECC hooks for current install'));
      console.log(h('\n  ── Planning & Docs ──'));
      console.log(d('  ') + c('/plan <task>') + d('      — structured implementation planning'));
      console.log(d('  ') + c('/update-docs') + d('      — sync documentation with code'));
      console.log(d('  ') + c('/checkpoint [label]') + d(' — save git state checkpoint'));
      console.log(d('  ') + c('/checkpoints') + d('      — list saved checkpoints'));
      console.log(d('  ') + c('/context brief') + d('   — cheap local repo/context preflight'));
      console.log(d('  ') + c('/context dossier <task>') + d(' — task-aware candidate file dossier'));
      console.log(d('  ') + c('/manifest [target]') + d(' — AHE prediction/regression edit contract'));
      console.log(d('  ') + c('/lifespan [--json]') + d(' — diagnose long-session aging risks'));
      console.log(d('  ') + c('/search-first <task>') + d(' — research before coding'));
      console.log(d('  ') + c('/sources <query>') + d(' — direct arXiv/GitHub/HF/Kaggle source scan'));
      console.log(d('  ') + c('/benchmark-repos') + d('  — public Terminal-Bench repo catalog'));
      console.log(d('  ') + c('/repo-digest <repo>') + d(' — direct GitHub repo component/source digest'));
      console.log(d('  ') + c('/source-research') + d('   — arXiv/GitHub/HF/Kaggle research brief'));
      console.log(d('  ') + c('/docs-lookup <query>') + d(' — search docs for answers'));
      // /review already auto-uses ECC's high-quality language-agnostic prompt;
      // /auto-review additionally picks language-specific lens automatically.
      // Per-language commands (/ts-review, /py-review, ...) still work as
      // silent aliases for power users but are not listed here.
      console.log(h('\n  ── Orchestration ──'));
      console.log(d('  ') + c('/orchestrate <task>') + d(' — decompose into parallel sub-agents'));
      console.log(d('  ') + c('/swarm <task>') + d(' — ask setup questions, fan out role agents, then execute from their handoff'));
      console.log(d('  ') + c('/swarm --plan-only <task>') + d(' — run swarm analysis without auto-executing the handoff'));
      console.log(d('  ') + c('/pr-loop') + d('          — autonomous PR review loop'));
      console.log(d('  ') + c('/multi-plan <task>') + d(' — multi-agent planning'));
      console.log(d('  ') + c('/multi-execute') + d('    — multi-agent execution'));
      console.log(d('  ') + c('/multi-backend') + d('    — multi-service backend generation'));
      console.log(d('  ') + c('/multi-frontend') + d('   — multi-component frontend generation'));
      console.log(h('\n  ── Codemaps ──'));
      console.log(d('  ') + c('/codemap') + d('          — show project structure map'));
      console.log(d('  ') + c('/update-codemaps') + d('  — regenerate and save codemap'));
      console.log(h('\n  ── Content Engine ──'));
      console.log(d('  ') + c('/article <topic>') + d('  — generate article/blog post'));
      console.log(d('  ') + c('/slides <topic>') + d('   — generate slide outline'));
      console.log(d('  ') + c('/repurpose <text>') + d(' — repurpose content for channels'));
      console.log(d('  ') + c('/market-research') + d('  — market research report'));
      console.log(d('  ') + c('/investor-deck') + d('    — investor pitch deck'));
      console.log(d('  ') + c('/investor-outreach') + d(' — investor outreach emails'));
      console.log(d('  ') + c('/code-quality') + d('     — comprehensive code quality audit'));
      console.log(d('  ') + c('/skill-stocktake') + d('  — inventory skills & capabilities'));
      console.log(d('  ') + c('/chief-of-staff') + d('   — executive briefing & priorities'));
      console.log(h('\n  ── Skills & Patterns ──'));
      console.log(d('  ') + c('/skill-create') + d('     — create skill from git patterns'));
      console.log(d('  ') + c('/git-patterns') + d('     — analyze git commit patterns'));
      console.log(d('  ') + c('/git-workflow') + d('     — summarize git workflow'));
      console.log(h('\n  ── Learning & Cost ──'));
      console.log(d('  ') + c('/usage') + d('            — token/cost summary'));
      console.log(d('  ') + c('/budget <d> <m>') + d('   — set daily/monthly budget (USD)'));
      console.log(d('  ') + c('/learn') + d('            — extract patterns from this session'));
      console.log(d('  ') + c('/instincts') + d('        — show learned instincts'));
      console.log(d('  ') + c('/instinct-export') + d('  — export instincts to JSON file'));
      console.log(d('  ') + c('/instinct-import') + d('  — import instincts from JSON file'));
      console.log(d('  ') + c('/evolve') + d('           — cluster instincts into reusable skills'));
      console.log(d('  ') + c('/prune') + d('            — delete expired instincts'));
      console.log(d('  ') + c('/skills') + d('           — list learned skills (and bundled ECC skills)'));
      console.log(d('  ') + c('/skill-show <name>') + d(' — print the full prompt text of a specific skill'));
      console.log(d('  ') + c('/ecc-guide [section]') + d('— browse the bundled corpus (skills / agents / commands)'));
      console.log(d('  ') + c('/curate') + d('           — scan skill registry for dupes / stale items (report-only)'));
      console.log(d('  ') + c('/memory [sub]') + d('     — MemPalace: status, enable/disable, wings, rooms, ls, search <q>, get <id>, rm <id>'));
      console.log(d('  ') + c('/users') + d('           — manage users table'));
      console.log(d('  ') + c('/count [inc|dec|reset]') + d(' — increment/decrement/reset counter'));
      console.log(d('  ') + c('/detect') + d('           — detect package manager, test runner, build tool'));
      console.log(d('  ') + c('/hook-profile') + d('     — show hook profile & controls'));
      console.log(d('  ') + c('/pm2 [action]') + d('     — PM2 service management'));
      // ECC is bundled, free, auto-installed on first launch, and used
      // automatically. Built-in /tdd /review /security-review /plan /refactor
      // /build-fix use ECC prompts. ECC-only workflows (feature-development,
      // database-migration, add-language-rules) auto-inject when you describe
      // matching work — no slash command needed. Status line below confirms
      // it's enabled.
      console.log(h('\n  ── Voice & accessibility ──'));
      console.log(d('  ') + c('/voice') + d('            — show voice config & status (off by default)'));
      console.log(d('  ') + c('/voice on|off') + d('     — master switch for dictation + readout'));
      console.log(d('  ') + c('/voice config') + d('     — quick setup walkthrough'));
      console.log(d('  ') + c('/voice key stt <key>') + d(' — OpenAI key for Whisper dictation'));
      console.log(d('  ') + c('/voice key tts <key>') + d(' — ElevenLabs key for assistant readout'));
      console.log(d('  ') + c('/voice test') + d('       — play a short test utterance'));
      console.log(d('  ') + c('/voice echo|skip-code|speed') + d(' — fine-tune behavior'));
      console.log(d('  ') + c('/dictate [s]') + d('      — one-shot record + transcribe (default 30s)'));
      console.log(d('  ') + c('/accessibility') + d('    — toggle screen-reader mode, audio cues, destructive-confirm'));
      console.log(d('  Status hotkeys: F1 what now · F2 where am I · F3 read full · F4 read summary'));
      console.log(d('  Playback hotkeys: F5 dictate · F6 pause · F7 replay · F8 skip · F9 speed+ · F10 speed–'));
      console.log(d('  Read hotkeys:   F11 input buffer · F12 your last turn'));
      console.log(d('  Shift+Fn:       Shift+F1 queued · F2 key pool · F3 last tool · F4 toggle SR · F5 cancel · F6 panic · F12 hotkey list'));
      console.log(h('\n  ── Stitch (Google AI UI/UX design) ──'));
      console.log(d('  Use ') + c('/mode design') + d(' or ') + c('/design <task>') + d(' for UI work — the agent uses Stitch automatically.'));
      console.log(d('  ') + c('/stitch') + d('              — show config status'));
      console.log(d('  ') + c('/stitch tools') + d('        — live verification: tools/list against the server'));
      console.log(d('  ') + c('/stitch <query>') + d('      — direct Stitch assistant (intent-routed)'));
      console.log(d('  ') + c('/stitch-config <key>') + d('— save your Stitch API key locally'));
      console.log();
      return { handled: true };
    }

    // ── Theme ─────────────────────────────────────────
    case '/theme':
      if (args) {
        const validThemes = ['full', 'compact', 'minimal'] as const;
        if (validThemes.includes(args as any)) {
          config.theme = args as 'full' | 'compact' | 'minimal';
          saveConfig(config);
          console.log(chalk.green(`  Theme: ${config.theme}`));
        } else {
          console.log(chalk.yellow(`  Invalid theme: ${args}. Use: full, compact, or minimal`));
        }
      } else {
        return { handled: true, injectPrompt: '__PICK_APPEARANCE__' };
      }
      return { handled: true };

    case '/footer': {
      const input = args.trim();
      const parts = input.split(/\s+/).filter(Boolean);
      const sub = (parts[0] || '').toLowerCase();
      config.footer = config.footer ?? { enabled: true, openingPrompt: '/model' };
      const refreshFooter = (): void => {
        const snapshot = buildFooterSnapshot(config, mode.current, session, process.cwd());
        if (shouldUseFixedFooter(config)) activateFooter(snapshot);
        else deactivateFooter();
        updateFooter(snapshot);
      };
      const printStatus = (): void => {
        console.log(theme.header('\n  Footer'));
        console.log(theme.dim(`  Enabled:        ${config.footer?.enabled === false ? 'off' : 'on'}`));
        console.log(theme.dim(`  Version:        ${getCurrentVersion()}`));
        console.log(theme.dim(`  Opening prompt: ${config.footer?.openingPrompt ?? '/model'}`));
        console.log(theme.dim(`  Status row:     ${config.footer?.template || '(default)'}`));
        console.log(theme.dim(`  Template keys:  {provider}, {model}, {permissions}, {session}, {mode}, {cwd}, {workspace}, {sandbox}, {cost}, {budget}, {activity}, {version}`));
        console.log(theme.dim('\n  Commands:'));
        console.log(theme.dim('    /footer on | off'));
        console.log(theme.dim('    /footer text Provider {provider} | Model {model} | v{version}'));
        console.log(theme.dim('    /footer opening /model     (or: /footer opening off)'));
        console.log(theme.dim('    /footer clear              (clear custom status row)'));
        console.log(theme.dim('    /footer reset              (default footer + /model opening prompt)'));
      };
      if (!sub) {
        printStatus();
        return { handled: true };
      }
      if (sub === 'on') {
        config.footer.enabled = true;
        saveConfig(config);
        refreshFooter();
        console.log(chalk.green('  Footer: on'));
        return { handled: true };
      }
      if (sub === 'off') {
        config.footer.enabled = false;
        saveConfig(config);
        refreshFooter();
        console.log(chalk.green('  Footer: off'));
        return { handled: true };
      }
      if (sub === 'reset') {
        config.footer = { enabled: true, openingPrompt: '/model' };
        saveConfig(config);
        refreshFooter();
        console.log(chalk.green('  Footer reset to defaults.'));
        return { handled: true };
      }
      if (sub === 'clear') {
        delete config.footer.template;
        saveConfig(config);
        refreshFooter();
        console.log(chalk.green('  Footer status row: default'));
        return { handled: true };
      }
      if (sub === 'opening') {
        const value = input.slice(parts[0].length).trim();
        config.footer.openingPrompt = /^(off|none|disable)$/i.test(value) ? '' : (value || '/model');
        saveConfig(config);
        refreshFooter();
        console.log(chalk.green(`  Footer opening prompt: ${config.footer.openingPrompt || '(off)'}`));
        return { handled: true };
      }
      const template = sub === 'text'
        ? input.slice(parts[0].length).trim()
        : input;
      if (!template) {
        printStatus();
        return { handled: true };
      }
      config.footer.template = template;
      saveConfig(config);
      refreshFooter();
      console.log(chalk.green('  Footer status row updated.'));
      console.log(chalk.dim(`  ${template}`));
      return { handled: true };
    }

    // ── Clear ─────────────────────────────────────────
    case '/clear': {
      // Also reset the global state that's keyed to the conversation
      // so Shift+F3 / Shift+F1 / F12 don't surface stale data from
      // before the clear. The main REPL loop replaces `messages` via
      // `newMessages`; we just nuke the side-channel globals.
      const g = globalThis as {
        __grawkusQueuedInput?: string;
        __voiceLastFullResponse?: string | null;
        __voiceLastChunk?: string | null;
        __lastToolCall?: unknown;
      };
      g.__grawkusQueuedInput = '';
      g.__voiceLastFullResponse = null;
      g.__voiceLastChunk = null;
      g.__lastToolCall = null;
      console.log(chalk.dim('  Conversation cleared.'));
      return { handled: true, newMessages: [] };
    }

    // ── Backtrack — rewind to a prior user turn (Codex audit item 4) ──
    //   /back          list recent user messages with numbers
    //   /back <n>      truncate conversation to BEFORE the nth most-recent
    //                  user message (1 = drop the latest user turn + everything after)
    //
    // Killer UX for fixing a misdirected agent: instead of /clear then
    // retyping the original request, jump back N turns and try again from
    // the same starting point. Codex implements this as Esc-Esc + transcript
    // overlay; we use a slash command for now (keyboard binding TBD).
    case '/back':
    case '/rewind': {
      // Find user message indices in order (oldest → newest)
      const userIdx: number[] = [];
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') userIdx.push(i);
      }
      if (userIdx.length === 0) {
        console.log(chalk.dim('  No user messages to rewind to.'));
        return { handled: true };
      }
      const arg = args.trim();
      if (!arg) {
        // List most-recent user turns with their position
        console.log(chalk.cyan(`\n  Recent user turns (most recent first):`));
        const recent = userIdx.slice(-10).reverse();
        recent.forEach((idx, n) => {
          const c = messages[idx].content;
          const text = typeof c === 'string' ? c : '(non-text)';
          const excerpt = text.length > 90 ? text.slice(0, 87) + '…' : text;
          console.log(chalk.dim(`    ${(n + 1).toString().padStart(2)}. ${excerpt}`));
        });
        console.log(chalk.dim('\n  Rewind with: /back <n>  (n=1 = drop the most recent user turn + everything after)\n'));
        return { handled: true };
      }
      const n = parseInt(arg, 10);
      if (isNaN(n) || n < 1 || n > userIdx.length) {
        console.log(chalk.yellow(`  Invalid index. Usage: /back <n>  (1..${userIdx.length})`));
        return { handled: true };
      }
      // We want to truncate to BEFORE the n-th most-recent user message.
      // userIdx is oldest-first; the n-th most-recent is at userIdx[len - n].
      const cutIdx = userIdx[userIdx.length - n];
      const dropped = messages.length - cutIdx;
      const newMessages = messages.slice(0, cutIdx);
      console.log(chalk.green(`  Rewound to before user turn ${n} (dropped ${dropped} message(s)).`));
      return { handled: true, newMessages };
    }

    // ── Fork — branch the current conversation ────────
    // Borrowed from both Claude Code (/branch) and Codex CLI (/fork).
    // Snapshots the current session under its existing ID (so /resume
    // can return to this point), then re-anchors the live REPL to a
    // FRESH session ID that starts with a copy of all current messages.
    // From here, the two branches diverge — exploring a tangent in the
    // fork doesn't touch the original.
    case '/fork':
    case '/branch': {
      const forkName = args.trim() || `fork of ${session.name}`;
      // Snapshot the pre-fork state in a SEPARATE object before
      // mutating the live `session` reference — otherwise both save
      // calls write to whichever ID the mutation has currently set,
      // overwriting the original branch and silently breaking the
      // "previous session reachable via /resume" promise. (Bug found
      // by audit; previously the spread happened AFTER `session.id`
      // was reassigned, so both saves landed under the new ID.)
      const previousId = session.id;
      const previousSnapshot = {
        ...session,
        id: previousId,
        messages: [...messages],
      };
      saveSession(previousSnapshot).catch(() => { /* noop */ });
      // Now mutate the active session in place. The REPL keeps
      // running against `session` so mutation is enough — no need
      // to plumb a swap through the return value.
      session.id = generateSessionId();
      session.name = forkName;
      session.createdAt = new Date().toISOString();
      session.updatedAt = session.createdAt;
      saveSession({ ...session, messages: [...messages] }).catch(() => { /* noop */ });
      console.log(chalk.green(`  Forked session.`));
      console.log(chalk.dim(`    Previous: ${previousId}  (use /resume to return)`));
      console.log(chalk.dim(`    Active:   ${session.id}  "${forkName}"`));
      return { handled: true };
    }

    // ── BTW — side question without main-thread pollution ──
    // Borrowed from Claude Code's /btw. The model sees the question
    // with a marker so it knows the answer shouldn't influence the
    // ongoing task; the user gets a real response but the message
    // pair is flagged in history so /back N treats it as one
    // "compound turn" to skip.
    //
    // V1 caveat: the messages DO still go into history (otherwise the
    // model can't respond at all). The marker is the contract.
    // Recover from a noisy /btw with /back 1.
    case '/btw': {
      const q = args.trim();
      if (!q) {
        console.log(chalk.yellow('  Usage: /btw <question>  — side question, model knows not to factor into the main thread.'));
        return { handled: true };
      }
      const wrapped =
        '[SIDE QUESTION — do NOT integrate this answer into the ongoing task. ' +
        'Answer briefly, then return to the prior context on the next turn.] ' + q;
      return { handled: true, injectPrompt: wrapped };
    }

    // ── Editor — open $EDITOR on a tempfile for long prompts ──
    // Universal Unix idiom (bash's Ctrl+X Ctrl+E, vim's edit-and-resubmit).
    // Useful when the prompt is long, multi-line, or you want syntax
    // highlighting / paste-from-buffer that the REPL's single-line
    // input doesn't give you. Falls back to nano if $EDITOR is unset.
    case '/editor':
    case '/edit-prompt': {
      const editor = process.env.VISUAL || process.env.EDITOR ||
        (process.platform === 'win32' ? 'notepad' : 'nano');
      let result: string;
      try {
        const tmpPath = pathJoin(tmpdir(), `grawkus-prompt-${Date.now()}.md`);
        // Seed with current input buffer if any, plus a help comment.
        const seed =
          (args.trim() ? args : '') +
          (args.trim() ? '\n\n' : '') +
          '<!-- Write your prompt here. Save + close to send. Empty file = cancel. -->\n';
        fsWriteFileSync(tmpPath, seed, 'utf-8');
        const r = spawnSync(editor, [tmpPath], { stdio: 'inherit' });
        if (r.error) {
          console.log(chalk.yellow(`  Could not launch ${editor}: ${r.error.message}`));
          return { handled: true };
        }
        result = fsReadFileSync(tmpPath, 'utf-8');
        // Strip the help comment + any trailing whitespace
        result = result.replace(/<!--[\s\S]*?-->/g, '').trim();
        try { fsUnlinkSync(tmpPath); } catch { /* noop */ }
      } catch (err) {
        console.log(chalk.yellow(`  /editor failed: ${err instanceof Error ? err.message : err}`));
        return { handled: true };
      }
      if (!result) {
        console.log(chalk.dim('  Empty — nothing to send.'));
        return { handled: true };
      }
      console.log(chalk.dim(`  Sending ${result.length} chars from editor…`));
      return { handled: true, injectPrompt: result };
    }

    // ── Debug — toggle instrumentation + tail event log ──
    // Surface for the NDJSON debug stream written to
    // ~/.grawkus/debug/<sessionId>.jsonl. Used by reviewers
    // driving the agent + by users diagnosing their own issues.
    //
    //   /debug              show current level + log path + event count
    //   /debug on [level]   turn instrumentation on (default level: info)
    //   /debug off          turn instrumentation off (existing log file is kept)
    //   /debug tail [N]     print the last N events (default 20) inline
    case '/debug': {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || '').toLowerCase();
      if (!sub) {
        const s = getDebugStatus();
        console.log(chalk.dim(`  Debug level: ${s.level}`));
        console.log(chalk.dim(`  Log file:    ${s.logPath || '(no log — level is off)'}`));
        console.log(chalk.dim(`  Events:      ${s.eventCount} this session`));
        console.log(chalk.dim(`  Uptime:      ${(s.uptimeMs / 1000).toFixed(1)}s`));
        console.log('');
        console.log(chalk.dim(`  /debug on [info|debug|trace]`));
        console.log(chalk.dim(`  /debug off`));
        console.log(chalk.dim(`  /debug tail [N]`));
        return { handled: true };
      }
      if (sub === 'off') {
        setDebugLevel('off');
        console.log(chalk.green('  Debug: off'));
        return { handled: true };
      }
      if (sub === 'on') {
        const lvl = (parts[1] || 'info').toLowerCase();
        if (lvl !== 'info' && lvl !== 'debug' && lvl !== 'trace') {
          console.log(chalk.yellow(`  Unknown level "${lvl}". Use info, debug, or trace.`));
          return { handled: true };
        }
        setDebugLevel(lvl as DebugLevel);
        const s = getDebugStatus();
        console.log(chalk.green(`  Debug: ${lvl} — writing to ${s.logPath}`));
        return { handled: true };
      }
      if (sub === 'tail') {
        const n = parseInt(parts[1] || '20', 10);
        const lines = tailDebug(Number.isFinite(n) && n > 0 ? n : 20);
        if (lines.length === 0) {
          console.log(chalk.dim('  (no events — turn on with /debug on)'));
          return { handled: true };
        }
        console.log(chalk.dim(`  Last ${lines.length} debug events:`));
        for (const ln of lines) {
          try {
            const rec = JSON.parse(ln);
            const ts = String(rec.rel || 0).padStart(6) + 'ms';
            const lvl = (rec.lvl || '').toUpperCase().padEnd(5);
            const ev = rec.ev || '';
            const d = rec.data ? '  ' + JSON.stringify(rec.data).slice(0, 120) : '';
            console.log(chalk.dim(`    ${ts}  ${lvl}  ${ev}${d}`));
          } catch {
            console.log(chalk.dim(`    ${ln.slice(0, 200)}`));
          }
        }
        return { handled: true };
      }
      console.log(chalk.yellow(`  Unknown /debug subcommand "${sub}". Try: /debug, /debug on, /debug off, /debug tail`));
      return { handled: true };
    }

    // ── History ───────────────────────────────────────
    case '/history': {
      const stats = getCompactionStats(messages, config);
      const userMsgs = messages.filter((m) => m.role === 'user').length;
      const assistMsgs = messages.filter((m) => m.role === 'assistant').length;
      const toolMsgs = messages.filter((m) => m.role === 'tool').length;
      console.log(chalk.dim(`  Messages: ${messages.length} (${userMsgs} user, ${assistMsgs} assistant, ${toolMsgs} tool)`));
      console.log(chalk.dim(
        `  Est. tokens: ~${stats.estimatedTokens.toLocaleString()} / ` +
        `~${stats.triggerTokens.toLocaleString()} compaction trigger` +
        `${stats.needsCompaction ? ' (compaction recommended)' : ''}`,
      ));
      return { handled: true };
    }

    // ── Model ─────────────────────────────────────────
    case '/model':
      if (args) {
        const tokens = tokenizeModelCommandArgs(args);
        const sub = (tokens[0] || '').toLowerCase();
        if (sub === 'alias' || sub === 'aliases') {
          if (tokens.length === 1 || sub === 'aliases') {
            const aliases = listModelAliases(config);
            console.log(chalk.cyan('\n  Model aliases:'));
            for (const item of aliases) {
              const source = item.source === 'builtin' ? 'built-in' : 'user';
              console.log(chalk.dim(`  ${item.alias.padEnd(18)} -> ${item.model} (${source})`));
            }
            console.log(chalk.dim('\n  Set: /model alias <name> <model-id>   Remove: /model unalias <name>'));
            return { handled: true };
          }
          const alias = tokens[1] || '';
          const target = tokens.slice(2).join(' ');
          const set = setModelAlias(config, alias, target);
          if (!set.ok) {
            console.log(chalk.yellow(`  ${set.error}`));
            return { handled: true };
          }
          saveConfig(config);
          console.log(chalk.green(`  Model alias ${alias.toLowerCase()} -> ${set.model}`));
          return { handled: true };
        }
        if (sub === 'unalias' || sub === 'remove' || sub === 'rm' || sub === 'delete') {
          const alias = tokens[1] || '';
          if (!alias) {
            console.log(chalk.yellow('  Usage: /model unalias <name>'));
            return { handled: true };
          }
          const removed = deleteModelAlias(config, alias);
          if (removed) {
            saveConfig(config);
            console.log(chalk.green(`  Removed model alias ${alias.toLowerCase()}`));
          } else {
            console.log(chalk.yellow(`  No user model alias named ${alias}.`));
          }
          return { handled: true };
        }
        if (sub === 'once' || sub === 'next') {
          const parsedOnce = parseModelOnce(config, tokens.slice(1).join(' '));
          if (parsedOnce.error || !parsedOnce.override) {
            console.log(chalk.yellow(`  ${parsedOnce.error || 'Could not parse one-shot model override.'}`));
            return { handled: true };
          }
          console.log(chalk.green(`  Next turn override: ${formatTurnOverride(parsedOnce.override, config.model)}`));
          return { handled: true, turnOverride: parsedOnce.override };
        }
        if (sub === 'effort' || sub === 'reasoning') {
          const effort = normalizeReasoningEffort(tokens[1]);
          if (!effort) {
            console.log(chalk.yellow('  Usage: /model effort none|minimal|low|medium|high|xhigh'));
            return { handled: true };
          }
          const turnOverride: ModelTurnOverride = { reasoningEffort: effort, source: 'manual' };
          console.log(chalk.green(`  Next turn reasoning effort: ${effort}`));
          return { handled: true, turnOverride };
        }

        const resolvedModel = resolveModelReference(config, args);
        applyModelSelection(config, resolvedModel.model);
        saveConfig(config);
        resetClient();
        console.log(chalk.green(`  Model: ${formatModelResolution(resolvedModel)}`));
        return { handled: true };
      }
      // No args. On OpenRouter, the user wants the interactive
      // picker (catalog + pricing). On other providers we don't
      // have an equivalent catalog endpoint, so keep the legacy
      // "show current" behavior.
      if (/openrouter/i.test(config.provider)) {
        // The picker is async; handleSlashCommand is sync. Use the
        // sentinel-injectPrompt pattern that /dictate + /swarm
        // already use to defer async work to the main REPL loop.
        return { handled: true, injectPrompt: '__PICK_MODEL__' };
      }
      console.log(chalk.dim(`  Current: ${config.model}`));
      console.log(chalk.dim('  (interactive picker is OpenRouter-only — pass a model name explicitly with /model <id>)'));
      return { handled: true };

    case '/models':
      printModelOptions(config);
      return { handled: true };

    // /fallback — set or show the model used as a one-shot rescue when the
    // primary model returns a cryptic provider error. Set to '' / 'off' to
    // disable. Independent from /model (which switches the primary).
    case '/fallback': {
      const target = args.trim();
      if (!target) {
        const cur = config.fallbackModel ?? '(not set)';
        console.log(chalk.dim(`  Current fallback model: ${cur}`));
        console.log(chalk.dim(`  Used once per chain when the primary times out, returns empty text, or hits an unknown provider error.`));
        console.log(chalk.dim(`  Set with: /fallback <model-id>  · disable with: /fallback off`));
        return { handled: true };
      }
      if (target === 'off' || target === 'none' || target === 'disable') {
        config.fallbackModel = undefined;
        saveConfig(config);
        console.log(chalk.green('  Fallback model disabled.'));
        return { handled: true };
      }
      config.fallbackModel = target;
      saveConfig(config);
      console.log(chalk.green(`  Fallback model: ${target}`));
      console.log(chalk.dim(`  Will be tried automatically once per chain if ${config.model} times out, returns empty text, or hits an unknown provider error.`));
      return { handled: true };
    }

    case '/openrouter-free': {
      config.provider = PROVIDERS.openrouter.name;
      config.baseURL = PROVIDERS.openrouter.baseURL;
      applyModelSelection(config, PROVIDERS.openrouter.defaultModel);
      config.fallbackModel = undefined;
      saveConfig(config);
      resetClient();
      console.log(chalk.green('  OpenRouter free-tier mode enabled.'));
      console.log(chalk.dim(`  Model: ${config.model}`));
      console.log(chalk.dim('  Fallback: disabled. Enable explicitly with /fallback <model-id>.'));
      console.log(chalk.dim('  The free router picks a currently available zero-cost model that supports the request shape.'));
      return { handled: true };
    }

    case '/route': {
      const role = parseRouteRole(args);
      if (args && !isValidRouteRole(args)) {
        console.log(chalk.yellow('  Usage: /route [fast|balanced|powerful|coding|analysis|review|verification|auto]'));
        console.log(chalk.dim('  Shortcuts: /route quick|normal|strong|code|analyze|reviewer|verify'));
        return { handled: true };
      }
      const roleLabel = role === 'auto' ? 'auto' : `role:${role}`;
      console.log(chalk.dim(`  Auto-routing enabled for next message (${roleLabel}).`));
      return { handled: true, routeRole: role };
    }

    case '/provider':
      console.log(chalk.dim(`  Provider: ${config.provider}`));
      console.log(chalk.dim(`  Base URL: ${config.baseURL}`));
      console.log(chalk.dim(`  Model: ${config.model}`));
      if (/openrouter/i.test(config.provider)) {
        console.log(chalk.dim(`  OpenRouter tier: ${isOpenRouterFreeModelId(config.model) ? 'free-compatible' : 'may require credits'}`));
        if (config.fallbackModel) console.log(chalk.dim(`  Fallback: ${config.fallbackModel}`));
      }
      if (config.openaiAuth?.type === 'codex_oauth') {
        const status = getOpenAICodexAuthStatus(config);
        const source = status.source === 'env' ? 'environment' : status.authPath;
        console.log(chalk.dim(`  Auth: OpenAI Codex OAuth (${status.available ? 'available' : 'missing'})`));
        console.log(chalk.dim(`  Token source: ${status.available ? source : status.authPath}`));
        if (status.email) console.log(chalk.dim(`  Account: ${status.email}`));
      } else {
        console.log(chalk.dim(`  API Key: ${config.apiKey ? '***' + config.apiKey.slice(-4) : '(none)'}`));
      }
      return { handled: true };

    case '/openai-login': {
      const sub = args.trim().toLowerCase();
      if (sub === 'status') {
        const status = getOpenAICodexAuthStatus(config);
        console.log(chalk.dim(`  Configured: ${config.openaiAuth?.type === 'codex_oauth' ? 'yes' : 'no'}`));
        console.log(chalk.dim(`  Auth file: ${status.authPath}`));
        console.log(chalk.dim(`  OAuth token: ${status.available ? 'available' : 'missing'}`));
        if (status.email) console.log(chalk.dim(`  Account: ${status.email}`));
        if (status.error) console.log(chalk.yellow(`  ${status.error}`));
        return { handled: true };
      }
      if (sub === 'smoke' || sub === 'test' || sub === 'doctor') {
        return { handled: true, injectPrompt: '__OPENAI_OAUTH_SMOKE__' };
      }

      const wasCodexOAuth = config.openaiAuth?.type === 'codex_oauth' ||
        config.provider === PROVIDERS['openai-codex'].name;
      config.openaiAuth = {
        type: 'codex_oauth',
        useCodexAuthFile: true,
        chatgptBaseURL: CHATGPT_CODEX_BASE_URL,
        codexHome: config.openaiAuth?.codexHome,
      };
      config.provider = PROVIDERS['openai-codex'].name;
      config.baseURL = CHATGPT_CODEX_BASE_URL;
      if (!wasCodexOAuth || !config.model) {
        config.model = PROVIDERS['openai-codex'].defaultModel;
      }
      config.apiKey = '';
      saveConfig(config);
      resetClient();

      console.log(chalk.dim('  Launching Codex login. Complete the browser/device flow, then return here.'));
      const result = runCodexLogin(config);
      if (!result.ok) {
        console.log(chalk.yellow(`  codex login did not complete${result.error ? ': ' + result.error : ''}`));
        console.log(chalk.dim('  You can also run "codex login" manually, then /openai-login status.'));
        return { handled: true };
      }
      const status = getOpenAICodexAuthStatus(config);
      if (status.available) {
        console.log(chalk.green('  OpenAI Codex OAuth is configured for Grawkus.'));
        if (status.email) console.log(chalk.dim(`  Account: ${status.email}`));
      } else {
        console.log(chalk.yellow('  Login command finished, but no OAuth token was found.'));
        console.log(chalk.dim(`  Expected auth file: ${status.authPath}`));
      }
      return { handled: true };
    }

    // ── Mode ──────────────────────────────────────────
    case '/mode':
      if (args && normalizeModeName(args)) {
        const nextMode = normalizeModeName(args)!;
        if (nextMode !== 'promode') {
          pausePromodeIfLeavingMode(nextMode, process.cwd());
        }
        mode.current = nextMode;
        const m = MODES[mode.current];
        console.log(chalk.green(`  Mode: ${m.label} — ${m.description}`));
        if (nextMode === 'promode') {
          return { handled: true, injectPrompt: PROMODE_ACTIVATE_SENTINEL };
        }
        // Soft hint when switching mode with conversation history present.
        // Mode switches DON'T clear context, which means a previous
        // request's residue (e.g. "write me a poem") can leak into the
        // new mode's responses ("I'll handle both requests…"). Suggest
        // /clear so users notice this and decide intentionally.
        if (messages.length > 0) {
          console.log(chalk.dim(`  Note: conversation history kept across mode switch. Run /clear for a fresh context if you don't want it.`));
        }
        // Accessibility: speak the mode-switch when configured. Doesn't
        // block — fire-and-forget. Errors swallowed (voice should never
        // break the REPL).
        if (isVoiceEnabled(config) && getAccessibilityConfig(config).announceModeSwitches) {
          const tts = getTtsConfig(config);
          if (tts.apiKey) {
            speak(`Mode switched to ${m.label}`, config, { voiceId: tts.assistantVoiceId }).catch(() => { /* noop */ });
          }
        }
      } else if (args) {
        console.log(chalk.yellow(`  Unknown mode: ${args}`));
        console.log(chalk.dim(`  Available: ${Object.keys(MODES).join(', ')}`));
      } else {
        console.log(chalk.dim(`  Current: ${mode.current} (${MODES[mode.current].description})`));
      }
      return { handled: true };

    case '/promode':
    case '/task':
    case '/idea':
    case '/like':
    case '/want': {
      const promodeResult = handlePromodeSlash(cmd, args, {
        cwd: process.cwd(),
        config,
      }) ?? { handled: true };
      if (promodeResult.injectPrompt === PROMODE_ACTIVATE_SENTINEL) {
        return { handled: true, injectPrompt: PROMODE_ACTIVATE_SENTINEL };
      }
      if (promodeResult.injectPrompt) {
        mode.current = 'promode';
        return { handled: false, injectPrompt: promodeResult.injectPrompt };
      }
      return { handled: promodeResult.handled, shouldExit: promodeResult.shouldExit };
    }

    // ── Sentience shorthand (/hermes remains a compatibility alias) ──
    case '/sentience':
    case '/hermes': {
      mode.current = 'sentience';
      const m = MODES.sentience;
      console.log(chalk.cyan(`  Mode: ${m.label}`));
      console.log(chalk.dim(`  ${m.description}`));
      console.log(chalk.dim(`  Recall → user-model → parallelize → distill → persist → schedule.`));
      return { handled: true };
    }

    // ── Design mode shortcut: switch + optionally inject task ─────
    case '/design': {
      mode.current = 'design';
      const m = MODES.design;
      console.log(chalk.cyan(`  Mode: ${m.label}`));
      console.log(chalk.dim(`  ${m.description}`));
      if (!stitchConfigured()) {
        console.log(chalk.yellow(`\n  ⚠ Stitch is not configured. Run /stitch-config <api-key> to enable.`));
        console.log(chalk.dim(`  In design mode without Stitch, I'll fall back to plain HTML/CSS.`));
      }
      if (args.trim()) {
        return { handled: false, injectPrompt: args.trim() };
      }
      console.log(chalk.dim(`\n  Now describe what you want built — e.g.:`));
      console.log(chalk.dim(`    "Build a stock portfolio app, edgy red palette, no blue/green"`));
      return { handled: true };
    }

    case '/modes':
      // List-only. Use `/mode <name>` to switch — single switcher, no duplicates.
      if (args) {
        console.log(chalk.dim(`  /modes lists modes only. To switch: /mode ${args}`));
      }
      console.log(chalk.cyan('\n  Modes:'));
      for (const m of listModes()) {
        const marker = m.name === mode.current ? chalk.green(' ◀') : '';
        console.log(chalk.white(`  ${m.name.padEnd(12)}`) + chalk.dim(m.description) + marker);
      }
      console.log(theme.dim('\n  Switch with: /mode <name>'));
      console.log();
      return { handled: true };

    // ── Session ───────────────────────────────────────
    case '/sessions': {
      const sessions = listSessions();
      if (sessions.length === 0) {
        console.log(chalk.dim('  No saved sessions.'));
      } else {
        console.log(chalk.cyan(`\n  Saved Sessions (${sessions.length}):`));
        // Show the FULL ID. Previously we truncated to 12 chars for
        // visual density, but users copy-paste the displayed string
        // into /resume and the truncated form doesn't match the
        // actual filename — every paste failed. Width-aware padding
        // keeps the table aligned across rows of differing ID
        // lengths.
        const maxIdLen = Math.max(...sessions.map((s) => s.id.length));
        for (const s of sessions.slice(0, 20)) {
          console.log(
            chalk.white(`  ${s.id.padEnd(maxIdLen + 2)}`) +
            chalk.dim(`${s.name.padEnd(30)} ${s.turnCount} turns  ${s.model}  ${s.updatedAt.slice(0, 10)}`),
          );
        }
        console.log(chalk.dim(`\n  Use /resume <id>, /resume <prefix>, or /resume last to restore one.`));
      }
      return { handled: true };
    }

    case '/save':
      session.name = args || session.name;
      // Snapshot live state so the saved session captures the
      // user's current mode + perm choices, not the values that
      // were on the Session object at create time. Otherwise
      // /resume restores stale config and the model behaves
      // unexpectedly (e.g. a yolo session resumed in ask mode).
      autoSave(session, messages, {
        model: config.model,
        provider: config.provider,
        mode: mode.current,
        permissionMode: config.permissionMode,
        cwd: process.cwd(),
      });
      console.log(chalk.green(`  Session saved: ${session.id} "${session.name}"`));
      return { handled: true };

    case '/resume': {
      if (!args.trim()) {
        return { handled: true, injectPrompt: '__RESUME_PICK__' };
      }
      // resolveSessionRef accepts exact ID, prefix match (like git),
      // "last"/"latest" shortcut, and strips angle/quote wrappers
      // (users pasting /resume <id> from the help text). This
      // replaces the exact-only lookup that broke for everyone
      // who copy-pasted from /sessions's previously-truncated
      // display.
      const ref = resolveSessionRef(args);
      if ('error' in ref) {
        console.log(chalk.red(`  ${ref.error}`));
        if (ref.candidates && ref.candidates.length > 0) {
          console.log(chalk.dim('  Matching candidates:'));
          for (const c of ref.candidates.slice(0, 8)) console.log(chalk.dim(`    ${c}`));
        }
        return { handled: true };
      }
      const loaded = loadSession(ref.id);
      if (!loaded) {
        // Resolver said the file exists but loadSession returned
        // null — corrupt JSON. Surface clearly rather than silently
        // looking like a not-found.
        console.log(chalk.red(`  Session ${ref.id} resolved but its JSON is corrupt.`));
        return { handled: true };
      }
      // ── Restore live state ─────────────────────────────────
      // Previously /resume only returned newMessages and left the
      // live config / mode / perm at whatever the current REPL
      // happened to be in. That breaks the contract: a yolo
      // session resumed in ask mode means the model needs
      // permission for every tool call the original session ran
      // freely. Now we mutate the live config + session + mode
      // objects in place so the resumed state takes effect
      // immediately. Fields absent from old (pre-v1.30.2) session
      // files leave the current value untouched.
      const changes: string[] = [];
      if (loaded.model && loaded.model !== config.model) {
        changes.push(`model ${config.model} → ${loaded.model}`);
        config.model = loaded.model;
      }
      if (loaded.provider && loaded.provider !== config.provider) {
        changes.push(`provider ${config.provider} → ${loaded.provider}`);
        config.provider = loaded.provider;
      }
      if (loaded.permissionMode && loaded.permissionMode !== config.permissionMode) {
        changes.push(`perms ${config.permissionMode} → ${loaded.permissionMode}`);
        config.permissionMode = loaded.permissionMode;
      }
      // mode.current is a { current: Mode } box (shared closure
      // ref) so mutation propagates to the hotkey listener +
      // prompt rendering automatically.
      const loadedMode = loaded.mode ? normalizeModeName(loaded.mode) : null;
      if (loadedMode && loadedMode !== mode.current) {
        changes.push(`mode ${mode.current} -> ${loadedMode}`);
        mode.current = loadedMode;
      }
      // Adopt the resumed session's identity so subsequent
      // autosaves write to its file, not the current session's.
      session.id = loaded.id;
      session.name = loaded.name;
      session.createdAt = loaded.createdAt;
      session.updatedAt = loaded.updatedAt;
      session.tokenCount = loaded.tokenCount;
      session.turnCount = loaded.turnCount;
      // Persist the config update so the change survives restart.
      saveConfig(config);

      // Print the full conversation history into the terminal so the
      // user can actually SEE what was said. Previously /resume only
      // restored messages into memory — the model had full context
      // but the user faced a blank prompt, no idea what the prior
      // turns were. The reprint goes BEFORE the "Resumed:" line so
      // the user reads chronologically and the most-recent info is
      // closest to the new prompt.
      if (loaded.messages.length > 0) {
        printResumedHistory(loaded.messages, loaded.name);
      }
      console.log(chalk.green(`  Resumed: ${loaded.name} (${loaded.messages.length} messages)`));
      if (changes.length > 0) {
        console.log(chalk.yellow(`  Restored config: ${changes.join(', ')}`));
      } else {
        console.log(chalk.dim('  Config unchanged (already matches the saved session).'));
      }
      return { handled: true, newMessages: loaded.messages };
    }

    case '/delete': {
      if (!args.trim()) {
        console.log(chalk.yellow('  Usage: /delete <session-id> | <prefix> | last'));
        return { handled: true };
      }
      const ref = resolveSessionRef(args);
      if ('error' in ref) {
        console.log(chalk.yellow(`  ${ref.error}`));
        if (ref.candidates && ref.candidates.length > 0) {
          console.log(chalk.dim('  Matching candidates:'));
          for (const c of ref.candidates.slice(0, 8)) console.log(chalk.dim(`    ${c}`));
        }
        return { handled: true };
      }
      if (deleteSession(ref.id)) {
        console.log(chalk.green(`  Deleted session: ${ref.id}`));
      } else {
        console.log(chalk.yellow(`  Could not delete session: ${ref.id}`));
      }
      return { handled: true };
    }

    // ── Git ───────────────────────────────────────────
    case '/import': {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const sub = (tokens[0] || 'help').toLowerCase();
      const sourceToken = (tokens[1] || 'auto').toLowerCase();
      const limitIdx = tokens.findIndex((t) => t === '--limit');
      const dryRun = tokens.includes('--dry-run');
      const knownSources = ['claude', 'codex', 'mempalace'] as const;
      const parsedSource = knownSources.includes(sourceToken as ImportSource)
        ? (sourceToken as ImportSource)
        : null;
      const limit = limitIdx >= 0 && tokens[limitIdx + 1]
        ? Math.max(1, Math.min(10_000, Number(tokens[limitIdx + 1]) || 1000))
        : 1000;
      const detected = scanImportSources();
      const detectedSources = detected.filter((s) => s.detected && s.artifactsFound > 0).map((s) => s.source);
      const targets: ImportSource[] = parsedSource
        ? [parsedSource]
        : (detectedSources.length > 0 ? detectedSources : ['claude', 'codex', 'mempalace']);

      if (sub === 'help') {
        console.log(chalk.cyan('\n  /import'));
        console.log(chalk.dim('  Migrate prior agent work into Grawkus without losing conversation history.'));
        console.log(chalk.dim('    /import scan'));
        console.log(chalk.dim('    /import preview <claude|codex|mempalace|auto> [--limit N]'));
        console.log(chalk.dim('    /import run <claude|codex|mempalace|auto> [--limit N] [--dry-run]'));
        console.log(chalk.dim('    /import status'));
        console.log(chalk.dim('    /import rollback <run-id>'));
        console.log(chalk.dim('  Notes:'));
        console.log(chalk.dim('    - Claude source: ~/.claude/projects/**/*.jsonl'));
        console.log(chalk.dim('    - Codex source:  ~/.codex/sessions/**/*.jsonl'));
        console.log(chalk.dim('    - MemPalace source: ~/.mempalace/session_notes + identity.txt'));
        console.log();
        return { handled: true };
      }

      if (sub === 'scan') {
        console.log(chalk.cyan('\n  Import sources:'));
        for (const item of detected) {
          const marker = item.detected ? chalk.green('✓') : chalk.yellow('•');
          const count = chalk.dim(`${item.artifactsFound} artifact(s)`);
          console.log(`  ${marker} ${item.source.padEnd(10)} ${count}  ${chalk.dim(item.rootPath)}`);
          if (item.note) console.log(chalk.dim(`     ${item.note}`));
        }
        console.log();
        return { handled: true };
      }

      if (sub === 'status') {
        const status = importStatus();
        console.log(chalk.cyan('\n  Import status:'));
        console.log(chalk.dim(`    ledger entries: ${status.ledgerEntries}`));
        console.log(chalk.dim(`    runs: ${status.runs}`));
        console.log(chalk.dim(`    sessions imported: ${status.sessionsImported}`));
        console.log(chalk.dim(`    memory drawers imported: ${status.drawersImported}`));
        for (const src of knownSources) {
          const row = status.bySource[src];
          console.log(chalk.dim(`    ${src.padEnd(10)} sessions ${String(row.sessions).padStart(4)}  drawers ${String(row.drawers).padStart(4)}`));
        }
        console.log();
        return { handled: true };
      }

      if (sub === 'rollback') {
        const runId = tokens[1];
        if (!runId) {
          console.log(chalk.yellow('  Usage: /import rollback <run-id>'));
          return { handled: true };
        }
        const res = rollbackImport(runId, process.cwd());
        console.log(chalk.green(`  Rolled back ${runId}.`));
        console.log(chalk.dim(`    deleted sessions: ${res.deletedSessions}`));
        console.log(chalk.dim(`    deleted memory drawers: ${res.deletedDrawers}`));
        for (const warning of res.warnings) console.log(chalk.yellow(`    warning: ${warning}`));
        return { handled: true };
      }

      if (sub === 'preview') {
        for (const src of targets) {
          const res = previewImport(src, { limit, cwd: process.cwd() });
          console.log(chalk.cyan(`\n  Preview: ${src}`));
          console.log(chalk.dim(`    artifacts found: ${res.artifactsFound}`));
          console.log(chalk.dim(`    importable: ${res.importableArtifacts}`));
          console.log(chalk.dim(`    already imported: ${res.alreadyImportedArtifacts}`));
          if (res.totalMessages > 0) console.log(chalk.dim(`    messages in sample: ${res.totalMessages}`));
          for (const thread of res.threads.slice(0, 10)) {
            console.log(chalk.dim(`    ${thread.sourceThreadId}  ${thread.messageCount} msgs  ${thread.updatedAt.slice(0, 10)}  ${thread.model}`));
          }
          for (const warning of res.warnings.slice(0, 5)) console.log(chalk.yellow(`    warning: ${warning}`));
        }
        console.log();
        return { handled: true };
      }

      if (sub === 'run') {
        for (const src of targets) {
          const res = runImport(src, { limit, dryRun, cwd: process.cwd() });
          const prefix = dryRun ? 'Dry-run' : 'Imported';
          console.log(chalk.green(`\n  ${prefix}: ${src}`));
          console.log(chalk.dim(`    run id: ${res.runId}`));
          console.log(chalk.dim(`    imported artifacts: ${res.importedArtifacts}`));
          console.log(chalk.dim(`    skipped artifacts: ${res.skippedArtifacts}`));
          if (res.importedSessions > 0) console.log(chalk.dim(`    sessions created: ${res.importedSessions}`));
          if (res.importedMessages > 0) console.log(chalk.dim(`    messages imported: ${res.importedMessages}`));
          if (res.importedDrawers > 0) console.log(chalk.dim(`    memory drawers created: ${res.importedDrawers}`));
          for (const warning of res.warnings.slice(0, 5)) console.log(chalk.yellow(`    warning: ${warning}`));
        }
        console.log();
        return { handled: true };
      }

      console.log(chalk.yellow(`  Unknown /import subcommand: ${sub}`));
      console.log(chalk.dim('  Try: /import help'));
      return { handled: true };
    }

    case '/commit': {
      const prompt = buildCommitPrompt(process.cwd());
      if (!prompt) {
        console.log(chalk.yellow('  No git changes to commit.'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: prompt };
    }

    case '/pr': {
      const prompt = buildPRPrompt(process.cwd());
      if (!prompt) {
        console.log(chalk.yellow('  Not a git repo or no commits to PR.'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: prompt };
    }

    case '/diff':
      printDiff(process.cwd());
      return { handled: true };

    case '/log':
      printLog(process.cwd(), parseInt(args) || 15);
      return { handled: true };

    // ── Code Quality ──────────────────────────────────
    case '/review': {
      const builtin = buildReviewPrompt(process.cwd(), args || undefined);
      const eccPrompt = getEccCommandPrompt('code-review');
      if (!builtin && !eccPrompt) {
        console.log(chalk.yellow('  No changes to review. Specify a target: /review HEAD~3'));
        return { handled: true };
      }
      mode.current = 'review';
      const prompt = eccPrompt
        ? (args.trim() ? `${eccPrompt}\n\n## User Input\n\n${args}` : eccPrompt)
        : builtin!;
      return { handled: false, injectPrompt: prompt };
    }

    case '/tdd':
      if (!args) {
        console.log(chalk.yellow('  Usage: /tdd <feature description>'));
        return { handled: true };
      }
      mode.current = 'tdd';
      return { handled: false, injectPrompt: buildUnifiedPrompt('tdd', args, () => buildTDDPrompt(args)) };

    case '/security-review':
      mode.current = 'review';
      return {
        handled: false,
        injectPrompt: buildUnifiedPrompt('security-review', args, () => buildSecurityReviewPrompt(process.cwd())),
      };

    case '/audit': {
      const report = runAudit(process.cwd());
      printAuditReport(report);
      return { handled: true };
    }

    case '/doctor': {
      const wantsJson = /\bjson\b/i.test(args);
      const includeRegistry = !/\b(?:no-registry|offline)\b/i.test(args);
      const report = buildDoctorReport({ includeRegistry });
      console.log(wantsJson ? JSON.stringify(report, null, 2) : formatDoctorReport(report));
      return { handled: true };
    }

    // ── Tools & Config ────────────────────────────────
    case '/tools':
      console.log(chalk.cyan('\n  Tools:'));
      ALL_TOOLS.forEach((t) => {
        const flags = [t.isReadOnly ? 'R' : 'RW', t.isDestructive ? '!' : ''].filter(Boolean).join('');
        console.log(chalk.white(`  ${t.name.padEnd(14)}`) + chalk.dim(`[${flags.padEnd(3)}] ${t.description.slice(0, 65)}`));
      });
      console.log();
      return { handled: true };

    case '/harness':
    case '/harness-components': {
      const parts = args.split(/\s+/).map((part) => part.trim()).filter(Boolean);
      const wantsJson = parts.some((part, index) =>
        part === '--json'
        || part === 'json'
        || part === 'format=json'
        || part === '--format=json'
        || (part === '--format' && parts[index + 1] === 'json')
      );
      const component = parts.find((part, index) =>
        !part.startsWith('--')
        && part !== 'json'
        && part !== 'format=json'
        && parts[index - 1] !== '--format'
      ) || 'all';
      const report = buildHarnessComponentsReport({
        component,
        format: wantsJson ? 'json' : 'text',
      }, process.cwd());
      console.log(report.output);
      return { handled: true };
    }

    case '/command-audit': {
      const auditArgs = parseCommandAuditArgs(args);
      const report = buildCommandAuditReport(auditArgs);
      console.log(formatCommandAuditReport(report, auditArgs));
      return { handled: true };
    }

    case '/context': {
      const parts = args.split(/\s+/).map((part) => part.trim()).filter(Boolean);
      const sub = (parts.shift() || '').toLowerCase();
      if (!sub || sub === 'brief') {
        const target = parts.join(' ').trim() || process.cwd();
        console.log(buildContextBrief(target));
      } else if (sub === 'dossier') {
        const task = parts.join(' ').trim();
        if (!task) {
          console.log(chalk.yellow('  Usage: /context dossier <task>'));
        } else {
          console.log(buildContextDossier(task, process.cwd()));
        }
      } else {
        console.log(chalk.yellow('  Usage: /context brief [path] | /context dossier <task>'));
      }
      return { handled: true };
    }

    case '/lifespan': {
      const report = buildLifespanReport(messages, config, process.cwd());
      console.log(formatLifespanReport(report, parseLifespanArgs(args)));
      return { handled: true };
    }

    case '/rules':
      printRules();
      return { handled: true };

    case '/agents':
      console.log(formatAgentsInstructionsReport(process.cwd(), config.model, ALL_TOOLS));
      return { handled: true };

    case '/perm':
      if (args.trim().toLowerCase().startsWith('why')) {
        const parts = args.split(/\s+/).filter(Boolean);
        parts.shift();
        const toolName = parts.shift();
        if (!toolName) {
          console.log(chalk.yellow('  Usage: /perm why <tool> [command-or-path]'));
          console.log(chalk.dim('  Examples: /perm why bash git status'));
          console.log(chalk.dim('            /perm why write_file src/example.ts'));
          return { handled: true };
        }
        const tool = ALL_TOOLS.find((candidate) => candidate.name === toolName);
        if (!tool) {
          console.log(chalk.red(`  Unknown tool: ${toolName}`));
          console.log(chalk.dim('  Run /tools to list available tool names.'));
          return { handled: true };
        }
        const rest = parts.join(' ');
        const input: Record<string, unknown> = tool.name === 'bash'
          ? { command: rest }
          : tool.name === 'write_file' || tool.name === 'edit_file' || tool.name === 'read_file'
            ? { file_path: rest }
            : {};
        const explanation = explainPermission(tool, input, config);
        const color = explanation.decision === 'allow'
          ? chalk.green
          : explanation.decision === 'deny'
            ? chalk.red
            : chalk.yellow;
        console.log(chalk.cyan('\n  Permission explanation'));
        console.log(color(`  Decision: ${explanation.decision.toUpperCase()} - ${explanation.reason}`));
        for (const line of explanation.lines) console.log(chalk.dim(`  ${line}`));
        const sandbox = config.sandbox?.level || 'off';
        console.log(chalk.dim(`  sandbox: ${sandbox} (separate from permission prompts)`));
        return { handled: true };
      }
      if (args && ['ask', 'auto', 'yolo'].includes(args)) {
        config.permissionMode = args as GrawkusConfig['permissionMode'];
        saveConfig(config);
        console.log(chalk.green(`  Permissions: ${config.permissionMode}`));
      } else {
        console.log(chalk.dim(`  Current: ${config.permissionMode} (options: ask, auto, yolo)`));
        const allowed = config.alwaysAllowedTools || [];
        if (allowed.length > 0) {
          console.log(chalk.dim(`  Always-allow list: ${allowed.join(', ')}`));
          console.log(chalk.dim(`  Clear with /perm-reset`));
        }
      }
      return { handled: true };

    // Clear the per-tool always-allow list. Useful after typing "always"
    // by accident, or to re-tighten security after a session of work.
    case '/perm-reset': {
      const had = (config.alwaysAllowedTools || []).length;
      config.alwaysAllowedTools = [];
      saveConfig(config);
      console.log(chalk.green(`  Cleared ${had} always-allowed tool(s). Permission prompts re-enabled.`));
      return { handled: true };
    }

    case '/dry-run':
      config.dryRun = !config.dryRun;
      saveConfig(config);
      const dryRunStatus = config.dryRun ? chalk.yellow('ON') : chalk.green('OFF');
      console.log(chalk.green(`  Dry-run mode: ${dryRunStatus}`));
      if (config.dryRun) {
        console.log(chalk.dim('  Tools will show what they would execute without actually running.'));
      }
      return { handled: true };

    case '/thinking': {
      config.showThinking = !config.showThinking;
      saveConfig(config);
      const thinkingStatus = config.showThinking ? chalk.yellow('ON') : chalk.green('OFF');
      console.log(chalk.green(`  Show thinking: ${thinkingStatus}`));
      if (config.showThinking) {
        console.log(chalk.dim('  Model reasoning/chain-of-thought will be displayed when available.'));
        console.log(chalk.dim('  Streams live in a │-bordered panel, then collapses to a one-liner.'));
        console.log(chalk.dim('  Re-expand the most recent thinking block with /think.'));
        console.log(chalk.dim('  Works with DeepSeek, OpenRouter reasoning models, and others.'));
      }
      return { handled: true };
    }

    case '/think': {
      // /think (no args) → re-expand the most recent thinking block
      //   (the one that just collapsed to a one-liner footer)
      // /think on|off    → alias for /thinking (toggles show-thinking)
      //
      // Mental model: /thinking is the *setting* (display reasoning
      // at all? yes/no), /think is the *action* (show me that
      // reasoning again now). Both names appear in the wild — Claude
      // Code uses /think, other CLIs use /thinking — so we support
      // both rather than picking a winner.
      const sub = (args || '').trim().toLowerCase();
      if (sub === 'on' || sub === 'off') {
        const wantOn = sub === 'on';
        if (config.showThinking !== wantOn) {
          config.showThinking = wantOn;
          saveConfig(config);
        }
        console.log(chalk.green(`  Show thinking: ${wantOn ? chalk.yellow('ON') : chalk.green('OFF')}`));
        return { handled: true };
      }
      if (sub === 'toggle' || sub === '') {
        // Empty args → expand last thinking. If there is none yet
        // (no model turn this session has emitted reasoning),
        // surface a helpful hint instead of silently no-op'ing.
        const ok = expandLastThinking();
        if (!ok) {
          console.log(chalk.dim('  No thinking captured yet this session.'));
          if (config.showThinking === false) {
            console.log(chalk.dim('  /thinking is currently OFF — run /thinking to enable.'));
          } else {
            console.log(chalk.dim('  The current model may not emit reasoning tokens.'));
            console.log(chalk.dim('  Try a reasoning model: deepseek-r1, o1-mini, etc.'));
          }
        }
        return { handled: true };
      }
      console.log(chalk.dim('  /think              — re-expand the most recent thinking'));
      console.log(chalk.dim('  /think on | off     — enable/disable thinking display'));
      return { handled: true };
    }

    case '/cd':
      if (args) {
        try {
          process.chdir(args);
          console.log(chalk.green(`  cwd: ${process.cwd()}`));
        } catch (e: unknown) {
          console.log(chalk.red(`  ${e instanceof Error ? e.message : e}`));
        }
      } else {
        console.log(chalk.dim(`  cwd: ${process.cwd()}`));
      }
      return { handled: true };

    case '/hooks': {
      const hooks = listHooks();
      if (hooks.length === 0) {
        console.log(chalk.dim('  No hooks configured. Edit ~/.grawkus/hooks.json'));
      } else {
        console.log(chalk.cyan(`\n  Hooks (${hooks.length}):`));
        hooks.forEach((h, i) => {
          const status = h.enabled === false ? chalk.red('OFF') : chalk.green('ON');
          console.log(chalk.dim(`  ${i}. [${status}] ${h.event} → ${h.match} → ${h.command.slice(0, 50)}`));
        });
      }
      console.log();
      return { handled: true };
    }

    // ── Learning & Cost ───────────────────────────────
    case '/usage':
      printUsageSummary(session.id);
      return { handled: true };

    case '/budget': {
      const [daily, monthly] = args.split(/\s+/).map(Number);
      if (!daily || isNaN(daily)) {
        console.log(chalk.yellow('  Usage: /budget <daily-usd> [monthly-usd]'));
        return { handled: true };
      }
      setBudget(daily, monthly || daily * 30);
      console.log(chalk.green(`  Budget set: $${daily}/day, $${monthly || daily * 30}/month`));
      return { handled: true };
    }

    case '/learn': {
      const patterns = extractPatterns(messages, session.id);
      if (patterns.length === 0) {
        console.log(chalk.dim('  No patterns extracted from this session.'));
      } else {
        console.log(chalk.green(`  Extracted ${patterns.length} patterns:`));
        for (const p of patterns) {
          console.log(chalk.dim(`    [${p.category}] ${p.pattern.slice(0, 80)}`));
        }
      }
      return { handled: true };
    }

    case '/instincts':
      printInstinctStatus();
      return { handled: true };

    case '/prune': {
      const count = pruneExpired();
      console.log(chalk.dim(`  Pruned ${count} expired instincts.`));
      return { handled: true };
    }

    // ── Orchestration ─────────────────────────────────
    case '/orchestrate':
      if (!args) {
        console.log(chalk.yellow('  Usage: /orchestrate <task description>'));
        return { handled: true };
      }
      mode.current = 'architect';
      const orchPrompt = buildOrchestrationPrompt(args);
      return { handled: false, injectPrompt: orchPrompt };

    // ── Agentic swarm ─────────────────────────────────
    // Default: /swarm <natural task>. Grawkus infers roles, runs them
    // analysis-only, then feeds their synthesis back to the main agent
    // for execution. Use --plan-only for the older report-only path.
    // Expert shortcut remains: /swarm <agent1,agent2> <task>.
    case '/swarm': {
      const parsed = parseSwarmCommandArgs(args);
      if ('error' in parsed) {
        console.log(chalk.yellow(`  ${parsed.error}`));
        console.log(chalk.dim('  Example: /swarm Build a working browser game with tests'));
        console.log(chalk.dim('  Plan only: /swarm --plan-only Build a working browser game with tests'));
        console.log(chalk.dim('  Expert:  /swarm code-architect,silent-failure-hunter audit the auth flow'));
        return { handled: true };
      }
      return { handled: true, injectPrompt: encodeSwarmSentinel(parsed.payload) };
    }

    // ── Verification & Build ─────────────────────────
    case '/verify': {
      const prompt = buildVerifyPrompt(process.cwd(), args || undefined);
      return { handled: false, injectPrompt: prompt };
    }

    case '/build-fix': {
      return {
        handled: false,
        injectPrompt: buildUnifiedPrompt('build-fix', args, () => buildBuildFixPrompt(process.cwd(), args || undefined)),
      };
    }

    case '/test-coverage': {
      const prompt = buildCoveragePrompt(process.cwd());
      return { handled: false, injectPrompt: prompt };
    }

    case '/refactor':
    case '/refactor-clean': {
      return {
        handled: false,
        injectPrompt: buildUnifiedPrompt('refactor', args,
          () => args ? buildRefactorPrompt(process.cwd(), args) : buildCleanupPrompt(process.cwd())),
      };
    }

    case '/e2e': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /e2e <feature description>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildE2EPrompt(args, process.cwd()) };
    }

    case '/eval': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /eval <criteria> [target]'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildEvalPrompt(args) };
    }

    case '/benchmark':
    case '/bench':
    case '/leaderboard': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /benchmark [auto|swe-bench|terminal-bench|terminalworld|swe-context|swe-chain|swe-cycle|swe-ci|swe-prbench|tml-bench|pi-bench|ci-repair|wildclaw|arc-agi|specbench|reward-hacking|roadmapbench|saasbench|swe-bench-mobile|appworld|browsecomp|tau2|generic] <task>'));
        return { handled: true };
      }
      const { profile, task } = splitBenchmarkArgs(args);
      if (!task) {
        console.log(chalk.yellow('  Usage: /benchmark [auto|swe-bench|terminal-bench|terminalworld|swe-context|swe-chain|swe-cycle|swe-ci|swe-prbench|tml-bench|pi-bench|ci-repair|wildclaw|arc-agi|specbench|reward-hacking|roadmapbench|saasbench|swe-bench-mobile|appworld|browsecomp|tau2|generic] <task>'));
        return { handled: true };
      }
      mode.current = 'benchmark';
      return { handled: false, injectPrompt: buildBenchmarkPrompt(task, process.cwd(), profile) };
    }

    case '/plan': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /plan <task description>'));
        return { handled: true };
      }
      mode.current = 'plan';
      return {
        handled: false,
        injectPrompt: buildUnifiedPrompt('plan', args, () => buildPlanPrompt(args, process.cwd())),
      };
    }

    case '/update-docs': {
      return { handled: false, injectPrompt: buildDocsUpdatePrompt(process.cwd()) };
    }

    // ── Checkpoints ──────────────────────────────────
    case '/checkpoint': {
      const cp = saveCheckpoint(session.id, process.cwd(), args || undefined);
      console.log(chalk.green(`  Checkpoint saved: ${cp.id} ${cp.label ? `"${cp.label}"` : ''}`));
      console.log(chalk.dim(`  Git SHA: ${cp.headSha?.slice(0, 8) || 'N/A'}`));
      return { handled: true };
    }

    case '/checkpoints': {
      const cps = listCheckpoints(session.id);
      if (cps.length === 0) {
        console.log(chalk.dim('  No checkpoints for this session.'));
      } else {
        console.log(chalk.cyan(`\n  Checkpoints (${cps.length}):`));
        for (const cp of cps) {
          console.log(chalk.white(`  ${cp.id.slice(0, 12).padEnd(14)}`) +
            chalk.dim(`${(cp.label || 'unnamed').padEnd(20)} ${cp.headSha?.slice(0, 8) || 'N/A'}  ${cp.timestamp.slice(0, 19)}`));
        }
      }
      console.log();
      return { handled: true };
    }

    case '/manifest': {
      console.log(buildAheManifest(parseAheManifestArgs(args)));
      return { handled: true };
    }

    // ── Instinct Management ──────────────────────────
    case '/instinct-export': {
      const json = exportInstincts();
      const exportPath = `${process.cwd()}/instincts-export-${Date.now()}.json`;
      fsWriteFileSync(exportPath, json, 'utf-8');
      console.log(chalk.green(`  Instincts exported to: ${exportPath}`));
      return { handled: true };
    }

    case '/instinct-import': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /instinct-import <path-to-json>'));
        return { handled: true };
      }
      try {
        const json = fsReadFileSync(args.trim(), 'utf-8');
        const count = importInstincts(json);
        console.log(chalk.green(`  Imported ${count} instincts.`));
      } catch (e: unknown) {
        console.log(chalk.red(`  Error: ${e instanceof Error ? e.message : e}`));
      }
      return { handled: true };
    }

    case '/evolve': {
      const instincts = listInstincts();
      if (instincts.length < 3) {
        console.log(chalk.yellow('  Need at least 3 instincts to evolve into skills.'));
        return { handled: true };
      }
      const skills = evolveInstinctsToSkills(instincts);
      if (skills.length === 0) {
        console.log(chalk.dim('  No skill clusters found. Keep learning!'));
      } else {
        console.log(chalk.green(`  Evolved ${skills.length} skills from ${instincts.length} instincts:`));
        for (const s of skills) {
          console.log(chalk.dim(`    [${s.category}] ${s.name}: ${s.description.slice(0, 60)}`));
        }
      }
      return { handled: true };
    }

    case '/skills':
      printSkillList();
      return { handled: true };

    // /skill-show <name>  — print the full skill prompt text. Used to
    // inspect what an auto-matched ECC skill would inject, or to learn
    // why /tdd or /review produced a particular shape of response. The
    // bundled ECC corpus has 228 skills as of v1.11 — most users won't
    // know they exist unless they can browse them.
    // /curate — manual skill-registry curation pass. Report-only;
    // surfaces duplicate names, high-overlap pairs, stale single-use,
    // and never-invoked skills > 60 days old. User decides what to do.
    case '/curate': {
      const report = runCurator();
      console.log(chalk.cyan(`\n  Curator scan — ${report.totalSkills} skills checked, ${report.findings.length} finding(s)`));
      if (report.findings.length === 0) {
        console.log(chalk.dim('  No issues. Registry is clean.\n'));
        return { handled: true };
      }
      // Group by recommendation
      const groups: Record<string, typeof report.findings> = {};
      for (const f of report.findings) {
        (groups[f.recommendation] = groups[f.recommendation] || []).push(f);
      }
      for (const [rec, items] of Object.entries(groups)) {
        console.log(chalk.bold(`\n  ${rec.toUpperCase()} (${items.length}):`));
        for (const f of items.slice(0, 20)) {
          console.log(chalk.dim(`    [${f.kind}] ${f.primary}${f.secondary ? ' ↔ ' + f.secondary : ''}`));
          console.log(chalk.dim(`      ${f.reason}`));
        }
        if (items.length > 20) console.log(chalk.dim(`    … and ${items.length - 20} more`));
      }
      console.log(chalk.dim('\n  Act on findings with /prune (instincts) or by editing ~/.grawkus/skills/.\n'));
      return { handled: true };
    }

    // ── ECC agent shortcuts (5 commands, ECC audit item 4) ─────
    // The ECC v2 bundle ships agents with focused single-purpose prompts:
    //   silent-failure-hunter — finds empty catch, log-and-forget, etc.
    //   code-explorer         — codebase reconnaissance pass
    //   type-design-analyzer  — type-system + API shape critique
    //   code-architect        — structural critique + refactor plan
    //   code-simplifier       — find + collapse incidental complexity
    //
    // None of our 9 modes cover these niches. Each command takes an
    // optional task arg, looks up the ECC agent skill by slug, and
    // injects its prompt + the user's task as the next user message.
    case '/hunt-silent':
    case '/explore':
    case '/types':
    case '/architect':
    case '/simplify': {
      // Map slash command → ECC agent slug
      const agentMap: Record<string, string> = {
        '/hunt-silent': 'silent-failure-hunter',
        '/explore': 'code-explorer',
        '/types': 'type-design-analyzer',
        '/architect': 'code-architect',
        '/simplify': 'code-simplifier',
      };
      const agentSlug = agentMap[cmd];
      const targetName = `agent: ${agentSlug}`.toLowerCase();
      const skill = listSkills().find((s) => s.name.toLowerCase() === targetName);
      if (!skill) {
        console.log(chalk.yellow(`  The "${agentSlug}" agent isn't in your bundle.`));
        console.log(chalk.dim(`  Run /reset-hooks (forces ECC re-import) or upgrade Grawkus.`));
        return { handled: true };
      }
      // Prefix with the agent prompt, then the user's task. The agent
      // prompts are self-contained — they explain their role + expected
      // format — so the model picks up the right persona for this turn.
      const task = args.trim();
      const prompt = task
        ? `${skill.prompt}\n\n## Task\n\n${task}`
        : `${skill.prompt}\n\nWait for the user to describe what they want analyzed.`;
      return { handled: false, injectPrompt: prompt };
    }

    // /ecc-guide — navigable browser of the bundled ECC corpus. With 228
    // skills + 60 agents + 81 commands available, users need a way to
    // see what's there before they go fishing with /skill-show or /skills.
    // Pure stdout — no LLM call. Sections + counts, with sample names.
    case '/ecc-guide': {
      const skills = listSkills();
      const eccSkills = skills.filter((s) => s.id.startsWith('ecc-') && !s.id.startsWith('ecc-agent-'));
      const eccAgents = skills.filter((s) => s.id.startsWith('ecc-agent-'));
      const learned = skills.filter((s) => !s.id.startsWith('ecc-'));
      const sub = args.trim().toLowerCase();

      if (!sub) {
        console.log(chalk.cyan('\n  ECC Guide — the bundled corpus'));
        console.log(chalk.dim('  Use the sub-commands below to drill into a section.\n'));
        console.log(chalk.bold(`  Skills (${eccSkills.length})`));
        console.log(chalk.dim(`    /ecc-guide skills [category]   — list ECC skills (optionally filtered)`));
        console.log(chalk.dim(`    /skill-show <name>             — full prompt text of any skill`));
        const cats = new Set(eccSkills.map((s) => s.category));
        console.log(chalk.dim(`    Categories: ${[...cats].sort().slice(0, 8).join(', ')}${cats.size > 8 ? ', …' : ''}`));
        console.log('');
        console.log(chalk.bold(`  Agents (${eccAgents.length})`));
        console.log(chalk.dim(`    /ecc-guide agents              — list ECC sub-agents`));
        console.log('');
        console.log(chalk.bold(`  Commands (${listEccCommands().length})`));
        console.log(chalk.dim(`    /ecc-guide commands            — list ECC commands available as /ecc-* slash`));
        console.log('');
        console.log(chalk.bold(`  Hooks`));
        console.log(chalk.dim(`    /hooks                         — currently configured hooks`));
        console.log(chalk.dim(`    /reset-hooks                   — wipe + re-seed from this install`));
        console.log('');
        if (learned.length > 0) {
          console.log(chalk.bold(`  Learned skills (this user, ${learned.length})`));
          console.log(chalk.dim(`    /skills                        — registry of skills learned via /learn`));
          console.log(chalk.dim(`    /curate                        — scan for duplicates / stale items`));
        }
        console.log();
        return { handled: true };
      }

      if (sub === 'skills' || sub.startsWith('skills ')) {
        const catFilter = sub.startsWith('skills ') ? sub.slice('skills '.length).trim() : '';
        let filtered = eccSkills;
        if (catFilter) filtered = filtered.filter((s) => s.category.toLowerCase().includes(catFilter));
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        console.log(chalk.cyan(`\n  ECC skills (${filtered.length}${catFilter ? ` matching "${catFilter}"` : ''}):`));
        for (const s of filtered.slice(0, 100)) {
          const desc = s.description.length > 75 ? s.description.slice(0, 72) + '…' : s.description;
          console.log(chalk.dim(`    ${s.name.padEnd(32)} ${desc}`));
        }
        if (filtered.length > 100) console.log(chalk.dim(`    … and ${filtered.length - 100} more`));
        console.log(chalk.dim(`\n  /skill-show <name> for full prompt text\n`));
        return { handled: true };
      }
      if (sub === 'agents') {
        const sorted = [...eccAgents].sort((a, b) => a.name.localeCompare(b.name));
        console.log(chalk.cyan(`\n  ECC sub-agents (${sorted.length}):`));
        for (const a of sorted) {
          const desc = a.description.length > 75 ? a.description.slice(0, 72) + '…' : a.description;
          console.log(chalk.dim(`    ${a.name.padEnd(32)} ${desc}`));
        }
        console.log();
        return { handled: true };
      }
      if (sub === 'commands') {
        const cmds = listEccCommands().sort();
        console.log(chalk.cyan(`\n  ECC commands (${cmds.length}):`));
        for (const c of cmds) console.log(chalk.dim(`    /ecc-${c}`));
        console.log();
        return { handled: true };
      }
      console.log(chalk.yellow(`  Unknown /ecc-guide section: ${sub}`));
      console.log(chalk.dim('  Try: skills [category], agents, commands'));
      return { handled: true };
    }

    case '/skill-show': {
      const name = args.trim();
      if (!name) {
        console.log(chalk.yellow('  Usage: /skill-show <skill-name>'));
        console.log(chalk.dim('  Run /skills to list available skills.'));
        return { handled: true };
      }
      const target = name.toLowerCase();
      // Try exact name match first, then fall back to substring match.
      const all = listSkills();
      let hit = all.find((s) => s.name.toLowerCase() === target);
      if (!hit) hit = all.find((s) => s.name.toLowerCase().includes(target));
      if (!hit) {
        console.log(chalk.yellow(`  No skill matches "${name}".`));
        const close = all.filter((s) => s.name.toLowerCase().includes(target.slice(0, 4))).slice(0, 5);
        if (close.length > 0) {
          console.log(chalk.dim('  Did you mean: ') + close.map((s) => s.name).join(', '));
        }
        return { handled: true };
      }
      console.log(chalk.cyan(`\n  Skill: ${hit.name}`));
      console.log(chalk.dim(`  Category: ${hit.category}  ·  Triggers: ${hit.triggers.slice(0, 6).join(', ')}${hit.triggers.length > 6 ? '…' : ''}`));
      console.log(chalk.dim(`  Description: ${hit.description}\n`));
      console.log(hit.prompt);
      console.log();
      return { handled: true };
    }

    // /memory <sub> — MemPalace inventory & inspection.
    //   /memory               status + counts (legacy + new combined)
    //   /memory wings         list wings in both stores
    //   /memory rooms <wing>  rooms within a wing
    //   /memory ls <w> <r>    drawers in a wing/room
    //   /memory search <q>    text search (same backend as memory_search tool)
    //   /memory get <id>      full content of a single drawer
    //   /memory rm <id>       delete a drawer (cascades tunnels + triples)
    //   /memory stats         storage + counts per scope
    case '/memory': {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || '').toLowerCase();
      try {
        // Enable / disable — affects whether the memory_* tools are
        // registered for the model on next REPL boot. Existing data is
        // preserved either way; toggling never deletes anything.
        if (sub === 'enable' || sub === 'on') {
          config.memory = { ...(config.memory || {}), enabled: true };
          saveConfig(config);
          console.log(chalk.green('  MemPalace: ENABLED.'));
          console.log(chalk.dim('  Restart the REPL for the memory_* tools to appear in the agent\'s registry.'));
          return { handled: true };
        }
        if (sub === 'disable' || sub === 'off') {
          config.memory = { ...(config.memory || {}), enabled: false };
          saveConfig(config);
          console.log(chalk.green('  MemPalace: disabled.'));
          console.log(chalk.dim('  Existing drawers/tunnels/triples preserved. Restart the REPL to remove memory_* tools from the agent.'));
          return { handled: true };
        }

        const enabled = config.memory?.enabled !== false;

        if (!sub || sub === 'status' || sub === 'stats') {
          const s = mempalace.stats(process.cwd());
          console.log(chalk.cyan('\n  MemPalace status'));
          console.log(chalk.dim(`    enabled: ${enabled ? '✓ yes' : '✗ no (toggle with /memory enable)'}`));
          console.log(chalk.dim(`    global  ${s.globalPath}`));
          console.log(chalk.dim(`      ${s.global.drawers} drawer(s) · ${s.global.wings} wing(s) · ${s.global.rooms} room(s) · ${s.global.tunnels} tunnel(s) · ${s.global.triples} fact(s)`));
          console.log(chalk.dim(`    project ${s.projectPath}${s.projectExists ? '' : '  (not yet created)'}`));
          console.log(chalk.dim(`      ${s.project.drawers} drawer(s) · ${s.project.wings} wing(s) · ${s.project.rooms} room(s) · ${s.project.tunnels} tunnel(s) · ${s.project.triples} fact(s)`));
          console.log();
          printMemoryStatus();
          return { handled: true };
        }
        if (sub === 'wings') {
          const w = mempalace.listWings(process.cwd());
          console.log(chalk.cyan('\n  Wings:'));
          if (w.global.length === 0 && w.project.length === 0) {
            console.log(chalk.dim('    (none yet — agent will create wings as it learns)'));
          }
          for (const wm of w.global) console.log(chalk.dim(`    global · ${wm.name.padEnd(20)} ${wm.drawerCount} drawer(s)`));
          for (const wm of w.project) console.log(chalk.dim(`    project · ${wm.name.padEnd(19)} ${wm.drawerCount} drawer(s)`));
          console.log();
          return { handled: true };
        }
        if (sub === 'rooms') {
          const r = mempalace.listRooms(process.cwd(), parts[1]);
          const all = [...r.global.map((m) => ({ ...m, s: 'global' })), ...r.project.map((m) => ({ ...m, s: 'project' }))];
          if (all.length === 0) { console.log(chalk.dim(`  No rooms${parts[1] ? ' in wing ' + parts[1] : ''}.`)); return { handled: true }; }
          console.log(chalk.cyan(`\n  Rooms${parts[1] ? ' in ' + parts[1] : ''}:`));
          for (const m of all) console.log(chalk.dim(`    ${m.s.padEnd(7)} ${m.wing}/${m.name}  — ${m.drawerCount} drawer(s), last ${m.lastTouched.slice(0, 10)}`));
          console.log();
          return { handled: true };
        }
        if (sub === 'ls' || sub === 'list') {
          const drawers = mempalace.listDrawers({ wing: parts[1], room: parts[2], cwd: process.cwd() });
          if (drawers.length === 0) { console.log(chalk.dim('  No drawers match.')); return { handled: true }; }
          console.log(chalk.cyan(`\n  Drawers (${drawers.length}):`));
          for (const d of drawers.slice(0, 50)) {
            const excerpt = d.content.length > 90 ? d.content.slice(0, 90) + '…' : d.content;
            console.log(chalk.dim(`    ${d.id} (${d.scope}) ${d.wing}/${d.room}: `) + chalk.white(excerpt));
          }
          if (drawers.length > 50) console.log(chalk.dim(`    … and ${drawers.length - 50} more`));
          console.log();
          return { handled: true };
        }
        if (sub === 'search') {
          const q = parts.slice(1).join(' ');
          if (!q) { console.log(chalk.yellow('  Usage: /memory search <query>')); return { handled: true }; }
          const hits = mempalace.search(q, process.cwd(), { limit: 10 });
          if (hits.length === 0) { console.log(chalk.dim(`  No matches for "${q}".`)); return { handled: true }; }
          console.log(chalk.cyan(`\n  ${hits.length} match(es) for "${q}":`));
          for (const h of hits) {
            const excerpt = h.drawer.content.length > 200 ? h.drawer.content.slice(0, 200) + '…' : h.drawer.content;
            const tagStr = h.drawer.tags.length > 0 ? ` [${h.drawer.tags.join(', ')}]` : '';
            console.log(chalk.dim(`    ${h.drawer.id} (${h.drawer.scope} · ${h.drawer.wing}/${h.drawer.room}${tagStr}) score ${h.score.toFixed(2)}`));
            console.log(chalk.white(`      ${excerpt}`));
          }
          console.log();
          return { handled: true };
        }
        if (sub === 'get' || sub === 'recall') {
          const id = parts[1];
          if (!id) { console.log(chalk.yellow('  Usage: /memory get <drawer-id>')); return { handled: true }; }
          const d = mempalace.getDrawer(id, process.cwd());
          if (!d) { console.log(chalk.yellow(`  No drawer ${id}.`)); return { handled: true }; }
          const tagStr = d.tags.length > 0 ? ` [${d.tags.join(', ')}]` : '';
          console.log(chalk.cyan(`\n  ${d.id} (${d.scope} · ${d.wing}/${d.room}${tagStr})`));
          console.log(chalk.dim(`  importance ${d.importance} · created ${d.createdAt} · updated ${d.updatedAt}\n`));
          console.log(d.content);
          console.log();
          return { handled: true };
        }
        if (sub === 'rm' || sub === 'delete') {
          const id = parts[1];
          if (!id) { console.log(chalk.yellow('  Usage: /memory rm <drawer-id>')); return { handled: true }; }
          // Try both stores; whichever owns it returns true
          const removed = mempalace.getGlobalStore().deleteDrawer(id)
            || mempalace.getProjectStore(process.cwd()).deleteDrawer(id);
          console.log(removed ? chalk.green(`  Deleted drawer ${id} (cascaded tunnels + triples).`) : chalk.yellow(`  No drawer ${id}.`));
          return { handled: true };
        }
        console.log(chalk.yellow(`  Unknown /memory subcommand: ${sub}`));
        console.log(chalk.dim('  Try: /memory (status), wings, rooms <wing>, ls <wing> <room>, search <q>, get <id>, rm <id>'));
        return { handled: true };
      } catch (e) {
        console.log(chalk.red(`  /memory failed: ${e instanceof Error ? e.message : e}`));
        return { handled: true };
      }
    }

    // ── Users Table ──────────────────────────────────────
    case '/users': {
      const sub = args.trim();
      if (sub === 'ls' || sub === 'list' || !sub) {
        printUserList();
        return { handled: true };
      }

      const parts = sub.split(/\s+/);
      const action = parts[0];

      if (action === 'add') {
        const name = parts[1] || '';
        if (!name) {
          console.log(chalk.yellow('  Usage: /users add <name> [email] [role]'));
          return { handled: true };
        }
        const email = parts[2] || '';
        const role = parts[3] || '';
        const user = createUser(name, email || undefined, role || undefined);
        console.log(chalk.green(`  User created: ${user.id} — ${user.name}`));
        return { handled: true };
      }

      if (action === 'rm' || action === 'del' || action === 'delete') {
        const id = parts[1];
        if (!id) {
          console.log(chalk.yellow('  Usage: /users rm <id>'));
          return { handled: true };
        }
        if (deleteUser(id)) {
          console.log(chalk.green(`  User deleted: ${id}`));
        } else {
          console.log(chalk.yellow(`  User not found: ${id}`));
        }
        return { handled: true };
      }

      if (action === 'set' || action === 'activate') {
        const id = parts[1];
        if (!id) {
          console.log(chalk.yellow('  Usage: /users set <id>'));
          return { handled: true };
        }
        const user = setActiveUser(id);
        if (user) {
          console.log(chalk.green(`  Active user: ${user.name} (${user.id})`));
        } else {
          console.log(chalk.yellow(`  User not found: ${id}`));
        }
        return { handled: true };
      }

      if (action === 'meta' || action === 'metadata') {
        const id = parts[1];
        const key = parts[2];
        const value = parts.slice(3).join(' ');
        if (!id || !key) {
          console.log(chalk.yellow('  Usage: /users meta <id> <key> [value]'));
          return { handled: true };
        }
        if (value) {
          setUserMetadata(id, key, value);
          console.log(chalk.green(`  Metadata set: ${key}=${value}`));
        } else {
          const val = getUserMetadata(id, key);
          console.log(chalk.dim(`  ${key}: ${val || '(not set)'}`));
        }
        return { handled: true };
      }

      // Unknown subcommand
      console.log(chalk.yellow('  Usage: /users [ls|add|rm|set|meta] ...'));
      console.log(chalk.dim('  ls              — list all users'));
      console.log(chalk.dim('  add <name> [email] [role] — create user'));
      console.log(chalk.dim('  rm <id>         — delete user'));
      console.log(chalk.dim('  set <id>        — set active user'));
      console.log(chalk.dim('  meta <id> <key> [value] — get/set metadata'));
      return { handled: true };
    }

    // ── Counter ─────────────────────────────────────────
    case '/count': {
      const subCmd = args.trim();
      if (subCmd === 'inc' || subCmd === '+') {
        incrementCounter();
        console.log(chalk.green(`  Counter: ${getCounter()}`));
      } else if (subCmd === 'dec' || subCmd === '-') {
        decrementCounter();
        console.log(chalk.green(`  Counter: ${getCounter()}`));
      } else if (subCmd === 'reset') {
        resetCounter();
        console.log(chalk.green(`  Counter reset to 0`));
      } else if (subCmd === 'help') {
        console.log(chalk.dim('  Usage: /count [inc|dec|reset|help]'));
        console.log(chalk.dim('  inc (+)  — increment counter'));
        console.log(chalk.dim('  dec (-)  — decrement counter'));
        console.log(chalk.dim('  reset    — reset counter to 0'));
        console.log(chalk.dim('  help     — show this help'));
      } else {
        console.log(chalk.green(`  Counter: ${getCounter()}`));
        console.log(chalk.dim('  Use /count inc|dec|reset|help'));
      }
      return { handled: true };
    }

    // ── Language-Specific Reviews ───────────────────
    case '/ts-review':
      return { handled: false, injectPrompt: buildTSReviewPrompt(process.cwd(), args || undefined) };

    case '/py-review':
      return { handled: false, injectPrompt: buildPyReviewPrompt(process.cwd(), args || undefined) };

    case '/go-review':
      return { handled: false, injectPrompt: buildGoReviewPrompt(process.cwd(), args || undefined) };

    case '/rust-review':
      return { handled: false, injectPrompt: buildRustReviewPrompt(process.cwd(), args || undefined) };

    case '/java-review':
      return { handled: false, injectPrompt: buildJavaReviewPrompt(process.cwd(), args || undefined) };

    case '/cpp-review':
      return { handled: false, injectPrompt: buildCppReviewPrompt(process.cwd(), args || undefined) };

    case '/kotlin-review':
      return { handled: false, injectPrompt: buildKotlinReviewPrompt(process.cwd(), args || undefined) };

    case '/php-review':
      return { handled: false, injectPrompt: buildPhpReviewPrompt(process.cwd(), args || undefined) };

    case '/db-review':
      return { handled: false, injectPrompt: buildDbReviewPrompt(process.cwd(), args || undefined) };

    case '/auto-review':
      return { handled: false, injectPrompt: buildAutoReviewPrompt(process.cwd(), args || undefined) };

    // ── Language-Specific Build Fixes ────────────────
    case '/ts-build-fix':
      return { handled: false, injectPrompt: buildTSBuildFixPrompt(process.cwd(), args || undefined) };

    case '/go-build-fix':
      return { handled: false, injectPrompt: buildGoBuildFixPrompt(process.cwd(), args || undefined) };

    case '/rust-build-fix':
      return { handled: false, injectPrompt: buildRustBuildFixPrompt(process.cwd(), args || undefined) };

    case '/java-build-fix':
      return { handled: false, injectPrompt: buildJavaBuildFixPrompt(process.cwd(), args || undefined) };

    case '/cpp-build-fix':
      return { handled: false, injectPrompt: buildCppBuildFixPrompt(process.cwd(), args || undefined) };

    case '/pytorch-fix':
      return { handled: false, injectPrompt: buildPyTorchBuildFixPrompt(process.cwd(), args || undefined) };

    // ── Autonomous Loops & DAG ───────────────────────
    case '/pr-loop':
      return { handled: false, injectPrompt: buildPRLoopPrompt(process.cwd()) };

    case '/multi-plan': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /multi-plan <task description>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildMultiPlanPrompt(args) };
    }

    case '/multi-execute': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /multi-execute <plan>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildMultiExecutePrompt(args) };
    }

    case '/multi-backend': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /multi-backend <service1,service2,...>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildMultiBackendPrompt(args.split(',').map(s => s.trim())) };
    }

    case '/multi-frontend': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /multi-frontend <component1,component2,...>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildMultiFrontendPrompt(args.split(',').map(s => s.trim())) };
    }

    // ── Search-First Research ────────────────────────
    case '/search-first': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /search-first <task description>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildSearchFirstPrompt(args, process.cwd()) };
    }

    case '/docs-lookup': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /docs-lookup <query>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildDocsLookupPrompt(args, process.cwd()) };
    }

    case '/sources':
    case '/source-scan': {
      const parsed = parseSourceCommandArgs(args);
      if (parsed.error || !parsed.input) {
        console.log(chalk.yellow(parsed.error ? `  /sources: ${parsed.error}` : '  /sources: invalid arguments'));
        console.log(chalk.dim(formatSourceCommandUsage()));
        return { handled: true };
      }
      return { handled: true, injectPrompt: encodeSourcesSentinel(parsed.input) };
    }

    case '/benchmark-repos':
    case '/bench-repos':
    case '/leaderboard-repos':
    case '/tb-repos': {
      const parsed = parseBenchmarkRepoCatalogCommandArgs(args);
      if (parsed.error || !parsed.input) {
        console.log(chalk.yellow(parsed.error ? `  /benchmark-repos: ${parsed.error}` : '  /benchmark-repos: invalid arguments'));
        console.log(chalk.dim(formatBenchmarkRepoCatalogUsage()));
        return { handled: true };
      }
      return { handled: true, injectPrompt: encodeBenchmarkReposSentinel(parsed.input) };
    }

    case '/repo-digest':
    case '/repo-inspect':
    case '/github-digest': {
      const parsed = parseRepoDigestCommandArgs(args);
      if (parsed.error || !parsed.input) {
        console.log(chalk.yellow(parsed.error ? `  /repo-digest: ${parsed.error}` : '  /repo-digest: invalid arguments'));
        console.log(chalk.dim(formatRepoDigestCommandUsage()));
        return { handled: true };
      }
      return { handled: true, injectPrompt: encodeRepoDigestSentinel(parsed.input) };
    }

    case '/source-research':
    case '/research-sources': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /source-research <topic>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildSourceResearchPrompt(args) };
    }

    // ── Codemaps ─────────────────────────────────────
    case '/codemaps':
    case '/codemap': {
      printCodemapStatus(process.cwd());
      return { handled: true };
    }

    case '/update-codemaps': {
      const map = generateCodeMap(process.cwd());
      saveCodeMap(process.cwd(), map);
      printCodeMap(map);
      console.log(chalk.green('  Codemap updated and saved.'));
      return { handled: true };
    }

    // ── Skill Creation from Git ──────────────────────
    case '/skill-create': {
      return { handled: false, injectPrompt: buildSkillCreatePrompt(process.cwd(), args || undefined) };
    }

    case '/git-patterns': {
      const patterns = analyzeGitPatterns(process.cwd());
      if (patterns.length === 0) {
        console.log(chalk.dim('  No git patterns found. Need a git repo with commit history.'));
      } else {
        printGitPatterns(patterns);
      }
      return { handled: true };
    }

    case '/git-workflow': {
      printGitWorkflowSummary(process.cwd());
      return { handled: true };
    }

    // ── Content Engine ───────────────────────────────
    case '/article': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /article <topic> [--audience <who>] [--tone <tone>]'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildArticlePrompt(args) };
    }

    case '/slides': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /slides <topic> [count]'));
        return { handled: true };
      }
      const slideParts = args.match(/^(.+?)\s+(\d+)$/);
      const slideTopic = slideParts ? slideParts[1] : args;
      const slideCount = slideParts ? parseInt(slideParts[2], 10) : 10;
      return { handled: false, injectPrompt: buildSlidePrompt(slideTopic, slideCount) };
    }

    case '/repurpose': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /repurpose <content description>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildContentRepurposePrompt(args, ['twitter', 'linkedin', 'blog']) };
    }

    case '/market-research': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /market-research <market/topic>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildMarketResearchPrompt(args) };
    }

    case '/investor-deck': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /investor-deck <company description>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildInvestorDeckPrompt(args) };
    }

    case '/investor-outreach': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /investor-outreach <company description>'));
        return { handled: true };
      }
      const outreachParts = args.split('--investor').map(s => s.trim());
      const companyDesc = outreachParts[0] || args;
      const investorName = outreachParts[1] || 'target investor';
      return { handled: false, injectPrompt: buildInvestorOutreachPrompt(investorName, companyDesc) };
    }

    case '/code-quality':
      return { handled: false, injectPrompt: buildCodeQualityPrompt(process.cwd()) };

    case '/skill-stocktake':
      return { handled: false, injectPrompt: buildSkillStocktakePrompt() };

    case '/chief-of-staff': {
      if (!args) {
        console.log(chalk.yellow('  Usage: /chief-of-staff <context/priorities>'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildChiefOfStaffPrompt(args) };
    }

    // ── Hook Controls ────────────────────────────────
    case '/hook-profile':
      printHookControlStatus();
      return { handled: true };

    // ── PM2 Service Management ───────────────────────
    case '/pm2': {
      if (!isPM2Available()) {
        console.log(chalk.yellow('  PM2 not installed. Run: npm install -g pm2'));
        return { handled: true };
      }
      if (!args) {
        console.log(listPM2Services(process.cwd()));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildPM2Prompt(args) };
    }

    // ── Detection ────────────────────────────────────
    case '/detect': {
      const pm = detectPackageManager(process.cwd());
      const tr = detectTestRunner(process.cwd());
      const bt = detectBuildTool(process.cwd());
      console.log(chalk.cyan('\n  Project Detection:'));
      console.log(chalk.dim(`  Package Manager: ${pm.name} (${pm.command})`));
      console.log(chalk.dim(`  Test Runner:     ${tr.name} (${tr.command})`));
      console.log(chalk.dim(`  Build Tool:      ${bt.name} (${bt.command})`));
      console.log();
      return { handled: true };
    }

    // ── Export ────────────────────────────────────────
    case '/export': {
      if (!messages.length) {
        console.log(chalk.yellow('  No conversation to export.'));
        return { handled: true };
      }

      const format: ExportFormat = (args.trim() as ExportFormat) || 'md';
      if (!['md', 'json', 'txt'].includes(format)) {
        console.log(chalk.yellow(`  Unknown format: ${format}. Use: md, json, or txt`));
        return { handled: true };
      }

      const filepath = saveExport(messages, format);
      console.log(chalk.green(`  Exported to: ${filepath}`));
      return { handled: true };
    }

    // ── Walkthrough / guided tour ─────────────────────
    case '/walkthrough':
    case '/tour':
    case '/guide':
      return { handled: false, injectPrompt: buildWalkthroughPrompt() };

    // ── Stitch (Google AI UI/UX design tool) ──────────
    // `/stitch`            → status + tip
    // `/stitch tools`      → live tools/list against the server
    // `/stitch <free-text>` → intent-routed assistant (enhance/generate/list)
    case '/stitch':
    case '/stitch-status':
      if (cmd === '/stitch-status' || !args.trim()) {
        printStitchStatus();
        return { handled: true };
      }
      if (args.trim().toLowerCase() === 'tools' || args.trim().toLowerCase() === '--tools') {
        if (!stitchConfigured()) {
          console.log(chalk.yellow('  Stitch is not configured. Run /stitch-config <api-key>'));
          return { handled: true };
        }
        return { handled: false, injectPrompt: buildStitchToolsPrompt() };
      }
      if (!stitchConfigured()) {
        console.log(chalk.yellow('  Stitch is not configured.'));
        console.log(chalk.dim('  Run: /stitch-config <api-key>  (or set STITCH_API_KEY)'));
        console.log(chalk.dim('  Get a key: https://stitch.withgoogle.com/ → Stitch Settings → API Keys'));
        return { handled: true };
      }
      return { handled: false, injectPrompt: buildStitchPrompt(args) };

    case '/stitch-config': {
      // Sanitize the input. Users routinely paste keys with the
      // angle-bracket placeholder wrappers from documentation
      // (`<KEY>`), with surrounding quotes from a shell escape, or
      // with whitespace from clipboard managers. Without this
      // stripping the key gets stored literally (e.g. "<AQ.…>") and
      // every subsequent Stitch call fails auth — a real failure
      // mode that wasted hours in user testing.
      let key = args.trim();
      // Strip a paired wrap: <...>, "...", '...', `...`, [...], (...)
      const wraps: Array<[string, string]> = [
        ['<', '>'], ['"', '"'], ["'", "'"], ['`', '`'], ['[', ']'], ['(', ')'],
      ];
      for (const [open, close] of wraps) {
        if (key.startsWith(open) && key.endsWith(close) && key.length > 2) {
          key = key.slice(1, -1).trim();
          break;
        }
      }
      if (!key) {
        console.log(chalk.yellow('  Usage: /stitch-config <api-key>'));
        console.log(chalk.dim('  Get a key from https://stitch.withgoogle.com/ → Stitch Settings → API Keys'));
        console.log(chalk.dim('  Paste the key alone, not wrapped in angle brackets or quotes.'));
        return { handled: true };
      }
      // Shape sanity-check. Stitch API keys start with "AQ." per the
      // Google API-key convention. Warn if the shape looks wrong,
      // but still save — we don't want to false-reject a future
      // format change.
      if (!/^AQ\./i.test(key)) {
        console.log(chalk.yellow('  Warning: this key doesn\'t look like a Stitch API key (expected to start with "AQ.").'));
        console.log(chalk.dim('  Saved anyway. If Stitch calls fail with auth errors, double-check what you pasted.'));
      }
      saveStitchConfig(key);
      console.log(chalk.green(`  Stitch API key saved to ~/.grawkus/stitch.json`));
      // The stitch tool is only added to ALL_TOOLS at module-load
      // time (when src/tools/index.ts is first imported). Mid-session
      // configuration won't make it appear until the user restarts.
      // Make the restart requirement IMPOSSIBLE to miss — previous
      // versions buried this in dim text and the model wasted turns
      // hallucinating MCP endpoints when the tool was missing.
      console.log('');
      console.log(chalk.yellow.bold('  ⚠  RESTART REQUIRED'));
      console.log(chalk.yellow('     The `stitch` tool is registered only at REPL launch. Type /exit'));
      console.log(chalk.yellow('     and re-run grawkus to make it available to the agent.'));
      console.log(chalk.dim('     Until then, /design and Stitch-related requests will see the model'));
      console.log(chalk.dim('     fall back to hand-coded HTML/CSS instead of using Stitch.'));
      return { handled: true };
    }


    // ── API key pool (multi-account rotation) ────────────────
    //   /keys                show pool with health + stats
    //   /keys add <key>      append to the rotation pool
    //   /keys remove <key>   remove a specific key (or partial tail-match)
    //   /keys clear          empty the extras pool (keeps primary apiKey)
    case '/keys': {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || '').toLowerCase();
      if (!sub || sub === 'status' || sub === 'list') {
        // Sync the in-memory pool from current config before reporting
        // — otherwise the user sees "empty" right after /keys add because
        // the pool only auto-populates on the next API call (via getClient).
        syncKeyPool(config.apiKey, config.apiKeys || []);
        const status = keyPoolStatus();
        if (status.length === 0) {
          console.log(chalk.dim('  Key pool is empty. /keys add <key> to start rotation.'));
          return { handled: true };
        }
        console.log(chalk.cyan(`\n  API key pool (${status.length}):`));
        for (const k of status) {
          const health = k.healthy
            ? chalk.green('✓ healthy')
            : chalk.yellow(`✗ cooling ${k.coolDownRemainingSec}s${k.lastReason ? ' (' + k.lastReason + ')' : ''}`);
          console.log(chalk.dim(`    [${k.index}] ${k.tail}  ${health}  · ${k.successes} ok / ${k.failures} fail`));
        }
        console.log(chalk.dim('\n  /keys add <key>      add to pool'));
        console.log(chalk.dim('  /keys remove <tail>  drop a key (last-4 char match)'));
        console.log(chalk.dim('  /keys clear          empty the extras pool\n'));
        return { handled: true };
      }
      if (sub === 'add') {
        const newKey = parts.slice(1).join(' ').trim();
        if (!newKey) { console.log(chalk.yellow('  Usage: /keys add <api-key>')); return { handled: true }; }
        const extras = (config.apiKeys || []).slice();
        if (extras.includes(newKey) || newKey === config.apiKey) {
          console.log(chalk.yellow('  Key already in the pool.'));
          return { handled: true };
        }
        extras.push(newKey);
        config.apiKeys = extras;
        saveConfig(config);
        syncKeyPool(config.apiKey, extras);
        resetClient();
        console.log(chalk.green(`  Key added (…${newKey.slice(-4)}). Pool size: ${1 + extras.length}.`));
        return { handled: true };
      }
      if (sub === 'remove' || sub === 'rm') {
        const target = parts[1] || '';
        if (!target) { console.log(chalk.yellow('  Usage: /keys remove <tail-chars>')); return { handled: true }; }
        const extras = (config.apiKeys || []).filter((k) => !k.endsWith(target) && k !== target);
        if (extras.length === (config.apiKeys || []).length) {
          console.log(chalk.yellow(`  No key matched "${target}".`));
          return { handled: true };
        }
        config.apiKeys = extras;
        saveConfig(config);
        syncKeyPool(config.apiKey, extras);
        resetClient();
        console.log(chalk.green(`  Key removed. Pool size: ${1 + extras.length}.`));
        return { handled: true };
      }
      if (sub === 'clear') {
        config.apiKeys = [];
        saveConfig(config);
        syncKeyPool(config.apiKey, []);
        resetClient();
        console.log(chalk.green('  Extras pool cleared. Primary key remains.'));
        return { handled: true };
      }
      console.log(chalk.yellow(`  Unknown /keys subcommand: ${sub}. Try: status, add, remove, clear`));
      return { handled: true };
    }

    // ── Sandbox — OS-native isolation for bash tool ──────────
    //   /sandbox                show backend + current level
    //   /sandbox off|standard|strict
    case '/sandbox': {
      const sub = args.trim().toLowerCase();
      const s = sandboxStatus();
      if (!sub || sub === 'status') {
        const current = config.sandbox?.level || 'off';
        console.log(chalk.cyan('\n  Sandbox status'));
        console.log(chalk.dim(`    platform: ${s.platform}`));
        console.log(chalk.dim(`    backend:  ${s.backend}${s.available ? ' ✓' : ' ✗ ' + (s.reason || 'unavailable')}`));
        console.log(chalk.dim(`    level:    ${current}${current === 'off' ? '' : (s.available ? ' (active)' : ' (config says ' + current + ' but backend unavailable → unsandboxed)')}`));
        console.log(chalk.dim('\n  Levels:'));
        console.log(chalk.dim('    off       — no wrap, behave as before'));
        console.log(chalk.dim('    standard  — read everywhere, write to cwd + /tmp, full network'));
        console.log(chalk.dim('    strict    — read/write cwd only, no network, no /tmp'));
        console.log(chalk.dim('\n  Change with: /sandbox <level>\n'));
        return { handled: true };
      }
      if (sub === 'off' || sub === 'standard' || sub === 'strict') {
        config.sandbox = { ...(config.sandbox || {}), level: sub };
        saveConfig(config);
        if (sub === 'off') {
          console.log(chalk.green(`  Sandbox: OFF — bash commands run unwrapped.`));
        } else if (s.available) {
          console.log(chalk.green(`  Sandbox: ${sub} — bash commands wrap via ${s.backend}.`));
        } else {
          // s.backend can be 'none' on Windows; phrase the message so it
          // reads naturally either way.
          const backendMsg = s.backend === 'none'
            ? 'no compatible sandbox backend is available on this platform'
            : `${s.backend} isn't installed on this machine`;
          console.log(chalk.yellow(`  Sandbox level set to ${sub}, but ${backendMsg}.`));
          console.log(chalk.dim(`  Reason: ${s.reason}`));
          console.log(chalk.dim('  Commands will still run, just unwrapped. Install the backend to actually sandbox.'));
        }
        return { handled: true };
      }
      console.log(chalk.yellow(`  Unknown /sandbox level: ${sub}. Use: off, standard, strict.`));
      return { handled: true };
    }

    // ── Reset hooks (clear stale entries from old installs) ──
    // Wipes ~/.grawkus/hooks.json, clears the in-memory quarantine, and
    // re-seeds the ECC default hooks against this install's bin path. Use
    // this when stale dev-machine paths from a prior install are crashing
    // every tool call.
    case '/hooks-reset':
    case '/reset-hooks': {
      saveHooksConfig({ hooks: [] });
      clearQuarantinedHooks();
      console.log(chalk.green('  Hooks cleared. Re-seeding ECC hooks for current install...'));
      try {
        const n = reseedEccHooks();
        console.log(chalk.green(`  Re-seeded ${n} ECC hooks pointing at this install.`));
      } catch (e) {
        console.log(chalk.dim(`  (ECC re-seed skipped: ${e instanceof Error ? e.message : e})`));
      }
      return { handled: true };
    }

    // ── Palette (color theme) ────────────────────────
    // `/palette` (no arg)  → show current + how to list
    // `/palette <id>`      → switch
    // `/palettes`          → list all available palettes with a preview
    case '/palette': {
      const target = args.trim().toLowerCase();
      if (!target) {
        return { handled: true, injectPrompt: '__PICK_APPEARANCE__' };
      }
      const resolved = resolvePaletteId(target);
      if (!resolved) {
        console.log(chalk.yellow(`  Unknown palette: ${target}`));
        console.log(chalk.dim(`  Run /palettes to see all options.`));
        return { handled: true };
      }
      setPalette(resolved);
      config.palette = resolved;
      saveConfig(config);
      console.log(theme.brandBold(`  ${sym.mark} Palette: ${resolved}`));
      console.log(theme.dim('  Brand · ') + theme.brand('brand') + theme.dim(' · ') + theme.success('success') + theme.dim(' · ') + theme.warning('warning') + theme.dim(' · ') + theme.error('error') + theme.dim(' · ') + theme.command('command'));
      return { handled: true };
    }

    case '/palettes': {
      const cur = getPaletteId();
      const palettes = listPalettes();
      const idCol = Math.max(24, ...palettes.map((p) => p.id.length)) + 2;
      console.log(theme.header('\n  Available palettes:'));
      for (const meta of palettes) {
        const marker = meta.id === cur ? theme.brandBold('  ◀ ') : '    ';
        const p = PALETTES[meta.id];
        const dot = p.swatches.map((color) => chalk.hex(color)('●')).join('');
        console.log(theme.dim(`${marker}`) + dot + theme.dim('  ') + theme.bright(meta.id.padEnd(idCol)) + theme.dim(meta.description));
        console.log(theme.dim(`         source: ${meta.source}`));
        const command = theme.syntaxCommand('/palette') + theme.dim(' ') + theme.syntaxArgument(meta.id);
        const active = meta.id === cur ? theme.dim('  ') + theme.highlight(' current ') : '';
        console.log(theme.dim('         use: ') + command + active);
      }
      console.log(theme.dim('\n  Switch with: /palette <id>\n'));
      return { handled: true };
    }

    // ── Voice / accessibility ────────────────────────
    // /voice                    — show current voice config + status
    // /voice on | off           — master switch
    // /voice config             — interactive setup (asks for keys)
    // /voice test               — synth a short test utterance to verify TTS
    // /voice key stt <KEY>      — set OpenAI key for Whisper STT only
    // /voice key tts <KEY>      — set ElevenLabs key for TTS only
    // /voice echo on | off      — toggle TTS-echo of user input
    // /voice skip-code on|off   — toggle stripping code blocks from TTS
    // /voice speed <n>          — set 0.5..2.0
    case '/voice': {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || '').toLowerCase();
      if (!sub) {
        printVoiceStatus(config);
        return { handled: true };
      }
      if (sub === 'on' || sub === 'off') {
        config.voice = config.voice || {};
        config.voice.enabled = sub === 'on';
        saveConfig(config);
        console.log(chalk.green(`  Voice: ${sub === 'on' ? 'ON' : 'OFF'}`));
        if (sub === 'on') {
          if (!getTtsConfig(config).apiKey) {
            console.log(chalk.yellow('  ⚠ No ElevenLabs key set. Run /voice key tts <KEY> to enable readout.'));
          }
          if (!getSttConfig(config).apiKey) {
            console.log(chalk.yellow('  ⚠ No OpenAI key for Whisper. Run /voice key stt <KEY> to enable dictation.'));
          }
          isFfmpegAvailable().then((ok) => {
            if (!ok) console.log(chalk.yellow('  ⚠ ffmpeg not found on PATH. Install ffmpeg: https://ffmpeg.org/'));
          });
        }
        return { handled: true };
      }
      if (sub === 'config') {
        // Lightweight interactive setup deferred to the prompt — user can
        // also just use `/voice key stt ...` and `/voice key tts ...`.
        console.log(chalk.cyan('\n  /voice config — quick setup'));
        console.log(chalk.dim('    1. Get an OpenAI key for Whisper STT: https://platform.openai.com/api-keys'));
        console.log(chalk.dim('    2. Get an ElevenLabs key for TTS:    https://elevenlabs.io/app/settings/api-keys'));
        console.log(chalk.dim('    3. Run:  /voice key stt <openai-key>'));
        console.log(chalk.dim('             /voice key tts <elevenlabs-key>'));
        console.log(chalk.dim('             /voice on'));
        console.log(chalk.dim('    4. Press F1 to dictate, hear assistant readout automatically.'));
        console.log();
        return { handled: true };
      }
      if (sub === 'key') {
        const target = (parts[1] || '').toLowerCase();
        const key = parts.slice(2).join(' ').trim();
        if ((target !== 'stt' && target !== 'tts') || !key) {
          console.log(chalk.yellow('  Usage: /voice key stt <openai-key>  |  /voice key tts <elevenlabs-key>'));
          return { handled: true };
        }
        config.voice = config.voice || {};
        if (target === 'stt') {
          config.voice.stt = { ...(config.voice.stt || {}), apiKey: key };
          console.log(chalk.green(`  STT key saved (***${key.slice(-4)}).`));
        } else {
          config.voice.tts = { ...(config.voice.tts || {}), apiKey: key };
          console.log(chalk.green(`  TTS key saved (***${key.slice(-4)}).`));
        }
        saveConfig(config);
        return { handled: true };
      }
      if (sub === 'test') {
        const tts = getTtsConfig(config);
        if (!tts.apiKey) {
          console.log(chalk.yellow('  No TTS key. Run /voice key tts <elevenlabs-key> first.'));
          return { handled: true };
        }
        console.log(chalk.dim('  Synthesizing test utterance…'));
        speak('Voice readout is working. This is the assistant voice.', config, { voiceId: tts.assistantVoiceId })
          .then((ok) => console.log(ok ? chalk.green('  ✓ Played.') : chalk.yellow('  ✗ Playback failed — check ffmpeg.')));
        return { handled: true };
      }
      if (sub === 'echo') {
        const v = (parts[1] || '').toLowerCase();
        if (v !== 'on' && v !== 'off') {
          console.log(chalk.yellow('  Usage: /voice echo on|off'));
          return { handled: true };
        }
        config.voice = config.voice || {};
        config.voice.tts = { ...(config.voice.tts || {}), echoUser: v === 'on' };
        saveConfig(config);
        console.log(chalk.green(`  User-echo: ${v.toUpperCase()}`));
        return { handled: true };
      }
      if (sub === 'skip-code') {
        const v = (parts[1] || '').toLowerCase();
        if (v !== 'on' && v !== 'off') {
          console.log(chalk.yellow('  Usage: /voice skip-code on|off'));
          return { handled: true };
        }
        config.voice = config.voice || {};
        config.voice.tts = { ...(config.voice.tts || {}), skipCode: v === 'on' };
        saveConfig(config);
        console.log(chalk.green(`  Skip-code: ${v.toUpperCase()}`));
        return { handled: true };
      }
      if (sub === 'speed') {
        const n = parseFloat(parts[1] || '');
        if (isNaN(n) || n < 0.25 || n > 4.0) {
          console.log(chalk.yellow('  Usage: /voice speed <0.25..4.0>'));
          return { handled: true };
        }
        config.voice = config.voice || {};
        config.voice.tts = { ...(config.voice.tts || {}), speed: n };
        saveConfig(config);
        console.log(chalk.green(`  TTS speed: ${n}x`));
        return { handled: true };
      }
      console.log(chalk.yellow(`  Unknown /voice subcommand: ${sub}`));
      console.log(chalk.dim('  Try: on, off, config, test, key, echo, skip-code, speed'));
      return { handled: true };
    }

    // /dictate — one-shot push-to-talk WITHOUT the F1 hotkey, useful when a
    // user is testing the pipeline or running under a terminal that strips
    // function keys. Records up to 30s, transcribes, injects as next prompt.
    case '/dictate': {
      // Parse + clamp the duration argument.
      //   /dictate          → 30s default
      //   /dictate 60       → 60s, clamped to [1, 300]
      //   /dictate 0        → 30s (user clearly wanted default or
      //                       cancel; previously parseInt(0) || 30
      //                       gave 30 silently)
      //   /dictate -5       → 30s (negative is nonsense)
      //   /dictate abc      → 30s default
      const parsed = parseInt(args, 10);
      const sec = Number.isFinite(parsed) && parsed > 0
        ? Math.min(300, parsed)
        : 30;
      console.log(chalk.dim(`  /dictate — recording up to ${sec}s…`));
      // Return as an async-injected prompt; we resolve the recording
      // synchronously here for simplicity (REPL is blocking anyway).
      return { handled: true, injectPrompt: '__DICTATE__' + sec };
    }

    // /accessibility — show or toggle the accessibility sub-block
    //   /accessibility                  — print status
    //   /accessibility screen-reader on|off
    //   /accessibility cues on|off
    //   /accessibility announce-errors on|off
    //   /accessibility announce-modes  on|off
    //   /accessibility confirm-destructive on|off
    //   /accessibility long-resp <words>
    case '/accessibility':
    case '/a11y': {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || '').toLowerCase();
      const v = (parts[1] || '').toLowerCase();
      if (!sub) {
        printVoiceStatus(config);
        return { handled: true };
      }
      const setBool = (field: 'screenReader' | 'audioCues' | 'announceErrors' | 'announceModeSwitches' | 'askBeforeDestructive', label: string) => {
        if (v !== 'on' && v !== 'off') {
          console.log(chalk.yellow(`  Usage: /accessibility ${sub} on|off`));
          return;
        }
        config.voice = config.voice || {};
        config.voice.accessibility = { ...(config.voice.accessibility || {}), [field]: v === 'on' } as typeof config.voice.accessibility;
        saveConfig(config);
        // Screen-reader mode is special: install/uninstall the stdout filter
        // immediately so the toggle takes effect for the very next log line.
        // Also flip animations off when SR is on — in-place ANSI repaints
        // (spinners + collapse transitions) read as a flood of new content
        // events to NVDA/JAWS and drown out actual response text.
        if (field === 'screenReader') {
          if (v === 'on') installScreenReaderDispatch(applyScreenReader);
          else uninstallScreenReaderDispatch();
          void import('./animations.js').then(({ setAnimationConfig }) => {
            setAnimationConfig({ screenReader: v === 'on' });
          });
        }
        console.log(chalk.green(`  ${label}: ${v.toUpperCase()}`));
      };
      if (sub === 'screen-reader' || sub === 'screenreader' || sub === 'sr') { setBool('screenReader', 'Screen-reader mode'); return { handled: true }; }
      if (sub === 'cues' || sub === 'audio-cues') { setBool('audioCues', 'Audio cues'); return { handled: true }; }
      if (sub === 'announce-errors' || sub === 'errors') { setBool('announceErrors', 'Announce errors'); return { handled: true }; }
      if (sub === 'announce-modes' || sub === 'modes') { setBool('announceModeSwitches', 'Announce mode switches'); return { handled: true }; }
      if (sub === 'confirm-destructive' || sub === 'destructive') { setBool('askBeforeDestructive', 'Ask before destructive'); return { handled: true }; }
      if (sub === 'long-resp' || sub === 'threshold') {
        const n = parseInt(parts[1] || '', 10);
        if (!n || n < 50) {
          console.log(chalk.yellow('  Usage: /accessibility long-resp <words≥50>'));
          return { handled: true };
        }
        config.voice = config.voice || {};
        config.voice.accessibility = { ...(config.voice.accessibility || {}), longResponseThreshold: n };
        saveConfig(config);
        console.log(chalk.green(`  Long-response threshold: ${n} words`));
        return { handled: true };
      }
      console.log(chalk.yellow(`  Unknown /accessibility subcommand: ${sub}`));
      console.log(chalk.dim('  Try: screen-reader, cues, announce-errors, announce-modes, confirm-destructive, long-resp'));
      return { handled: true };
    }

    // ── ECC (everything-claude-code) — no slash commands ───
    // ECC is bundled, free, auto-installed on first launch, and used
    // automatically: built-in commands (/tdd /review /security-review /plan
    // /refactor /build-fix) use ECC prompts; ECC-only workflows
    // (feature-development, add-language-rules, database-migration) are
    // registered as auto-matchable skills — describe what you want and the
    // right workflow prompt injects itself. No /ecc-* slash commands needed.

    // ── Config (trigger wizard) ───────────────────────
    case '/config':
      return { handled: true, shouldExit: false };

    case '/exit':
    case '/quit':
      return { handled: true, shouldExit: true };

    // ── Default: unknown command ──────────────────────────
    default: {
      // Friendly migration aid: if user types any /ecc* command (muscle
      // memory from earlier versions), redirect them to natural language.
      if (cmd.startsWith('/ecc')) {
        console.log(chalk.dim(`  ECC works automatically now — just describe what you want.`));
        console.log(chalk.dim(`  Examples:`));
        console.log(chalk.dim(`    "add a database migration for a users table"`));
        console.log(chalk.dim(`    "implement a feature to export CSV"`));
        console.log(chalk.dim(`    "add typescript coding rules to this project"`));
        return { handled: true };
      }
      printUnknownSlashCommand(cmd);
      return { handled: true };
    }
  }
}

// ── Main ──────────────────────────────────────────────────
export type NonInteractivePromptResolution =
  | { kind: 'query'; prompt: string }
  | { kind: 'handled' }
  | { kind: 'exit' }
  | { kind: 'sources'; input: Record<string, unknown> }
  | { kind: 'benchmarkRepos'; input: Record<string, unknown> }
  | { kind: 'repoDigest'; input: Record<string, unknown> }
  | { kind: 'error'; message: string };

export function resolveNonInteractivePrompt(
  promptText: string,
  config: GrawkusConfig,
  messages: Message[],
  session: Session,
  mode: { current: Mode },
): NonInteractivePromptResolution {
  const trimmed = promptText.trim();
  if (!trimmed) {
    return { kind: 'error', message: 'non-interactive mode requires a non-empty prompt.' };
  }
  if (!trimmed.startsWith('/')) {
    return { kind: 'query', prompt: trimmed };
  }

  const result = handleSlashCommand(trimmed, config, messages, session, mode);
  if (result.newMessages?.length) messages.push(...result.newMessages);
  if (result.shouldExit) return { kind: 'exit' };
  if (!result.injectPrompt) return { kind: 'handled' };
  if (result.injectPrompt.startsWith('__SOURCES__')) {
    const input = decodeSourcesSentinel(result.injectPrompt);
    if (!input) return { kind: 'error', message: 'could not parse /sources arguments.' };
    return { kind: 'sources', input };
  }
  if (result.injectPrompt.startsWith('__BENCHMARK_REPOS__')) {
    const input = decodeBenchmarkReposSentinel(result.injectPrompt);
    if (!input) return { kind: 'error', message: 'could not parse /benchmark-repos arguments.' };
    return { kind: 'benchmarkRepos', input };
  }
  if (result.injectPrompt.startsWith('__REPO_DIGEST__')) {
    const input = decodeRepoDigestSentinel(result.injectPrompt);
    if (!input) return { kind: 'error', message: 'could not parse /repo-digest arguments.' };
    return { kind: 'repoDigest', input };
  }
  if (result.injectPrompt.startsWith('__')) {
    const command = trimmed.split(/\s+/, 1)[0];
    return {
      kind: 'error',
      message: `${command} is not supported in non-interactive mode.`,
    };
  }
  return { kind: 'query', prompt: result.injectPrompt };
}

async function main(): Promise<void> {
  if (process.env.GRAWKUS_DOCTOR === '1') {
    const report = runDoctorCli({
      json: process.env.GRAWKUS_DOCTOR_JSON === '1',
      includeRegistry: process.env.GRAWKUS_DOCTOR_REGISTRY !== '0',
    });
    process.exit(report.hasFailures ? 1 : 0);
    return;
  }

  // Slash-command completer: unique-prefix fallback only. The bounded
  // inline selector is the discovery surface; this completer must never
  // return the full command catalog because readline prints multi-match
  // lists directly into the terminal.
  //
  // This is COMPLEMENTARY to the '/' keypress trigger that opens the
  // bounded inline selector: that's the "I want to browse" path; this is
  // the "I know what I'm typing, just save me keystrokes" path. The
  // two coexist because pressing '/' fires the selector at an empty
  // buffer, and pressing Tab while a slash prefix is present reopens
  // that selector with the typed filter preserved.
  const slashCommandNames = allSlashCommandNames();
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    completer: (line: string): [string[], string] => completeSlashCommandNames(line, slashCommandNames),
  });

  if (process.env.GRAWKUS_PROMODE_CRON === '1') {
    const envConfig = loadConfigFromEnv();
    const baseConfig = envConfig ?? loadConfig();
    const config = applyRuntimeConfigOverrides(baseConfig);
    const jobId = process.env.GRAWKUS_PROMODE_CRON_JOB;
    const dueOnly = process.env.GRAWKUS_PROMODE_CRON_DUE === '1';
    const code = await runHeadlessPromodeCron({
      config,
      cwd: process.cwd(),
      jobId: jobId || undefined,
      dueOnly,
      sessionId: 'promode-cron-headless',
      rl,
    });
    try { rl.close(); } catch { /* noop */ }
    process.exit(code);
    return;
  }

  if (process.env.GRAWKUS_OPENAI_OAUTH_SMOKE === '1') {
    const envConfig = loadConfigFromEnv();
    const baseConfig = envConfig ?? loadConfig();
    const config = applyRuntimeConfigOverrides(baseConfig);
    const result = await runOpenAICodexSmokeTest(config, {
      model: process.env.GRAWKUS_MODEL_OVERRIDE || process.env.GRAWKUS_MODEL,
    });
    console.log(formatOpenAICodexSmokeResult(result));
    try { rl.close(); } catch { /* noop */ }
    process.exit(result.ok ? 0 : 1);
    return;
  }

  // Initialize subsystems
  initHooksDir();
  const nonInteractive = process.env.GRAWKUS_NON_INTERACTIVE === '1';

  // First-run ECC install — silent if already installed, silent if resources missing.
  // Also re-installs when the saved state's version is older than the bundle's
  // BUNDLE_VERSION (so an `npm i -g grawkus@latest` upgrade picks up the
  // refreshed corpus without manual /reset-hooks).
  const eccState = loadEccState();
  const needsReimport = eccState && eccState.version !== ECC_BUNDLE_VERSION;
  if (eccResourcesAvailable() && (!eccState || needsReimport)) {
    try {
      const report = installEcc({ verbose: false });
      const verb = needsReimport ? `refreshed to v${ECC_BUNDLE_VERSION}` : 'ready';
      if (!nonInteractive) {
        console.log(chalk.dim(`  ECC ${verb}: ${report.skills} skills, ${report.agents} agents, ${report.commands + report.prompts} commands, ${report.rules} rule sets.`));
      }
    } catch (err) {
      // Never block startup on ECC failures
      if (!nonInteractive) {
        console.log(chalk.dim(`  ECC install skipped: ${err instanceof Error ? err.message : err}`));
      }
    }
  } else if (eccResourcesAvailable() && eccState) {
    // Self-heal stale ECC hook paths on every startup. seedHooks() writes
    // absolute paths derived from __dirname; after a global npm install
    // (or moving the dev tree, or any path change), those paths become
    // invalid and every tool call BLOCKS with a "module not found" error.
    // Re-seeding is idempotent: it strips prior __ecc__-tagged hooks and
    // re-adds them pointing at the CURRENT install path. User-defined
    // hooks (which don't carry the __ecc__ tag) are untouched.
    try {
      const { reseedEccHooks } = await import('./ecc.js');
      reseedEccHooks();
    } catch { /* never block startup on this */ }
  }

  // Load or create config.
  //
  // Non-interactive mode (GRAWKUS_NON_INTERACTIVE=1) cannot run
  // the setup wizard because it would block on stdin in a piped/headless
  // environment. Prefer an env-built runtime config when present; otherwise
  // require an existing config file and fail with a clear message.
  const envConfig = nonInteractive ? loadConfigFromEnv() : null;
  let config: GrawkusConfig;
  if (!configExists()) {
    if (nonInteractive && envConfig) {
      config = envConfig;
    } else if (nonInteractive) {
      process.stderr.write(
        '[grawkus] non-interactive mode requires a pre-existing config at ~/.grawkus/config.json.\n' +
        'Run `grawkus` once interactively, write the config manually, OR provide env config such as OPENROUTER_API_KEY and GRAWKUS_MODEL.\n'
      );
      process.exit(2);
      return;
    } else {
      config = await setupWizard(rl);
    }
  } else if (nonInteractive && process.env.GRAWKUS_ENV_CONFIG === '1' && envConfig) {
    config = envConfig;
  } else {
    config = loadConfig();
  }

  config = applyRuntimeConfigOverrides(config);

  // Per-invocation permission override (--perm flag). Doesn't touch
  // saved config — purely a runtime knob so harness runs can force
  // yolo without mutating the user's interactive permission setting.
  const permOverride = process.env.GRAWKUS_PERM_OVERRIDE;
  if (permOverride === 'ask' || permOverride === 'auto' || permOverride === 'yolo') {
    config.permissionMode = permOverride;
  }

  // Apply the user's chosen color palette before anything paints. setPalette
  // mutates the exported `theme` object in place so the banner, prompt, and
  // every subsequent log line render in the right colors.
  if (config.palette) setPalette(config.palette);

  // Install the screen-reader output filter if the user's config has it on.
  // Done as early as possible so every subsequent console.log (banner, hooks,
  // ECC install report, etc.) gets the filter applied uniformly.
  //
  // We also print a one-line notice up front so a sighted user who left this
  // on by accident notices immediately rather than spending five minutes
  // wondering where the colors went.
  if (config.voice?.accessibility?.screenReader) {
    installScreenReaderDispatch(applyScreenReader);
    console.log('[notice] screen-reader mode is ON — ANSI colors are stripped for NVDA/JAWS compatibility. Turn off with: /accessibility screen-reader off');
  }

  // ── Animation config ─────────────────────────────────────
  // Wire the global animation flag now that we know the screen-reader
  // setting. In-place ANSI repaints (used by tool/thinking spinners and
  // collapse/settle transitions) generate a flood of new content events
  // for screen readers, so they're force-off in that mode. Sighted
  // users get them by default; the GRAWKUS_ANIMATIONS=0 env var still
  // overrides for users who specifically don't want the motion.
  {
    const { setAnimationConfig } = await import('./animations.js');
    setAnimationConfig({
      enabled: process.env.GRAWKUS_ANIMATIONS !== '0',
      screenReader: config.voice?.accessibility?.screenReader === true,
    });
  }

  // Create session
  const mode = { current: 'dev' as Mode };
  const session = createSession(process.cwd(), config.model, config.provider, mode.current);

  // ── Debug instrumentation ─────────────────────────────────
  // Initialize early so subsequent emit() calls land in the right file.
  // Reads $GRAWKUS_DEBUG which bin/grawkus.js may have set from
  // the --debug CLI flag. Level 'off' is a no-op; non-off opens an
  // NDJSON log at ~/.grawkus/debug/<sessionId>.jsonl.
  initDebug(session.id);
  dbgEmit('info', 'session.start', {
    cwd: process.cwd(),
    model: config.model,
    provider: config.provider,
    mode: mode.current,
    permissionMode: config.permissionMode,
  });
  const messages: Message[] = [];
  const syncFooter = (): void => {
    const snapshot = buildFooterSnapshot(config, mode.current, session, process.cwd());
    if (!nonInteractive && shouldUseFixedFooter(config)) {
      activateFooter(snapshot);
    } else {
      deactivateFooter();
    }
    updateFooter(snapshot);
  };

  // Session start hook + memory persistence
  await runHooks({ event: 'SessionStart', sessionId: session.id, cwd: process.cwd(), permissionMode: config.permissionMode });
  const memoryContext = onSessionStart(session.id, process.cwd());
  if (memoryContext) {
    messages.push({ role: 'system', content: memoryContext });
  }
  if (!nonInteractive && config.import?.autoSyncOnStartup) {
    const wanted = config.import.defaultSource ?? 'auto';
    const limit = Math.max(10, Math.min(5000, Number(config.import.syncLimit ?? 200)));
    const scan = scanImportSources();
    const available = scan.filter((s) => s.detected && s.artifactsFound > 0).map((s) => s.source);
    const sources: ImportSource[] = wanted === 'auto'
      ? available
      : [wanted];
    if (sources.length > 0) {
      let totalImported = 0;
      let totalSkipped = 0;
      for (const src of sources) {
        try {
          const result = runImport(src, { limit, cwd: process.cwd() });
          totalImported += result.importedArtifacts;
          totalSkipped += result.skippedArtifacts;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(theme.warning(`  import auto-sync (${src}) failed: ${msg}`));
        }
      }
      console.log(theme.dim(`  import auto-sync: imported ${totalImported}, skipped ${totalSkipped} (limit ${limit})`));
    }
  }

  // Show startup display based on theme setting. Skipped entirely in
  // non-interactive mode — banners are noise when a harness is parsing
  // our stdout.
  const themeMode = config.theme || 'full';

  // Grawkus Forge header — sturdy dwarf ASCII art with forge/workshop feel.
  // Disabled in non-interactive, CI, screen-reader, and minimal modes.
  // Must also respect isTTY (pipe/redirect detection).
  if (
    !nonInteractive &&
    themeMode !== 'minimal' &&
    !config.voice?.accessibility?.screenReader &&
    process.stdout.isTTY
  ) {
    printForgeHeader();
  }

  if (nonInteractive) {
    // intentionally no output
  } else if (themeMode === 'full') {
    // Full mode: banner. ASCII splash removed per user request — both `full`
    // and `compact` themes now render the same banner block.
    printThemedBanner(
      config.provider,
      config.model,
      mode.current,
      config.permissionMode,
      session.id,
      ALL_TOOLS.map((t) => t.name),
    );
  } else if (themeMode === 'compact') {
    // Compact mode: just banner
    printThemedBanner(
      config.provider,
      config.model,
      mode.current,
      config.permissionMode,
      session.id,
      ALL_TOOLS.map((t) => t.name),
    );
  } else {
    // Minimal mode: just a one-liner
    console.log(theme.brandBold(BRAND_NAME) + theme.dim(BRAND_LOCKUP.slice(BRAND_NAME.length)));
    console.log('');
  }

  // ── Flaky-model warning at REPL launch ───────────────
  // The setup wizard already warns when a user TYPES one of these
  // known-slow / known-flaky OpenRouter models, but returning users
  // whose config was saved before that check landed never see the
  // warning. Print it every launch so they get a chance to switch via
  // /model before they hit the "model returns nothing, REPL looks
  // frozen" footgun.
  if (!nonInteractive && isKnownFlakyOpenRouterModel(config)) {
    console.log(theme.warning(`  ⚠  Active model "${config.model}" is known to stall in interactive OpenRouter sessions`));
    console.log(theme.warning(`     or return empty / "ERROR" responses.`));
    console.log(theme.dim(`     Switch with /openrouter-free or /model openrouter/free.`));
    console.log('');
  }
  if (!nonInteractive && /openrouter/i.test(config.provider) && !isOpenRouterFreeModelId(config.model)) {
    console.log(theme.warning(`  Note: Active OpenRouter model "${config.model}" may require credits.`));
    console.log(theme.dim(`     Free-tier-safe switch: /openrouter-free`));
    console.log('');
  }

  syncFooter();
  if (!nonInteractive) {
    startStartupUpdateCheck({
      onUpdateStarted: (currentVersion, latestVersion) => {
        deactivateFooter();
        console.log(theme.info(`  Update available: grawkus ${currentVersion} -> ${latestVersion}. Downloading in the background; restart Grawkus to use it.`));
        syncFooter();
      },
      onError: (error) => {
        dbgEmit('debug', 'update.check.failed', { error: error.slice(0, 200) });
      },
    });
  }

  let autoRouteRole: RouteRole | null = null;
  let nextTurnOverride: ModelTurnOverride | null = null;
  const consumeTurnConfig = (): GrawkusConfig => {
    if (!nextTurnOverride) return config;
    const override = nextTurnOverride;
    nextTurnOverride = null;
    const turnConfig: GrawkusConfig = {
      ...config,
      memory: config.memory ? { ...config.memory } : config.memory,
      sandbox: config.sandbox ? { ...config.sandbox } : config.sandbox,
      voice: config.voice ? { ...config.voice } : config.voice,
      openaiAuth: config.openaiAuth ? { ...config.openaiAuth } : config.openaiAuth,
      swarm: config.swarm ? { ...config.swarm } : config.swarm,
      footer: config.footer ? { ...config.footer } : config.footer,
      modelAliases: config.modelAliases ? { ...config.modelAliases } : config.modelAliases,
    };
    if (override.model) applyModelSelection(turnConfig, override.model);
    if (override.reasoningEffort) turnConfig.reasoningEffort = override.reasoningEffort;
    console.log(chalk.dim(`  [one-shot: ${formatTurnOverride(override, config.model)}]`));
    return turnConfig;
  };

  // ── F-key hotkey listener ────────────────────────────────
  // Voice / accessibility hotkeys — all on the F-row.
  //
  // The right-side block (INS/HOME/PGUP/DEL/END/PGDN) was the previous
  // home for these keys, but INS is the default NVDA + JAWS modifier and
  // binding it intercepts screen-reader commands. Bare F-keys are the
  // most screen-reader-safe option: NVDA, JAWS, and VoiceOver all reserve
  // INS+F-key or VO+F-key combos, never bare F-keys.
  //
  // The listener is global and fires regardless of REPL state — during
  // rl.question() prompt waits, slash-command execution, streaming, and
  // tool calls. suppressInputDuringStream() in query.ts only adds an
  // additional 'data' listener that swallows echo; it doesn't unbind the
  // 'keypress' event source. So these hotkeys work in every context.
  //
  //   Status (instant, no waiting):
  //     F1   current activity + elapsed   ("calling claude-sonnet-4, 8s")
  //     F2   where am I — model/provider/mode/permissions
  //     F3   re-speak full last response (bypasses summary)
  //     F4   re-speak summary of last response
  //
  //   Dictation + playback:
  //     F5   push-to-talk dictation (toggle: first press starts, second stops)
  //     F6   pause TTS playback
  //     F7   replay last spoken chunk
  //     F8   skip the current chunk
  //     F9   speed up TTS  (× 1.25, capped at 2.0)
  //     F10  slow down TTS (× 0.8,  floored at 0.5)
  //
  // All keys are no-ops when voice is off, so installing the listener
  // unconditionally is safe and lets the user enable voice mid-session
  // without restarting.
  let dictateController: RecordController | null = null;
  let dictateActive = false;

  // Track aborts + last-spoken text so query.ts can hand them off here.
  (globalThis as { __voicePlaybackCtl?: AbortController | null }).__voicePlaybackCtl = null;
  (globalThis as { __voiceLastChunk?: string | null }).__voiceLastChunk = null;
  (globalThis as { __voiceLastFullResponse?: string | null }).__voiceLastFullResponse = null;

  // emitKeypressEvents lives on the callback-flavor 'node:readline' module
  // (the promises variant doesn't expose it). Some platforms / terminals
  // don't deliver every F-key — failure here is a silent no-op; users can
  // fall back to /dictate and /voice slash commands.
  //
  // Skipped in non-interactive mode — there's no user at the keyboard,
  // and listening to keypress would consume bytes from the harness's
  // piped stdin that may or may not look like F-keys.
  try {
    if (nonInteractive) throw new Error('skip:nonInteractive');
    const readlineCb = await import('node:readline');
    const { describeStatus, describeLocation } = await import('./status.js');
    readlineCb.emitKeypressEvents(stdin);

    // Set of keys we intercept. Anything not in this set falls through to
    // readline so normal typing isn't affected. All bare or shifted F-keys
    // — no Insert/CapsLock/Ctrl-Option modifiers, so we never collide with
    // NVDA, JAWS, Narrator, Orca, or VoiceOver. F11 + F12 are also browser-
    // reserved keys (fullscreen / devtools) and therefore reliably free in
    // every terminal that isn't masquerading as a browser.
    const INTERCEPT = new Set([
      'f1', 'f2', 'f3', 'f4',                  // status announcements (bare)
      'f5', 'f6', 'f7', 'f8', 'f9', 'f10',     // dictation + playback (bare)
      'f11', 'f12',                            // Tier 1: input + last turn (bare)
      'tab',                                   // Shift+Tab cycles perm modes
      'escape',                                // Esc-Esc rewind at empty prompt
      ',', '.',                                // Alt+, / Alt+. reasoning effort
      'space',                                 // Space at empty prompt → command selector
      '/', 'slash',                           // / at empty prompt → command selector
      // Shifted F-keys carry the Tier-2 and Tier-3 a11y functions. Each
      // is checked alongside key.shift below, so a bare F1 still routes
      // to "status" while Shift+F1 routes to "queued input."
    ]);
    // Re-entry guard for the picker. The keypress listener can fire
    // again while the picker is still in alt-screen mode (the user
    // pressed something the picker handled but we still saw the
    // 'keypress' event), so we need to make sure we don't open a
    // second picker on top of the first.
    let pickerActive = false;

    // Define the hotkey listener as a NAMED, TAGGED function so
    // suppressInputDuringStream() in query.ts can isolate it among stdin's
    // 'keypress' listeners. During streaming we detach readline's own
    // keypress listener (to prevent echo + line-buffer pollution) while
    // keeping this one attached so F1–F12 keep working mid-response.
    // Esc-Esc detection — two bare Esc presses within 500ms at an empty
    // prompt buffer triggers /back. Single Esc during streaming triggers
    // a soft-cancel (alias for Ctrl+G steer). State lives in this closure
    // so it persists across keypress events.
    let lastEscapeMs = 0;

    const hotkeyListener = function hotkeyListener(
      _str: string,
      key: { name?: string; sequence?: string; shift?: boolean; ctrl?: boolean; meta?: boolean },
    ): void {
      if (!key) return;
      // Node's readline emitter sets `key.name` for named keys (tab,
      // space, escape, f1-f12, letters, etc.) but leaves it
      // UNDEFINED for many printable ASCII chars including '/', ',',
      // and '.'. For those keys only `key.sequence` is reliable.
      // Look up against both — name preferred, sequence as fallback —
      // so '/' (initial Node REPL parse delivers no name, just
      // sequence) and the Alt+,/. handlers actually fire.
      const name = (key.name || '').toLowerCase();
      const seq = (key.sequence || '');
      const lookup = name || seq;
      const rawF5CancelSequence = seq ? isTurnCancelKeySequence(Buffer.from(seq, 'utf8')) : false;
      if (!INTERCEPT.has(lookup) && !rawF5CancelSequence) return;
      // While the command selector / inline-suggest is open it takes
      // exclusive control of stdin via its own `data` listener. The
      // hotkey listener must bail entirely — otherwise Esc would
      // trigger the rewind chord, Tab/F-keys would print status
      // overlays, and Space/'/' would try to open a second picker on
      // top of the first. The data-level handler in the picker sees
      // the bytes first and finishes its work; we just stand down.
      if (pickerActive) return;
      const shift = !!key.shift;
      const meta = !!key.meta;
      const ctrl = !!key.ctrl;

      // Early-return guards so we don't steal keys that should pass
      // through to readline (regular typing, tab-completion, etc.):
      //   - bare ',' or '.' is regular typing; only Alt+,/. is ours
      //   - bare Tab is completion; only Shift+Tab is ours
      //   - Shift+Esc / Ctrl+Esc / Alt+Esc aren't ours
      if ((lookup === ',' || lookup === '.') && !meta) return;
      const getPromptLine = (): string => (rl as unknown as { line?: string }).line ?? '';
      if (name === 'tab' && !shift && !getPromptLine().startsWith('/')) return;
      if (name === 'tab' && (ctrl || meta)) return;
      if (name === 'escape' && (shift || ctrl || meta)) return;
      // Space is ours ONLY when the input buffer is empty and we're
      // at a prompt (not mid-streaming). The check happens in the
      // dedicated branch below; here we just defer if there's any
      // modifier (Shift+Space, Ctrl+Space, etc. aren't us).
      if (name === 'space' && (shift || ctrl || meta)) return;
      // Slash autocomplete: '/' at empty prompt opens the selector
      // pre-filtered to '/'. Modified variants (Ctrl+/, etc.) are
      // not ours.
      if ((lookup === '/' || lookup === 'slash') && (shift || ctrl || meta)) return;

      const a = getAccessibilityConfig(config);
      const tts = getTtsConfig(config);

      // Helper: print to stdout (always — picked up by the OS screen reader)
      // and optionally layer TTS on top if a key is configured. Used by
      // every "announce something" branch in the new tier of bindings.
      const announce = (label: string, text: string): void => {
        console.log(chalk.dim(`  [${label}] `) + text);
        if (tts.apiKey) {
          speak(text, config, { voiceId: tts.assistantVoiceId }).catch(() => { /* noop */ });
        }
      };

      // During an active model/tool turn, F5 means cancel even if the
      // terminal did not preserve Shift metadata. Windows Terminal commonly
      // reports Shift+F5 as a raw escape sequence or bare f5 depending on
      // mode, and the previous path silently fell through when voice was off.
      const activeTurnState = globalThis as {
        __turnAbortCtl?: AbortController | null;
        __turnCancelCurrent?: (() => void) | null;
      };
      const activeTurnCtl = activeTurnState.__turnAbortCtl;
      const f5LikeKey = name === 'f5' || rawF5CancelSequence;
      if (f5LikeKey && activeTurnCtl && !activeTurnCtl.signal.aborted) {
        try {
          if (activeTurnState.__turnCancelCurrent) activeTurnState.__turnCancelCurrent();
          else activeTurnCtl.abort();
        } catch { /* noop */ }
        announce('F5', 'Turn cancelled. Partial response kept.');
        return;
      }

      // STATUS hotkeys always work, even when voice is off and even when
      // there's no TTS key — they print to stdout so an OS-level screen
      // reader still has something to announce. TTS layers on top when a
      // key is present. Applies to:
      //   - F1–F4    : original status / location / replay set
      //   - F11/F12  : input buffer / last user turn (Tier 1)
      //   - Shift+*  : every shifted F-key is information or control,
      //                never voice-only
      const isStatusKey =
        name === 'f1' || name === 'f2' || name === 'f3' || name === 'f4' ||
        name === 'f11' || name === 'f12' || shift ||
        // Productivity bindings (Shift+Tab, Esc, Alt+,/.) work regardless
        // of voice state — they touch config / readline, not audio.
        name === 'tab' || name === 'escape' || name === 'space' ||
        lookup === ',' || lookup === '.' || lookup === '/' || lookup === 'slash';

      // F5–F10 (bare) are DICTATION/PLAYBACK hotkeys — they only make
      // sense when voice features are enabled. Bail early to avoid
      // spurious ffmpeg spawns and "TTS not configured" log lines.
      if (!isStatusKey && !isVoiceEnabled(config)) return;

      // ──────────────────────────────────────────────────────────────
      // Tier 2 + 3: shifted F-keys.
      //
      // Dispatched BEFORE the bare F-key branches because Shift+F5
      // shares its `name` ('f5') with the bare F5 dictation toggle —
      // we want the shifted variant to win without each bare branch
      // having to add a `!shift` guard.
      //
      //   Shift+F1   queued input          ("3 messages queued: …")
      //   Shift+F2   key-pool health       ("3 keys healthy, 1 cooling")
      //   Shift+F3   last tool-call        ("bash: ok, 'ls -la' → …")
      //   Shift+F4   toggle screen-reader  (persists to config.json)
      //   Shift+F5   soft-cancel turn      (graceful abort, partial kept)
      //   Shift+F6   panic-stop TTS        (silences for 5s, drops queue)
      //   Shift+F12  read hotkey list      (discoverability)
      //
      // Unbound shifted F-keys are no-ops and fall through (returning
      // here keeps them out of the bare-F-key branches below).
      // ──────────────────────────────────────────────────────────────
      if (shift) {
        // ── Shift+Tab: cycle permission modes ──────────────
        // Borrowed from Claude Code, the single most-loved power-user
        // hotkey: one keystroke flips the safety dial through the
        // full ask → auto → yolo cycle. Replaces /perm <mode> typing.
        if (name === 'tab') {
          const order: GrawkusConfig['permissionMode'][] = ['ask', 'auto', 'yolo'];
          const cur = config.permissionMode;
          const next = order[(order.indexOf(cur) + 1) % order.length];
          config.permissionMode = next;
          saveConfig(config);
          announce('Shift+Tab', `Permission mode: ${next}.`);
          return;
        }
        // ── Shift+F1: queued input ─────────────────────────
        if (name === 'f1') {
          const g = globalThis as { __grawkusQueuedInput?: string };
          const q = (g.__grawkusQueuedInput || '').trim();
          announce('Shift+F1', q
            ? `Queued during last chain: ${q.slice(0, 200)}`
            : 'Nothing queued.');
          return;
        }
        // ── Shift+F2: key-pool health ──────────────────────
        if (name === 'f2') {
          const ks = keyPoolStatus();
          if (ks.length === 0) {
            announce('Shift+F2', 'Key pool: 1 key (no pool configured). Use /keys add to add more.');
            return;
          }
          const healthy = ks.filter((s) => s.healthy).length;
          const cooling = ks.length - healthy;
          const cooldownNotes = ks
            .filter((s) => !s.healthy && s.coolDownRemainingSec)
            .map((s) => `${s.tail} cooling ${s.coolDownRemainingSec}s`)
            .join(', ');
          const text = cooling > 0
            ? `Key pool: ${healthy} healthy, ${cooling} cooling. ${cooldownNotes}.`
            : `Key pool: ${healthy} healthy, all keys ready.`;
          announce('Shift+F2', text);
          return;
        }
        // ── Shift+F3: last tool call ───────────────────────
        if (name === 'f3') {
          const g = globalThis as { __lastToolCall?: {
            name: string; argsPreview: string; outputPreview: string; isError: boolean;
          } | null };
          const tc = g.__lastToolCall;
          if (!tc) {
            announce('Shift+F3', 'No tool calls yet this session.');
            return;
          }
          const status = tc.isError ? 'error' : 'ok';
          // Output preview kept short for TTS; full output is already on
          // stdout from the original tool-call print.
          announce('Shift+F3',
            `Last tool: ${tc.name}, ${status}. ${tc.argsPreview}${tc.outputPreview ? ' → ' + tc.outputPreview.slice(0, 100) : ''}`);
          return;
        }
        // ── Shift+F4: toggle screen-reader mode ────────────
        if (name === 'f4') {
          config.voice = config.voice || {};
          config.voice.accessibility = config.voice.accessibility || {};
          const cur = config.voice.accessibility.screenReader === true;
          config.voice.accessibility.screenReader = !cur;
          saveConfig(config);
          const text = !cur
            ? 'Screen-reader mode ON. ANSI colors stripped. Restart recommended for full effect.'
            : 'Screen-reader mode OFF. Colors restored on next prompt.';
          announce('Shift+F4', text);
          return;
        }
        // ── Shift+F5: soft-cancel current turn ─────────────
        if (name === 'f5') {
          const g = globalThis as {
            __turnAbortCtl?: AbortController | null;
            __turnCancelCurrent?: (() => void) | null;
          };
          if (g.__turnAbortCtl && !g.__turnAbortCtl.signal.aborted) {
            try {
              if (g.__turnCancelCurrent) g.__turnCancelCurrent();
              else g.__turnAbortCtl.abort();
            } catch { /* noop */ }
            announce('Shift+F5', 'Turn cancelled. Partial response kept.');
          } else {
            announce('Shift+F5', 'No turn in progress.');
          }
          return;
        }
        // ── Shift+F6: panic-stop TTS ───────────────────────
        if (name === 'f6') {
          // Abort the current playback (same as F6/F8) AND open a 5-second
          // suppression window so incidental utterances (error
          // announcements, mode switches, audio cues fired by other code
          // paths) can't immediately fill the silence.
          const g = globalThis as {
            __voicePlaybackCtl?: AbortController | null;
            __voiceSuppressUntilMs?: number;
          };
          if (g.__voicePlaybackCtl && !g.__voicePlaybackCtl.signal.aborted) {
            try { g.__voicePlaybackCtl.abort(); } catch { /* noop */ }
          }
          g.__voiceSuppressUntilMs = Date.now() + 5000;
          // Print only — don't speak this acknowledgement (would defeat
          // the purpose of "shut up now").
          console.log(chalk.dim('  [Shift+F6] TTS panic-stop — silenced for 5s.'));
          return;
        }
        // ── Shift+F12: read hotkey list ────────────────────
        if (name === 'f12') {
          const lines = [
            'Hotkey reference.',
            'F1 status. F2 location. F3 read full last response. F4 read summary.',
            'F5 dictate. F6 pause. F7 replay. F8 skip. F9 speed up. F10 slow down.',
            'F11 read input buffer. F12 read your previous turn.',
            'Shift+F1 queued input. Shift+F2 key pool. Shift+F3 last tool. Shift+F4 toggle screen-reader.',
            'Shift+F5 soft-cancel turn. Shift+F6 panic-stop TTS. Shift+F12 this list.',
          ];
          for (const ln of lines) console.log(chalk.dim('  [Shift+F12] ') + ln);
          if (tts.apiKey) {
            // Speak as one continuous string so the chunker can pace it.
            speak(lines.join(' '), config, { voiceId: tts.assistantVoiceId }).catch(() => { /* noop */ });
          }
          return;
        }
        // Any other shifted F-key: no-op (don't fall through to bare).
        return;
      }

      // ── Space (bare) / '/' (bare): bounded inline command selector ──
      // The selector stays below the live prompt instead of entering
      // alt-screen. That keeps the conversation visible, lets the user
      // keep typing to narrow, and supports PageUp/PageDown scrolling
      // inside a compact dropdown that never claims the full viewport.
      const slashTrigger = lookup === '/' || lookup === 'slash';
      const tabSuggestTrigger = name === 'tab' && !shift && getPromptLine().startsWith('/');
      if (name === 'space' || slashTrigger || tabSuggestTrigger) {
        if (pickerActive) return;
        const buf = getPromptLine();
        // Space is only triggered at an empty buffer (mid-typing
        // space should insert normally). '/' has a more permissive
        // trigger: it fires at empty buffer OR at exactly "/"
        // (which is the state right after the user pressed '/'
        // and the byte landed in the buffer). Tab opens the same
        // selector for any slash-prefixed line and preserves that
        // filter, preventing readline from dumping the whole command
        // catalog into the terminal.
        if (name === 'space' && buf.length > 0) return;
        if (slashTrigger && buf !== '' && buf !== '/') return;
        if (tabSuggestTrigger && !buf.startsWith('/')) return;
        // Mid-stream is suppressed by the input guard already;
        // this listener still fires but we shouldn't open a picker
        // on top of a streaming turn.
        const turnCtl = (globalThis as { __turnAbortCtl?: AbortController | null }).__turnAbortCtl;
        if (turnCtl && !turnCtl.signal.aborted) return;
        const initialFilter = tabSuggestTrigger ? buf : slashTrigger ? '/' : '';
        // Take the interlock. The async branch sets pickerActive=false
        // in a finally so any error path still releases it.
        pickerActive = true;
        // Clear the trigger char from readline's buffer so the prompt
        // is clean. inlineSuggest repaints the prompt and filter on
        // every frame.
        try {
          setReadlineBuffer(rl, '');
        } catch { /* noop */ }
        const slashPickerState = globalThis as {
          __grawkusSlashAccepted?: InlineSuggestAcceptedCommand;
          __grawkusSlashPending?: SlashPickerState;
        };
        let pickerPromise!: Promise<InlineSuggestResult>;
        pickerPromise = (async (): Promise<InlineSuggestResult> => {
          let result: InlineSuggestResult = { accepted: false, filter: initialFilter };
          try {
            const gp = globalThis as {
              __grawkusPromptStyled?: string;
              __grawkusPromptVisLen?: number;
            };
            result = await inlineSuggest(
              rl,
              COMMAND_CATALOG.map((c) => ({
                command: c.command,
                aliases: c.aliases,
                hint: c.category,
                description: c.description,
              })),
              initialFilter,
              {
                promptPrefix: gp.__grawkusPromptStyled,
                promptVisibleLen: gp.__grawkusPromptVisLen,
              },
            );
            if (result.accepted && result.command) {
              try {
                (globalThis as { __grawkusSlashAccepted?: InlineSuggestAcceptedCommand })
                  .__grawkusSlashAccepted = { command: result.command, acceptedAtMs: Date.now() };
                setReadlineBuffer(rl, result.command);
                const prefix = gp.__grawkusPromptStyled ?? theme.prompt(`${sym.prompt} `);
                stdout.write('\r\x1b[2K' + prefix + result.command);
              } catch { /* noop */ }
            } else {
              try {
                setReadlineBuffer(rl, result.filter);
                const prefix = gp.__grawkusPromptStyled ?? theme.prompt(`${sym.prompt} `);
                stdout.write('\r\x1b[2K' + prefix + result.filter);
              } catch { /* noop */ }
            }
            return result;
          } finally {
            pickerActive = false;
            const g = globalThis as { __grawkusSlashPending?: SlashPickerState };
            if (g.__grawkusSlashPending?.promise === pickerPromise) {
              g.__grawkusSlashPending = undefined;
            }
          }
        })();
        slashPickerState.__grawkusSlashPending = {
          promise: pickerPromise,
          startedAtMs: Date.now(),
        };
        void pickerPromise;
        return;
      }

      // ── Esc (bare): rewind chord at empty prompt ───────
      // Two bare Esc presses within 500ms at an empty input buffer
      // triggers /back (rewind one user turn). Matches the muscle
      // memory of both Claude Code and Codex CLI ("Esc-Esc to step
      // back"). When the prompt buffer has content, single Esc clears
      // the typed buffer (readline default); Esc-Esc still rewinds
      // only when buffer was empty going in.
      if (name === 'escape') {
        // Mid-stream Esc is handled at the byte level in query.ts
        // dataHandler (where it triggers the steer cancel). The
        // hotkey-listener Esc branch must explicitly bail when a
        // turn is in progress, otherwise the user sees BOTH the
        // steer effect AND the "press Esc again to rewind" hint
        // print, and a second Esc enqueues /back on top of the
        // already-cancelled turn. Audit P0.
        const turnCtl = (globalThis as { __turnAbortCtl?: AbortController | null }).__turnAbortCtl;
        if (turnCtl && !turnCtl.signal.aborted) {
          lastEscapeMs = 0;
          return;
        }
        const buf = (rl as unknown as { line?: string }).line ?? '';
        if (buf.trim()) {
          // Non-empty buffer: don't intercept, let readline do its
          // default (which is meta-prefix; harmless).
          lastEscapeMs = 0;
          return;
        }
        const now = Date.now();
        if (now - lastEscapeMs < 500) {
          // Second Esc within window — fire /back.
          lastEscapeMs = 0;
          // Enqueue the slash command as queued input. The REPL loop
          // picks it up + dispatches /back on the next iteration.
          (globalThis as { __grawkusQueuedInput?: string }).__grawkusQueuedInput = '/back\n';
          announce('Esc-Esc', 'Rewinding to previous user turn.');
          // Resolve the pending rl.question() so the main loop
          // actually moves on. Previously this used stdin.write('\n')
          // which DOESN'T interrupt readline — it merely adds a
          // newline to the input stream that readline reads as if
          // the user typed it, leaving the REPL stuck until the user
          // pressed Enter manually. emit('line', '') triggers the
          // 'line' event that rl.question internally listens for,
          // resolving the promise immediately. (Bug found by audit.)
          try {
            rl.emit('line', '');
          } catch {
            // Fallback path if rl.emit isn't accepted for some reason
            // (e.g. on a future readline version): still nudge via
            // stdin so the user can recover by pressing any key.
            try { stdin.write('\n'); } catch { /* noop */ }
          }
          return;
        }
        lastEscapeMs = now;
        // Single Esc on an empty buffer — show a one-time hint so the
        // chord is discoverable. Suppressed under screen-reader mode
        // (would interrupt their reading flow on every Esc).
        if (config.voice?.accessibility?.screenReader !== true) {
          console.log(chalk.dim('  [Esc] press Esc again within 500ms to rewind one turn.'));
        }
        return;
      }

      // ── Alt+, / Alt+. : reasoning effort (temperature) ─
      // Borrowed from Codex CLI. Lower temperature = more careful /
      // deterministic; higher = more creative. Step ± 0.1, clamped
      // to [0.0, 2.0]. Saved immediately so the next API call uses
      // the new value. Persisted so the setting survives restarts.
      if ((lookup === ',' || lookup === '.') && meta) {
        const cur = typeof config.temperature === 'number' ? config.temperature : 0.3;
        const step = lookup === ',' ? -0.1 : +0.1;
        const next = Math.max(0, Math.min(2.0, Math.round((cur + step) * 100) / 100));
        config.temperature = next;
        saveConfig(config);
        const label = lookup === ',' ? 'Alt+,' : 'Alt+.';
        announce(label, `Temperature ${next.toFixed(2)} (lower = more careful, higher = more creative).`);
        return;
      }

      // ── F11: read current input buffer (Tier 1, bare) ──
      if (name === 'f11') {
        // rl.line is readline's internal "what the user has typed so far
        // on the current prompt." Empty string when the prompt is fresh
        // or the buffer was just submitted.
        const buf = (rl as unknown as { line?: string }).line ?? '';
        announce('F11', buf
          ? `Input buffer: ${buf}`
          : 'Input buffer is empty.');
        return;
      }

      // ── F12: read previous submitted user turn (Tier 1) ──
      if (name === 'f12') {
        // Walk messages newest-first looking for the most-recent user
        // message. `messages` is the live REPL conversation array; the
        // last user entry is the prompt the model just answered (or is
        // answering). Skips system-injected "auto-resume" markers and
        // tool-result envelopes (those have role 'tool', not 'user').
        let last: string | null = null;
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
            last = m.content;
            break;
          }
        }
        announce('F12', last
          ? `Your last message: ${last.slice(0, 400)}`
          : 'No prior user message this session.');
        return;
      }

      // ── F5: push-to-talk dictation toggle ──────────────
      if (name === 'f5') {
        if (dictateActive) {
          dictateActive = false;
          const ctl = dictateController;
          dictateController = null;
          if (!ctl) return;
          (async () => {
            if (a.audioCues) await audioCue('recording-stop');
            const buf = await ctl.stop();
            if (!buf) {
              console.log(chalk.dim('  [F5] no audio captured.'));
              return;
            }
            if (a.audioCues) await audioCue('processing');
            const { transcribeAudio } = await import('./voice.js');
            const { setStatus } = await import('./status.js');
            setStatus({ state: 'transcribing' });
            const transcript = await transcribeAudio(buf, config, 'wav');
            setStatus({ state: 'idle' });
            if (!transcript) {
              console.log(chalk.dim('  [F5] transcription failed.'));
              if (a.audioCues) await audioCue('error');
              return;
            }
            if (a.audioCues) await audioCue('done');
            const stt = getSttConfig(config);
            stdin.write(transcript);
            if (stt.autoSubmit) stdin.write('\n');
          })();
        } else {
          (async () => {
            // Probe the mic FIRST so a missing-device case fails fast with
            // a clear message + audio cue, instead of silently spawning a
            // zombie ffmpeg in the background.
            const probe = await probeMic();
            if (probe !== 'ok') {
              const msg = micProbeMessage(probe);
              console.log(chalk.yellow(`  [F5] ${msg}`));
              if (a.audioCues) await audioCue('error');
              if (tts.apiKey) {
                speak(msg, config, { voiceId: tts.assistantVoiceId }).catch(() => { /* noop */ });
              }
              return;
            }
            const ctl = await startRecording(60);
            if (!ctl) {
              console.log(chalk.yellow('  [F5] could not start mic capture.'));
              return;
            }
            dictateController = ctl;
            dictateActive = true;
            const { setStatus } = await import('./status.js');
            setStatus({ state: 'recording' });
            if (a.audioCues) await audioCue('recording-start');
            console.log(chalk.dim('  [F5] recording — press F5 again to stop.'));
          })();
        }
        return;
      }

      // ── F6: pause TTS ──────────────────────────────────
      if (name === 'f6') {
        const g = globalThis as { __voicePlaybackCtl?: AbortController | null };
        if (g.__voicePlaybackCtl && !g.__voicePlaybackCtl.signal.aborted) {
          g.__voicePlaybackCtl.abort();
          console.log(chalk.dim('  [F6] TTS paused.'));
        }
        return;
      }

      // ── F7: replay last chunk ──────────────────────────
      if (name === 'f7') {
        const g = globalThis as { __voiceLastChunk?: string | null };
        const chunk = g.__voiceLastChunk;
        if (!chunk) {
          console.log(chalk.dim('  [F7] nothing to replay.'));
          return;
        }
        if (!tts.apiKey) return;
        (async () => { await speak(chunk, config, { voiceId: tts.assistantVoiceId }); })();
        return;
      }

      // ── F8: skip current chunk ─────────────────────────
      if (name === 'f8') {
        const g = globalThis as { __voicePlaybackCtl?: AbortController | null };
        if (g.__voicePlaybackCtl) g.__voicePlaybackCtl.abort();
        console.log(chalk.dim('  [F8] TTS skipped.'));
        return;
      }

      // ── F9 / F10: TTS speed ±  ─────────────────────────
      if (name === 'f9' || name === 'f10') {
        config.voice = config.voice || {};
        const ttsCfg = config.voice.tts = { ...(config.voice.tts || {}) };
        const cur = ttsCfg.speed ?? 1.0;
        const next = name === 'f9' ? Math.min(2.0, cur * 1.25) : Math.max(0.5, cur * 0.8);
        ttsCfg.speed = Math.round(next * 100) / 100;
        saveConfig(config);
        console.log(chalk.dim(`  [${name.toUpperCase()}] TTS speed: ${ttsCfg.speed}x`));
        return;
      }

      // ── F1: "what's happening?" — current activity + elapsed ───
      if (name === 'f1') {
        const msg = describeStatus();
        console.log(chalk.dim(`  [F1] ${msg}`));
        if (tts.apiKey) {
          speak(msg, config, { voiceId: tts.assistantVoiceId }).catch(() => { /* noop */ });
        }
        return;
      }

      // ── F2: "where am I?" — model/provider/mode/permissions ────
      if (name === 'f2') {
        const msg = describeLocation();
        console.log(chalk.dim(`  [F2] ${msg}`));
        if (tts.apiKey) {
          speak(msg, config, { voiceId: tts.assistantVoiceId }).catch(() => { /* noop */ });
        }
        return;
      }

      // ── F3: re-speak FULL last response ────────────────
      if (name === 'f3') {
        const g = globalThis as { __voiceLastFullResponse?: string | null };
        const text = g.__voiceLastFullResponse;
        if (!text) {
          console.log(chalk.dim('  [F3] nothing to read.'));
          return;
        }
        // Always print a short marker so the screen reader has something
        // to announce. Then add TTS playback on top if a key is configured.
        console.log(chalk.dim(`  [F3] reading full last response (${text.length} chars).`));
        if (!tts.apiKey) return;
        (async () => {
          const { speakAssistantResponse } = await import('./voice.js');
          const ctl = new AbortController();
          (globalThis as { __voicePlaybackCtl?: AbortController | null }).__voicePlaybackCtl = ctl;
          await speakAssistantResponse(text, config, ctl.signal);
        })();
        return;
      }

      // ── F4: re-speak SUMMARY of last response ──────────
      if (name === 'f4') {
        const g = globalThis as { __voiceLastFullResponse?: string | null };
        const text = g.__voiceLastFullResponse;
        if (!text) {
          console.log(chalk.dim('  [F4] nothing to summarize.'));
          return;
        }
        const summary = summarize(text, a.longResponseThreshold);
        // Print the summary itself so it's reachable via screen reader
        // even without an ElevenLabs key.
        console.log(chalk.dim('  [F4] summary:'));
        console.log(chalk.white('  ' + summary));
        if (!tts.apiKey) return;
        (async () => {
          const ctl = new AbortController();
          (globalThis as { __voicePlaybackCtl?: AbortController | null }).__voicePlaybackCtl = ctl;
          await speak(summary, config, { voiceId: tts.assistantVoiceId, signal: ctl.signal });
        })();
        return;
      }
    };
    // Tag so suppressInputDuringStream() can identify and preserve this
    // specific listener while detaching readline's own keypress handler.
    (hotkeyListener as unknown as { __grawkusHotkey__: boolean }).__grawkusHotkey__ = true;
    stdin.on('keypress', hotkeyListener);
  } catch {
    // No keypress support — accessibility users can still use /dictate.
  }

  // Session-start anchor — used by the [Nm Ns] tag prepended to every prompt
  // so the user can see at a glance how long the REPL has been open. Combined
  // with the per-chain timer printed after each model response (see runQuery),
  // gives both "how long am I here" and "how long was that last response."
  const sessionStartMs = new Date(session.createdAt).getTime();

  // autoSave wrapper that snapshots the live config + mode + perm
  // into the session before writing. Without this, the saved
  // session captures only the values the Session object was created
  // with — every /perm, /model, /mode change made during the
  // session is lost on /resume. Used by all in-process autosave
  // callsites; /save in the slash-command handler passes the same
  // snapshot inline (it doesn't have access to this closure).
  const saveWithSnapshot = (): Promise<void> => autoSave(session, messages, {
    model: config.model,
    provider: config.provider,
    mode: mode.current,
    permissionMode: config.permissionMode,
    cwd: process.cwd(),
  });

  // ── Non-interactive single-chain mode ─────────────────
  //
  // Triggered by `--prompt <text>` / `--prompt-file <path>` (parsed in
  // bin/grawkus.js and stashed on GRAWKUS_PROMPT). We push the
  // prompt as one user message, run a single runQuery to completion,
  // and exit. No REPL, no banner, no hotkey listener, no live queue.
  //
  // This is the entrypoint that lets external harnesses (Terminal-Bench,
  // CI scripts, etc.) drive grawkus with a single task and read
  // its output cleanly. Stdin is left untouched — readline never
  // attaches — so piped stdin won't confuse anything.
  if (process.env.GRAWKUS_NON_INTERACTIVE === '1') {
    const promptText = process.env.GRAWKUS_PROMPT;
    if (!promptText || !promptText.trim()) {
      process.stderr.write('[grawkus] non-interactive mode requires --prompt <text> or --prompt-file <path>.\n');
      process.exit(2);
    }
    const resolvedPrompt = resolveNonInteractivePrompt(promptText, config, messages, session, mode);
    if (resolvedPrompt.kind === 'error') {
      process.stderr.write(`[grawkus] ${resolvedPrompt.message}\n`);
      process.exit(2);
    }
    if (resolvedPrompt.kind === 'sources') {
      const result = await ResearchSourcesTool.call(resolvedPrompt.input, process.cwd());
      console.log(result.output);
      try {
        await runHooks({ event: 'SessionStop', sessionId: session.id, cwd: process.cwd(), permissionMode: config.permissionMode });
      } catch { /* never fail a local command on hook errors */ }
      try { rl.close(); } catch { /* noop */ }
      process.exitCode = result.isError ? 1 : 0;
      return;
    }
    if (resolvedPrompt.kind === 'benchmarkRepos') {
      console.log(formatBenchmarkRepoCatalog(resolvedPrompt.input));
      try {
        await runHooks({ event: 'SessionStop', sessionId: session.id, cwd: process.cwd(), permissionMode: config.permissionMode });
      } catch { /* never fail a local command on hook errors */ }
      try { rl.close(); } catch { /* noop */ }
      process.exitCode = 0;
      return;
    }
    if (resolvedPrompt.kind === 'repoDigest') {
      const result = await GitHubRepoDigestTool.call(resolvedPrompt.input, process.cwd());
      console.log(result.output);
      try {
        await runHooks({ event: 'SessionStop', sessionId: session.id, cwd: process.cwd(), permissionMode: config.permissionMode });
      } catch { /* never fail a local command on hook errors */ }
      try { rl.close(); } catch { /* noop */ }
      process.exitCode = result.isError ? 1 : 0;
      return;
    }
    if (resolvedPrompt.kind === 'exit' || resolvedPrompt.kind === 'handled') {
      try {
        await runHooks({ event: 'SessionStop', sessionId: session.id, cwd: process.cwd(), permissionMode: config.permissionMode });
      } catch { /* never fail a local command on hook errors */ }
      try { rl.close(); } catch { /* noop */ }
      process.exit(0);
    }
    const instantArtifact = maybeCreateInstantArtifact(resolvedPrompt.prompt, process.cwd());
    if (instantArtifact) {
      printLocalResponse(instantArtifact.message);
      messages.push({ role: 'user', content: resolvedPrompt.prompt });
      messages.push({ role: 'assistant', content: instantArtifact.assistantMessage });
      await saveWithSnapshot();
      try {
        await runHooks({ event: 'SessionStop', sessionId: session.id, cwd: process.cwd(), permissionMode: config.permissionMode });
      } catch { /* never fail a local artifact on hook errors */ }
      try { rl.close(); } catch { /* noop */ }
      process.exit(0);
    }
    // ── F9: Empty-engagement guard (non-interactive nudge) ──
    //
    // Some failures in the 2026-05-25 baseline run came from the
    // model emitting a single no-tool-call response and exiting —
    // never actually attempting the work. polyglot-c-py, solana-data,
    // and vim-terminal-task all showed this pattern. The model
    // interpreted some aspect of the spec as "I can't do this" (e.g.
    // "use vim" suggesting interactive editing) and bailed.
    //
    // In non-interactive mode there's no human to push back, so we
    // prepend a system message that explicitly frames the contract:
    // the agent must DO the work, with tools. Responses without tool
    // calls are interpreted as "I'm done" — and F5+ DeCRIM will
    // then walk the agent through verification.
    //
    // This is system-prompt-level and doesn't repeat per-turn (that
    // would bloat context). It's a one-shot priming injection.
    messages.push({
      role: 'system',
      content:
        'You are running in NON-INTERACTIVE mode: no human will answer follow-up questions. ' +
        'You must DO the work using the available tools (bash, write, edit, read, glob, grep, etc.) — ' +
        'not describe what would need to be done. ' +
        'If the task mentions a specific tool you do not have direct access to (e.g. "use vim"), ' +
        'achieve the equivalent effect with the tools you do have. ' +
        'If you lack information, USE A TOOL to investigate; do not ask the user. ' +
        'A response with no tool calls is interpreted as "I am done" and triggers final verification.',
    });
    messages.push({ role: 'user', content: resolvedPrompt.prompt });
    try {
      await saveWithSnapshot();
      await runQuery({
        config,
        messages,
        cwd: process.cwd(),
        rl,
        sessionId: session.id,
        mode: mode.current,
      });
      // Run any session-stop hooks the user registered.
      try {
        await runHooks({ event: 'SessionStop', sessionId: session.id, cwd: process.cwd(), permissionMode: config.permissionMode });
      } catch { /* never fail an otherwise-successful run on hook errors */ }
      // Close readline so the Node process can exit cleanly. Without
      // this, the readline interface keeps the event loop alive until
      // the user types something (which they can't, since stdin is
      // piped from a harness).
      try { rl.close(); } catch { /* noop */ }
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[grawkus] chain failed: ${msg}\n`);
      try { rl.close(); } catch { /* noop */ }
      process.exit(1);
    }
  }

  let promodeQueryInFlight = false;
  registerPromodeReplBridge({
    cwd: process.cwd(),
    config,
    rl,
    getMessages: () => messages,
    getMode: () => mode,
    getSession: () => session,
    runQuery: async (opts) => {
      promodeQueryInFlight = true;
      try {
        await runQuery({ ...opts, rl });
      } finally {
        promodeQueryInFlight = false;
      }
    },
    saveSnapshot: saveWithSnapshot,
    hasQueuedUserInput: () => {
      const g = globalThis as { __grawkusQueuedInput?: string };
      return Boolean(g.__grawkusQueuedInput?.trim());
    },
    isQueryInFlight: () => promodeQueryInFlight,
    consumeTurnConfig,
    syncFooter,
  });

  const promodeState = loadPromodeState(process.cwd());
  if (promodeState.running && !promodeState.stopped) {
    mode.current = 'promode';
    startPromodeFromRepl();
    console.log(chalk.dim('  ProMode loop resumed from saved state.'));
  }

  let firstInteractivePrompt = true;

  // Main REPL loop
  while (true) {
    let input: string;
    try {
      syncFooter();
      // Screen-reader-aware prompt construction:
      //   - The Unicode prompt glyph (❯) gets re-substituted by the
      //     symbol→word filter on EVERY readline redraw (one per keystroke),
      //     so the screen reader hears "prompt h", "prompt he", "prompt hel"
      //     as the user types. Use plain ASCII to avoid the substitution.
      //   - The session timer ([5s] …) changes every second and adds
      //     redraw churn the user can already get on-demand via F1.
      //   - The mode tag is preserved because mode info is genuinely useful
      //     contextual signal that doesn't tick.
      const screenReader = config.voice?.accessibility?.screenReader === true;
      const sessionTag = screenReader
        ? ''
        : theme.dim(`[${formatDuration(Date.now() - sessionStartMs)}] `);
      const modeTag = mode.current !== 'dev' ? theme.dim(`[${mode.current}] `) : '';
      const promptGlyph = screenReader ? '> ' : `${sym.prompt} `;
      // Stash the prompt prefix for the inline-suggest dropdown (the
      // `/` hotkey handler is in a different scope and can't otherwise
      // see what theme.prompt() decided this iteration). The handler
      // repaints the prompt line on every render — it needs both the
      // styled string (to write with color) and the visible-char
      // length (to position the cursor at end-of-filter).
      const promptStyled = isFooterActive()
        ? theme.prompt('> ')
        : sessionTag + modeTag + theme.prompt(promptGlyph);
      (globalThis as { __grawkusPromptStyled?: string; __grawkusPromptVisLen?: number })
        .__grawkusPromptStyled = promptStyled;
      (globalThis as { __grawkusPromptStyled?: string; __grawkusPromptVisLen?: number })
        .__grawkusPromptVisLen = ansiVisibleLen(promptStyled);

      // Type-ahead input. If the user typed during the previous chain's
      // streaming/tool execution, restore it into the next prompt as a
      // draft instead of auto-submitting it or printing a "queued" hint.
      // This keeps the REPL editable: the user can continue typing,
      // backspace, or press Enter once the model is done.
      const g = globalThis as {
        __grawkusQueuedInput?: string;
        __grawkusSlashAccepted?: InlineSuggestAcceptedCommand;
        __grawkusSlashPending?: SlashPickerState;
        __grawkusSlashPrefillInput?: string;
      };
      const queued = g.__grawkusQueuedInput || '';
      const slashPrefill = g.__grawkusSlashPrefillInput || '';
      g.__grawkusQueuedInput = undefined;
      g.__grawkusSlashPrefillInput = undefined;
      const restoredDraft = normalizeTypeaheadDraftForPrompt(queued);
      const openingPrompt = firstInteractivePrompt && isFooterActive()
        ? (config.footer?.openingPrompt ?? '/model')
        : '';
      firstInteractivePrompt = false;
      const prefill = slashPrefill || restoredDraft || openingPrompt;
      input = await askWithDecoratedPrompt(rl, sessionTag, modeTag, promptGlyph, prefill);
    } catch {
      break;
    }

    {
      const g = globalThis as {
        __grawkusSlashAccepted?: InlineSuggestAcceptedCommand;
        __grawkusSlashPending?: SlashPickerState;
        __grawkusSlashPrefillInput?: string;
      };
      const staleSelectorSubmit = input.trim() === '' || input.trim() === '/';
      if (g.__grawkusSlashPending && staleSelectorSubmit) {
        try {
          const result = await g.__grawkusSlashPending.promise;
          if (result.accepted && result.command) {
            g.__grawkusSlashPrefillInput = result.command;
          } else if (result.filter) {
            g.__grawkusSlashPrefillInput = result.filter;
          }
        } catch {
          // Treat selector failure as a cancelled edit rather than dispatching "/".
        }
        g.__grawkusSlashAccepted = undefined;
        continue;
      }
      const outcome = resolveInlineSuggestQuestionInput(input, g.__grawkusSlashAccepted);
      if (outcome.kind === 'prefill') {
        g.__grawkusSlashAccepted = undefined;
        g.__grawkusSlashPrefillInput = outcome.command;
        continue;
      }
      if (outcome.clearAccepted) {
        g.__grawkusSlashAccepted = undefined;
      }
    }

    const trimmed = input.trim();
    if (!trimmed) continue;
    if (isFooterActive()) {
      writeFooterSubmittedLine(input);
    }

    // Shell escape
    if (trimmed.startsWith('!')) {
      const { exec } = await import('node:child_process');
      const cmd = trimmed.slice(1).trim();
      if (cmd) {
        exec(cmd, { cwd: process.cwd(), maxBuffer: 5 * 1024 * 1024 }, (_err, out, err) => {
          if (out) console.log(out);
          if (err) console.error(chalk.yellow(err));
          if (_err && !out && !err) console.error(chalk.red(_err.message));
        });
      }
      continue;
    }

    // Slash commands
    if (trimmed.startsWith('/')) {
      // Truncate arg preview so debug logs don't blow up on /editor seeds etc.
      dbgEmit('debug', 'slash.dispatch', { input: trimmed.slice(0, 200) });
      const result = handleSlashCommand(trimmed, config, messages, session, mode);
      if (result.shouldExit) break;
      if (result.newMessages !== undefined) {
        messages.length = 0;
        messages.push(...result.newMessages);
      }
      if (result.turnOverride !== undefined) {
        nextTurnOverride = result.turnOverride;
      }
      if (result.routeRole !== undefined) {
        autoRouteRole = result.routeRole;
        continue;
      }
      syncFooter();
      if (isFooterActive()) {
        setFooterActivity('Ready', 0, null);
      }
      if (trimmed.startsWith('/config') && !result?.shouldExit) {
        deactivateFooter();
        config = await setupWizard(rl, config);
        resetClient();
        printThemedBanner(
          config.provider,
          config.model,
          mode.current,
          config.permissionMode,
          session.id,
          ALL_TOOLS.map((t) => t.name),
        );
        syncFooter();
        continue;
      }
      // Some commands inject a prompt into the conversation (e.g. /commit, /review, /tdd)
      if (result.injectPrompt) {
        // Special-case the /dictate flow: synthesize the prompt from the mic
        // before pushing it as a user message. We use the sentinel
        // "__DICTATE__<seconds>" so the slash handler stays purely sync.
        if (result.injectPrompt.startsWith('__DICTATE__')) {
          const maxSec = parseInt(result.injectPrompt.slice('__DICTATE__'.length), 10) || 30;
          const transcript = await dictateOnce(config, maxSec);
          if (!transcript) {
            console.log(chalk.dim('  [dictate] no transcript captured.'));
            continue;
          }
          console.log(theme.dim('  [dictate] ') + chalk.white(transcript));
          messages.push({ role: 'user', content: transcript });
        } else if (result.injectPrompt === PROMODE_ACTIVATE_SENTINEL) {
          const activation = await runPromodeActivationConsent(rl, process.cwd(), session.id);
          if (!activation.accepted) continue;
          mode.current = 'promode';
          enablePromodeMode({
            cwd: process.cwd(),
            config,
            onStartLoop: () => startPromodeFromRepl(),
          });
        } else if (result.injectPrompt === '__PICK_MODEL__') {
          // OpenRouter model picker — same sentinel-into-the-REPL
          // pattern as /dictate + /swarm because handleSlashCommand
          // is sync but fetching the catalog + showing the picker
          // is async. Selection sets config.model + saves; no
          // injectPrompt cascades into runQuery.
          const { pick } = await import('./picker.js');
          const { fetchOpenRouterModels, formatPricing } = await import('./openrouter-models.js');
          console.log(chalk.dim('  Fetching OpenRouter catalog…'));
          const models = await fetchOpenRouterModels();
          if (models.length === 0) {
            console.log(chalk.yellow('  Could not fetch model catalog (network error or rate limit).'));
            console.log(chalk.dim('  Use /model <id> with a known model name, or check your connection.'));
            continue;
          }
          const items = models.map((m) => ({
            label: m.id,
            hint: formatPricing(m),
            description: m.name !== m.id ? m.name : undefined,
            value: m.id,
          }));
          const selected = await pick(items, {
            title: `Grawkus · OpenRouter models  (current: ${config.model})`,
            footer: 'type to filter · ↑↓ to navigate · Enter to pick · Esc to cancel · free models float to the top',
          });
          if (selected) {
            applyModelSelection(config, selected, models.find((m) => m.id === selected));
            saveConfig(config);
            resetClient();
            console.log(chalk.green(`  Model: ${config.model}`));
          } else {
            console.log(chalk.dim('  Cancelled — model unchanged.'));
          }
          continue;
        } else if (result.injectPrompt === '__PICK_APPEARANCE__') {
          await runAppearanceWizard(rl, config);
          continue;
        } else if (result.injectPrompt === '__RESUME_PICK__') {
          const sessions = listSessions();
          if (sessions.length === 0) {
            console.log(theme.dim('  No saved sessions.'));
            continue;
          }
          const { pickSession } = await import('./session-picker.js');
          const selectedId = await pickSession(sessions, { title: 'Grawkus · resume session' });
          if (!selectedId) {
            console.log(theme.dim('  Cancelled — session unchanged.'));
            continue;
          }
          const resumeResult = handleSlashCommand(`/resume ${selectedId}`, config, messages, session, mode);
          if (resumeResult.newMessages !== undefined) {
            messages.length = 0;
            messages.push(...resumeResult.newMessages);
          }
          await saveWithSnapshot();
          continue;
        } else if (result.injectPrompt === '__OPENAI_OAUTH_SMOKE__') {
          const smoke = await runOpenAICodexSmokeTest(config);
          console.log(formatOpenAICodexSmokeResult(smoke));
          continue;
        } else if (result.injectPrompt.startsWith('__SOURCES__')) {
          const sourceInput = decodeSourcesSentinel(result.injectPrompt);
          if (!sourceInput) {
            console.log(chalk.yellow('  /sources: could not parse source query arguments.'));
            continue;
          }
          if (sourceInput.format !== 'json' && sourceInput.json !== true) {
            console.log(chalk.dim('  Searching arXiv, GitHub, Hugging Face, and Kaggle sources...'));
          }
          const sourceResult = await ResearchSourcesTool.call(sourceInput, process.cwd());
          console.log(sourceResult.output);
          continue;
        } else if (result.injectPrompt.startsWith('__BENCHMARK_REPOS__')) {
          const repoCatalogInput = decodeBenchmarkReposSentinel(result.injectPrompt);
          if (!repoCatalogInput) {
            console.log(chalk.yellow('  /benchmark-repos: could not parse catalog arguments.'));
            continue;
          }
          console.log(formatBenchmarkRepoCatalog(repoCatalogInput));
          continue;
        } else if (result.injectPrompt.startsWith('__REPO_DIGEST__')) {
          const repoInput = decodeRepoDigestSentinel(result.injectPrompt);
          if (!repoInput) {
            console.log(chalk.yellow('  /repo-digest: could not parse repository arguments.'));
            continue;
          }
          console.log(chalk.dim('  Inspecting GitHub repository metadata, tree, and key files...'));
          const repoResult = await GitHubRepoDigestTool.call(repoInput, process.cwd());
          console.log(repoResult.output);
          continue;
        } else if (result.injectPrompt.startsWith('__SWARM__')) {
          const payload = decodeSwarmSentinel(result.injectPrompt);
          if (!payload) {
            console.log(chalk.yellow('  /swarm: could not parse swarm payload.'));
            continue;
          }
          let plan = buildSwarmPlan(payload, config.swarm);
          if (payload.mode === 'auto') {
            plan = await runSwarmSetupWizard(rl, plan, config);
          }
          try {
            const agents = resolveAgents(plan.agents);
            console.log(chalk.cyan(`  Swarming ${agents.length} agent(s): ${agents.map((a) => a.name).join(', ')}`));
            console.log(chalk.dim(`  Task: ${plan.task.length > 100 ? plan.task.slice(0, 97) + '...' : plan.task}`));
            console.log(chalk.dim('  Setup: goal, budget/time, platform, assets, quality bar inferred; workers stay analysis-only.'));
            const swarmStart = Date.now();
            const results = await runSwarm(
              agents,
              buildSwarmAgentTask(plan),
              config,
            );
            const output = formatSwarmResults(results, plan);
            console.log(output);
            const elapsed = ((Date.now() - swarmStart) / 1000).toFixed(1);
            const ok = results.filter((r) => !r.error).length;
            console.log(chalk.dim(`\n  swarm complete: ${ok}/${results.length} agent(s) succeeded in ${elapsed}s`));
            // Push the swarm as conversational context so follow-up
            // turns can reason about the consolidated output.
            messages.push({ role: 'user', content: `[/swarm ${payload.mode === 'legacy' ? agents.map((a) => a.name).join(',') + ' ' : ''}${plan.task}]` });
            messages.push({ role: 'assistant', content: output.slice(0, 8000) });
            if (payload.execute !== false) {
              const handoff = buildSwarmHandoffPrompt(plan, results);
              messages.push({
                role: 'user',
                content:
                  'Proceed with the swarm handoff. Execute the task using the worker findings as context; do not merely summarize them.\n\n' +
                  handoff,
              });
              await saveWithSnapshot();
              const turnConfig = consumeTurnConfig();
              updateFooter(buildFooterSnapshot(turnConfig, mode.current, session, process.cwd()));
              await runQuery({ config: turnConfig, messages, cwd: process.cwd(), rl, sessionId: session.id, mode: mode.current });
              syncFooter();
            } else {
              console.log(chalk.dim('  plan-only: handoff saved in session context; no execution turn started.'));
            }
          } catch (e) {
            console.log(chalk.red(`  Swarm failed: ${e instanceof Error ? e.message : e}`));
          }
          await saveWithSnapshot();
          continue;
        } else {
          messages.push({ role: 'user', content: result.injectPrompt });
        }
        await saveWithSnapshot();
        const turnConfig = consumeTurnConfig();
        updateFooter(buildFooterSnapshot(turnConfig, mode.current, session, process.cwd()));
        promodeQueryInFlight = true;
        try {
          await runQuery({ config: turnConfig, messages, cwd: process.cwd(), rl, sessionId: session.id, mode: mode.current });
        } finally {
          promodeQueryInFlight = false;
        }
        syncFooter();
        await saveWithSnapshot();
        afterReplTurnPromode();
        continue;
      }
      if (result.handled) continue;
    }

    const instantAnswer = maybeInstantAnswer(trimmed);
    if (instantAnswer) {
      printLocalResponse(instantAnswer);
      messages.push({ role: 'user', content: trimmed });
      messages.push({ role: 'assistant', content: instantAnswer });
      await saveWithSnapshot();
      continue;
    }

    const instantArtifact = maybeCreateInstantArtifact(trimmed, process.cwd());
    if (instantArtifact) {
      printLocalResponse(instantArtifact.message);
      messages.push({ role: 'user', content: trimmed });
      messages.push({ role: 'assistant', content: instantArtifact.assistantMessage });
      await saveWithSnapshot();
      continue;
    }

    // Auto-route model if enabled
    if (autoRouteRole) {
      const complexity = classifyComplexity(trimmed);
      const route = routeModel(config, complexity, autoRouteRole);
      if (route.model !== config.model) {
        console.log(chalk.dim(`  [routing: ${route.reason}]`));
        nextTurnOverride = { model: route.model, source: 'route' };
      }
      autoRouteRole = null;
    }

    // Add user message and run query
    messages.push({ role: 'user', content: trimmed });
    await saveWithSnapshot();

    const turnConfig = consumeTurnConfig();
    updateFooter(buildFooterSnapshot(turnConfig, mode.current, session, process.cwd()));
    promodeQueryInFlight = true;
    try {
      await runQuery({
        config: turnConfig,
        messages,
        cwd: process.cwd(),
        rl,
        sessionId: session.id,
        mode: mode.current,
      });
    } finally {
      promodeQueryInFlight = false;
    }
    syncFooter();

    // Auto-save session
    await saveWithSnapshot();
    afterReplTurnPromode();

    // Strategic compaction check
    const compactionHint = shouldSuggestCompaction(messages, 0, config);
    if (compactionHint) {
      console.log(chalk.yellow(`  ⚡ ${compactionHint.reason} (strategy: ${compactionHint.strategy}, ~${compactionHint.estimatedSavings.toLocaleString()} tokens saveable)`));
    }
  }

  registerPromodeReplBridge(null);
  const { stopPromodeLoop } = await import('./promode/loop.js');
  stopPromodeLoop(process.cwd());

  // Session stop hook + memory persistence
  onSessionEnd(session.id, messages, process.cwd());
  await runHooks({ event: 'SessionStop', sessionId: session.id, cwd: process.cwd(), permissionMode: config.permissionMode });

  // Final save
  await saveWithSnapshot();
  deactivateFooter();
  console.log(chalk.dim(`\nSession saved: ${session.id}`));
  console.log(chalk.dim('Goodbye!\n'));
  rl.close();
  process.exit(0);
}

main().catch((err) => {
  deactivateFooter();
  console.error(chalk.red(`Fatal: ${err.message || err}`));
  process.exit(1);
});
