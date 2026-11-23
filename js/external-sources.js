/**
 * Kinetix Lab — Connecteur Centralisé de Sources Publiques Gratuites (js/external-sources.js)
 *
 * Toutes ces sources sont pré-câblées d'usine (0 clé API, CORS ouvert ou CDN officiel)
 * avec timeouts propres (AbortController) et cache persistant dans IndexedDB (externalCache)
 * pour garantir un fonctionnement 100 % résilient en ligne comme hors-ligne :
 *
 * 1. Open Food Facts API v2 (world/fr.openfoodfacts.org) — produits EAN, recherche France, Nutri-Score, NOVA, allergènes
 * 2. Base Ciqual ANSES (socle embarqué 200+ aliments + extension JSON publique optionnelle en arrière-plan)
 * 3. free-exercise-db (yuhonas/free-exercise-db, 800+ exercices réels avec photos départ/contraction)
 * 4. wger REST API v2 (muscles, équipements, exercices FR + calques SVG anatomiques avec fallback local)
 * 5. MediaPipe Tasks Vision (@mediapipe/tasks-vision CDN, 33 landmarks corporels locaux)
 * 6. Open-Meteo API (géocodage + météo locale temps réel pour bonus hydratation chaleur/humidité & électrolytes)
 * 7. Web Speech API native (dictée vocale séances/repas + synthèse vocale chrono)
 */

import { getExternalCache, putExternalCache, listExternalCacheKeys } from './db.js';
import { WGER_MUSCLES, FREE_EXERCISE_DB_BASE } from './exercises-db.js';

export const EXTERNAL_ENDPOINTS = Object.freeze({
  OPEN_FOOD_FACTS_PRODUCT: 'https://world.openfoodfacts.org/api/v2/product',
  OPEN_FOOD_FACTS_SEARCH_FR: 'https://fr.openfoodfacts.org/api/v2/search',
  FREE_EXERCISE_DB_JSON:
    'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json',
  FREE_EXERCISE_DB_IMG_BASE: FREE_EXERCISE_DB_BASE,
  WGER_API_BASE: 'https://wger.de/api/v2',
  OPEN_METEO_FORECAST: 'https://api.open-meteo.com/v1/forecast',
  OPEN_METEO_GEOCODING: 'https://geocoding-api.open-meteo.com/v1/search',
  MEDIAPIPE_VISION_CDN: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14',
  // Jeu de données public Ciqual / OpenData (miroir JSON léger — fallback silencieux sur le socle 207 aliments si indisponible)
  CIQUAL_OPENDATA_JSON:
    'https://raw.githubusercontent.com/openfoodfacts/ciqual-json/main/ciqual_fr_compact.json',
});

export const EXTERNAL_SOURCES_REGISTRY = Object.freeze([
  { id: 'off_v2', label: 'Open Food Facts API v2', scope: 'Scan EAN, recherche France, Nutri-Score & NOVA', role: 'Scan EAN, recherche France, Nutri-Score & NOVA', keyRequired: false },
  { id: 'ciqual', label: 'Base Ciqual ANSES', scope: '207+ aliments FR embarqués + synchro étendue', role: '207+ aliments FR embarqués + synchro étendue', keyRequired: false },
  { id: 'free_exercise_db', label: 'free-exercise-db (800+)', scope: 'Catalogue exercices réels & photos exécution', role: 'Catalogue exercices réels & photos exécution', keyRequired: false },
  { id: 'wger_v2', label: 'wger REST API v2', scope: 'Anatomie musculaire, équipements & SVG', role: 'Anatomie musculaire, équipements & SVG', keyRequired: false },
  { id: 'mediapipe', label: 'MediaPipe Tasks Vision', scope: '33 landmarks corporels 100 % local', role: '33 landmarks corporels 100 % local', keyRequired: false },
  { id: 'open_meteo', label: 'Open-Meteo API', scope: 'Température & humidité → bonus hydratation', role: 'Température & humidité → bonus hydratation', keyRequired: false },
  { id: 'web_speech', label: 'Web Speech API native', scope: 'Dictée vocale séances/repas & chrono', role: 'Dictée vocale séances/repas & chrono', keyRequired: false },
]);

const TTL_WEATHER_MS = 2 * 60 * 60 * 1000; // 2 heures
const TTL_CATALOG_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours
const TTL_CIQUAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

