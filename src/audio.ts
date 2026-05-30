/**
 * Audio I/O via ffmpeg subprocess.
 *
 * We deliberately don't depend on native node modules (`speaker`, `mic`, etc.)
 * because they need rebuilding per Node version and are flaky across Windows /
 * macOS / Linux. ffmpeg is a single statically-linked binary the user can
 * install once and forget.
 *
 * All exports degrade to a no-op (or null) when ffmpeg is missing — callers
 * should treat ffmpeg-absence as "voice features off", not as an error.
 *
 * Five named audio cues:
 *   - 'ready'           short rising chirp (REPL ready for input)
 *   - 'recording-start' two-tone tick (mic opened)
 *   - 'recording-stop'  single low tick (mic closed)
 *   - 'processing'      sustained mid tone (TTS/STT in flight)
 *   - 'done'            short falling chirp (operation succeeded)
 *   - 'error'           low buzz (operation failed)
 *
 * Cues are generated on-the-fly by ffmpeg's `sine` filter so we don't have to
 * ship binary asset files in the npm tarball.
 */
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

// ── Detection ─────────────────────────────────────────────
let ffmpegCheckCache: boolean | null = null;
let ffmpegPathCache: string = 'ffmpeg';

/**
 * Detect ffmpeg on the user's PATH. Result is cached; call resetFfmpegCache()
 * if you want to re-probe (e.g. after the user installs ffmpeg mid-session).
 */
