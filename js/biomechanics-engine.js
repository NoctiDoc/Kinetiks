/**
 * Kinetix Lab — Moteur Biomécanique & Entraînement Pro (js/biomechanics-engine.js)
 * - Volume landmarks MEV / MAV / MRV modulés par niveau & objectif
 * - Générateur dynamique de splits (Full Body 2-3j, Upper/Lower 4j, Hybride 5j, PPL 6j) + cardio sans impact
 * - Check-in Readiness 3 secondes & Mode Préservation (-1 série, +1 RIR)
 * - Gamme montante automatique (50% x 8, 75% x 4) & Calculateur disques / par côté
 * - Swap biomécanique strict avec conversion automatique de charge
 * - Double progression autorégulée, estimation 1RM, phases de périodisation & détection auto Deload
 * - Matrice de mutation Programme depuis Analyse Physique ([LAG] +2/+4 séries en début de séance, [DOMINANT] -> MEV, unilatéral asymétries)
 */

import {
  EXERCISES_DB,
  EXERCISES_BY_ID,
  MUSCLE_GROUPS,
  CORRECTIVE_WARMUP_DRILLS,
  getExerciseById,
} from './exercises-db.js';
import { generateId } from './db.js';

/* ==========================================================================
   REPÈRES DE VOLUME (MEV / MAV / MRV) & PARAMÈTRES D'OBJECTIFS
   ========================================================================== */

export const VOLUME_LANDMARKS = Object.freeze({
  pecs_upper: { mev: 4, mav: 8, mrv: 12 },
  pecs_lower: { mev: 4, mav: 8, mrv: 12 },
  delts_ant: { mev: 0, mav: 4, mrv: 8 },
  delts_lat: { mev: 6, mav: 12, mrv: 18 },
  delts_post: { mev: 4, mav: 10, mrv: 16 },
  lats_width: { mev: 6, mav: 12, mrv: 18 },
  traps_rhomboids: { mev: 4, mav: 10, mrv: 16 },
  quads: { mev: 6, mav: 12, mrv: 18 },
  hamstrings: { mev: 4, mav: 10, mrv: 14 },
  glutes: { mev: 4, mav: 10, mrv: 16 },
  calves: { mev: 6, mav: 10, mrv: 16 },
  biceps: { mev: 4, mav: 10, mrv: 16 },
  triceps: { mev: 4, mav: 10, mrv: 14 },
  abs: { mev: 4, mav: 8, mrv: 14 },
});

export const GOAL_PROFILES = Object.freeze({
  recomp: {
    label: 'Recomposition corporelle',
    compoundReps: [6, 10],
    isolationReps: [10, 15],
    restCompoundSec: 150,
    restIsolationSec: 75,
    volumeMultiplier: 1.0,
    targetRir: 2,
    cardioSessionsPerWeek: 2,
  },
  fat_loss: {
    label: 'Perte de masse grasse',
    compoundReps: [6, 10],
    isolationReps: [10, 15],
    restCompoundSec: 135,
    restIsolationSec: 65,
    volumeMultiplier: 0.85,
    targetRir: 2,
    cardioSessionsPerWeek: 3,
  },
  lean_bulk: {
    label: 'Prise de masse sèche',
    compoundReps: [6, 10],
    isolationReps: [10, 15],
    restCompoundSec: 150,
    restIsolationSec: 90,
    volumeMultiplier: 1.1,
    targetRir: 1,
    cardioSessionsPerWeek: 2,
  },
  hypertrophy: {
    label: 'Hypertrophie esthétique',
    compoundReps: [8, 12],
    isolationReps: [12, 16],
    restCompoundSec: 135,
    restIsolationSec: 75,
    volumeMultiplier: 1.15,
    targetRir: 1,
    cardioSessionsPerWeek: 2,
  },
  strength: {
    label: 'Force athlétique',
    compoundReps: [3, 6],
    isolationReps: [8, 12],
    restCompoundSec: 210,
    restIsolationSec: 90,
    volumeMultiplier: 0.9,
    targetRir: 2,
    cardioSessionsPerWeek: 1,
  },
  health_posture: {
    label: 'Santé, Longévité & Posture',
    compoundReps: [8, 12],
    isolationReps: [12, 15],
    restCompoundSec: 120,
    restIsolationSec: 60,
    volumeMultiplier: 0.8,
    targetRir: 2,
    cardioSessionsPerWeek: 3,
  },
});

const INJURY_CONTRAINDICATION_MAP = Object.freeze({
  lumbar: ['lumbar_shear', 'lumbar_flexion'],
  shoulder: ['shoulder_impingement', 'anterior_shoulder'],
  knee: ['knee_shear'],
  wrist: ['wrist_extension'],
  elbow: ['elbow_tendon'],
  neck: ['cervical_load'],
});

export function roundToIncrement(value, increment = 2.5) {
  const step = Number(increment) > 0 ? Number(increment) : 2.5;
  return Math.max(0, Math.round(Number(value) / step) * step);
}

/* ==========================================================================
   FILTRAGE MATÉRIEL, BLESSURES & SCORE MORPHO-ANATOMIQUE
   ======================================================================== */

function hasRequiredEquipment(exercise, userEquipment = []) {
  const owned = new Set([...(userEquipment || []), 'bodyweight']);
  // Au moins un équipement principal compatible (ex. bench + dumbbells)
  if (exercise.equipment.includes('bench') && !owned.has('bench')) {
    return false;
  }
  const nonBench = exercise.equipment.filter((eq) => eq !== 'bench');
  if (nonBench.length === 0) return true;
  return nonBench.some((eq) => owned.has(eq));
}

function getBlockedContraindications(injuries = []) {
  const blocked = new Set();
  const caution = new Set();
  for (const inj of injuries || []) {
    const tags = INJURY_CONTRAINDICATION_MAP[inj.zone] || [];
    const sev = Number(inj.severity) || 1;
    for (const tag of tags) {
      if (sev >= 2) blocked.add(tag);
      else caution.add(tag);
    }
  }
  return { blocked, caution };
}

