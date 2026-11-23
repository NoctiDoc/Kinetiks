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
  resetBiometricsBaseline,
  restoreBiometricsForProfile,
  listNutritionLogs,
  saveNutritionLog,
  deleteNutritionLog,
  listFavorites,
  saveFavorite,
  deleteFavorite,
  listCustomFoods,
  saveCustomFood,
  deleteCustomFood,
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
  normalizeGeminiBaseUrl,
  detectPresetFromApiKey,
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
  searchHybridLocalFoods,
  scaleFoodMacros,
  lookupBarcodeOpenFoodFacts,
  searchOpenFoodFactsText,
  estimateFoodMacrosWithAI,
  BarcodeScannerController,
  computeUSNavyBodyFat,
  computeWHtR,
  computeEWMASeries,
  computeAdaptiveTDEE,
  calculateMacroTargets,
  computeCoherentMacrosForCalories,
  clampAdaptiveAdjustmentKcal,
  sanitizeStoredAdaptiveAdjustmentKcal,
  analyzeMealPhoto,
  extractScaleMetricsOCR,
  generateMealPlanAndShoppingList,
} from './nutrition-db.js';

import {
  ADVISOR_SHORTCUTS,
  getActiveSmoothingAdjustment,
  computeNutritionClinicalReport,
  buildEndOfDayRecalibration,
  buildPersonalizedFoodMatrix,
  buildPeriWorkoutGuide,
  askNutritionAdvisor,
} from './nutrition-advisor.js';

import {
  buildAgenticCoachSystemPrompt,
  parseCoachActionsResponse,
  parseTier0DeterministicActions,
  executeCoachActions,
} from './coach-actions.js';

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
  customFoods: [],
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
  nutritionSubTab: 'journal', // 'journal' | 'advisor' | 'plan'
  nutritionInputMode: 'ciqual', // 'ciqual' | 'photo' | 'barcode'
  ciqualQuery: '',
  foodSearchGrams: 150,
  offResults: [],
  offLiveResults: [],
  offLiveQuery: '',
  offLiveLoading: false,
  offLiveOffline: false,
  offSearchAbort: null,
  foodLocalTimer: null,
  foodOffTimer: null,
  aiAutosaveTimer: null,
  lastMealVisionResult: null,
  barcodeScanner: null,
  advisorDayMode: 'auto', // 'auto' | 'training' | 'rest'
  advisorMatrixTab: 'prioritize', // 'prioritize' | 'moderate' | 'avoid'
  advisorRecalibrationOpen: false,
  advisorMessages: [],
  advisorBusy: false,

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

/**
 * Parseur Markdown léger et 100 % protégé XSS :
 * échappe d'abord tout HTML brut, puis convertit **gras**, *italique*,
 * `code`, listes à puces (- / * / •) / numérotées et sauts de ligne.
 */
