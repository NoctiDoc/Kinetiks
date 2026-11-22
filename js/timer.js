/**
 * Kinetix Lab — Chrono Blindé iOS, Wake Lock, Audio & Dictée Vocale (js/timer.js)
 * - Calcul strict par horodatage absolu (remaining = Math.max(0, endTime - Date.now()))
 *   immunisé contre le gel de setInterval lors du verrouillage écran iOS/Safari.
 * - Screen Wake Lock API (navigator.wakeLock) avec réacquisition automatique sur visibilitychange.
 * - Signaux sonores Web Audio API (zéro fichier audio externe) + vibration haptique.
 * - Annonces vocales de fin de repos (Web Speech API) + Dictée vocale mains libres
 *   (Web Speech Recognition natif ou Groq Whisper via MediaRecorder).
 */

import { transcribeAudioWithGroqWhisper } from './ai-router.js';

/* ==========================================================================
   1. AUDIO SYNTHÉTIQUE WEB AUDIO API & ANNONCES VOCALES
   ========================================================================== */

let audioCtx = null;

export function unlockAudioContext() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function playTone({ frequency = 880, durationSec = 0.14, volume = 0.18, type = 'triangle' } = {}) {
  const ctx = unlockAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  } catch {
    // Audio bloqué par politique navigateur
  }
}

export function playRestFinishedSignal({ voiceEnabled = true, label = '' } = {}) {
  // Double bip chronographe suisse net
  playTone({ frequency: 880, durationSec: 0.14, volume: 0.22 });
  setTimeout(() => playTone({ frequency: 1174.66, durationSec: 0.26, volume: 0.25 }), 170);

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([140, 70, 220]);
  }

  if (voiceEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const phrase = label
        ? `Repos terminé. Série suivante : ${label}.`
        : 'Repos terminé. Prêt pour la série suivante.';
      const utter = new SpeechSynthesisUtterance(phrase);
      utter.lang = 'fr-FR';
      utter.rate = 1.05;
      window.speechSynthesis.speak(utter);
    } catch {
      // Synthèse vocale indisponible
    }
  }
}

/* ==========================================================================
   2. SCREEN WAKE LOCK API (RÉACQUISITION AUTOMATIQUE SUR VISIBILITYCHANGE)
   ========================================================================== */

export class WorkoutWakeLock {
  constructor(onStatusChange = null) {
    this.sentinel = null;
    this.wanted = false;
    this.onStatusChange = onStatusChange;

    this._handleVisibility = async () => {
      if (document.visibilityState === 'visible' && this.wanted && !this.sentinel) {
        await this._requestLock();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._handleVisibility);
    }
  }

  async _requestLock() {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      this.onStatusChange?.({ supported: false, active: false });
      return false;
    }
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
        this.onStatusChange?.({ supported: true, active: false });
      });
      this.onStatusChange?.({ supported: true, active: true });
      return true;
    } catch {
      this.onStatusChange?.({ supported: true, active: false });
      return false;
    }
  }

  async acquire() {
    this.wanted = true;
    return this._requestLock();
  }

  async release() {
    this.wanted = false;
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {
        // Ignorer
      }
      this.sentinel = null;
    }
    this.onStatusChange?.({
      supported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
      active: false,
    });
  }
}

/* ==========================================================================
   3. CHRONO DE REPOS PAR HORODATAGE ABSOLU (IMMUNISÉ VERROUILLAGE iOS)
   ========================================================================== */

