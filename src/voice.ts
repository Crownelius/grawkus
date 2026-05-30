/**
 * Voice & accessibility module.
 *
 * Two API providers split by concern:
 *   - OpenAI Whisper for STT (push-to-talk dictation)
 *   - ElevenLabs for TTS (assistant + user-echo readout)
 *
 * Audio I/O is handled by src/audio.ts (ffmpeg subprocess). This module is
 * pure API + text logic — it knows nothing about microphones or speakers
 * directly.
 *
 * All entry points degrade gracefully when keys / providers / ffmpeg are
 * unavailable; voice-disabled callers should be a no-op, not a crash.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import chalk from 'chalk';
import type {
  GrawkusConfig, VoiceConfig, VoiceSttConfig, VoiceTtsConfig, VoiceAccessibilityConfig,
} from './types.js';
import { isFfmpegAvailable, playAudioBuffer, recordAudio, audioCue, probeMic, micProbeMessage } from './audio.js';

// ── Default voice ids (ElevenLabs preset voices, available with any key) ──
export const DEFAULT_ASSISTANT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // Rachel
export const DEFAULT_USER_VOICE      = 'AZnzlk1XvdvUeBnXmlld'; // Domi

// ── Config resolution ─────────────────────────────────────
// Voice config can be sparse — most users won't set it at all. These helpers
// resolve undefined → sensible default, and surface "voice usable?" checks
// so call sites stay clean.
export function getVoiceConfig(config: GrawkusConfig): VoiceConfig {
  return config.voice || {};
}

export function isVoiceEnabled(config: GrawkusConfig): boolean {
  return Boolean(config.voice?.enabled);
}

export function getSttKey(config: GrawkusConfig): string {
  // Whisper STT — falls back to the main OpenAI-compatible key. Most users
  // configure OpenRouter as their main provider, in which case Whisper isn't
  // reachable through OpenRouter's free tier; they'll want a separate OpenAI
  // key in voice.stt.apiKey.
  return config.voice?.stt?.apiKey || config.apiKey || '';
}

export function getTtsKey(config: GrawkusConfig): string {
  // ElevenLabs key — no fallback; this is a separate provider.
  return config.voice?.tts?.apiKey || '';
}

export function getSttConfig(config: GrawkusConfig): Required<Omit<VoiceSttConfig, 'apiKey'>> & { apiKey: string } {
  const stt = config.voice?.stt || {};
  return {
    apiKey: getSttKey(config),
    baseURL: stt.baseURL || 'https://api.openai.com/v1',
    model: stt.model || 'whisper-1',
    dictationKey: stt.dictationKey || 'F1',
    autoSubmit: Boolean(stt.autoSubmit),
  };
}

export function getTtsConfig(config: GrawkusConfig): Required<Omit<VoiceTtsConfig, 'apiKey'>> & { apiKey: string } {
  const tts = config.voice?.tts || {};
  return {
    apiKey: getTtsKey(config),
    baseURL: tts.baseURL || 'https://api.elevenlabs.io/v1',
    model: tts.model || 'eleven_turbo_v2_5',
    assistantVoiceId: tts.assistantVoiceId || DEFAULT_ASSISTANT_VOICE,
    userVoiceId: tts.userVoiceId || DEFAULT_USER_VOICE,
    echoUser: tts.echoUser ?? true,
    skipCode: tts.skipCode ?? true,
    speed: tts.speed ?? 1.0,
    stability: tts.stability ?? 0.5,
    similarityBoost: tts.similarityBoost ?? 0.75,
  };
}

export function getAccessibilityConfig(config: GrawkusConfig): Required<VoiceAccessibilityConfig> {
  const a = config.voice?.accessibility || {};
  return {
    screenReader: Boolean(a.screenReader),
    audioCues: a.audioCues ?? true,
    announceErrors: a.announceErrors ?? true,
    announceModeSwitches: a.announceModeSwitches ?? true,
    askBeforeDestructive: a.askBeforeDestructive ?? true,
    longResponseThreshold: a.longResponseThreshold ?? 300,
  };
}

// ── Code stripping for TTS ────────────────────────────────
/**
 * Remove fenced + inline code blocks from text before TTS. Code read aloud is
 * a wall of symbols ("backtick t s c semicolon") that's both useless to a
 * blind user and very long. We replace fenced blocks with a brief audible
 * announcement so the listener knows code WAS produced, just not read.
 */
