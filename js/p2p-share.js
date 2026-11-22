/**
 * Kinetix Lab — Partage P2P Sans Serveur, QR Code Local, Pont Santé & ntfy.sh (js/p2p-share.js)
 * - Compression LZ-String directement dans le hash URL (#share=...) pour échanger séances,
 *   programmes complets ou cartes de stats/streaks sans aucun backend central.
 * - Génération locale de QR Code haute lisibilité (zéro API externe).
 * - Pont universel Apple Santé (Raccourcis iOS) / Health Connect (MacroDroid Android)
 *   via paramètres d'URL (?sync_weight=&sync_fat=&sync_steps=&sync_waist=).
 * - Notifications Push optionnelles via ntfy.sh (canal privé gratuit, 0 clé).
 */

import { saveBiometric, getTodayISO } from './db.js';
import { computeUSNavyBodyFat, computeWHtR } from './nutrition-db.js';

/* ==========================================================================
   1. COMPRESSION LZ-STRING (CHARGEMENT DYNAMIQUE + REPLI BASE64URL NATIF)
   ========================================================================== */

let lzStringPromise = null;

async function ensureLZString() {
  if (typeof window === 'undefined') return null;
  if (window.LZString) return window.LZString;
  if (lzStringPromise) return lzStringPromise;

  lzStringPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js';
    script.async = true;
    const timeout = setTimeout(() => resolve(null), 5000);
    script.onload = () => {
      clearTimeout(timeout);
      resolve(window.LZString || null);
    };
    script.onerror = () => {
      clearTimeout(timeout);
      lzStringPromise = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return lzStringPromise;
}

function encodeBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(b64) {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function encodeSharePayload({ type, payload, senderName = 'Athlète' }) {
  const envelope = {
    v: 1,
    app: 'kinetix',
    type, // 'program' | 'workout' | 'stats_card'
    senderName,
    createdAt: new Date().toISOString(),
    payload,
  };
  const json = JSON.stringify(envelope);
  const lz = await ensureLZString();

  const token = lz
    ? `lz.${lz.compressToEncodedURIComponent(json)}`
    : `b64.${encodeBase64Url(json)}`;

  const baseUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://kinetix-lab.local/';

  return {
    url: `${baseUrl}#share=${token}`,
    token,
    rawBytes: json.length,
    compressedBytes: token.length,
    compressionRatio: Number((token.length / Math.max(1, json.length)).toFixed(2)),
  };
}

export async function decodeShareTokenOrUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Lien ou jeton P2P vide.');

  const hashMatch = raw.match(/#share=([^\s&]+)/);
  const token = hashMatch ? hashMatch[1] : raw;
  let json = null;

  if (token.startsWith('lz.')) {
    const lz = await ensureLZString();
    if (!lz) throw new Error('LZ-String requis pour décompresser ce lien (vérifiez la connexion).');
    json = lz.decompressFromEncodedURIComponent(token.slice(3));
  } else if (token.startsWith('b64.')) {
    json = decodeBase64Url(token.slice(4));
  } else {
    // Compatibilité directe LZ-String sans préfixe
    const lz = await ensureLZString();
    json = lz ? lz.decompressFromEncodedURIComponent(token) : decodeBase64Url(token);
  }

  if (!json) {
    throw new Error('Impossible de décompresser le partage P2P (lien tronqué ou corrompu).');
  }

  const parsed = JSON.parse(json);
  if (!parsed || parsed.app !== 'kinetix' || !parsed.type || !parsed.payload) {
    throw new Error('Format de partage Kinetix Lab non reconnu.');
  }
  return parsed;
}

export async function parseIncomingShareHash() {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  if (!hash.startsWith('#share=')) return null;
  try {
    const decoded = await decodeShareTokenOrUrl(hash);
    return decoded;
  } catch {
    return null;
  }
}

export function clearShareHash() {
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#share=')) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
}

/* ==========================================================================
   2. GÉNÉRATION LOCALE DE QR CODE (ZÉRO SERVEUR EXTERNE)
   ========================================================================== */

let qrLibPromise = null;

async function ensureQRLib() {
  if (typeof window === 'undefined') return null;
  if (window.QRCode) return window.QRCode;
  if (qrLibPromise) return qrLibPromise;

  qrLibPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.async = true;
    const timeout = setTimeout(() => resolve(null), 5000);
    script.onload = () => {
      clearTimeout(timeout);
      resolve(window.QRCode || null);
    };
    script.onerror = () => {
      clearTimeout(timeout);
      qrLibPromise = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return qrLibPromise;
}

export async function renderLocalQRCode(container, text, size = 220) {
  if (!container) return { ok: false, error: 'Conteneur introuvable.' };
  container.innerHTML = '';

  if (text.length > 2200) {
    const warn = document.createElement('p');
    warn.className = 'notice notice-accent';
    warn.textContent = `Lien trop dense pour un QR Code mobile (${text.length} caractères). Utilisez le bouton "Copier le lien compressé" à la place.`;
    container.appendChild(warn);
    return { ok: false, tooLarge: true };
  }

  const QRCode = await ensureQRLib();
  if (!QRCode) {
    const fallback = document.createElement('p');
    fallback.className = 'panel-subtitle';
    fallback.textContent = 'Librairie QR hors-ligne non cachée : copiez directement le lien compressé ci-dessous.';
    container.appendChild(fallback);
    return { ok: false, offline: true };
  }

  const frame = document.createElement('div');
  frame.style.cssText =
    'display:inline-block;padding:14px;background:#FFFFFF;border-radius:4px;border:1px solid #242933;';
  container.appendChild(frame);

  new QRCode(frame, {
    text,
    width: size,
    height: size,
    colorDark: '#090A0C',
    colorLight: '#FFFFFF',
    correctLevel: QRCode.CorrectLevel.L,
  });

  return { ok: true };
}

/* ==========================================================================
   3. PONT UNIVERSEL APPLE SANTÉ (iOS) / HEALTH CONNECT (ANDROID) VIA URL
   ========================================================================== */

export async function processHealthUrlSyncParams(activeProfile) {
  if (typeof window === 'undefined' || !activeProfile) return null;
  const params = new URLSearchParams(window.location.search);

  const rawWeight = params.get('sync_weight');
  const rawFat = params.get('sync_fat');
  const rawSteps = params.get('sync_steps');
  const rawWaist = params.get('sync_waist');
  const rawDate = params.get('sync_date');

  if (!rawWeight && !rawFat && !rawSteps && !rawWaist) {
    return null;
  }

  const parseNum = (v) => {
    if (v === null || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const weightKg = parseNum(rawWeight);
  const bodyFatPct = parseNum(rawFat);
  const steps = parseNum(rawSteps);
  const waistCm = parseNum(rawWaist);

  const entry = {
    date: rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getTodayISO(),
    source: 'url_sync',
    ...(weightKg !== null && weightKg >= 25 && weightKg <= 300 ? { weightKg } : {}),
    ...(bodyFatPct !== null && bodyFatPct >= 3 && bodyFatPct <= 65 ? { bodyFatPct } : {}),
    ...(steps !== null && steps >= 0 && steps <= 150000 ? { steps: Math.round(steps) } : {}),
    ...(waistCm !== null && waistCm >= 40 && waistCm <= 200 ? { waistCm } : {}),
  };

  if (entry.waistCm && activeProfile.heightCm) {
    const whtr = computeWHtR(entry.waistCm, activeProfile.heightCm);
    if (whtr) entry.whtr = whtr.ratio;
    const navy = computeUSNavyBodyFat({
      sex: activeProfile.sex,
      heightCm: activeProfile.heightCm,
      neckCm: activeProfile.lastNeckCm || 38,
      waistCm: entry.waistCm,
      hipsCm: activeProfile.lastHipsCm || null,
    });
    if (navy) entry.navyBodyFatPct = navy;
  }

  await saveBiometric(activeProfile.id, entry);

  // Nettoie les query params de la barre d'adresse pour éviter tout doublon au rechargement
  const cleanUrl = `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState(null, '', cleanUrl);

  return entry;
}

export function getHealthBridgeTemplates() {
  const base =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://<votre-user>.github.io/kinetix-lab/';
  return {
    iosShortcutUrl: `${base}?sync_weight=[Poids]&sync_fat=[MasseGrasse]&sync_steps=[Pas]`,
    androidMacroDroidUrl: `${base}?sync_weight={lv=weight}&sync_fat={lv=fat}&sync_steps={lv=steps}`,
  };
}

/* ==========================================================================
   4. NOTIFICATIONS PUSH OPTIONNELLES VIA NTFY.SH (0 CLÉ, CANAL PRIVÉ)
   ========================================================================== */

export async function sendNtfyNotification({
  topic,
  title = 'Kinetix Lab',
  message = '',
  priority = 'default',
  tags = 'muscle',
}) {
  const cleanTopic = String(topic || '').trim().replace(/^https?:\/\/ntfy\.sh\//i, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanTopic || cleanTopic.length < 4) {
    throw new Error('Canal ntfy.sh invalide (minimum 4 caractères alphanumériques, ex. kinetix-prive-9482).');
  }

  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(cleanTopic)}`, {
    method: 'POST',
    headers: {
      Title: title,
      Priority: priority,
      Tags: tags,
    },
    body: message || 'Rappel Kinetix Lab actif.',
  });

  if (!res.ok) {
    throw new Error(`Erreur ntfy.sh (HTTP ${res.status}).`);
  }
  return { ok: true, topic: cleanTopic };
}
