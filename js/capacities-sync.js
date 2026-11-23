/**
 * Kinetix Lab — Intégration Optionnelle Capacities (js/capacities-sync.js)
 *
 * 100 % optionnel et invisible tant que non activé dans Profil -> Intégrations -> Capacities.
 * - API Token stocké uniquement localement dans IndexedDB.
 * - Support d'une URL Proxy CORS optionnelle (ex. Cloudflare Worker) pour contourner les
 *   restrictions CORS navigateur sur https://api.capacities.io.
 * - Fallback automatique "Copier bilan Markdown" en cas de mode hors-ligne ou blocage CORS.
 */

import { estimate1RM } from './biomechanics-engine.js';

const CAPACITIES_API_BASE = 'https://api.capacities.io';

export function normalizeCapacitiesSettings(raw = null) {
  return {
    enabled: Boolean(raw?.enabled),
    apiToken: String(raw?.apiToken || '').trim(),
    corsProxyUrl: String(raw?.corsProxyUrl || '').trim(),
    spaceId: String(raw?.spaceId || '').trim(),
    spaceTitle: String(raw?.spaceTitle || '').trim(),
    spaces: Array.isArray(raw?.spaces) ? raw.spaces : [],
  };
}

export function isCapacitiesActive(cfg) {
  return Boolean(cfg && cfg.enabled && cfg.apiToken && cfg.spaceId);
}

/**
 * Construit l'URL cible en passant par le proxy CORS optionnel si renseigné.
 * Formats proxy supportés :
 * - Base URL de worker qui forwarde le chemin : https://mon-worker.workers.dev -> https://mon-worker.workers.dev/spaces
 * - URL avec placeholder {url} : https://mon-proxy/?url={url}
 */
export function buildCapacitiesEndpoint(path, corsProxyUrl = '') {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const targetUrl = `${CAPACITIES_API_BASE}${cleanPath}`;
  const proxy = String(corsProxyUrl || '').trim();
  if (!proxy) return targetUrl;

  if (proxy.includes('{url}')) {
    return proxy.replace('{url}', encodeURIComponent(targetUrl));
  }
  const normalizedProxy = proxy.replace(/\/+$/, '');
  if (normalizedProxy.includes('?')) {
    return `${normalizedProxy}${encodeURIComponent(targetUrl)}`;
  }
  return `${normalizedProxy}${cleanPath}`;
}

function classifyFetchError(err, hasProxy) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const msg = 'Appareil hors-ligne. Utilise le mode 0-clé (Copie Markdown / Partage).';
    return { ok: false, offline: true, corsBlocked: false, error: msg, message: msg };
  }
  const raw = String(err?.message || err || '');
  const looksLikeCors =
    err?.name === 'TypeError' ||
    /failed to fetch|networkerror|load failed|cors/i.test(raw);

  if (looksLikeCors) {
    const msg = hasProxy
      ? 'Échec réseau/CORS via ton proxy. Vérifie Access-Control-Allow-Origin et Authorization.'
      : 'Blocage CORS navigateur vers api.capacities.io. Le bilan Markdown reste copiable/partageable en 1 tap (mode 0-clé).';
    return { ok: false, offline: false, corsBlocked: true, error: msg, message: msg };
  }
  const msg = raw || 'Erreur inconnue lors de la communication avec Capacities.';
  return { ok: false, offline: false, corsBlocked: false, error: msg, message: msg };
}