export function stripCodeForTts(text: string): string {
  let out = text;

  // Fenced blocks: ```lang\n...\n``` or ~~~lang\n...\n~~~
  out = out.replace(/```[\s\S]*?```/g, (match) => {
    const lines = match.split('\n').length - 2;  // minus the fence lines
    if (lines <= 1) return '[code]';
    return `[code block, ${lines} lines]`;
  });
  out = out.replace(/~~~[\s\S]*?~~~/g, (match) => {
    const lines = match.split('\n').length - 2;
    if (lines <= 1) return '[code]';
    return `[code block, ${lines} lines]`;
  });

  // Inline code: `foo` → "foo" (without the backticks, read naturally)
  out = out.replace(/`([^`\n]+)`/g, '$1');

  // Markdown links: [text](url) → just the text
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Headings ###, **bold**, *italic*, etc. — drop the markup, keep the words
  out = out.replace(/^#+\s+/gm, '');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');

  // Bullet markers — let the natural pause between lines handle pacing
  out = out.replace(/^\s*[-*+]\s+/gm, '');

  // Trim consecutive blank lines down to one
  out = out.replace(/\n{3,}/g, '\n\n').trim();

  return out;
}

// ── Long-text segmentation for chunked playback ──────────
/**
 * Split text into sentence-ish chunks so we can stream TTS — play paragraph
 * 1 while paragraph 2 is being synthesized. Also lets the user skip/replay
 * at a meaningful granularity (Alt+D = skip, Alt+A = replay).
 *
 * Splits on paragraph boundaries first; chunks larger than ~400 chars are
 * further split on sentence boundaries.
 */
export function chunkForTts(text: string, maxChunkChars = 400): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChunkChars) {
      chunks.push(para);
      continue;
    }
    // Sentence split: . ! ? followed by whitespace/end
    const sentences = para.split(/(?<=[.!?])\s+/);
    let buf = '';
    for (const s of sentences) {
      if ((buf + ' ' + s).length > maxChunkChars && buf) {
        chunks.push(buf.trim());
        buf = s;
      } else {
        buf = buf ? `${buf} ${s}` : s;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
  }
  return chunks.filter((c) => c.length > 0);
}

// ── ElevenLabs TTS client ─────────────────────────────────
/**
 * Synthesize text to speech via ElevenLabs and return the audio bytes.
 * Returns null when not configured or on error — callers fall back silently
 * to text-only output rather than crashing the REPL.
 */
export interface TtsRequestOptions {
  voiceId: string;
  model?: string;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
}

export async function synthesizeSpeech(
  text: string,
  cfg: GrawkusConfig,
  opts: TtsRequestOptions,
): Promise<Buffer | null> {
  const tts = getTtsConfig(cfg);
  if (!tts.apiKey) return null;
  if (!text.trim()) return null;

  const voiceId = opts.voiceId;
  const url = `${tts.baseURL.replace(/\/+$/, '')}/text-to-speech/${encodeURIComponent(voiceId)}`;

  const body = {
    text,
    model_id: opts.model || tts.model,
    voice_settings: {
      stability: opts.stability ?? tts.stability,
      similarity_boost: opts.similarityBoost ?? tts.similarityBoost,
      speed: opts.speed ?? tts.speed,
    },
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': tts.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.log(chalk.dim(`  [voice] TTS error ${resp.status}: ${errText.slice(0, 200)}`));
      return null;
    }

    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.dim(`  [voice] TTS request failed: ${msg}`));
    return null;
  }
}

/**
 * Convenience: synthesize + play. Returns true if played successfully.
 * Use this for short utterances (mode announcements, beeps, errors).
 *
 * Honors the panic-stop suppression window set by Shift+F6 — if
 * __voiceSuppressUntilMs is in the future, every speak() call no-ops
 * silently. F6 / F8 only abort the CURRENT chunk; panic-stop has to
 * also prevent incidental utterances (error announcements, mode
 * switches, audio cues) from immediately filling the silence.
 */
export async function speak(
  text: string,
  cfg: GrawkusConfig,
  opts: TtsRequestOptions & { signal?: AbortSignal },
): Promise<boolean> {
  const suppressUntil = (globalThis as { __voiceSuppressUntilMs?: number }).__voiceSuppressUntilMs ?? 0;
  if (suppressUntil > Date.now()) return false;
  const buf = await synthesizeSpeech(text, cfg, opts);
  if (!buf) return false;
  return await playAudioBuffer(buf, opts.signal);
}

/**
 * Speak the assistant's response, chunked, with code stripped if configured.
 * Returns the number of chunks played. Honors the cancel signal so Ctrl+C
 * during playback halts cleanly.
 */
export async function speakAssistantResponse(
  text: string,
  cfg: GrawkusConfig,
  signal?: AbortSignal,
): Promise<number> {
  const tts = getTtsConfig(cfg);
  if (!tts.apiKey) return 0;

  let prepared = tts.skipCode ? stripCodeForTts(text) : text;
  if (!prepared.trim()) return 0;

  const chunks = chunkForTts(prepared);
  let played = 0;
  for (const chunk of chunks) {
    if (signal?.aborted) break;
    const ok = await speak(chunk, cfg, {
      voiceId: tts.assistantVoiceId,
      signal,
    });
    if (ok) played++;
  }
  return played;
}

/**
 * Speak the user's input back in the user-echo voice. Skipped for slash
 * commands (`/foo …`) since those aren't worth re-reading.
 */
export async function speakUserEcho(
  text: string,
  cfg: GrawkusConfig,
  signal?: AbortSignal,
): Promise<boolean> {
  const tts = getTtsConfig(cfg);
  if (!tts.apiKey || !tts.echoUser) return false;
  if (text.trim().startsWith('/') || text.trim().startsWith('!')) return false;
  return await speak(text, cfg, { voiceId: tts.userVoiceId, signal });
}

// ── OpenAI Whisper STT client ─────────────────────────────
/**
 * Send recorded audio to Whisper and return the transcript. Returns null on
 * failure; caller logs + degrades.
 */
export async function transcribeAudio(
  audio: Buffer,
  cfg: GrawkusConfig,
  format: 'wav' | 'mp3' | 'webm' = 'wav',
): Promise<string | null> {
  const stt = getSttConfig(cfg);
  if (!stt.apiKey) return null;
  if (audio.length === 0) return null;

  // OpenAI requires a multipart upload. fetch supports FormData on Node 18+.
  // Convert Buffer → Uint8Array → Blob. Node 24 narrowed Blob's input type
  // to require a non-shared ArrayBuffer, so passing a raw Buffer trips a
  // type error; the .buffer slice keeps it explicit.
  const u8 = new Uint8Array(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer);
  const form = new FormData();
  form.append('file', new Blob([u8], { type: `audio/${format}` }), `recording.${format}`);
  form.append('model', stt.model);

  const url = `${stt.baseURL.replace(/\/+$/, '')}/audio/transcriptions`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stt.apiKey}`,
      },
      body: form as unknown as BodyInit,
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.log(chalk.dim(`  [voice] Whisper error ${resp.status}: ${errText.slice(0, 200)}`));
      return null;
    }
    const json = (await resp.json()) as { text?: string };
    return (json.text || '').trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.dim(`  [voice] Whisper request failed: ${msg}`));
    return null;
  }
}

