/**
 * Kinetix Lab — Conseiller Nutritionnel Pro (js/nutrition-advisor.js)
 * Niveau diététicien du sport — 100 % fonctionnel hors-ligne (Niveau 0 déterministe)
 * et enrichi dynamiquement par le routeur IA multi-moteurs (js/ai-router.js).
 *
 * Fonctionnalités :
 * - Détection Jour d'Entraînement vs Jour de Repos (+ surcharge manuelle)
 * - Diagnostic clinique du jour & score qualité /100 (Leucine, Plancher lipides, Fibres, Hydratation)
 * - Audit consolidé sur 7 jours & alerte tendance EWMA 14–21 j avec ajustement 1 clic
 * - Recalibrage de fin de journée (2–3 options chiffrées Ciqual/Favoris) + Lissage sur 3 jours (72h)
 * - Matrice d'aliments personnalisée (À privilégier / À modérer / À limiter) filtrée régime + allergies + blessures
 * - Guide péri-entraînement & cadence des repas adaptée au nombre de repas/jour
 * - Consultation Conseiller interactive (contexte complet profil + 7j + repli Niveau 0 chiffré)
 */

import {
  CIQUAL_DB,
  ADAPTIVE_KCAL_MIN,
  ADAPTIVE_KCAL_MAX,
  computeSafeCalorieFloor,
  getProfileAdaptiveAdjustmentKcal,
  searchCiqualOffline,
  scaleFoodMacros,
} from './nutrition-db.js';
import { routeAIRequest } from './ai-router.js';

const GOAL_LABELS = Object.freeze({
  fat_loss: 'Perte de gras',
  recomp: 'Recomposition corporelle',
  lean_bulk: 'Prise de masse propre',
  hypertrophy: 'Hypertrophie maximale',
  strength: 'Force athlétique',
  health_posture: 'Santé & Longévité',
});

const DIET_LABELS = Object.freeze({
  omnivore: 'Omnivore',
  vegetarian: 'Végétarien',
  vegan: 'Végan',
  pescatarian: 'Pescétarien',
  halal: 'Halal',
  gluten_free: 'Sans gluten',
});

const ANTI_INFLAMMATORY_IDS = new Set([
  'ciq_saumon',
  'ciq_sardines',
  'ciq_noix',
  'ciq_graines_chia',
  'ciq_myrtilles',
  'ciq_huile_olive',
  'ciq_epinards',
  'ciq_brocoli',
]);

const HYDRATION_ELECTROLYTE_IDS = new Set([
  'ciq_courgette',
  'ciq_tomate',
  'ciq_epinards',
  'ciq_kiwi',
  'ciq_banane',
  'ciq_haricots_verts',
  'ciq_pomme',
]);

const MODERATE_TIMING_IDS = new Set([
  'ciq_huile_olive',
  'ciq_amandes',
  'ciq_noix',
  'ciq_beurre_cacahuete',
  'ciq_avocat',
  'ciq_chocolat_85',
  'ciq_riz_basmati_cru',
  'ciq_riz_basmati_cuit',
  'ciq_pates_completes_cru',
  'ciq_pain_complet',
  'ciq_banane',
]);

export const ADVISOR_SHORTCUTS = Object.freeze([
  {
    id: 'resto_apero',
    label: 'Je suis invité au resto / apéro ce soir : stratégie',
    prompt: 'Je suis invité au resto / apéro ce soir : donne-moi une stratégie concrète pour limiter l’impact sans me priver.',
  },
  {
    id: 'evening_hunger',
    label: 'J’ai encore faim le soir : quoi manger sans exploser mes macros',
    prompt: 'J’ai encore faim le soir : que puis-je manger maintenant sans exploser mes macros restantes ?',
  },
  {
    id: 'audit_7d',
    label: 'Audite mes 7 derniers jours (points forts & corrections)',
    prompt: 'Audite mes 7 derniers jours de nutrition : points forts, écarts récurrents et 3 corrections prioritaires.',
  },
  {
    id: 'swap_food',
    label: 'Remplace un aliment que je n’aime pas par un équivalent',
    prompt: 'Propose-moi des équivalents nutritionnels exacts pour remplacer un aliment de base (ex. skyr, poulet, avoine ou riz) selon mon profil.',
  },
]);

/* ==========================================================================
   UTILITAIRES INTERNES (DATES, FIBRES, FILTRAGE STRICT PROFIL)
   ========================================================================== */

function toISODate(date = new Date()) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysISO(isoDate, deltaDays) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + deltaDays);
  return toISODate(dt);
}