export async function fetchCapacitiesSpaces(cfg) {
  const settings = normalizeCapacitiesSettings(cfg);
  if (!settings.apiToken) {
    const msg = 'Renseigne ton API Token Capacities d’abord.';
    return { ok: false, spaces: [], error: msg, message: msg };
  }
  const url = buildCapacitiesEndpoint('/spaces', settings.corsProxyUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${settings.apiToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const msg =
        res.status === 401 || res.status === 403
          ? 'Token Capacities refusé (HTTP 401/403). Vérifie ton API Token dans Capacities → Settings → API.'
          : `Erreur Capacities HTTP ${res.status}${txt ? ` : ${txt.slice(0, 120)}` : ''}`;
      return { ok: false, spaces: [], status: res.status, error: msg, message: msg };
    }
    const json = await res.json();
    const rawSpaces = Array.isArray(json?.spaces) ? json.spaces : Array.isArray(json) ? json : [];
    const spaces = rawSpaces
      .map((s) => ({
        id: String(s.id || s.spaceId || '').trim(),
        title: String(s.title || s.name || 'Espace Capacities').trim(),
      }))
      .filter((s) => s.id);
    return { ok: true, spaces, error: null, message: null };
  } catch (err) {
    if (err?.name === 'AbortError') {
      const msg = 'Délai dépassé (8 s) vers Capacities.';
      return { ok: false, spaces: [], error: msg, message: msg };
    }
    return { ...classifyFetchError(err, Boolean(settings.corsProxyUrl)), spaces: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function saveToCapacitiesDailyNote(cfg, mdText, { noTimeStamp = false } = {}) {
  const settings = normalizeCapacitiesSettings(cfg);
  if (!settings.apiToken || !settings.spaceId) {
    const msg = 'Mode API non configuré — bascule sur l’export 0-clé (Markdown + Partage).';
    return { ok: false, corsBlocked: false, error: msg, message: msg };
  }
  const url = buildCapacitiesEndpoint('/save-to-daily-note', settings.corsProxyUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        spaceId: settings.spaceId,
        mdText: String(mdText || ''),
        noTimeStamp: Boolean(noTimeStamp),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const msg =
        res.status === 401 || res.status === 403
          ? 'Token Capacities invalide ou expiré (HTTP 401/403).'
          : `Capacities a renvoyé HTTP ${res.status}${txt ? ` : ${txt.slice(0, 120)}` : ''}`;
      return { ok: false, status: res.status, corsBlocked: false, error: msg, message: msg };
    }
    return { ok: true, status: res.status, corsBlocked: false, error: null, message: null };
  } catch (err) {
    if (err?.name === 'AbortError') {
      const msg = 'Délai dépassé (8 s) vers Capacities.';
      return { ok: false, corsBlocked: false, error: msg, message: msg };
    }
    return classifyFetchError(err, Boolean(settings.corsProxyUrl));
  } finally {
    clearTimeout(timer);
  }
}

export async function copyMarkdownFallback(mdText) {
  const text = String(mdText || '');
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback textarea
  }
  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Mode 0-Clé actif par défaut : copie automatiquement le Markdown Daily Note dans le presse-papiers
 * et indique si le partage natif iOS/Android (navigator.share) et le lien capacités:// sont disponibles.
 */
export async function exportCapacitiesZeroKey(mdText, { title = 'Bilan Kinetix Lab' } = {}) {
  const copied = await copyMarkdownFallback(mdText);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return {
    ok: true,
    mode: 'zero_key',
    copied,
    canNativeShare,
    deepLinkUrl: 'capacities://',
    title,
    mdText: String(mdText || ''),
  };
}

export async function shareCapacitiesNative(mdText, title = 'Bilan Kinetix Lab') {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false;
  }
  try {
    await navigator.share({ title, text: String(mdText || '') });
    return true;
  } catch {
    return false;
  }
}

/* ==========================================================================
   FORMATEURS MARKDOWN PROPRES POUR CAPACITIES DAILY NOTE
   ========================================================================== */

export function formatWorkoutCapacitiesMarkdown({ workout, proIntel = null, profile = {}, coachNote = '' }) {
  const durationMin =
    workout?.startedAt && workout?.endedAt
      ? Math.max(1, Math.round((workout.endedAt - workout.startedAt) / 60000))
      : null;

  let totalTonnage = 0;
  let totalSets = 0;
  const prs = [];
  const painList = [];

  for (const ex of workout?.exercises || []) {
    if (ex.feedback === 'joint_pain') painList.push(ex.name);
    let bestE1 = 0;
    let bestStr = '';
    for (const s of ex.sets || []) {
      if (s.isWarmup || !s.done) continue;
      totalSets += 1;
      const w = Number(s.weightKg) || 0;
      const r = Number(s.reps) || 0;
      totalTonnage += w * r;
      const e1 = estimate1RM(w, r);
      if (e1 > bestE1) {
        bestE1 = e1;
        bestStr = `${ex.name} : ${w} kg × ${r} (e1RM ${Math.round(e1)} kg)`;
      }
    }
    if (bestStr) prs.push(bestStr);
  }

  const lines = [
    `### Séance Kinetix Lab — ${workout?.dayName || 'Entraînement'} (${workout?.date || ''})`,
    `- **Athlète** : ${profile?.name || 'Athlète'}${durationMin ? ` · Durée : ${durationMin} min` : ''}`,
    `- **Readiness** : ${workout?.readiness?.score ?? '--'}/100${workout?.readiness?.preservationMode ? ' (Mode Préservation)' : ''}${proIntel ? ` · Récup CNS : ${proIntel.recoveryScore}/100` : ''}`,
    `- **Volume** : ${totalSets} séries effectives · Tonnage : ${Math.round(totalTonnage)} kg`,
  ];

  if (prs.length > 0) {
    lines.push(`- **Top sets / e1RM** :`);
    prs.slice(0, 6).forEach((p) => lines.push(`  - ${p}`));
  }
  if (painList.length > 0) {
    lines.push(`- **Alertes douleurs** : ${painList.join(', ')}`);
  }
  const note = coachNote || proIntel?.signals?.[0]?.text || '';
  if (note) {
    lines.push(`- **Note Coach** : ${note}`);
  }
  return lines.join('\n');
}

export function formatNutritionEveningCapacitiesMarkdown({
  date,
  consumed,
  macros,
  hydrationMl = 0,
  ewma = {},
  nutritionToday = [],
  proIntel = null,
}) {
  const deltaKcal = Math.round((consumed?.kcal || 0) - (macros?.kcal || 0));
  const lines = [
    `### Bilan Nutrition Kinetix Lab (${date || ''})`,
    `- **Calories** : ${consumed?.kcal || 0} / ${macros?.kcal || 0} kcal (${deltaKcal >= 0 ? '+' : ''}${deltaKcal} kcal)`,
    `- **Macros** : Protéines ${consumed?.proteinG || 0}/${macros?.proteinG || 0} g · Glucides ${consumed?.carbsG || 0}/${macros?.carbsG || 0} g · Lipides ${consumed?.fatG || 0}/${macros?.fatG || 0} g${consumed?.fiberG ? ` · Fibres ${consumed.fiberG} g` : ''}`,
    `- **Hydratation** : ${hydrationMl} / ${proIntel?.nutritionTiming?.recommendedWaterTodayMl || macros?.waterTargetMl || 2800} ml`,
    `- **Poids EWMA** : ${ewma?.latestEwmaKg ?? '--'} kg (${ewma?.weeklyDeltaKg >= 0 ? '+' : ''}${ewma?.weeklyDeltaKg ?? 0} kg/sem)`,
  ];
  if (nutritionToday?.length) {
    lines.push(`- **Repas (${nutritionToday.length})** : ${nutritionToday.map((m) => `${m.label} (${m.kcal} kcal)`).join(' · ')}`);
  }
  return lines.join('\n');
}

export function formatCoachMessageCapacitiesMarkdown({ message, profile = {} }) {
  const dateStr = message?.timestamp ? new Date(message.timestamp).toISOString().slice(0, 10) : '';
  const badges = Array.isArray(message?.executedBadges) && message.executedBadges.length > 0
    ? `\n- **Actions exécutées** : ${message.executedBadges.join(' · ')}`
    : '';
  return `### Décision Coach Kinetix (${dateStr} · ${profile?.name || 'Athlète'})${badges}\n\n${String(message?.content || '').trim()}`;
}