const memoryCache = new Map();

function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export async function fetchJsonWithTimeout(url, { timeoutMs = 6500, headers = {}, signal = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.httpStatus = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

/* ==========================================================================
   1. OPEN-METEO API (0 CLÉ, CORS OUVERT) -> HYDRATATION & ÉLECTROLYTES
   ========================================================================== */

export function computeHeatHydrationBonus(tempC, humidityPct = 50) {
  const t = Number(tempC);
  const h = Number(humidityPct);
  if (!Number.isFinite(t)) {
    return { heatHydrationBonusMl: 0, bonusMl: 0, electrolytesRecommended: false, heatLevel: 'normal' };
  }
  const hum = Number.isFinite(h) ? h : 50;
  // Indice de chaleur ressenti simplifié : chaleur + humidité forte augmentent la sudation
  if (t >= 31 || (t >= 28 && hum >= 65)) {
    return { heatHydrationBonusMl: 700, bonusMl: 700, electrolytesRecommended: true, heatLevel: 'high' };
  }
  if (t >= 26 || (t >= 24 && hum >= 70)) {
    return { heatHydrationBonusMl: 500, bonusMl: 500, electrolytesRecommended: true, heatLevel: 'warm' };
  }
  if (t >= 22 && hum >= 65) {
    return { heatHydrationBonusMl: 300, bonusMl: 300, electrolytesRecommended: false, heatLevel: 'mild_humid' };
  }
  if (t >= 24) {
    return { heatHydrationBonusMl: 300, bonusMl: 300, electrolytesRecommended: false, heatLevel: 'mild' };
  }
  return { heatHydrationBonusMl: 0, bonusMl: 0, electrolytesRecommended: false, heatLevel: 'normal' };
}

export async function geocodeCityOpenMeteo(cityName) {
  const q = String(cityName || '').trim();
  if (q.length < 2 || !isOnline()) return null;
  const cacheKey = `geocode:${q.toLowerCase()}`;
  const cached = await getExternalCache(cacheKey, TTL_CATALOG_MS);
  if (cached && !cached.stale && cached.data) return cached.data;

  try {
    const url = `${EXTERNAL_ENDPOINTS.OPEN_METEO_GEOCODING}?name=${encodeURIComponent(q)}&count=1&language=fr&format=json`;
    const json = await fetchJsonWithTimeout(url, { timeoutMs: 5500 });
    const hit = json?.results?.[0];
    if (!hit) return null;
    const resolved = {
      name: hit.name,
      country: hit.country_code || '',
      latitude: Number(hit.latitude),
      longitude: Number(hit.longitude),
    };
    await putExternalCache(cacheKey, resolved, { label: `Ville ${resolved.name}` });
    return resolved;
  } catch {
    return cached?.data || null;
  }
}

export function requestBrowserCoordinates(timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Géolocalisation non disponible sur cet appareil.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: Number(pos.coords.latitude.toFixed(3)),
          longitude: Number(pos.coords.longitude.toFixed(3)),
        });
      },
      (err) => reject(new Error(err?.message || 'Accès à la position refusé.')),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 600000 }
    );
  });
}

/**
 * Récupère la température & l'humidité locale via Open-Meteo (cache IndexedDB 2h)
 * et calcule automatiquement le bonus d'hydratation (+300 à +700 ml).
 */