function scoreExerciseForProfile(exercise, profile) {
  let score = 50;
  const morph = profile?.morphology || {};
  const { blocked, caution } = getBlockedContraindications(profile?.injuries);
  const lags = new Set(profile?.lagPriorities || []);
  const hasAsymmetry = Array.isArray(profile?.asymmetries) && profile.asymmetries.length > 0;

  // Exclusion stricte des contre-indications sévères (sévérité 2–3)
  for (const c of exercise.contraindications || []) {
    if (blocked.has(c)) return -1000;
    if (caution.has(c)) score -= 22;
  }

  // Adéquation morphologique
  if (morph.femurTorsoRatio === 'long_femur') {
    if (exercise.morphoBias?.includes('long_femur_friendly')) score += 28;
    if (exercise.id === 'barbell_back_squat') score -= 25;
  }
  if (morph.armSpanRatio === 'long_arms') {
    if (exercise.morphoBias?.includes('long_arms_friendly')) score += 24;
    if (exercise.id === 'barbell_bench_press') score -= 18;
  }

  // Drapeaux posturaux
  const flags = new Set(morph.postureFlags || []);
  if (flags.has('anterior_pelvic_tilt') && exercise.morphoBias?.includes('apt_corrective')) score += 18;
  if (flags.has('kyphosis') && exercise.morphoBias?.includes('kyphosis_corrective')) score += 18;
  if (flags.has('protracted_shoulders') && exercise.morphoBias?.includes('protracted_shoulders_corrective')) {
    score += 18;
  }

  // Douleurs articulaires -> bonus aux exercices "safe"
  const injuryZones = new Set((profile?.injuries || []).map((i) => i.zone));
  if (injuryZones.has('lumbar') && exercise.morphoBias?.includes('lumbar_safe')) score += 30;
  if (injuryZones.has('shoulder') && exercise.morphoBias?.includes('shoulder_friendly')) score += 26;
  if (injuryZones.has('elbow') && exercise.morphoBias?.includes('elbow_friendly')) score += 22;

  // Bonus unilatéral si asymétrie détectée
  if (hasAsymmetry && exercise.unilateral) score += 20;

  // Bonus priorités [LAG]
  if (exercise.primaryMuscles.some((m) => lags.has(m))) score += 15;

  return score;
}

function pickBestExercise({ primaryMuscle, movementPlane = null, profile, usedIds = new Set(), preferUnilateral = false }) {
  const candidates = EXERCISES_DB.filter((ex) => {
    if (usedIds.has(ex.id)) return false;
    if (!hasRequiredEquipment(ex, profile?.equipment)) return false;
    const muscleMatch = ex.primaryMuscles.includes(primaryMuscle);
    const planeMatch = movementPlane ? ex.movementPlane === movementPlane : true;
    return muscleMatch && planeMatch;
  });

  const scored = candidates
    .map((ex) => ({
      ex,
      score:
        scoreExerciseForProfile(ex, profile) +
        (preferUnilateral && ex.unilateral ? 35 : 0),
    }))
    .filter((item) => item.score > -500)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) return scored[0].ex;

  // Repli sans contrainte de plan si matériel très réduit (ex. poids du corps seul)
  const fallback = EXERCISES_DB.filter(
    (ex) => !usedIds.has(ex.id) && ex.primaryMuscles.includes(primaryMuscle) && hasRequiredEquipment(ex, profile?.equipment)
  );
  return fallback[0] || EXERCISES_DB.find((ex) => ex.primaryMuscles.includes(primaryMuscle)) || EXERCISES_DB[0];
}

/* ==========================================================================
   MODULE ÉCHAUFFEMENT CORRECTIF (5 MIN) & CARDIO INTELLIGENT
   ========================================================================== */

export function buildCorrectiveWarmup(profile) {
  const drills = [];
  const seen = new Set();

  const addDrills = (key) => {
    for (const d of CORRECTIVE_WARMUP_DRILLS[key] || []) {
      if (!seen.has(d.name)) {
        seen.add(d.name);
        drills.push(d);
      }
    }
  };

  for (const flag of profile?.morphology?.postureFlags || []) {
    addDrills(flag);
  }
  for (const inj of profile?.injuries || []) {
    addDrills(inj.zone);
  }
  if (drills.length === 0) {
    addDrills('default');
  }
  return drills.slice(0, 4);
}

export function buildSmartCardioModule(profile) {
  const goalCfg = GOAL_PROFILES[profile?.goal] || GOAL_PROFILES.recomp;
  const heightM = (Number(profile?.heightCm) || 175) / 100;
  const bmi = (Number(profile?.weightKg) || 75) / (heightM * heightM);
  const injuryZones = new Set((profile?.injuries || []).map((i) => i.zone));
  const needsLowImpact = bmi >= 27.5 || injuryZones.has('knee') || injuryZones.has('lumbar');

  const modality = needsLowImpact
    ? 'Marche rapide sur tapis incliné (8–12 % à 4,8–5,5 km/h) ou vélo ergomètre / elliptique (ZÉRO impact articulaire)'
    : 'Zone 2 continue (tapis incliné, rameur ou footing souple à 65–75 % FCmax)';

  const durationMin =
    profile?.goal === 'fat_loss' ? 30 : profile?.goal === 'strength' ? 15 : 22;

  return {
    sessionsPerWeek: goalCfg.cardioSessionsPerWeek,
    durationMin,
    lowImpactEnforced: needsLowImpact,
    reason: needsLowImpact
      ? 'Mode sans impact activé automatiquement (protection genoux/lombaires ou IMC >= 27,5).'
      : 'Cardio Zone 2 calibré pour la récupération cardiovasculaire et la dépense énergétique.',
    modality,
    targetZone: 'Zone 2 (conversation possible en phrases courtes)',
  };
}

/* ==========================================================================
   GÉNÉRATEUR DE SPLIT DYNAMIQUE & CHARGE DE DÉPART CALIBRÉE
   ========================================================================== */

export function estimateStartingLoad(exercise, profile) {
  const bw = Number(profile?.weightKg) || 75;
  const sexMult = profile?.sex === 'female' ? 0.65 : 1.0;
  const lvlMult =
    profile?.level === 'advanced' ? 1.15 : profile?.level === 'beginner' ? 0.65 : 0.9;

  let base = bw * 0.5 * sexMult * lvlMult;
  if (exercise.category === 'isolation') base *= 0.45;
  if (exercise.loadMode === 'per_dumbbell') base *= 0.42;
  if (exercise.id === 'leg_press_45') base = bw * 1.3 * sexMult * lvlMult;
  if (exercise.id === 'hip_thrust_barbell') base = bw * 0.9 * sexMult * lvlMult;
  if (exercise.loadMode === 'bodyweight_plus') return 0;

  const rounded = roundToIncrement(base, exercise.incrementKg);
  if (exercise.loadMode === 'barbell') {
    return Math.max(exercise.barWeightKg || 20, rounded);
  }
  return Math.max(exercise.incrementKg || 2, rounded);
}