function formatInlineMarkdown(escapedLine) {
  return escapedLine
    .replace(/`([^`\n]+)`/g, '<code class="mono">$1</code>')
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s([{"'«])\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*(?=[\s)\]}.,;:!?"'»]|$)/g, '$1<em>$2</em>');
}

function renderCoachMarkdown(rawText) {
  const escaped = esc(String(rawText ?? '').replace(/\r\n/g, '\n')).trim();
  if (!escaped) return '';

  const lines = escaped.split('\n');
  const blocks = [];
  let paragraphLines = [];
  let listType = null; // 'ul' | 'ol'
  let listItems = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push(`<p>${paragraphLines.map(formatInlineMarkdown).join('<br>')}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    blocks.push(
      `<${listType} class="coach-md-list">${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</${listType}>`
    );
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push(`<p class="coach-md-heading"><strong>${formatInlineMarkdown(headingMatch[1])}</strong></p>`);
      continue;
    }

    const ulMatch = line.match(/^(?:[-*•])\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(ulMatch[1]);
      continue;
    }

    const olMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(olMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.join('');
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
    customFoods,
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
    listCustomFoods(pid),
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
  state.customFoods = customFoods;
  state.hydration = hydration;
  state.photos = photos;
  state.coachMessages = coachMsgs;
  state.shoppingList = shopping;

  // Auto-réparation au chargement si un ancien profil contenait un ajustement aberrant (< -400 ou > +400)
  const rawSavedAdj =
    state.profile?.nutritionPrefs?.adaptiveAdjustmentKcal ??
    state.profile?.nutritionPrefs?.manualKcalOffset ??
    0;
  const sanitizedAdj = sanitizeStoredAdaptiveAdjustmentKcal(rawSavedAdj);
  state.manualKcalOffset = sanitizedAdj.value;
  if (sanitizedAdj.wasCorrupted) {
    state.profile = await updateProfile(pid, {
      nutritionPrefs: {
        adaptiveAdjustmentKcal: 0,
        manualKcalOffset: 0,
      },
    });
    showToast(`Ajustement EWMA hors-bornes (${sanitizedAdj.previousValue} kcal) réinitialisé à 0 kcal.`);
  }

  state.advisorDayMode = 'auto';
  state.advisorRecalibrationOpen = false;
  state.advisorMessages = [];
  state.advisorBusy = false;

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
  const baselineDate = state.profile?.nutritionPrefs?.ewmaBaselineDate || null;
  const ewma = computeEWMASeries(state.biometrics, 0.2, { baselineDate });
  const latestBio = state.biometrics[state.biometrics.length - 1] || null;
  const knownBf = latestBio?.bodyFatPct ?? latestBio?.navyBodyFatPct ?? null;
  const adaptive = computeAdaptiveTDEE({
    biometrics: state.biometrics,
    nutritionLogs: state.nutritionAll,
    profile: state.profile,
    bodyFatPct: knownBf,
  });
  const smoothing = getActiveSmoothingAdjustment(state.profile, getTodayISO());
  const clampedAdaptiveAdj = clampAdaptiveAdjustmentKcal(state.manualKcalOffset);
  const macros = calculateMacroTargets(state.profile, {
    bodyFatPct: knownBf,
    adaptiveTdeeKcal: adaptive.adaptiveActive ? adaptive.estimatedTdeeKcal : null,
    adaptiveAdjustmentKcal: clampedAdaptiveAdj,
    smoothingDeltaKcal: smoothing?.effectiveTodayDeltaKcal || 0,
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

  return { ewma, latestBio, knownBf, adaptive, macros, consumed, smoothing, recent7d, deloadStatus };
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
            <span id="rd-summary-text" class="panel-subtitle">${esc(readiness.summary)}</span>
          </div>
          <div class="row" style="gap: 8px; flex-shrink: 0;">
            <span id="rd-score-badge" class="metric-lg ${readiness.recommendPreservation ? 'text-danger' : 'text-accent'}">${readiness.score}/100</span>
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
              <label class="field-label" for="rd-sleep"><span>Sommeil</span><span id="rd-sleep-val" class="mono">${state.readinessDraft.sleep}/5</span></label>
              <input id="rd-sleep" class="range-tech" type="range" min="1" max="5" value="${state.readinessDraft.sleep}" />
            </div>
            <div class="field">
              <label class="field-label" for="rd-soreness"><span>Confort articulaire</span><span id="rd-soreness-val" class="mono">${state.readinessDraft.soreness}/5</span></label>
              <input id="rd-soreness" class="range-tech" type="range" min="1" max="5" value="${state.readinessDraft.soreness}" />
            </div>
            <div class="field">
              <label class="field-label" for="rd-energy"><span>Énergie</span><span id="rd-energy-val" class="mono">${state.readinessDraft.energy}/5</span></label>
              <input id="rd-energy" class="range-tech" type="range" min="1" max="5" value="${state.readinessDraft.energy}" />
            </div>
          </div>`
            : ''
        }

        <div id="rd-preservation-slot">
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
        </div>
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

  const bindPreservationBtn = () => {
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
  };
  bindPreservationBtn();

  // Mise à jour chirurgicale in-place sur les sliders Readiness (zéro re-render global)
  ['sleep', 'soreness', 'energy'].forEach((k) => {
    document.getElementById(`rd-${k}`)?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      state.readinessDraft[k] = val;
      const valEl = document.getElementById(`rd-${k}-val`);
      if (valEl) valEl.textContent = `${val}/5`;
      const liveReadiness = evaluateReadiness(state.readinessDraft);
      const badgeEl = document.getElementById('rd-score-badge');
      if (badgeEl) {
        badgeEl.textContent = `${liveReadiness.score}/100`;
        badgeEl.className = `metric-lg ${liveReadiness.recommendPreservation ? 'text-danger' : 'text-accent'}`;
      }
      const summaryEl = document.getElementById('rd-summary-text');
      if (summaryEl) summaryEl.textContent = liveReadiness.summary;
      const presSlot = document.getElementById('rd-preservation-slot');
      if (presSlot && !session.preservationMode) {
        presSlot.innerHTML = liveReadiness.recommendPreservation
          ? `<div class="notice notice-danger">
              <span>Readiness bas : activez le Mode Préservation (-1 série, +1 RIR).</span>
              <button type="button" class="btn btn-sm btn-danger" id="btn-apply-preservation">Activer</button>
            </div>`
          : '';
        bindPreservationBtn();
      }
    });
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
  const telemetry = getDerivedTelemetry();
  const { adaptive, macros, consumed, smoothing } = telemetry;
  const remKcal = Math.max(0, macros.kcal - consumed.kcal);
  const surplusKcal = Math.max(0, consumed.kcal - macros.kcal);
  const remP = Math.max(0, Math.round(macros.proteinG - consumed.proteinG));
  const remC = Math.max(0, Math.round(macros.carbsG - consumed.carbsG));
  const remF = Math.max(0, Math.round(macros.fatG - consumed.fatG));

  // Compatibilité si une ancienne vue pointait vers ciqual/photo/barcode
  if (['ciqual', 'photo', 'barcode'].includes(state.nutritionSubTab)) {
    state.nutritionInputMode = state.nutritionSubTab;
    state.nutritionSubTab = 'journal';
  }

  container.innerHTML = `
    <section class="stack">
      <div class="row-between">
        <div>
          <h1>Nutrition auto-adaptative</h1>
          <p class="panel-subtitle">
            ${esc(macros.formula)} · TDEE ${macros.tdeeKcal} kcal${
              macros.isOverride
                ? ` · Mode ${macros.overrideSource === 'coach' ? 'Coach IA' : 'Manuel'}${macros.overrideLocked ? ' (verrouillé)' : ''}`
                : state.manualKcalOffset
                  ? ` · Ajust. ${state.manualKcalOffset > 0 ? '+' : ''}${state.manualKcalOffset} kcal`
                  : ''
            }${smoothing?.appliesToday && !macros.isOverride ? ` · Lissage ${smoothing.effectiveTodayDeltaKcal} kcal` : ''}
          </p>
        </div>
        <span class="mono metric-lg ${surplusKcal >= 220 ? 'text-danger' : 'text-accent'}">
          ${surplusKcal > 0 ? `+${surplusKcal} kcal` : `${remKcal} kcal`}
        </span>
      </div>

      <div class="kpi-strip">
        <div class="kpi-cell">
          <span class="kpi-label">Calories</span>
          <span class="kpi-value">${consumed.kcal}</span>
          <span class="kpi-delta">Cible ${macros.kcal} · ${surplusKcal > 0 ? `Surplus +${surplusKcal}` : `Reste ${remKcal}`}</span>
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

      <!-- Contrôle manuel direct & réinitialisation EWMA -->
      <details class="panel-elevated nut-override-details">
        <summary class="nut-override-summary">
          <span>Ajuster mes cibles / Réinitialiser</span>
          <span class="mono metric-xs ${macros.isOverride ? 'text-accent' : 'text-muted'}">
            ${macros.isOverride ? (macros.overrideSource === 'coach' ? 'COACH IA' : 'MANUEL') : `AUTO · AJUST ${macros.adaptiveAdjustmentKcal >= 0 ? '+' : ''}${macros.adaptiveAdjustmentKcal} KCAL`}
          </span>
        </summary>
        <div class="stack-sm" style="margin-top: 10px;">
          <form id="nut-override-form" class="stack-sm">
            <div class="nut-override-grid">
              <label class="field">
                <span class="field-label">Calories (kcal)</span>
                <input id="nut-ov-kcal" class="input mono" type="number" min="1200" max="6000" step="10" value="${macros.kcal}" required />
              </label>
              <label class="field">
                <span class="field-label">Protéines (g)</span>
                <input id="nut-ov-prot" class="input mono" type="number" min="60" max="300" step="1" value="${macros.proteinG}" required />
              </label>
              <label class="field">
                <span class="field-label">Glucides (g)</span>
                <input id="nut-ov-carbs" class="input mono" type="number" min="0" max="800" step="1" value="${macros.carbsG}" required />
              </label>
              <label class="field">
                <span class="field-label">Lipides (g)</span>
                <input id="nut-ov-fat" class="input mono" type="number" min="35" max="200" step="1" value="${macros.fatG}" required />
              </label>
              <label class="field">
                <span class="field-label">Eau (ml/j)</span>
                <input id="nut-ov-water" class="input mono" type="number" min="1500" max="5500" step="50" value="${macros.waterTargetMl}" required />
              </label>
            </div>
            <label class="row" style="gap: 8px; font-size: 0.78rem; color: var(--text-secondary); cursor: pointer;">
              <input id="nut-ov-lock" type="checkbox" ${macros.isOverride ? (macros.overrideLocked ? 'checked' : '') : 'checked'} />
              <span>Verrouiller ces cibles (empêcher l’ajustement EWMA automatique de les écraser)</span>
            </label>
            <div class="row-wrap" style="gap: 6px;">
              <button type="submit" class="btn btn-sm btn-primary">Enregistrer mes cibles</button>
              <button type="button" class="btn btn-sm" id="btn-reset-ewma-adj">Réinitialiser ajustement EWMA (0 kcal)</button>
              <button type="button" class="btn btn-sm btn-danger" id="btn-reset-ewma-zero">Repartir à zéro pour l’EWMA (à partir d’aujourd’hui)</button>
            </div>
          </form>
          <p class="panel-subtitle mono" style="font-size: 0.72rem;">
            Plancher calorique sûr : ${macros.safeFloorKcal} kcal (max(1500, 85 % BMR)) · Ajustement adaptatif borné [-400, +400 kcal].
          </p>
        </div>
      </details>

      ${
        adaptive.adjustmentProposal && !macros.overrideLocked
          ? `
        <div class="notice notice-accent">
          <span><strong>TDEE Adaptatif :</strong> ${esc(adaptive.adjustmentProposal.reason)}</span>
          <button type="button" class="btn btn-sm btn-primary" id="btn-apply-tdee-adj">
            Appliquer (${adaptive.adjustmentProposal.deltaKcal > 0 ? '+' : ''}${adaptive.adjustmentProposal.deltaKcal} kcal)
          </button>
        </div>`
          : ''
      }

      <!-- Sous-navigation propre 3 vues (1 tap, zéro surcharge mobile) -->
      <div class="segmented" role="tablist" aria-label="Vues Nutrition">
        <button type="button" class="segmented-btn ${state.nutritionSubTab === 'journal' ? 'is-active' : ''}" data-nut-tab="journal">Journal</button>
        <button type="button" class="segmented-btn ${state.nutritionSubTab === 'advisor' ? 'is-active' : ''}" data-nut-tab="advisor">Conseiller Pro</button>
        <button type="button" class="segmented-btn ${state.nutritionSubTab === 'plan' ? 'is-active' : ''}" data-nut-tab="plan">Courses & Plans</button>
      </div>

      <div id="nutrition-subview"></div>
    </section>
  `;

  document.getElementById('nut-override-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kcal = Math.round(Number(document.getElementById('nut-ov-kcal')?.value) || macros.kcal);
    const proteinG = Math.round(Number(document.getElementById('nut-ov-prot')?.value) || macros.proteinG);
    const carbsG = Math.round(Number(document.getElementById('nut-ov-carbs')?.value) || macros.carbsG);
    const fatG = Math.round(Number(document.getElementById('nut-ov-fat')?.value) || macros.fatG);
    const waterTargetMl = Math.round((Number(document.getElementById('nut-ov-water')?.value) || macros.waterTargetMl) / 50) * 50;
    const locked = Boolean(document.getElementById('nut-ov-lock')?.checked);

    const coherent = computeCoherentMacrosForCalories(kcal, {
      leanMassKg: macros.leanMassKg,
      goal: state.profile.goal,
      proteinOverride: proteinG,
      fatOverride: fatG,
      carbsOverride: carbsG,
    });

    const prevPrefs = structuredClone(state.profile.nutritionPrefs || {});
    state.manualKcalOffset = 0;
    state.profile = await updateProfile(state.profile.id, {
      nutritionPrefs: {
        adaptiveAdjustmentKcal: 0,
        manualKcalOffset: 0,
        smoothingPlan: null,
        nutritionOverride: {
          enabled: true,
          locked,
          source: 'manual',
          kcal: coherent.kcal,
          proteinG: coherent.proteinG,
          carbsG: coherent.carbsG,
          fatG: coherent.fatG,
          waterTargetMl,
          updatedAt: Date.now(),
        },
      },
    });
    renderApp();
    showToast(`Cibles enregistrées : ${coherent.kcal} kcal (P ${coherent.proteinG}g · G ${coherent.carbsG}g · L ${coherent.fatG}g).`, {
      undoAction: async () => {
        state.profile = await updateProfile(state.profile.id, { nutritionPrefs: prevPrefs });
        state.manualKcalOffset = clampAdaptiveAdjustmentKcal(prevPrefs.adaptiveAdjustmentKcal ?? prevPrefs.manualKcalOffset ?? 0);
        renderApp();
      },
    });
  });

  document.getElementById('btn-reset-ewma-adj')?.addEventListener('click', async () => {
    const prevPrefs = structuredClone(state.profile.nutritionPrefs || {});
    state.manualKcalOffset = 0;
    state.profile = await updateProfile(state.profile.id, {
      nutritionPrefs: {
        nutritionOverride: null,
        adaptiveAdjustmentKcal: 0,
        manualKcalOffset: 0,
        smoothingPlan: null,
      },
    });
    renderApp();
    showToast('Ajustement EWMA remis à 0 kcal et cibles recalculées depuis le TDEE.', {
      undoAction: async () => {
        state.profile = await updateProfile(state.profile.id, { nutritionPrefs: prevPrefs });
        state.manualKcalOffset = clampAdaptiveAdjustmentKcal(prevPrefs.adaptiveAdjustmentKcal ?? prevPrefs.manualKcalOffset ?? 0);
        renderApp();
      },
    });
  });

  document.getElementById('btn-reset-ewma-zero')?.addEventListener('click', async () => {
    const today = getTodayISO();
    const prevPrefs = structuredClone(state.profile.nutritionPrefs || {});
    const currentWeight = Number(state.profile.weightKg) || 75;
    const { previous } = await resetBiometricsBaseline(state.profile.id, currentWeight, today);
    state.manualKcalOffset = 0;
    state.profile = await updateProfile(state.profile.id, {
      nutritionPrefs: {
        ewmaBaselineDate: today,
        adaptiveAdjustmentKcal: 0,
        manualKcalOffset: 0,
      },
    });
    state.biometrics = await listBiometrics(state.profile.id);
    renderApp();
    showToast(`EWMA réinitialisé à partir d’aujourd’hui (${currentWeight} kg · ${today}).`, {
      undoAction: async () => {
        await restoreBiometricsForProfile(state.profile.id, previous);
        state.biometrics = await listBiometrics(state.profile.id);
        state.profile = await updateProfile(state.profile.id, { nutritionPrefs: prevPrefs });
        state.manualKcalOffset = clampAdaptiveAdjustmentKcal(prevPrefs.adaptiveAdjustmentKcal ?? prevPrefs.manualKcalOffset ?? 0);
        renderApp();
      },
    });
  });

  document.getElementById('btn-apply-tdee-adj')?.addEventListener('click', async () => {
    const delta = adaptive.adjustmentProposal.deltaKcal;
    state.manualKcalOffset = clampAdaptiveAdjustmentKcal((Number(state.manualKcalOffset) || 0) + delta);
    state.profile = await updateProfile(state.profile.id, {
      nutritionPrefs: {
        adaptiveAdjustmentKcal: state.manualKcalOffset,
        manualKcalOffset: state.manualKcalOffset,
      },
    });
    renderApp();
    showToast(`Cible calorique ajustée (${delta > 0 ? '+' : ''}${delta} kcal/j · cumul ${state.manualKcalOffset} kcal).`);
  });

  container.querySelectorAll('[data-nut-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (state.barcodeScanner) await state.barcodeScanner.stop();
      state.nutritionSubTab = btn.dataset.nutTab;
      renderApp();
    });
  });

  renderNutritionSubTab(document.getElementById('nutrition-subview'), telemetry);
}

function renderNutritionSubTab(slot, telemetry) {
  if (!slot) return;
  const { adaptive, ewma, knownBf, macros, consumed, smoothing } = telemetry;

  /* ------------------------------------------------------------------------
     VUE 1 — JOURNAL (SAISIE CIQUAL/PHOTO/CODE-BARRES + HYDRATATION + JOURNAL)
     ------------------------------------------------------------------------ */
  if (state.nutritionSubTab === 'journal') {
    const waterPct = Math.min(100, Math.round(((state.hydration?.totalMl || 0) / Math.max(1, macros.waterTargetMl)) * 100));
    slot.innerHTML = `
      <div class="stack">
        <!-- Sélecteur compact de saisie -->
        <div class="segmented" role="tablist" aria-label="Mode de saisie repas">
          <button type="button" class="segmented-btn ${state.nutritionInputMode === 'ciqual' ? 'is-active' : ''}" data-nut-input="ciqual">Recherche & Favoris</button>
          <button type="button" class="segmented-btn ${state.nutritionInputMode === 'photo' ? 'is-active' : ''}" data-nut-input="photo">Photo Assiette</button>
          <button type="button" class="segmented-btn ${state.nutritionInputMode === 'barcode' ? 'is-active' : ''}" data-nut-input="barcode">Code-Barres</button>
        </div>

        <div id="nutrition-input-slot"></div>

        <!-- Hydratation rapide -->
        <section class="panel">
          <div class="row-between">
            <div>
              <h2>Hydratation du jour</h2>
              <span class="mono metric-xs text-secondary">${state.hydration?.totalMl || 0} / ${macros.waterTargetMl} ml (${waterPct} %)</span>
            </div>
            <div class="row" style="gap: 6px;">
              <button type="button" class="btn btn-sm" data-nut-water="250">+250 ml</button>
              <button type="button" class="btn btn-sm btn-primary" data-nut-water="500">+500 ml</button>
            </div>
          </div>
          <div class="nut-meter">
            <div class="nut-meter-fill ${waterPct >= 80 ? 'is-ok' : waterPct < 45 ? 'is-danger' : ''}" style="width: ${waterPct}%;"></div>
          </div>
        </section>

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
                          ${esc(log.mealSlot || 'Repas')} · ${log.kcal} kcal · P ${log.proteinG}g / G ${log.carbsG}g / L ${log.fatG}g${log.fiberG ? ` · F ${log.fiberG}g` : ''}
                        </span>
                      </div>
                      <button type="button" class="btn btn-sm btn-danger" data-del-nut="${esc(log.id)}">Suppr.</button>
                    </div>`
                    )
                    .join('')}
                </div>`
          }
        </section>
      </div>
    `;

    slot.querySelectorAll('[data-nut-input]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (state.barcodeScanner) await state.barcodeScanner.stop();
        state.nutritionInputMode = btn.dataset.nutInput;
        renderNutritionSubTab(slot, telemetry);
      });
    });

    slot.querySelectorAll('[data-nut-water]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ml = Number(btn.dataset.nutWater) || 250;
        await addHydration(state.profile.id, ml, getTodayISO());
        state.hydration = await getHydrationForDate(state.profile.id, getTodayISO());
        renderApp();
        showToast(`+${ml} ml d’eau enregistrés.`);
      });
    });

    slot.querySelectorAll('[data-del-nut]').forEach((btn) => {
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

    renderNutritionInputMode(document.getElementById('nutrition-input-slot'), macros);
    return;
  }

  /* ------------------------------------------------------------------------
     VUE 2 — CONSEILLER NUTRITIONNEL PRO (NIVEAU 0 DÉTERMINISTE + IA)
     ------------------------------------------------------------------------ */
  if (state.nutritionSubTab === 'advisor') {
    const todayISO = getTodayISO();
    const report = computeNutritionClinicalReport({
      profile: state.profile,
      macros,
      consumed,
      nutritionToday: state.nutritionToday,
      nutritionAll: state.nutritionAll,
      hydration: state.hydration,
      adaptive,
      ewma,
      workouts: state.workouts,
      activeSession: state.activeSession,
      dayModeOverride: state.advisorDayMode,
      todayISO,
    });
    const recalibration = buildEndOfDayRecalibration({
      profile: state.profile,
      macros,
      consumed,
      favorites: state.favorites,
      todayISO,
    });
    const matrix = buildPersonalizedFoodMatrix({ profile: state.profile, report });
    const periGuide = buildPeriWorkoutGuide({
      profile: state.profile,
      macros,
      isTrainingDay: report.dayStatus.isTrainingDay,
    });

    const showRecalib =
      state.advisorRecalibrationOpen ||
      report.balance.hasSignificantSurplus ||
      (state.nutritionToday.length > 0 && report.balance.proteinDeficitHigh);

    const scoreTone =
      report.score.total >= 80 ? 'is-ok' : report.score.total >= 58 ? 'is-accent' : 'is-danger';

    const ewmaTone =
      report.ewmaAlert.severity === 'danger'
        ? 'notice-danger'
        : report.ewmaAlert.severity === 'action'
          ? 'notice-accent'
          : '';

    const activeMatrixSection =
      state.advisorMatrixTab === 'moderate'
        ? matrix.moderate
        : state.advisorMatrixTab === 'avoid'
          ? matrix.avoid
          : matrix.prioritize;

    slot.innerHTML = `
      <div class="stack">
        <!-- 1. TABLEAU DE BORD CLINIQUE DU JOUR -->
        <section class="panel">
          <div class="panel-header">
            <div class="stack-sm" style="gap: 3px;">
              <div class="row-wrap" style="gap: 6px;">
                <span class="state-tag ${report.dayStatus.isTrainingDay ? 'is-accent' : 'is-muted'}">${esc(report.dayStatus.label)}</span>
                <span class="mono metric-xs text-secondary">${esc(report.dayStatus.source)}</span>
              </div>
              <h2>Diagnostic clinique du jour</h2>
            </div>
            <div style="text-align: right;">
              <span class="mono metric-xl ${report.score.total >= 80 ? 'text-ok' : report.score.total >= 58 ? 'text-accent' : 'text-danger'}">${report.score.total}</span>
              <span class="mono metric-xs text-muted">/100</span>
              <div><span class="state-tag ${scoreTone}">${esc(report.score.grade)}</span></div>
            </div>
          </div>

          <p class="panel-subtitle">${esc(report.dayStatus.carbModulation)}</p>

          <!-- Sélecteur statut jour Auto / Entraînement / Repos -->
          <div class="segmented" role="tablist" aria-label="Statut d'entraînement du jour">
            <button type="button" class="segmented-btn ${state.advisorDayMode === 'auto' ? 'is-active' : ''}" data-day-mode="auto">Auto</button>
            <button type="button" class="segmented-btn ${state.advisorDayMode === 'training' ? 'is-active' : ''}" data-day-mode="training">Entraînement</button>
            <button type="button" class="segmented-btn ${state.advisorDayMode === 'rest' ? 'is-active' : ''}" data-day-mode="rest">Repos</button>
          </div>

          <!-- 4 Sous-scores cliniques -->
          <div class="nut-score-grid">
            ${Object.values(report.score.subscores)
              .map((sub) => {
                const pct = Math.min(100, Math.round((sub.points / Math.max(1, sub.max)) * 100));
                const fillClass = sub.status === 'ok' ? 'is-ok' : sub.status === 'danger' ? 'is-danger' : '';
                return `
                  <div class="nut-score-item">
                    <div class="row-between">
                      <span class="label-tech">${esc(sub.label)}</span>
                      <span class="mono metric-xs">${sub.points}/${sub.max}</span>
                    </div>
                    <div class="nut-meter"><div class="nut-meter-fill ${fillClass}" style="width: ${pct}%;"></div></div>
                    <span class="mono metric-xs text-secondary">${esc(sub.detail)}</span>
                  </div>
                `;
              })
              .join('')}
          </div>

          ${
            smoothing
              ? `<div class="notice notice-accent">
                  <span><strong>Lissage 72 h actif :</strong> ${smoothing.dailyDeltaKcal} kcal/j sur ${smoothing.remainingDaysCount} j restant(s) (surplus initial +${smoothing.totalSurplusKcal} kcal).</span>
                  <button type="button" class="btn btn-xs" id="btn-cancel-smoothing">Annuler</button>
                </div>`
              : ''
          }

          <!-- Alerte tendance EWMA 14–21 j -->
          <div class="${ewmaTone ? `notice ${ewmaTone}` : 'panel-elevated stack-sm'}" style="${ewmaTone ? '' : 'padding: 10px 12px;'}">
            <div class="stack-sm" style="gap: 3px; flex: 1;">
              <div class="row-wrap" style="gap: 6px;">
                <span class="state-tag ${report.ewmaAlert.severity === 'danger' ? 'is-danger' : report.ewmaAlert.severity === 'action' ? 'is-accent' : report.ewmaAlert.severity === 'ok' ? 'is-ok' : 'is-muted'}">
                  EWMA 14–21 J · ${esc(report.ewmaAlert.statusLabel)}
                </span>
                <span class="mono metric-xs text-secondary">${esc(report.ewmaAlert.headline)}</span>
              </div>
              <span style="font-size: 0.82rem;">${esc(report.ewmaAlert.explanation)}</span>
            </div>
            ${
              report.ewmaAlert.recommendedDeltaKcal !== 0
                ? `<button type="button" class="btn btn-sm btn-primary" id="btn-apply-ewma-adj">
                    Appliquer (${report.ewmaAlert.recommendedDeltaKcal > 0 ? '+' : ''}${report.ewmaAlert.recommendedDeltaKcal} kcal → ${report.ewmaAlert.newTargetKcal})
                  </button>`
                : ''
            }
          </div>
        </section>

        <!-- 2. RECALIBRAGE DE FIN DE JOURNÉE & LISSAGE 3 JOURS -->
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Recalibrage de fin de journée</h2>
              <p class="panel-subtitle mono">
                ${report.balance.surplusKcal > 0 ? `Surplus +${report.balance.surplusKcal} kcal` : `Reste ${report.balance.remKcal} kcal`} · P ${report.balance.remProteinG}g · G ${report.balance.remCarbsG}g · L ${report.balance.remFatG}g
              </p>
            </div>
            <button type="button" class="btn btn-sm btn-primary" id="btn-toggle-recalib">
              ${showRecalib ? 'Masquer' : 'Recalibrer ma fin de journée'}
            </button>
          </div>

          ${
            showRecalib
              ? `<div class="stack-sm">
                  <p class="panel-subtitle">${esc(recalibration.situationSummary)}</p>
                  ${recalibration.options
                    .map(
                      (opt, idx) => `
                    <div class="panel-elevated stack-sm" style="padding: 10px 12px;">
                      <div class="row-between">
                        <div class="stack-sm" style="gap: 2px;">
                          <span class="state-tag is-accent">${esc(opt.tag)}</span>
                          <strong>${esc(opt.title)}</strong>
                        </div>
                        <button type="button" class="btn btn-xs btn-primary" data-log-recalib="${idx}">+ Journal</button>
                      </div>
                      <span class="mono metric-xs text-accent">
                        ${opt.totals.kcal} kcal · P ${opt.totals.proteinG}g / G ${opt.totals.carbsG}g / L ${opt.totals.fatG}g${opt.totals.fiberG ? ` · F ${opt.totals.fiberG}g` : ''}
                      </span>
                      <div class="stack-sm" style="gap: 2px;">
                        ${opt.items
                          .map((i) => `<span class="mono metric-xs text-secondary">• ${esc(i.name)} : ${i.grams} g (${i.kcal} kcal · P ${i.proteinG}g)</span>`)
                          .join('')}
                      </div>
                      <span class="panel-subtitle">${esc(opt.rationale)}</span>
                    </div>`
                    )
                    .join('')}

                  ${
                    recalibration.smoothingProposal
                      ? `<div class="notice notice-danger">
                          <div class="stack-sm" style="gap: 2px;">
                            <strong>Option Lissage sur 3 jours (72 h)</strong>
                            <span style="font-size: 0.8rem;">
                              Répartir le surplus (+${recalibration.smoothingProposal.totalSurplusKcal} kcal) en douceur :
                              <span class="mono">${recalibration.smoothingProposal.dailyDeltaKcal} kcal/j</span> sur les 3 prochains jours (${recalibration.smoothingProposal.activeDays.join(', ')}) sans sauter de repas.
                            </span>
                          </div>
                          <button type="button" class="btn btn-sm btn-primary" id="btn-activate-smoothing">Lisser sur 3 jours</button>
                        </div>`
                      : ''
                  }
                </div>`
              : `<p class="panel-subtitle">Clique sur « Recalibrer ma fin de journée » pour générer 2 à 3 repas/collations chiffrés (Ciqual + favoris) adaptés à ton reste du jour ou lisser un écart sur 72 h.</p>`
          }
        </section>

        <!-- 3. MATRICE D'ALIMENTS PERSONNALISÉE -->
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Matrice d’aliments personnalisée</h2>
              <p class="panel-subtitle">
                ${esc(matrix.goalLabel)} · ${esc(matrix.dietLabel)}${matrix.allergies.length ? ` · Hors ${esc(matrix.allergies.join(', '))}` : ''}${matrix.hasInjuries ? ' · Focus anti-inflammatoire' : ''}${matrix.lowHydration ? ' · Focus électrolytes' : ''}
              </p>
            </div>
          </div>

          <div class="segmented" role="tablist" aria-label="Catégories matrice alimentaire">
            <button type="button" class="segmented-btn ${state.advisorMatrixTab === 'prioritize' ? 'is-active' : ''}" data-matrix-tab="prioritize">À privilégier</button>
            <button type="button" class="segmented-btn ${state.advisorMatrixTab === 'moderate' ? 'is-active' : ''}" data-matrix-tab="moderate">À modérer</button>
            <button type="button" class="segmented-btn ${state.advisorMatrixTab === 'avoid' ? 'is-active' : ''}" data-matrix-tab="avoid">À limiter</button>
          </div>

          <div class="stack-sm">
            <div class="row-between">
              <span class="label-tech ${state.advisorMatrixTab === 'avoid' ? 'text-danger' : 'text-accent'}">${esc(activeMatrixSection.title)}</span>
              <span class="mono metric-xs text-muted">${activeMatrixSection.items.length} repères</span>
            </div>
            <p class="panel-subtitle">${esc(activeMatrixSection.summary)}</p>

            ${
              state.advisorMatrixTab === 'avoid'
                ? activeMatrixSection.items
                    .map(
                      (item) => `
                    <div class="nut-matrix-row">
                      <div class="nut-matrix-head">
                        <strong>${esc(item.name)}</strong>
                        <span class="state-tag is-danger">${esc(item.tag)}</span>
                      </div>
                      <span class="panel-subtitle">${esc(item.reason)}</span>
                    </div>`
                    )
                    .join('')
                : activeMatrixSection.items
                    .map(
                      (entry, idx) => `
                    <div class="nut-matrix-row">
                      <div class="nut-matrix-head">
                        <div class="stack-sm" style="gap: 2px;">
                          <strong>${esc(entry.food.name)}</strong>
                          <span class="mono metric-xs text-secondary">
                            ${entry.food.kcal} kcal/100g · P ${entry.food.proteinG}g · G ${entry.food.carbsG}g · L ${entry.food.fatG}g · F ${entry.food.fiberG}g
                          </span>
                        </div>
                        <span class="state-tag ${state.advisorMatrixTab === 'prioritize' ? 'is-ok' : 'is-accent'}">${esc(entry.tag)}</span>
                      </div>
                      <span class="panel-subtitle">${esc(entry.reason)}</span>
                      <div class="nut-matrix-actions">
                        <button type="button" class="btn btn-xs btn-primary" data-matrix-log="${state.advisorMatrixTab}:${idx}">+ Journal (${entry.defaultGrams} g)</button>
                        <button type="button" class="btn btn-xs" data-matrix-shop="${state.advisorMatrixTab}:${idx}">+ Courses (${entry.weeklyGrams} g)</button>
                      </div>
                    </div>`
                    )
                    .join('')
            }
          </div>
        </section>

        <!-- 4. GUIDE PÉRI-ENTRAÎNEMENT & TIMING DES REPAS -->
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Guide péri-entraînement & timing</h2>
              <p class="panel-subtitle">Cadence calibrée sur ${periGuide.mealsPerDay} repas/jour · ${esc(report.dayStatus.label)}</p>
            </div>
          </div>

          <div class="stack-sm">
            ${periGuide.windows
              .map(
                (w) => `
              <div class="nut-peri-card">
                <span class="label-tech text-accent">${esc(w.window)}</span>
                <strong style="font-size: 0.86rem;">${esc(w.focus)}</strong>
                <span class="panel-subtitle">${esc(w.rationale)}</span>
                <span class="mono metric-xs text-primary" style="margin-top: 2px;">Repère : ${esc(w.example)}</span>
              </div>`
              )
              .join('')}
          </div>

          <div class="stack-sm" style="margin-top: 4px;">
            <span class="label-tech">Répartition cible (${periGuide.mealsPerDay} prises)</span>
            ${periGuide.cadence
              .map(
                (c) => `
              <div class="nut-cadence-row">
                <div class="stack-sm" style="gap: 1px;">
                  <strong style="font-size: 0.84rem;">${esc(c.label)}</strong>
                  <span class="panel-subtitle">${esc(c.note)}</span>
                </div>
                <span class="mono metric-xs text-accent" style="white-space: nowrap;">${c.kcal} kcal · P ${c.proteinG}g</span>
              </div>`
              )
              .join('')}
          </div>
        </section>

        <!-- 5. CONSULTATION CONSEILLER NUTRITION INTERACTIVE -->
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Poser une question au Conseiller Nutrition</h2>
              <p class="panel-subtitle">Contexte injecté : profil, allergies, reste du jour, EWMA & audit 7 jours (${report.audit7d.daysLogged} j logués)</p>
            </div>
            <span class="state-tag is-muted">NIVEAU ${state.aiSettings.activeTier}</span>
          </div>

          <div class="nut-shortcut-grid">
            ${ADVISOR_SHORTCUTS.map(
              (sc) => `
              <button type="button" class="nut-shortcut-btn" data-advisor-shortcut="${esc(sc.id)}" ${state.advisorBusy ? 'disabled' : ''}>
                ${esc(sc.label)}
              </button>`
            ).join('')}
          </div>

          <form id="advisor-question-form" class="input-action-row">
            <input
              id="advisor-question-input"
              class="input"
              type="text"
              placeholder="Ex. Remplace le skyr, ou comment gérer un repas d’affaires ?"
              ${state.advisorBusy ? 'disabled' : ''}
            />
            <button type="submit" class="btn btn-primary" ${state.advisorBusy ? 'disabled' : ''}>
              ${state.advisorBusy ? '...' : 'Analyser'}
            </button>
          </form>

          ${
            state.advisorMessages.length > 0
              ? `<div class="stack-sm">
                  <div class="row-between">
                    <span class="label-tech">Consultation en cours (${state.advisorMessages.length})</span>
                    <button type="button" class="btn btn-xs btn-ghost" id="btn-clear-advisor">Effacer</button>
                  </div>
                  <div class="nut-advisor-thread" id="advisor-thread-box">
                    ${state.advisorMessages
                      .map(
                        (msg) => `
                      <div class="nut-advisor-msg ${msg.role === 'user' ? 'is-user' : 'is-assistant'}">
                        <div class="row-between" style="margin-bottom: 4px;">
                          <span class="label-tech">${msg.role === 'user' ? 'VOTRE QUESTION' : 'CONSEILLER NUTRITION PRO'}</span>
                          ${msg.meta ? `<span class="mono metric-xs text-muted">${esc(msg.meta)}</span>` : ''}
                        </div>
                        <div class="coach-md">${msg.role === 'user' ? esc(msg.content) : renderCoachMarkdown(msg.content)}</div>
                      </div>`
                      )
                      .join('')}
                  </div>
                </div>`
              : `<p class="panel-subtitle">Sélectionne un raccourci terrain ou pose une question libre. Fonctionne à 100 % en local (Niveau 0) et s’enrichit automatiquement si un moteur IA (Niveau 1/2/3) est activé.</p>`
          }
        </section>
      </div>
    `;

    // Handlers Vue Conseiller Pro
    slot.querySelectorAll('[data-day-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.advisorDayMode = btn.dataset.dayMode;
        renderNutritionSubTab(slot, telemetry);
      });
    });

    document.getElementById('btn-toggle-recalib')?.addEventListener('click', () => {
      state.advisorRecalibrationOpen = !showRecalib;
      renderNutritionSubTab(slot, telemetry);
    });

    document.getElementById('btn-apply-ewma-adj')?.addEventListener('click', async () => {
      const delta = report.ewmaAlert.recommendedDeltaKcal;
      if (!delta) return;
      state.manualKcalOffset = clampAdaptiveAdjustmentKcal((Number(state.manualKcalOffset) || 0) + delta);
      state.profile = await updateProfile(state.profile.id, {
        nutritionPrefs: {
          adaptiveAdjustmentKcal: state.manualKcalOffset,
          manualKcalOffset: state.manualKcalOffset,
        },
      });
      renderApp();
      showToast(`Cible calorique recalibrée (${delta > 0 ? '+' : ''}${delta} kcal/j · cumul ${state.manualKcalOffset} kcal).`);
    });

    document.getElementById('btn-activate-smoothing')?.addEventListener('click', async () => {
      if (!recalibration.smoothingProposal) return;
      state.profile = await updateProfile(state.profile.id, {
        nutritionPrefs: { smoothingPlan: recalibration.smoothingProposal },
      });
      renderApp();
      showToast(`Lissage 72 h activé (${recalibration.smoothingProposal.dailyDeltaKcal} kcal/j sur 3 jours).`);
    });

    document.getElementById('btn-cancel-smoothing')?.addEventListener('click', async () => {
      state.profile = await updateProfile(state.profile.id, {
        nutritionPrefs: { smoothingPlan: null },
      });
      renderApp();
      showToast('Lissage 72 h annulé.');
    });

    slot.querySelectorAll('[data-log-recalib]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const opt = recalibration.options[Number(btn.dataset.logRecalib)];
        if (!opt) return;
        await saveNutritionLog(state.profile.id, {
          date: todayISO,
          mealSlot: 'Recalibrage Pro',
          source: 'advisor_recalib',
          label: `${opt.title} (${opt.items.map((i) => `${i.name} ${i.grams}g`).join(' + ')})`,
          kcal: opt.totals.kcal,
          proteinG: opt.totals.proteinG,
          carbsG: opt.totals.carbsG,
          fatG: opt.totals.fatG,
          fiberG: opt.totals.fiberG,
        });
        state.nutritionAll = await listNutritionLogs(state.profile.id);
        state.nutritionToday = state.nutritionAll.filter((n) => n.date === todayISO);
        renderApp();
        showToast(`Option ajoutée au journal (${opt.totals.kcal} kcal · P ${opt.totals.proteinG}g).`);
      });
    });

    slot.querySelectorAll('[data-matrix-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.advisorMatrixTab = btn.dataset.matrixTab;
        renderNutritionSubTab(slot, telemetry);
      });
    });

    slot.querySelectorAll('[data-matrix-log]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const [tabKey, idxStr] = String(btn.dataset.matrixLog || '').split(':');
        const list = tabKey === 'moderate' ? matrix.moderate.items : matrix.prioritize.items;
        const entry = list[Number(idxStr)];
        if (!entry) return;
        const scaled = scaleFoodMacros(entry.food, entry.defaultGrams);
        await saveNutritionLog(state.profile.id, {
          date: todayISO,
          mealSlot: 'Conseiller Pro',
          source: 'advisor_matrix',
          label: `${entry.food.name} (${scaled.grams} g)`,
          ...scaled,
        });
        state.nutritionAll = await listNutritionLogs(state.profile.id);
        state.nutritionToday = state.nutritionAll.filter((n) => n.date === todayISO);
        renderApp();
        showToast(`Ajouté au journal : ${entry.food.name} (${scaled.grams} g · ${scaled.kcal} kcal).`);
      });
    });

    slot.querySelectorAll('[data-matrix-shop]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const [tabKey, idxStr] = String(btn.dataset.matrixShop || '').split(':');
        const list = tabKey === 'moderate' ? matrix.moderate.items : matrix.prioritize.items;
        const entry = list[Number(idxStr)];
        if (!entry) return;
        const existing = state.shoppingList.find((x) => x.name === entry.food.name);
        if (existing) {
          existing.checked = false;
          await saveShoppingItem(state.profile.id, existing);
        } else {
          const useKg = entry.weeklyGrams >= 1000;
          await saveShoppingItem(state.profile.id, {
            aisle: entry.food.aisle,
            name: entry.food.name,
            quantity: useKg ? Number((entry.weeklyGrams / 1000).toFixed(2)) : entry.weeklyGrams,
            unit: useKg ? 'kg' : 'g',
            checked: false,
          });
        }
        state.shoppingList = await listShoppingList(state.profile.id);
        showToast(`Ajouté aux courses : ${entry.food.name} (${entry.food.aisle}).`);
      });
    });

    const submitAdvisorQuestion = async (questionText) => {
      const cleanQ = String(questionText || '').trim();
      if (!cleanQ || state.advisorBusy) return;
      state.advisorBusy = true;
      state.advisorMessages.push({ role: 'user', content: cleanQ, meta: null });
      renderNutritionSubTab(slot, telemetry);

      try {
        const reply = await askNutritionAdvisor({
          question: cleanQ,
          profile: state.profile,
          macros,
          report,
          matrix,
          recalibration,
          knownBf,
          history: state.advisorMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
          aiSettings: state.aiSettings,
        });
        const meta = reply.usedFallback
          ? `Niveau 0 local (repli) · ${reply.latencyMs} ms`
          : `${reply.provider} · ${reply.latencyMs} ms`;
        state.advisorMessages.push({ role: 'assistant', content: reply.text, meta });
      } catch (err) {
        state.advisorMessages.push({
          role: 'assistant',
          content: `Impossible de finaliser l’analyse : ${err?.message || err}`,
          meta: 'Erreur',
        });
      } finally {
        state.advisorBusy = false;
        renderNutritionSubTab(slot, telemetry);
        const threadBox = document.getElementById('advisor-thread-box');
        if (threadBox) threadBox.scrollTop = threadBox.scrollHeight;
      }
    };

    slot.querySelectorAll('[data-advisor-shortcut]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sc = ADVISOR_SHORTCUTS.find((x) => x.id === btn.dataset.advisorShortcut);
        if (sc) submitAdvisorQuestion(sc.prompt);
      });
    });

    document.getElementById('advisor-question-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('advisor-question-input');
      if (input && input.value.trim()) {
        submitAdvisorQuestion(input.value.trim());
      }
    });

    document.getElementById('btn-clear-advisor')?.addEventListener('click', () => {
      state.advisorMessages = [];
      renderNutritionSubTab(slot, telemetry);
    });
    return;
  }

  /* ------------------------------------------------------------------------
     VUE 3 — COURSES & PLANS (PLAN TYPE + LISTE DE COURSES PAR RAYON)
     ------------------------------------------------------------------------ */
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
            ? `<p class="panel-subtitle">Cliquez sur "Remplir liste courses" (ou sur "+ Courses" dans Conseiller Pro) pour générer les quantités adaptées à vos macros et allergies.</p>`
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
    renderNutritionSubTab(slot, telemetry);
    showToast(`${state.shoppingList.length} articles classés par rayon.`);
  });

  slot.querySelectorAll('[data-toggle-shop]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const it = state.shoppingList.find((x) => x.id === cb.dataset.toggleShop);
      if (!it) return;
      it.checked = cb.checked;
      await saveShoppingItem(state.profile.id, it);
      renderNutritionSubTab(slot, telemetry);
    });
  });
}

function openCreateCustomFoodModal(initialName = '', onCreated = null) {
  const defaultGrams = Math.max(5, Math.min(2000, Number(state.foodSearchGrams) || 150));
  openModal(
    'Créer un aliment perso',
    `<form id="custom-food-form" class="stack">
      <div class="field">
        <label class="field-label" for="cf-name">Nom de l’aliment ou plat</label>
        <input id="cf-name" class="input" required placeholder="Ex. Pain complet boulangerie, Bowl maison..." value="${esc(initialName)}" />
      </div>

      <div class="segmented" role="tablist" aria-label="Unité de saisie macros">
        <button type="button" class="segmented-btn is-active" data-cf-mode="per100">Valeurs pour 100 g</button>
        <button type="button" class="segmented-btn" data-cf-mode="portion">Valeurs par portion</button>
      </div>

      <div id="cf-portion-row" class="grid-2">
        <div class="field">
          <label class="field-label" for="cf-portion-label">Portion usuelle (optionnel)</label>
          <input id="cf-portion-label" class="input" placeholder="Ex. 1 tranche, 1 pot, 1 bol" value="1 portion" />
        </div>
        <div class="field">
          <label class="field-label" for="cf-portion-grams">Poids portion (g)</label>
          <input id="cf-portion-grams" class="input mono" type="number" inputmode="numeric" min="5" max="1500" value="${defaultGrams}" />
        </div>
      </div>

      <span id="cf-macros-hint" class="panel-subtitle">Saisis les valeurs pour 100 g :</span>
      <div class="grid-4">
        <div class="field"><label class="field-label" for="cf-kcal">Kcal</label><input id="cf-kcal" class="input mono" type="number" inputmode="decimal" min="0" required placeholder="200" /></div>
        <div class="field"><label class="field-label" for="cf-p">Prot (g)</label><input id="cf-p" class="input mono" type="number" inputmode="decimal" step="0.1" min="0" required placeholder="12" /></div>
        <div class="field"><label class="field-label" for="cf-c">Gluc (g)</label><input id="cf-c" class="input mono" type="number" inputmode="decimal" step="0.1" min="0" required placeholder="20" /></div>
        <div class="field"><label class="field-label" for="cf-f">Lip (g)</label><input id="cf-f" class="input mono" type="number" inputmode="decimal" step="0.1" min="0" required placeholder="6" /></div>
      </div>

      <label class="row" style="font-size: 0.84rem; cursor: pointer;">
        <input id="cf-log-today" type="checkbox" checked />
        <span>Ajouter immédiatement au journal d’aujourd’hui</span>
      </label>

      <button type="submit" class="btn btn-primary btn-block">Enregistrer cet aliment perso</button>
    </form>`,
    ({ close, body }) => {
      let inputMode = 'per100';
      const hintEl = document.getElementById('cf-macros-hint');
      body.querySelectorAll('[data-cf-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          inputMode = btn.dataset.cfMode;
          body.querySelectorAll('[data-cf-mode]').forEach((b) => b.classList.toggle('is-active', b === btn));
          if (hintEl) {
            hintEl.textContent =
              inputMode === 'portion'
                ? 'Saisis les valeurs pour 1 portion (conversion auto pour 100 g) :'
                : 'Saisis les valeurs pour 100 g :';
          }
        });
      });

      document.getElementById('custom-food-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = (document.getElementById('cf-name')?.value || '').trim();
        if (!name) return;

        const portionLabel = (document.getElementById('cf-portion-label')?.value || '').trim();
        const portionGrams = Math.max(5, Math.min(1500, Math.round(Number(document.getElementById('cf-portion-grams')?.value) || 100)));
        const rawKcal = Math.max(0, Number(document.getElementById('cf-kcal')?.value) || 0);
        const rawP = Math.max(0, Number(document.getElementById('cf-p')?.value) || 0);
        const rawC = Math.max(0, Number(document.getElementById('cf-c')?.value) || 0);
        const rawF = Math.max(0, Number(document.getElementById('cf-f')?.value) || 0);

        const factorTo100 = inputMode === 'portion' ? 100 / Math.max(5, portionGrams) : 1;
        const foodRecord = {
          name,
          kcal: Math.round(rawKcal * factorTo100),
          proteinG: Math.round(rawP * factorTo100 * 10) / 10,
          carbsG: Math.round(rawC * factorTo100 * 10) / 10,
          fatG: Math.round(rawF * factorTo100 * 10) / 10,
          fiberG: 0,
          portion: portionLabel ? { label: portionLabel, grams: portionGrams } : null,
          source: 'custom',
        };

        const saved = await saveCustomFood(state.profile.id, foodRecord);
        state.customFoods = await listCustomFoods(state.profile.id);

        const shouldLog = Boolean(document.getElementById('cf-log-today')?.checked);
        if (shouldLog) {
          const gramsToLog = portionGrams || defaultGrams;
          const scaled = scaleFoodMacros(saved, gramsToLog);
          await saveNutritionLog(state.profile.id, {
            date: getTodayISO(),
            mealSlot: 'Aliment perso',
            source: 'custom',
            label: `${saved.name} (${scaled.grams} g)`,
            ...scaled,
          });
          state.nutritionAll = await listNutritionLogs(state.profile.id);
          state.nutritionToday = state.nutritionAll.filter((n) => n.date === getTodayISO());
        }

        close();
        if (typeof onCreated === 'function') {
          onCreated({ saved, logged: shouldLog });
        } else {
          renderApp();
        }
        showToast(shouldLog ? `${saved.name} enregistré et ajouté au journal.` : `${saved.name} enregistré dans tes aliments perso.`);
      });
    }
  );
}

function openAIFoodEstimateModal(foodQuery, onDone = null) {
  const cleanQ = String(foodQuery || '').trim();
  if (!cleanQ) return;

  openModal(
    `Estimation IA · ${cleanQ}`,
    `<div id="ai-food-est-body" class="stack">
      <p class="panel-subtitle">Estimation des macros pour 100 g et portion usuelle en cours...</p>
    </div>`,
    async ({ close }) => {
      const box = document.getElementById('ai-food-est-body');
      try {
        const res = await estimateFoodMacrosWithAI(cleanQ, state.profile, state.aiSettings);
        const f = res.food;
        const pGrams = f.portion?.grams || 150;
        const pLabel = f.portion?.label || '1 portion';

        if (!box) return;
        box.innerHTML = `
          ${
            res.usedFallback || res.tierUsed === 0
              ? `<div class="notice"><span>Estimation locale prudente (Niveau 0) — vérifie ou ajuste les chiffres ci-dessous avant d’enregistrer.</span></div>`
              : `<div class="notice notice-accent"><span>Estimation IA (${esc(res.provider || `Niveau ${res.tierUsed}`)}) — ajustable avant validation.</span></div>`
          }
          <form id="ai-est-form" class="stack">
            <div class="field">
              <label class="field-label" for="ai-est-name">Nom retenu</label>
              <input id="ai-est-name" class="input" required value="${esc(f.name)}" />
            </div>
            <div class="grid-4">
              <div class="field"><label class="field-label" for="ai-est-kcal">Kcal/100g</label><input id="ai-est-kcal" class="input mono" type="number" inputmode="decimal" min="0" required value="${f.kcal}" /></div>
              <div class="field"><label class="field-label" for="ai-est-p">Prot/100g</label><input id="ai-est-p" class="input mono" type="number" inputmode="decimal" step="0.1" min="0" required value="${f.proteinG}" /></div>
              <div class="field"><label class="field-label" for="ai-est-c">Gluc/100g</label><input id="ai-est-c" class="input mono" type="number" inputmode="decimal" step="0.1" min="0" required value="${f.carbsG}" /></div>
              <div class="field"><label class="field-label" for="ai-est-f">Lip/100g</label><input id="ai-est-f" class="input mono" type="number" inputmode="decimal" step="0.1" min="0" required value="${f.fatG}" /></div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label class="field-label" for="ai-est-plabel">Portion usuelle</label>
                <input id="ai-est-plabel" class="input" value="${esc(pLabel)}" />
              </div>
              <div class="field">
                <label class="field-label" for="ai-est-pgrams">Grammes à logger</label>
                <input id="ai-est-pgrams" class="input mono" type="number" inputmode="numeric" min="5" max="1500" value="${pGrams}" />
              </div>
            </div>
            <div class="stack-sm">
              <button type="submit" class="btn btn-primary btn-block" data-est-action="both">Ajouter au journal + Enregistrer en perso</button>
              <button type="button" class="btn btn-block" id="btn-est-save-only">Enregistrer en aliment perso uniquement</button>
            </div>
          </form>
        `;

        const readFormFood = () => {
          const grams = Math.max(5, Math.min(1500, Math.round(Number(document.getElementById('ai-est-pgrams')?.value) || 150)));
          const label = (document.getElementById('ai-est-plabel')?.value || '').trim() || '1 portion';
          return {
            food: {
              name: (document.getElementById('ai-est-name')?.value || cleanQ).trim(),
              kcal: Math.max(0, Math.round(Number(document.getElementById('ai-est-kcal')?.value) || 0)),
              proteinG: Math.max(0, Math.round((Number(document.getElementById('ai-est-p')?.value) || 0) * 10) / 10),
              carbsG: Math.max(0, Math.round((Number(document.getElementById('ai-est-c')?.value) || 0) * 10) / 10),
              fatG: Math.max(0, Math.round((Number(document.getElementById('ai-est-f')?.value) || 0) * 10) / 10),
              fiberG: f.fiberG || 0,
              portion: { label, grams },
              source: 'ai_estimated',
            },
            grams,
          };
        };

        const commitEstimate = async (logToday) => {
          const { food, grams } = readFormFood();
          const saved = await saveCustomFood(state.profile.id, food);
          state.customFoods = await listCustomFoods(state.profile.id);
          if (logToday) {
            const scaled = scaleFoodMacros(saved, grams);
            await saveNutritionLog(state.profile.id, {
              date: getTodayISO(),
              mealSlot: 'Estimation IA',
              source: 'ai_estimated',
              label: `${saved.name} (${scaled.grams} g)`,
              ...scaled,
            });
            state.nutritionAll = await listNutritionLogs(state.profile.id);
            state.nutritionToday = state.nutritionAll.filter((n) => n.date === getTodayISO());
          }
          close();
          if (typeof onDone === 'function') onDone({ saved, logged: logToday });
          else renderApp();
          showToast(logToday ? `${saved.name} ajouté (${grams} g) et mémorisé.` : `${saved.name} mémorisé dans tes aliments perso.`);
        };

        document.getElementById('ai-est-form')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          await commitEstimate(true);
        });
        document.getElementById('btn-est-save-only')?.addEventListener('click', async () => {
          await commitEstimate(false);
        });
      } catch (err) {
        if (box) {
          box.innerHTML = `<div class="notice notice-danger"><span>${esc(err?.message || 'Estimation impossible.')}</span></div>`;
        }
      }
    }
  );
}

function renderNutritionInputMode(slot, macros) {
  if (!slot) return;

  // Annule toute requête OFF en cours lors d'un changement de mode
  if (state.offSearchAbort) {
    state.offSearchAbort.abort();
    state.offSearchAbort = null;
  }
  clearTimeout(state.foodLocalTimer);
  clearTimeout(state.foodOffTimer);

  if (state.nutritionInputMode === 'ciqual') {
    const initialGrams = Math.max(5, Math.min(2000, Number(state.foodSearchGrams) || 150));
    slot.innerHTML = `
      <div class="grid-2">
        <section class="panel">
          <div class="panel-header">
            <h2>Recherche Alimentaire Hybride</h2>
            <span class="state-tag is-muted">PERSO · CIQUAL · OFF</span>
          </div>
          <div class="input-action-row">
            <input
              id="ciqual-search"
              class="input"
              type="search"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
              enterkeyhint="search"
              placeholder="Poulet, pâtes, œuf, skyr, marque..."
              value="${esc(state.ciqualQuery)}"
            />
            <input
              id="ciqual-grams"
              class="input mono"
              type="number"
              inputmode="numeric"
              min="5"
              max="2000"
              step="10"
              value="${initialGrams}"
              style="width: 86px;"
              aria-label="Grammes"
            />
          </div>
          <div id="nutrition-search-results" class="food-results-list" aria-live="polite">
            <div id="nutrition-local-results" class="stack-sm"></div>
            <div id="nutrition-off-section" class="stack-sm"></div>
            <div id="nutrition-fallback-section"></div>
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

    const searchInput = document.getElementById('ciqual-search');
    const gramsInput = document.getElementById('ciqual-grams');
    const resultsRoot = document.getElementById('nutrition-search-results');
    const localContainer = document.getElementById('nutrition-local-results');
    const offContainer = document.getElementById('nutrition-off-section');
    const fallbackContainer = document.getElementById('nutrition-fallback-section');

    // Index en mémoire des résultats locaux actuellement rendus pour ajout instantané sans re-calcul
    let renderedLocalMap = new Map();

    const getGramsValue = () => Math.max(5, Math.min(2000, Math.round(Number(gramsInput?.value) || state.foodSearchGrams || 100)));

    const renderFoodRowHtml = (item, { kind, keyAttr, keyVal, removableId = null }) => {
      const g = getGramsValue();
      const brandTxt = item.brand ? ` · ${esc(item.brand)}` : '';
      const nsTxt = item.nutriscore ? ` · NS ${esc(item.nutriscore)}` : '';
      const portionBtn =
        item.portion && item.portion.grams
          ? `<button type="button" class="food-portion-btn" ${keyAttr}="${esc(keyVal)}" data-grams="${item.portion.grams}">+ ${esc(item.portion.label)} (${item.portion.grams}g)</button>`
          : '';
      const delBtn = removableId
        ? `<button type="button" class="btn btn-sm btn-danger" data-del-custom-id="${esc(removableId)}" aria-label="Supprimer aliment perso">×</button>`
        : '';

      return `
        <div class="food-result-row">
          <div class="food-result-main">
            <div class="food-result-info">
              <span class="food-result-name">${esc(item.name)}${brandTxt}</span>
              <span class="mono metric-xs text-secondary">${item.kcal} kcal/100g · P ${item.proteinG} · G ${item.carbsG} · L ${item.fatG}${nsTxt}</span>
            </div>
            ${delBtn}
          </div>
          <div class="food-result-actions">
            ${portionBtn}
            <button type="button" class="btn btn-sm btn-primary mono" ${keyAttr}="${esc(keyVal)}" data-grams-btn-label="1">+ ${g}g</button>
          </div>
        </div>
      `;
    };

    const renderLocalAndFallback = () => {
      if (!localContainer || !fallbackContainer) return;
      const q = state.ciqualQuery || '';
      const trimmed = q.trim();
      const { customMatches, ciqualMatches } = searchHybridLocalFoods(q, state.customFoods, state.profile, { ciqualLimit: 18 });

      renderedLocalMap = new Map();
      const htmlParts = [];

      if (customMatches.length > 0) {
        htmlParts.push(`
          <div class="food-section-head">
            <span class="food-source-tag is-perso">[PERSO]</span>
            <span class="mono metric-xs text-secondary">${customMatches.length} mémorisé${customMatches.length > 1 ? 's' : ''}</span>
          </div>
        `);
        for (const cf of customMatches) {
          const mapKey = `custom:${cf.id}`;
          renderedLocalMap.set(mapKey, { food: cf, kind: 'custom' });
          htmlParts.push(
            renderFoodRowHtml(cf, {
              kind: 'custom',
              keyAttr: 'data-add-local-key',
              keyVal: mapKey,
              removableId: cf.id,
            })
          );
        }
      }

      if (ciqualMatches.length > 0) {
        htmlParts.push(`
          <div class="food-section-head">
            <span class="food-source-tag">[CIQUAL · HORS-LIGNE]</span>
            <span class="mono metric-xs text-secondary">${ciqualMatches.length} résultat${ciqualMatches.length > 1 ? 's' : ''}</span>
          </div>
        `);
        for (const f of ciqualMatches) {
          const mapKey = `ciqual:${f.id}`;
          renderedLocalMap.set(mapKey, { food: f, kind: 'ciqual' });
          htmlParts.push(
            renderFoodRowHtml(f, {
              kind: 'ciqual',
              keyAttr: 'data-add-local-key',
              keyVal: mapKey,
            })
          );
        }
      } else if (customMatches.length === 0) {
        htmlParts.push(`<p class="panel-subtitle">Aucun aliment local pour « ${esc(trimmed)} ».</p>`);
      }

      localContainer.innerHTML = htmlParts.join('');

      // Pied de liste zéro impasse (toujours disponible)
      const createLabel = trimmed ? `+ Créer « ${trimmed} » (aliment perso)` : '+ Créer un aliment perso';
      const aiBtnHtml =
        trimmed.length >= 2
          ? `<button type="button" class="btn btn-sm" data-open-ai-estimate="1">Estimer « ${esc(trimmed)} » via IA</button>`
          : '';
      fallbackContainer.innerHTML = `
        <div class="food-fallback-box">
          <span class="label-tech">Introuvable ou plat maison ?</span>
          <div class="food-fallback-actions">
            <button type="button" class="btn btn-sm btn-primary" data-open-create-food="1">${esc(createLabel)}</button>
            ${aiBtnHtml}
          </div>
        </div>
      `;
    };

    const renderOffSection = () => {
      if (!offContainer) return;
      const trimmed = (state.ciqualQuery || '').trim();
      if (trimmed.length < 3) {
        offContainer.innerHTML = '';
        return;
      }

      if (state.offLiveOffline) {
        offContainer.innerHTML = `
          <div class="food-section-head">
            <span class="food-source-tag">[OPEN FOOD FACTS]</span>
            <span class="mono metric-xs text-secondary">Hors-ligne · base locale active</span>
          </div>
        `;
        return;
      }

      if (state.offLiveLoading) {
        offContainer.innerHTML = `
          <div class="food-section-head">
            <span class="food-source-tag is-off">[OPEN FOOD FACTS · EN LIGNE]</span>
            <span class="mono metric-xs text-accent">Recherche en direct...</span>
          </div>
        `;
        return;
      }

      if (!state.offLiveResults || state.offLiveResults.length === 0) {
        offContainer.innerHTML = `
          <div class="food-section-head">
            <span class="food-source-tag is-off">[OPEN FOOD FACTS · EN LIGNE]</span>
            <span class="mono metric-xs text-secondary">0 produit trouvé</span>
          </div>
        `;
        return;
      }

      const rowsHtml = state.offLiveResults
        .map((prod, idx) =>
          renderFoodRowHtml(prod, {
            kind: 'off',
            keyAttr: 'data-add-live-off',
            keyVal: String(idx),
          })
        )
        .join('');

      offContainer.innerHTML = `
        <div class="food-section-head">
          <span class="food-source-tag is-off">[OPEN FOOD FACTS · EN LIGNE]</span>
          <span class="mono metric-xs text-secondary">${state.offLiveResults.length} produit${state.offLiveResults.length > 1 ? 's' : ''}</span>
        </div>
        ${rowsHtml}
      `;
    };

    const scheduleOffLookup = (rawQuery) => {
      clearTimeout(state.foodOffTimer);
      if (state.offSearchAbort) {
        state.offSearchAbort.abort();
        state.offSearchAbort = null;
      }

      const trimmed = String(rawQuery || '').trim();
      if (trimmed.length < 3) {
        state.offLiveResults = [];
        state.offLiveQuery = '';
        state.offLiveLoading = false;
        state.offLiveOffline = false;
        renderOffSection();
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        state.offLiveResults = [];
        state.offLiveQuery = trimmed;
        state.offLiveLoading = false;
        state.offLiveOffline = true;
        renderOffSection();
        return;
      }

      state.offLiveOffline = false;
      state.offLiveLoading = true;
      renderOffSection();

      state.foodOffTimer = setTimeout(async () => {
        if ((state.ciqualQuery || '').trim() !== trimmed) return;
        const controller = new AbortController();
        state.offSearchAbort = controller;
        try {
          const products = await searchOpenFoodFactsText(trimmed, { pageSize: 12, signal: controller.signal });
          if ((state.ciqualQuery || '').trim() !== trimmed) return;
          state.offLiveQuery = trimmed;
          state.offLiveResults = products;
          state.offLiveLoading = false;
          state.offLiveOffline = false;
          requestAnimationFrame(renderOffSection);
        } catch (err) {
          if (err?.name === 'AbortError') return;
          if ((state.ciqualQuery || '').trim() !== trimmed) return;
          state.offLiveResults = [];
          state.offLiveLoading = false;
          state.offLiveOffline = true;
          requestAnimationFrame(renderOffSection);
        }
      }, 350);
    };

    // Rendu initial de la liste isolée (sans jamais recréer les inputs ensuite)
    renderLocalAndFallback();
    if ((state.ciqualQuery || '').trim().length >= 3) {
      if (state.offLiveQuery === state.ciqualQuery.trim() && state.offLiveResults.length > 0) {
        renderOffSection();
      } else {
        scheduleOffLookup(state.ciqualQuery);
      }
    }

    // Saisie fluide 100 % isolée : ZÉRO re-render du parent, zéro perte de focus clavier mobile
    searchInput?.addEventListener('input', (e) => {
      const val = e.target.value;
      state.ciqualQuery = val;
      clearTimeout(state.foodLocalTimer);
      state.foodLocalTimer = setTimeout(() => {
        requestAnimationFrame(renderLocalAndFallback);
      }, 90);
      scheduleOffLookup(val);
    });

    // Mise à jour in-place du libellé de grammage sur les boutons (+ 150g)
    gramsInput?.addEventListener('input', (e) => {
      const nextG = Math.max(5, Math.min(2000, Math.round(Number(e.target.value) || 100)));
      state.foodSearchGrams = nextG;
      resultsRoot?.querySelectorAll('[data-grams-btn-label]').forEach((btn) => {
        btn.textContent = `+ ${nextG}g`;
      });
    });

    // Délégation unique de clics dans #nutrition-search-results
    resultsRoot?.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('[data-del-custom-id]');
      if (delBtn) {
        const id = delBtn.dataset.delCustomId;
        await deleteCustomFood(id);
        state.customFoods = await listCustomFoods(state.profile.id);
        requestAnimationFrame(renderLocalAndFallback);
        showToast('Aliment perso supprimé.');
        return;
      }

      const addLocalBtn = e.target.closest('[data-add-local-key]');
      if (addLocalBtn) {
        const entry = renderedLocalMap.get(addLocalBtn.dataset.addLocalKey);
        if (!entry) return;
        const grams = Number(addLocalBtn.dataset.grams) || getGramsValue();
        const scaled = scaleFoodMacros(entry.food, grams);
        await saveNutritionLog(state.profile.id, {
          date: getTodayISO(),
          mealSlot: entry.kind === 'custom' ? 'Perso' : 'Ciqual',
          source: entry.kind === 'custom' ? 'custom' : 'ciqual',
          label: `${entry.food.name} (${scaled.grams} g)`,
          ...scaled,
        });
        state.nutritionAll = await listNutritionLogs(state.profile.id);
        state.nutritionToday = state.nutritionAll.filter((n) => n.date === getTodayISO());
        renderApp();
        showToast(`Ajouté : ${entry.food.name} (${scaled.kcal} kcal).`);
        return;
      }

      const addOffBtn = e.target.closest('[data-add-live-off]');
      if (addOffBtn) {
        const prod = state.offLiveResults[Number(addOffBtn.dataset.addLiveOff)];
        if (!prod) return;
        const grams = Number(addOffBtn.dataset.grams) || getGramsValue();
        const scaled = scaleFoodMacros(prod, grams);
        await saveNutritionLog(state.profile.id, {
          date: getTodayISO(),
          mealSlot: 'Open Food Facts',
          source: 'open_food_facts',
          label: `${prod.name} (${scaled.grams} g)`,
          ...scaled,
        });
        // Mise en cache locale automatique pour réutilisation instantanée hors-ligne
        await saveCustomFood(state.profile.id, {
          ...prod,
          source: 'off_cached',
        });
        state.customFoods = await listCustomFoods(state.profile.id);
        state.nutritionAll = await listNutritionLogs(state.profile.id);
        state.nutritionToday = state.nutritionAll.filter((n) => n.date === getTodayISO());
        renderApp();
        showToast(`${prod.name} ajouté (${scaled.kcal} kcal) + mémorisé hors-ligne.`);
        return;
      }

      if (e.target.closest('[data-open-create-food]')) {
        openCreateCustomFoodModal((state.ciqualQuery || '').trim(), ({ logged }) => {
          if (logged) renderApp();
          else requestAnimationFrame(renderLocalAndFallback);
        });
        return;
      }

      if (e.target.closest('[data-open-ai-estimate]')) {
        openAIFoodEstimateModal((state.ciqualQuery || '').trim(), ({ logged }) => {
          if (logged) renderApp();
          else requestAnimationFrame(renderLocalAndFallback);
        });
      }
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

  if (state.nutritionInputMode === 'photo') {
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
        renderNutritionInputMode(slot, macros);
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

  // Mode Code-Barres & Open Food Facts (mise à jour isolée de #off-results-list sans reconstruire les champs)
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
          <input id="off-text-input" class="input" type="search" autocomplete="off" placeholder="Recherche Open Food Facts..." />
          <button type="button" class="btn btn-sm" id="btn-search-off">OK</button>
        </div>
      </div>

      <div class="row">
        <label class="label-tech" for="off-grams">Portion à ajouter (g) :</label>
        <input id="off-grams" class="input mono" type="number" inputmode="numeric" min="5" max="1500" value="100" style="max-width: 110px;" />
      </div>

      <div id="off-results-list" class="stack-sm"></div>
    </section>
  `;

  const offListEl = document.getElementById('off-results-list');
  const renderOffResultsList = (statusMsg = '') => {
    if (!offListEl) return;
    if (statusMsg) {
      offListEl.innerHTML = `<p class="panel-subtitle">${esc(statusMsg)}</p>`;
      return;
    }
    if (!state.offResults || state.offResults.length === 0) {
      offListEl.innerHTML = '';
      return;
    }
    offListEl.innerHTML = state.offResults
      .map(
        (p, idx) => `
      <div class="row-between panel-elevated" style="padding: 10px 12px;">
        <div class="stack-sm" style="gap: 2px;">
          <strong>${esc(p.name)}${p.brand ? ` · ${esc(p.brand)}` : ''}</strong>
          <span class="mono metric-xs text-secondary">${p.kcal} kcal/100g · P ${p.proteinG}g · G ${p.carbsG}g · L ${p.fatG}g${p.nutriscore ? ` · Nutri-Score ${esc(p.nutriscore)}` : ''}</span>
        </div>
        <button type="button" class="btn btn-sm btn-primary" data-add-off="${idx}">+ Ajouter</button>
      </div>`
      )
      .join('');
  };
  renderOffResultsList();

  const handleBarcode = async (code) => {
    renderOffResultsList('Recherche du code-barres...');
    try {
      const product = await lookupBarcodeOpenFoodFacts(code);
      state.offResults = [product];
      renderOffResultsList();
      showToast(`Produit trouvé : ${product.name}`);
    } catch (err) {
      renderOffResultsList(err.message);
      showToast(err.message);
    }
  };

  const runOffTextSearch = async () => {
    const q = (document.getElementById('off-text-input')?.value || '').trim();
    if (q.length < 2) {
      showToast('Tape au moins 2 caractères.');
      return;
    }
    renderOffResultsList('Recherche Open Food Facts...');
    state.offResults = await searchOpenFoodFactsText(q, { pageSize: 12 });
    if (state.offResults.length === 0) {
      renderOffResultsList('Aucun produit trouvé sur Open Food Facts.');
    } else {
      renderOffResultsList();
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

  document.getElementById('manual-barcode-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBarcode(e.target.value);
    }
  });

  document.getElementById('btn-search-off')?.addEventListener('click', runOffTextSearch);
  document.getElementById('off-text-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runOffTextSearch();
    }
  });

  offListEl?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-add-off]');
    if (!btn) return;
    const prod = state.offResults[Number(btn.dataset.addOff)];
    if (!prod) return;
    const grams = Number(document.getElementById('off-grams')?.value) || 100;
    const scaled = scaleFoodMacros(prod, grams);
    await saveNutritionLog(state.profile.id, {
      date: getTodayISO(),
      mealSlot: 'Code-Barres',
      source: 'barcode',
      label: `${prod.name} (${scaled.grams} g)`,
      ...scaled,
    });
    // Cache automatique dans les aliments perso pour réutilisation hors-ligne
    await saveCustomFood(state.profile.id, { ...prod, source: 'off_cached' });
    state.customFoods = await listCustomFoods(state.profile.id);
    state.nutritionAll = await listNutritionLogs(state.profile.id);
    state.nutritionToday = state.nutritionAll.filter((n) => n.date === getTodayISO());
    renderApp();
    showToast(`${prod.name} ajouté (${scaled.kcal} kcal) + mémorisé hors-ligne.`);
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
                    ${
                      m.role === 'user'
                        ? `<p>${esc(m.content)}</p>`
                        : `<div class="coach-md">${renderCoachMarkdown(m.content)}</div>`
                    }
                    ${
                      Array.isArray(m.executedBadges) && m.executedBadges.length > 0
                        ? `<div class="coach-action-badges">
                            ${m.executedBadges.map((b) => `<span class="coach-exec-badge mono">[${esc(b)}]</span>`).join('')}
                          </div>`
                        : ''
                    }
                    ${
                      m.actionProposal && (!Array.isArray(m.executedBadges) || m.executedBadges.length === 0)
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
          <button type="button" class="btn btn-xs" data-quick-prompt="Passe mon programme en pyramidal inversé (RPT) et applique-le">Pyramidal inversé</button>
          <button type="button" class="btn btn-xs" data-quick-prompt="Passe-moi en Full Body 3 jours par semaine">Passer en Full Body</button>
          <button type="button" class="btn btn-xs" data-quick-prompt="J'ai mal à l'épaule au développé, remplace les exercices risqués dans mon programme">Douleur épaule</button>
          <button type="button" class="btn btn-xs" data-quick-prompt="Réinitialise ma nutrition en mode auto (0 kcal d'ajustement EWMA) et vérifie mes macros">Reset nutrition auto</button>
        </div>

        <form id="coach-chat-form" class="input-action-row">
          <input id="coach-input" class="input" type="text" required placeholder="Ex. Passe à 2450 kcal P 185g, ou passe en Full Body 3j..." ${state.coachBusy ? 'disabled' : ''} />
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
      ].slice(-16);
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
        showToast('Repère retiré de la mémoire du Coach.');
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

    const refreshAllProfileDataFromDB = async () => {
      const pid = state.profile.id;
      const today = getTodayISO();
      const [freshProfile, freshProg, freshBio, freshNutAll, freshHyd, freshMsgs] = await Promise.all([
        getActiveProfile(),
        getActiveProgram(pid),
        listBiometrics(pid),
        listNutritionLogs(pid),
        getHydrationForDate(pid, today),
        listCoachMessages(pid),
      ]);
      if (freshProfile && freshProfile.id === pid) {
        state.profile = freshProfile;
        state.profiles = await listProfiles();
      }
      if (freshProg) state.program = freshProg;
      state.biometrics = freshBio;
      state.nutritionAll = freshNutAll;
      state.nutritionToday = freshNutAll.filter((n) => n.date === today);
      state.hydration = freshHyd;
      state.coachMessages = freshMsgs;
      state.manualKcalOffset = clampAdaptiveAdjustmentKcal(
        state.profile?.nutritionPrefs?.adaptiveAdjustmentKcal ??
          state.profile?.nutritionPrefs?.manualKcalOffset ??
          0
      );
    };

    const submitCoachQuestion = async (text) => {
      if (!text || state.coachBusy) return;
      state.coachBusy = true;

      const priorHistory = state.coachMessages.slice(-8).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Analyse déterministe de secours (proposition 1-clic & mémoire terrain)
      const { actionProposal, memoryNote } = analyzeCoachFeedbackAndProposeAction(text, state.profile, state.program);

      await addCoachMessage(state.profile.id, { role: 'user', content: text });
      state.coachMessages = await listCoachMessages(state.profile.id);
      renderProfilSubTab(slot);

      const telemetry = getDerivedTelemetry();
      const trainingSummary = buildCoachRuntimeContext(state.profile, state.program, state.workouts);
      const systemPrompt = buildAgenticCoachSystemPrompt({
        profile: state.profile,
        program: state.program,
        telemetry,
        workouts: state.workouts,
        nutritionToday: state.nutritionToday,
        hydration: state.hydration,
        activeSession: state.activeSession,
      });

      let executedBadges = [];
      let undoFn = null;
      let changedModules = [];

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

        const rawResponse = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        const parsed = parseCoachActionsResponse(rawResponse);
        let actionsToExecute = parsed.actions;

        // Repli Niveau 0 déterministe pour les commandes directes sans modèle cloud/Ollama
        if (actionsToExecute.length === 0 && res.tierUsed === 0) {
          actionsToExecute = parseTier0DeterministicActions(text, {
            profile: state.profile,
            program: state.program,
            telemetry,
          });
        }

        // Si une note mémoire terrain a été détectée et que le modèle n'a pas déjà émis SAVE_COACH_MEMORY
        if (
          memoryNote &&
          !actionsToExecute.some((a) => a.type === 'SAVE_COACH_MEMORY')
        ) {
          const existingMem = Array.isArray(state.profile.coachMemory) ? state.profile.coachMemory : [];
          if (!existingMem.some((m) => m.text === memoryNote.text)) {
            actionsToExecute = [
              ...actionsToExecute,
              { type: 'SAVE_COACH_MEMORY', payload: { text: memoryNote.text, category: memoryNote.category || 'preference' } },
            ];
          }
        }

        if (actionsToExecute.length > 0) {
          const execResult = await executeCoachActions(actionsToExecute, {
            profile: state.profile,
            program: state.program,
            biometrics: state.biometrics,
            nutritionToday: state.nutritionToday,
            todayISO: getTodayISO(),
            db: {
              updateProfile,
              saveProgram,
              resetBiometricsBaseline,
              restoreBiometricsForProfile,
              saveBiometric,
              saveNutritionLog,
              deleteNutritionLog,
            },
          });
          executedBadges = execResult.executedBadges;
          changedModules = execResult.changedModules;
          undoFn = execResult.undo;

          if (changedModules.includes('program')) {
            state.activeSession = null;
            state.selectedDayIdx = 0;
          }
        }

        const displayContent =
          parsed.cleanText ||
          (executedBadges.length > 0
            ? 'Modifications enregistrées et appliquées dans votre espace Kinetix Lab.'
            : rawResponse);

        await addCoachMessage(state.profile.id, {
          role: 'assistant',
          content: displayContent,
          tierUsed: res.tierUsed,
          provider: res.provider || null,
          fallbackReason: res.usedFallback ? res.fallbackReason : null,
          actionProposal: executedBadges.length === 0 ? actionProposal || null : null,
          actionApplied: false,
          executedBadges,
        });
      } finally {
        state.coachBusy = false;
        await refreshAllProfileDataFromDB();
        renderApp();

        if (executedBadges.length > 0 && typeof undoFn === 'function') {
          showToast(`Coach IA : ${executedBadges[0].replace(/^EXÉCUTÉ · /, '')}`, {
            undoAction: async () => {
              await undoFn();
              if (changedModules.includes('program')) {
                state.activeSession = null;
              }
              await refreshAllProfileDataFromDB();
              renderApp();
            },
          });
        }
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
                <input id="ai-key" class="input mono" type="${state.showApiKey ? 'text' : 'password'}" autocomplete="off" spellcheck="false" placeholder="Collez AQ.... / AIza... / gsk_... / sk-or-... / sk-..." value="${esc(s.apiKey)}" />
                <button type="button" class="btn btn-sm" id="btn-toggle-apikey">${state.showApiKey ? 'Masquer' : 'Voir'}</button>
              </div>
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
                    <span class="mono metric-xs">${probe.latencyMs ?? 0} ms · HTTP ${probe.httpStatus ?? 'Réseau'}${probe.ok ? ` · Vision ${probe.visionSupported ? 'Oui' : 'Non'}` : ''}</span>
                  </div>
                  <span class="mono metric-xs text-secondary">Moteur : ${esc(probe.provider || '')}${probe.visionModelUsed ? ` · Vision : ${esc(probe.visionModelUsed)}` : ''}${probe.authMode ? ` · ${esc(probe.authMode)}` : ''}</span>
                  ${
                    probe.endpointUrl
                      ? `<div class="stack-sm" style="gap: 2px;">
                          <span class="label-tech">URL appelée (sans clé)</span>
                          <code class="code-box" style="padding: 6px 8px;">${esc(probe.endpointUrl)}</code>
                        </div>`
                      : ''
                  }
                  ${
                    !probe.ok && probe.rawError
                      ? `<div class="stack-sm" style="gap: 2px;">
                          <span class="label-tech">Réponse brute serveur (HTTP ${probe.httpStatus ?? 'Réseau/CORS'})</span>
                          <pre class="code-box" style="padding: 6px 8px;">${esc(probe.rawError)}</pre>
                        </div>`
                      : ''
                  }
                  ${
                    probe.ok && !probe.visionSupported && probe.visionError
                      ? `<div class="stack-sm" style="gap: 2px;">
                          <span class="label-tech">Échec micro-test Vision (HTTP ${probe.visionHttpStatus ?? 'Réseau/CORS'})</span>
                          ${probe.visionEndpointUrl ? `<code class="code-box" style="padding: 6px 8px;">${esc(probe.visionEndpointUrl)}</code>` : ''}
                          <pre class="code-box" style="padding: 6px 8px;">${esc(probe.visionError)}</pre>
                        </div>`
                      : ''
                  }
                  <span style="font-size: 0.82rem;">${esc(probe.diagnostic || '')}</span>
                  ${
                    !probe.ok && Array.isArray(probe.suggestedModels) && probe.suggestedModels.length > 0
                      ? `<div class="stack-sm" style="gap: 6px; margin-top: 2px;">
                          <span class="label-tech text-accent">Modèles Gemini actifs recommandés (1 clic pour appliquer)</span>
                          <div class="row-wrap">
                            ${probe.suggestedModels
                              .map(
                                (mName) =>
                                  `<button type="button" class="btn btn-xs btn-primary mono" data-pick-gemini-model="${esc(mName)}">Utiliser ${esc(mName)}</button>`
                              )
                              .join('')}
                          </div>
                        </div>`
                      : ''
                  }
                  ${
                    probe.ok && !probe.visionSupported && Array.isArray(probe.visionSuggestedModels) && probe.visionSuggestedModels.length > 0
                      ? `<div class="stack-sm" style="gap: 6px; margin-top: 2px;">
                          <span class="label-tech text-accent">Modèles Gemini actifs pour la Vision (1 clic)</span>
                          <div class="row-wrap">
                            ${probe.visionSuggestedModels
                              .map(
                                (mName) =>
                                  `<button type="button" class="btn btn-xs btn-primary mono" data-pick-gemini-vision="${esc(mName)}">Vision : ${esc(mName)}</button>`
                              )
                              .join('')}
                          </div>
                        </div>`
                      : ''
                  }
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
        const rawUrl = (document.getElementById('ai-url')?.value || '').trim();
        const isGeminiUrl = s.tier2Preset === 'gemini' || rawUrl.includes('generativelanguage.googleapis.com');
        s.baseUrl = isGeminiUrl ? normalizeGeminiBaseUrl(rawUrl) : rawUrl;
        if (isGeminiUrl) {
          s.protocol = 'gemini_native';
          if (!silent) {
            const urlEl = document.getElementById('ai-url');
            if (urlEl) urlEl.value = s.baseUrl;
          }
        }
        s.model = (document.getElementById('ai-mod')?.value || '').trim();
        s.visionModel = (document.getElementById('ai-vmod')?.value || '').trim();
        s.apiKey = (document.getElementById('ai-key')?.value || '')
          .trim()
          .replace(/^["'`]+|["'`]+$/g, '')
          .replace(/[\r\n\t\s]+/g, '');
        s.groqWhisperEnabled = Boolean(document.getElementById('ai-whisper')?.checked);
      } else if (s.activeTier === 3) {
        s.tier3ModelId = document.getElementById('ai-t3-model')?.value || TIER3_MODELS[0].id;
        s.tier3AcceptedRamWarning = Boolean(document.getElementById('ai-t3-accept')?.checked);
      }
      clearTimeout(state.aiAutosaveTimer);
      state.aiSettings = await saveAISettings(state.profile.id, s);
      const statusEl = document.getElementById('ai-autosave-status');
      if (statusEl && silent) {
        statusEl.textContent = 'Enregistré automatiquement dans IndexedDB.';
      }
    };

    const scheduleSilentAIPersist = () => {
      clearTimeout(state.aiAutosaveTimer);
      state.aiAutosaveTimer = setTimeout(() => {
        persistCurrentAI({ silent: true });
      }, 300);
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

    // Auto-sauvegarde debouncée + auto-détection du fournisseur SANS jamais détruire #ai-key (zéro perte de focus)
    const keyInput = document.getElementById('ai-key');
    keyInput?.addEventListener('input', () => {
      const cleaned = keyInput.value
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/[\r\n\t\s]+/g, '');
      const detected = detectPresetFromApiKey(cleaned);
      s.apiKey = cleaned;
      if (detected && detected !== s.tier2Preset) {
        const pr = TIER2_PRESETS[detected];
        s.tier2Preset = pr.id;
        s.protocol = pr.protocol;
        s.baseUrl = pr.baseUrl;
        s.model = pr.model;
        s.visionModel = pr.visionModel;
        const presetSel = document.getElementById('ai-preset-sel');
        const urlEl = document.getElementById('ai-url');
        const modEl = document.getElementById('ai-mod');
        const vmodEl = document.getElementById('ai-vmod');
        if (presetSel) presetSel.value = pr.id;
        if (urlEl) urlEl.value = pr.baseUrl;
        if (modEl) modEl.value = pr.model;
        if (vmodEl) vmodEl.value = pr.visionModel;
        showToast(`Clé ${pr.label} détectée — fournisseur et modèle configurés.`);
      }
      scheduleSilentAIPersist();
    });

    ['ai-url', 'ai-mod', 'ai-vmod'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', scheduleSilentAIPersist);
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

    slot.querySelectorAll('[data-pick-gemini-model]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const picked = btn.dataset.pickGeminiModel;
        s.model = picked;
        s.visionModel = picked;
        s.baseUrl = normalizeGeminiBaseUrl(s.baseUrl);
        state.aiSettings = await saveAISettings(state.profile.id, s);
        state.lastProbeResult = null;
        renderProfilSubTab(slot);
        showToast(`Modèle ${picked} sélectionné — lancez "Tester la connexion".`);
      });
    });

    slot.querySelectorAll('[data-pick-gemini-vision]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const picked = btn.dataset.pickGeminiVision;
        s.visionModel = picked;
        s.baseUrl = normalizeGeminiBaseUrl(s.baseUrl);
        state.aiSettings = await saveAISettings(state.profile.id, s);
        state.lastProbeResult = null;
        renderProfilSubTab(slot);
        showToast(`Modèle vision ${picked} sélectionné — lancez "Tester la connexion".`);
      });
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