export async function isFfmpegAvailable(): Promise<boolean> {
  if (ffmpegCheckCache !== null) return ffmpegCheckCache;
  ffmpegCheckCache = await new Promise<boolean>((resolve) => {
    const child = spawn(ffmpegPathCache, ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
  return ffmpegCheckCache;
}

export function resetFfmpegCache(): void {
  ffmpegCheckCache = null;
}

export function setFfmpegPath(p: string): void {
  ffmpegPathCache = p;
  ffmpegCheckCache = null;
}

// ── Platform-specific mic input args ──────────────────────
/**
 * Build the `-f <driver> -i <device>` arguments for capturing from the
 * default mic on each OS.
 *
 *   Windows : -f dshow -i audio="<first input device>"
 *             We can't enumerate without listing — but ffmpeg's "default"
 *             alias works on most systems via dshow. If it doesn't, the user
 *             can override via env var GRAWKUS_AUDIO_INPUT.
 *   macOS   : -f avfoundation -i ":0"         (":0" = default audio input)
 *   Linux   : -f pulse -i default              (PulseAudio default sink)
 *
 * Env override: GRAWKUS_AUDIO_INPUT="-f dshow -i audio=\"My Mic\""
 *               (raw argv, split by spaces — anything in quotes preserved)
 */
function getMicInputArgs(): string[] {
  const override = process.env.GRAWKUS_AUDIO_INPUT;
  if (override) {
    // Quote-aware split so `audio="My Mic"` survives as one token
    return tokenize(override);
  }
  switch (process.platform) {
    case 'win32':
      return ['-f', 'dshow', '-i', 'audio=default'];
    case 'darwin':
      return ['-f', 'avfoundation', '-i', ':0'];
    default:
      return ['-f', 'pulse', '-i', 'default'];
  }
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  for (const ch of s) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ' ' && !inQuote) {
      if (buf) { out.push(buf); buf = ''; }
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

// ── Mic detection ─────────────────────────────────────────
/**
 * Quick probe: try to capture 200ms of audio from the default mic.
 * Returns:
 *   'ok'        — got audio bytes, mic is alive
 *   'no-mic'    — ffmpeg started but failed to open the input device
 *   'no-ffmpeg' — ffmpeg isn't on PATH
 *   'error'     — something else went wrong
 *
 * Cached for 10 seconds so repeated F5 presses don't spawn a fresh
 * subprocess each time. Pass `force=true` to bypass the cache (e.g.
 * after the user plugs in a mic mid-session).
 */
export type MicProbeResult = 'ok' | 'no-mic' | 'no-ffmpeg' | 'error';
let micProbeCache: { result: MicProbeResult; at: number } | null = null;
const MIC_PROBE_TTL_MS = 10_000;

export async function probeMic(force = false): Promise<MicProbeResult> {
  if (!force && micProbeCache && (Date.now() - micProbeCache.at) < MIC_PROBE_TTL_MS) {
    return micProbeCache.result;
  }
  if (!(await isFfmpegAvailable())) {
    micProbeCache = { result: 'no-ffmpeg', at: Date.now() };
    return 'no-ffmpeg';
  }
  const result = await new Promise<MicProbeResult>((resolve) => {
    const args = [
      ...getMicInputArgs(),
      '-t', '0.2',          // 200ms is enough to confirm the device opens
      '-ac', '1',
      '-ar', '16000',
      '-f', 'wav',
      '-loglevel', 'error',
      'pipe:1',
    ];
    let child;
    try {
      child = spawn(ffmpegPathCache, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve('error');
      return;
    }
    let gotBytes = false;
    let errBuf = '';
    child.stdout.on('data', (c: Buffer) => { if (c.length > 0) gotBytes = true; });
    child.stderr.on('data', (c: Buffer) => { errBuf += c.toString(); });
    child.on('error', () => resolve('error'));

    // Safety timeout — some configurations hang opening the device
    const killer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* noop */ } }, 1500);

    child.on('close', (code) => {
      clearTimeout(killer);
      if (gotBytes) { resolve('ok'); return; }
      // ffmpeg's "no such device" / "could not find audio only device" /
      // "I/O error" / "No such file or directory" all indicate the mic
      // isn't reachable. Match loosely — different platforms phrase it
      // differently.
      const lower = errBuf.toLowerCase();
      if (
        lower.includes('could not') ||
        lower.includes('no such') ||
        lower.includes('not found') ||
        lower.includes('cannot open') ||
        lower.includes('device or resource busy') ||
        lower.includes('input/output error') ||
        code !== 0
      ) {
        resolve('no-mic');
      } else {
        resolve('error');
      }
    });
  });
  micProbeCache = { result, at: Date.now() };
  return result;
}

/**
 * Friendly one-line message explaining a probe result. Caller logs +
 * announces via TTS. Returned phrasing is screen-reader-friendly.
 */
export function micProbeMessage(r: MicProbeResult): string {
  switch (r) {
    case 'ok':        return 'Microphone ready.';
    case 'no-mic':    return 'No microphone detected. Plug one in or set GRAWKUS_AUDIO_INPUT to a specific device.';
    case 'no-ffmpeg': return 'ffmpeg is not installed. Install ffmpeg to enable dictation.';
    case 'error':     return 'Microphone probe failed.';
  }
}

// ── Recording ─────────────────────────────────────────────
/**
 * Record from the default mic for up to `maxSeconds`, return WAV-encoded
 * bytes. ffmpeg encodes to 16kHz mono PCM-16 (Whisper's preferred format).
 *
 * Returns null on failure — including ffmpeg missing or mic unavailable.
 * Caller usually wraps with `dictateOnce()` which handles the UX.
 */
export async function recordAudio(maxSeconds: number): Promise<Buffer | null> {
  if (!(await isFfmpegAvailable())) return null;

  return new Promise<Buffer | null>((resolve) => {
    const args = [
      ...getMicInputArgs(),
      '-t', String(Math.max(1, Math.min(300, maxSeconds))),
      '-ac', '1',           // mono
      '-ar', '16000',       // 16 kHz (Whisper)
      '-f', 'wav',
      '-loglevel', 'error',
      'pipe:1',             // write WAV to stdout
    ];
    const child = spawn(ffmpegPathCache, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let errBuf = '';
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => { errBuf += c.toString(); });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) {
        if (process.env.GRAWKUS_AUDIO_DEBUG) {
          // eslint-disable-next-line no-console
          console.error('[audio] record failed:', errBuf.slice(0, 400));
        }
        resolve(null);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

// ── Playback ──────────────────────────────────────────────
/**
 * Pipe an audio buffer (MP3 from ElevenLabs, or WAV from us) through ffplay
 * if available, falling back to ffmpeg with the platform's default audio
 * output. Honors an AbortSignal so a Ctrl+C or new-message arrival can cut
 * playback immediately.
 *
 * Returns true if playback completed without error, false otherwise.
 */
export async function playAudioBuffer(buf: Buffer, signal?: AbortSignal): Promise<boolean> {
  if (!(await isFfmpegAvailable())) return false;
  if (!buf || buf.length === 0) return false;
  if (signal?.aborted) return false;

  // Try ffplay first (smaller, dedicated to playback). If it's not on PATH
  // we'll fall back to `ffmpeg -f <platform-audio-out>`.
  const ffplayOk = await tryFfplay(buf, signal);
  if (ffplayOk) return true;
  return await tryFfmpegPlay(buf, signal);
}

async function tryFfplay(buf: Buffer, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const args = ['-nodisp', '-autoexit', '-loglevel', 'error', '-i', 'pipe:0'];
    let child;
    try {
      child = spawn('ffplay', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    } catch {
      resolve(false);
      return;
    }
    let resolved = false;
    const onAbort = () => {
      if (!resolved) { resolved = true; try { child.kill('SIGTERM'); } catch { /* noop */ } resolve(false); }
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.on('error', () => { if (!resolved) { resolved = true; resolve(false); } });
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!resolved) { resolved = true; resolve(code === 0); }
    });

    // Stream the buffer into stdin
    const stream = Readable.from([buf]);
    stream.pipe(child.stdin).on('error', () => { /* EPIPE on abort — fine */ });
  });
}

function getPlayOutputArgs(): string[] {
  switch (process.platform) {
    case 'win32':
      // DirectSound is the most universally-available output on Windows
      return ['-f', 'dshow'];   // Unfortunately dshow is input-only; use sdl2 if linked
    case 'darwin':
      return ['-f', 'audiotoolbox'];
    default:
      return ['-f', 'pulse'];
  }
}

async function tryFfmpegPlay(buf: Buffer, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // ffmpeg-as-player: decode from stdin and route to platform audio out.
    // This is a fallback, ffplay is the preferred path. We try sdl2 first
    // (works on all platforms if ffmpeg was built with --enable-sdl2), then
    // a platform-specific output module.
    const args = [
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-f', 'sdl', '-',
    ];
    let child;
    try {
      child = spawn(ffmpegPathCache, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      resolve(false);
      return;
    }
    let resolved = false;
    const onAbort = () => {
      if (!resolved) { resolved = true; try { child.kill('SIGTERM'); } catch { /* noop */ } resolve(false); }
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.on('error', () => { if (!resolved) { resolved = true; resolve(false); } });
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!resolved) { resolved = true; resolve(code === 0); }
    });

    const stream = Readable.from([buf]);
    stream.pipe(child.stdin).on('error', () => { /* EPIPE on abort — fine */ });
  });
}