function buildDayExerciseSlot(exercise, profile, { sets, isLagPriority = false, goalCfg, phase = 'calibration' }) {
  const isCompound = exercise.category === 'compound';
  const [repMin, repMax] = isCompound ? goalCfg.compoundReps : goalCfg.isolationReps;
  const baseRir = phase === 'calibration' ? 2 : phase === 'deload' ? 3 : goalCfg.targetRir;
  const restSec = isCompound ? goalCfg.restCompoundSec : goalCfg.restIsolationSec;
  const suggestedLoadKg = estimateStartingLoad(exercise, profile);

  return {
    slotId: generateId('slot'),
    exerciseId: exercise.id,
    name: exercise.name,
    primaryMuscles: exercise.primaryMuscles,
    category: exercise.category,
    unilateral: Boolean(exercise.unilateral),
    sets,
    repMin,
    repMax,
    targetRir: baseRir,
    finalSetToTechFailure: phase === 'accumulation' && !isCompound,
    restSec,
    suggestedLoadKg,
    incrementKg: exercise.incrementKg,
    isLagPriority,
    unilateralNote: exercise.unilateral
      ? 'Commencer par le côté faible, plafonner le côté fort au même nombre de répétitions.'
      : null,
  };
}

function getSplitBlueprints(sessionsPerWeek) {
  const n = Math.max(2, Math.min(6, Number(sessionsPerWeek) || 4));
  if (n <= 3) {
    const baseDays = [
      {
        id: 'day_fb_a',
        name: 'Full Body A — Poussée & Quadriceps',
        slots: [
          { muscle: 'quads', plane: 'knee_dominant', sets: 3 },
          { muscle: 'pecs_upper', plane: 'incline_push', sets: 3 },
          { muscle: 'lats_width', plane: 'vertical_pull', sets: 3 },
          { muscle: 'hamstrings', plane: 'knee_isolation', sets: 3 },
          { muscle: 'delts_lat', plane: 'shoulder_abduction', sets: 3 },
          { muscle: 'abs', plane: 'anti_extension', sets: 2 },
        ],
      },
      {
        id: 'day_fb_b',
        name: 'Full Body B — Chaîne Postérieure & Tirage',
        slots: [
          { muscle: 'hamstrings', plane: 'hip_hinge', sets: 3 },
          { muscle: 'traps_rhomboids', plane: 'horizontal_pull', sets: 3 },
          { muscle: 'pecs_lower', plane: 'horizontal_push', sets: 3 },
          { muscle: 'delts_post', plane: 'rear_delt', sets: 3 },
          { muscle: 'biceps', plane: 'elbow_flexion', sets: 2 },
          { muscle: 'triceps', plane: 'elbow_extension', sets: 2 },
        ],
      },
      {
        id: 'day_fb_c',
        name: 'Full Body C — Hypertrophie & Unilatéral',
        slots: [
          { muscle: 'quads', plane: 'knee_dominant', sets: 3, preferUnilateral: true },
          { muscle: 'delts_ant', plane: 'vertical_push', sets: 3 },
          { muscle: 'lats_width', plane: 'vertical_pull', sets: 3 },
          { muscle: 'glutes', plane: 'hip_extension', sets: 3 },
          { muscle: 'calves', plane: 'ankle_plantarflexion', sets: 3 },
          { muscle: 'delts_lat', plane: 'shoulder_abduction', sets: 3 },
        ],
      },
    ];
    return { splitType: 'full_body', splitLabel: `Full Body (${n} j/sem)`, days: baseDays.slice(0, n) };
  }

  if (n === 4) {
    return {
      splitType: 'upper_lower',
      splitLabel: 'Upper / Lower (4 j/sem)',
      days: [
        {
          id: 'day_upper_a',
          name: 'Upper A — Poussée & Largeur Dos',
          slots: [
            { muscle: 'pecs_upper', plane: 'incline_push', sets: 3 },
            { muscle: 'lats_width', plane: 'vertical_pull', sets: 3 },
            { muscle: 'pecs_lower', plane: 'horizontal_push', sets: 3 },
            { muscle: 'traps_rhomboids', plane: 'horizontal_pull', sets: 3 },
            { muscle: 'delts_lat', plane: 'shoulder_abduction', sets: 3 },
            { muscle: 'triceps', plane: 'elbow_extension', sets: 3 },
          ],
        },
        {
          id: 'day_lower_a',
          name: 'Lower A — Quadriceps & Fessiers',
          slots: [
            { muscle: 'quads', plane: 'knee_dominant', sets: 4 },
            { muscle: 'hamstrings', plane: 'knee_isolation', sets: 3 },
            { muscle: 'quads', plane: 'knee_dominant', sets: 3, preferUnilateral: true },
            { muscle: 'calves', plane: 'ankle_plantarflexion', sets: 3 },
            { muscle: 'abs', plane: 'anti_extension', sets: 3 },
          ],
        },
        {
          id: 'day_upper_b',
          name: 'Upper B — Épaisseur Dos & Épaules',
          slots: [
            { muscle: 'traps_rhomboids', plane: 'horizontal_pull', sets: 3 },
            { muscle: 'delts_ant', plane: 'vertical_push', sets: 3 },
            { muscle: 'lats_width', plane: 'vertical_pull', sets: 3, preferUnilateral: true },
            { muscle: 'pecs_upper', plane: 'incline_push', sets: 3 },
            { muscle: 'delts_post', plane: 'rear_delt', sets: 3 },
            { muscle: 'biceps', plane: 'elbow_flexion', sets: 3 },
          ],
        },
        {
          id: 'day_lower_b',
          name: 'Lower B — Chaîne Postérieure & Gainage',
          slots: [
            { muscle: 'hamstrings', plane: 'hip_hinge', sets: 3 },
            { muscle: 'glutes', plane: 'hip_extension', sets: 3 },
            { muscle: 'quads', plane: 'knee_isolation', sets: 3 },
            { muscle: 'hamstrings', plane: 'knee_isolation', sets: 3 },
            { muscle: 'calves', plane: 'ankle_plantarflexion', sets: 3 },
            { muscle: 'abs', plane: 'anti_extension', sets: 3 },
          ],
        },
      ],
    };
  }

  if (n === 5) {
    return {
      splitType: 'hybrid_ul_ppl',
      splitLabel: 'Hybride Upper/Lower + PPL (5 j/sem)',
      days: [
        {
          id: 'day_ul_upper',
          name: 'Jour 1 — Upper Force / Hypertrophie',
          slots: [
            { muscle: 'pecs_upper', plane: 'incline_push', sets: 3 },
            { muscle: 'lats_width', plane: 'vertical_pull', sets: 3 },
            { muscle: 'traps_rhomboids', plane: 'horizontal_pull', sets: 3 },
            { muscle: 'delts_lat', plane: 'shoulder_abduction', sets: 3 },
            { muscle: 'biceps', plane: 'elbow_flexion', sets: 2 },
            { muscle: 'triceps', plane: 'elbow_extension', sets: 2 },
          ],
        },
        {
          id: 'day_ul_lower',
          name: 'Jour 2 — Lower Quadriceps Dominant',
          slots: [
            { muscle: 'quads', plane: 'knee_dominant', sets: 4 },
            { muscle: 'hamstrings', plane: 'knee_isolation', sets: 3 },
            { muscle: 'quads', plane: 'knee_isolation', sets: 3 },
            { muscle: 'calves', plane: 'ankle_plantarflexion', sets: 3 },
            { muscle: 'abs', plane: 'anti_extension', sets: 3 },
          ],
        },
        {
          id: 'day_ppl_push',
          name: 'Jour 3 — Push (Pecs / Épaules / Triceps)',
          slots: [
            { muscle: 'pecs_lower', plane: 'horizontal_push', sets: 3 },
            { muscle: 'delts_ant', plane: 'vertical_push', sets: 3 },
            { muscle: 'pecs_upper', plane: 'incline_push', sets: 3 },
            { muscle: 'delts_lat', plane: 'shoulder_abduction', sets: 4 },
            { muscle: 'triceps', plane: 'elbow_extension', sets: 3 },
          ],
        },
        {
          id: 'day_ppl_pull',
          name: 'Jour 4 — Pull (Dos / Arrière Épaules / Biceps)',
          slots: [
            { muscle: 'lats_width', plane: 'vertical_pull', sets: 3 },
            { muscle: 'traps_rhomboids', plane: 'horizontal_pull', sets: 3 },
            { muscle: 'lats_width', plane: 'vertical_pull', sets: 3, preferUnilateral: true },
            { muscle: 'delts_post', plane: 'rear_delt', sets: 4 },
            { muscle: 'biceps', plane: 'elbow_flexion', sets: 3 },
          ],
        },
        {
          id: 'day_ppl_legs',
          name: 'Jour 5 — Legs Chaîne Postérieure',
          slots: [
            { muscle: 'hamstrings', plane: 'hip_hinge', sets: 3 },
            { muscle: 'glutes', plane: 'hip_extension', sets: 3 },
            { muscle: 'quads', plane: 'knee_dominant', sets: 3, preferUnilateral: true },
            { muscle: 'calves', plane: 'ankle_plantarflexion', sets: 4 },
            { muscle: 'abs', plane: 'anti_extension', sets: 3 },
          ],
        },
      ],
    };
  }

  return {
    splitType: 'ppl',
    splitLabel: 'Push / Pull / Legs × 2 (6 j/sem)',
    days: [
      {
        id: 'day_push_a',
        name: 'Push A — Pectoraux & Deltoïdes latéraux',
        slots: [
          { muscle: 'pecs_upper', plane: 'incline_push', sets: 4 },
          { muscle: 'pecs_lower', plane: 'horizontal_push', sets: 3 },
          { muscle: 'delts_lat', plane: 'shoulder_abduction', sets: 4 },
          { muscle: 'triceps', plane: 'elbow_extension', sets: 3 },
        ],
      },
      {
        id: 'day_pull_a',
        name: 'Pull A — Largeur Dos & Biceps',
        slots: [
          { muscle: 'lats_width', plane: 'vertical_pull', sets: 4 },
          { muscle: 'traps_rhomboids', plane: 'horizontal_pull', sets: 3 },
          { muscle: 'delts_post', plane: 'rear_delt', sets: 3 },
          { muscle: 'biceps', plane: 'elbow_flexion', sets: 3 },
        ],
      },
      {
        id: 'day_legs_a',
        name: 'Legs A — Quadriceps',
        slots: [
          { muscle: 'quads', plane: 'knee_dominant', sets: 4 },
          { muscle: 'quads', plane: 'knee_isolation', sets: 3 },
          { muscle: 'hamstrings', plane: 'knee_isolation', sets: 3 },
          { muscle: 'calves', plane: 'ankle_plantarflexion', sets: 4 },
          { muscle: 'abs', plane: 'anti_extension', sets: 3 },
        ],
      },
      {
        id: 'day_push_b',
        name: 'Push B — Épaules & Haut Pectoraux',
        slots: [
          { muscle: 'delts_ant', plane: 'vertical_push', sets: 3 },
          { muscle: 'pecs_upper', plane: 'incline_push', sets: 3 },
          { muscle: 'delts_lat', plane: 'shoulder_abduction', sets: 4 },
          { muscle: 'triceps', plane: 'elbow_extension', sets: 3 },
        ],
      },
      {
        id: 'day_pull_b',
        name: 'Pull B — Épaisseur Dos & Unilatéral',
        slots: [
          { muscle: 'traps_rhomboids', plane: 'horizontal_pull', sets: 4 },
          { muscle: 'lats_width', plane: 'vertical_pull', sets: 3, preferUnilateral: true },
          { muscle: 'delts_post', plane: 'rear_delt', sets: 4 },
          { muscle: 'biceps', plane: 'elbow_flexion', sets: 3, preferUnilateral: true },
        ],
      },
      {
        id: 'day_legs_b',
        name: 'Legs B — Chaîne Postérieure',
        slots: [
          { muscle: 'hamstrings', plane: 'hip_hinge', sets: 4 },
          { muscle: 'glutes', plane: 'hip_extension', sets: 3 },
          { muscle: 'quads', plane: 'knee_dominant', sets: 3, preferUnilateral: true },
          { muscle: 'calves', plane: 'ankle_plantarflexion', sets: 3 },
          { muscle: 'abs', plane: 'anti_extension', sets: 3 },
        ],
      },
    ],
  };
}