function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function roundTo5(n) {
  return Math.round(n / 5) * 5;
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function estimateLogFiber(log) {
  if (typeof log?.fiberG === 'number' && Number.isFinite(log.fiberG)) {
    return Math.max(0, log.fiberG);
  }
  const label = normalizeText(log?.label || '');
  // Tente une correspondance Ciqual par nom
  const matched = CIQUAL_DB.find((f) => label.includes(normalizeText(f.name).split('(')[0].trim()));
  if (matched && matched.kcal > 0 && log.kcal > 0) {
    const estGrams = (Number(log.kcal) / matched.kcal) * 100;
    return round1((matched.fiberG * estGrams) / 100);
  }
  // Heuristique prudente basée sur les glucides si absent
  const carbs = Number(log?.carbsG) || 0;
  return carbs >= 15 ? round1(carbs * 0.08) : 0;
}

function hasJointOrInflammationFlags(profile) {
  return Array.isArray(profile?.injuries) && profile.injuries.length > 0;
}

function getEligibleFoods(profile) {
  return searchCiqualOffline('', profile);
}

function findEligibleFood(eligible, predicate, fallbackIdx = 0) {
  return eligible.find(predicate) || eligible[fallbackIdx] || CIQUAL_DB[0];
}

/* ==========================================================================
   1. DÉTECTION JOUR D'ENTRAÎNEMENT VS JOUR DE REPOS + LISSAGE 72H ACTIF
   ========================================================================== */

export function detectTrainingDayStatus({
  workouts = [],
  activeSession = null,
  todayISO = toISODate(),
  manualOverride = 'auto', // 'auto' | 'training' | 'rest'
  profile = null,
}) {
  const workedOutToday = (workouts || []).some((w) => {
    if (!w) return false;
    if (w.date === todayISO) return true;
    if (w.startedAt && toISODate(new Date(w.startedAt)) === todayISO) return true;
    return false;
  });
  const hasActiveSessionToday = Boolean(activeSession && (!activeSession.date || activeSession.date === todayISO));
  const autoDetected = workedOutToday || hasActiveSessionToday;

  const isTrainingDay =
    manualOverride === 'training' ? true : manualOverride === 'rest' ? false : autoDetected;

  const source =
    manualOverride !== 'auto'
      ? 'Surcharge manuelle'
      : hasActiveSessionToday
        ? 'Séance en cours détectée'
        : workedOutToday
          ? 'Séance enregistrée aujourd’hui'
          : 'Aucune séance loguée ce jour';

  const goal = profile?.goal || 'recomp';
  const carbModulation = isTrainingDay
    ? goal === 'fat_loss'
      ? 'Concentre 60 % de tes glucides autour de la séance (pré + post) pour protéger la force en déficit.'
      : 'Priorise des glucides digestes en pré-séance et recharge le glycogène dans les 2 h post-séance.'
    : goal === 'lean_bulk' || goal === 'hypertrophy'
      ? 'Jour de récupération anabolique : maintiens tes protéines et lisse les glucides sur les repas principaux.'
      : 'Jour de repos : privilégie les glucides riches en fibres, le volume végétal et les oméga-3 pour maximiser la satiété.';

  return {
    isTrainingDay,
    autoDetected,
    manualOverride,
    label: isTrainingDay ? 'JOUR D’ENTRAÎNEMENT' : 'JOUR DE REPOS',
    source,
    carbModulation,
  };
}

export function getActiveSmoothingAdjustment(profile, todayISO = toISODate()) {
  const plan = profile?.nutritionPrefs?.smoothingPlan;
  if (!plan || !plan.dailyDeltaKcal || !Array.isArray(plan.activeDays)) {
    return null;
  }
  const active = plan.activeDays.includes(todayISO);
  const remainingDays = plan.activeDays.filter((d) => d >= todayISO);
  if (remainingDays.length === 0) return null;

  return {
    ...plan,
    appliesToday: active,
    remainingDaysCount: remainingDays.length,
    effectiveTodayDeltaKcal: active ? Number(plan.dailyDeltaKcal) || 0 : 0,
  };
}

export function createThreeDaySmoothingPlan(surplusKcal, currentTargetKcal, todayISO = toISODate(), safeFloorKcal = 1500) {
  const safeSurplus = Math.max(150, Math.round(Number(surplusKcal) || 0));
  const floor = Math.max(1500, Number(safeFloorKcal) || 1500);
  const maxSafeDailyReduction = Math.max(60, Math.min(250, Math.round(Math.max(0, currentTargetKcal - floor) * 0.7)));
  const rawDaily = Math.round(safeSurplus / 3 / 10) * 10;
  const dailyReduction = Math.min(maxSafeDailyReduction, Math.max(60, rawDaily));

  return {
    createdDate: todayISO,
    activeDays: [addDaysISO(todayISO, 1), addDaysISO(todayISO, 2), addDaysISO(todayISO, 3)],
    totalSurplusKcal: safeSurplus,
    dailyDeltaKcal: -dailyReduction,
    absorbedKcal: dailyReduction * 3,
  };
}

/* ==========================================================================
   2. DIAGNOSTIC CLINIQUE DU JOUR, AUDIT 7 JOURS & ALERTE EWMA 14–21 J
   ========================================================================== */

export function computeNutritionClinicalReport({
  profile,
  macros,
  consumed,
  nutritionToday = [],
  nutritionAll = [],
  hydration = { totalMl: 0 },
  adaptive = null,
  ewma = null,
  workouts = [],
  activeSession = null,
  dayModeOverride = 'auto',
  todayISO = toISODate(),
}) {
  const weightKg = Number(profile?.weightKg) || 75;
  const leucineMinG = weightKg < 62 ? 25 : 30;
  const leucineOptG = weightKg < 62 ? 35 : 40;
  const mealsPerDay = Math.max(2, Math.min(5, Number(profile?.nutritionPrefs?.mealsPerDay) || 3));

  const dayStatus = detectTrainingDayStatus({
    workouts,
    activeSession,
    todayISO,
    manualOverride: dayModeOverride,
    profile,
  });

  // Fibres réelles du jour
  const fiberTodayG = round1(
    (nutritionToday || []).reduce((sum, entry) => sum + estimateLogFiber(entry), 0)
  );
  const fiberTargetG = Number(macros?.fiberG) || 28;

  // Regroupement par prise alimentaire pour évaluer le seuil leucine (~30-40 g)
  const mealBuckets = new Map();
  for (const log of nutritionToday || []) {
    const slotKey = `${log.mealSlot || 'Repas'}_${Math.floor((log.timestamp || 0) / (45 * 60 * 1000))}`;
    const prev = mealBuckets.get(slotKey) || { kcal: 0, proteinG: 0 };
    prev.kcal += Number(log.kcal) || 0;
    prev.proteinG = round1(prev.proteinG + (Number(log.proteinG) || 0));
    mealBuckets.set(slotKey, prev);
  }
  const mealList = Array.from(mealBuckets.values());
  const leucineHits = mealList.filter((m) => m.proteinG >= leucineMinG).length;

  // 1) Score Densité Protéique & Seuil Leucine (/30)
  const proteinRatio = macros.proteinG > 0 ? consumed.proteinG / macros.proteinG : 0;
  const proteinDensityPer1000 = consumed.kcal > 0 ? Math.round((consumed.proteinG / consumed.kcal) * 1000) : 0;
  let proteinScore = 0;
  if (consumed.kcal > 0) {
    const coveragePts = Math.min(18, Math.round(Math.min(1, proteinRatio) * 18));
    const expectedHits = Math.min(mealsPerDay, Math.max(1, mealList.length));
    const leucinePts = expectedHits > 0 ? Math.min(12, Math.round((leucineHits / expectedHits) * 12)) : 0;
    proteinScore = Math.min(30, coveragePts + leucinePts);
  }

  // 2) Score Plancher Lipidique Hormonal (/25)
  const hormonalFatFloorG = Math.max(40, Math.round(weightKg * 0.75));
  const fatRatio = macros.fatG > 0 ? consumed.fatG / macros.fatG : 0;
  let fatScore = 0;
  if (consumed.kcal > 0) {
    if (consumed.fatG >= hormonalFatFloorG && fatRatio <= 1.25) {
      fatScore = 25;
    } else if (consumed.fatG < hormonalFatFloorG) {
      fatScore = Math.round(Math.min(1, consumed.fatG / hormonalFatFloorG) * 20);
    } else {
      // Excès lipidique modéré à fort
      const excessPenalty = Math.min(15, Math.round((fatRatio - 1.25) * 30));
      fatScore = Math.max(8, 25 - excessPenalty);
    }
  }

  // 3) Score Fibres & Satiété (/25)
  const fiberRatio = fiberTargetG > 0 ? fiberTodayG / fiberTargetG : 0;
  const fiberScore = consumed.kcal > 0 ? Math.min(25, Math.round(Math.min(1, fiberRatio) * 25)) : 0;

  // 4) Score Hydratation réelle vs cible (/20)
  const waterMl = Number(hydration?.totalMl) || 0;
  const waterTargetMl = Number(macros?.waterTargetMl) || 2600;
  const waterRatio = waterTargetMl > 0 ? waterMl / waterTargetMl : 0;
  const hydrationScore = Math.min(20, Math.round(Math.min(1, waterRatio) * 20));

  const totalScore = Math.min(100, proteinScore + fatScore + fiberScore + hydrationScore);
  const qualityGrade =
    nutritionToday.length === 0 && waterMl === 0
      ? 'EN ATTENTE'
      : totalScore >= 80
        ? 'OPTIMAL'
        : totalScore >= 58
          ? 'SOLIDE'
          : 'À AJUSTER';

  // Audit consolidé des 7 derniers jours
  const last7Dates = Array.from({ length: 7 }, (_, i) => addDaysISO(todayISO, -i));
  const last7Set = new Set(last7Dates);
  const dailyMap = new Map();

  for (const log of nutritionAll || []) {
    if (!log?.date || !last7Set.has(log.date)) continue;
    const prev = dailyMap.get(log.date) || { date: log.date, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, entries: 0 };
    prev.kcal += Number(log.kcal) || 0;
    prev.proteinG = round1(prev.proteinG + (Number(log.proteinG) || 0));
    prev.carbsG = round1(prev.carbsG + (Number(log.carbsG) || 0));
    prev.fatG = round1(prev.fatG + (Number(log.fatG) || 0));
    prev.fiberG = round1(prev.fiberG + estimateLogFiber(log));
    prev.entries += 1;
    dailyMap.set(log.date, prev);
  }

  const loggedDays = Array.from(dailyMap.values())
    .filter((d) => d.kcal >= 450)
    .sort((a, b) => a.date.localeCompare(b.date));

  const daysCount = loggedDays.length;
  const avgKcal = daysCount ? Math.round(loggedDays.reduce((s, d) => s + d.kcal, 0) / daysCount) : 0;
  const avgProteinG = daysCount ? round1(loggedDays.reduce((s, d) => s + d.proteinG, 0) / daysCount) : 0;
  const avgCarbsG = daysCount ? round1(loggedDays.reduce((s, d) => s + d.carbsG, 0) / daysCount) : 0;
  const avgFatG = daysCount ? round1(loggedDays.reduce((s, d) => s + d.fatG, 0) / daysCount) : 0;
  const avgFiberG = daysCount ? round1(loggedDays.reduce((s, d) => s + d.fiberG, 0) / daysCount) : 0;

  const daysOnKcalTarget = loggedDays.filter(
    (d) => Math.abs(d.kcal - macros.kcal) <= Math.max(150, macros.kcal * 0.1)
  ).length;
  const daysOnProteinTarget = loggedDays.filter((d) => d.proteinG >= macros.proteinG * 0.88).length;
  const surplusDays = loggedDays.filter((d) => d.kcal > macros.kcal + 250).length;

  const audit7d = {
    daysLogged: daysCount,
    avgKcal,
    avgProteinG,
    avgCarbsG,
    avgFatG,
    avgFiberG,
    kcalDeltaAvg: daysCount ? avgKcal - macros.kcal : 0,
    proteinDeltaAvg: daysCount ? round1(avgProteinG - macros.proteinG) : 0,
    daysOnKcalTarget,
    daysOnProteinTarget,
    surplusDays,
    adherencePct: daysCount ? Math.round((daysOnKcalTarget / daysCount) * 100) : 0,
    days: loggedDays,
  };

  // Alerte Tendance EWMA (14–21 jours)
  const ewmaAlert = buildEwmaTrendAlert({ profile, adaptive, ewma, macros });

  // État énergétique du jour
  const surplusKcal = Math.max(0, consumed.kcal - macros.kcal);
  const remKcal = Math.max(0, macros.kcal - consumed.kcal);
  const remProteinG = Math.max(0, Math.round(macros.proteinG - consumed.proteinG));
  const remCarbsG = Math.max(0, Math.round(macros.carbsG - consumed.carbsG));
  const remFatG = Math.max(0, Math.round(macros.fatG - consumed.fatG));

  return {
    dayStatus,
    score: {
      total: totalScore,
      grade: qualityGrade,
      subscores: {
        protein: {
          points: proteinScore,
          max: 30,
          label: 'Protéines & Leucine',
          detail: `${consumed.proteinG}/${macros.proteinG} g · ${leucineHits} prise(s) >= ${leucineMinG} g · ${proteinDensityPer1000} g/1000 kcal`,
          status: proteinScore >= 22 ? 'ok' : proteinScore >= 12 ? 'accent' : 'danger',
        },
        fat: {
          points: fatScore,
          max: 25,
          label: 'Plancher hormonal',
          detail: `${consumed.fatG}/${macros.fatG} g (plancher ${hormonalFatFloorG} g)`,
          status: fatScore >= 20 ? 'ok' : consumed.fatG < hormonalFatFloorG ? 'accent' : 'danger',
        },
        fiber: {
          points: fiberScore,
          max: 25,
          label: 'Fibres & Satiété',
          detail: `${fiberTodayG}/${fiberTargetG} g de fibres estimées`,
          status: fiberScore >= 18 ? 'ok' : fiberScore >= 10 ? 'accent' : 'danger',
        },
        hydration: {
          points: hydrationScore,
          max: 20,
          label: 'Hydratation réelle',
          detail: `${waterMl}/${waterTargetMl} ml (${Math.round(waterRatio * 100)} %)`,
          status: hydrationScore >= 15 ? 'ok' : hydrationScore >= 9 ? 'accent' : 'danger',
        },
      },
      leucineMinG,
      leucineOptG,
      leucineHits,
      fiberTodayG,
      fiberTargetG,
      hormonalFatFloorG,
      waterMl,
      waterTargetMl,
      waterRatioPct: Math.round(waterRatio * 100),
    },
    balance: {
      consumed,
      remKcal,
      surplusKcal,
      remProteinG,
      remCarbsG,
      remFatG,
      proteinDeficitHigh: remProteinG >= 25,
      hasSignificantSurplus: surplusKcal >= 220,
    },
    audit7d,
    ewmaAlert,
  };
}

function buildEwmaTrendAlert({ profile, adaptive, ewma, macros }) {
  const goal = profile?.goal || 'recomp';
  const latestEwma = ewma?.latestEwmaKg ?? Number(profile?.weightKg) ?? 75;
  const weeklyKg = Number(ewma?.weeklyDeltaKg) || 0;
  const weeklyPct = latestEwma > 0 ? Number(((weeklyKg / latestEwma) * 100).toFixed(2)) : 0;
  const seriesCount = ewma?.series?.length || 0;
  const safeFloorKcal = macros?.safeFloorKcal || computeSafeCalorieFloor(macros?.bmrKcal);
  const currentAdj = getProfileAdaptiveAdjustmentKcal(profile);

  // Si les cibles sont verrouillées manuellement ou par le Coach IA, l'EWMA observe sans écraser
  if (macros?.overrideLocked) {
    return {
      severity: 'info',
      statusLabel: 'CIBLES VERROUILLÉES',
      weeklyKg,
      weeklyPct,
      spanDays: adaptive?.spanDays || 14,
      headline: `EWMA ${weeklyKg >= 0 ? '+' : ''}${weeklyKg} kg/sem (${weeklyPct >= 0 ? '+' : ''}${weeklyPct} %/sem) · Mode ${macros.overrideSource === 'coach' ? 'Coach IA' : 'Manuel'}`,
      explanation:
        'Tes cibles caloriques personnalisées sont verrouillées : l’ajustement automatique EWMA est en pause jusqu’au déverrouillage ou retour en mode Auto.',
      recommendedDeltaKcal: 0,
      newTargetKcal: macros.kcal,
    };
  }

  const boundedDelta = (desired) => {
    if (!desired) return 0;
    if (desired < 0) return Math.max(ADAPTIVE_KCAL_MIN - currentAdj, desired);
    return Math.min(ADAPTIVE_KCAL_MAX - currentAdj, desired);
  };

  // Priorité à la proposition calibrée du moteur TDEE adaptatif si présente
  if (adaptive?.adjustmentProposal) {
    const delta = boundedDelta(adaptive.adjustmentProposal.deltaKcal);
    if (delta !== 0) {
      return {
        severity: 'action',
        statusLabel: 'AJUSTEMENT RECOMMANDÉ',
        weeklyKg,
        weeklyPct,
        spanDays: adaptive.spanDays || 14,
        headline: `Tendance EWMA ${weeklyKg >= 0 ? '+' : ''}${weeklyKg} kg/sem (${weeklyPct >= 0 ? '+' : ''}${weeklyPct} %/sem)`,
        explanation: adaptive.adjustmentProposal.reason,
        recommendedDeltaKcal: delta,
        newTargetKcal: Math.max(safeFloorKcal, macros.kcal + delta),
      };
    }
  }

  if (seriesCount < 4) {
    return {
      severity: 'info',
      statusLabel: 'CALIBRATION EWMA',
      weeklyKg,
      weeklyPct,
      spanDays: 0,
      headline: `${seriesCount}/4 pesées cohérentes enregistrées (fenêtre 14–21 j)`,
      explanation:
        'Ajoute des pesées matinales dans Labo & Évolution pour lisser les fluctuations hydriques et déclencher les ajustements automatiques bornés à ±400 kcal.',
      recommendedDeltaKcal: 0,
      newTargetKcal: macros.kcal,
    };
  }

  // Évaluation vitesse EWMA par objectif même avant 5 jours complets de logs
  if (goal === 'fat_loss') {
    if (weeklyPct > -0.2) {
      const delta = boundedDelta(-150);
      return {
        severity: delta !== 0 ? 'action' : 'info',
        statusLabel: delta !== 0 ? 'VITESSE TROP LENTE' : 'PLAFOND AJUSTEMENT ATTEINT',
        weeklyKg,
        weeklyPct,
        spanDays: adaptive?.spanDays || 14,
        headline: `EWMA ${weeklyKg >= 0 ? '+' : ''}${weeklyKg} kg/sem (${weeklyPct} %/sem) · Cible : -0,4 à -0,8 %/sem`,
        explanation:
          delta !== 0
            ? `La tendance pondérale stagne malgré le déficit théorique. Réduire de ${Math.abs(delta)} kcal/j (ou +1 500 pas/j) relancera la perte sans sacrifier la masse maigre.`
            : 'Ajustement adaptatif déjà au plancher sécuritaire (-400 kcal). Vérifie la pesée des aliments ou augmente les pas quotidiens.',
        recommendedDeltaKcal: delta,
        newTargetKcal: Math.max(safeFloorKcal, macros.kcal + delta),
      };
    }
    if (weeklyPct < -1.05) {
      const delta = boundedDelta(+125);
      return {
        severity: 'danger',
        statusLabel: 'PERTE TROP RAPIDE',
        weeklyKg,
        weeklyPct,
        spanDays: adaptive?.spanDays || 14,
        headline: `EWMA ${weeklyKg} kg/sem (${weeklyPct} %/sem) · Risque catabolique`,
        explanation:
          'Rythme supérieur à 1 %/semaine : remonter les glucides péri-séance protège les performances et les tissus.',
        recommendedDeltaKcal: delta,
        newTargetKcal: macros.kcal + delta,
      };
    }
    return {
      severity: 'ok',
      statusLabel: 'RYTHME OPTIMAL',
      weeklyKg,
      weeklyPct,
      spanDays: adaptive?.spanDays || 14,
      headline: `EWMA ${weeklyKg} kg/sem (${weeklyPct} %/sem) dans la zone cible`,
      explanation: 'Vitesse idéale pour oxyder le tissu adipeux tout en préservant ta force. Maintiens ta cible calorique actuelle.',
      recommendedDeltaKcal: 0,
      newTargetKcal: macros.kcal,
    };
  }

  if (goal === 'lean_bulk' || goal === 'hypertrophy') {
    if (weeklyPct < 0.1) {
      const delta = boundedDelta(+150);
      return {
        severity: delta !== 0 ? 'action' : 'info',
        statusLabel: delta !== 0 ? 'SURPLUS INSUFFISANT' : 'PLAFOND AJUSTEMENT ATTEINT',
        weeklyKg,
        weeklyPct,
        spanDays: adaptive?.spanDays || 14,
        headline: `EWMA ${weeklyKg >= 0 ? '+' : ''}${weeklyKg} kg/sem (${weeklyPct} %/sem) · Cible : +0,2 à +0,4 %/sem`,
        explanation:
          delta !== 0
            ? `La prise de masse stagne : ajoute +${delta} kcal/j principalement en glucides digestes autour des séances.`
            : 'Ajustement adaptatif déjà au plafond sécuritaire (+400 kcal). Réévalue ton profil ou utilise la surcharge manuelle.',
        recommendedDeltaKcal: delta,
        newTargetKcal: macros.kcal + delta,
      };
    }
    if (weeklyPct > 0.5) {
      const delta = boundedDelta(-100);
      return {
        severity: delta !== 0 ? 'action' : 'info',
        statusLabel: 'PRISE TROP RAPIDE',
        weeklyKg,
        weeklyPct,
        spanDays: adaptive?.spanDays || 14,
        headline: `EWMA +${weeklyKg} kg/sem (+${weeklyPct} %/sem) · Excès adipeux probable`,
        explanation:
          delta !== 0
            ? `Réduis légèrement de ${delta} kcal/j pour maximiser le ratio muscle/gras sur la durée du mésocycle.`
            : 'Ajustement déjà au plancher (-400 kcal). Contrôle la précision de ton suivi.',
        recommendedDeltaKcal: delta,
        newTargetKcal: Math.max(safeFloorKcal, macros.kcal + delta),
      };
    }
    return {
      severity: 'ok',
      statusLabel: 'SURPLUS MAÎTRISÉ',
      weeklyKg,
      weeklyPct,
      spanDays: adaptive?.spanDays || 14,
      headline: `EWMA +${weeklyKg} kg/sem (+${weeklyPct} %/sem) · Prise propre`,
      explanation: 'Rythme anabolique optimal : garde cette cible tant que tes charges progressent en séance.',
      recommendedDeltaKcal: 0,
      newTargetKcal: macros.kcal,
    };
  }

  // Recomp / Strength / Health
  if (Math.abs(weeklyPct) > 0.45) {
    const delta = boundedDelta(weeklyPct > 0 ? -120 : +120);
    return {
      severity: delta !== 0 ? 'action' : 'info',
      statusLabel: 'DÉRIVE PONDÉRALE',
      weeklyKg,
      weeklyPct,
      spanDays: adaptive?.spanDays || 14,
      headline: `EWMA ${weeklyKg >= 0 ? '+' : ''}${weeklyKg} kg/sem (${weeklyPct >= 0 ? '+' : ''}${weeklyPct} %/sem)`,
      explanation:
        delta !== 0
          ? `Pour une ${GOAL_LABELS[goal] || 'recomposition'} stable, réajuste de ${delta > 0 ? '+' : ''}${delta} kcal/j afin de stabiliser la tendance.`
          : 'Plafond d’ajustement adaptatif atteint (±400 kcal). Réinitialise l’EWMA si ton poids de référence a changé.',
      recommendedDeltaKcal: delta,
      newTargetKcal: Math.max(safeFloorKcal, macros.kcal + delta),
    };
  }

  return {
    severity: 'ok',
    statusLabel: 'ÉQUILIBRE VALIDÉ',
    weeklyKg,
    weeklyPct,
    spanDays: adaptive?.spanDays || 14,
    headline: `EWMA ${weeklyKg >= 0 ? '+' : ''}${weeklyKg} kg/sem (${weeklyPct >= 0 ? '+' : ''}${weeklyPct} %/sem)`,
    explanation: 'Tendance stable et cohérente avec ton objectif : aucun ajustement calorique requis cette semaine.',
    recommendedDeltaKcal: 0,
    newTargetKcal: macros.kcal,
  };
}

/* ==========================================================================
   3. RECALIBRAGE DE FIN DE JOURNÉE (2–3 OPTIONS CHIFFRÉES) + LISSAGE 72H
   ========================================================================== */

export function buildEndOfDayRecalibration({ profile, macros, consumed, favorites = [], todayISO = toISODate() }) {
  const eligible = getEligibleFoods(profile);
  const remKcal = Math.max(0, macros.kcal - consumed.kcal);
  const surplusKcal = Math.max(0, consumed.kcal - macros.kcal);
  const remP = Math.max(0, Math.round(macros.proteinG - consumed.proteinG));
  const remC = Math.max(0, Math.round(macros.carbsG - consumed.carbsG));
  const remF = Math.max(0, Math.round(macros.fatG - consumed.fatG));

  const leanProt1 = findEligibleFood(
    eligible,
    (f) => f.proteinG >= 18 && f.fatG <= 3 && !f.id.includes('whey') && !f.id.includes('prot_')
  );
  const leanProt2 = findEligibleFood(
    eligible,
    (f) => f.id !== leanProt1.id && f.proteinG >= 14 && f.fatG <= 6 && !f.id.includes('whey') && !f.id.includes('prot_')
  );
  const dairyOrPlantSnack = findEligibleFood(
    eligible,
    (f) => ['ciq_skyr', 'ciq_fromage_blanc_0', 'ciq_cottage', 'ciq_tofu_ferme', 'ciq_edamame'].includes(f.id)
  );
  const powderProt = findEligibleFood(
    eligible,
    (f) => f.id === 'ciq_whey_iso' || f.id === 'ciq_prot_pois'
  );
  const vegHighVol = findEligibleFood(eligible, (f) => ['ciq_brocoli', 'ciq_haricots_verts', 'ciq_courgette', 'ciq_epinards'].includes(f.id));
  const cleanCarb = findEligibleFood(eligible, (f) => ['ciq_patate_douce', 'ciq_pomme_terre', 'ciq_riz_basmati_cuit', 'ciq_quinoa_cuit'].includes(f.id));
  const berries = findEligibleFood(eligible, (f) => ['ciq_myrtilles', 'ciq_pomme', 'ciq_kiwi', 'ciq_banane'].includes(f.id));
  const fatQuality = findEligibleFood(eligible, (f) => ['ciq_huile_olive', 'ciq_avocat', 'ciq_amandes', 'ciq_noix'].includes(f.id));

  const buildOption = (id, title, tag, rationale, components) => {
    const items = components
      .filter((c) => c.food && c.grams > 0)
      .map((c) => {
        const scaled = scaleFoodMacros(c.food, c.grams);
        return {
          foodId: c.food.id,
          name: c.food.name,
          aisle: c.food.aisle,
          ...scaled,
        };
      });
    const totals = items.reduce(
      (acc, i) => ({
        kcal: acc.kcal + i.kcal,
        proteinG: round1(acc.proteinG + i.proteinG),
        carbsG: round1(acc.carbsG + i.carbsG),
        fatG: round1(acc.fatG + i.fatG),
        fiberG: round1(acc.fiberG + i.fiberG),
      }),
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 }
    );
    return { id, title, tag, rationale, items, totals };
  };

  let situationCode = 'balanced';
  let situationSummary = '';
  const options = [];

  if (surplusKcal >= 220) {
    situationCode = 'surplus';
    situationSummary = `Surplus constaté de +${surplusKcal} kcal aujourd’hui${remP >= 18 ? ` avec encore ${remP} g de protéines à sécuriser` : ''}. Ne saute pas de repas et n’entre pas en restriction extrême : ancre tes protéines maigres ou active le lissage sur 72 h.`;

    if (remP >= 15) {
      const targetP = Math.min(40, Math.max(20, remP));
      const protGrams = Math.max(80, Math.min(200, roundTo5((targetP / Math.max(8, leanProt1.proteinG)) * 100)));
      options.push(
        buildOption(
          'rec_surplus_plate',
          'Assiette Protéines Maigres + Volume Végétal',
          'PROTECTION MUSCULAIRE',
          'Apporte un maximum de protéines et de satiété pour un coût calorique minimal.',
          [
            { food: leanProt1, grams: protGrams },
            { food: vegHighVol, grams: 250 },
          ]
        )
      );

      const scoopG = Math.max(20, Math.min(40, roundTo5((targetP * 0.75 / Math.max(20, powderProt.proteinG)) * 100)));
      options.push(
        buildOption(
          'rec_surplus_snack',
          'Collation Ultra-Maigre Haute Leucine',
          'RAPIDE · < 220 KCAL',
          'Verrouille le quota protéique du soir sans rajouter de lipides ni de glucides superflus.',
          [
            { food: dairyOrPlantSnack, grams: 150 },
            { food: powderProt, grams: scoopG },
          ]
        )
      );
    } else {
      options.push(
        buildOption(
          'rec_surplus_light',
          'Bol Végétal & Fibres Coupe-Faim',
          'SATIÉTÉ · < 140 KCAL',
          'Protéines déjà atteintes : privilégie le volume hydrique et les fibres si la faim arrive.',
          [
            { food: vegHighVol, grams: 250 },
            { food: berries, grams: 80 },
          ]
        )
      );
    }
  } else if (remP >= 25 && remKcal <= Math.max(420, remP * 6.5)) {
    // Retard protéines sur budget calorique serré (ex: restaurant / écart le midi)
    situationCode = 'protein_catchup_tight';
    situationSummary = `Budget serré (${remKcal} kcal restants) pour ${remP} g de protéines à combler : privilégie une densité protéique maximale (> 75 g/1000 kcal).`;

    const pGrams1 = Math.max(100, Math.min(260, roundTo5((Math.min(remP, 50) / Math.max(10, leanProt1.proteinG)) * 100)));
    options.push(
      buildOption(
        'rec_tight_1',
        'Dîner Haute Densité Protéique',
        'RATIO P/KCAL MAX',
        'Comble le déficit protéique tout en tenant dans le budget calorique restant.',
        [
          { food: leanProt1, grams: pGrams1 },
          { food: vegHighVol, grams: 220 },
        ]
      )
    );

    const pGrams2 = Math.max(100, Math.min(240, roundTo5((Math.min(remP, 45) / Math.max(10, leanProt2.proteinG)) * 100)));
    options.push(
      buildOption(
        'rec_tight_2',
        'Alternative Maigre + Fruits Rouges',
        'ANTI-FRINGALE',
        'Option digeste qui couvre le seuil leucine tout en apportant des micronutriments.',
        [
          { food: leanProt2, grams: pGrams2 },
          { food: berries, grams: 100 },
        ]
      )
    );

    const snackG = 200;
    const neededFromPowder = Math.max(0, Math.min(remP, 45) - (dairyOrPlantSnack.proteinG * snackG) / 100);
    const powderG = neededFromPowder > 6 ? Math.min(40, roundTo5((neededFromPowder / Math.max(20, powderProt.proteinG)) * 100)) : 0;
    options.push(
      buildOption(
        'rec_tight_3',
        'Bol Express Protéiné (0 cuisson)',
        '2 MINUTES',
        'Idéal tard le soir pour tomber pile sur tes protéines sans cuisiner.',
        [
          { food: dairyOrPlantSnack, grams: snackG },
          ...(powderG > 0 ? [{ food: powderProt, grams: powderG }] : []),
          { food: berries, grams: 80 },
        ]
      )
    );
  } else if (remKcal >= 250) {
    // Budget confortable : proposer 2 repas complets recalibrés + 1 favori compatible s'il existe
    situationCode = 'rebalance_normal';
    situationSummary = `Il te reste ${remKcal} kcal (P ${remP} g · G ${remC} g · L ${remF} g). Voici des options calibrées au gramme près pour clôturer ta journée proprement.`;

    const targetP = Math.max(25, Math.min(55, remP || 35));
    const pG = Math.max(90, Math.min(260, roundTo5((targetP / Math.max(10, leanProt1.proteinG)) * 100)));
    const targetC = Math.max(20, Math.min(90, remC));
    const cG = Math.max(80, Math.min(320, roundTo5((targetC / Math.max(10, cleanCarb.carbsG)) * 100)));
    const fG = remF >= 12 ? Math.max(10, Math.min(40, roundTo5(((remF * 0.55) / Math.max(10, fatQuality.fatG)) * 100))) : 0;

    options.push(
      buildOption(
        'rec_bal_1',
        'Assiette Complète de Clôture',
        'ÉQUILIBRE MACROS',
        'Aligne simultanément protéines, glucides complexes et plancher lipidique.',
        [
          { food: leanProt1, grams: pG },
          { food: cleanCarb, grams: cG },
          { food: vegHighVol, grams: 200 },
          ...(fG > 0 ? [{ food: fatQuality, grams: fG }] : []),
        ]
      )
    );

    const p2G = Math.max(90, Math.min(240, roundTo5((targetP / Math.max(10, leanProt2.proteinG)) * 100)));
    options.push(
      buildOption(
        'rec_bal_2',
        'Option Digeste & Satiété Soir',
        'DIGESTION LÉGÈRE',
        'Alternative légère pour bien dormir tout en atteignant ton quota protéique.',
        [
          { food: leanProt2, grams: p2G },
          { food: vegHighVol, grams: 220 },
          { food: berries, grams: 120 },
        ]
      )
    );

    // Vérifie si un favori utilisateur rentre proprement dans le budget restant
    const matchingFav = (favorites || []).find(
      (fav) => fav.kcal > 0 && fav.kcal <= remKcal + 80 && fav.kcal >= remKcal * 0.35
    );
    if (matchingFav) {
      options.push({
        id: `rec_fav_${matchingFav.id}`,
        title: `Favori compatible : ${matchingFav.name}`,
        tag: 'VOTRE FAVORI',
        rationale: 'Repas déjà enregistré dans vos favoris et directement compatible avec votre reste du jour.',
        items: [
          {
            foodId: matchingFav.id,
            name: matchingFav.name,
            grams: 100,
            kcal: Math.round(matchingFav.kcal),
            proteinG: round1(matchingFav.proteinG),
            carbsG: round1(matchingFav.carbsG),
            fatG: round1(matchingFav.fatG),
            fiberG: 0,
          },
        ],
        totals: {
          kcal: Math.round(matchingFav.kcal),
          proteinG: round1(matchingFav.proteinG),
          carbsG: round1(matchingFav.carbsG),
          fatG: round1(matchingFav.fatG),
          fiberG: 0,
        },
        isFavorite: true,
      });
    } else {
      const snackG = 220;
      options.push(
        buildOption(
          'rec_bal_3',
          'Collation Structurée (Protéines + Fibres)',
          'COLLATION PRO',
          'Complète sereinement les apports restants sans préparation complexe.',
          [
            { food: dairyOrPlantSnack, grams: snackG },
            { food: berries, grams: 120 },
            ...(remF >= 10 ? [{ food: fatQuality, grams: 15 }] : []),
          ]
        )
      );
    }
  } else {
    situationCode = 'on_target';
    situationSummary = `Cibles quasiment atteintes (reste ${remKcal} kcal · P ${remP} g). Privilégie l’hydratation ou une micro-collation très légère si besoin.`;
    options.push(
      buildOption(
        'rec_micro_1',
        'Micro-Collation Satiété (< 150 kcal)',
        'FINITION',
        'Coupe-faim léger qui préserve ton bilan du jour.',
        [
          { food: dairyOrPlantSnack, grams: 150 },
          { food: berries, grams: 60 },
        ]
      )
    );
  }

  const smoothingProposal =
    surplusKcal >= 220 ? createThreeDaySmoothingPlan(surplusKcal, macros.kcal, todayISO, macros.safeFloorKcal) : null;

  return {
    situationCode,
    situationSummary,
    remKcal,
    surplusKcal,
    remP,
    remC,
    remF,
    options: options.slice(0, 3),
    smoothingProposal,
  };
}