export async function fetchWeatherHydrationContext(
  { city = '', latitude = null, longitude = null } = {},
  { forceRefresh = false } = {}
) {
  let lat = Number.isFinite(Number(latitude)) ? Number(latitude) : null;
  let lon = Number.isFinite(Number(longitude)) ? Number(longitude) : null;
  let resolvedCity = String(city || '').trim();

  if ((lat === null || lon === null) && resolvedCity) {
    const geo = await geocodeCityOpenMeteo(resolvedCity);
    if (geo) {
      lat = geo.latitude;
      lon = geo.longitude;
      resolvedCity = geo.name;
    }
  }

  const cacheKey =
    lat !== null && lon !== null
      ? `weather:${lat.toFixed(2)},${lon.toFixed(2)}`
      : resolvedCity
        ? `weather:city:${resolvedCity.toLowerCase()}`
        : 'weather:last';

  const cached = await getExternalCache(cacheKey, TTL_WEATHER_MS);
  if (!forceRefresh && cached && !cached.stale && cached.data) {
    return { ...cached.data, fromCache: true };
  }

  if (lat === null || lon === null || !isOnline()) {
    return cached?.data ? { ...cached.data, fromCache: true, stale: true } : null;
  }

  try {
    const url = `${EXTERNAL_ENDPOINTS.OPEN_METEO_FORECAST}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,relative_humidity_2m,apparent_temperature&timezone=auto`;
    const json = await fetchJsonWithTimeout(url, { timeoutMs: 6000 });
    const cur = json?.current;
    if (!cur || !Number.isFinite(Number(cur.temperature_2m))) {
      return cached?.data || null;
    }
    const tempC = Math.round(Number(cur.temperature_2m) * 10) / 10;
    const humidityPct = Math.round(Number(cur.relative_humidity_2m) || 50);
    const apparentTempC = Math.round((Number(cur.apparent_temperature) || tempC) * 10) / 10;
    const bonus = computeHeatHydrationBonus(tempC, humidityPct);

    const payload = {
      city: resolvedCity || 'Position locale',
      latitude: lat,
      longitude: lon,
      tempC,
      temperatureC: tempC,
      humidityPct,
      apparentTempC,
      ...bonus,
      heatBonusMl: bonus.heatHydrationBonusMl,
      fetchedAt: Date.now(),
    };
    await putExternalCache(cacheKey, payload, { label: `Météo ${payload.city}` });
    await putExternalCache('weather:last', payload, { label: `Météo ${payload.city}` });
    return { ...payload, fromCache: false };
  } catch {
    return cached?.data ? { ...cached.data, fromCache: true, stale: true } : null;
  }
}

/* ==========================================================================
   2. FREE-EXERCISE-DB (800+ EXERCICES RÉELS + PHOTOS DÉPART/CONTRACTION)
   ========================================================================== */

const FEDB_MUSCLE_MAP = Object.freeze({
  chest: 'pecs_upper',
  shoulders: 'delts_lat',
  lats: 'lats_width',
  'middle back': 'traps_rhomboids',
  'lower back': 'traps_rhomboids',
  traps: 'traps_rhomboids',
  quadriceps: 'quads',
  hamstrings: 'hamstrings',
  glutes: 'glutes',
  calves: 'calves',
  biceps: 'biceps',
  triceps: 'triceps',
  abdominals: 'abs',
  forearms: 'biceps',
  adductors: 'quads',
  abductors: 'glutes',
});

const FEDB_EQUIP_MAP = Object.freeze({
  barbell: 'barbell',
  dumbbell: 'dumbbells',
  cable: 'cables',
  machine: 'machines',
  kettlebells: 'kettlebell',
  bands: 'bands',
  'body only': 'bodyweight',
  'e-z curl bar': 'barbell',
  'exercise ball': 'bodyweight',
  'medicine ball': 'bodyweight',
  'foam roll': 'bodyweight',
  other: 'machines',
});