// ── Top-level dictation flow ─────────────────────────────
/**
 * Record from the mic, send to Whisper, return the transcript. Plays audio
 * cues at each state change so blind users can follow what's happening.
 *
 * Caller is responsible for starting/stopping the recording via the
 * `recordController` — but for the simple "one-shot" case (e.g. `/dictate`
 * slash command), `dictateOnce(maxSeconds)` is the easy entry point.
 */
export async function dictateOnce(
  cfg: GrawkusConfig,
  maxSeconds = 30,
): Promise<string | null> {
  const a = getAccessibilityConfig(cfg);

  const stt = getSttConfig(cfg);
  if (!stt.apiKey) {
    console.log(chalk.yellow('  [voice] STT not configured. Set voice.stt.apiKey (OpenAI key) via /voice config.'));
    return null;
  }

  // Probe the mic / ffmpeg up-front so a missing device fails fast with
  // a specific message rather than silently spawning a zombie ffmpeg.
  const probe = await probeMic();
  if (probe !== 'ok') {
    console.log(chalk.yellow(`  [voice] ${micProbeMessage(probe)}`));
    if (a.audioCues) await audioCue('error');
    return null;
  }

  if (a.audioCues) await audioCue('recording-start');
  console.log(chalk.dim('  [voice] Recording (max ' + maxSeconds + 's)…'));

  const audio = await recordAudio(maxSeconds);
  if (!audio || audio.length === 0) {
    if (a.audioCues) await audioCue('error');
    console.log(chalk.dim('  [voice] No audio captured.'));
    return null;
  }

  if (a.audioCues) await audioCue('processing');
  console.log(chalk.dim('  [voice] Transcribing…'));

  const transcript = await transcribeAudio(audio, cfg, 'wav');
  if (!transcript) {
    if (a.audioCues) await audioCue('error');
    return null;
  }

  if (a.audioCues) await audioCue('done');
  return transcript;
}

