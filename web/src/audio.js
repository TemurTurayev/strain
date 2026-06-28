// audio.js — self-contained WebAudio blips for STRAIN (toggleable, no assets).
//
// Per §Module contracts: exports initAudio(), play(name), setMuted(bool).
// Tiny distinct oscillator beeps with short envelopes. Never throws if audio
// is unavailable; mute state is persisted in localStorage.
//
// This module imports nothing from ./engine.js because audio needs no engine
// state — it only reacts to event names the orchestrator passes to play().

const STORAGE_KEY = "strain.muted";

// Module-private singletons (lazily created on first user gesture).
let ctx = null;
let master = null;
let muted = readMutedFromStorage();
let humOsc = null, humGain = null; // continuous low pressure hum (rises with tension)

// name → { wave, freq (Hz), dur (s), gain (peak) }
// Each event is a distinct pitch/timbre so the ear can tell them apart.
const VOICES = {
  replicate: { wave: "sine",     freq: 330, dur: 0.07, gain: 0.18 }, // soft low blip
  suppress:  { wave: "sine",     freq: 220, dur: 0.12, gain: 0.16 }, // duller, lower
  provoke:   { wave: "square",   freq: 520, dur: 0.09, gain: 0.14 }, // edgy buzz
  window:    { wave: "triangle", freq: 740, dur: 0.10, gain: 0.16 }, // bright open chime
  hit:       { wave: "sawtooth", freq: 160, dur: 0.10, gain: 0.16 }, // harsh thud
  win:       { wave: "triangle", freq: 660, dur: 0.16, gain: 0.20 }, // rising two-note (see play)
  loss:      { wave: "sine",     freq: 200, dur: 0.22, gain: 0.18 }, // falling two-note (see play)
};

function readMutedFromStorage() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Lazily create the AudioContext. Call this from a user-gesture handler
 * (click/keydown) so browsers allow audio. Safe to call repeatedly.
 * Never throws — returns the context or null if audio is unavailable.
 */
export function initAudio() {
  if (ctx) {
    resumeIfSuspended();
    return ctx;
  }
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

function resumeIfSuspended() {
  try {
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * Play a named event beep. Unknown names and unavailable audio are no-ops.
 * @param {"replicate"|"suppress"|"provoke"|"window"|"hit"|"win"|"loss"} name
 */
export function play(name) {
  if (muted) return;
  const voice = VOICES[name];
  if (!voice) return;
  // If audio was never initialized, try once (harmless if no gesture yet).
  if (!ctx) initAudio();
  if (!ctx || !master) return;
  resumeIfSuspended();

  try {
    const now = ctx.currentTime;
    if (name === "win") {
      blip(voice.wave, 523, now, 0.12, voice.gain);          // C5
      blip(voice.wave, 784, now + 0.11, 0.16, voice.gain);   // G5 — rising
    } else if (name === "loss") {
      blip(voice.wave, 240, now, 0.16, voice.gain);
      blip(voice.wave, 150, now + 0.14, 0.24, voice.gain);   // falling
    } else {
      blip(voice.wave, voice.freq, now, voice.dur, voice.gain);
    }
  } catch {
    /* never throw from audio */
  }
}

// One oscillator + short attack/decay envelope. Self-cleans on stop.
function blip(wave, freq, startTime, dur, peak) {
  try {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, startTime);

    const attack = 0.005;
    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(peak, startTime + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

    osc.connect(env);
    env.connect(master);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
    osc.onended = () => {
      try {
        osc.disconnect();
        env.disconnect();
      } catch {
        /* ignore */
      }
    };
  } catch {
    /* never throw from audio */
  }
}

/**
 * Toggle global mute and persist it. Affects current + future sounds.
 * @param {boolean} value
 */
export function setMuted(value) {
  muted = !!value;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, muted ? "1" : "0");
  } catch {
    /* storage may be unavailable; keep in-memory state */
  }
  try {
    if (master && ctx) {
      // Ramp to avoid a click; respects current time.
      master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.01);
    }
  } catch {
    /* ignore */
  }
}

/** Current mute state (convenience for the UI toggle's initial label). */
export function isMuted() {
  return muted;
}

// ---------------------------------------------------------------------------
// Continuous tension hum: a low sine whose volume + pitch rise with `level`
// (0..1). Routed through master, so global mute silences it too. No-op until
// the AudioContext exists (i.e. after a user gesture).
// ---------------------------------------------------------------------------
function ensureHum() {
  if (humOsc || !ctx || !master) return;
  try {
    humOsc = ctx.createOscillator();
    humGain = ctx.createGain();
    humOsc.type = "sine";
    humOsc.frequency.value = 42;
    humGain.gain.value = 0;
    humOsc.connect(humGain);
    humGain.connect(master);
    humOsc.start();
  } catch {
    humOsc = null;
    humGain = null;
  }
}

/** Set the tension hum intensity. level 0..1. */
export function setHum(level) {
  if (!ctx) return;
  ensureHum();
  if (!humGain || !humOsc) return;
  const l = Math.max(0, Math.min(1, level));
  try {
    humGain.gain.setTargetAtTime(l * l * 0.09, ctx.currentTime, 0.3);
    humOsc.frequency.setTargetAtTime(40 + l * 34, ctx.currentTime, 0.3);
  } catch {
    /* never throw from audio */
  }
}

/** Fade the hum out (call when leaving the play screen). */
export function stopHum() {
  try {
    if (humGain && ctx) humGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  } catch {
    /* ignore */
  }
}