function normalizeFreeExerciseEntry(raw) {
  if (!raw?.id || !raw?.name) return null;
  const images = Array.isArray(raw.images) ? raw.images : [];
  const startUrl = images[0] ? `${EXTERNAL_ENDPOINTS.FREE_EXERCISE_DB_IMG_BASE}/${images[0]}` : null;
  const endUrl = images[1] ? `${EXTERNAL_ENDPOINTS.FREE_EXERCISE_DB_IMG_BASE}/${images[1]}` : startUrl;
  const prim = (raw.primaryMuscles || []).map((m) => FEDB_MUSCLE_MAP[String(m).toLowerCase()] || String(m).toLowerCase());
  const sec = (raw.secondaryMuscles || []).map((m) => FEDB_MUSCLE_MAP[String(m).toLowerCase()] || String(m).toLowerCase());
  const equipKey = FEDB_EQUIP_MAP[String(raw.equipment || 'body only').toLowerCase()] || 'machines';

  return {
    id: `fedb_${String(raw.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    slug: String(raw.id),
    name: String(raw.name),
    englishName: String(raw.name),
    category: raw.mechanic === 'isolation' ? 'isolation' : 'compound',
    level: raw.level || 'intermediate',
    force: raw.force || null,
    primaryMuscles: Array.from(new Set(prim)),
    secondaryMuscles: Array.from(new Set(sec)),
    rawPrimaryMuscles: raw.primaryMuscles || [],
    equipment: [equipKey],
    rawEquipment: raw.equipment || 'body only',
    incrementKg: equipKey === 'dumbbells' ? 2 : 2.5,
    unilateral: /single|one[- ]arm|one[- ]leg|unilateral|bulgarian|split/i.test(raw.name),
    instructions: Array.isArray(raw.instructions) ? raw.instructions.slice(0, 4) : [],
    mediaUrls: { start: startUrl, end: endUrl },
    startImg: startUrl,
    endImg: endUrl,
    source: 'free_exercise_db',
  };
}

export async function loadFreeExerciseCatalog({ forceRefresh = false } = {}) {
  if (!forceRefresh && memoryCache.has('free_exercise_db')) {
    return memoryCache.get('free_exercise_db');
  }
  const cached = await getExternalCache('free_exercise_db_catalog', TTL_CATALOG_MS);
  if (!forceRefresh && cached && !cached.stale && Array.isArray(cached.data) && cached.data.length > 0) {
    memoryCache.set('free_exercise_db', cached.data);
    return cached.data;
  }

  if (!isOnline()) {
    const fallback = Array.isArray(cached?.data) ? cached.data : [];
    memoryCache.set('free_exercise_db', fallback);
    return fallback;
  }

  try {
    const rawList = await fetchJsonWithTimeout(EXTERNAL_ENDPOINTS.FREE_EXERCISE_DB_JSON, { timeoutMs: 9000 });
    const normalized = (Array.isArray(rawList) ? rawList : [])
      .map(normalizeFreeExerciseEntry)
      .filter(Boolean);
    if (normalized.length > 0) {
      await putExternalCache('free_exercise_db_catalog', normalized, {
        label: 'free-exercise-db',
        count: normalized.length,
      });
      memoryCache.set('free_exercise_db', normalized);
    }
    return normalized;
  } catch {
    const stale = Array.isArray(cached?.data) ? cached.data : [];
    memoryCache.set('free_exercise_db', stale);
    return stale;
  }
}

export async function searchFreeExerciseDb(query = '', { muscleGroup = null, equipment = null, limit = 16 } = {}) {
  const catalog = await loadFreeExerciseCatalog();
  if (!catalog.length) return [];

  const normQ = String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  const tokens = normQ ? normQ.split(/\s+/).filter(Boolean) : [];
  const equipSet = Array.isArray(equipment) && equipment.length ? new Set(equipment) : null;

  const scored = [];
  for (const ex of catalog) {
    if (muscleGroup && !ex.primaryMuscles.includes(muscleGroup) && !ex.secondaryMuscles.includes(muscleGroup)) {
      continue;
    }
    const hay = `${ex.name} ${ex.rawPrimaryMuscles.join(' ')} ${ex.rawEquipment}`.toLowerCase();
    let score = 0;
    if (tokens.length === 0) {
      score = ex.primaryMuscles.includes(muscleGroup) ? 3 : 1;
    } else {
      let matchedAll = true;
      for (const t of tokens) {
        if (hay.includes(t)) score += ex.name.toLowerCase().includes(t) ? 3 : 1;
        else {
          matchedAll = false;
          break;
        }
      }
      if (!matchedAll) continue;
    }
    if (equipSet && ex.equipment.some((eq) => equipSet.has(eq))) {
      score += 2;
    }
    if (ex.mediaUrls?.start) score += 1;
    scored.push({ ex, score });
  }

  scored.sort((a, b) => b.score - a.score || a.ex.name.localeCompare(b.ex.name));
  return scored.slice(0, limit).map((s) => s.ex);
}

/* ==========================================================================
   3. WGER REST API V2 (MUSCLES, ÉQUIPEMENTS, EXERCICES FR — 0 CLÉ)
   ========================================================================== */

export async function fetchWgerAnatomyCatalog({ forceRefresh = false } = {}) {
  if (!forceRefresh && memoryCache.has('wger_v2')) {
    return memoryCache.get('wger_v2');
  }
  const cached = await getExternalCache('wger_v2_catalog', TTL_CATALOG_MS);
  if (!forceRefresh && cached && !cached.stale && cached.data) {
    memoryCache.set('wger_v2', cached.data);
    return cached.data;
  }

  const buildLocalFallback = () => ({
    muscles: Object.entries(WGER_MUSCLES).map(([id, m]) => ({
      id: Number(id),
      name: m.name,
      is_front: m.view === 'front',
    })),
    equipment: [],
    exercisesFr: [],
    source: 'local_fallback',
  });

  if (!isOnline()) {
    return cached?.data || buildLocalFallback();
  }

  try {
    const [musclesRes, equipRes, exInfoRes] = await Promise.allSettled([
      fetchJsonWithTimeout(`${EXTERNAL_ENDPOINTS.WGER_API_BASE}/muscle/?limit=40`, { timeoutMs: 6500 }),
      fetchJsonWithTimeout(`${EXTERNAL_ENDPOINTS.WGER_API_BASE}/equipment/?limit=40`, { timeoutMs: 6500 }),
      fetchJsonWithTimeout(`${EXTERNAL_ENDPOINTS.WGER_API_BASE}/exerciseinfo/?language=12&limit=50`, { timeoutMs: 7500 }),
    ]);

    const muscles =
      musclesRes.status === 'fulfilled' && Array.isArray(musclesRes.value?.results)
        ? musclesRes.value.results.map((m) => ({
            id: m.id,
            name: m.name_en || m.name,
            nameFr: WGER_MUSCLES[m.id]?.name || m.name_en || m.name,
            is_front: Boolean(m.is_front),
            imageUrlMain: m.image_url_main ? `https://wger.de${m.image_url_main}` : null,
            imageUrlSecondary: m.image_url_secondary ? `https://wger.de${m.image_url_secondary}` : null,
          }))
        : buildLocalFallback().muscles;

    const equipment =
      equipRes.status === 'fulfilled' && Array.isArray(equipRes.value?.results)
        ? equipRes.value.results.map((eq) => ({ id: eq.id, name: eq.name }))
        : [];

    const exercisesFr =
      exInfoRes.status === 'fulfilled' && Array.isArray(exInfoRes.value?.results)
        ? exInfoRes.value.results
            .map((item) => {
              const tr =
                (item.translations || []).find((t) => t.language === 12) ||
                (item.translations || [])[0];
              if (!tr?.name) return null;
              return {
                id: `wger_${item.id}`,
                wgerId: item.id,
                name: String(tr.name).trim(),
                category: item.category?.name || '',
                muscles: (item.muscles || []).map((m) => m.id),
                musclesSecondary: (item.muscles_secondary || []).map((m) => m.id),
                equipment: (item.equipment || []).map((eq) => eq.name),
              };
            })
            .filter(Boolean)
        : [];

    const payload = {
      muscles,
      equipment,
      exercisesFr,
      source: 'wger_api_v2',
    };

    await putExternalCache('wger_v2_catalog', payload, {
      label: 'wger REST API v2',
      count: muscles.length + exercisesFr.length,
    });
    memoryCache.set('wger_v2', payload);
    return payload;
  } catch {
    return cached?.data || buildLocalFallback();
  }
}