// ── Status print ─────────────────────────────────────────
/**
 * Pretty-print voice config status for /voice (no args).
 */
export function printVoiceStatus(cfg: GrawkusConfig): void {
  const v = getVoiceConfig(cfg);
  const stt = getSttConfig(cfg);
  const tts = getTtsConfig(cfg);
  const a = getAccessibilityConfig(cfg);

  console.log(chalk.cyan('\n  voice & accessibility'));
  console.log(chalk.dim(`    enabled:           ${v.enabled ? '✓ yes' : '✗ no'}`));
  console.log('');
  console.log(chalk.dim(`    STT (dictation):   ${stt.apiKey ? `✓ key set · ${stt.model}` : '✗ no key'}`));
  console.log(chalk.dim(`      dictation key:   ${stt.dictationKey}`));
  console.log(chalk.dim(`      auto-submit:     ${stt.autoSubmit ? 'yes' : 'no'}`));
  console.log('');
  console.log(chalk.dim(`    TTS (readout):     ${tts.apiKey ? `✓ key set · ${tts.model}` : '✗ no key'}`));
  console.log(chalk.dim(`      assistant voice: ${tts.assistantVoiceId}`));
  console.log(chalk.dim(`      user voice:      ${tts.userVoiceId}`));
  console.log(chalk.dim(`      echo user:       ${tts.echoUser ? 'yes' : 'no'}`));
  console.log(chalk.dim(`      skip code:       ${tts.skipCode ? 'yes' : 'no'}`));
  console.log(chalk.dim(`      speed:           ${tts.speed}x`));
  console.log('');
  console.log(chalk.dim(`    accessibility:`));
  console.log(chalk.dim(`      screen reader:   ${a.screenReader ? 'yes' : 'no'}`));
  console.log(chalk.dim(`      audio cues:      ${a.audioCues ? 'yes' : 'no'}`));
  console.log(chalk.dim(`      announce errors: ${a.announceErrors ? 'yes' : 'no'}`));
  console.log(chalk.dim(`      announce modes:  ${a.announceModeSwitches ? 'yes' : 'no'}`));
  console.log(chalk.dim(`      ask destructive: ${a.askBeforeDestructive ? 'yes' : 'no'}`));
  console.log(chalk.dim(`      long-resp words: ${a.longResponseThreshold}`));
  console.log('');
  console.log(chalk.dim('    Hotkeys (when enabled) — all bare F-keys, screen-reader-safe:'));
  console.log(chalk.dim('      Status announcements (instant readouts):'));
  console.log(chalk.dim('        F1   what is happening + elapsed'));
  console.log(chalk.dim('        F2   where am I — model / provider / mode / permissions'));
  console.log(chalk.dim('        F3   re-speak full last response'));
  console.log(chalk.dim('        F4   re-speak summary of last response'));
  console.log(chalk.dim('      Dictation + playback:'));
  console.log(chalk.dim('        F5   dictate (toggle)   F6   pause       F7   replay last chunk'));
  console.log(chalk.dim('        F8   skip current       F9   speed +     F10  speed –'));
  console.log(chalk.dim('      Read-back (browser-reserved keys — free in every terminal):'));
  console.log(chalk.dim('        F11  read current input buffer    F12  read your previous turn'));
  console.log(chalk.dim('      Shift + F-row (informational + control):'));
  console.log(chalk.dim('        Shift+F1  queued input            Shift+F2   key-pool health'));
  console.log(chalk.dim('        Shift+F3  last tool-call result   Shift+F4   toggle screen-reader'));
  console.log(chalk.dim('        Shift+F5  soft-cancel turn        Shift+F6   panic-stop TTS (5s)'));
  console.log(chalk.dim('        Shift+F12 read this hotkey list aloud'));
  console.log('');
}
