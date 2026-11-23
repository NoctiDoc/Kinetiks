/**
 * Kinetix Lab — Moteur Scientifique Pro en Arrière-Plan (js/pro-intelligence.js)
 *
 * Tourne silencieusement en 100 % local (Niveau 0) à chaque mise à jour de données pour alimenter
 * le Cockpit, la Séance, la Nutrition et le Coach sans surcharger l'interface :
 * 1. Suivi du Volume Effectif (RIR <= 3) par groupe musculaire sur 7j glissants vs MEV / MAV / MRV adaptés
 * 2. Indice de Fatigue / Récupération Systémique (SFR / CNS 0-100) + détection surcharge / stagnation
 * 3. Vigilance Articulaire & Longévité (suivi douleurs 14j, mouvements à risque, préhab auto)
 * 4. Moteur Métabolique & Timing Nutritionnel (Training vs Rest, seuil leucine >= 30g, lipides, fibres,
 *    adhérence 7j/14j et corrélations terrain sommeil/protéines -> performance)
 */

import { MUSCLE_GROUPS, getExerciseById } from './exercises-db.js';
import { VOLUME_LANDMARKS, estimate1RM } from './biomechanics-engine.js';

const DAY_MS = 86400000;

const ZONE_LABELS = Object.freeze({
  shoulder: 'Épaule',
  lumbar: 'Lombaires',
  knee: 'Genou',
  elbow: 'Coude',
  wrist: 'Poignet',
  neck: 'Cervicales',
});

const CONTRA_TO_ZONE = Object.freeze({
  shoulder_impingement: 'shoulder',
  anterior_shoulder: 'shoulder',
  lumbar_shear: 'lumbar',
  lumbar_flexion: 'lumbar',
  knee_shear: 'knee',
  elbow_tendon: 'elbow',
  wrist_extension: 'wrist',
  cervical_load: 'neck',
});

const MUSCLE_TO_ZONE_FALLBACK = Object.freeze({
  pecs_mid: 'shoulder',
  pecs_upper: 'shoulder',
  delts_ant: 'shoulder',
  delts_lat: 'shoulder',
  delts_post: 'shoulder',
  quads: 'knee',
  hamstrings: 'lumbar',
  glutes: 'lumbar',
  erectors: 'lumbar',
  biceps: 'elbow',
  triceps: 'elbow',
  forearms: 'wrist',
  traps: 'neck',
});

const PREHAB_BY_ZONE = Object.freeze({
  shoulder: [
    { name: 'Préhab Épaule · Rotations externes élastique/poulie (coude collé)', sets: 2, reps: '15/côté' },
    { name: 'Préhab Épaule · Scapular Wall Slides & Face Pull léger', sets: 2, reps: '12–15' },
  ],
  lumbar: [
    { name: 'Préhab Lombaires · McGill Big 3 (Bird-Dog + Dead Bug contrôlé)', sets: 2, reps: '8/côté' },
    { name: 'Préhab Lombaires · Bascule pelvienne & Cat-Cow thoracique', sets: 2, reps: '10' },
  ],
  knee: [
    { name: 'Préhab Genou · Spanish Squat isométrique / TKE élastique', sets: 2, reps: '30 s' },
    { name: 'Préhab Genou · Mobilité cheville genou-mur (dorsiflexion)', sets: 2, reps: '10/côté' },
  ],
  elbow: [
    { name: 'Préhab Coude · Excentriques poignet / pronation-supination léger', sets: 2, reps: '15/côté' },
  ],
  wrist: [
    { name: 'Préhab Poignet · Cercles + extensions en charge douce au sol', sets: 2, reps: '12' },
  ],
  neck: [
    { name: 'Préhab Cervicales · Chin Tucks contrôlés & dépression scapulaire', sets: 2, reps: '10' },
  ],
});

function parseIsoDayMs(isoStr, fallbackTs = 0) {
  if (typeof isoStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(isoStr)) {
    const t = Date.parse(`${isoStr.slice(0, 10)}T12:00:00Z`);
    if (Number.isFinite(t)) return t;
  }
  return Number(fallbackTs) || 0;
}

