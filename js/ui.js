/**
 * Kinetix Lab — Interface Complète 5 Écrans & Orchestrateur Applicatif (js/ui.js)
 *
 * 1. [COCKPIT] : Télémétrie EWMA, TDEE adaptatif, streak, 4 jauges, points faibles [LAG], brief coach, actions rapides
 * 2. [SÉANCE] : Readiness 3s + Mode Préservation, échauffement correctif, gamme montante, disques/côté,
 *               anatomie SVG wger / exécution free-exercise-db, Swap biomécanique, Dupliquer série,
 *               Toast Annuler 5s, Dictée vocale, Chrono sticky Wake Lock, Cardio adapté
 * 3. [NUTRITION] : Reste à manger, Photo assiette Vision, Scanner Code-Barres + Open Food Facts,
 *                  Base Ciqual hors-ligne + Favoris 1-tap, Plan type & Liste de courses par rayon
 * 4. [LABO & ÉVOLUTION] : Import OCR balance, mensurations US Navy & WHtR, 4 graphiques Chart.js,
 *                         Labo Photos 3 angles (Ghost Overlay J1, comparateur Avant/Après, MediaPipe + Vision, Mutation Diff 1-clic)
 * 5. [COACH & PROFIL] : Chat Coach contextualisé, profil morpho-anatomique/objectifs/matériel,
 *                       multi-profils, Routeur IA 4 niveaux + Testeur connexion, Partage P2P QR/LZ-String,
 *                       Pont Apple Santé / Health Connect, ntfy.sh, Backup JSON & Sync GitHub AES-256-GCM
 */

import {
  openDB,
  initStoragePersistence,
  getTodayISO,
  generateId,
  listProfiles,
  createProfile,
  getActiveProfile,
  setActiveProfile,
  updateProfile,
  deleteProfile,
  getAISettings,
  saveAISettings,
  getActiveProgram,
  saveProgram,
  listWorkouts,
  saveWorkout,
  listBiometrics,
  saveBiometric,
  listNutritionLogs,
  saveNutritionLog,
  deleteNutritionLog,
  listFavorites,
  saveFavorite,
  deleteFavorite,
  getHydrationForDate,
  addHydration,
  listPhysiquePhotos,
  savePhysiquePhoto,
  deletePhysiquePhoto,
  listCoachMessages,
  addCoachMessage,
  updateCoachMessage,
  clearCoachMessages,
  listShoppingList,
  saveShoppingItem,
  deleteShoppingItem,
  exportAllData,
  importAllData,
  triggerJsonDownload,
  pushEncryptedBackupToGitHub,
  pullEncryptedBackupFromGitHub,
} from './db.js';

import {
  AI_TIERS,
  TIER2_PRESETS,
  TIER3_MODELS,
  normalizeAISettings,
  detectPresetFromApiKey,
  isVertexExpressKey,
  testAIConnection,
  detectBrowserLlmCapability,
  routeAIRequest,
} from './ai-router.js';

import {
  MUSCLE_GROUPS,
  getExerciseById,
  getExerciseMediaUrls,
  getWgerAnatomyLayers,
} from './exercises-db.js';

import {
  GOAL_PROFILES,
  TRAINING_SPLITS,
  TRAINING_METHODS,
  VOLUME_LANDMARKS,
  buildSetScheme,
  generateProgram,
  evaluateReadiness,
  applyPreservationMode,
  generateWarmupRamp,
  calculatePerSideLoad,
  findBiomechanicalSwaps,
  estimate1RM,
  evaluateExerciseProgression,
  detectDeloadNeed,
  computeProgramMutation,
  applyProgramMutation,
  buildCoachRuntimeContext,
  analyzeCoachFeedbackAndProposeAction,
} from './biomechanics-engine.js';

import {
  PHOTO_ANGLES,
  PhysiqueCameraController,
  compressPhysiqueImage,
  mountBeforeAfterSlider,
  runDualPhysiqueAnalysis,
  drawPoseLandmarksOverlay,
  blobToDataUrl,
} from './physique-lab.js';

import {
  searchCiqualOffline,
  scaleFoodMacros,
  lookupBarcodeOpenFoodFacts,
  searchOpenFoodFactsText,
  BarcodeScannerController,
  computeUSNavyBodyFat,
  computeWHtR,
  computeEWMASeries,
  computeAdaptiveTDEE,
  calculateMacroTargets,
  analyzeMealPhoto,
  extractScaleMetricsOCR,
  generateMealPlanAndShoppingList,
} from './nutrition-db.js';

import {
  RestTimerController,
  WorkoutWakeLock,
  listenGymVoice,
} from './timer.js';

import {
  encodeSharePayload,
  decodeShareTokenOrUrl,
  parseIncomingShareHash,
  clearShareHash,
  renderLocalQRCode,
  processHealthUrlSyncParams,
  getHealthBridgeTemplates,
  sendNtfyNotification,
} from './p2p-share.js';

/* ==========================================================================
   ÉTAT GLOBAL APPLICATIF
   ========================================================================== */

const state = {
  route: 'cockpit', // 'cockpit' | 'seance' | 'nutrition' | 'labo' | 'profil'
  profile: null,
  profiles: [],
  aiSettings: normalizeAISettings(),
  program: null,
  workouts: [],
  biometrics: [],
  nutritionToday: [],
  nutritionAll: [],
  favorites: [],
  hydration: { totalMl: 0, entries: [] },
  photos: [],
  coachMessages: [],
  shoppingList: [],
  storageInfo: null,
  deferredInstallPrompt: null,
  manualKcalOffset: 0,

  // État séance en cours
  selectedDayIdx: 0,
  activeSession: null,
  readinessDraft: { sleep: 4, soreness: 4, energy: 4 },
  readinessExpanded: false,
  openDrawers: {}, // { [slotId]: 'anatomy' | 'execution' | 'plates' | null }

  // État nutrition
  nutritionSubTab: 'ciqual', // 'photo' | 'barcode' | 'ciqual' | 'plan'
  ciqualQuery: '',
  offResults: [],
  lastMealVisionResult: null,
  barcodeScanner: null,

  // État Labo
  laboSubTab: 'biometrics', // 'biometrics' | 'photos'
  laboAngle: 'front',
  cameraController: null,
  lastPhysiqueAnalysis: null,
  pendingMutation: null,
  chartInstances: [],

  // État Coach/Profil
  profilSubTab: 'coach', // 'coach' | 'profile' | 'ai' | 'p2p' | 'backup'
  showApiKey: false,
  lastProbeResult: null,
  coachBusy: false,
  lastShareResult: null,
};

const wakeLock = new WorkoutWakeLock(({ active }) => {
  const el = document.getElementById('wakelock-indicator');
  if (el) el.textContent = active ? 'Wake Lock actif' : 'Chrono horodaté';
});

const restTimer = new RestTimerController({
  voiceEnabled: true,
  onTick: (t) => {
    const bar = document.getElementById('rest-timer-bar');
    const digits = document.getElementById('rest-timer-digits');
    const label = document.getElementById('rest-timer-label');
    if (!bar || !digits || !label) return;
    if (!t.active) {
      bar.classList.add('is-hidden');
      return;
    }
    bar.classList.remove('is-hidden');
    digits.textContent = t.formatted;
    label.textContent = t.label ? `Repos · ${t.label}` : 'Repos en cours';
  },
  onFinish: ({ label }) => {
    showToast(`Repos terminé${label ? ` — ${label}` : ''}.`);
  },
});

/* ==========================================================================
   UTILITAIRES SÉCURISÉS DOM, TOAST ANNULER (5S) & MODALES
   ========================================================================== */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, { undoAction = null, durationMs = 5000 } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const el = document.createElement('div');
  el.className = 'toast';

  const txt = document.createElement('span');
  txt.textContent = message;
  el.appendChild(txt);

  let timerId = null;
  const dismiss = () => {
    clearTimeout(timerId);
    el.remove();
  };

  if (typeof undoAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-undo-btn';
    btn.textContent = 'Annuler (5s)';
    btn.onclick = async () => {
      dismiss();
      await undoAction();
      showToast('Action annulée.');
    };
    el.appendChild(btn);
  }

  region.appendChild(el);
  timerId = setTimeout(dismiss, durationMs);
}

function openModal(title, bodyHtml, onMount = null) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = `
    <div class="modal-backdrop" id="active-modal-backdrop">
      <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="panel-header">
          <h2>${esc(title)}</h2>
          <button type="button" class="btn btn-sm" id="btn-close-modal">Fermer</button>
        </div>
        <div id="modal-body-slot" class="stack">${bodyHtml}</div>
      </div>
    </div>
  `;

  const close = () => {
    root.innerHTML = '';
  };

  document.getElementById('btn-close-modal')?.addEventListener('click', close);
  document.getElementById('active-modal-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'active-modal-backdrop') close();
  });

  if (typeof onMount === 'function') {
    onMount({ close, body: document.getElementById('modal-body-slot') });
  }
}

/* ==========================================================================
   CHARGEMENT DONNÉES & PROFIL DÉMO COMPLET (TEST IMMÉDIAT)
   ========================================================================== */

async function loadProfileWorkspace() {
  state.profiles = await listProfiles();
  state.profile = await getActiveProfile();

  const quickBtn = document.getElementById('btn-profile-quick');
  if (quickBtn) {
    if (state.profile) {
      quickBtn.hidden = false;
      quickBtn.textContent = state.profile.name;
    } else {
      quickBtn.hidden = true;
    }
  }

  if (!state.profile) {
    state.program = null;
    return;
  }

  const pid = state.profile.id;
  const today = getTodayISO();

  const [
    savedAi,
    prog,
    workouts,
    biometrics,
    nutAll,
    favorites,
    hydration,
    photos,
    coachMsgs,
    shopping,
  ] = await Promise.all([
    getAISettings(pid),
    getActiveProgram(pid),
    listWorkouts(pid),
    listBiometrics(pid),
    listNutritionLogs(pid),
    listFavorites(pid),
    getHydrationForDate(pid, today),
    listPhysiquePhotos(pid),
    listCoachMessages(pid),
    listShoppingList(pid),
  ]);

  state.aiSettings = normalizeAISettings(savedAi);
  state.workouts = workouts;
  state.biometrics = biometrics;
  state.nutritionAll = nutAll;
  state.nutritionToday = nutAll.filter((n) => n.date === today);
  state.favorites = favorites;
  state.hydration = hydration;
  state.photos = photos;
  state.coachMessages = coachMsgs;
  state.shoppingList = shopping;

  if (!prog) {
    const generated = generateProgram(state.profile, { phase: 'calibration' });
    state.program = await saveProgram(pid, generated);
  } else {
    state.program = prog;
  }

  // Traitement pont URL Apple Santé / Health Connect au démarrage
  const syncedBio = await processHealthUrlSyncParams(state.profile);
  if (syncedBio) {
    state.biometrics = await listBiometrics(pid);
    showToast(`Synchronisation santé importée (${syncedBio.weightKg ? syncedBio.weightKg + ' kg' : syncedBio.steps + ' pas'}).`);
  }
}

async function seedDemoProfile() {
  const profile = await createProfile({
    name: 'Alex (Démo)',
    sex: 'male',
    age: 30,
    heightCm: 179,
    weightKg: 78.4,
    goal: 'recomp',
    level: 'intermediate',
    sessionsPerWeek: 4,
    sessionDurationMin: 60,
    equipment: ['barbell', 'dumbbells', 'cables', 'machines', 'bench', 'pullup_bar'],
    injuries: [{ zone: 'lumbar', severity: 1, notes: 'Raideur lombaire légère sur flexion lourde' }],
    morphology: {
      femurTorsoRatio: 'long_femur',
      armSpanRatio: 'balanced',
      claviclePelvisRatio: 'balanced',
      postureFlags: ['protracted_shoulders'],
    },
    lifestyle: { neatLevel: 'mixed', stepTarget: 9000 },
    nutritionPrefs: { dietType: 'omnivore', allergies: [], mealsPerDay: 3, cookingTimeMin: 20 },
    lagPriorities: ['delts_lat', 'pecs_upper'],
    dominantGroups: ['delts_ant'],
    demoProfile: true,
  });

  const program = generateProgram(profile, { phase: 'accumulation', mesocycleNumber: 1 });
  await saveProgram(profile.id, program);

  // 14 jours de biométrie réaliste (pour EWMA + TDEE adaptatif + Chart.js)
  const weights = [79.4, 79.1, 79.5, 78.9, 78.8, 79.2, 78.7, 78.9, 78.6, 78.5, 78.8, 78.4, 78.5, 78.4];
  const now = Date.now();
  for (let i = 0; i < weights.length; i += 1) {
    const d = new Date(now - (weights.length - 1 - i) * 86400000);
    const iso = getTodayISO(d);
    const waist = Number((84.5 - i * 0.08).toFixed(1));
    await saveBiometric(profile.id, {
      date: iso,
      timestamp: d.getTime(),
      source: 'manual',
      weightKg: weights[i],
      bodyFatPct: Number((16.9 - i * 0.05).toFixed(1)),
      muscleMassKg: 61.8,
      neckCm: 38.5,
      waistCm: waist,
      navyBodyFatPct: computeUSNavyBodyFat({ sex: 'male', heightCm: 179, neckCm: 38.5, waistCm: waist }),
      whtr: computeWHtR(waist, 179)?.ratio || null,
      steps: 7800 + (i % 4) * 900,
    });
    if (i < weights.length - 1) {
      await saveNutritionLog(profile.id, {
        date: iso,
        timestamp: d.getTime(),
        mealSlot: 'Journée complète (historique)',
        source: 'ciqual',
        label: 'Apport journalier calibré',
        kcal: 2380 + ((i % 3) - 1) * 90,
        proteinG: 162,
        carbsG: 265,
        fatG: 72,
      });
    }
  }

  // Repas partiels d'aujourd'hui + eau
  const today = getTodayISO();
  await saveNutritionLog(profile.id, {
    date: today,
    mealSlot: 'Matin',
    source: 'ciqual',
    label: 'Bowl Skyr 250 g + Avoine 70 g + Banane',
    kcal: 515,
    proteinG: 35.5,
    carbsG: 73,
    fatG: 6.2,
  });
  await saveNutritionLog(profile.id, {
    date: today,
    mealSlot: 'Déjeuner',
    source: 'ciqual',
    label: 'Filet de poulet 180 g + Riz basmati + Brocoli + Huile olive',
    kcal: 690,
    proteinG: 48.2,
    carbsG: 74,
    fatG: 18.5,
  });
  await addHydration(profile.id, 1250, today);

  // 3 séances historiques pour alimenter la courbe 1RM & streak
  for (let s = 3; s >= 1; s -= 1) {
    const d = new Date(now - s * 2 * 86400000);
    await saveWorkout(profile.id, {
      date: getTodayISO(d),
      startedAt: d.getTime(),
      endedAt: d.getTime() + 55 * 60000,
      dayId: program.days[0].id,
      dayName: program.days[0].name,
      readiness: { sleep: 4, soreness: 4, energy: 4, score: 80, preservationMode: false },
      exercises: [
        {
          exerciseId: 'incline_db_press',
          name: 'Développé incliné haltères',
          sets: [
            { weightKg: 26 + (3 - s) * 2, reps: 10, rir: 2, done: true },
            { weightKg: 26 + (3 - s) * 2, reps: 9, rir: 1, done: true },
            { weightKg: 26 + (3 - s) * 2, reps: 9, rir: 1, done: true },
          ],
        },
        {
          exerciseId: 'leg_press_45',
          name: 'Presse à cuisses inclinée 45°',
          sets: [
            { weightKg: 150 + (3 - s) * 10, reps: 10, rir: 2, done: true },
            { weightKg: 150 + (3 - s) * 10, reps: 10, rir: 1, done: true },
          ],
        },
      ],
    });
  }

  await saveFavorite(profile.id, {
    name: 'Shaker Post-Séance (Whey 35g + Banane)',
    kcal: 238,
    proteinG: 31.2,
    carbsG: 25.5,
    fatG: 0.9,
    servingG: 155,
  });

  await addCoachMessage(profile.id, {
    role: 'assistant',
    tierUsed: 0,
    content:
      'Profil démo chargé. Vos 14 jours de pesées, la courbe EWMA, le split Upper/Lower adapté aux fémurs longs et les priorités [LAG] (Deltoïdes latéraux, Pectoraux haut) sont prêts.',
  });

  await loadProfileWorkspace();
  state.route = 'cockpit';
  renderApp();
  showToast('Profil démo complet chargé dans IndexedDB.');
}

/* ==========================================================================
   CALCULS DÉRIVÉS TRANSVERSES (MACROS, EWMA, STREAK, READINESS)
   ========================================================================== */

