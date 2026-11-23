/**
 * Kinetix Lab — Couche Persistance Locale IndexedDB (js/db.js)
 * - 100 % local, multi-profils isolés par profileId
 * - Protection anti-purge WebKit/iOS : navigator.storage.persist(), détection standalone & rappel export 30j
 * - Export / Import JSON complet (y compris sérialisation base64 des Blobs photos)
 * - Chiffrement client AES-256-GCM (PBKDF2-SHA256 210 000 itérations) + Sync GitHub Repo Privé
 */

export const DB_NAME = 'kinetix_lab_db';
export const DB_VERSION = 2;

export const STORES = Object.freeze({
  META: 'meta',
  PROFILES: 'profiles',
  AI_SETTINGS: 'ai_settings',
  PROGRAMS: 'programs',
  WORKOUTS: 'workouts',
  BIOMETRICS: 'biometrics',
  NUTRITION_LOGS: 'nutrition_logs',
  FAVORITES: 'favorites',
  CUSTOM_FOODS: 'customFoods',
  HYDRATION_LOGS: 'hydration_logs',
  PHYSIQUE_PHOTOS: 'physique_photos',
  COACH_MESSAGES: 'coach_messages',
  SHOPPING_LIST: 'shopping_list',
});

const PROFILE_SCOPED_STORES = [
  STORES.PROGRAMS,
  STORES.WORKOUTS,
  STORES.BIOMETRICS,
  STORES.NUTRITION_LOGS,
  STORES.FAVORITES,
  STORES.CUSTOM_FOODS,
  STORES.HYDRATION_LOGS,
  STORES.PHYSIQUE_PHOTOS,
  STORES.COACH_MESSAGES,
  STORES.SHOPPING_LIST,
];

let dbPromise = null;