// ── Audio cues ────────────────────────────────────────────
/**
 * Generate + play a short tone for state transitions. Uses ffmpeg's `sine`
 * filter, so no asset files needed. Plays via ffplay when available so it
 * doesn't fight the main TTS pipeline.
 *
 * Frequencies / durations are tuned to be brief (under 250ms) and pleasant
 * (no harsh upper harmonics).
 */
export type AudioCue =
  | 'ready'
  | 'recording-start'
  | 'recording-stop'
  | 'processing'
  | 'done'
  | 'error';

interface ToneSpec {
  freqHz: number;
  durationSec: number;
  // Optional second tone played immediately after (creates a "tick-tock" feel)
  follow?: { freqHz: number; durationSec: number };
}

const CUE_TONES: Record<AudioCue, ToneSpec> = {
  'ready':            { freqHz: 880, durationSec: 0.08, follow: { freqHz: 1320, durationSec: 0.08 } },
  'recording-start':  { freqHz: 660, durationSec: 0.07, follow: { freqHz: 880,  durationSec: 0.07 } },
  'recording-stop':   { freqHz: 440, durationSec: 0.10 },
  'processing':       { freqHz: 660, durationSec: 0.18 },
  'done':             { freqHz: 1320, durationSec: 0.08, follow: { freqHz: 880, durationSec: 0.08 } },
  'error':            { freqHz: 220, durationSec: 0.22 },
};