function getTodayUtcNoonMs(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return Date.parse(`${y}-${m}-${d}T12:00:00Z`);
}

function getAdaptedLandmarks(muscleKey, level = 'intermediate', deficitKcal = 0) {
  const base = VOLUME_LANDMARKS[muscleKey] || { mev: 4, mav: [8, 12], mrv: 16 };
  const levelFactor = level === 'beginner' ? 0.8 : level === 'advanced' ? 1.15 : 1.0;
  // Un déficit calorique > 250 kcal réduit la capacité de récupération (MRV -12 % à -18 %)
  const deficitFactor = deficitKcal >= 450 ? 0.82 : deficitKcal >= 250 ? 0.88 : 1.0;

  const mev = Math.max(2, Math.round(base.mev * levelFactor));
  const mavLow = Math.max(mev, Math.round((base.mav?.[0] || 8) * levelFactor * deficitFactor));
  const mavHigh = Math.max(mavLow + 2, Math.round((base.mav?.[1] || 12) * levelFactor * deficitFactor));
  const mrv = Math.max(mavHigh + 1, Math.round(base.mrv * levelFactor * deficitFactor));
  return { mev, mav: [mavLow, mavHigh], mrv };
}

function getBestWorkingE1rm(exEntry) {
  const sets = Array.isArray(exEntry?.sets) ? exEntry.sets : [];
  let best = 0;
  for (const s of sets) {
    if (s.isWarmup || !s.done) continue;
    const w = Number(s.weightKg) || 0;
    const r = Number(s.reps) || 0;
    if (w > 0 && r > 0) {
      const e = estimate1RM(w, r);
      if (e > best) best = e;
    }
  }
  return best;
}

function inferPainZonesForExercise(exEntry) {
  const meta = getExerciseById(exEntry?.exerciseId);
  const zones = new Set();
  if (meta?.contraindications?.length) {
    for (const c of meta.contraindications) {
      if (CONTRA_TO_ZONE[c]) zones.add(CONTRA_TO_ZONE[c]);
    }
  }
  if (zones.size === 0 && meta?.primaryMuscles?.length) {
    for (const m of meta.primaryMuscles) {
      if (MUSCLE_TO_ZONE_FALLBACK[m]) zones.add(MUSCLE_TO_ZONE_FALLBACK[m]);
    }
  }
  if (zones.size === 0) {
    const nm = String(exEntry?.name || '').toLowerCase();
    if (nm.includes('squat') || nm.includes('presse') || nm.includes('fente') || nm.includes('leg')) zones.add('knee');
    else if (nm.includes('soulev') || nm.includes('row') || nm.includes('dos')) zones.add('lumbar');
    else if (nm.includes('curl') || nm.includes('triceps') || nm.includes('barre au front')) zones.add('elbow');
    else zones.add('shoulder');
  }
  return Array.from(zones);
}

/**
 * Agrège les logs nutritionnels par jour (ISO YYYY-MM-DD) sur les N derniers jours (hors aujourd'hui si incomplet).
 */
function aggregateDailyNutrition(nutritionAll = [], todayMs) {
  const byDay = new Map();
  for (const log of nutritionAll || []) {
    if (!log?.date) continue;
    const ts = parseIsoDayMs(log.date, log.timestamp);
    if (!ts || ts > todayMs + DAY_MS) continue;
    const cur = byDay.get(log.date) || {
      date: log.date,
      ts,
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      mealsCount: 0,
      leucineHits: 0,
    };
    const p = Number(log.proteinG) || 0;
    cur.kcal += Number(log.kcal) || 0;
    cur.proteinG += p;
    cur.carbsG += Number(log.carbsG) || 0;
    cur.fatG += Number(log.fatG) || 0;
    cur.fiberG += Number(log.fiberG) || 0;
    cur.mealsCount += 1;
    if (p >= 30) cur.leucineHits += 1;
    byDay.set(log.date, cur);
  }
  return Array.from(byDay.values()).sort((a, b) => b.ts - a.ts);
}