export function generateId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${Date.now().toString(36)}_${hex}`;
}

export function getTodayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORES.PROFILES)) {
        db.createObjectStore(STORES.PROFILES, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORES.AI_SETTINGS)) {
        db.createObjectStore(STORES.AI_SETTINGS, { keyPath: 'profileId' });
      }

      if (!db.objectStoreNames.contains(STORES.PROGRAMS)) {
        const store = db.createObjectStore(STORES.PROGRAMS, { keyPath: 'id' });
        store.createIndex('by_profile', 'profileId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.WORKOUTS)) {
        const store = db.createObjectStore(STORES.WORKOUTS, { keyPath: 'id' });
        store.createIndex('by_profile', 'profileId', { unique: false });
        store.createIndex('by_profile_date', ['profileId', 'date'], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.BIOMETRICS)) {
        const store = db.createObjectStore(STORES.BIOMETRICS, { keyPath: 'id' });
        store.createIndex('by_profile', 'profileId', { unique: false });
        store.createIndex('by_profile_date', ['profileId', 'date'], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.NUTRITION_LOGS)) {
        const store = db.createObjectStore(STORES.NUTRITION_LOGS, { keyPath: 'id' });
        store.createIndex('by_profile', 'profileId', { unique: false });
        store.createIndex('by_profile_date', ['profileId', 'date'], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.FAVORITES)) {
        const store = db.createObjectStore(STORES.FAVORITES, { keyPath: 'id' });
        store.createIndex('by_profile', 'profileId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.HYDRATION_LOGS)) {
        const store = db.createObjectStore(STORES.HYDRATION_LOGS, { keyPath: 'id' });
        store.createIndex('by_profile', 'profileId', { unique: false });
        store.createIndex('by_profile_date', ['profileId', 'date'], { unique: true });
      }

      if (!db.objectStoreNames.contains(STORES.PHYSIQUE_PHOTOS)) {
        const store = db.createObjectStore(STORES.PHYSIQUE_PHOTOS, { keyPath: 'id' });
        store.createIndex('by_profile', 'profileId', { unique: false });
        store.createIndex('by_profile_date', ['profileId', 'date'], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.COACH_MESSAGES)) {
        const store = db.createObjectStore(STORES.COACH_MESSAGES, { keyPath: 'id' });
        store.createIndex('by_profile', 'profileId', { unique: false });
        store.createIndex('by_profile_ts', ['profileId', 'timestamp'], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.SHOPPING_LIST)) {
        const store = db.createObjectStore(STORES.SHOPPING_LIST, { keyPath: 'id' });
        store.createIndex('by_profile', 'profileId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.CUSTOM_FOODS)) {
        const store = db.createObjectStore(STORES.CUSTOM_FOODS, { keyPath: 'id' });
        store.createIndex('by_profile', 'profileId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('Impossible d’ouvrir IndexedDB'));
    };
  });

  return dbPromise;
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTx(storeNames, mode, callback) {
  const db = await openDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const tx = db.transaction(names, mode);
  const result = await callback(tx);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction IndexedDB annulée'));
  });
  return result;
}

export async function getRecord(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  return reqToPromise(tx.objectStore(storeName).get(key));
}

export async function putRecord(storeName, record) {
  return runTx(storeName, 'readwrite', (tx) =>
    reqToPromise(tx.objectStore(storeName).put(record))
  );
}

export async function deleteRecord(storeName, key) {
  return runTx(storeName, 'readwrite', (tx) =>
    reqToPromise(tx.objectStore(storeName).delete(key))
  );
}

export async function getAllRecords(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  return reqToPromise(tx.objectStore(storeName).getAll());
}

export async function getRecordsByIndex(storeName, indexName, query) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  return reqToPromise(tx.objectStore(storeName).index(indexName).getAll(query));
}

/* ==========================================================================
   META & PROTECTION ANTI-PURGE iOS / WEB STORAGE
   ========================================================================== */

export async function getMeta(key, fallback = null) {
  const row = await getRecord(STORES.META, key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await putRecord(STORES.META, { key, value, updatedAt: Date.now() });
  return value;
}

export function detectEnvironment() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const platform = typeof navigator !== 'undefined' ? navigator.platform : '';
  const maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;

  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (platform === 'MacIntel' && maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isStandalone =
    (typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' && navigator.standalone === true);

  return {
    isIOS,
    isAndroid,
    isStandalone,
    needsIOSInstallBanner: isIOS && !isStandalone,
  };
}

export async function initStoragePersistence() {
  const env = detectEnvironment();
  let persisted = false;
  let usageBytes = 0;
  let quotaBytes = 0;

  if (typeof navigator !== 'undefined' && navigator.storage) {
    try {
      if (typeof navigator.storage.persisted === 'function') {
        persisted = await navigator.storage.persisted();
      }
      if (!persisted && typeof navigator.storage.persist === 'function') {
        persisted = await navigator.storage.persist();
      }
      if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        usageBytes = est.usage || 0;
        quotaBytes = est.quota || 0;
      }
    } catch {
      persisted = false;
    }
  }

  const lastBackupAt = await getMeta('lastBackupAt', null);
  const firstSeenAt = (await getMeta('firstSeenAt', null)) || (await setMeta('firstSeenAt', Date.now()));
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const referenceTs = lastBackupAt || firstSeenAt;
  const daysSinceBackup = Math.floor((Date.now() - referenceTs) / (24 * 60 * 60 * 1000));
  const backupReminderDue = Date.now() - referenceTs >= thirtyDaysMs;

  return {
    ...env,
    persisted,
    usageBytes,
    quotaBytes,
    lastBackupAt,
    daysSinceBackup,
    backupReminderDue,
  };
}

/* ==========================================================================
   GESTION MULTI-PROFILS ISOLÉS
   ========================================================================== */

export function buildDefaultProfile(partial = {}) {
  const now = Date.now();
  return {
    id: partial.id || generateId('prof'),
    name: (partial.name || 'Athlète').trim(),
    createdAt: partial.createdAt || now,
    updatedAt: now,
    sex: partial.sex || 'male', // 'male' | 'female'
    age: Number(partial.age) || 28,
    heightCm: Number(partial.heightCm) || 176,
    weightKg: Number(partial.weightKg) || 75,
    goal: partial.goal || 'recomp', // 'recomp' | 'fat_loss' | 'lean_bulk' | 'hypertrophy' | 'strength' | 'health_posture'
    level: partial.level || 'intermediate', // 'beginner' | 'intermediate' | 'advanced'
    sessionsPerWeek: Number(partial.sessionsPerWeek) || 4,
    sessionDurationMin: Number(partial.sessionDurationMin) || 60,
    splitPreference: partial.splitPreference || 'auto', // 'auto' | 'full_body' | 'upper_lower' | 'ppl' | 'hybrid_ul_ppl' | 'arnold' | 'bro_split'
    progressionMethod: partial.progressionMethod || 'double_progression', // 'double_progression' | 'reverse_pyramid' | 'top_set_backoff' | 'classic_pyramid' | 'rest_pause' | 'dup'
    equipment: Array.isArray(partial.equipment)
      ? partial.equipment
      : ['barbell', 'dumbbells', 'cables', 'machines', 'bench', 'pullup_bar'],
    injuries: Array.isArray(partial.injuries) ? partial.injuries : [], // [{ zone, severity: 1|2|3, notes }]
    morphology: {
      femurTorsoRatio: 'balanced', // 'long_femur' | 'balanced' | 'short_femur'
      armSpanRatio: 'balanced', // 'long_arms' | 'balanced' | 'short_arms'
      claviclePelvisRatio: 'balanced', // 'broad_shoulders' | 'balanced' | 'narrow_shoulders'
      ribcageType: 'medium', // 'narrow' | 'medium' | 'wide'
      postureFlags: [], // 'anterior_pelvic_tilt' | 'kyphosis' | 'forward_head' | 'protracted_shoulders'
      ...(partial.morphology || {}),
    },
    lifestyle: {
      neatLevel: 'mixed', // 'sedentary' | 'mixed' | 'active'
      stepTarget: 8500,
      ...(partial.lifestyle || {}),
    },
    nutritionPrefs: {
      dietType: 'omnivore', // 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian' | 'halal' | 'gluten_free'
      allergies: [],
      mealsPerDay: 3,
      cookingTimeMin: 25,
      ...(partial.nutritionPrefs || {}),
    },
    lagPriorities: Array.isArray(partial.lagPriorities) ? partial.lagPriorities : [],
    dominantGroups: Array.isArray(partial.dominantGroups) ? partial.dominantGroups : [],
    asymmetries: Array.isArray(partial.asymmetries) ? partial.asymmetries : [],
    coachMemory: Array.isArray(partial.coachMemory) ? partial.coachMemory : [], // [{ id, text, category, createdAt }]
    ntfyTopic: partial.ntfyTopic || '',
    demoProfile: Boolean(partial.demoProfile),
  };
}

export async function listProfiles() {
  const profiles = await getAllRecords(STORES.PROFILES);
  return profiles.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function createProfile(data, { setActive = true } = {}) {
  const profile = buildDefaultProfile(data);
  await putRecord(STORES.PROFILES, profile);
  if (setActive) {
    await setMeta('activeProfileId', profile.id);
  }
  return profile;
}

export async function getProfile(profileId) {
  return getRecord(STORES.PROFILES, profileId);
}

export async function getActiveProfile() {
  const activeId = await getMeta('activeProfileId', null);
  if (activeId) {
    const profile = await getProfile(activeId);
    if (profile) return profile;
  }
  const all = await listProfiles();
  if (all.length > 0) {
    await setMeta('activeProfileId', all[0].id);
    return all[0];
  }
  return null;
}

export async function setActiveProfile(profileId) {
  const profile = await getProfile(profileId);
  if (!profile) {
    throw new Error(`Profil introuvable : ${profileId}`);
  }
  await setMeta('activeProfileId', profileId);
  return profile;
}

export async function updateProfile(profileId, patch) {
  const existing = await getProfile(profileId);
  if (!existing) {
    throw new Error(`Profil introuvable : ${profileId}`);
  }
  const updated = {
    ...existing,
    ...patch,
    morphology: { ...(existing.morphology || {}), ...(patch.morphology || {}) },
    lifestyle: { ...(existing.lifestyle || {}), ...(patch.lifestyle || {}) },
    nutritionPrefs: { ...(existing.nutritionPrefs || {}), ...(patch.nutritionPrefs || {}) },
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  await putRecord(STORES.PROFILES, updated);
  return updated;
}

export async function deleteProfile(profileId) {
  const storesToClean = [STORES.PROFILES, STORES.AI_SETTINGS, ...PROFILE_SCOPED_STORES];
  await runTx(storesToClean, 'readwrite', async (tx) => {
    tx.objectStore(STORES.PROFILES).delete(profileId);
    tx.objectStore(STORES.AI_SETTINGS).delete(profileId);

    for (const storeName of PROFILE_SCOPED_STORES) {
      const store = tx.objectStore(storeName);
      const keys = await reqToPromise(store.index('by_profile').getAllKeys(profileId));
      for (const key of keys) {
        store.delete(key);
      }
    }
  });

  const activeId = await getMeta('activeProfileId', null);
  if (activeId === profileId) {
    const remaining = await listProfiles();
    await setMeta('activeProfileId', remaining[0]?.id || null);
  }
}

/* ==========================================================================
   ACCESSEURS MÉTIER PAR PROFIL
   ========================================================================== */

export async function getAISettings(profileId) {
  return (await getRecord(STORES.AI_SETTINGS, profileId)) || null;
}

export async function saveAISettings(profileId, settings) {
  const record = { ...settings, profileId, updatedAt: Date.now() };
  await putRecord(STORES.AI_SETTINGS, record);
  return record;
}

export async function saveProgram(profileId, program) {
  const all = await getRecordsByIndex(STORES.PROGRAMS, 'by_profile', profileId);
  const now = Date.now();
  const record = {
    id: program.id || generateId('prog'),
    profileId,
    createdAt: program.createdAt || now,
    updatedAt: now,
    active: program.active !== false,
    ...program,
  };

  await runTx(STORES.PROGRAMS, 'readwrite', (tx) => {
    const store = tx.objectStore(STORES.PROGRAMS);
    if (record.active) {
      for (const existing of all) {
        if (existing.id !== record.id && existing.active) {
          store.put({ ...existing, active: false, updatedAt: now });
        }
      }
    }
    store.put(record);
  });
  return record;
}

export async function getActiveProgram(profileId) {
  const all = await getRecordsByIndex(STORES.PROGRAMS, 'by_profile', profileId);
  return all.find((p) => p.active) || all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
}

export async function listPrograms(profileId) {
  const all = await getRecordsByIndex(STORES.PROGRAMS, 'by_profile', profileId);
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function saveWorkout(profileId, workout) {
  const record = {
    id: workout.id || generateId('wk'),
    profileId,
    date: workout.date || getTodayISO(),
    startedAt: workout.startedAt || Date.now(),
    endedAt: workout.endedAt || Date.now(),
    ...workout,
  };
  await putRecord(STORES.WORKOUTS, record);
  return record;
}

export async function listWorkouts(profileId) {
  const rows = await getRecordsByIndex(STORES.WORKOUTS, 'by_profile', profileId);
  return rows.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export async function deleteWorkout(workoutId) {
  return deleteRecord(STORES.WORKOUTS, workoutId);
}

export async function saveBiometric(profileId, entry) {
  const record = {
    id: entry.id || generateId('bio'),
    profileId,
    date: entry.date || getTodayISO(),
    timestamp: entry.timestamp || Date.now(),
    source: entry.source || 'manual',
    ...entry,
  };
  await putRecord(STORES.BIOMETRICS, record);
  return record;
}

export async function listBiometrics(profileId) {
  const rows = await getRecordsByIndex(STORES.BIOMETRICS, 'by_profile', profileId);
  return rows.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.timestamp || 0) - (b.timestamp || 0));
}

export async function deleteBiometric(bioId) {
  return deleteRecord(STORES.BIOMETRICS, bioId);
}

export async function resetBiometricsBaseline(profileId, currentWeightKg, todayISO = getTodayISO()) {
  const previous = await listBiometrics(profileId);
  const weight = Number(currentWeightKg);
  const baselineRecord =
    Number.isFinite(weight) && weight > 25
      ? {
          id: generateId('bio'),
          profileId,
          date: todayISO,
          timestamp: Date.now(),
          weightKg: Number(weight.toFixed(1)),
          source: 'baseline_reset',
        }
      : null;

  await runTx(STORES.BIOMETRICS, 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.BIOMETRICS);
    const keys = await reqToPromise(store.index('by_profile').getAllKeys(profileId));
    for (const key of keys) {
      store.delete(key);
    }
    if (baselineRecord) {
      store.put(baselineRecord);
    }
  });

  return {
    previous,
    baselineRecord,
  };
}

export async function restoreBiometricsForProfile(profileId, entries = []) {
  await runTx(STORES.BIOMETRICS, 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.BIOMETRICS);
    const keys = await reqToPromise(store.index('by_profile').getAllKeys(profileId));
    for (const key of keys) {
      store.delete(key);
    }
    for (const entry of entries || []) {
      store.put({ ...entry, profileId });
    }
  });
  return listBiometrics(profileId);
}

export async function saveNutritionLog(profileId, entry) {
  const record = {
    id: entry.id || generateId('nut'),
    profileId,
    date: entry.date || getTodayISO(),
    timestamp: entry.timestamp || Date.now(),
    ...entry,
  };
  await putRecord(STORES.NUTRITION_LOGS, record);
  return record;
}

export async function listNutritionLogs(profileId, date = null) {
  const rows = date
    ? await getRecordsByIndex(STORES.NUTRITION_LOGS, 'by_profile_date', [profileId, date])
    : await getRecordsByIndex(STORES.NUTRITION_LOGS, 'by_profile', profileId);
  return rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function deleteNutritionLog(logId) {
  return deleteRecord(STORES.NUTRITION_LOGS, logId);
}

export async function saveFavorite(profileId, favorite) {
  const record = {
    id: favorite.id || generateId('fav'),
    profileId,
    createdAt: favorite.createdAt || Date.now(),
    ...favorite,
  };
  await putRecord(STORES.FAVORITES, record);
  return record;
}

export async function listFavorites(profileId) {
  const rows = await getRecordsByIndex(STORES.FAVORITES, 'by_profile', profileId);
  return rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function deleteFavorite(favoriteId) {
  return deleteRecord(STORES.FAVORITES, favoriteId);
}

export async function getHydrationForDate(profileId, date = getTodayISO()) {
  const rows = await getRecordsByIndex(STORES.HYDRATION_LOGS, 'by_profile_date', [profileId, date]);
  return rows[0] || { id: `hyd_${profileId}_${date}`, profileId, date, totalMl: 0, entries: [] };
}

export async function addHydration(profileId, deltaMl, date = getTodayISO()) {
  const current = await getHydrationForDate(profileId, date);
  const nextTotal = Math.max(0, (current.totalMl || 0) + Number(deltaMl));
  const updated = {
    ...current,
    id: current.id || `hyd_${profileId}_${date}`,
    profileId,
    date,
    totalMl: nextTotal,
    entries: [...(current.entries || []), { ml: Number(deltaMl), timestamp: Date.now() }],
  };
  await putRecord(STORES.HYDRATION_LOGS, updated);
  return updated;
}

export async function savePhysiquePhoto(profileId, photoRecord) {
  const record = {
    id: photoRecord.id || generateId('ph'),
    profileId,
    date: photoRecord.date || getTodayISO(),
    timestamp: photoRecord.timestamp || Date.now(),
    angle: photoRecord.angle || 'front',
    ...photoRecord,
  };
  await putRecord(STORES.PHYSIQUE_PHOTOS, record);
  return record;
}

export async function listPhysiquePhotos(profileId) {
  const rows = await getRecordsByIndex(STORES.PHYSIQUE_PHOTOS, 'by_profile', profileId);
  return rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function deletePhysiquePhoto(photoId) {
  return deleteRecord(STORES.PHYSIQUE_PHOTOS, photoId);
}

export async function addCoachMessage(profileId, message) {
  const record = {
    id: message.id || generateId('msg'),
    profileId,
    timestamp: message.timestamp || Date.now(),
    role: message.role || 'user',
    content: message.content || '',
    tierUsed: message.tierUsed ?? null,
    provider: message.provider || null,
    fallbackReason: message.fallbackReason || null,
    actionProposal: message.actionProposal || null,
    actionApplied: Boolean(message.actionApplied),
    executedBadges: Array.isArray(message.executedBadges) ? message.executedBadges : [],
    meta: message.meta || {},
  };
  await putRecord(STORES.COACH_MESSAGES, record);
  return record;
}

export async function updateCoachMessage(record) {
  if (!record?.id) return null;
  await putRecord(STORES.COACH_MESSAGES, record);
  return record;
}

export async function listCoachMessages(profileId, limit = 80) {
  const rows = await getRecordsByIndex(STORES.COACH_MESSAGES, 'by_profile', profileId);
  const sorted = rows.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return sorted.slice(-limit);
}

export async function clearCoachMessages(profileId) {
  await runTx(STORES.COACH_MESSAGES, 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.COACH_MESSAGES);
    const keys = await reqToPromise(store.index('by_profile').getAllKeys(profileId));
    for (const key of keys) store.delete(key);
  });
}

export async function saveShoppingItem(profileId, item) {
  const record = {
    id: item.id || generateId('shop'),
    profileId,
    aisle: item.aisle || 'Divers',
    name: item.name || '',
    quantity: item.quantity || '',
    unit: item.unit || '',
    checked: Boolean(item.checked),
    updatedAt: Date.now(),
  };
  await putRecord(STORES.SHOPPING_LIST, record);
  return record;
}

export async function listShoppingList(profileId) {
  const rows = await getRecordsByIndex(STORES.SHOPPING_LIST, 'by_profile', profileId);
  return rows.sort((a, b) => (a.aisle || '').localeCompare(b.aisle || '') || (a.name || '').localeCompare(b.name || ''));
}

export async function deleteShoppingItem(itemId) {
  return deleteRecord(STORES.SHOPPING_LIST, itemId);
}

export async function listCustomFoods(profileId) {
  const rows = await getRecordsByIndex(STORES.CUSTOM_FOODS, 'by_profile', profileId);
  return rows.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
}

export async function saveCustomFood(profileId, food) {
  const existing = await listCustomFoods(profileId);
  const cleanName = String(food?.name || '').trim();
  const cleanBarcode = String(food?.barcode || '').trim();

  // Évite les doublons si même code-barres ou même nom exact
  const duplicate = existing.find(
    (item) =>
      (cleanBarcode && item.barcode && item.barcode === cleanBarcode) ||
      (cleanName && item.name.toLowerCase() === cleanName.toLowerCase() && (item.brand || '') === (food?.brand || ''))
  );

  const now = Date.now();
  const record = {
    id: food?.id || duplicate?.id || generateId('cfood'),
    profileId,
    name: cleanName || 'Aliment perso',
    brand: String(food?.brand || '').trim(),
    barcode: cleanBarcode,
    source: food?.source || 'custom', // 'custom' | 'off_cached' | 'ai_estimated'
    kcal: Math.max(0, Math.round(Number(food?.kcal) || 0)),
    proteinG: Math.max(0, Math.round((Number(food?.proteinG) || 0) * 10) / 10),
    carbsG: Math.max(0, Math.round((Number(food?.carbsG) || 0) * 10) / 10),
    fatG: Math.max(0, Math.round((Number(food?.fatG) || 0) * 10) / 10),
    fiberG: Math.max(0, Math.round((Number(food?.fiberG) || 0) * 10) / 10),
    portion:
      food?.portion && Number(food.portion.grams) > 0
        ? {
            label: String(food.portion.label || '1 portion').trim(),
            grams: Math.round(Number(food.portion.grams)),
          }
        : null,
    aisle: food?.aisle || 'Aliments Perso',
    createdAt: duplicate?.createdAt || food?.createdAt || now,
    updatedAt: now,
  };

  await putRecord(STORES.CUSTOM_FOODS, record);
  return record;
}

export async function deleteCustomFood(foodId) {
  return deleteRecord(STORES.CUSTOM_FOODS, foodId);
}

/* ==========================================================================
   EXPORT / IMPORT JSON COMPLET (AVEC SÉRIALISATION BLOB PHOTOS)
   ========================================================================== */

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Échec lecture Blob'));
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function exportAllData({ profileId = null, includePhotos = true } = {}) {
  const allStoreNames = Object.values(STORES);
  const data = {};

  for (const storeName of allStoreNames) {
    let rows = [];
    if (profileId && PROFILE_SCOPED_STORES.includes(storeName)) {
      rows = await getRecordsByIndex(storeName, 'by_profile', profileId);
    } else if (profileId && storeName === STORES.PROFILES) {
      const p = await getProfile(profileId);
      rows = p ? [p] : [];
    } else if (profileId && storeName === STORES.AI_SETTINGS) {
      const s = await getAISettings(profileId);
      rows = s ? [s] : [];
    } else {
      rows = await getAllRecords(storeName);
    }

    if (storeName === STORES.PHYSIQUE_PHOTOS) {
      const serialized = [];
      for (const row of rows) {
        if (!includePhotos) {
          const { blob, ...metaOnly } = row;
          serialized.push({ ...metaOnly, blobOmitted: true });
        } else if (row.blob instanceof Blob) {
          const { blob, ...rest } = row;
          const dataUrl = await blobToDataURL(blob);
          serialized.push({ ...rest, blobDataUrl: dataUrl });
        } else {
          serialized.push(row);
        }
      }
      data[storeName] = serialized;
    } else {
      data[storeName] = rows;
    }
  }

  await setMeta('lastBackupAt', Date.now());

  return {
    app: 'Kinetix Lab',
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    scope: profileId ? `profile:${profileId}` : 'all',
    data,
  };
}

export async function importAllData(payload, { replaceAll = false } = {}) {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.data !== 'object') {
    throw new Error('Fichier de sauvegarde invalide : propriété "data" absente.');
  }

  const allStoreNames = Object.values(STORES);
  const importedCounts = {};

  await runTx(allStoreNames, 'readwrite', (tx) => {
    for (const storeName of allStoreNames) {
      const store = tx.objectStore(storeName);
      if (replaceAll) {
        store.clear();
      }
      const rows = Array.isArray(parsed.data[storeName]) ? parsed.data[storeName] : [];
      importedCounts[storeName] = 0;

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        if (storeName === STORES.PHYSIQUE_PHOTOS && typeof row.blobDataUrl === 'string') {
          const { blobDataUrl, ...rest } = row;
          const blob = dataURLToBlob(blobDataUrl);
          store.put({ ...rest, blob });
        } else {
          store.put(row);
        }
        importedCounts[storeName] += 1;
      }
    }
  });

  return { importedCounts, exportedAt: parsed.exportedAt || null };
}

export function triggerJsonDownload(payload, filename = null) {
  const dateTag = getTodayISO();
  const safeName = filename || `kinetix-lab-backup-${dateTag}.json`;
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ==========================================================================
   CHIFFREMENT CLIENT AES-256-GCM (WEB CRYPTO API) & SYNC GITHUB PRIVÉ
   ========================================================================== */

const PBKDF2_ITERATIONS = 210000;

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAESKey(passphrase, saltBytes, iterations = PBKDF2_ITERATIONS) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('La phrase secrète doit contenir au moins 8 caractères.');
  }
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPayloadAESGCM(dataOrString, passphrase) {
  const plaintext = typeof dataOrString === 'string' ? dataOrString : JSON.stringify(dataOrString);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAESKey(passphrase, salt, PBKDF2_ITERATIONS);

  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  return {
    v: 1,
    app: 'Kinetix Lab',
    alg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    encryptedAt: new Date().toISOString(),
  };
}

export async function decryptPayloadAESGCM(envelopeOrString, passphrase) {
  const envelope = typeof envelopeOrString === 'string' ? JSON.parse(envelopeOrString) : envelopeOrString;
  if (!envelope || envelope.alg !== 'AES-256-GCM' || !envelope.salt || !envelope.iv || !envelope.ciphertext) {
    throw new Error('Enveloppe chiffrée AES-256-GCM invalide.');
  }

  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const iterations = Number(envelope.iterations) || PBKDF2_ITERATIONS;
  const key = await deriveAESKey(passphrase, salt, iterations);

  try {
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const plaintext = new TextDecoder().decode(plainBuffer);
    return JSON.parse(plaintext);
  } catch {
    throw new Error('Déchiffrement impossible : phrase secrète incorrecte ou fichier corrompu.');
  }
}

export async function pushEncryptedBackupToGitHub({
  owner,
  repo,
  path = 'kinetix-backup.enc.json',
  branch = 'main',
  token,
  passphrase,
  profileId = null,
  includePhotos = false,
}) {
  if (!owner || !repo || !token) {
    throw new Error('Paramètres GitHub incomplets (owner, repo et token requis).');
  }

  const exportPayload = await exportAllData({ profileId, includePhotos });
  const encryptedEnvelope = await encryptPayloadAESGCM(exportPayload, passphrase);
  const contentJson = JSON.stringify(encryptedEnvelope, null, 2);
  const contentB64 = bytesToBase64(new TextEncoder().encode(contentJson));

  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.replace(/^\/+/, '')}`;
  const headers = {
    Authorization: `Bearer ${token.trim()}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  let existingSha = null;
  const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
  if (getRes.ok) {
    const existing = await getRes.json();
    existingSha = existing.sha || null;
  } else if (getRes.status !== 404) {
    const errText = await getRes.text();
    throw new Error(`Erreur GitHub (${getRes.status}) : ${errText.slice(0, 180)}`);
  }

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `Kinetix Lab encrypted backup (${getTodayISO()})`,
      content: contentB64,
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`Échec upload GitHub (${putRes.status}) : ${errText.slice(0, 180)}`);
  }

  const result = await putRes.json();
  await setMeta('lastGithubSyncAt', Date.now());
  return {
    commitSha: result.commit?.sha || null,
    fileSha: result.content?.sha || null,
    sizeBytes: contentJson.length,
    syncedAt: new Date().toISOString(),
  };
}

export async function pullEncryptedBackupFromGitHub({
  owner,
  repo,
  path = 'kinetix-backup.enc.json',
  branch = 'main',
  token,
  passphrase,
  replaceAll = false,
}) {
  if (!owner || !repo || !token) {
    throw new Error('Paramètres GitHub incomplets (owner, repo et token requis).');
  }

  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.replace(/^\/+/, '')}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      Accept: 'application/vnd.github+json',
    },
  });

  if (!res.ok) {
    throw new Error(`Impossible de lire le fichier GitHub (HTTP ${res.status}).`);
  }

  const fileData = await res.json();
  const cleanB64 = String(fileData.content || '').replace(/\s+/g, '');
  const envelopeStr = new TextDecoder().decode(base64ToBytes(cleanB64));
  const decryptedBackup = await decryptPayloadAESGCM(envelopeStr, passphrase);
  return importAllData(decryptedBackup, { replaceAll });
}