function getDerivedTelemetry() {
  const ewma = computeEWMASeries(state.biometrics);
  const latestBio = state.biometrics[state.biometrics.length - 1] || null;
  const knownBf = latestBio?.bodyFatPct ?? latestBio?.navyBodyFatPct ?? null;
  const adaptive = computeAdaptiveTDEE({
    biometrics: state.biometrics,
    nutritionLogs: state.nutritionAll,
    profile: state.profile,
    bodyFatPct: knownBf,
  });
  const macros = calculateMacroTargets(state.profile, {
    bodyFatPct: knownBf,
    adaptiveTdeeKcal: adaptive.adaptiveActive ? adaptive.estimatedTdeeKcal : null,
    manualKcalOffset: state.manualKcalOffset,
  });

  const consumed = state.nutritionToday.reduce(
    (acc, item) => ({
      kcal: acc.kcal + (Number(item.kcal) || 0),
      proteinG: Math.round((acc.proteinG + (Number(item.proteinG) || 0)) * 10) / 10,
      carbsG: Math.round((acc.carbsG + (Number(item.carbsG) || 0)) * 10) / 10,
      fatG: Math.round((acc.fatG + (Number(item.fatG) || 0)) * 10) / 10,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );

  // Streak séances des 28 derniers jours
  const recent7d = state.workouts.filter((w) => Date.now() - (w.startedAt || 0) <= 7 * 86400000).length;
  const deloadStatus = detectDeloadNeed(state.workouts, state.program?.weekNumber || 1);

  return { ewma, latestBio, knownBf, adaptive, macros, consumed, recent7d, deloadStatus };
}

/* ==========================================================================
   ONBOARDING PROGRESSIF (< 90 SECONDES)
   ========================================================================== */

function renderOnboarding(container) {
  document.getElementById('bottom-nav')?.setAttribute('hidden', 'true');
  container.innerHTML = `
    <section class="panel" style="max-width: 760px; margin: 0 auto; width: 100%;">
      <div class="panel-header">
        <div>
          <h1>Configuration rapide (90 secondes)</h1>
          <p class="panel-subtitle">
            100 % local sur votre appareil · Aucun compte requis · Recalcul dynamique à tout moment.
          </p>
        </div>
        <button type="button" class="btn btn-sm" id="btn-load-demo">Charger un profil démo</button>
      </div>

      <form id="onboarding-form" class="stack">
        <div class="grid-2">
          <div class="field">
            <label class="field-label" for="ob-name">Prénom / Identifiant</label>
            <input id="ob-name" class="input" type="text" required placeholder="Ex. Camille" />
          </div>
          <div class="field">
            <label class="field-label" for="ob-sex">Sexe biologique (calculs métaboliques)</label>
            <select id="ob-sex" class="select">
              <option value="male">Homme</option>
              <option value="female">Femme</option>
            </select>
          </div>
        </div>

        <div class="grid-3">
          <div class="field">
            <label class="field-label" for="ob-age">Âge</label>
            <input id="ob-age" class="input mono" type="number" min="14" max="90" value="28" required />
          </div>
          <div class="field">
            <label class="field-label" for="ob-height">Taille (cm)</label>
            <input id="ob-height" class="input mono" type="number" min="130" max="230" value="175" required />
          </div>
          <div class="field">
            <label class="field-label" for="ob-weight">Poids (kg)</label>
            <input id="ob-weight" class="input mono" type="number" step="0.1" min="35" max="220" value="74" required />
          </div>
        </div>

        <div class="grid-3">
          <div class="field">
            <label class="field-label" for="ob-goal">Objectif principal</label>
            <select id="ob-goal" class="select">
              ${Object.entries(GOAL_PROFILES)
                .map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="ob-level">Niveau</label>
            <select id="ob-level" class="select">
              <option value="beginner">Débutant</option>
              <option value="intermediate" selected>Intermédiaire</option>
              <option value="advanced">Avancé</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="ob-freq">Séances / semaine & durée</label>
            <div class="row" style="gap: 6px;">
              <select id="ob-freq" class="select">
                <option value="2">2 j</option>
                <option value="3">3 j</option>
                <option value="4" selected>4 j</option>
                <option value="5">5 j</option>
                <option value="6">6 j</option>
              </select>
              <select id="ob-dur" class="select">
                <option value="45">45 min</option>
                <option value="60" selected>60 min</option>
                <option value="75">75 min</option>
              </select>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="field">
            <label class="field-label" for="ob-split">Split d’entraînement</label>
            <select id="ob-split" class="select">
              ${Object.values(TRAINING_SPLITS)
                .map((sp) => `<option value="${sp.id}">${esc(sp.label)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="ob-method">Méthode de progression</label>
            <select id="ob-method" class="select">
              ${Object.values(TRAINING_METHODS)
                .map((m) => `<option value="${m.id}">${esc(m.label)}</option>`)
                .join('')}
            </select>
          </div>
        </div>

        <div class="field">
          <span class="field-label">Matériel disponible</span>
          <div class="row-wrap">
            ${[
              ['barbell', 'Barre olympique'],
              ['dumbbells', 'Haltères'],
              ['cables', 'Poulies'],
              ['machines', 'Machines guidées'],
              ['bench', 'Banc réglable'],
              ['pullup_bar', 'Barre de traction'],
              ['bands', 'Élastiques'],
              ['bodyweight', 'Poids du corps'],
            ]
              .map(
                ([val, lbl]) => `
                <label class="row panel-elevated" style="padding: 8px 12px; cursor: pointer; min-height: 44px;">
                  <input type="checkbox" name="ob-eq" value="${val}" ${['barbell', 'dumbbells', 'cables', 'machines', 'bench', 'pullup_bar'].includes(val) ? 'checked' : ''} />
                  <span>${lbl}</span>
                </label>`
              )
              .join('')}
          </div>
        </div>

        <div class="grid-2">
          <div class="field">
            <label class="field-label" for="ob-injury-zone">Zone sensible / douleur articulaire (optionnel)</label>
            <select id="ob-injury-zone" class="select">
              <option value="">Aucune douleur articulaire</option>
              <option value="lumbar">Lombaires / Bas du dos</option>
              <option value="shoulder">Épaules / Coiffe</option>
              <option value="knee">Genoux / Rotule</option>
              <option value="elbow">Coudes / Tendons</option>
              <option value="wrist">Poignets</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="ob-injury-sev">Sévérité (1 légère · 2 modérée · 3 exclusion stricte)</label>
            <select id="ob-injury-sev" class="select">
              <option value="1">1 — Précaution / Alerte</option>
              <option value="2">2 — Exclusion mouvements à risque</option>
              <option value="3">3 — Protection maximale</option>
            </select>
          </div>
        </div>

        <button type="submit" class="btn btn-primary btn-block">
          Générer mon programme & mes macros
        </button>
      </form>
    </section>
  `;

  document.getElementById('btn-load-demo')?.addEventListener('click', seedDemoProfile);

  document.getElementById('onboarding-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const equipment = Array.from(document.querySelectorAll('input[name="ob-eq"]:checked')).map((el) => el.value);
    const injZone = document.getElementById('ob-injury-zone').value;
    const injSev = Number(document.getElementById('ob-injury-sev').value) || 1;

    const created = await createProfile({
      name: document.getElementById('ob-name').value.trim() || 'Athlète',
      sex: document.getElementById('ob-sex').value,
      age: Number(document.getElementById('ob-age').value),
      heightCm: Number(document.getElementById('ob-height').value),
      weightKg: Number(document.getElementById('ob-weight').value),
      goal: document.getElementById('ob-goal').value,
      level: document.getElementById('ob-level').value,
      sessionsPerWeek: Number(document.getElementById('ob-freq').value),
      sessionDurationMin: Number(document.getElementById('ob-dur').value),
      splitPreference: document.getElementById('ob-split')?.value || 'auto',
      progressionMethod: document.getElementById('ob-method')?.value || 'double_progression',
      equipment: equipment.length > 0 ? equipment : ['bodyweight'],
      injuries: injZone ? [{ zone: injZone, severity: injSev }] : [],
    });

    await saveBiometric(created.id, {
      date: getTodayISO(),
      source: 'manual',
      weightKg: created.weightKg,
    });

    const prog = generateProgram(created, { phase: 'calibration' });
    await saveProgram(created.id, prog);
    await loadProfileWorkspace();
    state.route = 'cockpit';
    renderApp();
    showToast(`Programme ${prog.splitLabel} généré pour ${created.name}.`);
  });
}

/* ==========================================================================
   ÉCRAN 1 — [COCKPIT]
   ========================================================================== */

function renderCockpit(container) {
  const { ewma, latestBio, adaptive, macros, consumed, recent7d, deloadStatus } = getDerivedTelemetry();
  const todaySteps = latestBio?.date === getTodayISO() ? latestBio.steps || 0 : 0;
  const stepTarget = state.profile.lifestyle?.stepTarget || 8500;
  const lagList = (state.profile.lagPriorities || []).map((g) => MUSCLE_GROUPS[g]?.label || g);

  const pct = (val, target) => Math.min(100, Math.round((val / Math.max(1, target)) * 100));

  const nextDayName = state.program?.days?.[state.selectedDayIdx]?.name || 'Séance du jour';

  container.innerHTML = `
    <section class="stack">
      <div class="hero-card">
        <div class="row-between">
          <div class="stack-sm" style="gap: 3px;">
            <span class="state-tag is-accent">COCKPIT · PHASE ${esc((state.program?.phase || 'calibration').toUpperCase())}</span>
            <h1>${esc(state.profile.name)}</h1>
            <div class="meta-inline">
              <span>${esc(GOAL_PROFILES[state.profile.goal]?.label || state.profile.goal)}</span>
              <span class="meta-sep">·</span>
              <span>${esc(state.program?.splitLabel || '')}</span>
            </div>
          </div>
          <span class="mono metric-sm text-secondary">${esc(getTodayISO())}</span>
        </div>
        <button type="button" class="btn btn-primary btn-block" data-goto="seance">
          Démarrer · ${esc(nextDayName)}
        </button>
      </div>

      <!-- Strip 4 KPI Télémétrie -->
      <div class="kpi-strip">
        <div class="kpi-cell">
          <span class="kpi-label">Poids EWMA</span>
          <span class="kpi-value">${ewma.latestEwmaKg ?? state.profile.weightKg} kg</span>
          <span class="kpi-delta">Brut ${ewma.latestRawKg ?? state.profile.weightKg} · ${ewma.weeklyDeltaKg >= 0 ? '+' : ''}${ewma.weeklyDeltaKg}/sem</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">TDEE ${adaptive.adaptiveActive ? 'adaptatif' : 'estimé'}</span>
          <span class="kpi-value">${adaptive.estimatedTdeeKcal}</span>
          <span class="kpi-delta">Cible ${macros.kcal} kcal/j</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">Régularité 7 j</span>
          <span class="kpi-value">${recent7d}/${state.profile.sessionsPerWeek}</span>
          <span class="kpi-delta">${state.workouts.length} séances totales</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">Masse maigre</span>
          <span class="kpi-value">${macros.leanMassKg} kg</span>
          <span class="kpi-delta">BMR ${macros.bmrKcal} kcal</span>
        </div>
      </div>

      ${
        lagList.length > 0
          ? `
        <div class="notice notice-danger">
          <div class="stack-sm" style="gap: 3px;">
            <span class="state-tag is-lag">[LAG — PRIORITÉS MÉSOCYCLE]</span>
            <span>Surcharge active : <strong>${esc(lagList.join(' · '))}</strong></span>
          </div>
          <button type="button" class="btn btn-sm" data-goto="labo">Labo</button>
        </div>`
          : ''
      }

      ${
        deloadStatus.deloadRecommended
          ? `
        <div class="notice notice-danger">
          <div class="stack-sm" style="gap: 3px;">
            <span class="state-tag is-danger">[ALERTE DELOAD AUTO]</span>
            <span>${esc(deloadStatus.reason)}</span>
          </div>
          <button type="button" class="btn btn-sm btn-danger" id="btn-activate-deload">Activer Deload</button>
        </div>`
          : ''
      }

      <!-- 4 Jauges quotidiennes + Brief -->
      <div class="grid-2">
        <section class="panel">
          <div class="panel-header">
            <h2>Objectifs du jour</h2>
            <span class="mono metric-sm text-accent">${Math.max(0, macros.kcal - consumed.kcal)} kcal rest.</span>
          </div>

          <div class="gauge-block">
            <div class="gauge-head">
              <span class="label-tech">Calories</span>
              <span class="mono metric-sm">${consumed.kcal} / ${macros.kcal} kcal</span>
            </div>
            <div class="gauge-track"><div class="gauge-fill ${consumed.kcal > macros.kcal * 1.12 ? 'is-danger' : ''}" style="transform: scaleX(${pct(consumed.kcal, macros.kcal) / 100})"></div></div>
          </div>

          <div class="gauge-block">
            <div class="gauge-head">
              <span class="label-tech">Protéines</span>
              <span class="mono metric-sm">${consumed.proteinG} / ${macros.proteinG} g</span>
            </div>
            <div class="gauge-track"><div class="gauge-fill ${consumed.proteinG >= macros.proteinG * 0.9 ? 'is-ok' : ''}" style="transform: scaleX(${pct(consumed.proteinG, macros.proteinG) / 100})"></div></div>
          </div>

          <div class="gauge-block">
            <div class="gauge-head">
              <span class="label-tech">Hydratation</span>
              <span class="mono metric-sm">${state.hydration.totalMl || 0} / ${macros.waterTargetMl} ml</span>
            </div>
            <div class="gauge-track"><div class="gauge-fill" style="transform: scaleX(${pct(state.hydration.totalMl || 0, macros.waterTargetMl) / 100})"></div></div>
            <div class="grid-4" style="grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 4px;">
              <button type="button" class="btn btn-sm mono" data-add-water="250">+250 ml</button>
              <button type="button" class="btn btn-sm mono" data-add-water="500">+500 ml</button>
            </div>
          </div>

          <div class="gauge-block">
            <div class="gauge-head">
              <span class="label-tech">Pas (NEAT)</span>
              <span class="mono metric-sm">${todaySteps} / ${stepTarget}</span>
            </div>
            <div class="gauge-track"><div class="gauge-fill" style="transform: scaleX(${pct(todaySteps, stepTarget) / 100})"></div></div>
            <div class="input-action-row" style="margin-top: 4px;">
              <input id="quick-steps-input" class="input mono" type="number" min="0" max="60000" step="500" placeholder="Pas du jour" value="${todaySteps || ''}" />
              <button type="button" class="btn btn-sm" id="btn-save-steps">Valider</button>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <h2>Brief & Raccourcis</h2>
            <span class="state-tag is-muted">IA NIV. ${state.aiSettings.activeTier}</span>
          </div>

          <p class="text-secondary" style="font-size: 0.86rem; line-height: 1.5;">
            ${esc(
              adaptive.adjustmentProposal
                ? adaptive.adjustmentProposal.reason
                : `Tendance EWMA : ${ewma.weeklyDeltaKg >= 0 ? '+' : ''}${ewma.weeklyDeltaKg} kg/sem. Reste aujourd’hui : ${Math.max(0, macros.kcal - consumed.kcal)} kcal et ${Math.max(0, Math.round(macros.proteinG - consumed.proteinG))} g de protéines.`
            )}
          </p>

          <hr class="divider" />

          <div class="stack-sm">
            <button type="button" class="btn btn-block" data-goto="nutrition">
              Ajouter un repas (Ciqual / Photo / Scan)
            </button>
            <button type="button" class="btn btn-block" data-goto="labo">
              Pesée OCR & Labo Photos 3 angles
            </button>
            <button type="button" class="btn btn-block" data-goto="profil">
              Coach IA & Réglages Clés API
            </button>
          </div>
        </section>
      </div>
    </section>
  `;

  container.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.goto));
  });

  container.querySelectorAll('[data-add-water]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ml = Number(btn.dataset.addWater);
      state.hydration = await addHydration(state.profile.id, ml, getTodayISO());
      renderApp();
      showToast(`+${ml} ml enregistrés (${state.hydration.totalMl} ml).`, {
        undoAction: async () => {
          state.hydration = await addHydration(state.profile.id, -ml, getTodayISO());
          renderApp();
        },
      });
    });
  });

  document.getElementById('btn-save-steps')?.addEventListener('click', async () => {
    const val = Number(document.getElementById('quick-steps-input').value);
    if (!Number.isFinite(val) || val < 0) return;
    await saveBiometric(state.profile.id, {
      date: getTodayISO(),
      source: 'manual',
      weightKg: latestBio?.weightKg || state.profile.weightKg,
      steps: Math.round(val),
    });
    state.biometrics = await listBiometrics(state.profile.id);
    renderApp();
    showToast(`${Math.round(val)} pas enregistrés.`);
  });

  document.getElementById('btn-activate-deload')?.addEventListener('click', async () => {
    const deloadProg = generateProgram(state.profile, {
      phase: 'deload',
      mesocycleNumber: state.program?.mesocycleNumber || 1,
    });
    state.program = await saveProgram(state.profile.id, deloadProg);
    state.activeSession = null;
    renderApp();
    showToast('Semaine de Deload activée (-45 % volume, RIR 3).');
  });
}

/* ==========================================================================
   ÉCRAN 2 — [SÉANCE] (READINESS, ANATOMIE WGER, SWAP, DUPLIQUER, MICRO, WAKE LOCK)
   ========================================================================== */

function ensureActiveSessionForSelectedDay() {
  const day = state.program?.days?.[state.selectedDayIdx] || state.program?.days?.[0];
  if (!day) return null;

  if (state.activeSession && state.activeSession.dayId === day.id) {
    return state.activeSession;
  }

  const seenCompoundChain = new Set();
  const activeMethod = state.program?.progressionMethod || state.profile?.progressionMethod || 'double_progression';
  const exercises = day.exercises.map((slot) => {
    const meta = getExerciseById(slot.exerciseId);
    const primaryChain = MUSCLE_GROUPS[meta?.primaryMuscles?.[0]]?.chain || 'other';
    const isFirstCompound = meta?.category === 'compound' && !seenCompoundChain.has(primaryChain);
    if (isFirstCompound) seenCompoundChain.add(primaryChain);

    const scheme =
      Array.isArray(slot.setScheme) && slot.setScheme.length > 0
        ? slot.setScheme
        : buildSetScheme(meta, {
            sets: slot.sets,
            repMin: slot.repMin,
            repMax: slot.repMax,
            targetRir: slot.targetRir,
            suggestedLoadKg: slot.suggestedLoadKg,
            method: slot.method || activeMethod,
            restSec: slot.restSec,
            dayIndex: state.selectedDayIdx,
          });

    const firstWorkWeight = scheme[0]?.weightKg ?? slot.suggestedLoadKg;
    const warmupSets = generateWarmupRamp(firstWorkWeight, meta, isFirstCompound).map((w) => ({
      id: generateId('set'),
      weightKg: w.weightKg,
      reps: w.reps,
      rir: 4,
      isWarmup: true,
      warmupLabel: w.label,
      tag: 'ÉCH',
      done: false,
    }));

    const workSets = scheme.map((s) => ({
      id: generateId('set'),
      weightKg: s.weightKg,
      reps: s.reps,
      rir: s.rir,
      restSec: s.restSec || slot.restSec,
      tag: s.tag || null,
      isWarmup: false,
      done: false,
    }));

    return {
      ...slot,
      method: slot.method || activeMethod,
      setScheme: scheme,
      feedback: null,
      progressionHint: null,
      setsData: [...warmupSets, ...workSets],
    };
  });

  state.activeSession = {
    dayId: day.id,
    dayName: day.name,
    startedAt: Date.now(),
    preservationMode: false,
    readiness: evaluateReadiness(state.readinessDraft),
    exercises,
  };
  return state.activeSession;
}

function renderExerciseDrawerHTML(slot, exMeta, drawerType) {
  if (!drawerType || !exMeta) return '';

  if (drawerType === 'anatomy') {
    const layers = getWgerAnatomyLayers(exMeta);
    const renderView = (baseUrl, primaries, secondaries, caption) => `
      <div class="stack-sm" style="align-items: center;">
        <div class="anatomy-figure">
          <img src="${esc(baseUrl)}" alt="${esc(caption)}" loading="lazy" style="filter: invert(0.92) brightness(1.15) opacity(0.38);" />
          ${secondaries
            .map(
              (s) =>
                `<img src="${esc(s.url)}" alt="${esc(s.name)}" loading="lazy" style="filter: sepia(1) saturate(4) hue-rotate(8deg) opacity(0.55);" onerror="this.style.display='none'" />`
            )
            .join('')}
          ${primaries
            .map(
              (p) =>
                `<img src="${esc(p.url)}" alt="${esc(p.name)}" loading="lazy" style="filter: sepia(1) saturate(9) hue-rotate(2deg) brightness(1.08);" onerror="this.style.display='none'" />`
            )
            .join('')}
        </div>
        <span class="metric-xs text-secondary">${esc(caption)}</span>
      </div>`;

    return `
      <div class="stack-sm">
        <div class="anatomy-stage">
          ${renderView(layers.frontBase, layers.frontPrimary, layers.frontSecondary, 'Vue antérieure')}
          ${renderView(layers.backBase, layers.backPrimary, layers.backSecondary, 'Vue postérieure')}
        </div>
        <div class="meta-inline">
          <span class="text-accent">Primaires : ${esc(exMeta.primaryMuscles.map((m) => MUSCLE_GROUPS[m]?.label || m).join(', '))}</span>
          ${
            exMeta.secondaryMuscles.length
              ? `<span class="meta-sep">·</span><span>Secondaires : ${esc(exMeta.secondaryMuscles.map((m) => MUSCLE_GROUPS[m]?.label || m).join(', '))}</span>`
              : ''
          }
        </div>
      </div>`;
  }

  if (drawerType === 'execution') {
    const userInjuryZones = (state.profile?.injuries || []).map((i) => i.zone);
    const matchingWarnings = userInjuryZones
      .map((z) => (exMeta.injuryWarnings?.[z] ? `${z.toUpperCase()} : ${exMeta.injuryWarnings[z]}` : null))
      .filter(Boolean);

    return `
      <div class="panel-elevated stack-sm">
        <div class="meta-inline mono">
          <span class="text-accent">Tempo ${esc(exMeta.tempo)}</span>
          <span class="meta-sep">·</span>
          <span>Courbe ${esc(exMeta.resistanceCurve)}</span>
          <span class="meta-sep">·</span>
          <span>Palier ±${exMeta.incrementKg} kg</span>
        </div>
        <p class="panel-subtitle"><strong>Placement :</strong> ${esc(exMeta.setupCues)}</p>
        <p class="panel-subtitle"><strong>Respiration :</strong> ${esc(exMeta.breathing)}</p>
        ${
          matchingWarnings.length > 0
            ? `<div class="notice notice-danger"><span><strong>Alerte profil :</strong> ${esc(matchingWarnings.join(' · '))}</span></div>`
            : ''
        }
      </div>`;
  }

  if (drawerType === 'plates') {
    const firstWork = slot.setsData.find((s) => !s.isWarmup) || slot.setsData[0];
    const calc = calculatePerSideLoad(firstWork?.weightKg ?? slot.suggestedLoadKg, exMeta);
    return `
      <div class="panel-elevated stack-sm">
        <span class="label-tech">Charge & disques par côté</span>
        <span class="mono metric-sm text-accent">${esc(calc.label)}</span>
        <span class="panel-subtitle">Palier matériel recommandé : ±${exMeta.incrementKg} kg</span>
      </div>`;
  }

  return '';
}

function renderSeance(container) {
  const days = state.program?.days || [];
  if (days.length === 0) {
    container.innerHTML = `<section class="panel"><p>Aucun programme actif. Configurez votre profil.</p></section>`;
    return;
  }

  const session = ensureActiveSessionForSelectedDay();
  const readiness = evaluateReadiness(state.readinessDraft);
  session.readiness = { ...readiness, preservationMode: session.preservationMode };

  container.innerHTML = `
    <section class="stack">
      <!-- En-tête séance compact -->
      <div class="row-between">
        <div class="stack-sm" style="gap: 2px;">
          <h1>${esc(session.dayName)}</h1>
          <div class="meta-inline">
            <span>${esc(state.program.splitLabel)}</span>
            <span class="meta-sep">·</span>
            <span class="text-accent">${esc(state.program.methodLabel || TRAINING_METHODS[state.profile?.progressionMethod || 'double_progression']?.shortLabel || 'Double prog.')}</span>
            <span class="meta-sep">·</span>
            <span class="mono">S${state.program.weekNumber || 1} · ${esc(state.program.phase)}</span>
          </div>
        </div>
        <button type="button" class="btn btn-sm" id="btn-toggle-wakelock">Écran actif</button>
      </div>

      <!-- Sélecteur jours split -->
      <div class="segmented" role="tablist">
        ${days
          .map(
            (d, idx) => `
          <button type="button" class="segmented-btn ${idx === state.selectedDayIdx ? 'is-active' : ''}" data-select-day="${idx}">
            J${idx + 1}
          </button>`
          )
          .join('')}
      </div>

      <!-- Check-in Readiness compact (dépliable pour afficher les exercices immédiatement) -->
      <section class="panel" style="gap: 10px;">
        <div class="row-between">
          <div class="stack-sm" style="gap: 2px;">
            <span class="label-tech">Readiness du jour</span>
            <span class="panel-subtitle">${esc(readiness.summary)}</span>
          </div>
          <div class="row" style="gap: 8px; flex-shrink: 0;">
            <span class="metric-lg ${readiness.recommendPreservation ? 'text-danger' : 'text-accent'}">${readiness.score}/100</span>
            <button type="button" class="btn btn-xs" id="btn-toggle-readiness">
              ${state.readinessExpanded ? 'Masquer' : 'Ajuster'}
            </button>
          </div>
        </div>

        ${
          state.readinessExpanded
            ? `
          <div class="grid-3">
            <div class="field">
              <label class="field-label" for="rd-sleep"><span>Sommeil</span><span class="mono">${state.readinessDraft.sleep}/5</span></label>
              <input id="rd-sleep" class="range-tech" type="range" min="1" max="5" value="${state.readinessDraft.sleep}" />
            </div>
            <div class="field">
              <label class="field-label" for="rd-soreness"><span>Confort articulaire</span><span class="mono">${state.readinessDraft.soreness}/5</span></label>
              <input id="rd-soreness" class="range-tech" type="range" min="1" max="5" value="${state.readinessDraft.soreness}" />
            </div>
            <div class="field">
              <label class="field-label" for="rd-energy"><span>Énergie</span><span class="mono">${state.readinessDraft.energy}/5</span></label>
              <input id="rd-energy" class="range-tech" type="range" min="1" max="5" value="${state.readinessDraft.energy}" />
            </div>
          </div>`
            : ''
        }

        ${
          readiness.recommendPreservation && !session.preservationMode
            ? `
          <div class="notice notice-danger">
            <span>Readiness bas : activez le Mode Préservation (-1 série, +1 RIR).</span>
            <button type="button" class="btn btn-sm btn-danger" id="btn-apply-preservation">Activer</button>
          </div>`
            : session.preservationMode
              ? `<div class="notice notice-accent"><span>Mode Préservation actif (-1 série, +1 RIR de sécurité).</span></div>`
              : ''
        }
      </section>

      <!-- Échauffement correctif ciblé -->
      <details class="panel">
        <summary style="cursor: pointer; font-weight: 600; font-size: 0.88rem;">
          Échauffement correctif (${(state.program.warmupDrills || []).length} ateliers · 5 min)
        </summary>
        <div class="stack-sm" style="margin-top: 8px;">
          ${(state.program.warmupDrills || [])
            .map(
              (w) => `
            <div class="row-between" style="padding: 6px 0; border-bottom: 1px solid var(--border-hairline);">
              <span style="font-size: 0.84rem;">${esc(w.name)}</span>
              <span class="mono metric-xs text-secondary" style="flex-shrink: 0;">${w.sets}×${esc(w.reps)}</span>
            </div>`
            )
            .join('')}
        </div>
      </details>

      <!-- Cartes Exercices avec photos d'exécution visibles directement -->
      <div class="stack" id="workout-exercises-list">
        ${session.exercises
          .map((slot, exIdx) => {
            const exMeta = getExerciseById(slot.exerciseId);
            const media = getExerciseMediaUrls(exMeta);
            const openDrawer = state.openDrawers[slot.slotId] || null;
            const plateSummary = exMeta
              ? calculatePerSideLoad(slot.setsData.find((s) => !s.isWarmup)?.weightKg ?? slot.suggestedLoadKg, exMeta).label
              : '';

            return `
            <article class="panel" data-ex-idx="${exIdx}">
              <div class="stack-sm" style="gap: 4px;">
                <div class="row-between">
                  <h3>${exIdx + 1}. ${esc(slot.name)}</h3>
                  ${slot.isLagPriority ? `<span class="state-tag is-lag">[LAG]</span>` : ''}
                  ${!slot.isLagPriority && slot.unilateral ? `<span class="state-tag is-accent">[UNILAT.]</span>` : ''}
                </div>
                <div class="meta-inline mono">
                  <span class="text-accent">${slot.sets}×${slot.repMin}-${slot.repMax}</span>
                  <span class="meta-sep">·</span>
                  <span>RIR ${slot.targetRir}</span>
                  <span class="meta-sep">·</span>
                  <span>Repos ${slot.restSec}s</span>
                  <span class="meta-sep">·</span>
                  <span>${esc(plateSummary)}</span>
                </div>
                ${slot.unilateralNote ? `<span class="panel-subtitle text-accent">${esc(slot.unilateralNote)}</span>` : ''}
              </div>

              <!-- Aperçu photo réel départ / contraction (toujours visible) -->
              ${
                media.start && media.end
                  ? `
                <div class="exercise-media-strip">
                  <div class="exercise-thumb" data-drawer="${esc(slot.slotId)}" data-drawer-type="execution" title="Voir consignes d'exécution">
                    <img src="${esc(media.start)}" alt="${esc(slot.name)} — départ" loading="lazy" />
                    <span class="exercise-thumb-tag">1 · DÉPART</span>
                  </div>
                  <div class="exercise-thumb" data-drawer="${esc(slot.slotId)}" data-drawer-type="anatomy" title="Voir carte anatomique">
                    <img src="${esc(media.end)}" alt="${esc(slot.name)} — contraction" loading="lazy" />
                    <span class="exercise-thumb-tag">2 · CONTRACTION</span>
                  </div>
                </div>`
                  : ''
              }

              <!-- Barre d'outils 4 colonnes sans débordement -->
              <div class="exercise-tools-grid">
                <button type="button" class="btn btn-sm ${openDrawer === 'anatomy' ? 'btn-primary' : ''}" data-drawer="${esc(slot.slotId)}" data-drawer-type="anatomy">Anatomie</button>
                <button type="button" class="btn btn-sm ${openDrawer === 'execution' ? 'btn-primary' : ''}" data-drawer="${esc(slot.slotId)}" data-drawer-type="execution">Consignes</button>
                <button type="button" class="btn btn-sm" data-swap-ex="${exIdx}">Swap</button>
                <button type="button" class="btn btn-sm mono" data-start-rest="${slot.restSec}" data-rest-label="${esc(slot.name)}">${slot.restSec}s</button>
              </div>

              ${renderExerciseDrawerHTML(slot, exMeta, openDrawer)}

              <!-- Tableau des séries (optimisé 360px -> desktop) -->
              <div class="stack-sm" style="gap: 2px;">
                <div class="set-row" style="padding: 2px 0 4px; border-bottom: 1px solid var(--border-strong);">
                  <span class="label-tech" style="text-align:center;">#</span>
                  <span class="label-tech" style="text-align:center;">Kg</span>
                  <span class="label-tech" style="text-align:center;">Réps</span>
                  <span class="label-tech" style="text-align:center;">RIR</span>
                  <span class="label-tech" style="text-align:center;">OK</span>
                </div>
                ${slot.setsData
                  .map((s, sIdx) => {
                    const workNum = sIdx + 1 - slot.setsData.filter((x) => x.isWarmup).length;
                    return `
                  <div class="set-row ${s.done ? 'is-done' : ''} ${s.isWarmup ? 'is-warmup' : ''}">
                    <button type="button" class="set-num-cell" title="Supprimer cette série" data-del-set="${exIdx}:${sIdx}">
                      <span>${s.isWarmup ? 'É' : workNum}</span>
                      ${s.tag && !s.isWarmup ? `<span class="set-tag">${esc(s.tag)}</span>` : ''}
                    </button>
                    <input class="set-input" type="number" inputmode="decimal" step="${exMeta?.incrementKg || 2.5}" min="0" value="${s.weightKg}" data-set-field="${exIdx}:${sIdx}:weightKg" aria-label="Charge kg" />
                    <input class="set-input" type="number" inputmode="numeric" step="1" min="0" value="${s.reps}" data-set-field="${exIdx}:${sIdx}:reps" aria-label="Répétitions" />
                    <input class="set-input" type="number" inputmode="numeric" step="1" min="0" max="5" value="${s.rir}" data-set-field="${exIdx}:${sIdx}:rir" aria-label="RIR" />
                    <button type="button" class="set-check-btn ${s.done ? 'is-checked' : ''}" data-toggle-set="${exIdx}:${sIdx}" aria-label="Valider série">
                      ${s.done ? '✓' : '○'}
                    </button>
                  </div>`;
                  })
                  .join('')}
              </div>

              <!-- Actions rapides série + Micro + Disques -->
              <div class="grid-4" style="grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr); gap: 6px;">
                <button type="button" class="btn btn-sm" data-dup-set="${exIdx}">+ Série</button>
                <button type="button" class="btn btn-sm ${openDrawer === 'plates' ? 'btn-primary' : ''}" data-drawer="${esc(slot.slotId)}" data-drawer-type="plates">Disques</button>
                <button type="button" class="btn btn-sm" data-voice-ex="${exIdx}">Micro</button>
              </div>

              <!-- Ressenti biomécanique 4 colonnes égales -->
              <div class="feedback-grid">
                ${[
                  ['easy', 'Facile'],
                  ['solid', 'Solide'],
                  ['limit', 'Limite'],
                  ['joint_pain', 'Douleur'],
                ]
                  .map(
                    ([fb, lbl]) => `
                  <button type="button" class="btn btn-sm ${slot.feedback === fb ? (fb === 'joint_pain' ? 'btn-danger' : 'btn-primary') : ''}" data-feedback="${exIdx}:${fb}">
                    ${lbl}
                  </button>`
                  )
                  .join('')}
              </div>

              ${
                slot.progressionHint
                  ? `<div class="notice ${slot.feedback === 'joint_pain' ? 'notice-danger' : 'notice-accent'}">
                      <span>${esc(slot.progressionHint.message)}</span>
                      ${
                        slot.progressionHint.suggestedSwap
                          ? `<button type="button" class="btn btn-sm" data-swap-ex="${exIdx}">Remplacer</button>`
                          : ''
                      }
                    </div>`
                  : ''
              }
            </article>`;
          })
          .join('')}
      </div>

      <!-- Module Cardio adapté -->
      <section class="panel">
        <div class="row-between">
          <div class="stack-sm" style="gap: 2px;">
            <h2>Cardio calibré</h2>
            <p class="panel-subtitle">${esc(state.program.cardio?.reason || '')}</p>
          </div>
          <span class="mono metric-sm text-accent" style="flex-shrink: 0;">${state.program.cardio?.sessionsPerWeek || 2}×${state.program.cardio?.durationMin || 20}m</span>
        </div>
        <p class="text-secondary" style="font-size: 0.84rem;">${esc(state.program.cardio?.modality || '')}</p>
      </section>

      <button type="button" class="btn btn-primary btn-block" id="btn-finish-workout">
        Terminer & enregistrer la séance
      </button>
    </section>
  `;

  // Handlers Séance
  container.querySelectorAll('[data-select-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedDayIdx = Number(btn.dataset.selectDay);
      state.activeSession = null;
      renderApp();
    });
  });

  document.getElementById('btn-toggle-readiness')?.addEventListener('click', () => {
    state.readinessExpanded = !state.readinessExpanded;
    renderApp();
  });

  document.getElementById('btn-toggle-wakelock')?.addEventListener('click', async () => {
    const ok = await wakeLock.acquire();
    showToast(ok ? 'Écran maintenu actif pour la séance.' : 'Chrono horodaté actif même écran verrouillé.');
  });

  ['sleep', 'soreness', 'energy'].forEach((k) => {
    document.getElementById(`rd-${k}`)?.addEventListener('input', (e) => {
      state.readinessDraft[k] = Number(e.target.value);
      renderApp();
    });
  });

  document.getElementById('btn-apply-preservation')?.addEventListener('click', () => {
    const day = state.program.days[state.selectedDayIdx];
    const preserved = applyPreservationMode(day);
    state.activeSession = {
      ...state.activeSession,
      preservationMode: true,
      exercises: preserved.exercises.map((slot) => ({
        ...slot,
        feedback: null,
        progressionHint: null,
        setsData: Array.from({ length: slot.sets }, () => ({
          id: generateId('set'),
          weightKg: slot.suggestedLoadKg,
          reps: slot.repMin,
          rir: slot.targetRir,
          isWarmup: false,
          done: false,
        })),
      })),
    };
    renderApp();
    showToast('Mode Préservation appliqué (-1 série, +1 RIR).');
  });

  container.querySelectorAll('[data-drawer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slotId = btn.dataset.drawer;
      const type = btn.dataset.drawerType;
      state.openDrawers[slotId] = state.openDrawers[slotId] === type ? null : type;
      renderApp();
    });
  });

  container.querySelectorAll('[data-start-rest]').forEach((btn) => {
    btn.addEventListener('click', () => {
      wakeLock.acquire();
      restTimer.start(Number(btn.dataset.startRest), btn.dataset.restLabel || '');
    });
  });

  container.querySelectorAll('[data-set-field]').forEach((inp) => {
    inp.addEventListener('change', (e) => {
      const [exIdx, sIdx, field] = inp.dataset.setField.split(':');
      const setObj = session.exercises[Number(exIdx)]?.setsData?.[Number(sIdx)];
      if (setObj) setObj[field] = Number(e.target.value) || 0;
    });
  });

  container.querySelectorAll('[data-toggle-set]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [exIdx, sIdx] = btn.dataset.toggleSet.split(':').map(Number);
      const ex = session.exercises[exIdx];
      const setObj = ex?.setsData?.[sIdx];
      if (!setObj) return;
      const prevDone = setObj.done;
      setObj.done = !prevDone;

      if (setObj.done && !setObj.isWarmup) {
        wakeLock.acquire();
        restTimer.start(setObj.restSec || ex.restSec || 90, ex.name);
      }

      renderApp();
      showToast(
        setObj.done
          ? `Série validée (${setObj.weightKg} kg × ${setObj.reps}).`
          : 'Série décochée.',
        {
          undoAction: () => {
            setObj.done = prevDone;
            renderApp();
          },
        }
      );
    });
  });

  // 1-tap Dupliquer série précédente
  container.querySelectorAll('[data-dup-set]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const exIdx = Number(btn.dataset.dupSet);
      const ex = session.exercises[exIdx];
      const prev = ex.setsData[ex.setsData.length - 1] || {
        weightKg: ex.suggestedLoadKg,
        reps: ex.repMin,
        rir: ex.targetRir,
      };
      const clone = {
        id: generateId('set'),
        weightKg: prev.weightKg,
        reps: prev.reps,
        rir: prev.rir,
        isWarmup: false,
        done: false,
      };
      ex.setsData.push(clone);
      renderApp();
      showToast(`Série dupliquée (${clone.weightKg} kg × ${clone.reps}).`, {
        undoAction: () => {
          ex.setsData = ex.setsData.filter((s) => s.id !== clone.id);
          renderApp();
        },
      });
    });
  });

  // Supprimer série avec Toast Annuler 5s
  container.querySelectorAll('[data-del-set]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [exIdx, sIdx] = btn.dataset.delSet.split(':').map(Number);
      const ex = session.exercises[exIdx];
      if (!ex || ex.setsData.length <= 1) return;
      const [removed] = ex.setsData.splice(sIdx, 1);
      renderApp();
      showToast('Série supprimée.', {
        undoAction: () => {
          ex.setsData.splice(sIdx, 0, removed);
          renderApp();
        },
      });
    });
  });

  // Feedback fin d'exercice & progression adaptée à la méthode active
  container.querySelectorAll('[data-feedback]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [exIdxStr, fb] = btn.dataset.feedback.split(':');
      const ex = session.exercises[Number(exIdxStr)];
      if (!ex) return;
      ex.feedback = fb;
      ex.progressionHint = evaluateExerciseProgression({
        exerciseId: ex.exerciseId,
        performedSets: ex.setsData,
        repMin: ex.repMin,
        repMax: ex.repMax,
        feedback: fb,
        method: ex.method || state.program?.progressionMethod || state.profile?.progressionMethod || 'double_progression',
        profile: state.profile,
      });
      renderApp();
    });
  });

  // Swap Biomécanique modal
  container.querySelectorAll('[data-swap-ex]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const exIdx = Number(btn.dataset.swapEx);
      const slot = session.exercises[exIdx];
      const currentLoad = slot.setsData.find((s) => !s.isWarmup)?.weightKg ?? slot.suggestedLoadKg;
      const swaps = findBiomechanicalSwaps(slot.exerciseId, state.profile, currentLoad);

      const listHtml =
        swaps.length > 0
          ? swaps
              .map((sw, i) => {
                const m = getExerciseMediaUrls(sw.exercise);
                return `
              <div class="swap-card">
                <img class="swap-thumb" src="${esc(m.start || '')}" alt="${esc(sw.exercise.name)}" loading="lazy" />
                <div class="stack-sm" style="gap: 2px;">
                  <strong style="font-size: 0.86rem;">${esc(sw.exercise.name)}</strong>
                  <span class="meta-inline mono">${sw.convertedLoadKg} kg · ${esc(sw.reason)}</span>
                </div>
                <button type="button" class="btn btn-sm btn-primary" data-pick-swap="${i}">Choisir</button>
              </div>`;
              })
              .join('')
          : `<p class="text-secondary">Aucun équivalent mécanique compatible avec votre matériel actuel.</p>`;

      openModal(`Swap biomécanique · ${slot.name}`, listHtml, ({ close, body }) => {
        body.querySelectorAll('[data-pick-swap]').forEach((pickBtn) => {
          pickBtn.addEventListener('click', () => {
            const chosen = swaps[Number(pickBtn.dataset.pickSwap)];
            const prevSnapshot = structuredClone(slot);
            slot.exerciseId = chosen.exercise.id;
            slot.name = chosen.exercise.name;
            slot.unilateral = Boolean(chosen.exercise.unilateral);
            slot.suggestedLoadKg = chosen.convertedLoadKg;
            slot.incrementKg = chosen.exercise.incrementKg;
            slot.setsData.forEach((s) => {
              if (!s.isWarmup) s.weightKg = chosen.convertedLoadKg;
            });
            close();
            renderApp();
            showToast(`Remplacé par ${chosen.exercise.name} (${chosen.convertedLoadKg} kg).`, {
              undoAction: () => {
                session.exercises[exIdx] = prevSnapshot;
                renderApp();
              },
            });
          });
        });
      });
    });
  });

  // Dictée vocale mains libres
  container.querySelectorAll('[data-voice-ex]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const exIdx = Number(btn.dataset.voiceEx);
      const ex = session.exercises[exIdx];
      showToast('Écoute vocale active… Dites par ex. "80 kilos 10 reps rir 2".');
      try {
        const res = await listenGymVoice({ aiSettings: state.aiSettings });
        const targetSet = ex.setsData.find((s) => !s.isWarmup && !s.done) || ex.setsData[ex.setsData.length - 1];
        if (targetSet) {
          if (res.weightKg !== null) targetSet.weightKg = res.weightKg;
          if (res.reps !== null) targetSet.reps = res.reps;
          if (res.rir !== null) targetSet.rir = res.rir;
          targetSet.done = true;
          restTimer.start(ex.restSec || 90, ex.name);
        }
        renderApp();
        showToast(`Dicté (${res.engine}) : "${res.transcript}" → ${targetSet.weightKg} kg × ${targetSet.reps}`);
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  // Enregistrer la séance terminée & mettre à jour les charges recommandées du split
  document.getElementById('btn-finish-workout')?.addEventListener('click', async () => {
    const saved = await saveWorkout(state.profile.id, {
      date: getTodayISO(),
      startedAt: session.startedAt,
      endedAt: Date.now(),
      dayId: session.dayId,
      dayName: session.dayName,
      readiness: session.readiness,
      exercises: session.exercises.map((ex) => ({
        exerciseId: ex.exerciseId,
        name: ex.name,
        feedback: ex.feedback,
        sets: ex.setsData,
      })),
    });

    // Met à jour automatiquement les charges & schémas de séries (RPT / Top Set / etc.) pour la séance suivante
    const progDay = state.program.days[state.selectedDayIdx];
    const learnedNotes = [];
    if (progDay) {
      session.exercises.forEach((ex, i) => {
        if (ex.feedback === 'joint_pain') {
          learnedNotes.push({
            id: generateId('mem'),
            category: 'session_pain',
            text: `Douleur signalée sur ${ex.name} (${saved.date})`,
            createdAt: Date.now(),
          });
        }
        if (ex.progressionHint?.nextLoadKg > 0 && progDay.exercises[i]) {
          const targetSlot = progDay.exercises[i];
          targetSlot.suggestedLoadKg = ex.progressionHint.nextLoadKg;
          const meta = getExerciseById(targetSlot.exerciseId);
          targetSlot.setScheme = buildSetScheme(meta, {
            sets: targetSlot.sets,
            repMin: targetSlot.repMin,
            repMax: targetSlot.repMax,
            targetRir: targetSlot.targetRir,
            suggestedLoadKg: targetSlot.suggestedLoadKg,
            method: targetSlot.method || state.program.progressionMethod || 'double_progression',
            restSec: targetSlot.restSec,
            dayIndex: state.selectedDayIdx,
          });
        }
      });
      state.program = await saveProgram(state.profile.id, state.program);
    }

    // Mémorise automatiquement les douleurs terrain pour que le Coach s'y adapte
    if (learnedNotes.length > 0) {
      const existingMem = Array.isArray(state.profile.coachMemory) ? state.profile.coachMemory : [];
      const merged = [...existingMem];
      for (const note of learnedNotes) {
        if (!merged.some((m) => m.text === note.text)) merged.push(note);
      }
      state.profile = await updateProfile(state.profile.id, { coachMemory: merged.slice(-12) });
    }

    restTimer.stop();
    await wakeLock.release();
    state.workouts = await listWorkouts(state.profile.id);
    state.activeSession = null;
    state.selectedDayIdx = (state.selectedDayIdx + 1) % state.program.days.length;
    renderApp();
    showToast(`Séance "${saved.dayName}" enregistrée. Charges suivantes recalibrées.`);
  });
}

/* ==========================================================================
   ÉCRAN 3 — [NUTRITION] (PHOTO VISION, CODE-BARRES, CIQUAL, FAVORIS, COURSES)
   ========================================================================== */

function renderNutrition(container) {
  const { adaptive, macros, consumed } = getDerivedTelemetry();
  const remKcal = Math.max(0, macros.kcal - consumed.kcal);
  const remP = Math.max(0, Math.round(macros.proteinG - consumed.proteinG));
  const remC = Math.max(0, Math.round(macros.carbsG - consumed.carbsG));
  const remF = Math.max(0, Math.round(macros.fatG - consumed.fatG));

  container.innerHTML = `
    <section class="stack">
      <div class="row-between">
        <div>
          <h1>Nutrition auto-adaptative</h1>
          <p class="panel-subtitle">Reste à consommer aujourd’hui · ${esc(macros.formula)} (${macros.tdeeKcal} kcal TDEE)</p>
        </div>
        <span class="mono metric-lg text-accent">${remKcal} kcal</span>
      </div>

      <div class="kpi-strip">
        <div class="kpi-cell">
          <span class="kpi-label">Calories</span>
          <span class="kpi-value">${consumed.kcal}</span>
          <span class="kpi-delta">Cible ${macros.kcal} · Reste ${remKcal}</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">Protéines</span>
          <span class="kpi-value">${consumed.proteinG} g</span>
          <span class="kpi-delta">Cible ${macros.proteinG} g · Reste ${remP} g</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">Glucides</span>
          <span class="kpi-value">${consumed.carbsG} g</span>
          <span class="kpi-delta">Cible ${macros.carbsG} g · Reste ${remC} g</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-label">Lipides (plancher)</span>
          <span class="kpi-value">${consumed.fatG} g</span>
          <span class="kpi-delta">Cible ${macros.fatG} g · Reste ${remF} g</span>
        </div>
      </div>

      ${
        adaptive.adjustmentProposal
          ? `
        <div class="notice notice-accent">
          <span><strong>TDEE Adaptatif :</strong> ${esc(adaptive.adjustmentProposal.reason)}</span>
          <button type="button" class="btn btn-sm btn-primary" id="btn-apply-tdee-adj">
            Appliquer (${adaptive.adjustmentProposal.deltaKcal > 0 ? '+' : ''}${adaptive.adjustmentProposal.deltaKcal} kcal)
          </button>
        </div>`
          : ''
      }

      <!-- 4 Modes d'ajout sans friction (2x2 mobile, zéro débordement) -->
      <div class="segmented-grid-2" role="tablist">
        <button type="button" class="segmented-btn ${state.nutritionSubTab === 'ciqual' ? 'is-active' : ''}" data-nut-tab="ciqual">Ciqual & Favoris</button>
        <button type="button" class="segmented-btn ${state.nutritionSubTab === 'photo' ? 'is-active' : ''}" data-nut-tab="photo">Photo Assiette</button>
        <button type="button" class="segmented-btn ${state.nutritionSubTab === 'barcode' ? 'is-active' : ''}" data-nut-tab="barcode">Code-Barres</button>
        <button type="button" class="segmented-btn ${state.nutritionSubTab === 'plan' ? 'is-active' : ''}" data-nut-tab="plan">Plan & Courses</button>
      </div>

      <div id="nutrition-subview"></div>

      <!-- Journal du jour -->
      <section class="panel">
        <div class="panel-header">
          <h2>Journal du jour (${state.nutritionToday.length} entrées)</h2>
          <span class="mono metric-sm text-secondary">${consumed.kcal} kcal</span>
        </div>
        ${
          state.nutritionToday.length === 0
            ? `<p class="panel-subtitle">Aucun repas enregistré aujourd’hui.</p>`
            : `<div class="stack-sm">
                ${state.nutritionToday
                  .map(
                    (log) => `
                  <div class="row-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-hairline);">
                    <div class="stack-sm" style="gap: 2px;">
                      <strong>${esc(log.label)}</strong>
                      <span class="meta-inline mono">
                        ${esc(log.mealSlot || 'Repas')} · ${log.kcal} kcal · P ${log.proteinG}g / G ${log.carbsG}g / L ${log.fatG}g
                      </span>
                    </div>
                    <button type="button" class="btn btn-sm btn-danger" data-del-nut="${esc(log.id)}">Suppr.</button>
                  </div>`
                  )
                  .join('')}
              </div>`
        }
      </section>
    </section>
  `;

  document.getElementById('btn-apply-tdee-adj')?.addEventListener('click', () => {
    state.manualKcalOffset += adaptive.adjustmentProposal.deltaKcal;
    renderApp();
    showToast(`Cible calorique ajustée de ${adaptive.adjustmentProposal.deltaKcal} kcal/j.`);
  });

  container.querySelectorAll('[data-nut-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (state.barcodeScanner) await state.barcodeScanner.stop();
      state.nutritionSubTab = btn.dataset.nutTab;
      renderApp();
    });
  });

  container.querySelectorAll('[data-del-nut]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delNut;
      const snapshot = state.nutritionToday.find((n) => n.id === id);
      await deleteNutritionLog(id);
      state.nutritionAll = await listNutritionLogs(state.profile.id);
      state.nutritionToday = state.nutritionAll.filter((n) => n.date === getTodayISO());
      renderApp();
      if (snapshot) {
        showToast('Repas retiré du journal.', {
          undoAction: async () => {
            await saveNutritionLog(state.profile.id, snapshot);
            state.nutritionAll = await listNutritionLogs(state.profile.id);
            state.nutritionToday = state.nutritionAll.filter((n) => n.date === getTodayISO());
            renderApp();
          },
        });
      }
    });
  });

  renderNutritionSubTab(document.getElementById('nutrition-subview'), macros);
}

function renderNutritionSubTab(slot, macros) {
  if (!slot) return;

  if (state.nutritionSubTab === 'ciqual') {
    const foods = searchCiqualOffline(state.ciqualQuery, state.profile).slice(0, 14);
    slot.innerHTML = `
      <div class="grid-2">
        <section class="panel">
          <div class="panel-header">
            <h2>Base Ciqual (ANSES) — 100 % Hors-ligne</h2>
          </div>
          <div class="input-action-row">
            <input id="ciqual-search" class="input" type="search" placeholder="Poulet, riz, skyr, avocat..." value="${esc(state.ciqualQuery)}" />
            <input id="ciqual-grams" class="input mono" type="number" inputmode="numeric" min="5" max="1500" step="10" value="150" style="width: 82px;" aria-label="Grammes" />
          </div>
          <div class="stack-sm">
            ${foods
              .map(
                (f) => `
              <div class="row-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-hairline);">
                <div class="stack-sm" style="gap: 2px;">
                  <span>${esc(f.name)}</span>
                  <span class="mono metric-sm text-secondary">${f.kcal} kcal/100g · P ${f.proteinG} · G ${f.carbsG} · L ${f.fatG}</span>
                </div>
                <button type="button" class="btn btn-sm btn-primary" data-add-ciqual="${esc(f.id)}">+ Ajouter</button>
              </div>`
              )
              .join('')}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <h2>Repas Favoris (1-tap)</h2>
            <button type="button" class="btn btn-sm" id="btn-new-fav">+ Créer</button>
          </div>
          ${
            state.favorites.length === 0
              ? `<p class="panel-subtitle">Aucun favori enregistré.</p>`
              : `<div class="stack-sm">
                  ${state.favorites
                    .map(
                      (fav) => `
                    <div class="row-between panel-elevated" style="padding: 10px 12px;">
                      <div class="stack-sm" style="gap: 2px;">
                        <strong>${esc(fav.name)}</strong>
                        <span class="mono metric-sm text-secondary">${fav.kcal} kcal · P ${fav.proteinG}g / G ${fav.carbsG}g / L ${fav.fatG}g</span>
                      </div>
                      <div class="row" style="gap: 6px;">
                        <button type="button" class="btn btn-sm btn-primary" data-log-fav="${esc(fav.id)}">+1 tap</button>
                        <button type="button" class="btn btn-sm btn-danger" data-del-fav="${esc(fav.id)}">×</button>
                      </div>
                    </div>`
                    )
                    .join('')}
                </div>`
          }
        </section>
      </div>
    `;

    document.getElementById('ciqual-search')?.addEventListener('input', (e) => {
      state.ciqualQuery = e.target.value;
      renderNutritionSubTab(slot, macros);
    });

    slot.querySelectorAll('[data-add-ciqual]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const food = foods.find((f) => f.id === btn.dataset.addCiqual);
        const grams = Number(document.getElementById('ciqual-grams')?.value) || 100;
        const scaled = scaleFoodMacros(food, grams);
        await saveNutritionLog(state.profile.id, {
          date: getTodayISO(),
          mealSlot: 'Ciqual',
          source: 'ciqual',
          label: `${food.name} (${scaled.grams} g)`,
          ...scaled,
        });
        state.nutritionAll = await listNutritionLogs(state.profile.id);
        state.nutritionToday = state.nutritionAll.filter((n) => n.date === getTodayISO());
        renderApp();
        showToast(`Ajouté : ${food.name} (${scaled.kcal} kcal).`);
      });
    });

    slot.querySelectorAll('[data-log-fav]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const fav = state.favorites.find((f) => f.id === btn.dataset.logFav);
        if (!fav) return;
        await saveNutritionLog(state.profile.id, {
          date: getTodayISO(),
          mealSlot: 'Favori',
          source: 'favorite',
          label: fav.name,
          kcal: fav.kcal,
          proteinG: fav.proteinG,
          carbsG: fav.carbsG,
          fatG: fav.fatG,
        });
        state.nutritionAll = await listNutritionLogs(state.profile.id);
        state.nutritionToday = state.nutritionAll.filter((n) => n.date === getTodayISO());
        renderApp();
        showToast(`Favori ajouté : ${fav.name}.`);
      });
    });

    slot.querySelectorAll('[data-del-fav]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await deleteFavorite(btn.dataset.delFav);
        state.favorites = await listFavorites(state.profile.id);
        renderApp();
      });
    });

    document.getElementById('btn-new-fav')?.addEventListener('click', () => {
      openModal(
        'Nouveau Repas Favori',
        `<form id="fav-form" class="stack">
          <div class="field"><label class="field-label">Nom du repas</label><input id="fav-name" class="input" required placeholder="Ex. Omelette 3 œufs + Pain complet" /></div>
          <div class="grid-4">
            <div class="field"><label class="field-label">Kcal</label><input id="fav-kcal" class="input mono" type="number" required value="450" /></div>
            <div class="field"><label class="field-label">Prot (g)</label><input id="fav-p" class="input mono" type="number" step="0.5" required value="30" /></div>
            <div class="field"><label class="field-label">Gluc (g)</label><input id="fav-c" class="input mono" type="number" step="0.5" required value="40" /></div>
            <div class="field"><label class="field-label">Lip (g)</label><input id="fav-f" class="input mono" type="number" step="0.5" required value="16" /></div>
          </div>
          <button type="submit" class="btn btn-primary btn-block">Enregistrer le favori</button>
        </form>`,
        ({ close }) => {
          document.getElementById('fav-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveFavorite(state.profile.id, {
              name: document.getElementById('fav-name').value.trim(),
              kcal: Number(document.getElementById('fav-kcal').value),
              proteinG: Number(document.getElementById('fav-p').value),
              carbsG: Number(document.getElementById('fav-c').value),
              fatG: Number(document.getElementById('fav-f').value),
            });
            state.favorites = await listFavorites(state.profile.id);
            close();
            renderApp();
            showToast('Repas favori enregistré.');
          });
        }
      );
    });
    return;
  }

  if (state.nutritionSubTab === 'photo') {
    const res = state.lastMealVisionResult;
    slot.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <h2>Analyse Photo d’Assiette (IA Vision)</h2>
          <span class="state-tag is-muted">NIVEAU ${state.aiSettings.activeTier}</span>
        </div>
        <div class="row-wrap">
          <label class="btn btn-primary" style="cursor: pointer;">
            Prendre / Choisir photo d’assiette
            <input id="meal-photo-input" type="file" accept="image/*" capture="environment" hidden />
          </label>
          <span class="panel-subtitle">Estimation automatique des grammages, macros, score d’alignement et conseil repas suivant.</span>
        </div>
        <div id="meal-photo-status" class="stack-sm">
          ${
            res
              ? `
            ${
              res.usedFallback && res.fallbackReason
                ? `<div class="notice notice-danger">
                    <span><strong>Repli Niveau 0 :</strong> ${esc(res.fallbackReason)}</span>
                    <button type="button" class="btn btn-xs" id="btn-meal-open-ai">Régler IA</button>
                  </div>`
                : ''
            }
            <div class="panel-elevated stack-sm">
              <div class="row-between">
                <strong>${esc(res.data.meal_label || 'Assiette analysée')}</strong>
                <span class="mono text-accent">${res.data.alignment_score ?? '--'}/100</span>
              </div>
              <div class="mono metric-sm">
                Total : ${res.data.totals.kcal} kcal · P ${res.data.totals.protein_g}g · G ${res.data.totals.carbs_g}g · L ${res.data.totals.fat_g}g
              </div>
              <div class="stack-sm">
                ${(res.data.items || [])
                  .map((i) => `<span class="panel-subtitle mono">• ${esc(i.name)} (${i.grams} g) : ${i.kcal} kcal</span>`)
                  .join('')}
              </div>
              <p class="panel-subtitle">${esc(res.data.advice || '')}</p>
              <button type="button" class="btn btn-primary btn-block" id="btn-commit-meal-photo">Ajouter au journal du jour</button>
            </div>`
              : ''
          }
        </div>
      </section>
    `;

    document.getElementById('btn-meal-open-ai')?.addEventListener('click', () => {
      state.profilSubTab = 'ai';
      navigateTo('profil');
    });

    document.getElementById('meal-photo-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      document.getElementById('meal-photo-status').innerHTML = `<p class="panel-subtitle">Compression & analyse IA Vision en cours...</p>`;
      try {
        const compressed = await compressPhysiqueImage(file, { maxWidth: 960, targetBytes: 180000 });
        state.lastMealVisionResult = await analyzeMealPhoto(compressed.dataUrl, state.profile, state.aiSettings);
        renderNutritionSubTab(slot, macros);
      } catch (err) {
        showToast(err.message);
      }
    });

    document.getElementById('btn-commit-meal-photo')?.addEventListener('click', async () => {
      const d = state.lastMealVisionResult?.data;
      if (!d) return;
      await saveNutritionLog(state.profile.id, {
        date: getTodayISO(),
        mealSlot: 'Photo Vision',
        source: 'photo',
        label: d.meal_label || (d.items || []).map((i) => i.name).join(' + '),
        kcal: Math.round(d.totals.kcal),
        proteinG: Number(d.totals.protein_g),
        carbsG: Number(d.totals.carbs_g),
        fatG: Number(d.totals.fat_g),
        items: d.items,
        aiScore: d.alignment_score,
        aiAdvice: d.advice,
      });
      state.lastMealVisionResult = null;
      state.nutritionAll = await listNutritionLogs(state.profile.id);
      state.nutritionToday = state.nutritionAll.filter((n) => n.date === getTodayISO());
      renderApp();
      showToast('Assiette ajoutée au journal.');
    });
    return;
  }

  if (state.nutritionSubTab === 'barcode') {
    slot.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <h2>Scanner Code-Barres & Open Food Facts (0 clé)</h2>
          <button type="button" class="btn btn-sm btn-primary" id="btn-start-barcode">Ouvrir caméra</button>
        </div>

        <div id="barcode-reader-box" style="width: 100%; max-width: 420px;"></div>

        <div class="grid-2">
          <div class="input-action-row">
            <input id="manual-barcode-input" class="input mono" type="text" inputmode="numeric" placeholder="Code EAN (ex. 3017620422003)" />
            <button type="button" class="btn btn-sm" id="btn-lookup-barcode">Chercher</button>
          </div>
          <div class="input-action-row">
            <input id="off-text-input" class="input" type="search" placeholder="Recherche Open Food Facts..." />
            <button type="button" class="btn btn-sm" id="btn-search-off">OK</button>
          </div>
        </div>

        <div class="row">
          <label class="label-tech" for="off-grams">Portion à ajouter (g) :</label>
          <input id="off-grams" class="input mono" type="number" min="5" max="1500" value="100" style="max-width: 110px;" />
        </div>

        <div id="off-results-list" class="stack-sm">
          ${state.offResults
            .map(
              (p, idx) => `
            <div class="row-between panel-elevated" style="padding: 10px 12px;">
              <div class="stack-sm" style="gap: 2px;">
                <strong>${esc(p.name)} ${p.brand ? `· ${esc(p.brand)}` : ''}</strong>
                <span class="mono metric-sm text-secondary">${p.kcal} kcal/100g · P ${p.proteinG}g · G ${p.carbsG}g · L ${p.fatG}g ${p.nutriscore ? `· Nutri-Score ${esc(p.nutriscore)}` : ''}</span>
              </div>
              <button type="button" class="btn btn-sm btn-primary" data-add-off="${idx}">+ Ajouter</button>
            </div>`
            )
            .join('')}
        </div>
      </section>
    `;

    const handleBarcode = async (code) => {
      try {
        const product = await lookupBarcodeOpenFoodFacts(code);
        state.offResults = [product];
        renderNutritionSubTab(slot, macros);
        showToast(`Produit trouvé : ${product.name}`);
      } catch (err) {
        showToast(err.message);
      }
    };

    document.getElementById('btn-start-barcode')?.addEventListener('click', async () => {
      try {
        state.barcodeScanner = new BarcodeScannerController('barcode-reader-box');
        await state.barcodeScanner.start((code) => handleBarcode(code));
      } catch (err) {
        showToast(err.message);
      }
    });

    document.getElementById('btn-lookup-barcode')?.addEventListener('click', () => {
      handleBarcode(document.getElementById('manual-barcode-input').value);
    });

    document.getElementById('btn-search-off')?.addEventListener('click', async () => {
      const q = document.getElementById('off-text-input').value;
      state.offResults = await searchOpenFoodFactsText(q);
      renderNutritionSubTab(slot, macros);
    });

    slot.querySelectorAll('[data-add-off]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const prod = state.offResults[Number(btn.dataset.addOff)];
        const grams = Number(document.getElementById('off-grams')?.value) || 100;
        const scaled = scaleFoodMacros(prod, grams);
        await saveNutritionLog(state.profile.id, {
          date: getTodayISO(),
          mealSlot: 'Code-Barres',
          source: 'barcode',
          label: `${prod.name} (${scaled.grams} g)`,
          ...scaled,
        });
        state.nutritionAll = await listNutritionLogs(state.profile.id);
        state.nutritionToday = state.nutritionAll.filter((n) => n.date === getTodayISO());
        renderApp();
        showToast(`${prod.name} ajouté (${scaled.kcal} kcal).`);
      });
    });
    return;
  }

  // Onglet Plan type & Liste de courses interactive par rayon
  const generated = generateMealPlanAndShoppingList(state.profile, macros);
  const aislesMap = new Map();
  for (const item of state.shoppingList) {
    const arr = aislesMap.get(item.aisle) || [];
    arr.push(item);
    aislesMap.set(item.aisle, arr);
  }

  slot.innerHTML = `
    <div class="grid-2">
      <section class="panel">
        <div class="panel-header">
          <h2>Plan type (${state.profile.nutritionPrefs?.mealsPerDay || 3} repas · ${esc(state.profile.nutritionPrefs?.dietType || 'omnivore')})</h2>
          <button type="button" class="btn btn-sm btn-primary" id="btn-sync-shopping">Remplir liste courses</button>
        </div>
        <div class="stack">
          ${generated.mealPlan
            .map(
              (m) => `
            <div class="panel-elevated stack-sm">
              <div class="row-between">
                <strong>${esc(m.slot)}</strong>
                <span class="mono metric-sm text-accent">${m.totals.kcal} kcal · P ${m.totals.proteinG}g</span>
              </div>
              ${m.items.map((i) => `<span class="panel-subtitle mono">• ${esc(i.name)} : ${i.grams} g (${i.kcal} kcal)</span>`).join('')}
            </div>`
            )
            .join('')}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Liste de courses par rayon (7 j)</h2>
          <span class="mono metric-sm text-secondary">${state.shoppingList.filter((i) => i.checked).length}/${state.shoppingList.length}</span>
        </div>
        ${
          state.shoppingList.length === 0
            ? `<p class="panel-subtitle">Cliquez sur "Remplir liste courses" pour générer les quantités hebdomadaires adaptées à vos macros et allergies.</p>`
            : Array.from(aislesMap.entries())
                .map(
                  ([aisle, items]) => `
                <div class="stack-sm">
                  <span class="label-tech text-accent">${esc(aisle)}</span>
                  ${items
                    .map(
                      (it) => `
                    <label class="row-between" style="padding: 6px 0; border-bottom: 1px solid var(--border-hairline); cursor: pointer;">
                      <span class="row">
                        <input type="checkbox" data-toggle-shop="${esc(it.id)}" ${it.checked ? 'checked' : ''} />
                        <span style="${it.checked ? 'text-decoration: line-through; opacity: 0.5;' : ''}">${esc(it.name)}</span>
                      </span>
                      <span class="mono metric-sm">${it.quantity} ${esc(it.unit)}</span>
                    </label>`
                    )
                    .join('')}
                </div>`
                )
                .join('')
        }
      </section>
    </div>
  `;

  document.getElementById('btn-sync-shopping')?.addEventListener('click', async () => {
    for (const old of state.shoppingList) {
      await deleteShoppingItem(old.id);
    }
    for (const item of generated.shoppingList) {
      await saveShoppingItem(state.profile.id, item);
    }
    state.shoppingList = await listShoppingList(state.profile.id);
    renderNutritionSubTab(slot, macros);
    showToast(`${state.shoppingList.length} articles classés par rayon.`);
  });

  slot.querySelectorAll('[data-toggle-shop]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const it = state.shoppingList.find((x) => x.id === cb.dataset.toggleShop);
      if (!it) return;
      it.checked = cb.checked;
      await saveShoppingItem(state.profile.id, it);
      renderNutritionSubTab(slot, macros);
    });
  });
}

/* ==========================================================================
   ÉCRAN 4 — [LABO & ÉVOLUTION] (OCR, US NAVY, CHART.JS, GHOST OVERLAY, MUTATION)
   ========================================================================== */

let chartJsPromise = null;
async function ensureChartJS() {
  if (typeof window === 'undefined') return null;
  if (window.Chart) return window.Chart;
  if (chartJsPromise) return chartJsPromise;
  chartJsPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js';
    s.async = true;
    s.onload = () => resolve(window.Chart || null);
    s.onerror = () => {
      chartJsPromise = null;
      resolve(null);
    };
    document.head.appendChild(s);
  });
  return chartJsPromise;
}

function destroyActiveCharts() {
  for (const ch of state.chartInstances) {
    try {
      ch.destroy();
    } catch {
      // Ignorer
    }
  }
  state.chartInstances = [];
}

async function mountLaboCharts() {
  destroyActiveCharts();
  const Chart = await ensureChartJS();
  if (!Chart) return;

  const { ewma } = getDerivedTelemetry();
  const gridColor = '#242933';
  const tickColor = '#9CA3B2';
  const commonOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: tickColor, font: { family: 'JetBrains Mono', size: 11 } } } },
    scales: {
      x: { ticks: { color: tickColor, font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor, font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: gridColor } },
    },
  };

  // 1. Poids brut + EWMA
  const cWeight = document.getElementById('chart-weight');
  if (cWeight) {
    state.chartInstances.push(
      new Chart(cWeight, {
        type: 'line',
        data: {
          labels: ewma.series.map((s) => s.date.slice(5)),
          datasets: [
            {
              label: 'Poids brut (kg)',
              data: ewma.series.map((s) => s.weightKg),
              borderColor: '#687182',
              backgroundColor: '#687182',
              borderDash: [4, 4],
              pointRadius: 3,
              tension: 0.15,
            },
            {
              label: 'Poids lissé EWMA (kg)',
              data: ewma.series.map((s) => s.ewmaWeightKg),
              borderColor: '#F59E0B',
              backgroundColor: 'rgba(245,158,11,0.12)',
              borderWidth: 2.5,
              pointRadius: 2,
              tension: 0.25,
            },
          ],
        },
        options: commonOpts,
      })
    );
  }

  // 2. Composition corporelle (%MG Balance vs US Navy)
  const cComp = document.getElementById('chart-comp');
  if (cComp) {
    const compRows = state.biometrics.filter((b) => b.bodyFatPct || b.navyBodyFatPct);
    state.chartInstances.push(
      new Chart(cComp, {
        type: 'line',
        data: {
          labels: compRows.map((b) => b.date.slice(5)),
          datasets: [
            { label: '%MG Balance', data: compRows.map((b) => b.bodyFatPct ?? null), borderColor: '#F59E0B', tension: 0.2 },
            { label: '%MG US Navy', data: compRows.map((b) => b.navyBodyFatPct ?? null), borderColor: '#10B981', tension: 0.2 },
          ],
        },
        options: commonOpts,
      })
    );
  }

  // 3. Force 1RM estimé (progression polyarticulaires)
  const c1rm = document.getElementById('chart-1rm');
  if (c1rm) {
    const orderedWk = [...state.workouts].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    const labels = [];
    const best1rms = [];
    for (const wk of orderedWk) {
      let best = 0;
      for (const ex of wk.exercises || []) {
        for (const s of ex.sets || []) {
          if (!s.isWarmup && s.done) {
            best = Math.max(best, estimate1RM(s.weightKg, s.reps, s.rir ?? 1));
          }
        }
      }
      if (best > 0) {
        labels.push((wk.date || '').slice(5));
        best1rms.push(best);
      }
    }
    state.chartInstances.push(
      new Chart(c1rm, {
        type: 'line',
        data: {
          labels,
          datasets: [{ label: 'Meilleur 1RM estimé séance (kg)', data: best1rms, borderColor: '#F59E0B', borderWidth: 2, tension: 0.2 }],
        },
        options: commonOpts,
      })
    );
  }

  // 4. Volume hebdomadaire par groupe musculaire
  const cVol = document.getElementById('chart-volume');
  if (cVol && state.program?.weeklyVolume) {
    const entries = Object.entries(state.program.weeklyVolume).filter(([, v]) => v > 0);
    state.chartInstances.push(
      new Chart(cVol, {
        type: 'bar',
        data: {
          labels: entries.map(([k]) => MUSCLE_GROUPS[k]?.label.split(' ')[0] || k),
          datasets: [
            {
              label: 'Séries effectives / sem',
              data: entries.map(([, v]) => v),
              backgroundColor: entries.map(([k]) =>
                (state.profile.lagPriorities || []).includes(k) ? '#EF4444' : '#F59E0B'
              ),
            },
          ],
        },
        options: commonOpts,
      })
    );
  }
}

async function renderLabo(container) {
  const { latestBio } = getDerivedTelemetry();
  const anglePhotos = state.photos
    .filter((p) => p.angle === state.laboAngle)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const day1Photo = anglePhotos[0] || null;
  const day1Url = day1Photo?.blob instanceof Blob ? URL.createObjectURL(day1Photo.blob) : null;

  const isBioTab = state.laboSubTab !== 'photos';

  container.innerHTML = `
    <section class="stack">
      <div class="row-between">
        <h1>Labo & Évolution</h1>
        <span class="mono metric-xs text-secondary">${state.photos.length} photos · ${state.biometrics.length} pesées</span>
      </div>

      <div class="segmented" role="tablist">
        <button type="button" class="segmented-btn ${isBioTab ? 'is-active' : ''}" data-labo-tab="biometrics">Biométrie & Courbes</button>
        <button type="button" class="segmented-btn ${!isBioTab ? 'is-active' : ''}" data-labo-tab="photos">Photos & Mutation</button>
      </div>

      ${
        isBioTab
          ? `
      <!-- Biométrie multi-sources : OCR Balance + Mètre ruban US Navy -->
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Balance (OCR) & Mensurations</h2>
            <p class="panel-subtitle">Captures OKOK, Withings, Xiaomi, Renpho, Garmin ou saisie manuelle.</p>
          </div>
          <label class="btn btn-sm btn-primary" style="cursor: pointer;">
            OCR Balance
            <input id="scale-ocr-input" type="file" accept="image/*" hidden />
          </label>
        </div>

        <form id="biometrics-form" class="stack">
          <div class="grid-4">
            <div class="field"><label class="field-label">Poids (kg)</label><input id="bio-weight" class="input mono" type="number" inputmode="decimal" step="0.1" value="${latestBio?.weightKg ?? state.profile.weightKg}" required /></div>
            <div class="field"><label class="field-label">% Grasse</label><input id="bio-bf" class="input mono" type="number" inputmode="decimal" step="0.1" value="${latestBio?.bodyFatPct ?? ''}" placeholder="Optionnel" /></div>
            <div class="field"><label class="field-label">Muscle (kg)</label><input id="bio-muscle" class="input mono" type="number" inputmode="decimal" step="0.1" value="${latestBio?.muscleMassKg ?? ''}" placeholder="Optionnel" /></div>
            <div class="field"><label class="field-label">Viscérale</label><input id="bio-visc" class="input mono" type="number" inputmode="numeric" step="1" value="${latestBio?.visceralFat ?? ''}" placeholder="Optionnel" /></div>
          </div>

          <div class="grid-4">
            <div class="field"><label class="field-label">Cou (cm)</label><input id="bio-neck" class="input mono" type="number" inputmode="decimal" step="0.5" value="${latestBio?.neckCm ?? ''}" placeholder="US Navy" /></div>
            <div class="field"><label class="field-label">Taille (cm)</label><input id="bio-waist" class="input mono" type="number" inputmode="decimal" step="0.5" value="${latestBio?.waistCm ?? ''}" placeholder="WHtR" /></div>
            <div class="field"><label class="field-label">Hanches (cm)</label><input id="bio-hips" class="input mono" type="number" inputmode="decimal" step="0.5" value="${latestBio?.hipsCm ?? ''}" placeholder="Femmes" /></div>
            <div class="field"><label class="field-label">BMR (kcal)</label><input id="bio-bmr" class="input mono" type="number" inputmode="numeric" step="10" value="${latestBio?.measuredBmr ?? ''}" placeholder="Optionnel" /></div>
          </div>

          <span class="mono metric-xs text-secondary" id="live-navy-preview">
            ${
              latestBio?.navyBodyFatPct
                ? `US Navy : ${latestBio.navyBodyFatPct} % · WHtR : ${latestBio.whtr ?? '--'}`
                : 'Saisissez cou + taille pour calculer le %MG US Navy et le ratio WHtR.'
            }
          </span>
          <button type="submit" class="btn btn-primary btn-block">Enregistrer la mesure</button>
        </form>
      </section>

      <!-- 4 Graphiques Chart.js -->
      <div class="grid-2">
        <section class="panel"><h3>Poids brut & EWMA</h3><div style="height: 210px;"><canvas id="chart-weight"></canvas></div></section>
        <section class="panel"><h3>% Masse grasse (Balance vs US Navy)</h3><div style="height: 210px;"><canvas id="chart-comp"></canvas></div></section>
        <section class="panel"><h3>Force estimée (1RM)</h3><div style="height: 210px;"><canvas id="chart-1rm"></canvas></div></section>
        <section class="panel"><h3>Volume hebdo par muscle (Rouge = LAG)</h3><div style="height: 210px;"><canvas id="chart-volume"></canvas></div></section>
      </div>`
          : `
      <!-- Labo Photos 3 angles + Ghost Overlay + Comparateur + Double Analyse -->
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Labo Photos 3 angles</h2>
            <p class="panel-subtitle">Stockage 100 % local compressé (~180 Ko) · MediaPipe 33 landmarks.</p>
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="btn-run-physique-analysis">Analyser</button>
        </div>

        <div class="segmented" role="tablist">
          ${PHOTO_ANGLES.map(
            (a) =>
              `<button type="button" class="segmented-btn ${state.laboAngle === a.id ? 'is-active' : ''}" data-photo-angle="${a.id}">${a.label}</button>`
          ).join('')}
        </div>

        <div class="grid-2">
          <!-- Capture guidée Ghost Overlay -->
          <div class="stack">
            <div class="camera-stage" id="physique-camera-stage">
              <video id="physique-video" autoplay muted playsinline></video>
              ${day1Url ? `<img class="ghost-overlay-img" id="ghost-overlay-img" src="${day1Url}" alt="Calque fantôme Jour 1" />` : ''}
            </div>
            <div class="grid-4" style="grid-template-columns: repeat(2, minmax(0, 1fr));">
              <button type="button" class="btn btn-sm btn-primary" id="btn-open-cam">Caméra + Ghost</button>
              <button type="button" class="btn btn-sm" id="btn-capture-photo">Capturer (3s)</button>
              <button type="button" class="btn btn-sm" id="btn-flip-cam">Basculer cam</button>
              <label class="btn btn-sm" style="cursor: pointer;">
                Importer photo
                <input id="upload-physique-photo" type="file" accept="image/*" hidden />
              </label>
            </div>
            <p class="panel-subtitle">${esc(PHOTO_ANGLES.find((a) => a.id === state.laboAngle)?.cue || '')}</p>
          </div>

          <!-- Comparateur Avant / Après -->
          <div class="stack">
            <span class="label-tech">Comparateur Avant / Après (${anglePhotos.length} photos)</span>
            <div id="before-after-slot">
              ${
                anglePhotos.length < 2
                  ? `<p class="panel-subtitle">Ajoutez 2 photos sur l’angle "${esc(state.laboAngle)}" à deux dates différentes pour activer le curseur Avant / Après.</p>`
                  : ''
              }
            </div>
            ${
              anglePhotos.length > 0
                ? `<div class="row-wrap">
                    ${anglePhotos
                      .map(
                        (ph) => `
                      <span class="mono metric-xs panel-elevated" style="padding: 4px 8px; display: inline-flex; align-items: center; gap: 6px;">
                        ${esc(ph.date)} (${Math.round((ph.sizeBytes || 0) / 1024)} Ko)
                        <button type="button" class="btn btn-ghost btn-xs" style="min-height:24px;padding:0 4px;" data-del-photo="${esc(ph.id)}">×</button>
                      </span>`
                      )
                      .join('')}
                  </div>`
                : ''
            }
          </div>
        </div>

        <!-- Résultat Double Analyse & Bouton Adapter mon Programme -->
        <div id="physique-analysis-slot" class="stack">
          ${renderPhysiqueAnalysisHTML()}
        </div>
      </section>`
      }
    </section>
  `;

  container.querySelectorAll('[data-labo-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.cameraController?.stop();
      destroyActiveCharts();
      state.laboSubTab = btn.dataset.laboTab;
      renderApp();
    });
  });

  // Montage Chart.js uniquement sur l'onglet Biométrie
  if (isBioTab) {
    mountLaboCharts();
  }

  // Montage Comparateur Avant / Après si >= 2 photos sur l'angle courant
  if (!isBioTab && anglePhotos.length >= 2) {
    const first = anglePhotos[0];
    const last = anglePhotos[anglePhotos.length - 1];
    const u1 = first.blob instanceof Blob ? URL.createObjectURL(first.blob) : '';
    const u2 = last.blob instanceof Blob ? URL.createObjectURL(last.blob) : '';
    mountBeforeAfterSlider(document.getElementById('before-after-slot'), u1, u2, {
      beforeLabel: first.date,
      afterLabel: last.date,
    });
  }

  // OCR Balance
  document.getElementById('scale-ocr-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showToast('Lecture OCR de la capture balance en cours...');
    try {
      const comp = await compressPhysiqueImage(file, { maxWidth: 1080, targetBytes: 200000 });
      const res = await extractScaleMetricsOCR(comp.dataUrl, state.profile, state.aiSettings);
      const d = res.data || {};
      if (d.weight_kg) document.getElementById('bio-weight').value = d.weight_kg;
      if (d.body_fat_pct) document.getElementById('bio-bf').value = d.body_fat_pct;
      if (d.muscle_mass_kg) document.getElementById('bio-muscle').value = d.muscle_mass_kg;
      if (d.visceral_fat) document.getElementById('bio-visc').value = d.visceral_fat;
      if (d.bmr_kcal) document.getElementById('bio-bmr').value = d.bmr_kcal;
      showToast(
        res.usedFallback
          ? `OCR repli local : ${res.fallbackReason || 'vérifiez les champs manuellement.'}`
          : `Capture balance extraite (${d.weight_kg} kg). Cliquez sur Enregistrer.`
      );
    } catch (err) {
      showToast(err.message);
    }
  });

  // Enregistrement Biométrie + Calcul US Navy & WHtR
  document.getElementById('biometrics-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const num = (id) => {
      const v = document.getElementById(id)?.value;
      return v !== '' && v !== undefined ? Number(v) : null;
    };
    const weightKg = num('bio-weight');
    const neckCm = num('bio-neck');
    const waistCm = num('bio-waist');
    const hipsCm = num('bio-hips');

    const navyBodyFatPct =
      neckCm && waistCm
        ? computeUSNavyBodyFat({
            sex: state.profile.sex,
            heightCm: state.profile.heightCm,
            neckCm,
            waistCm,
            hipsCm,
          })
        : null;
    const whtr = waistCm ? computeWHtR(waistCm, state.profile.heightCm)?.ratio || null : null;

    await saveBiometric(state.profile.id, {
      date: getTodayISO(),
      source: 'manual',
      weightKg,
      bodyFatPct: num('bio-bf'),
      muscleMassKg: num('bio-muscle'),
      visceralFat: num('bio-visc'),
      measuredBmr: num('bio-bmr'),
      neckCm,
      waistCm,
      hipsCm,
      navyBodyFatPct,
      whtr,
    });

    if (weightKg) {
      state.profile = await updateProfile(state.profile.id, { weightKg });
    }
    state.biometrics = await listBiometrics(state.profile.id);
    renderApp();
    showToast(`Biométrie enregistrée (${weightKg} kg${navyBodyFatPct ? ` · US Navy ${navyBodyFatPct}%` : ''}).`);
  });

  // Contrôles Labo Photos
  container.querySelectorAll('[data-photo-angle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.cameraController?.stop();
      state.laboAngle = btn.dataset.photoAngle;
      renderApp();
    });
  });

  document.getElementById('btn-open-cam')?.addEventListener('click', async () => {
    try {
      const video = document.getElementById('physique-video');
      state.cameraController = new PhysiqueCameraController(video);
      await state.cameraController.start('user');
      showToast('Caméra active avec Ghost Overlay Jour 1.');
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById('btn-flip-cam')?.addEventListener('click', async () => {
    try {
      await state.cameraController?.toggleFacingMode();
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById('btn-capture-photo')?.addEventListener('click', async () => {
    if (!state.cameraController?.stream) {
      showToast('Ouvrez d’abord la caméra ou importez une photo.');
      return;
    }
    showToast('Capture dans 3 secondes — mettez-vous en place...');
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const comp = await state.cameraController.captureCompressed();
      await savePhysiquePhoto(state.profile.id, {
        date: getTodayISO(),
        angle: state.laboAngle,
        mimeType: comp.mimeType,
        blob: comp.blob,
        sizeBytes: comp.sizeBytes,
        width: comp.width,
        height: comp.height,
      });
      state.cameraController.stop();
      state.photos = await listPhysiquePhotos(state.profile.id);
      renderApp();
      showToast(`Photo "${state.laboAngle}" enregistrée (${Math.round(comp.sizeBytes / 1024)} Ko).`);
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById('upload-physique-photo')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const comp = await compressPhysiqueImage(file);
      await savePhysiquePhoto(state.profile.id, {
        date: getTodayISO(),
        angle: state.laboAngle,
        mimeType: comp.mimeType,
        blob: comp.blob,
        sizeBytes: comp.sizeBytes,
        width: comp.width,
        height: comp.height,
      });
      state.photos = await listPhysiquePhotos(state.profile.id);
      renderApp();
      showToast(`Photo "${state.laboAngle}" compressée (${Math.round(comp.sizeBytes / 1024)} Ko) dans IndexedDB.`);
    } catch (err) {
      showToast(err.message);
    }
  });

  container.querySelectorAll('[data-del-photo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deletePhysiquePhoto(btn.dataset.delPhoto);
      state.photos = await listPhysiquePhotos(state.profile.id);
      renderApp();
    });
  });

  // Lancer Double Analyse (MediaPipe 33 Landmarks + IA Vision)
  document.getElementById('btn-run-physique-analysis')?.addEventListener('click', async () => {
    const latestByAngle = [];
    for (const ang of ['front', 'side', 'back']) {
      const found = state.photos.find((p) => p.angle === ang);
      if (found) {
        latestByAngle.push({
          angle: ang,
          blob: found.blob,
          dataUrl: found.blob instanceof Blob ? await blobToDataUrl(found.blob) : null,
        });
      }
    }

    showToast('Analyse MediaPipe 33 landmarks + Vision en cours...');
    state.lastPhysiqueAnalysis = await runDualPhysiqueAnalysis({
      photos: latestByAngle,
      profile: state.profile,
      aiSettings: state.aiSettings,
      latestBiometrics: latestBio,
    });
    renderApp();
    showToast(`Analyse physique terminée (Niveau IA ${state.lastPhysiqueAnalysis.meta.tierUsed}).`);
  });

  // Bouton "Adapter mon programme" -> Aperçu Diff + Validation 1-clic
  document.getElementById('btn-preview-mutation')?.addEventListener('click', () => {
    if (!state.lastPhysiqueAnalysis || !state.program) return;
    const diff = computeProgramMutation(state.program, state.lastPhysiqueAnalysis, state.profile);
    state.pendingMutation = diff;

    const rowsHtml = diff.changes
      .map(
        (c) => `
        <div class="panel-elevated stack-sm" style="gap: 3px;">
          <div class="row-between">
            <strong>${esc(c.exerciseName)}</strong>
            <span class="state-tag ${c.type.startsWith('lag') ? 'is-lag' : 'is-accent'}">${esc(c.type.toUpperCase())}</span>
          </div>
          <span class="panel-subtitle">${esc(c.dayName)} · ${esc(c.detail)}</span>
        </div>`
      )
      .join('');

    const volRows = Object.keys(MUSCLE_GROUPS)
      .filter((m) => (diff.volumeBefore[m] || 0) !== (diff.volumeAfter[m] || 0))
      .map(
        (m) => `
        <tr>
          <td>${esc(MUSCLE_GROUPS[m].label)}</td>
          <td class="num">${diff.volumeBefore[m] || 0}</td>
          <td class="num text-accent">${diff.volumeAfter[m] || 0}</td>
          <td class="num">${VOLUME_LANDMARKS[m]?.mev ?? 4}–${VOLUME_LANDMARKS[m]?.mrv ?? 16}</td>
        </tr>`
      )
      .join('');

    openModal(
      'Aperçu Mutation du Programme (Diff)',
      `
      <p class="panel-subtitle">
        Groupes [LAG] boostés (+2 à +4 séries) et placés en début de séance · Groupes [DOMINANT] abaissés au MEV.
      </p>
      ${
        volRows
          ? `<div class="table-wrap"><table class="table-tech">
              <thead><tr><th>Muscle</th><th class="num">Avant</th><th class="num">Après</th><th class="num">MEV–MRV</th></tr></thead>
              <tbody>${volRows}</tbody>
            </table></div>`
          : ''
      }
      <div class="stack-sm">${rowsHtml || '<p class="panel-subtitle">Programme déjà optimisé.</p>'}</div>
      <button type="button" class="btn btn-primary btn-block" id="btn-commit-mutation">Appliquer la mutation (1 clic)</button>
      `,
      ({ close }) => {
        document.getElementById('btn-commit-mutation')?.addEventListener('click', async () => {
          const mutated = applyProgramMutation(state.program, diff);
          state.program = await saveProgram(state.profile.id, mutated);
          state.profile = await updateProfile(state.profile.id, {
            lagPriorities: diff.lagGroups,
            dominantGroups: diff.dominantGroups,
            asymmetries: diff.asymmetries,
          });
          state.activeSession = null;
          close();
          renderApp();
          showToast(`Programme muté : ${diff.changes.length} ajustements biomécaniques appliqués.`);
        });
      }
    );
  });

  // Si landmarks présents, dessiner l'aperçu clinique
  const lmCanvas = document.getElementById('mediapipe-landmarks-canvas');
  const firstLandmarks = state.lastPhysiqueAnalysis?.mediapipe?.landmarksByAngle?.front;
  if (lmCanvas && firstLandmarks) {
    drawPoseLandmarksOverlay(lmCanvas, firstLandmarks);
  }
}

function renderPhysiqueAnalysisHTML() {
  const a = state.lastPhysiqueAnalysis;
  if (!a) return '';
  const lags = (a.muscle_scores || []).filter((m) => m.status === 'LAG');
  const balanced = (a.muscle_scores || []).filter((m) => m.status === 'BALANCED');
  const dominant = (a.muscle_scores || []).filter((m) => m.status === 'DOMINANT');

  return `
    <hr class="divider" />
    <div class="row-between">
      <div>
        <h3>Bilan Forces / Faiblesses & Posture</h3>
        <span class="meta-inline mono">Source : ${esc(a.meta?.provider || 'local')} · ${a.meta?.latencyMs ?? 0} ms</span>
      </div>
      <button type="button" class="btn btn-primary" id="btn-preview-mutation">Adapter mon programme</button>
    </div>

    <div class="grid-3">
      <div class="panel-elevated stack-sm">
        <span class="state-tag is-lag">[LAG — PRIORITAIRES] (${lags.length})</span>
        ${lags.map((m) => `<div class="row-between"><span>${esc(m.label)}</span><span class="mono text-danger">${m.score}/100</span></div>`).join('') || '<span class="panel-subtitle">Aucun retard majeur</span>'}
      </div>
      <div class="panel-elevated stack-sm">
        <span class="state-tag is-ok">[BALANCED] (${balanced.length})</span>
        ${balanced.slice(0, 6).map((m) => `<div class="row-between"><span>${esc(m.label)}</span><span class="mono">${m.score}/100</span></div>`).join('')}
      </div>
      <div class="panel-elevated stack-sm">
        <span class="state-tag is-accent">[DOMINANT] (${dominant.length})</span>
        ${dominant.map((m) => `<div class="row-between"><span>${esc(m.label)}</span><span class="mono text-accent">${m.score}/100</span></div>`).join('') || '<span class="panel-subtitle">Équilibre homogène</span>'}
      </div>
    </div>

    <div class="grid-2">
      <div class="panel-elevated stack-sm">
        <span class="label-tech">Posture & Ratios segmentaires (MediaPipe)</span>
        <span class="mono metric-sm">
          Épaules/Bassin : ${a.posture?.shoulder_hip_ratio ?? a.mediapipe?.segmentRatios?.shoulderToHipRatio ?? '--'} ·
          Fémur/Tibia : ${a.posture?.femur_tibia_ratio ?? a.mediapipe?.segmentRatios?.femurToTibiaRatio ?? '--'} ·
          Inclinaison épaules : ${a.posture?.shoulder_tilt_deg ?? 0}°
        </span>
        ${(a.posture?.flags || []).map((f) => `<span class="panel-subtitle">• ${esc(f)}</span>`).join('')}
        ${(a.asymmetries || []).map((as) => `<span class="panel-subtitle text-danger">• Asymétrie : ${esc(as.description)}</span>`).join('')}
      </div>
      <div class="panel-elevated stack-sm">
        <span class="label-tech">Synthèse évolution visuelle</span>
        <p class="panel-subtitle">${esc(a.visual_evolution_summary || '')}</p>
        ${a.mediapipe?.landmarksByAngle?.front ? `<canvas id="mediapipe-landmarks-canvas" width="220" height="220" style="background:#090a0c;border:1px solid #242933;border-radius:4px;"></canvas>` : ''}
      </div>
    </div>
  `;
}

/* ==========================================================================
   ÉCRAN 5 — [COACH & PROFIL] (CHAT, PROFIL MORPHO, ROUTEUR IA, P2P, BACKUP)
   ========================================================================== */

function renderProfil(container) {
  container.innerHTML = `
    <section class="stack">
      <h1>Coach & Réglages</h1>

      <div class="segmented" role="tablist">
        <button type="button" class="segmented-btn ${state.profilSubTab === 'coach' ? 'is-active' : ''}" data-prof-tab="coach">Coach</button>
        <button type="button" class="segmented-btn ${state.profilSubTab === 'profile' ? 'is-active' : ''}" data-prof-tab="profile">Profil</button>
        <button type="button" class="segmented-btn ${state.profilSubTab === 'ai' ? 'is-active' : ''}" data-prof-tab="ai">Clés IA</button>
        <button type="button" class="segmented-btn ${state.profilSubTab === 'p2p' ? 'is-active' : ''}" data-prof-tab="p2p">P2P</button>
        <button type="button" class="segmented-btn ${state.profilSubTab === 'backup' ? 'is-active' : ''}" data-prof-tab="backup">Backup</button>
      </div>

      <div id="profil-subview"></div>
    </section>
  `;

  container.querySelectorAll('[data-prof-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.profilSubTab = btn.dataset.profTab;
      renderApp();
    });
  });

  renderProfilSubTab(document.getElementById('profil-subview'));
}

function renderProfilSubTab(slot) {
  if (!slot) return;

  if (state.profilSubTab === 'coach') {
    const activeLabel =
      state.aiSettings.activeTier === 2
        ? `Niv. 2 · ${state.aiSettings.tier2Preset || 'BYO'}`
        : state.aiSettings.activeTier === 1
          ? 'Niv. 1 · Gratuit'
          : state.aiSettings.activeTier === 3
            ? 'Niv. 3 · WebLLM'
            : 'Niv. 0 · Local';
    const runtimeCtx = buildCoachRuntimeContext(state.profile, state.program, state.workouts);
    const memoryList = Array.isArray(state.profile.coachMemory) ? state.profile.coachMemory : [];

    slot.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Coach Adaptatif & Biomécanique</h2>
            <p class="panel-subtitle">
              <strong class="text-accent">${esc(activeLabel)}</strong> · ${esc(runtimeCtx.activeSplitLabel)} · ${esc(TRAINING_METHODS[runtimeCtx.activeMethodId]?.shortLabel || 'Double prog.')}
            </p>
          </div>
          <div class="row" style="gap: 6px;">
            <button type="button" class="btn btn-xs" id="btn-coach-open-ai">IA</button>
            <button type="button" class="btn btn-xs" id="btn-clear-chat">Effacer</button>
          </div>
        </div>

        <!-- Mémoire persistante du Coach (retours terrain + préférences apprises) -->
        <details class="panel-elevated" style="padding: 9px 11px;">
          <summary style="cursor: pointer; font-size: 0.8rem; font-weight: 600;">
            Mémoire du Coach (${memoryList.length} repère${memoryList.length > 1 ? 's' : ''}${runtimeCtx.painExercises.length ? ` · ${runtimeCtx.painExercises.length} alerte douleur` : ''})
          </summary>
          <div class="stack-sm" style="margin-top: 8px;">
            ${
              memoryList.length === 0
                ? `<p class="panel-subtitle">Aucune note mémorisée. Discutez de vos préférences (Full Body, pyramidal inversé, douleurs, durée…) : le Coach les retient et propose d’adapter votre programme en 1 clic.</p>`
                : memoryList
                    .map(
                      (mem) => `
                    <div class="memory-item">
                      <span>${esc(mem.text)}</span>
                      <button type="button" class="btn btn-xs btn-ghost" data-del-memory="${esc(mem.id)}" title="Oublier">×</button>
                    </div>`
                    )
                    .join('')
            }
            <div class="input-action-row" style="margin-top: 4px;">
              <input id="coach-memory-input" class="input" type="text" placeholder="Ex. Je préfère les haltères au squat barre..." />
              <button type="button" class="btn btn-sm" id="btn-add-memory">+ Retenir</button>
            </div>
          </div>
        </details>

        <div class="stack-sm" id="coach-thread" style="max-height: 390px; overflow-y: auto; padding-right: 2px;">
          ${
            state.coachMessages.length === 0
              ? `<p class="panel-subtitle">Demandez un changement de split (Full Body, Upper/Lower, PPL, Arnold, Split classique), une méthode (Pyramidal inversé RPT, Top Set + Back-off, Myo-Reps, DUP), ou signalez une douleur : le Coach s’appuie sur vos dernières séances et adapte votre programme en 1 clic.</p>`
              : state.coachMessages
                  .map(
                    (m) => `
                  <div class="chat-bubble ${m.role === 'user' ? 'is-user' : ''}">
                    <div class="row-between">
                      <span class="label-tech ${m.role === 'user' ? 'text-accent' : ''}">${m.role === 'user' ? esc(state.profile.name) : 'Coach Kinetix'}</span>
                      ${m.tierUsed !== null && m.tierUsed !== undefined ? `<span class="mono metric-xs text-muted">Niv. ${m.tierUsed}${m.provider ? ` · ${esc(m.provider)}` : ''}</span>` : ''}
                    </div>
                    <p>${esc(m.content)}</p>
                    ${
                      m.actionProposal
                        ? `<div class="coach-action-card ${m.actionApplied ? 'is-applied' : ''}">
                            <div class="row-between">
                              <span class="label-tech ${m.actionApplied ? 'text-ok' : 'text-accent'}">${m.actionApplied ? 'ADAPTATION APPLIQUÉE' : esc(m.actionProposal.title)}</span>
                            </div>
                            <span style="font-size: 0.8rem;">${esc(m.actionProposal.summary)}</span>
                            ${
                              m.actionApplied
                                ? `<span class="mono metric-xs text-ok">Programme et séances mis à jour.</span>`
                                : `<button type="button" class="btn btn-sm btn-primary" data-apply-coach-action="${esc(m.id)}">${esc(m.actionProposal.applyLabel || 'Appliquer au programme')}</button>`
                            }
                          </div>`
                        : ''
                    }
                    ${
                      m.fallbackReason
                        ? `<div class="notice notice-danger" style="padding: 7px 9px; font-size: 0.76rem;">
                            <span><strong>Repli Niveau 0 :</strong> ${esc(m.fallbackReason)}</span>
                            <button type="button" class="btn btn-xs" data-open-ai-settings>Vérifier clé</button>
                          </div>`
                        : ''
                    }
                  </div>`
                  )
                  .join('')
          }
          ${state.coachBusy ? `<div class="chat-bubble"><span class="mono metric-xs text-accent">Coach en cours d'analyse (${esc(activeLabel)})...</span></div>` : ''}
        </div>

        <div class="row-wrap">
          <button type="button" class="btn btn-xs" data-quick-prompt="Passe mon programme en pyramidal inversé (RPT) et explique comment progresser">Pyramidal inversé</button>
          <button type="button" class="btn btn-xs" data-quick-prompt="Passe-moi en Full Body 3 jours par semaine">Passer en Full Body</button>
          <button type="button" class="btn btn-xs" data-quick-prompt="J'ai mal à l'épaule au développé, adapte mon programme pour la protéger">Douleur épaule</button>
          <button type="button" class="btn btn-xs" data-quick-prompt="Mes séances sont trop longues, passe-moi sur 45 min avec du Rest-Pause / Myo-Reps">Séances 45 min</button>
        </div>

        <form id="coach-chat-form" class="input-action-row">
          <input id="coach-input" class="input" type="text" required placeholder="Ex. Passe en PPL + Top Set / Back-off..." ${state.coachBusy ? 'disabled' : ''} />
          <button type="submit" class="btn btn-primary" ${state.coachBusy ? 'disabled' : ''}>Envoyer</button>
        </form>
      </section>
    `;

    const thread = document.getElementById('coach-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;

    document.getElementById('btn-coach-open-ai')?.addEventListener('click', () => {
      state.profilSubTab = 'ai';
      renderApp();
    });

    slot.querySelectorAll('[data-open-ai-settings]').forEach((b) => {
      b.addEventListener('click', () => {
        state.profilSubTab = 'ai';
        renderApp();
      });
    });

    document.getElementById('btn-clear-chat')?.addEventListener('click', async () => {
      await clearCoachMessages(state.profile.id);
      state.coachMessages = [];
      renderProfilSubTab(slot);
    });

    document.getElementById('btn-add-memory')?.addEventListener('click', async () => {
      const inp = document.getElementById('coach-memory-input');
      const noteText = inp?.value.trim();
      if (!noteText) return;
      const nextMem = [
        ...(state.profile.coachMemory || []),
        { id: generateId('mem'), category: 'user', text: noteText, createdAt: Date.now() },
      ].slice(-12);
      state.profile = await updateProfile(state.profile.id, { coachMemory: nextMem });
      renderProfilSubTab(slot);
      showToast('Repère mémorisé par le Coach.');
    });

    slot.querySelectorAll('[data-del-memory]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const memId = btn.dataset.delMemory;
        const nextMem = (state.profile.coachMemory || []).filter((m) => m.id !== memId);
        state.profile = await updateProfile(state.profile.id, { coachMemory: nextMem });
        renderProfilSubTab(slot);
      });
    });

    // Application 1-tap d'une adaptation proposée par le Coach (avec Toast Annuler 5s)
    slot.querySelectorAll('[data-apply-coach-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const msgId = btn.dataset.applyCoachAction;
        const msg = state.coachMessages.find((m) => m.id === msgId);
        if (!msg?.actionProposal || msg.actionApplied) return;

        const prevProfileSnapshot = structuredClone(state.profile);
        const prevProgramSnapshot = structuredClone(state.program);
        const { profilePatch = {}, programPhase } = msg.actionProposal;

        state.profile = await updateProfile(state.profile.id, profilePatch);
        const rebuilt = generateProgram(state.profile, {
          phase: programPhase || state.program?.phase || 'accumulation',
          mesocycleNumber: state.program?.mesocycleNumber || 1,
        });
        state.program = await saveProgram(state.profile.id, rebuilt);
        state.activeSession = null;
        state.selectedDayIdx = 0;

        msg.actionApplied = true;
        await updateCoachMessage(msg);
        state.coachMessages = await listCoachMessages(state.profile.id);
        renderApp();

        showToast(`Programme adapté : ${rebuilt.splitLabel} · ${rebuilt.methodLabel}`, {
          undoAction: async () => {
            state.profile = await updateProfile(state.profile.id, {
              splitPreference: prevProfileSnapshot.splitPreference,
              progressionMethod: prevProfileSnapshot.progressionMethod,
              sessionsPerWeek: prevProfileSnapshot.sessionsPerWeek,
              sessionDurationMin: prevProfileSnapshot.sessionDurationMin,
              goal: prevProfileSnapshot.goal,
              injuries: prevProfileSnapshot.injuries,
            });
            state.program = await saveProgram(state.profile.id, prevProgramSnapshot);
            state.activeSession = null;
            msg.actionApplied = false;
            await updateCoachMessage(msg);
            state.coachMessages = await listCoachMessages(state.profile.id);
            renderApp();
          },
        });
      });
    });

    const submitCoachQuestion = async (text) => {
      if (!text || state.coachBusy) return;
      state.coachBusy = true;

      const priorHistory = state.coachMessages.slice(-8).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Analyse déterministe immédiate des retours & souhaits (splits, méthodes, douleurs, durée, deload)
      const { actionProposal, memoryNote } = analyzeCoachFeedbackAndProposeAction(text, state.profile, state.program);
      if (memoryNote) {
        const existingMem = Array.isArray(state.profile.coachMemory) ? state.profile.coachMemory : [];
        if (!existingMem.some((m) => m.text === memoryNote.text)) {
          const nextMem = [
            ...existingMem,
            { id: generateId('mem'), ...memoryNote, createdAt: Date.now() },
          ].slice(-12);
          state.profile = await updateProfile(state.profile.id, { coachMemory: nextMem });
        }
      }

      await addCoachMessage(state.profile.id, { role: 'user', content: text });
      state.coachMessages = await listCoachMessages(state.profile.id);
      renderProfilSubTab(slot);

      const { ewma, adaptive, macros } = getDerivedTelemetry();
      const trainingSummary = buildCoachRuntimeContext(state.profile, state.program, state.workouts);
      const systemPrompt = `Tu es un préparateur physique certifié en biomécanique et nutritionniste sportif. Réponds en français clair, concret et pragmatique.
Contexte athlète : ${state.profile.name}, ${state.profile.sex}, ${state.profile.age} ans, ${state.profile.heightCm} cm, ${state.profile.weightKg} kg (EWMA ${ewma.latestEwmaKg ?? state.profile.weightKg} kg, tendance ${ewma.weeklyDeltaKg} kg/sem).
Objectif : ${state.profile.goal} · Split actif : ${trainingSummary.activeSplitLabel} · Méthode active : ${trainingSummary.activeMethodLabel}.
TDEE estimé : ${adaptive.estimatedTdeeKcal} kcal · Cible : ${macros.kcal} kcal (P ${macros.proteinG}g / G ${macros.carbsG}g / L ${macros.fatG}g).
Priorités LAG : ${(state.profile.lagPriorities || []).join(', ') || 'aucune'} · Douleurs profil : ${(state.profile.injuries || []).map((i) => `${i.zone}(sev ${i.severity})`).join(', ') || 'aucune'}.
Retours des 5 dernières séances (${trainingSummary.recentWorkoutsCount} enregistrées, Readiness moyen ${trainingSummary.readinessAvg ?? 'N/A'}/100) :
- Douleurs en séance : ${trainingSummary.painExercises.join(', ') || 'aucune'}
- Exercices en zone limite : ${trainingSummary.limitExercises.join(', ') || 'aucun'}
- Exercices faciles : ${trainingSummary.easyExercises.join(', ') || 'aucun'}
Mémoire persistante de l'athlète : ${trainingSummary.memoryItems.join(' | ') || 'aucune note'}.
Splits supportés dans l'appli : Full Body, Upper/Lower, PPL, Hybride UL+PPL, Arnold Split, Split classique.
Méthodes supportées dans l'appli : Double progression, Pyramidal inversé (RPT), Top Set + Back-off, Pyramidal montant, Rest-Pause / Myo-Reps, Ondulatoire DUP.${
        actionProposal
          ? `\nNote : Un bouton 1-clic va s'afficher sous ta réponse pour appliquer automatiquement : ${actionProposal.summary}. Mentionne brièvement l'intérêt biomécanique de cet ajustement.`
          : ''
      }`;

      try {
        const res = await routeAIRequest({
          taskType: 'coach_chat',
          prompt: text,
          systemPrompt,
          history: priorHistory,
          context: {
            profile: state.profile,
            program: state.program,
            trainingSummary,
            actionProposal,
          },
          settings: state.aiSettings,
          expectJson: false,
        });

        await addCoachMessage(state.profile.id, {
          role: 'assistant',
          content: typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
          tierUsed: res.tierUsed,
          provider: res.provider || null,
          fallbackReason: res.usedFallback ? res.fallbackReason : null,
          actionProposal: actionProposal || null,
          actionApplied: false,
        });
      } finally {
        state.coachBusy = false;
        state.coachMessages = await listCoachMessages(state.profile.id);
        renderProfilSubTab(slot);
      }
    };

    slot.querySelectorAll('[data-quick-prompt]').forEach((btn) => {
      btn.addEventListener('click', () => submitCoachQuestion(btn.dataset.quickPrompt));
    });

    document.getElementById('coach-chat-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('coach-input');
      const text = input.value.trim();
      input.value = '';
      await submitCoachQuestion(text);
    });
    return;
  }

  if (state.profilSubTab === 'profile') {
    const p = state.profile;
    slot.innerHTML = `
      <div class="grid-2">
        <section class="panel">
          <div class="panel-header">
            <h2>Profil Morpho-Anatomique & Objectifs</h2>
            <span class="panel-subtitle">Recalcul instantané macros + split</span>
          </div>
          <form id="profile-edit-form" class="stack">
            <div class="grid-2">
              <div class="field"><label class="field-label">Prénom</label><input id="pe-name" class="input" value="${esc(p.name)}" required /></div>
              <div class="field"><label class="field-label">Objectif principal</label>
                <select id="pe-goal" class="select">
                  ${Object.entries(GOAL_PROFILES)
                    .map(([k, v]) => `<option value="${k}" ${p.goal === k ? 'selected' : ''}>${esc(v.label)}</option>`)
                    .join('')}
                </select>
              </div>
            </div>
            <div class="grid-3">
              <div class="field"><label class="field-label">Poids (kg)</label><input id="pe-weight" class="input mono" type="number" step="0.1" value="${p.weightKg}" /></div>
              <div class="field"><label class="field-label">Taille (cm)</label><input id="pe-height" class="input mono" type="number" value="${p.heightCm}" /></div>
              <div class="field"><label class="field-label">Séances / sem</label><input id="pe-freq" class="input mono" type="number" min="2" max="6" value="${p.sessionsPerWeek}" /></div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label class="field-label" for="pe-split">Split d’entraînement</label>
                <select id="pe-split" class="select">
                  ${Object.values(TRAINING_SPLITS)
                    .map((sp) => `<option value="${sp.id}" ${(p.splitPreference || 'auto') === sp.id ? 'selected' : ''}>${esc(sp.label)}</option>`)
                    .join('')}
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="pe-method">Méthode de progression</label>
                <select id="pe-method" class="select">
                  ${Object.values(TRAINING_METHODS)
                    .map((m) => `<option value="${m.id}" ${(p.progressionMethod || 'double_progression') === m.id ? 'selected' : ''}>${esc(m.label)}</option>`)
                    .join('')}
                </select>
              </div>
            </div>
            <div class="grid-3">
              <div class="field"><label class="field-label">Fémurs / Buste</label>
                <select id="pe-femur" class="select">
                  <option value="balanced" ${p.morphology?.femurTorsoRatio === 'balanced' ? 'selected' : ''}>Équilibré</option>
                  <option value="long_femur" ${p.morphology?.femurTorsoRatio === 'long_femur' ? 'selected' : ''}>Fémurs longs</option>
                  <option value="short_femur" ${p.morphology?.femurTorsoRatio === 'short_femur' ? 'selected' : ''}>Fémurs courts</option>
                </select>
              </div>
              <div class="field"><label class="field-label">Envergure bras</label>
                <select id="pe-arms" class="select">
                  <option value="balanced" ${p.morphology?.armSpanRatio === 'balanced' ? 'selected' : ''}>Équilibrée</option>
                  <option value="long_arms" ${p.morphology?.armSpanRatio === 'long_arms' ? 'selected' : ''}>Bras longs</option>
                  <option value="short_arms" ${p.morphology?.armSpanRatio === 'short_arms' ? 'selected' : ''}>Bras courts</option>
                </select>
              </div>
              <div class="field"><label class="field-label">NEAT quotidien</label>
                <select id="pe-neat" class="select">
                  <option value="sedentary" ${p.lifestyle?.neatLevel === 'sedentary' ? 'selected' : ''}>Sédentaire</option>
                  <option value="mixed" ${p.lifestyle?.neatLevel === 'mixed' ? 'selected' : ''}>Mixte / Marche</option>
                  <option value="active" ${p.lifestyle?.neatLevel === 'active' ? 'selected' : ''}>Physique / Actif</option>
                </select>
              </div>
            </div>
            <div class="grid-3">
              <div class="field"><label class="field-label">Régime</label>
                <select id="pe-diet" class="select">
                  ${['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free']
                    .map((d) => `<option value="${d}" ${p.nutritionPrefs?.dietType === d ? 'selected' : ''}>${d}</option>`)
                    .join('')}
                </select>
              </div>
              <div class="field"><label class="field-label">Repas / jour</label>
                <input id="pe-meals" class="input mono" type="number" min="2" max="5" value="${p.nutritionPrefs?.mealsPerDay || 3}" />
              </div>
              <div class="field"><label class="field-label">Objectif pas/j</label>
                <input id="pe-steps" class="input mono" type="number" step="500" value="${p.lifestyle?.stepTarget || 8500}" />
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Enregistrer & Recalculer Programme + Macros</button>
          </form>
        </section>

        <section class="panel">
          <div class="panel-header">
            <h2>Gestionnaire Multi-Profils Locaux</h2>
            <button type="button" class="btn btn-sm btn-primary" id="btn-add-profile">+ Nouveau</button>
          </div>
          <div class="stack-sm">
            ${state.profiles
              .map(
                (pr) => `
              <div class="row-between panel-elevated" style="padding: 10px 12px;">
                <div class="stack-sm" style="gap:2px;">
                  <strong>${esc(pr.name)}</strong>
                  <span class="mono metric-sm text-secondary">${pr.weightKg} kg · ${esc(pr.goal)} · ${pr.sessionsPerWeek}j/sem</span>
                </div>
                <div class="row" style="gap:6px;">
                  <button type="button" class="btn btn-sm ${pr.id === p.id ? 'btn-primary' : ''}" data-switch-prof="${esc(pr.id)}">${pr.id === p.id ? 'Actif' : 'Basculer'}</button>
                  <button type="button" class="btn btn-sm btn-danger" data-delete-prof="${esc(pr.id)}">Suppr.</button>
                </div>
              </div>`
              )
              .join('')}
          </div>
        </section>
      </div>
    `;

    document.getElementById('profile-edit-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      state.profile = await updateProfile(p.id, {
        name: document.getElementById('pe-name').value.trim(),
        goal: document.getElementById('pe-goal').value,
        weightKg: Number(document.getElementById('pe-weight').value),
        heightCm: Number(document.getElementById('pe-height').value),
        sessionsPerWeek: Number(document.getElementById('pe-freq').value),
        splitPreference: document.getElementById('pe-split')?.value || 'auto',
        progressionMethod: document.getElementById('pe-method')?.value || 'double_progression',
        morphology: {
          femurTorsoRatio: document.getElementById('pe-femur').value,
          armSpanRatio: document.getElementById('pe-arms').value,
        },
        lifestyle: {
          neatLevel: document.getElementById('pe-neat').value,
          stepTarget: Number(document.getElementById('pe-steps').value),
        },
        nutritionPrefs: {
          dietType: document.getElementById('pe-diet').value,
          mealsPerDay: Number(document.getElementById('pe-meals').value),
        },
      });
      const rebuilt = generateProgram(state.profile, { phase: state.program?.phase || 'accumulation' });
      state.program = await saveProgram(state.profile.id, rebuilt);
      state.activeSession = null;
      state.selectedDayIdx = 0;
      renderApp();
      showToast(`Profil mis à jour : ${rebuilt.splitLabel} · ${rebuilt.methodLabel}.`);
    });

    document.getElementById('btn-add-profile')?.addEventListener('click', () => {
      state.profile = null;
      renderApp();
    });

    slot.querySelectorAll('[data-switch-prof]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await setActiveProfile(btn.dataset.switchProf);
        state.activeSession = null;
        await loadProfileWorkspace();
        renderApp();
        showToast(`Profil actif : ${state.profile.name}`);
      });
    });

    slot.querySelectorAll('[data-delete-prof]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await deleteProfile(btn.dataset.deleteProf);
        state.activeSession = null;
        await loadProfileWorkspace();
        renderApp();
        showToast('Profil supprimé d’IndexedDB.');
      });
    });
    return;
  }

  if (state.profilSubTab === 'ai') {
    const s = state.aiSettings;
    const preset = TIER2_PRESETS[s.tier2Preset] || TIER2_PRESETS.custom;
    const webCap = detectBrowserLlmCapability();
    const probe = state.lastProbeResult;

    slot.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Routeur IA & Clés API</h2>
            <p class="panel-subtitle" id="ai-autosave-status">Sauvegarde automatique locale (IndexedDB) · Aucune clé en dur.</p>
          </div>
          <span class="state-tag is-accent">NIV. ${s.activeTier}</span>
        </div>

        <div class="segmented-grid-2">
          <button type="button" class="segmented-btn ${s.activeTier === 0 ? 'is-active' : ''}" data-set-tier="0">0 · Local</button>
          <button type="button" class="segmented-btn ${s.activeTier === 1 ? 'is-active' : ''}" data-set-tier="1">1 · Gratuit</button>
          <button type="button" class="segmented-btn ${s.activeTier === 2 ? 'is-active' : ''}" data-set-tier="2">2 · Clé API / Local</button>
          <button type="button" class="segmented-btn ${s.activeTier === 3 ? 'is-active' : ''}" data-set-tier="3">3 · WebLLM</button>
        </div>

        ${
          s.activeTier === 0
            ? `
          <div class="panel-elevated stack-sm">
            <strong>Niveau 0 — 100 % Hors-Ligne (MediaPipe + Biomécanique)</strong>
            <span class="panel-subtitle">Zéro réseau, zéro clé API. Calculs biomécaniques, progression, Ciqual et landmarks MediaPipe en local.</span>
          </div>`
            : ''
        }

        ${
          s.activeTier === 1
            ? `
          <div class="panel-elevated stack-sm">
            <strong>Niveau 1 — Cloud Gratuit Sans Clé</strong>
            <div class="field">
              <label class="field-label" for="ai-t1-provider">Fournisseur gratuit</label>
              <select id="ai-t1-provider" class="select">
                <option value="puter" ${s.tier1Provider !== 'pollinations' ? 'selected' : ''}>Puter.js (défaut, avec repli Pollinations)</option>
                <option value="pollinations" ${s.tier1Provider === 'pollinations' ? 'selected' : ''}>Pollinations.ai direct (sans connexion Puter)</option>
              </select>
            </div>
            <label class="row" style="cursor: pointer;">
              <input type="checkbox" id="ai-allow-public-body" ${s.allowPublicBodyPhotos ? 'checked' : ''} />
              <span class="panel-subtitle">Autoriser l’envoi de photos corporelles sur Pollinations (bloqué par défaut)</span>
            </label>
            <span class="panel-subtitle">Astuce : si vous avez une clé Gemini, Groq, OpenRouter ou OpenAI, passez sur <strong>2 · Clé API</strong>.</span>
          </div>`
            : ''
        }

        ${
          s.activeTier === 2
            ? `
          <div class="stack">
            <div class="field">
              <label class="field-label" for="ai-preset-sel">Fournisseur (préréglage 1-clic)</label>
              <select id="ai-preset-sel" class="select">
                ${Object.values(TIER2_PRESETS)
                  .map((pr) => `<option value="${pr.id}" ${s.tier2Preset === pr.id ? 'selected' : ''}>${esc(pr.label)}</option>`)
                  .join('')}
              </select>
            </div>

            <div class="field">
              <label class="field-label" for="ai-key">
                <span>Clé API (auto-détectée au collage)</span>
                <span class="mono metric-xs ${s.apiKey ? 'text-ok' : 'text-muted'}">${s.apiKey ? 'Clé enregistrée' : preset.requiresApiKey ? 'Requise' : 'Optionnelle'}</span>
              </label>
              <div class="input-action-row">
                <input id="ai-key" class="input mono" type="${state.showApiKey ? 'text' : 'password'}" autocomplete="off" spellcheck="false" placeholder="Collez AIza... / gsk_... / sk-or-... / sk-..." value="${esc(s.apiKey)}" />
                <button type="button" class="btn btn-sm" id="btn-toggle-apikey">${state.showApiKey ? 'Masquer' : 'Voir'}</button>
              </div>
              ${
                isVertexExpressKey(s.apiKey)
                  ? `<div class="notice notice-danger" style="margin-top: 4px;">
                      <span><strong>Clé Vertex AI Express (AQ.) détectée :</strong> Google Cloud bloque souvent les appels directs depuis un navigateur mobile (CORS) sans serveur backend. Pour une appli 100 % locale, générez une clé gratuite <strong>Google AI Studio (AIza...)</strong> sur <strong>aistudio.google.com/apikey</strong> ou utilisez <strong>Groq (gsk_...)</strong>.</span>
                    </div>`
                  : ''
              }
            </div>

            <div class="field"><label class="field-label" for="ai-url">URL de base</label><input id="ai-url" class="input mono" value="${esc(s.baseUrl)}" /></div>
            <div class="grid-2">
              <div class="field"><label class="field-label" for="ai-mod">Modèle texte</label><input id="ai-mod" class="input mono" value="${esc(s.model)}" /></div>
              <div class="field"><label class="field-label" for="ai-vmod">Modèle vision</label><input id="ai-vmod" class="input mono" value="${esc(s.visionModel)}" /></div>
            </div>
            ${
              s.tier2Preset === 'groq'
                ? `<label class="row" style="cursor:pointer;"><input type="checkbox" id="ai-whisper" ${s.groqWhisperEnabled ? 'checked' : ''} /><span class="panel-subtitle">Activer Groq Whisper pour la dictée vocale en salle</span></label>`
                : ''
            }
            <div class="notice notice-accent"><span>${esc(preset.corsNote)}</span></div>
          </div>`
            : ''
        }

        ${
          s.activeTier === 3
            ? `
          <div class="stack">
            <div class="field">
              <label class="field-label">Modèle embarqué navigateur (WebGPU / WASM)</label>
              <select id="ai-t3-model" class="select">
                ${TIER3_MODELS.map((m) => `<option value="${esc(m.id)}" ${s.tier3ModelId === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
              </select>
            </div>
            ${
              webCap.warning
                ? `<div class="notice notice-danger"><span>${esc(webCap.warning)}</span></div>`
                : `<div class="notice notice-ok"><span>WebGPU détecté (${webCap.deviceMemoryGb || '?'} Go RAM).</span></div>`
            }
            <label class="row" style="cursor:pointer;">
              <input type="checkbox" id="ai-t3-accept" ${s.tier3AcceptedRamWarning ? 'checked' : ''} />
              <span class="panel-subtitle">Je comprends l’impact mémoire (0,9–1,5 Go) avant téléchargement.</span>
            </label>
          </div>`
            : ''
        }

        <div class="grid-2">
          <button type="button" class="btn btn-primary btn-block" id="btn-probe-ai">Tester la connexion maintenant</button>
          <button type="button" class="btn btn-block" id="btn-save-ai">Forcer l'enregistrement</button>
        </div>

        <div id="ai-probe-result">
          ${
            probe
              ? `<div class="probe-card ${probe.ok ? 'is-ok' : 'is-err'}">
                  <div class="row-between">
                    <span class="state-tag ${probe.ok ? 'is-ok' : 'is-danger'}">${probe.ok ? 'CONNEXION VALIDÉE' : 'ÉCHEC CONNEXION'}</span>
                    <span class="mono metric-xs">${probe.latencyMs ?? 0} ms · Vision ${probe.visionSupported ? 'OK' : 'Non'}</span>
                  </div>
                  <span class="mono metric-xs text-secondary">Moteur : ${esc(probe.provider || '')}</span>
                  <span style="font-size: 0.82rem;">${esc(probe.diagnostic || '')}</span>
                </div>`
              : `<div class="probe-card"><span class="panel-subtitle">Appuyez sur "Tester la connexion maintenant" pour vérifier votre clé et mesurer la latence réelle.</span></div>`
          }
        </div>
      </section>
    `;

    const persistCurrentAI = async ({ silent = false } = {}) => {
      if (s.activeTier === 1) {
        s.tier1Provider = document.getElementById('ai-t1-provider')?.value || 'puter';
        s.allowPublicBodyPhotos = Boolean(document.getElementById('ai-allow-public-body')?.checked);
      } else if (s.activeTier === 2) {
        s.baseUrl = (document.getElementById('ai-url')?.value || '').trim();
        s.model = (document.getElementById('ai-mod')?.value || '').trim();
        s.visionModel = (document.getElementById('ai-vmod')?.value || '').trim();
        s.apiKey = (document.getElementById('ai-key')?.value || '').replace(/[\r\n\t\s]+/g, '');
        s.groqWhisperEnabled = Boolean(document.getElementById('ai-whisper')?.checked);
      } else if (s.activeTier === 3) {
        s.tier3ModelId = document.getElementById('ai-t3-model')?.value || TIER3_MODELS[0].id;
        s.tier3AcceptedRamWarning = Boolean(document.getElementById('ai-t3-accept')?.checked);
      }
      state.aiSettings = await saveAISettings(state.profile.id, s);
      const statusEl = document.getElementById('ai-autosave-status');
      if (statusEl && silent) {
        statusEl.textContent = 'Enregistré automatiquement dans IndexedDB.';
      }
    };

    slot.querySelectorAll('[data-set-tier]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await persistCurrentAI({ silent: true });
        s.activeTier = Number(btn.dataset.setTier);
        state.lastProbeResult = null;
        state.aiSettings = await saveAISettings(state.profile.id, s);
        renderProfilSubTab(slot);
      });
    });

    document.getElementById('ai-t1-provider')?.addEventListener('change', () => persistCurrentAI({ silent: true }));
    document.getElementById('ai-allow-public-body')?.addEventListener('change', () => persistCurrentAI({ silent: true }));
    document.getElementById('ai-whisper')?.addEventListener('change', () => persistCurrentAI({ silent: true }));
    document.getElementById('ai-t3-model')?.addEventListener('change', () => persistCurrentAI({ silent: true }));
    document.getElementById('ai-t3-accept')?.addEventListener('change', () => persistCurrentAI({ silent: true }));

    document.getElementById('ai-preset-sel')?.addEventListener('change', async (e) => {
      const pr = TIER2_PRESETS[e.target.value];
      s.tier2Preset = pr.id;
      s.protocol = pr.protocol;
      s.baseUrl = pr.baseUrl;
      s.model = pr.model;
      s.visionModel = pr.visionModel;
      state.lastProbeResult = null;
      state.aiSettings = await saveAISettings(state.profile.id, s);
      renderProfilSubTab(slot);
    });

    // Auto-sauvegarde + auto-détection du fournisseur dès le collage d'une clé API
    const keyInput = document.getElementById('ai-key');
    keyInput?.addEventListener('input', async () => {
      const wasVertex = isVertexExpressKey(s.apiKey);
      const cleaned = keyInput.value.replace(/[\r\n\t\s]+/g, '');
      const nowVertex = isVertexExpressKey(cleaned);
      const detected = detectPresetFromApiKey(cleaned);
      s.apiKey = cleaned;
      if (detected && detected !== s.tier2Preset) {
        const pr = TIER2_PRESETS[detected];
        s.tier2Preset = pr.id;
        s.protocol = pr.protocol;
        s.baseUrl = pr.baseUrl;
        s.model = pr.model;
        s.visionModel = pr.visionModel;
        state.aiSettings = await saveAISettings(state.profile.id, s);
        renderProfilSubTab(slot);
        showToast(
          nowVertex
            ? 'Clé Vertex AI Express (AQ.) détectée — consultez l’avertissement CORS ci-dessous.'
            : `Clé ${pr.label} détectée — fournisseur et modèle configurés.`
        );
        return;
      }
      await persistCurrentAI({ silent: true });
      if (wasVertex !== nowVertex) {
        renderProfilSubTab(slot);
      }
    });

    ['ai-url', 'ai-mod', 'ai-vmod'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => persistCurrentAI({ silent: true }));
    });

    document.getElementById('btn-toggle-apikey')?.addEventListener('click', async () => {
      await persistCurrentAI({ silent: true });
      state.showApiKey = !state.showApiKey;
      renderProfilSubTab(slot);
    });

    document.getElementById('btn-save-ai')?.addEventListener('click', async () => {
      await persistCurrentAI({ silent: false });
      showToast('Paramètres IA enregistrés dans IndexedDB.');
    });

    document.getElementById('btn-probe-ai')?.addEventListener('click', async () => {
      await persistCurrentAI({ silent: true });
      const box = document.getElementById('ai-probe-result');
      box.innerHTML = `<div class="probe-card"><span class="mono metric-xs text-accent">Test de connexion en cours...</span></div>`;
      const res = await testAIConnection(state.aiSettings);
      state.lastProbeResult = res;
      renderProfilSubTab(slot);
    });
    return;
  }

  if (state.profilSubTab === 'p2p') {
    const bridge = getHealthBridgeTemplates();
    slot.innerHTML = `
      <div class="grid-2">
        <section class="panel">
          <div class="panel-header">
            <h2>Partage P2P Sans Serveur (LZ-String + QR)</h2>
          </div>
          <div class="row-wrap">
            <button type="button" class="btn btn-sm btn-primary" data-share-type="program">Partager Programme</button>
            <button type="button" class="btn btn-sm" data-share-type="stats_card">Partager Carte Streak</button>
            <button type="button" class="btn btn-sm" data-share-type="workout">Partager Dernière Séance</button>
          </div>
          <div id="p2p-qr-box" style="display:flex;justify-content:center;"></div>
          <div id="p2p-link-area" class="stack-sm"></div>
          <hr class="divider" />
          <div class="field">
            <label class="field-label">Importer un lien P2P reçu</label>
            <div class="input-action-row">
              <input id="p2p-import-input" class="input mono" placeholder="Coller URL #share=..." />
              <button type="button" class="btn btn-sm" id="btn-p2p-import">Importer</button>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <h2>Apple Santé / Health Connect & ntfy.sh</h2>
          </div>
          <div class="stack-sm">
            <span class="label-tech">Raccourci iOS (Apple Santé) — Ouvrir URL :</span>
            <pre class="code-box">${esc(bridge.iosShortcutUrl)}</pre>
            <span class="label-tech">MacroDroid Android (Health Connect) :</span>
            <pre class="code-box">${esc(bridge.androidMacroDroidUrl)}</pre>
          </div>
          <hr class="divider" />
          <div class="field">
            <label class="field-label">Canal privé ntfy.sh (rappels push gratuits, 0 clé)</label>
            <div class="input-action-row">
              <input id="ntfy-topic-input" class="input mono" placeholder="ex. kinetix-prive-8492" value="${esc(state.profile.ntfyTopic || '')}" />
              <button type="button" class="btn btn-sm btn-primary" id="btn-test-ntfy">Tester</button>
            </div>
          </div>
        </section>
      </div>
    `;

    slot.querySelectorAll('[data-share-type]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const type = btn.dataset.shareType;
        let payload = null;
        if (type === 'program') {
          payload = {
            splitLabel: state.program.splitLabel,
            goal: state.program.goal,
            days: state.program.days.map((d) => ({
              id: d.id,
              name: d.name,
              exercises: d.exercises.map((e) => ({
                exerciseId: e.exerciseId,
                name: e.name,
                sets: e.sets,
                repMin: e.repMin,
                repMax: e.repMax,
                restSec: e.restSec,
              })),
            })),
          };
        } else if (type === 'stats_card') {
          const { ewma, recent7d } = getDerivedTelemetry();
          payload = {
            athlete: state.profile.name,
            goal: state.profile.goal,
            sessions7d: recent7d,
            totalWorkouts: state.workouts.length,
            ewmaDeltaKg: ewma.weeklyDeltaKg,
          };
        } else {
          payload = state.workouts[0] || { note: 'Aucune séance enregistrée' };
        }

        const encoded = await encodeSharePayload({ type, payload, senderName: state.profile.name });
        await renderLocalQRCode(document.getElementById('p2p-qr-box'), encoded.url);
        document.getElementById('p2p-link-area').innerHTML = `
          <span class="mono metric-sm text-secondary">Compressé : ${encoded.compressedBytes} octets (ratio ${encoded.compressionRatio})</span>
          <div class="row">
            <input class="input mono" readonly value="${esc(encoded.url)}" id="p2p-generated-url" />
            <button type="button" class="btn btn-sm btn-primary" id="btn-copy-p2p">Copier</button>
          </div>
        `;
        document.getElementById('btn-copy-p2p')?.addEventListener('click', async () => {
          await navigator.clipboard?.writeText(encoded.url);
          showToast('Lien P2P compressé copié.');
        });
      });
    });

    document.getElementById('btn-p2p-import')?.addEventListener('click', async () => {
      try {
        const decoded = await decodeShareTokenOrUrl(document.getElementById('p2p-import-input').value);
        handleIncomingShareModal(decoded);
      } catch (err) {
        showToast(err.message);
      }
    });

    document.getElementById('btn-test-ntfy')?.addEventListener('click', async () => {
      const topic = document.getElementById('ntfy-topic-input').value.trim();
      try {
        await updateProfile(state.profile.id, { ntfyTopic: topic });
        state.profile.ntfyTopic = topic;
        await sendNtfyNotification({
          topic,
          title: 'Kinetix Lab — Test Push',
          message: `Rappel actif pour ${state.profile.name} (Hydratation, Séance & Check-in 15j).`,
        });
        showToast(`Notification envoyée sur ntfy.sh/${topic}.`);
      } catch (err) {
        showToast(err.message);
      }
    });
    return;
  }

  // Onglet Backup JSON + Chiffrement AES-256-GCM GitHub Privé
  slot.innerHTML = `
    <div class="grid-2">
      <section class="panel">
        <div class="panel-header">
          <h2>Sauvegarde Locale JSON</h2>
          <span class="mono metric-sm text-secondary">${state.storageInfo?.persisted ? 'Persistant' : 'Standard'}</span>
        </div>
        <p class="panel-subtitle">
          Exporte tous les profils, séances, biométries, nutrition et photos compressées (Base64) dans un fichier unique.
        </p>
        <div class="row-wrap">
          <button type="button" class="btn btn-primary" id="btn-do-export">Exporter JSON complet</button>
          <label class="btn" style="cursor: pointer;">
            Importer JSON
            <input id="input-import-json" type="file" accept="application/json" hidden />
          </label>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Sync GitHub Privé Chiffrée AES-256-GCM</h2>
        </div>
        <div class="grid-2">
          <div class="field"><label class="field-label">Owner GitHub</label><input id="gh-owner" class="input mono" placeholder="utilisateur" /></div>
          <div class="field"><label class="field-label">Dépôt privé</label><input id="gh-repo" class="input mono" placeholder="kinetix-vault" /></div>
        </div>
        <div class="grid-2">
          <div class="field"><label class="field-label">Token PAT (repo contents)</label><input id="gh-token" class="input mono" type="password" autocomplete="off" /></div>
          <div class="field"><label class="field-label">Phrase secrète AES-256 (≥ 8 car.)</label><input id="gh-pass" class="input mono" type="password" autocomplete="off" /></div>
        </div>
        <div class="row-wrap">
          <button type="button" class="btn btn-primary" id="btn-gh-push">Chiffrer & Envoyer</button>
          <button type="button" class="btn" id="btn-gh-pull">Télécharger & Déchiffrer</button>
        </div>
      </section>
    </div>
  `;

  document.getElementById('btn-do-export')?.addEventListener('click', async () => {
    const data = await exportAllData({ includePhotos: true });
    triggerJsonDownload(data);
    showToast('Sauvegarde JSON complète téléchargée.');
  });

  document.getElementById('input-import-json')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importAllData(text, { replaceAll: false });
      await loadProfileWorkspace();
      renderApp();
      showToast('Sauvegarde JSON importée avec succès.');
    } catch (err) {
      showToast(err.message);
    }
  });

  const readGh = () => ({
    owner: document.getElementById('gh-owner').value.trim(),
    repo: document.getElementById('gh-repo').value.trim(),
    token: document.getElementById('gh-token').value.trim(),
    passphrase: document.getElementById('gh-pass').value,
  });

  document.getElementById('btn-gh-push')?.addEventListener('click', async () => {
    try {
      const res = await pushEncryptedBackupToGitHub(readGh());
      showToast(`Backup AES-256-GCM envoyé sur GitHub (${Math.round(res.sizeBytes / 1024)} Ko).`);
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById('btn-gh-pull')?.addEventListener('click', async () => {
    try {
      await pullEncryptedBackupFromGitHub(readGh());
      await loadProfileWorkspace();
      renderApp();
      showToast('Backup AES-256-GCM restauré depuis GitHub.');
    } catch (err) {
      showToast(err.message);
    }
  });
}

/* ==========================================================================
   IMPORT P2P ENTRANT & NAVIGATION
   ========================================================================== */

function handleIncomingShareModal(decoded) {
  if (!decoded) return;
  openModal(
    `Partage P2P reçu de ${decoded.senderName}`,
    `<p class="panel-subtitle">Type : <strong>${esc(decoded.type)}</strong> · Date : ${esc((decoded.createdAt || '').slice(0, 10))}</p>
     <pre class="code-box">${esc(JSON.stringify(decoded.payload, null, 2))}</pre>
     ${decoded.type === 'program' && state.profile ? `<button type="button" class="btn btn-primary btn-block" id="btn-accept-shared-program">Importer ce programme</button>` : ''}`,
    ({ close }) => {
      document.getElementById('btn-accept-shared-program')?.addEventListener('click', async () => {
        const importedProg = {
          ...state.program,
          id: generateId('prog'),
          splitLabel: `${decoded.payload.splitLabel || 'Split'} (P2P ${decoded.senderName})`,
          days: (decoded.payload.days || []).map((d) => ({
            ...d,
            exercises: (d.exercises || []).map((e) => ({
              slotId: generateId('slot'),
              suggestedLoadKg: 20,
              targetRir: 2,
              incrementKg: getExerciseById(e.exerciseId)?.incrementKg || 2.5,
              primaryMuscles: getExerciseById(e.exerciseId)?.primaryMuscles || [],
              category: getExerciseById(e.exerciseId)?.category || 'compound',
              ...e,
            })),
          })),
        };
        state.program = await saveProgram(state.profile.id, importedProg);
        state.activeSession = null;
        clearShareHash();
        close();
        renderApp();
        showToast(`Programme de ${decoded.senderName} importé.`);
      });
    }
  );
}

function navigateTo(route) {
  if (state.cameraController) state.cameraController.stop();
  if (state.barcodeScanner) state.barcodeScanner.stop();
  destroyActiveCharts();
  state.route = route;
  window.scrollTo({ top: 0, behavior: 'instant' });
  renderApp();
}

function syncNavUI() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.nav === state.route);
  });
}

function renderApp() {
  const view = document.getElementById('app-view');
  if (!view) return;
  syncNavUI();

  if (!state.profile) {
    renderOnboarding(view);
    return;
  }

  document.getElementById('bottom-nav')?.removeAttribute('hidden');

  switch (state.route) {
    case 'seance':
      renderSeance(view);
      break;
    case 'nutrition':
      renderNutrition(view);
      break;
    case 'labo':
      renderLabo(view);
      break;
    case 'profil':
      renderProfil(view);
      break;
    case 'cockpit':
    default:
      renderCockpit(view);
      break;
  }
}

/* ==========================================================================
   INITIALISATION & ÉVÉNEMENTS PWA / SYSTÈME
   ========================================================================== */

function updateSystemBanners() {
  const wrap = document.getElementById('system-banners');
  const off = document.getElementById('banner-offline');
  const ios = document.getElementById('banner-ios-install');
  const bkp = document.getElementById('banner-backup-reminder');
  if (!wrap) return;

  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  off.hidden = !isOffline;
  ios.hidden = !state.storageInfo?.needsIOSInstallBanner;
  bkp.hidden = !state.storageInfo?.backupReminderDue || !state.profile;
  wrap.hidden = off.hidden && ios.hidden && bkp.hidden;
}

function isStandaloneMode() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    window.navigator?.standalone === true
  );
}

function openInstallPWAModal() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const isAndroid = /Android/i.test(ua);

  const stepsHtml = isIOS
    ? `
      <div class="install-step">
        <span class="install-step-num">1</span>
        <div><strong>Ouvrez dans Safari</strong><p class="panel-subtitle">L'installation sur écran d'accueil iOS fonctionne depuis Safari.</p></div>
      </div>
      <div class="install-step">
        <span class="install-step-num">2</span>
        <div><strong>Appuyez sur Partager</strong><p class="panel-subtitle">Icône carré avec flèche vers le haut en bas de l'écran Safari.</p></div>
      </div>
      <div class="install-step">
        <span class="install-step-num">3</span>
        <div><strong>Sur l'écran d'accueil → Ajouter</strong><p class="panel-subtitle">Protège aussi vos données locales contre la purge WebKit 7 jours.</p></div>
      </div>`
    : isAndroid
      ? `
      <div class="install-step">
        <span class="install-step-num">1</span>
        <div><strong>Ouvrez le menu du navigateur (⋮)</strong><p class="panel-subtitle">En haut à droite de Chrome, Edge, Brave ou Samsung Internet.</p></div>
      </div>
      <div class="install-step">
        <span class="install-step-num">2</span>
        <div><strong>Appuyez sur « Installer l’application »</strong><p class="panel-subtitle">Ou « Ajouter à l’écran d’accueil » selon votre navigateur.</p></div>
      </div>
      <div class="install-step">
        <span class="install-step-num">3</span>
        <div><strong>Lancez Kinetix Lab en plein écran</strong><p class="panel-subtitle">Fonctionne ensuite 100 % hors-ligne même sans réseau en salle.</p></div>
      </div>`
      : `
      <div class="install-step">
        <span class="install-step-num">1</span>
        <div><strong>Icône d’installation dans la barre d’adresse</strong><p class="panel-subtitle">Sur Chrome / Edge, cliquez sur l’icône d’installation à droite de l’URL.</p></div>
      </div>
      <div class="install-step">
        <span class="install-step-num">2</span>
        <div><strong>Ou via le menu du navigateur (⋮)</strong><p class="panel-subtitle">Choisissez « Installer Kinetix Lab » pour un lancement autonome hors-ligne.</p></div>
      </div>`;

  openModal(
    'Installer Kinetix Lab',
    `<p class="panel-subtitle">Installez l’application sur votre écran d’accueil pour l’utiliser en plein écran et 100 % hors-ligne.</p>
     <div class="stack-sm">${stepsHtml}</div>
     <div class="notice notice-ok"><span>Toutes vos données (profils, séances, nutrition, clés API) restent stockées localement sur votre téléphone.</span></div>`
  );
}

async function boot() {
  await openDB();
  state.storageInfo = await initStoragePersistence();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // PWA Install Button : toujours visible hors mode standalone + prompt natif ou guide mobile
  const installBtn = document.getElementById('btn-install-pwa');
  if (installBtn) {
    installBtn.hidden = isStandaloneMode();
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    if (installBtn && !isStandaloneMode()) installBtn.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    if (installBtn) installBtn.hidden = true;
    showToast('Kinetix Lab installé sur votre appareil.');
  });

  installBtn?.addEventListener('click', async () => {
    if (state.deferredInstallPrompt) {
      try {
        await state.deferredInstallPrompt.prompt();
        const choice = await state.deferredInstallPrompt.userChoice;
        state.deferredInstallPrompt = null;
        if (choice?.outcome === 'accepted') {
          installBtn.hidden = true;
          showToast('Installation lancée.');
        }
        return;
      } catch {
        state.deferredInstallPrompt = null;
      }
    }
    openInstallPWAModal();
  });

  document.getElementById('btn-profile-quick')?.addEventListener('click', () => navigateTo('profil'));
  document.getElementById('brand-home-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo('cockpit');
  });

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.nav));
  });

  // Contrôles Chrono sticky
  document.querySelectorAll('[data-timer-delta]').forEach((btn) => {
    btn.addEventListener('click', () => restTimer.addSeconds(Number(btn.dataset.timerDelta)));
  });
  document.getElementById('btn-timer-stop')?.addEventListener('click', () => restTimer.stop());

  // Bandeaux système
  document.getElementById('btn-dismiss-ios-banner')?.addEventListener('click', () => {
    if (state.storageInfo) state.storageInfo.needsIOSInstallBanner = false;
    updateSystemBanners();
  });
  document.getElementById('btn-quick-backup')?.addEventListener('click', async () => {
    const payload = await exportAllData({ includePhotos: true });
    triggerJsonDownload(payload);
    if (state.storageInfo) state.storageInfo.backupReminderDue = false;
    updateSystemBanners();
    showToast('Sauvegarde JSON exportée.');
  });

  window.addEventListener('online', updateSystemBanners);
  window.addEventListener('offline', updateSystemBanners);

  // Hash shortcut initial (#seance, #nutrition, #labo, #share=...)
  const initialHash = window.location.hash || '';
  if (['#cockpit', '#seance', '#nutrition', '#labo', '#profil'].includes(initialHash)) {
    state.route = initialHash.slice(1);
  }

  await loadProfileWorkspace();
  updateSystemBanners();
  renderApp();

  const incomingShare = await parseIncomingShareHash();
  if (incomingShare) {
    handleIncomingShareModal(incomingShare);
  }
}

boot();