/**
 * Calcule la synthèse scientifique Pro complète (100 % déterministe, < 2 ms).
 */
export function computeProIntelligence({
  profile = {},
  program = null,
  workouts = [],
  biometrics = [],
  nutritionAll = [],
  nutritionToday = [],
  hydration = { totalMl: 0 },
  telemetry = {},
  activeSession = null,
  weather = null,
} = {}) {
  const todayMs = getTodayUtcNoonMs();
  const todayISO = new Date(todayMs).toISOString().slice(0, 10);
  const macros = telemetry?.macros || { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70, fiberG: 30, waterTargetMl: 2800, tdeeKcal: 2400 };
  const adaptive = telemetry?.adaptive || { estimatedTdeeKcal: macros.tdeeKcal || 2400 };
  const consumed = telemetry?.consumed || { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };

  const deficitKcal = Math.max(0, Math.round((adaptive.estimatedTdeeKcal || macros.tdeeKcal || macros.kcal) - macros.kcal));
  const sortedWorkouts = [...(workouts || [])].sort(
    (a, b) => parseIsoDayMs(b.date, b.endedAt || b.startedAt) - parseIsoDayMs(a.date, a.endedAt || a.startedAt)
  );

  /* ------------------------------------------------------------------------
     1. VOLUME EFFECTIF (RIR <= 3) SUR 7 JOURS GLISSANTS VS MEV / MAV / MRV
     ------------------------------------------------------------------------ */
  const workouts7d = sortedWorkouts.filter((w) => todayMs - parseIsoDayMs(w.date, w.endedAt) <= 7 * DAY_MS);
  const effectiveSetsByMuscle = {};
  let totalEffectiveSets7d = 0;

  for (const w of workouts7d) {
    for (const ex of w.exercises || []) {
      const meta = getExerciseById(ex.exerciseId);
      const workingSets = (ex.sets || []).filter(
        (s) => !s.isWarmup && s.done && (s.rir === undefined || s.rir === null || Number(s.rir) <= 3)
      ).length;
      if (workingSets <= 0) continue;
      totalEffectiveSets7d += workingSets;

      if (meta) {
        for (const m of meta.primaryMuscles || []) {
          effectiveSetsByMuscle[m] = (effectiveSetsByMuscle[m] || 0) + workingSets;
        }
        for (const m of meta.secondaryMuscles || []) {
          effectiveSetsByMuscle[m] = (effectiveSetsByMuscle[m] || 0) + workingSets * 0.5;
        }
      }
    }
  }

  const volumeByMuscle = {};
  const overloadedMuscles = [];
  const underMevMuscles = [];
  const programmedMuscles = new Set();
  for (const day of program?.days || []) {
    for (const ex of day.exercises || []) {
      const meta = getExerciseById(ex.exerciseId);
      (meta?.primaryMuscles || []).forEach((m) => programmedMuscles.add(m));
    }
  }

  for (const mKey of Object.keys(MUSCLE_GROUPS)) {
    const sets = Math.round((effectiveSetsByMuscle[mKey] || 0) * 10) / 10;
    const lm = getAdaptedLandmarks(mKey, profile?.level || 'intermediate', deficitKcal);
    let zone = 'OPTIMAL';
    if (sets >= lm.mrv) {
      zone = 'OVER_MRV';
      overloadedMuscles.push({ key: mKey, label: MUSCLE_GROUPS[mKey].label, sets, mrv: lm.mrv });
    } else if (sets > lm.mav[1]) {
      zone = 'HIGH';
    } else if (sets < lm.mev && programmedMuscles.has(mKey) && workouts7d.length >= 2) {
      zone = 'UNDER_MEV';
      underMevMuscles.push({ key: mKey, label: MUSCLE_GROUPS[mKey].label, sets, mev: lm.mev });
    }
    if (sets > 0 || programmedMuscles.has(mKey)) {
      volumeByMuscle[mKey] = {
        label: MUSCLE_GROUPS[mKey].label,
        sets,
        mev: lm.mev,
        mav: lm.mav,
        mrv: lm.mrv,
        zone,
      };
    }
  }

  /* ------------------------------------------------------------------------
     2. TENDANCE DE FORCE (e1RM) & STAGNATION PAR EXERCICE / MOUVEMENT
     ------------------------------------------------------------------------ */
  const e1rmHistoryByEx = new Map();
  for (const w of [...sortedWorkouts].reverse()) {
    for (const ex of w.exercises || []) {
      const best = getBestWorkingE1rm(ex);
      if (best <= 0) continue;
      const arr = e1rmHistoryByEx.get(ex.exerciseId) || [];
      arr.push({ date: w.date, name: ex.name, e1rm: best });
      e1rmHistoryByEx.set(ex.exerciseId, arr);
    }
  }

  const stagnatingExercises = [];
  let e1rmTrendDeltaPctSum = 0;
  let e1rmTrendCount = 0;

  for (const [exId, hist] of e1rmHistoryByEx.entries()) {
    if (hist.length < 2) continue;
    const recent = hist.slice(-3);
    const first = recent[0].e1rm;
    const last = recent[recent.length - 1].e1rm;
    const pct = ((last - first) / Math.max(1, first)) * 100;
    e1rmTrendDeltaPctSum += pct;
    e1rmTrendCount += 1;

    if (recent.length >= 3 && last <= first * 1.005) {
      const meta = getExerciseById(exId);
      stagnatingExercises.push({
        exerciseId: exId,
        name: recent[recent.length - 1].name,
        pattern: meta?.movementPattern || 'compound',
        sessionsFlat: recent.length,
        latestE1rm: Number(last.toFixed(1)),
      });
    }
  }
  const avgStrengthTrendPct = e1rmTrendCount > 0 ? Number((e1rmTrendDeltaPctSum / e1rmTrendCount).toFixed(1)) : 0;

  /* ------------------------------------------------------------------------
     3. INDICE DE FATIGUE / RÉCUPÉRATION SYSTÉMIQUE (SFR / CNS 0-100)
     ------------------------------------------------------------------------ */
  const recentReadiness = sortedWorkouts
    .slice(0, 4)
    .map((w) => Number(w.readiness?.score))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgReadiness = recentReadiness.length
    ? Math.round(recentReadiness.reduce((a, b) => a + b, 0) / recentReadiness.length)
    : 78;

  const targetSpw = Math.max(2, Number(profile?.sessionsPerWeek) || 4);
  const densityRatio = workouts7d.length / targetSpw;

  let recoveryScore = avgReadiness;
  if (densityRatio > 1.25) recoveryScore -= 12;
  else if (densityRatio > 1.05) recoveryScore -= 5;
  if (deficitKcal >= 450) recoveryScore -= 10;
  else if (deficitKcal >= 250) recoveryScore -= 5;
  if (overloadedMuscles.length >= 2) recoveryScore -= 12;
  else if (overloadedMuscles.length === 1) recoveryScore -= 6;
  if (avgStrengthTrendPct <= -2.5) recoveryScore -= 10;
  else if (avgStrengthTrendPct >= 1.5) recoveryScore += 4;

  recoveryScore = Math.max(15, Math.min(100, Math.round(recoveryScore)));
  const cnsStatus =
    recoveryScore >= 75 ? 'OPTIMAL' : recoveryScore >= 55 ? 'MODÉRÉE' : 'ÉLEVÉE';

  /* ------------------------------------------------------------------------
     4. VIGILANCE ARTICULAIRE & LONGÉVITÉ (14 JOURS GLISSANTS)
     ------------------------------------------------------------------------ */
  const workouts14d = sortedWorkouts.filter((w) => todayMs - parseIsoDayMs(w.date, w.endedAt) <= 14 * DAY_MS);
  const painCountsByZone = {};
  const riskyExerciseIds = new Set();
  const painEvents14d = [];

  for (const w of workouts14d) {
    for (const ex of w.exercises || []) {
      if (ex.feedback === 'joint_pain') {
        riskyExerciseIds.add(ex.exerciseId);
        const zones = inferPainZonesForExercise(ex);
        for (const z of zones) {
          painCountsByZone[z] = (painCountsByZone[z] || 0) + 1;
        }
        painEvents14d.push({ date: w.date, exerciseId: ex.exerciseId, name: ex.name, zones });
      }
    }
  }

  // Zones récurrentes (>= 2 signalements en 14j)
  const recurringJointAlerts = Object.entries(painCountsByZone)
    .filter(([, count]) => count >= 2)
    .map(([zone, count]) => ({
      zone,
      label: ZONE_LABELS[zone] || zone,
      count,
      prehabDrills: PREHAB_BY_ZONE[zone] || [],
    }));

  const autoPrehabDrills = [];
  const seenPrehab = new Set();
  for (const alert of recurringJointAlerts) {
    for (const drill of alert.prehabDrills) {
      if (!seenPrehab.has(drill.name)) {
        seenPrehab.add(drill.name);
        autoPrehabDrills.push({ ...drill, zone: alert.zone, autoInjected: true });
      }
    }
  }

  /* ------------------------------------------------------------------------
     5. MOTEUR MÉTABOLIQUE, MÉTÉO, TIMING (TRAINING VS REST) & ADHÉRENCE 7J / 14J
     ------------------------------------------------------------------------ */
  const trainedToday = Boolean(
    activeSession || sortedWorkouts.some((w) => w.date === todayISO)
  );
  const dayType = trainedToday ? 'training' : 'rest';
  const periWorkoutHydrationBonusMl = trainedToday ? 500 : 0;
  const heatHydrationBonusMl = Math.max(0, Math.min(700, Number(weather?.heatHydrationBonusMl) || 0));
  const electrolytesRecommended = Boolean(weather?.electrolytesRecommended || (trainedToday && heatHydrationBonusMl >= 300));
  const recommendedWaterTodayMl = (macros.waterTargetMl || 2800) + periWorkoutHydrationBonusMl + heatHydrationBonusMl;

  // Distribution protéique du jour (seuil leucine >= 30g/prise) & score NOVA (Open Food Facts)
  const todayLeucineMeals = (nutritionToday || []).filter((m) => Number(m.proteinG) >= 30).length;
  const targetLeucineMeals = Math.max(3, Math.min(5, Number(profile?.nutritionPrefs?.mealsPerDay) || 3));
  const hormonalFatFloorG = Math.max(45, Math.round((Number(profile?.weightKg) || 75) * 0.7));
  const fiberFloorG = Math.max(25, Number(macros.fiberG) || 28);
  const todayNova4Count = (nutritionToday || []).filter((m) => Number(m.novaGroup) === 4).length;
  const recentNovaLogs = (nutritionAll || [])
    .filter((l) => todayMs - parseIsoDayMs(l.date, l.timestamp) <= 7 * DAY_MS && Number(l.novaGroup) >= 1 && Number(l.novaGroup) <= 4);
  const avgNovaGroup7d = recentNovaLogs.length
    ? Math.round((recentNovaLogs.reduce((s, l) => s + Number(l.novaGroup), 0) / recentNovaLogs.length) * 10) / 10
    : null;

  const dailyNut = aggregateDailyNutrition(nutritionAll, todayMs);
  const completedDays = dailyNut.filter((d) => d.date !== todayISO && d.kcal >= 800);
  const days7 = completedDays.filter((d) => todayMs - d.ts <= 8 * DAY_MS).slice(0, 7);
  const days14 = completedDays.filter((d) => todayMs - d.ts <= 15 * DAY_MS).slice(0, 14);

  const summarizePeriod = (rows) => {
    if (!rows.length) {
      return { daysLogged: 0, avgKcal: 0, avgProteinG: 0, avgCarbsG: 0, avgFatG: 0, avgFiberG: 0, adherencePct: null };
    }
    const avgKcal = Math.round(rows.reduce((s, r) => s + r.kcal, 0) / rows.length);
    const avgProteinG = Math.round(rows.reduce((s, r) => s + r.proteinG, 0) / rows.length);
    const avgCarbsG = Math.round(rows.reduce((s, r) => s + r.carbsG, 0) / rows.length);
    const avgFatG = Math.round(rows.reduce((s, r) => s + r.fatG, 0) / rows.length);
    const avgFiberG = Math.round(rows.reduce((s, r) => s + r.fiberG, 0) / rows.length);
    const onTarget = rows.filter(
      (r) =>
        Math.abs(r.kcal - macros.kcal) <= Math.max(180, macros.kcal * 0.12) &&
        r.proteinG >= macros.proteinG * 0.85
    ).length;
    return {
      daysLogged: rows.length,
      avgKcal,
      avgProteinG,
      avgCarbsG,
      avgFatG,
      avgFiberG,
      adherencePct: Math.round((onTarget / rows.length) * 100),
    };
  };

  const period7d = summarizePeriod(days7);
  const period14d = summarizePeriod(days14);

  // Corrélations terrain simples (sommeil -> volume/perf ; protéines veille -> readiness)
  const correlations = [];
  const workoutsWithSleep = sortedWorkouts.filter((w) => Number(w.readiness?.sleep) >= 1);
  if (workoutsWithSleep.length >= 4) {
    const highSleep = workoutsWithSleep.filter((w) => Number(w.readiness.sleep) >= 4);
    const lowSleep = workoutsWithSleep.filter((w) => Number(w.readiness.sleep) <= 2);
    if (highSleep.length >= 2 && lowSleep.length >= 1) {
      const avgVol = (list) =>
        Math.round(
          list.reduce(
            (sum, w) =>
              sum +
              (w.exercises || []).reduce(
                (es, ex) =>
                  es +
                  (ex.sets || []).reduce(
                    (ss, s) => ss + (!s.isWarmup && s.done ? (Number(s.weightKg) || 0) * (Number(s.reps) || 0) : 0),
                    0
                  ),
                0
              ),
            0
          ) / list.length
        );
      const hiVol = avgVol(highSleep);
      const loVol = avgVol(lowSleep);
      if (loVol > 0 && hiVol > loVol * 1.08) {
        const diffPct = Math.round(((hiVol - loVol) / loVol) * 100);
        correlations.push(`Sommeil >= 4/5 associé à +${diffPct} % de tonnage par séance.`);
      }
    }
  }

  if (days14.length >= 4 && sortedWorkouts.length >= 3) {
    const nutMap = new Map(days14.map((d) => [d.date, d]));
    const hiProtRd = [];
    const loProtRd = [];
    for (const w of sortedWorkouts.slice(0, 12)) {
      const wTs = parseIsoDayMs(w.date, w.endedAt);
      const prevIso = new Date(wTs - DAY_MS).toISOString().slice(0, 10);
      const prevNut = nutMap.get(prevIso);
      const rd = Number(w.readiness?.score);
      if (prevNut && Number.isFinite(rd)) {
        if (prevNut.proteinG >= macros.proteinG * 0.9) hiProtRd.push(rd);
        else loProtRd.push(rd);
      }
    }
    if (hiProtRd.length >= 2 && loProtRd.length >= 1) {
      const avgHi = Math.round(hiProtRd.reduce((a, b) => a + b, 0) / hiProtRd.length);
      const avgLo = Math.round(loProtRd.reduce((a, b) => a + b, 0) / loProtRd.length);
      if (avgHi - avgLo >= 6) {
        correlations.push(`Protéines >= 90 % la veille associées à +${avgHi - avgLo} pts de Readiness.`);
      }
    }
  }

  /* ------------------------------------------------------------------------
     6. SYNTHÈSE DE SIGNAUX COURTS & ACTIONNABLES (ZÉRO BRUIT VISUEL)
     ------------------------------------------------------------------------ */
  const signals = [];

  if (recoveryScore < 52) {
    signals.push({
      id: 'cns_fatigue',
      severity: 'danger',
      scope: 'training',
      text: `Fatigue nerveuse élevée (Récup ${recoveryScore}/100) : -1 série recommandée aujourd'hui.`,
    });
  } else if (overloadedMuscles.length > 0) {
    const top = overloadedMuscles[0];
    signals.push({
      id: 'over_mrv',
      severity: 'warn',
      scope: 'training',
      text: `Volume ${top.label} élevé (${top.sets} séries / MRV ${top.mrv}) : privilégie la qualité ou 1 jour de repos.`,
    });
  }

  if (recurringJointAlerts.length > 0) {
    const a = recurringJointAlerts[0];
    signals.push({
      id: `joint_${a.zone}`,
      severity: 'danger',
      scope: 'joint',
      text: `Vigilance ${a.label} (${a.count} signalements / 14j) : préhab ciblé activé en échauffement.`,
    });
  }

  if (stagnatingExercises.length > 0) {
    const st = stagnatingExercises[0];
    signals.push({
      id: 'stagnation',
      severity: 'warn',
      scope: 'training',
      text: `Stagnation sur ${st.name} (${st.sessionsFlat} séances) : deload ou changement d'angle conseillé.`,
    });
  }

  if (heatHydrationBonusMl >= 300 && weather) {
    signals.push({
      id: 'weather_heat',
      severity: heatHydrationBonusMl >= 500 ? 'warn' : 'info',
      scope: 'nutrition',
      text: `Météo ${weather.city || 'locale'} (${weather.tempC}°C · ${weather.humidityPct}% HR) : +${heatHydrationBonusMl} ml eau${electrolytesRecommended ? ' + électrolytes recommandés' : ''}.`,
    });
  } else if (dayType === 'training' && (hydration?.totalMl || 0) < recommendedWaterTodayMl * 0.5) {
    signals.push({
      id: 'training_timing',
      severity: 'info',
      scope: 'nutrition',
      text: `Jour d'entraînement : priorise les glucides autour de la séance (+500 ml eau + électrolytes).`,
    });
  } else if (consumed.kcal >= macros.kcal * 0.65 && consumed.fatG < hormonalFatFloorG * 0.65) {
    signals.push({
      id: 'lipid_floor',
      severity: 'warn',
      scope: 'nutrition',
      text: `Plancher lipidique hormonal bas (${consumed.fatG} g / min ${hormonalFatFloorG} g) : ajoute 1 source d'oméga-3/huile.`,
    });
  } else if (todayNova4Count >= 2) {
    signals.push({
      id: 'nova4_alert',
      severity: 'warn',
      scope: 'nutrition',
      text: `${todayNova4Count} produits ultra-transformés (NOVA 4) aujourd'hui : privilégie des aliments bruts au prochain repas.`,
    });
  }

  // Normalise les clés (severity/level et scope/area) pour tous les consommateurs UI
  const normalizedSignals = signals.slice(0, 3).map((sig) => ({
    ...sig,
    level: sig.severity,
    area: sig.scope,
  }));

  return {
    generatedAt: Date.now(),
    recoveryScore,
    cnsStatus,
    totalEffectiveSets7d,
    workouts7dCount: workouts7d.length,
    avgReadiness,
    avgStrengthTrendPct,
    volumeByMuscle,
    overloadedMuscles,
    underMevMuscles,
    stagnatingExercises,
    jointVigilance: {
      painEvents14dCount: painEvents14d.length,
      recurringAlerts: recurringJointAlerts,
      riskyExerciseIds: Array.from(riskyExerciseIds),
      autoPrehabDrills,
    },
    nutritionTiming: {
      dayType,
      periWorkoutHydrationBonusMl,
      heatHydrationBonusMl,
      electrolytesRecommended,
      recommendedWaterTodayMl,
      todayLeucineMeals,
      targetLeucineMeals,
      hormonalFatFloorG,
      fiberFloorG,
      todayFiberG: Math.round((consumed.fiberG || 0) * 10) / 10,
      todayNova4Count,
      avgNovaGroup7d,
      weather: weather || null,
      period7d,
      period14d,
    },
    correlations,
    signals: normalizedSignals,
  };
}