export function formatTimerMMSS(ms) {
  const totalSec = Math.ceil(Math.max(0, ms) / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export class RestTimerController {
  constructor({ onTick, onFinish, voiceEnabled = true } = {}) {
    this.onTick = onTick;
    this.onFinish = onFinish;
    this.voiceEnabled = voiceEnabled;

    this.endTime = null;
    this.durationMs = 0;
    this.pausedRemainingMs = null;
    this.label = '';
    this.lastBeepSecond = null;
    this._intervalId = null;

    this._handleForeground = () => {
      if (document.visibilityState === 'visible' && this.endTime !== null) {
        this._tick(true);
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._handleForeground);
      window.addEventListener('focus', this._handleForeground);
    }
  }

  start(durationSec, label = '') {
    unlockAudioContext();
    const ms = Math.max(5, Number(durationSec) || 90) * 1000;
    this.durationMs = ms;
    this.endTime = Date.now() + ms;
    this.pausedRemainingMs = null;
    this.label = label;
    this.lastBeepSecond = null;
    this._ensureTicker();
    this._tick(false);
  }

  addSeconds(deltaSec) {
    const deltaMs = Number(deltaSec) * 1000;
    if (this.pausedRemainingMs !== null) {
      this.pausedRemainingMs = Math.max(5000, this.pausedRemainingMs + deltaMs);
      this._emitState(this.pausedRemainingMs, true);
      return;
    }
    if (this.endTime === null) return;
    this.endTime = Math.max(Date.now() + 3000, this.endTime + deltaMs);
    this.durationMs = Math.max(this.durationMs, this.endTime - Date.now());
    this._tick(false);
  }

  pause() {
    if (this.endTime === null) return;
    this.pausedRemainingMs = Math.max(0, this.endTime - Date.now());
    this.endTime = null;
    this._stopTicker();
    this._emitState(this.pausedRemainingMs, true);
  }

  resume() {
    if (this.pausedRemainingMs === null) return;
    unlockAudioContext();
    this.endTime = Date.now() + this.pausedRemainingMs;
    this.pausedRemainingMs = null;
    this._ensureTicker();
    this._tick(false);
  }

  stop() {
    this.endTime = null;
    this.pausedRemainingMs = null;
    this.durationMs = 0;
    this.label = '';
    this._stopTicker();
    this.onTick?.({ active: false, paused: false, remainingMs: 0, formatted: '00:00', progressPct: 0, label: '' });
  }

  setVoiceEnabled(enabled) {
    this.voiceEnabled = Boolean(enabled);
  }

  _ensureTicker() {
    if (this._intervalId !== null) return;
    this._intervalId = setInterval(() => this._tick(false), 200);
  }

  _stopTicker() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  _emitState(remainingMs, paused) {
    const progressPct =
      this.durationMs > 0
        ? Math.max(0, Math.min(100, Math.round(((this.durationMs - remainingMs) / this.durationMs) * 100)))
        : 0;
    this.onTick?.({
      active: true,
      paused,
      remainingMs,
      formatted: formatTimerMMSS(remainingMs),
      progressPct,
      label: this.label,
    });
  }

  _tick(fromForegroundResume) {
    if (this.endTime === null) return;
    // Calcul absolu strict : jamais de décrémentation naïve
    const remainingMs = Math.max(0, this.endTime - Date.now());
    const remainingSec = Math.ceil(remainingMs / 1000);

    // Bips de pré-alerte à 3, 2, 1 s (sauf si retour d'arrière-plan déjà expiré)
    if (!fromForegroundResume && remainingSec >= 1 && remainingSec <= 3 && this.lastBeepSecond !== remainingSec) {
      this.lastBeepSecond = remainingSec;
      playTone({ frequency: 660, durationSec: 0.08, volume: 0.14 });
    }

    if (remainingMs <= 0) {
      const finishedLabel = this.label;
      this.endTime = null;
      this._stopTicker();
      playRestFinishedSignal({ voiceEnabled: this.voiceEnabled, label: finishedLabel });
      this.onTick?.({
        active: false,
        paused: false,
        remainingMs: 0,
        formatted: '00:00',
        progressPct: 100,
        label: finishedLabel,
      });
      this.onFinish?.({ label: finishedLabel, resumedFromBackground: fromForegroundResume });
      return;
    }

    this._emitState(remainingMs, false);
  }
}

/* ==========================================================================
   4. DICTÉE VOCALE MAINS LIBRES EN SALLE (WEB SPEECH API + GROQ WHISPER)
   ========================================================================== */

/**
 * Extrait charge (kg), répétitions et RIR d'une dictée naturelle en français.
 * Ex. "82,5 kilos 10 reps rir 2" | "24 kg 12 répétitions" | "100 par 8 rir 1"
 */
export function parseGymVoiceTranscript(transcript) {
  const clean = String(transcript || '')
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  let weightKg = null;
  let reps = null;
  let rir = null;

  const weightMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilo|kilos|kilogrammes?)/);
  if (weightMatch) weightKg = Number(weightMatch[1]);

  const repsMatch = clean.match(/(\d+)\s*(?:rep|reps|rép|réps|répétitions?|repetitions?)/);
  if (repsMatch) reps = Number(repsMatch[1]);

  const rirMatch = clean.match(/(?:rir|réserve|reserve)\s*(?:de\s*)?(\d+)/);
  if (rirMatch) rir = Math.min(5, Math.max(0, Number(rirMatch[1])));

  // Forme courte "80 par 10" ou "80 10"
  if (weightKg === null || reps === null) {
    const nums = clean.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (weightKg === null && nums.length >= 1) weightKg = nums[0];
    if (reps === null && nums.length >= 2) reps = Math.round(nums[1]);
    if (rir === null && nums.length >= 3 && nums[2] <= 5) rir = Math.round(nums[2]);
  }

  return { transcript: String(transcript || '').trim(), weightKg, reps, rir };
}

export async function listenGymVoice({ aiSettings = null, maxDurationMs = 5500 } = {}) {
  const useGroqWhisper =
    aiSettings?.tier2Preset === 'groq' &&
    Boolean(aiSettings?.groqWhisperEnabled) &&
    Boolean(aiSettings?.apiKey?.trim());

  if (useGroqWhisper && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined') {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      const chunks = [];
      const recorder = new MediaRecorder(stream);
      const done = new Promise((resolve, reject) => {
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.onerror = () => reject(new Error('Erreur enregistrement micro.'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      });

      recorder.start();
      await new Promise((r) => setTimeout(r, Math.min(4500, maxDurationMs)));
      if (recorder.state !== 'inactive') recorder.stop();

      const blob = await done;
      const text = await transcribeAudioWithGroqWhisper(blob, aiSettings);
      return { ...parseGymVoiceTranscript(text), engine: 'groq_whisper' };
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
  }

  // Repli universel gratuit : Web Speech API natif du navigateur
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    throw new Error(
      'Reconnaissance vocale native indisponible sur ce navigateur. Activez Groq Whisper dans Réglages > Routeur IA.'
    );
  }

  return new Promise((resolve, reject) => {
    const rec = new SpeechRec();
    rec.lang = 'fr-FR';
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    const timer = setTimeout(() => {
      try {
        rec.stop();
      } catch {
        // Ignorer
      }
      reject(new Error('Aucune voix détectée (délai expiré).'));
    }, maxDurationMs);

    rec.onresult = (event) => {
      clearTimeout(timer);
      const text = event.results?.[0]?.[0]?.transcript || '';
      resolve({ ...parseGymVoiceTranscript(text), engine: 'web_speech_native' });
    };
    rec.onerror = (event) => {
      clearTimeout(timer);
      reject(new Error(`Micro indisponible (${event.error || 'erreur'}).`));
    };
    rec.start();
  });
}