/* ==========================================================================
   4. EXTENSION BASE CIQUAL ANSES (SYNCHRO ARRIÈRE-PLAN OPTIONNELLE)
   ========================================================================== */

export async function getCachedCiqualExtension() {
  if (memoryCache.has('ciqual_ext')) return memoryCache.get('ciqual_ext');
  const cached = await getExternalCache('ciqual_remote_ext', TTL_CIQUAL_MS);
  const rows = Array.isArray(cached?.data) ? cached.data : [];
  memoryCache.set('ciqual_ext', rows);
  return rows;
}

export async function syncCiqualRemoteDataset({ forceRefresh = false } = {}) {
  const cached = await getExternalCache('ciqual_remote_ext', TTL_CIQUAL_MS);
  if (!forceRefresh && cached && !cached.stale && Array.isArray(cached.data)) {
    memoryCache.set('ciqual_ext', cached.data);
    return { ok: true, count: cached.data.length, fromCache: true };
  }
  if (!isOnline()) {
    return { ok: false, count: cached?.data?.length || 0, offline: true };
  }
  try {
    const json = await fetchJsonWithTimeout(EXTERNAL_ENDPOINTS.CIQUAL_OPENDATA_JSON, { timeoutMs: 7000 });
    const rawArr = Array.isArray(json) ? json : Array.isArray(json?.foods) ? json.foods : [];
    const valid = rawArr
      .filter((f) => f && f.name && Number.isFinite(Number(f.kcal)))
      .slice(0, 1200)
      .map((f, idx) => ({
        id: f.id || `ciq_ext_${idx}`,
        name: String(f.name).trim(),
        kcal: Math.max(0, Math.round(Number(f.kcal) || 0)),
        proteinG: Math.max(0, Math.round((Number(f.proteinG ?? f.protein) || 0) * 10) / 10),
        carbsG: Math.max(0, Math.round((Number(f.carbsG ?? f.carbs) || 0) * 10) / 10),
        fatG: Math.max(0, Math.round((Number(f.fatG ?? f.fat) || 0) * 10) / 10),
        fiberG: Math.max(0, Math.round((Number(f.fiberG ?? f.fiber) || 0) * 10) / 10),
        aisle: f.aisle || 'Ciqual étendu',
        diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'],
        allergens: [],
        source: 'ciqual_remote',
      }));
    if (valid.length > 0) {
      await putExternalCache('ciqual_remote_ext', valid, { label: 'Ciqual étendu', count: valid.length });
      memoryCache.set('ciqual_ext', valid);
    }
    return { ok: true, count: valid.length, fromCache: false };
  } catch {
    return { ok: false, count: cached?.data?.length || 0, fromCache: true };
  }
}