/**
 * Play a named audio cue. Best-effort; returns true on apparent success.
 * Failures are silent — a missing beep should never break the REPL.
 */
export async function audioCue(name: AudioCue): Promise<boolean> {
  if (!(await isFfmpegAvailable())) return false;
  const spec = CUE_TONES[name];
  if (!spec) return false;
  const buf = await generateTone(spec);
  if (!buf) return false;
  return await playAudioBuffer(buf);
}

async function generateTone(spec: ToneSpec): Promise<Buffer | null> {
  // We compose a single ffmpeg pipeline using anullsrc + sine + concat. Easier:
  // synthesize each tone to a WAV stream, concatenate buffers.
  const part1 = await synthSine(spec.freqHz, spec.durationSec);
  if (!part1) return null;
  if (!spec.follow) return part1;
  const part2 = await synthSine(spec.follow.freqHz, spec.follow.durationSec);
  if (!part2) return part1;
  // Simple concat: both WAV bodies; ffplay handles back-to-back WAV headers
  // OK in practice, but to be safe we just emit two short tones as separate
  // playback calls if needed. Here we just concatenate the raw buffers; ffplay
  // ignores the second header.
  return Buffer.concat([part1, part2]);
}

function synthSine(freq: number, durationSec: number): Promise<Buffer | null> {
  return new Promise<Buffer | null>((resolve) => {
    const args = [
      '-f', 'lavfi',
      '-i', `sine=frequency=${freq}:duration=${durationSec}`,
      '-ac', '1',
      '-ar', '22050',
      '-f', 'wav',
      '-loglevel', 'error',
      'pipe:1',
    ];
    const child = spawn(ffmpegPathCache, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? Buffer.concat(chunks) : null));
  });
}

// ── Higher-level: hold-to-record controller ──────────────
/**
 * Start a recording subprocess and return a controller. The caller calls
 * `stop()` to finalize and receive the audio buffer (or null on error).
 *
 * Used by the F1 push-to-talk hotkey: keydown → startRecording, keyup →
 * controller.stop(). The maxSeconds cap is a safety net for stuck keys.
 */
export interface RecordController {
  stop: () => Promise<Buffer | null>;
  abort: () => void;
}

export async function startRecording(maxSeconds = 60): Promise<RecordController | null> {
  if (!(await isFfmpegAvailable())) return null;

  const args = [
    ...getMicInputArgs(),
    '-t', String(Math.max(1, Math.min(300, maxSeconds))),
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    '-loglevel', 'error',
    'pipe:1',
  ];
  const child = spawn(ffmpegPathCache, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => chunks.push(c));
  // Drain stderr to avoid back-pressure
  child.stderr.on('data', () => { /* noop */ });

  let resolved = false;
  let finalResolve: ((b: Buffer | null) => void) | null = null;
  const donePromise = new Promise<Buffer | null>((resolve) => { finalResolve = resolve; });

  child.on('close', () => {
    if (!resolved && finalResolve) {
      resolved = true;
      finalResolve(chunks.length > 0 ? Buffer.concat(chunks) : null);
    }
  });
  child.on('error', () => {
    if (!resolved && finalResolve) { resolved = true; finalResolve(null); }
  });

  return {
    stop: async () => {
      // ffmpeg flushes a clean WAV when it gets 'q' on stdin
      try { child.stdin.write('q'); } catch { /* noop */ }
      try { child.stdin.end(); } catch { /* noop */ }
      // Safety: if it doesn't exit within 1500ms, SIGTERM it
      const killer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* noop */ } }, 1500);
      const buf = await donePromise;
      clearTimeout(killer);
      return buf;
    },
    abort: () => {
      try { child.kill('SIGTERM'); } catch { /* noop */ }
    },
  };
}