export function calculateWeeklyVolume(days = []) {
  const totals = {};
  for (const key of Object.keys(MUSCLE_GROUPS)) {
    totals[key] = 0;
  }
  for (const day of days) {
    for (const item of day.exercises || []) {
      const ex = getExerciseById(item.exerciseId);
      const sets = Number(item.sets) || 0;
      const primaries = ex?.primaryMuscles || item.primaryMuscles || [];
      const secondaries = ex?.secondaryMuscles || [];
      for (const m of primaries) {
        totals[m] = (totals[m] || 0) + sets;
      }
      for (const m of secondaries) {
        totals[m] = (totals[m] || 0) + Math.round(sets * 0.5 * 10) / 10;
      }
    }
  }
  return totals;
}

export function generateProgram(profile, { phase = 'calibration', mesocycleNumber = 1 } = {}) {
  const goalCfg = GOAL_PROFILES[profile?.goal] || GOAL_PROFILES.recomp;
  const levelFactor =
    profile?.level === 'beginner' ? 0.8 : profile?.level === 'advanced' ? 1.15 : 1.0;
  const durationCap = Number(profile?.sessionDurationMin) <= 45 ? 4 : Number(profile?.sessionDurationMin) <= 60 ? 6 : 7;
  const blueprint = getSplitBlueprints(profile?.sessionsPerWeek || 4);
  const lagSet = new Set(profile?.lagPriorities || []);
  const dominantSet = new Set(profile?.dominantGroups || []);
  const hasAsymmetry = Array.isArray(profile?.asymmetries) && profile.asymmetries.length > 0;

  const days = blueprint.days.map((dayBp) => {
    const usedIds = new Set();
    const exercises = [];

    for (const slot of dayBp.slots.slice(0, durationCap)) {
      const exercise = pickBestExercise({
        primaryMuscle: slot.muscle,
        movementPlane: slot.plane,
        profile,
        usedIds,
        preferUnilateral: Boolean(slot.preferUnilateral || hasAsymmetry),
      });
      usedIds.add(exercise.id);

      const isLag = exercise.primaryMuscles.some((m) => lagSet.has(m));
      const isDom = !isLag && exercise.primaryMuscles.every((m) => dominantSet.has(m));

      let targetSets = Math.round(slot.sets * goalCfg.volumeMultiplier * levelFactor);
      if (isLag) targetSets += 1;
      if (isDom) targetSets = Math.max(2, targetSets - 1);
      if (phase === 'deload') targetSets = Math.max(2, Math.ceil(targetSets * 0.55));
      targetSets = Math.max(2, Math.min(5, targetSets));

      exercises.push(
        buildDayExerciseSlot(exercise, profile, {
          sets: targetSets,
          isLagPriority: isLag,
          goalCfg,
          phase,
        })
      );
    }

    // Priorisation CNS : les groupes [LAG] remontent en début de séance
    exercises.sort((a, b) => Number(b.isLagPriority) - Number(a.isLagPriority));

    return {
      id: dayBp.id,
      name: dayBp.name,
      exercises,
    };
  });

  return {
    id: generateId('prog'),
    profileId: profile?.id || null,
    goal: profile?.goal || 'recomp',
    goalLabel: goalCfg.label,
    splitType: blueprint.splitType,
    splitLabel: blueprint.splitLabel,
    mesocycleNumber,
    weekNumber: 1,
    phase,
    warmupDrills: buildCorrectiveWarmup(profile),
    cardio: buildSmartCardioModule(profile),
    days,
    weeklyVolume: calculateWeeklyVolume(days),
    mutationHistory: [],
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* ==========================================================================
   CHECK-IN READINESS (3 SECONDES) & MODE PRÉSERVATION
   ========================================================================== */

export function evaluateReadiness({ sleep = 4, soreness = 4, energy = 4 }) {
  const s = Math.max(1, Math.min(5, Number(sleep)));
  const r = Math.max(1, Math.min(5, Number(soreness)));
  const e = Math.max(1, Math.min(5, Number(energy)));

  // Pondération : Sommeil 35 %, Raideurs/Douleurs 35 %, Énergie 30 %
  const score = Math.round(((s * 0.35 + r * 0.35 + e * 0.3) / 5) * 100);
  const recommendPreservation = score < 58 || r <= 2;

  let status = 'OPTIMAL';
  let summary = 'Système nerveux prêt : exécutez le volume prescrit avec surcharge progressive.';
  if (recommendPreservation) {
    status = 'PRESERVATION';
    summary =
      'Fatigue élevée ou raideur articulaire détectée : Mode Préservation conseillé (-1 série/exercice, +1 RIR de marge).';
  } else if (score < 75) {
    status = 'MODERE';
    summary = 'Disponibilité correcte : privilégiez la propreté technique et respectez strictement les RIR cibles.';
  }

  return {
    sleep: s,
    soreness: r,
    energy: e,
    score,
    status,
    recommendPreservation,
    summary,
  };
}

export function applyPreservationMode(dayPlan) {
  return {
    ...dayPlan,
    preservationMode: true,
    exercises: (dayPlan.exercises || []).map((ex) => {
      const reducedSets = Math.max(1, (Number(ex.sets) || 3) - 1);
      const isCompound = ex.category === 'compound';
      const relievedLoad = isCompound
        ? roundToIncrement((Number(ex.suggestedLoadKg) || 0) * 0.95, ex.incrementKg || 2.5)
        : ex.suggestedLoadKg;
      return {
        ...ex,
        originalSets: ex.sets,
        sets: reducedSets,
        targetRir: Math.min(4, (Number(ex.targetRir) || 1) + 1),
        finalSetToTechFailure: false,
        suggestedLoadKg: relievedLoad,
      };
    }),
  };
}

/* ==========================================================================
   GAMME MONTANTE AUTO & CALCULATEUR DE DISQUES / PAR CÔTÉ
   ========================================================================== */

export function generateWarmupRamp(workingWeightKg, exercise, isFirstCompoundOfChain = false) {
  const load = Number(workingWeightKg) || 0;
  if (!isFirstCompoundOfChain || !exercise || exercise.category !== 'compound' || load <= 0) {
    return [];
  }
  const inc = exercise.incrementKg || 2.5;
  const minFloor = exercise.loadMode === 'barbell' ? exercise.barWeightKg || 20 : inc;

  const set1Weight = Math.max(minFloor, roundToIncrement(load * 0.5, inc));
  const set2Weight = Math.max(minFloor, roundToIncrement(load * 0.75, inc));

  if (set1Weight >= load) return [];

  return [
    { label: 'Échauff. 1 (50 %)', weightKg: set1Weight, reps: 8, isWarmup: true },
    { label: 'Échauff. 2 (75 %)', weightKg: Math.min(load - inc, set2Weight), reps: 4, isWarmup: true },
  ].filter((s) => s.weightKg > 0 && s.weightKg < load);
}

const STANDARD_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

function breakdownPlatesPerSide(perSideKg) {
  let rem = Math.max(0, Math.round(perSideKg * 100) / 100);
  const plates = [];
  for (const p of STANDARD_PLATES) {
    while (rem >= p - 0.001) {
      plates.push(p);
      rem = Math.round((rem - p) * 100) / 100;
    }
  }
  return plates;
}

export function calculatePerSideLoad(weightKg, exercise) {
  const w = Number(weightKg) || 0;
  if (!exercise) return { mode: 'direct', label: `${w} kg`, perSideKg: w, plates: [] };

  if (exercise.loadMode === 'per_dumbbell') {
    return {
      mode: 'per_dumbbell',
      perSideKg: w,
      totalKg: w * 2,
      plates: [],
      label: `${w} kg / haltère (${w * 2} kg total)`,
    };
  }

  if (exercise.loadMode === 'barbell') {
    const bar = Number(exercise.barWeightKg) || 20;
    const loadable = Math.max(0, w - bar);
    const perSideKg = Math.round((loadable / 2) * 100) / 100;
    const plates = breakdownPlatesPerSide(perSideKg);
    return {
      mode: 'barbell',
      barWeightKg: bar,
      perSideKg,
      plates,
      label:
        plates.length > 0
          ? `Barre ${bar} kg + ${perSideKg} kg/côté [${plates.join(' + ')}]`
          : `Barre à vide (${bar} kg)`,
    };
  }

  if (exercise.loadMode === 'plate_loaded_bilateral') {
    const perSideKg = Math.round((w / 2) * 100) / 100;
    const plates = breakdownPlatesPerSide(perSideKg);
    return {
      mode: 'plate_loaded',
      perSideKg,
      plates,
      label: `${perSideKg} kg/côté [${plates.join(' + ') || '0'}]`,
    };
  }

  if (exercise.loadMode === 'bodyweight_plus') {
    return {
      mode: 'bodyweight_plus',
      perSideKg: w,
      plates: [],
      label: w > 0 ? `Poids du corps + ${w} kg` : 'Poids du corps',
    };
  }

  return {
    mode: 'stack',
    perSideKg: w,
    plates: [],
    label: `Pile machine : ${w} kg`,
  };
}

/* ==========================================================================
   SWAP BIOMÉCANIQUE INTELLIGENT ("POSTE OCCUPÉ / REMPLACER")
   ========================================================================== */

export function findBiomechanicalSwaps(exerciseId, profile, currentLoadKg = 0) {
  const source = getExerciseById(exerciseId);
  if (!source) return [];

  const { blocked } = getBlockedContraindications(profile?.injuries);

  const candidates = EXERCISES_DB.filter((ex) => {
    if (ex.id === source.id) return false;
    if (!hasRequiredEquipment(ex, profile?.equipment)) return false;
    if ((ex.contraindications || []).some((c) => blocked.has(c))) return false;

    const sameSwapGroup = ex.swapGroup === source.swapGroup;
    const samePlaneAndMuscle =
      ex.movementPlane === source.movementPlane &&
      ex.primaryMuscles.some((m) => source.primaryMuscles.includes(m));
    return sameSwapGroup || samePlaneAndMuscle;
  });

  return candidates
    .map((target) => {
      const sameGroupBonus = target.swapGroup === source.swapGroup ? 40 : 0;
      const sameCurveBonus = target.resistanceCurve === source.resistanceCurve ? 15 : 0;
      const profileScore = scoreExerciseForProfile(target, profile);

      // Conversion mécanique automatique de la charge recommandée
      const ratio = (target.loadTransferFactor || 1) / (source.loadTransferFactor || 1);
      const rawConverted = Number(currentLoadKg) > 0 ? Number(currentLoadKg) * ratio : estimateStartingLoad(target, profile);
      const convertedLoadKg =
        target.loadMode === 'bodyweight_plus'
          ? 0
          : Math.max(target.barWeightKg || target.incrementKg || 2, roundToIncrement(rawConverted, target.incrementKg));

      return {
        exercise: target,
        convertedLoadKg,
        perSideDisplay: calculatePerSideLoad(convertedLoadKg, target).label,
        matchScore: sameGroupBonus + sameCurveBonus + profileScore,
        reason:
          target.swapGroup === source.swapGroup
            ? `Équivalent mécanique direct (${target.resistanceCurve})`
            : `Même plan (${target.movementPlane}) et moteur primaire`,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}

/* ==========================================================================
   DOUBLE PROGRESSION, 1RM ESTIMÉ, FEEDBACK & DÉTECTION AUTO DELOAD
   ========================================================================== */

export function estimate1RM(weightKg, reps, rir = 0) {
  const w = Number(weightKg) || 0;
  const effectiveReps = Math.max(1, (Number(reps) || 0) + Math.max(0, Number(rir) || 0));
  if (w <= 0) return 0;
  if (effectiveReps === 1) return Math.round(w * 10) / 10;
  // Formule d'Epley pondérée
  return Math.round(w * (1 + effectiveReps / 30) * 10) / 10;
}

export function evaluateExerciseProgression({
  exerciseId,
  performedSets = [],
  repMin = 8,
  repMax = 12,
  feedback = 'solid', // 'easy' | 'solid' | 'limit' | 'joint_pain'
  profile = null,
}) {
  const exercise = getExerciseById(exerciseId);
  const inc = exercise?.incrementKg || 2.5;
  const workSets = performedSets.filter((s) => !s.isWarmup && (Number(s.reps) || 0) > 0);
  if (workSets.length === 0) {
    return { action: 'hold', nextLoadKg: 0, message: 'Aucune série de travail validée.' };
  }

  const avgWeight =
    workSets.reduce((acc, s) => acc + (Number(s.weightKg) || 0), 0) / workSets.length;
  const maxWeight = Math.max(...workSets.map((s) => Number(s.weightKg) || 0));
  const minRepsHit = Math.min(...workSets.map((s) => Number(s.reps) || 0));
  const allAtCeiling = workSets.every((s) => Number(s.reps) >= repMax);

  if (feedback === 'joint_pain') {
    const deloaded = Math.max(
      exercise?.barWeightKg || inc,
      roundToIncrement(maxWeight * 0.875, inc)
    );
    const swaps = findBiomechanicalSwaps(exerciseId, profile || { equipment: ['barbell', 'dumbbells', 'cables', 'machines', 'bench'] }, maxWeight);
    return {
      action: 'pain_deload_and_swap',
      nextLoadKg: deloaded,
      deltaKg: deloaded - maxWeight,
      suggestedSwap: swaps[0] || null,
      message: `Douleur articulaire signalée : décharge immédiate à ${deloaded} kg (-12,5 %) et alternative sans contrainte proposée.`,
    };
  }

  if (allAtCeiling && (feedback === 'easy' || feedback === 'solid')) {
    const bonusStep = feedback === 'easy' && minRepsHit >= repMax + 2 ? inc * 2 : inc;
    const nextLoadKg = roundToIncrement(maxWeight + bonusStep, inc);
    return {
      action: 'increase_load',
      nextLoadKg,
      deltaKg: bonusStep,
      message: `Plafond ${repMax} réps validé (${feedback}) : progression vers ${nextLoadKg} kg (+${bonusStep} kg) à la prochaine séance.`,
    };
  }

  if (minRepsHit < repMin && feedback === 'limit') {
    const reduced = Math.max(exercise?.barWeightKg || inc, roundToIncrement(maxWeight - inc, inc));
    return {
      action: 'micro_deload',
      nextLoadKg: reduced,
      deltaKg: reduced - maxWeight,
      message: `Sous le plancher (${repMin} réps) en zone limite : recalibrage à ${reduced} kg pour retrouver la qualité technique.`,
    };
  }

  return {
    action: 'hold_and_add_reps',
    nextLoadKg: roundToIncrement(avgWeight || maxWeight, inc),
    deltaKg: 0,
    message: `Maintien à ${roundToIncrement(maxWeight, inc)} kg : visez +1 à +2 répétitions par série jusqu’à valider ${repMax} réps.`,
  };
}

export function detectDeloadNeed(workouts = [], currentWeek = 1) {
  const recent = [...(workouts || [])]
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, 6);

  if (recent.length < 3) {
    return { deloadRecommended: false, reason: null, readinessAvg: null };
  }

  const readinessScores = recent
    .slice(0, 3)
    .map((w) => w.readiness?.score)
    .filter((v) => typeof v === 'number');
  const readinessAvg =
    readinessScores.length > 0
      ? Math.round(readinessScores.reduce((a, b) => a + b, 0) / readinessScores.length)
      : null;

  // Détection baisse de performance sur 1RM estimé entre les 2 dernières occurrences d'un exercice polyarticulaire
  const exerciseHistory = new Map();
  for (const wk of recent) {
    for (const ex of wk.exercises || []) {
      const meta = getExerciseById(ex.exerciseId);
      if (!meta || meta.category !== 'compound') continue;
      const bestSet1RM = Math.max(
        0,
        ...(ex.sets || [])
          .filter((s) => !s.isWarmup && s.done)
          .map((s) => estimate1RM(s.weightKg, s.reps, s.rir ?? 1))
      );
      if (bestSet1RM > 0) {
        const list = exerciseHistory.get(ex.exerciseId) || [];
        list.push(bestSet1RM);
        exerciseHistory.set(ex.exerciseId, list);
      }
    }
  }

  let regressedCompounds = 0;
  for (const vals of exerciseHistory.values()) {
    if (vals.length >= 2 && vals[0] < vals[1] * 0.96) {
      regressedCompounds += 1;
    }
  }

  if (regressedCompounds >= 2) {
    return {
      deloadRecommended: true,
      readinessAvg,
      reason: `Baisse de performance (>4 %) détectée sur ${regressedCompounds} exercices polyarticulaires : semaine de Deload recommandée (50 % du volume, RIR 3).`,
    };
  }

  if (readinessAvg !== null && readinessAvg < 58 && readinessScores.length >= 3) {
    return {
      deloadRecommended: true,
      readinessAvg,
      reason: `Fatigue centrale cumulée (Readiness moyen ${readinessAvg}/100 sur 3 séances) : semaine de Deload recommandée.`,
    };
  }

  if (currentWeek >= 6) {
    return {
      deloadRecommended: true,
      readinessAvg,
      reason: `Semaine ${currentWeek} d’accumulation atteinte : Deload préventif conseillé pour relancer la surcompensation.`,
    };
  }

  return { deloadRecommended: false, reason: null, readinessAvg };
}

/* ==========================================================================
   MATRICE DE MUTATION : ANALYSE PHYSIQUE -> PROGRAMME (DIFF + APPLY 1-CLIC)
   ========================================================================== */

export function computeProgramMutation(program, physiqueAnalysis, profile) {
  if (!program || !physiqueAnalysis) {
    throw new Error('Programme actif et analyse physique requis pour calculer une mutation.');
  }

  const muscleScores = Array.isArray(physiqueAnalysis.muscle_scores) ? physiqueAnalysis.muscle_scores : [];
  const lagGroups = muscleScores
    .filter((m) => String(m.status).toUpperCase() === 'LAG')
    .map((m) => m.group);
  const dominantGroups = muscleScores
    .filter((m) => String(m.status).toUpperCase() === 'DOMINANT')
    .map((m) => m.group);
  const asymmetries = Array.isArray(physiqueAnalysis.asymmetries) ? physiqueAnalysis.asymmetries : [];
  const postureFlags = Array.isArray(physiqueAnalysis.posture?.flags) ? physiqueAnalysis.posture.flags : [];

  const clonedDays = structuredClone(program.days || []);
  const volumeBefore = calculateWeeklyVolume(program.days || []);
  const changes = [];

  // 1. Réallocation de volume & ordre CNS pour les groupes [LAG] (+2 à +4 séries/semaine, placés en DÉBUT de séance)
  for (const lag of lagGroups) {
    let added = 0;
    const targetDelta = 3; // cible +2 à +4 séries/semaine
    const landmark = VOLUME_LANDMARKS[lag] || { mev: 4, mav: 10, mrv: 16 };

    for (const day of clonedDays) {
      const matchingSlot = day.exercises.find((slot) => (slot.primaryMuscles || []).includes(lag));
      if (matchingSlot) {
        matchingSlot.isLagPriority = true;
        if (added < targetDelta && (volumeBefore[lag] || 0) + added < landmark.mrv) {
          const bump = Math.min(2, targetDelta - added, 5 - matchingSlot.sets);
          if (bump > 0) {
            matchingSlot.sets += bump;
            added += bump;
            changes.push({
              type: 'lag_boost',
              dayName: day.name,
              muscle: lag,
              exerciseId: matchingSlot.exerciseId,
              exerciseName: matchingSlot.name,
              detail: `+${bump} séries & remonté en début de séance ([LAG] prioritaire)`,
            });
          }
        }
      }
    }

    // Si le groupe [LAG] était absent ou trop peu fréquent, injection sur le jour le plus pertinent
    if (added < 2 && clonedDays.length > 0) {
      const targetDay = clonedDays[0];
      const usedIds = new Set(targetDay.exercises.map((e) => e.exerciseId));
      const newEx = pickBestExercise({
        primaryMuscle: lag,
        profile,
        usedIds,
        preferUnilateral: asymmetries.length > 0,
      });
      if (newEx) {
        const goalCfg = GOAL_PROFILES[profile?.goal] || GOAL_PROFILES.recomp;
        const slot = buildDayExerciseSlot(newEx, profile, {
          sets: 3,
          isLagPriority: true,
          goalCfg,
          phase: program.phase || 'accumulation',
        });
        targetDay.exercises.unshift(slot);
        changes.push({
          type: 'lag_inject',
          dayName: targetDay.name,
          muscle: lag,
          exerciseId: newEx.id,
          exerciseName: newEx.name,
          detail: `Ajouté (+3 séries) en début de séance pour fréquence 2-3×/sem`,
        });
      }
    }
  }

  // 2. Réduction des groupes [DOMINANT] au volume de maintien (MEV)
  for (const dom of dominantGroups) {
    if (lagGroups.includes(dom)) continue;
    const mev = VOLUME_LANDMARKS[dom]?.mev ?? 4;
    let currentVol = calculateWeeklyVolume(clonedDays)[dom] || 0;

    for (const day of clonedDays) {
      if (currentVol <= mev) break;
      for (const slot of day.exercises) {
        if (currentVol <= mev) break;
        if ((slot.primaryMuscles || []).includes(dom) && !slot.isLagPriority && slot.sets > 2) {
          slot.sets -= 1;
          currentVol -= 1;
          changes.push({
            type: 'dominant_mev',
            dayName: day.name,
            muscle: dom,
            exerciseId: slot.exerciseId,
            exerciseName: slot.name,
            detail: `-1 série (abaissé vers MEV pour rediriger la récupération)`,
          });
        }
      }
    }
  }

  // 3. Correction d'asymétries droite/gauche : injection de variantes unilatérales
  if (asymmetries.length > 0) {
    for (const day of clonedDays) {
      const hasUnilateral = day.exercises.some((s) => s.unilateral);
      if (!hasUnilateral && day.exercises.length > 0) {
        const candidateIdx = day.exercises.findIndex((s) => {
          const ex = getExerciseById(s.exerciseId);
          return ex && !ex.unilateral;
        });
        if (candidateIdx !== -1) {
          const orig = day.exercises[candidateIdx];
          const swaps = findBiomechanicalSwaps(orig.exerciseId, profile, orig.suggestedLoadKg).filter(
            (sw) => sw.exercise.unilateral
          );
          if (swaps.length > 0) {
            const u = swaps[0];
            day.exercises[candidateIdx] = {
              ...orig,
              exerciseId: u.exercise.id,
              name: u.exercise.name,
              unilateral: true,
              suggestedLoadKg: u.convertedLoadKg,
              incrementKg: u.exercise.incrementKg,
              unilateralNote:
                'Asymétrie détectée : démarrer côté faible, plafonner côté fort au même nombre de réps.',
            };
            changes.push({
              type: 'asymmetry_unilateral',
              dayName: day.name,
              exerciseId: u.exercise.id,
              exerciseName: u.exercise.name,
              detail: `Remplace ${orig.name} par variante unilatérale (démarrer côté faible)`,
            });
          }
        }
      }
    }
  }

  // 4. Tri final CNS sur chaque jour : tous les exercices [LAG] en tête de séance
  for (const day of clonedDays) {
    day.exercises.sort((a, b) => Number(b.isLagPriority) - Number(a.isLagPriority));
  }

  const volumeAfter = calculateWeeklyVolume(clonedDays);
  const mergedProfileForWarmup = {
    ...profile,
    morphology: {
      ...(profile?.morphology || {}),
      postureFlags: [
        ...new Set([
          ...(profile?.morphology?.postureFlags || []),
          ...(postureFlags.some((f) => f.toLowerCase().includes('antéversion')) ? ['anterior_pelvic_tilt'] : []),
          ...(postureFlags.some((f) => f.toLowerCase().includes('cyphose') || f.toLowerCase().includes('tête'))
            ? ['kyphosis', 'forward_head']
            : []),
        ]),
      ],
    },
  };

  return {
    id: generateId('mut'),
    createdAt: Date.now(),
    lagGroups,
    dominantGroups,
    asymmetries,
    changes,
    volumeBefore,
    volumeAfter,
    nextDays: clonedDays,
    nextWarmupDrills: buildCorrectiveWarmup(mergedProfileForWarmup),
  };
}

export function applyProgramMutation(program, mutation) {
  return {
    ...program,
    days: mutation.nextDays,
    warmupDrills: mutation.nextWarmupDrills || program.warmupDrills,
    weeklyVolume: mutation.volumeAfter,
    updatedAt: Date.now(),
    mutationHistory: [
      ...(program.mutationHistory || []),
      {
        id: mutation.id,
        appliedAt: Date.now(),
        lagGroups: mutation.lagGroups,
        dominantGroups: mutation.dominantGroups,
        changesCount: mutation.changes.length,
      },
    ],
  };
}