/* ==========================================================================
   5. WEB SPEECH API NATIVE (0 CLÉ — DICTÉE VOCALE REPAS / SÉANCE)
   ========================================================================== */

export function isWebSpeechSupported() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function dictateFrenchVoiceText({ timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!isWebSpeechSupported()) {
      reject(new Error('Dictée vocale non supportée sur ce navigateur.'));
      return;
    }
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRec();
    rec.lang = 'fr-FR';
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          rec.stop();
        } catch {
          // ignore
        }
        reject(new Error('Aucune voix détectée (délai expiré).'));
      }
    }, timeoutMs);

    rec.onresult = (event) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const transcript = event?.results?.[0]?.[0]?.transcript || '';
      resolve(String(transcript).trim());
    };

    rec.onerror = (event) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(new Error(`Dictée interrompue (${event?.error || 'erreur micro'}).`));
    };

    rec.onend = () => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(new Error('Dictée annulée.'));
      }
    };

    try {
      rec.start();
    } catch (err) {
      finished = true;
      clearTimeout(timer);
      reject(err);
    }
  });
}

/* ==========================================================================
   6. SYNCHRO ARRIÈRE-PLAN SILENCIEUSE & STATUT DU CACHE EXTERNE
   ========================================================================== */

export async function warmExternalSourcesInBackground(profile = null) {
  const tasks = [];
  if (profile?.lifestyle?.city || (profile?.lifestyle?.latitude && profile?.lifestyle?.longitude)) {
    tasks.push(
      fetchWeatherHydrationContext({
        city: profile.lifestyle.city || '',
        latitude: profile.lifestyle.latitude ?? null,
        longitude: profile.lifestyle.longitude ?? null,
      })
    );
  }
  // Réchauffe silencieusement free-exercise-db & wger uniquement si en ligne et non déjà frais
  if (isOnline()) {
    tasks.push(loadFreeExerciseCatalog().catch(() => []));
    tasks.push(fetchWgerAnatomyCatalog().catch(() => null));
  }
  await Promise.allSettled(tasks);
}

export async function getExternalSourcesStatus() {
  const keys = await listExternalCacheKeys();
  const byKey = new Map(keys.map((k) => [k.key, k]));
  const weather = byKey.get('weather:last') || null;
  const fedb = byKey.get('free_exercise_db_catalog') || null;
  const wger = byKey.get('wger_v2_catalog') || null;
  const ciqualExt = byKey.get('ciqual_remote_ext') || null;

  return {
    online: isOnline(),
    webSpeech: isWebSpeechSupported(),
    freeExerciseDbCount: fedb?.count || 0,
    freeExerciseCount: fedb?.count || 0,
    wgerCachedCount: wger?.count || 0,
    wgerMusclesCount: wger?.count || 0,
    ciqualExtCount: ciqualExt?.count || 0,
    weatherUpdatedAt: weather?.updatedAt || null,
    totalCachedEntries: keys.length,
  };
}