/* ==========================================================================
   4. MATRICE D'ALIMENTS PERSONNALISÉE (À PRIVILÉGIER / MODÉRER / LIMITER)
   ========================================================================== */

export function buildPersonalizedFoodMatrix({ profile, report = null }) {
  const goal = profile?.goal || 'recomp';
  const diet = profile?.nutritionPrefs?.dietType || 'omnivore';
  const allergies = profile?.nutritionPrefs?.allergies || [];
  const hasInjuries = hasJointOrInflammationFlags(profile);
  const lowHydration = (report?.score?.waterRatioPct ?? 100) < 70;
  const eligible = getEligibleFoods(profile);

  // --- 1. À PRIVILÉGIER (HAUTE DENSITÉ) ---
  const scoredPrioritize = eligible
    .filter((f) => !['ciq_huile_olive', 'ciq_chocolat_85', 'ciq_beurre_cacahuete'].includes(f.id))
    .map((f) => {
      const pPer1000 = f.kcal > 0 ? (f.proteinG / f.kcal) * 1000 : 0;
      const fiberPer1000 = f.kcal > 0 ? (f.fiberG / f.kcal) * 1000 : 0;
      let score = 0;
      const tags = [];
      let reason = '';

      if (goal === 'fat_loss' || goal === 'recomp') {
        score += pPer1000 * 0.45 + fiberPer1000 * 0.65;
        if (pPer1000 >= 130) {
          tags.push('RATIO P/KCAL');
          reason = `Très forte densité protéique (${Math.round(pPer1000)} g/1000 kcal) : protège la masse maigre en déficit.`;
        } else if (f.fiberG >= 2.5 && f.kcal <= 130) {
          tags.push('SATIÉTÉ');
          reason = `Volume élevé pour ${f.kcal} kcal/100 g (${f.fiberG} g fibres) : coupe la faim durablement.`;
        }
      } else {
        // Prise de masse / Hypertrophie / Force / Santé
        score += pPer1000 * 0.3 + (f.carbsG >= 18 && f.fiberG <= 4 ? 28 : 0) + (f.proteinG >= 15 ? 25 : 0);
        if (f.carbsG >= 18 && f.fiberG <= 4) {
          tags.push('GLUCIDES DIGESTES');
          reason = `Carburant glucidique propre (${f.carbsG} g/100 g) pour soutenir le volume d’entraînement sans lourdeur.`;
        } else if (f.proteinG >= 15) {
          tags.push('ANABOLISME');
          reason = `Source protéique complète (${f.proteinG} g/100 g) idéale pour la synthèse musculaire.`;
        }
      }

      if (hasInjuries && ANTI_INFLAMMATORY_IDS.has(f.id)) {
        score += 48;
        tags.unshift('ANTI-INFLAMMATOIRE');
        reason = `Riche en oméga-3 / polyphénols : utile face aux sensibilités articulaires déclarées sur ton profil.`;
      }

      if (lowHydration && HYDRATION_ELECTROLYTE_IDS.has(f.id)) {
        score += 36;
        tags.unshift('EAU & ÉLECTROLYTES');
        reason = `Riche en eau et potassium : aide à remonter ton hydratation (${report?.score?.waterRatioPct ?? 0} % de la cible).`;
      }

      if (!reason) {
        reason = `Profil équilibré (${f.kcal} kcal · P ${f.proteinG}g · G ${f.carbsG}g · F ${f.fiberG}g/100g).`;
      }

      const defaultGrams =
        f.id.includes('whey') || f.id.includes('prot_')
          ? 30
          : f.id.includes('noix') || f.id.includes('graines_chia')
            ? 25
            : f.kcal <= 70
              ? 200
              : f.carbsG >= 55
                ? 80
                : 150;

      return {
        food: f,
        score,
        tag: tags[0] || 'HAUTE DENSITÉ',
        reason,
        defaultGrams,
        weeklyGrams: defaultGrams * 5,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // --- 2. À MODÉRER (TIMING CIBLÉ / PESÉE) ---
  const moderateItems = eligible
    .filter((f) => MODERATE_TIMING_IDS.has(f.id))
    .slice(0, 5)
    .map((f) => {
      let tag = 'À PESER';
      let reason = '';
      let defaultGrams = 30;

      if (f.fatG >= 15) {
        tag = 'DENSE EN LIPIDES';
        defaultGrams = f.id === 'ciq_huile_olive' ? 10 : f.id === 'ciq_avocat' ? 80 : 25;
        reason = `${f.kcal} kcal/100 g : excellent pour les hormones mais à peser strictement et éloigner du pré-séance immédiat.`;
      } else {
        tag = 'TIMING PÉRI-SÉANCE';
        defaultGrams = f.carbsG >= 50 ? 70 : 120;
        reason = `Glucides ciblés (${f.carbsG} g/100 g) : à réserver en pré/post-entraînement pour optimiser le glycogène.`;
      }

      return {
        food: f,
        tag,
        reason,
        defaultGrams,
        weeklyGrams: defaultGrams * 5,
      };
    });

  // --- 3. À LIMITER / ÉVITER POUR TON OBJECTIF ---
  const avoidItems = [
    {
      name: 'Calories liquides (sodas, jus industriels, alcool)',
      tag: '0 SATIÉTÉ',
      reason: 'Apport calorique instantané sans signal de satiété ; l’alcool freine la synthèse protéique musculaire et dégrade le sommeil profond.',
    },
    {
      name: 'Ultra-transformés gras + sucrés (viennoiseries, biscuits, snacks)',
      tag: 'HYPER-PALATABLE',
      reason: 'Très haute densité énergétique (~450–550 kcal/100 g), pauvres en protéines/fibres et déclencheurs de fringales réactives.',
    },
  ];

  if (goal === 'fat_loss' || goal === 'recomp') {
    avoidItems.push({
      name: 'Ajouts « invisibles » non pesés (huiles au jugé, sauces crémeuses, granola)',
      tag: 'PIÈGE DÉFICIT',
      reason: '2 cuillères d’huile ou une sauce non comptée ajoutent 200 à 350 kcal et annulent silencieusement le déficit du jour.',
    });
  } else {
    avoidItems.push({
      name: 'Fritures lourdes et repas très gras juste avant l’entraînement',
      tag: 'VIDANGE LENTE',
      reason: 'Ralentissent la digestion de 3 à 4 h, réduisent la congestion musculaire et nuisent au confort en séance.',
    });
  }

  if (hasInjuries) {
    avoidItems.push({
      name: 'Huiles raffinées riches en oméga-6 (tournesol, maïs) & sucres libres',
      tag: 'PRO-INFLAMMATOIRE',
      reason: 'Déséquilibrent le ratio oméga-6/oméga-3 et peuvent entretenir l’inconfort sur tes zones articulaires sensibles.',
    });
  } else {
    avoidItems.push({
      name: 'Caféine après 15 h & dîners très riches < 2 h du coucher',
      tag: 'RÉCUPÉRATION',
      reason: 'Réduisent la qualité du sommeil profond, la sécrétion nocturne de GH et le Readiness du lendemain.',
    });
  }

  return {
    dietLabel: DIET_LABELS[diet] || diet,
    goalLabel: GOAL_LABELS[goal] || goal,
    allergies,
    hasInjuries,
    lowHydration,
    prioritize: {
      title: 'À PRIVILÉGIER — HAUTE DENSITÉ',
      summary: hasInjuries
        ? `Optimisé pour ${GOAL_LABELS[goal] || goal} + soutien anti-inflammatoire articulaire (${DIET_LABELS[diet] || diet}).`
        : `Optimisé pour ${GOAL_LABELS[goal] || goal} (${DIET_LABELS[diet] || diet}${allergies.length ? `, hors ${allergies.join(', ')}` : ''}).`,
      items: scoredPrioritize,
    },
    moderate: {
      title: 'À MODÉRER — TIMING CIBLÉ',
      summary: 'Aliments utiles et sains, mais à peser ou placer autour de l’entraînement.',
      items: moderateItems,
    },
    avoid: {
      title: 'À LIMITER / ÉVITER POUR TON OBJECTIF',
      summary: 'Principaux freins à ta composition corporelle, ta satiété et ta récupération.',
      items: avoidItems,
    },
  };
}

/* ==========================================================================
   5. GUIDE PÉRI-ENTRAÎNEMENT & TIMING DES REPAS (SELON MEALSPERDAY)
   ========================================================================== */

export function buildPeriWorkoutGuide({ profile, macros, isTrainingDay = true }) {
  const goal = profile?.goal || 'recomp';
  const mealsPerDay = Math.max(2, Math.min(5, Number(profile?.nutritionPrefs?.mealsPerDay) || 3));
  const eligible = getEligibleFoods(profile);

  const preCarb = findEligibleFood(eligible, (f) => ['ciq_banane', 'ciq_riz_basmati_cuit', 'ciq_flocons_avoine', 'ciq_pain_complet'].includes(f.id));
  const preProt = findEligibleFood(eligible, (f) => ['ciq_whey_iso', 'ciq_prot_pois', 'ciq_skyr', 'ciq_blanc_oeuf', 'ciq_dinde_escalope'].includes(f.id));
  const postProt = findEligibleFood(eligible, (f) => f.proteinG >= 18 && f.fatG <= 5 && !f.id.includes('whey') && !f.id.includes('prot_'));
  const postCarb = findEligibleFood(eligible, (f) => ['ciq_riz_basmati_cuit', 'ciq_pomme_terre', 'ciq_patate_douce', 'ciq_quinoa_cuit'].includes(f.id));
  const eveningProt = findEligibleFood(eligible, (f) => ['ciq_skyr', 'ciq_fromage_blanc_0', 'ciq_cottage', 'ciq_tofu_ferme', 'ciq_cabillaud'].includes(f.id));
  const eveningVeg = findEligibleFood(eligible, (f) => ['ciq_brocoli', 'ciq_courgette', 'ciq_haricots_verts', 'ciq_epinards'].includes(f.id));

  const preCarbsG = Math.round(macros.carbsG * (isTrainingDay ? 0.25 : 0.15));
  const preProtG = Math.max(20, Math.min(35, Math.round(macros.proteinG * 0.18)));
  const postProtG = Math.max(30, Math.min(48, Math.round(macros.proteinG / mealsPerDay * 1.1)));
  const postCarbsG = Math.round(macros.carbsG * (goal === 'fat_loss' ? 0.3 : 0.38));

  const preCarbGrams = Math.max(60, Math.min(220, roundTo5((preCarbsG / Math.max(12, preCarb.carbsG)) * 100)));
  const preProtGrams = Math.max(25, Math.min(200, roundTo5((preProtG / Math.max(8, preProt.proteinG)) * 100)));
  const postProtGrams = Math.max(110, Math.min(240, roundTo5((postProtG / Math.max(12, postProt.proteinG)) * 100)));
  const postCarbGrams = Math.max(100, Math.min(320, roundTo5((postCarbsG / Math.max(12, postCarb.carbsG)) * 100)));

  const windows = [
    {
      id: 'pre',
      window: 'PRÉ-SÉANCE (60–90 MIN AVANT)',
      focus: isTrainingDay
        ? `Glucides digestes (~${preCarbsG} g) + Protéines modérées (~${preProtG} g) · Lipides < 10 g & fibres réduites`
        : 'Jour de repos : pas de charge glucidique rapide nécessaire, reste sur des repas complets riches en fibres.',
      rationale: 'Garantit un glucose sanguin stable et une vidange gastrique rapide sans lourdeur ni reflux en séance.',
      example: `${preCarb.name} (${preCarbGrams} g) + ${preProt.name} (${preProtGrams} g) + 400 ml d’eau + pincée de sel.`,
    },
    {
      id: 'post',
      window: 'POST-SÉANCE (DANS LES 2 H)',
      focus: `Protéines complètes (${postProtG} g · seuil leucine atteint) + Recharge glycogène (~${postCarbsG} g glucides)`,
      rationale:
        goal === 'fat_loss'
          ? 'Maximise la synthèse protéique musculaire et la récupération nerveuse tout en restant dans le déficit.'
          : 'Restaure rapidement le glycogène musculaire et amplifie la réponse anabolique post-effort.',
      example: `${postProt.name} (${postProtGrams} g) + ${postCarb.name} (${postCarbGrams} g) + légumes vapeur (150 g).`,
    },
    {
      id: 'evening',
      window: 'SOIR / COUPE-FAIM (2–3 H AVANT COUCHER)',
      focus: 'Protéines à digestion lente (25–35 g) + Volume végétal + Fibres solubles',
      rationale: 'Maintient l’aminoacidémie nocturne et coupe les fringales tardives sans perturber la température corporelle du sommeil.',
      example: `${eveningProt.name} (200 g) ou ${eveningVeg.name} (250 g) + source protéique maigre + tisane non caféinée.`,
    },
  ];

  // Répartition journalière exacte selon mealsPerDay (2 à 5 repas)
  const slotLayouts = {
    2: [
      { label: 'Repas 1 (12h–13h)', share: 0.45, note: 'Protéines élevées + fibres + glucides modérés' },
      { label: 'Repas 2 (19h–20h · Post-séance)', share: 0.55, note: 'Plus gros apport glucides/protéines + satiété soir' },
    ],
    3: [
      { label: 'Repas 1 (Matin)', share: 0.28, note: 'Ancrage protéines (>= 30 g) + lipides qualité' },
      { label: 'Repas 2 (Déjeuner / Pré-séance)', share: 0.36, note: 'Glucides digestes + protéines maigres' },
      { label: 'Repas 3 (Dîner / Post-séance)', share: 0.36, note: 'Protéines complètes + recharge + volume végétal' },
    ],
    4: [
      { label: 'Repas 1 (Matin)', share: 0.24, note: 'Protéines + fibres + lipides' },
      { label: 'Repas 2 (Déjeuner)', share: 0.3, note: 'Assiette complète équilibrée' },
      { label: 'Collation Péri-Séance', share: 0.16, note: 'Glucides rapides + 25–30 g protéines, peu de lipides' },
      { label: 'Repas 4 (Dîner)', share: 0.3, note: 'Protéines + légumes + satiété soir' },
    ],
    5: [
      { label: 'Repas 1 (Matin)', share: 0.2, note: 'Protéines + glucides complexes' },
      { label: 'Repas 2 (Déjeuner)', share: 0.25, note: 'Protéines + féculents + légumes' },
      { label: 'Collation Pré-Séance', share: 0.15, note: 'Glucides digestes + 25 g protéines' },
      { label: 'Repas 4 (Post-Séance / Dîner)', share: 0.26, note: 'Recharge glycogène + protéines complètes' },
      { label: 'Collation Soir', share: 0.14, note: 'Protéines lentes / coupe-faim' },
    ],
  };

  const cadence = (slotLayouts[mealsPerDay] || slotLayouts[3]).map((slot) => ({
    ...slot,
    kcal: Math.round(macros.kcal * slot.share),
    proteinG: Math.round(macros.proteinG * slot.share),
    carbsG: Math.round(macros.carbsG * slot.share),
  }));

  return { mealsPerDay, isTrainingDay, windows, cadence };
}

/* ==========================================================================
   6. CONSULTATION CONSEILLER INTERACTIVE (CONTEXTE COMPLET + NIVEAU 0 PRO)
   ========================================================================== */

export function buildAdvisorContextSummary({ profile, macros, report, matrix, knownBf = null }) {
  const diet = DIET_LABELS[profile?.nutritionPrefs?.dietType] || 'Omnivore';
  const allergies = (profile?.nutritionPrefs?.allergies || []).join(', ') || 'Aucune';
  const injuries = (profile?.injuries || []).map((i) => `${i.zone} (niv.${i.severity})`).join(', ') || 'Aucune';
  const a7 = report.audit7d;

  return [
    `PROFIL : ${profile?.name || 'Athlète'} (${profile?.sex === 'female' ? 'Femme' : 'Homme'}, ${profile?.age || 28} ans, ${profile?.heightCm || 175} cm, ${profile?.weightKg || 75} kg${knownBf ? `, ${knownBf}% MG` : ''}, masse maigre ${macros.leanMassKg} kg).`,
    `OBJECTIF : ${GOAL_LABELS[profile?.goal] || profile?.goal || 'Recomp'} · Régime : ${diet} · Allergies : ${allergies} · Repas/j : ${profile?.nutritionPrefs?.mealsPerDay || 3}.`,
    `ZONES SENSIBLES : ${injuries}.`,
    `STATUT JOUR : ${report.dayStatus.label} · Score qualité : ${report.score.total}/100 (${report.score.grade}).`,
    `CIBLES JOUR : ${macros.kcal} kcal (TDEE ${macros.tdeeKcal}) · P ${macros.proteinG}g / G ${macros.carbsG}g / L ${macros.fatG}g · Fibres ${macros.fiberG}g · Eau ${macros.waterTargetMl} ml.`,
    `CONSOMMÉ / RESTE : ${report.balance.consumed.kcal} kcal consommés (Reste ${report.balance.remKcal} kcal${report.balance.surplusKcal > 0 ? `, SURPLUS +${report.balance.surplusKcal} kcal` : ''}) · Reste P ${report.balance.remProteinG}g / G ${report.balance.remCarbsG}g / L ${report.balance.remFatG}g · Fibres ${report.score.fiberTodayG}g · Eau ${report.score.waterMl} ml.`,
    `TENDANCE EWMA : ${report.ewmaAlert.statusLabel} — ${report.ewmaAlert.headline}.`,
    `AUDIT 7 DERNIERS JOURS (${a7.daysLogged} j logués) : Moyenne ${a7.avgKcal} kcal/j (écart ${a7.kcalDeltaAvg >= 0 ? '+' : ''}${a7.kcalDeltaAvg} kcal), Protéines moy. ${a7.avgProteinG} g/j (cible ${macros.proteinG} g), Fibres moy. ${a7.avgFiberG} g/j, Adhérence ${a7.adherencePct}% (${a7.daysOnKcalTarget}/${a7.daysLogged} j dans la cible, ${a7.surplusDays} j en surplus).`,
    `ALIMENTS CLÉS PROFIL : ${(matrix?.prioritize?.items || []).slice(0, 4).map((x) => x.food.name).join(', ')}.`,
  ].join('\n');
}

function buildFoodSwapAdvice(question, profile) {
  const qNorm = normalizeText(question);
  const eligible = getEligibleFoods(profile);

  // Cherche si un aliment de la base Ciqual est cité dans la question
  const mentioned = CIQUAL_DB.find((f) => {
    const tokens = normalizeText(f.name)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4);
    return tokens.some((tok) => qNorm.includes(tok));
  });

  if (mentioned) {
    // Détermine le rôle dominant de l'aliment cité (protéine, glucide, lipide, légume)
    const isProt = mentioned.proteinG >= 10 && mentioned.proteinG * 4 >= mentioned.carbsG * 4 * 0.8;
    const isCarb = !isProt && mentioned.carbsG >= 15;
    const isFat = !isProt && !isCarb && mentioned.fatG >= 12;

    const candidates = eligible
      .filter((f) => f.id !== mentioned.id)
      .filter((f) => {
        if (isProt) return f.proteinG >= 10;
        if (isCarb) return f.carbsG >= 15;
        if (isFat) return f.fatG >= 12;
        return f.kcal <= 65;
      })
      .sort((a, b) => {
        const diffA = Math.abs(a.kcal - mentioned.kcal) + Math.abs(a.proteinG - mentioned.proteinG) * 4;
        const diffB = Math.abs(b.kcal - mentioned.kcal) + Math.abs(b.proteinG - mentioned.proteinG) * 4;
        return diffA - diffB;
      })
      .slice(0, 3);

    const lines = candidates.map((alt) => {
      let eqGrams = 100;
      if (isProt && alt.proteinG > 0) eqGrams = roundTo5((mentioned.proteinG / alt.proteinG) * 100);
      else if (isCarb && alt.carbsG > 0) eqGrams = roundTo5((mentioned.carbsG / alt.carbsG) * 100);
      else if (isFat && alt.fatG > 0) eqGrams = roundTo5((mentioned.fatG / alt.fatG) * 100);
      eqGrams = Math.max(15, Math.min(350, eqGrams));
      const scaled = scaleFoodMacros(alt, eqGrams);
      return `• ${alt.name} : ${eqGrams} g = ${scaled.kcal} kcal (P ${scaled.proteinG}g / G ${scaled.carbsG}g / L ${scaled.fatG}g)`;
    });

    return `Équivalents directs pour 100 g de ${mentioned.name} (${mentioned.kcal} kcal · P ${mentioned.proteinG}g / G ${mentioned.carbsG}g / L ${mentioned.fatG}g), filtrés selon ton régime (${DIET_LABELS[profile?.nutritionPrefs?.dietType] || 'Omnivore'}) :\n${lines.join('\n')}\n\nAstuce : cite n’importe quel autre aliment (ex. « remplace les œufs », « remplace le riz », « remplace le skyr ») pour obtenir la conversion exacte au gramme près.`;
  }

  // Réponse générique utile basée sur les aliments autorisés du profil
  const prots = eligible.filter((f) => f.proteinG >= 18 && !f.id.includes('whey')).slice(0, 3);
  const carbs = eligible.filter((f) => f.carbsG >= 18).slice(0, 3);
  const snacks = eligible.filter((f) => ['ciq_skyr', 'ciq_fromage_blanc_0', 'ciq_cottage', 'ciq_tofu_ferme', 'ciq_edamame', 'ciq_prot_pois'].includes(f.id)).slice(0, 3);

  return `Table d’équivalences rapides (filtrée pour ton régime ${DIET_LABELS[profile?.nutritionPrefs?.dietType] || 'Omnivore'}) :\n• Protéines (~30 g P) : ${prots.map((p) => `${p.name} (${roundTo5((30 / Math.max(8, p.proteinG)) * 100)} g)`).join('  ≈  ')}\n• Glucides (~40 g G) : ${carbs.map((c) => `${c.name} (${roundTo5((40 / Math.max(10, c.carbsG)) * 100)} g)`).join('  ≈  ')}\n• Collations protéinées (~20 g P) : ${snacks.map((s) => `${s.name} (${roundTo5((20 / Math.max(6, s.proteinG)) * 100)} g)`).join('  ≈  ')}\n\nPrécise l’aliment exact que tu veux remplacer (ex. « remplace le skyr » ou « remplace le poulet ») pour un calcul 1:1 exact.`;
}

export function generateTier0NutritionAdvice(question, { profile, macros, report, recalibration }) {
  const qNorm = normalizeText(question);
  const name = profile?.name || 'Athlète';
  const b = report.balance;
  const a7 = report.audit7d;

  // 1. Stratégie Resto / Apéro
  if (/(resto|restaurant|apero|soiree|invite|sortie|pizza|burger|alcool|bar)/.test(qNorm)) {
    const budgetResto = b.remKcal >= 550 ? b.remKcal : Math.max(600, Math.round(macros.kcal * 0.4));
    return `[Protocole Resto / Apéro — Niveau 0]\n${name}, il te reste ${b.remKcal} kcal et ${b.remProteinG} g de protéines aujourd’hui (budget conseillé ce soir : ~${budgetResto} kcal).\n1. Avant de partir : prends une ancre protéinée légère (~25 g P maigres + 500 ml d’eau) pour ne pas arriver affamé à l’apéro.\n2. À table : commande une pièce protéinée grillée/rôtie (viande maigre, poisson, fruits de mer ou plat tofu/légumineuses) + légumes, sauce à part. Évite le pain + beurre d’attente.\n3. Boissons : alterne 1 verre d’eau pétillante pour 1 verre d’alcool (vin sec / spritz léger plutôt que cocktails sucrés ou bières triples).\n4. Lendemain : aucune punition ni jeûne forcé. Si surplus > 250 kcal, utilise le bouton « Lissage sur 3 jours » pour répartir proprement sur 72 h.`;
  }

  // 2. Faim le soir
  if (/(faim|fringal|soir|nuit|grignot|coupe[\s-]*faim|creux|envie)/.test(qNorm)) {
    const opts = (recalibration?.options || [])
      .slice(0, 2)
      .map((o) => `• ${o.title} (${o.totals.kcal} kcal · P ${o.totals.proteinG}g) : ${o.items.map((i) => `${i.name} ${i.grams} g`).join(' + ')}`)
      .join('\n');
    return `[Protocole Satiété Soir — Niveau 0]\n${name}, reste du jour : ${b.remKcal} kcal · P ${b.remProteinG} g · Fibres actuelles ${report.score.fiberTodayG}/${report.score.fiberTargetG} g · Eau ${report.score.waterMl}/${report.score.waterTargetMl} ml.\nOptions calibrées disponibles maintenant :\n${opts || '• Skyr 0 % ou fromage blanc 0 % (200 g) + fruits rouges (80 g) (~165 kcal · 21 g P)'}\nRappel clinique : bois d’abord 300 ml d’eau ou une infusion chaude (la déshydratation mime la faim), puis choisis une option riche en protéines lentes + fibres pour bloquer la fringale sans perturber le sommeil.`;
  }

  // 3. Audit des 7 derniers jours
  if (/(audit|7\s*jours|semaine|bilan|point\s*fort|correction|analyse)/.test(qNorm)) {
    if (a7.daysLogged === 0) {
      return `[Audit 7 Jours — Niveau 0]\nAucun jour complet (>= 450 kcal) n’a encore été enregistré sur les 7 derniers jours. Commence par saisir 3 à 5 journées complètes dans l’onglet Journal pour débloquer l’audit chiffré et le calcul TDEE adaptatif.`;
    }
    const strengths = [];
    const fixes = [];
    if (a7.daysOnProteinTarget >= Math.ceil(a7.daysLogged * 0.7)) {
      strengths.push(`Protéines régulières (${a7.avgProteinG} g/j vs cible ${macros.proteinG} g).`);
    } else {
      fixes.push(`Protéines insuffisantes (${a7.avgProteinG} g/j, soit ${a7.proteinDeltaAvg} g/j sous la cible) : vise >= ${report.score.leucineMinG} g dès le premier repas.`);
    }
    if (a7.adherencePct >= 70) {
      strengths.push(`Bonne maîtrise calorique (${a7.adherencePct} % des jours dans la cible, moy. ${a7.avgKcal} kcal/j).`);
    } else {
      fixes.push(`Écart calorique moyen de ${a7.kcalDeltaAvg >= 0 ? '+' : ''}${a7.kcalDeltaAvg} kcal/j (${a7.surplusDays} j en surplus) : pèse les sources lipidiques et utilise le recalibrage soir.`);
    }
    if (a7.avgFiberG >= macros.fiberG * 0.8) {
      strengths.push(`Apport en fibres solide (${a7.avgFiberG} g/j) soutenant la satiété.`);
    } else {
      fixes.push(`Fibres trop basses (${a7.avgFiberG} g/j vs cible ${macros.fiberG} g) : ajoute 200 g de légumes verts au déjeuner et au dîner.`);
    }

    return `[Audit 7 Derniers Jours (${a7.daysLogged} j analysés) — Niveau 0]\nMoyennes : ${a7.avgKcal} kcal/j (cible ${macros.kcal}) · P ${a7.avgProteinG} g · G ${a7.avgCarbsG} g · L ${a7.avgFatG} g · Fibres ${a7.avgFiberG} g.\nPoints forts :\n${strengths.length ? strengths.map((s) => `• ${s}`).join('\n') : '• Journalisation engagée : garde ce rythme pour calibrer ton TDEE.'}\nCorrections prioritaires :\n${fixes.length ? fixes.map((f) => `• ${f}`).join('\n') : '• Maintiens cette constance et surveille la courbe EWMA sur 14 jours.'}\nTendance EWMA : ${report.ewmaAlert.statusLabel} (${report.ewmaAlert.headline}).`;
  }

  // 4. Remplacement / Swap d'aliment
  if (/(remplac|equivalen|substitu|aime\s*pas|allergi|alternativ|swap|echang)/.test(qNorm)) {
    return `[Équivalences Nutritionnelles — Niveau 0]\n${buildFoodSwapAdvice(question, profile)}`;
  }

  // 5. Réponse générale clinique structurée
  const priorityFocus =
    b.surplusKcal >= 220
      ? `Surplus de +${b.surplusKcal} kcal : active le lissage 72 h plutôt que de sauter un repas.`
      : b.remProteinG >= 25
        ? `Priorité : combler les ${b.remProteinG} g de protéines restants (${b.remKcal} kcal disponibles).`
        : report.score.waterRatioPct < 70
          ? `Priorité : remonter ton hydratation (${report.score.waterMl}/${report.score.waterTargetMl} ml).`
          : `Bilan du jour équilibré (score ${report.score.total}/100) : maintiens ta répartition péri-séance.`;

  return `[Conseiller Nutrition Local — Niveau 0]\n${name} (${GOAL_LABELS[profile?.goal] || 'Recomp'} · ${report.dayStatus.label}) :\n• Reste du jour : ${b.remKcal} kcal · P ${b.remProteinG} g / G ${b.remCarbsG} g / L ${b.remFatG} g · Fibres ${report.score.fiberTodayG}/${report.score.fiberTargetG} g.\n• Action prioritaire : ${priorityFocus}\n• Tendance EWMA : ${report.ewmaAlert.statusLabel} — ${report.ewmaAlert.headline}.\nUtilise les raccourcis ci-dessus (resto, faim le soir, audit 7 jours, remplacement d’aliment) ou pose une question précise avec un nom d’aliment.`;
}

export async function askNutritionAdvisor({
  question,
  profile,
  macros,
  report,
  matrix,
  recalibration,
  knownBf = null,
  history = [],
  aiSettings = null,
}) {
  const tier0Reply = generateTier0NutritionAdvice(question, { profile, macros, report, recalibration });
  const dossier = buildAdvisorContextSummary({ profile, macros, report, matrix, knownBf });

  const systemPrompt = `Tu es un diététicien-nutritionniste du sport certifié intégré à Kinetix Lab.
Règles strictes :
- Réponds en français, de manière clinique, structurée, concise et directement actionnable (grammages concrets, zéro blabla, zéro emoji).
- Respecte STRICTEMENT le régime alimentaire, les allergies et les zones articulaires sensibles du profil.
- Ne recommande jamais de restriction extrême (< 1300 kcal ou saut de repas punitif) ; privilégie la densité protéique (seuil leucine 30–40 g), le plancher lipidique hormonal et le lissage 72 h en cas d’écart.
- Appuie-toi sur les chiffres exacts du dossier ci-dessous.

DOSSIER ATHLÈTE TEMPS RÉEL :
${dossier}`;

  const routed = await routeAIRequest({
    taskType: 'nutrition_advisor',
    prompt: question,
    systemPrompt,
    history: (history || []).slice(-6),
    context: {
      profile,
      macros,
      tier0Reply,
    },
    settings: aiSettings,
    expectJson: false,
  });

  return {
    text: String(routed.data || tier0Reply),
    provider: routed.provider,
    tierUsed: routed.tierUsed,
    usedFallback: Boolean(routed.usedFallback),
    fallbackReason: routed.fallbackReason || null,
    latencyMs: routed.latencyMs || 0,
  };
}
