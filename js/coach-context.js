/**
 * Kinetix Lab — Constructeur de Dossier Omni-Contexte Coach IA (js/coach-context.js)
 *
 * Rassemble en un dossier structuré et compact 100 % des données réelles de l'athlète :
 * - Profil complet (morpho, posture, blessures, matériel, régime, objectif)
 * - Historique biométrique 30j (poids brut, EWMA, vitesse, US Navy, WHtR, BMR, TDEE, override)
 * - Nutrition du jour + moyennes & adhérence 7j et 14j + distribution protéique
 * - Programme actif + 10 dernières séances réelles (charges, reps, e1RM, douleurs, Readiness)
 * - Synthèse pro-intelligence.js (fatigue CNS, volume effectif par muscle, alertes articulaires, corrélations)
 * - Dernier bilan Labo Physique ([LAG] / [DOMINANT])
 * - Mémoire complète du Coach avec IDs
 */

import { MUSCLE_GROUPS } from './exercises-db.js';
import { buildCoachRuntimeContext, estimate1RM } from './biomechanics-engine.js';
import { getProfileAdaptiveAdjustmentKcal } from './nutrition-db.js';
import { computeProIntelligence } from './pro-intelligence.js';

const DAY_MS = 86400000;

function formatExerciseTopSet(ex) {
  const workSets = (ex.sets || []).filter((s) => !s.isWarmup && s.done);
  if (!workSets.length) return null;
  let best = workSets[0];
  let bestE1 = estimate1RM(Number(best.weightKg) || 0, Number(best.reps) || 0);
  for (const s of workSets) {
    const e1 = estimate1RM(Number(s.weightKg) || 0, Number(s.reps) || 0);
    if (e1 > bestE1) {
      bestE1 = e1;
      best = s;
    }
  }
  const painTag = ex.feedback === 'joint_pain' ? ' [DOULEUR]' : ex.feedback === 'too_easy' ? ' [FACILE]' : ex.feedback === 'at_limit' ? ' [LIMITE]' : '';
  return `${ex.name}: ${workSets.length}s top ${best.weightKg}kg×${best.reps}${bestE1 > 0 ? ` (e1RM ${Math.round(bestE1)})` : ''}${painTag}`;
}

export function buildCoachFullContext({
  profile = {},
  program = null,
  telemetry = {},
  proIntel = null,
  workouts = [],
  biometrics = [],
  nutritionAll = [],
  nutritionToday = [],
  hydration = { totalMl: 0 },
  activeSession = null,
  lastPhysiqueAnalysis = null,
  weather = null,
} = {}) {
  const { ewma = {}, adaptive = {}, macros = {}, consumed = {}, latestBio = null } = telemetry;
  const intel =
    proIntel ||
    computeProIntelligence({
      profile,
      program,
      workouts,
      biometrics,
      nutritionAll,
      nutritionToday,
      hydration,
      telemetry,
      activeSession,
      weather,
    });

  const trainingSummary = buildCoachRuntimeContext(profile, program, workouts);
  const adaptiveAdj = getProfileAdaptiveAdjustmentKcal(profile);
  const memoryItems = Array.isArray(profile?.coachMemory) ? profile.coachMemory : [];

  // 1. Profil complet & Morpho-posture
  const morph = profile?.morphology || {};
  const morphSummary = [
    morph.morphotype ? `Morphotype ${morph.morphotype}` : null,
    `Fémur/Buste: ${morph.femurTorsoRatio || 'balanced'}`,
    `Envergure: ${morph.armSpanRatio || 'balanced'}`,
    `Clavicules: ${morph.claviclePelvisRatio || 'balanced'}`,
    `Cage: ${morph.ribcageType || 'medium'}`,
    Array.isArray(morph.postureFlags) && morph.postureFlags.length ? `Posture: ${morph.postureFlags.join(', ')}` : 'Posture: neutre',
  ]
    .filter(Boolean)
    .join(' · ');

  // 2. Historique biométrique 30j
  const nowMs = Date.now();
  const bio30 = (biometrics || [])
    .filter((b) => {
      const ts = b.timestamp || Date.parse(`${b.date}T12:00:00Z`) || 0;
      return nowMs - ts <= 31 * DAY_MS;
    })
    .slice(-10);
  const bioTrendLine =
    bio30.length > 0
      ? bio30
          .map((b) => `${b.date}:${b.weightKg ?? '--'}kg${b.bodyFatPct ? `/${b.bodyFatPct}%MG` : ''}`)
          .join(' | ')
      : 'aucune pesée récente';

  const latestBf = latestBio?.bodyFatPct ?? latestBio?.navyBodyFatPct ?? null;
  const latestWhtr = latestBio?.whtr ?? null;

  // 3. Nutrition du jour + 7j / 14j
  const todayMealsLine =
    (nutritionToday || []).length > 0
      ? nutritionToday
          .slice(0, 8)
          .map((m) => `${m.label} (${m.kcal} kcal, P${m.proteinG}/G${m.carbsG}/L${m.fatG})`)
          .join(' | ')
      : 'aucun repas logué';

  const p7 = intel.nutritionTiming.period7d;
  const p14 = intel.nutritionTiming.period14d;
  const adherenceLine = [
    p7.daysLogged > 0
      ? `7j (${p7.daysLogged}j): moy ${p7.avgKcal} kcal · P${p7.avgProteinG}g/G${p7.avgCarbsG}g/L${p7.avgFatG}g · adhérence ${p7.adherencePct}%`
      : '7j: données insuffisantes',
    p14.daysLogged > 0
      ? `14j (${p14.daysLogged}j): moy ${p14.avgKcal} kcal · P${p14.avgProteinG}g · adhérence ${p14.adherencePct}%`
      : null,
  ]
    .filter(Boolean)
    .join(' | ');

  // 4. Programme actif
  const programLines = (program?.days || [])
    .map((day, dIdx) => {
      const exList = (day.exercises || [])
        .map(
          (ex) =>
            `${ex.exerciseId} ("${ex.name}", ${ex.sets}×${ex.repRange?.[0] || ex.repMin || 8}-${ex.repRange?.[1] || ex.repMax || 12} @ ${ex.suggestedLoadKg}kg, RIR ${ex.targetRir})`
        )
        .join(' ; ');
      return `  - Jour ${dIdx + 1} [${day.name}] : ${exList}`;
    })
    .join('\n');

  // 5. 10 dernières séances réelles
  const last10Workouts = [...(workouts || [])]
    .sort((a, b) => (b.endedAt || Date.parse(b.date) || 0) - (a.endedAt || Date.parse(a.date) || 0))
    .slice(0, 10);

  const workoutHistoryLines =
    last10Workouts.length > 0
      ? last10Workouts
          .map((w) => {
            const rd = w.readiness?.score ? `Rd ${w.readiness.score}/100` : 'Rd --';
            const exSummaries = (w.exercises || []).map(formatExerciseTopSet).filter(Boolean).slice(0, 5);
            return `  - ${w.date} [${w.dayName}] (${rd}) : ${exSummaries.join(' ; ') || 'séance enregistrée'}`;
          })
          .join('\n')
      : '  (aucune séance enregistrée)';

  // 6. Synthèse Pro Intelligence
  const volumeSummary = Object.values(intel.volumeByMuscle)
    .filter((v) => v.sets > 0)
    .sort((a, b) => b.sets - a.sets)
    .slice(0, 10)
    .map((v) => `${v.label}: ${v.sets}s (MEV ${v.mev}/MRV ${v.mrv}${v.zone === 'OVER_MRV' ? ' !SURCHARGE' : ''})`)
    .join(' | ');

  const jointAlertLine =
    intel.jointVigilance.recurringAlerts.length > 0
      ? intel.jointVigilance.recurringAlerts.map((a) => `${a.label} (${a.count}×/14j)`).join(', ')
      : 'aucune alerte récurrente';

  const stagLine =
    intel.stagnatingExercises.length > 0
      ? intel.stagnatingExercises.map((s) => `${s.name} (${s.sessionsFlat} séances @ e1RM ${s.latestE1rm}kg)`).join(', ')
      : 'aucune';

  // 7. Dernier bilan Labo Physique
  const lagLabels = (profile?.lagPriorities || []).map((g) => MUSCLE_GROUPS[g]?.label || g);
  const domLabels = (profile?.dominantGroups || []).map((g) => MUSCLE_GROUPS[g]?.label || g);
  const laboLine = lastPhysiqueAnalysis
    ? `Dernier scan Labo (${lastPhysiqueAnalysis.meta?.provider || 'local'}): %MG est. ${lastPhysiqueAnalysis.estimated_body_fat_pct ?? '--'}%, LAG [${lagLabels.join(', ') || 'aucun'}], DOMINANT [${domLabels.join(', ') || 'aucun'}]`
    : `LAG [${lagLabels.join(', ') || 'aucun'}] · DOMINANT [${domLabels.join(', ') || 'aucun'}]`;

  // 8. Mémoire Coach
  const memoryLines =
    memoryItems.length > 0 ? memoryItems.map((m) => `[${m.id}] ${m.text}`).join(' | ') : 'aucun repère mémorisé';

  const wInfo = intel.nutritionTiming.weather;
  const weatherLine = wInfo
    ? `${wInfo.city || 'Local'} ${wInfo.tempC}°C (${wInfo.humidityPct}% HR, bonus eau +${intel.nutritionTiming.heatHydrationBonusMl} ml${intel.nutritionTiming.electrolytesRecommended ? ', électrolytes' : ''})`
    : 'non configurée';
  const novaLine =
    intel.nutritionTiming.todayNova4Count > 0 || intel.nutritionTiming.avgNovaGroup7d
      ? `NOVA 4 aujourd'hui : ${intel.nutritionTiming.todayNova4Count}${intel.nutritionTiming.avgNovaGroup7d ? ` · Moy. 7j : ${intel.nutritionTiming.avgNovaGroup7d}` : ''}`
      : 'aucun produit NOVA 4';

  const promptText = `=== DOSSIER COMPLET TEMPS RÉEL DE L'ATHLÈTE ===
- Profil : ${profile?.name || 'Athlète'}, ${profile?.sex || 'male'}, ${profile?.age || 28} ans, ${profile?.heightCm || 176} cm, ${profile?.weightKg || 75} kg (Masse maigre est. ${macros.leanMassKg} kg)
- Morpho & Posture : ${morphSummary}
- Objectif : ${profile?.goal || 'recomp'} · Niveau : ${profile?.level || 'intermediate'} · NEAT : ${profile?.lifestyle?.neatLevel || 'mixed'}
- Régime : ${profile?.nutritionPrefs?.dietType || 'omnivore'} · Allergies : ${(profile?.nutritionPrefs?.allergies || []).join(', ') || 'aucune'} · Repas/j : ${profile?.nutritionPrefs?.mealsPerDay || 3}
- Matériel : ${(profile?.equipment || []).join(', ') || 'bodyweight'}
- Blessures/Sensibilités : ${(profile?.injuries || []).map((i) => `${i.zone}(sev ${i.severity})`).join(', ') || 'aucune'}
- Biométrie 30j : EWMA ${ewma?.latestEwmaKg ?? profile?.weightKg} kg (brut ${ewma?.latestRawKg ?? profile?.weightKg} kg, vitesse ${ewma?.weeklyDeltaKg ?? 0} kg/sem) · %MG ${latestBf ?? '--'}% · WHtR ${latestWhtr ?? '--'} · BMR ${macros.bmrKcal} kcal · Ajust. EWMA ${adaptiveAdj} kcal
- Historique pesées : ${bioTrendLine}
- Nutrition Cible : ${macros.kcal} kcal (P ${macros.proteinG}g · G ${macros.carbsG}g · L ${macros.fatG}g · Fibres ${macros.fiberG}g · Eau ${intel.nutritionTiming.recommendedWaterTodayMl} ml [${intel.nutritionTiming.dayType}]) · Mode ${macros.isOverride ? `SURCHARGE (${macros.overrideSource}${macros.overrideLocked ? ', VERROUILLÉE' : ''})` : 'AUTO'} · TDEE ${adaptive.estimatedTdeeKcal} kcal · Plancher sûr ${macros.safeFloorKcal} kcal
- Nutrition Aujourd'hui : ${consumed.kcal} kcal (P ${consumed.proteinG}g · G ${consumed.carbsG}g · L ${consumed.fatG}g · F ${intel.nutritionTiming.todayFiberG}g) · Eau ${hydration?.totalMl || 0} ml · Prises >=30g prot : ${intel.nutritionTiming.todayLeucineMeals}/${intel.nutritionTiming.targetLeucineMeals} · ${novaLine}
- Météo & Hydratation : ${weatherLine}
- Repas du jour : ${todayMealsLine}
- Moyennes & Adhérence : ${adherenceLine}
- Pro Intelligence (SFR/CNS) : Récupération ${intel.recoveryScore}/100 (Fatigue ${intel.cnsStatus}) · Séries effectives 7j : ${intel.totalEffectiveSets7d} · Tendance force e1RM : ${intel.avgStrengthTrendPct >= 0 ? '+' : ''}${intel.avgStrengthTrendPct}% · Stagnations : ${stagLine}
- Volume 7j par muscle : ${volumeSummary || 'aucune série effective enregistrée sur 7j'}
- Vigilance articulaire 14j : ${jointAlertLine} · Corrélations : ${intel.correlations.join(' ; ') || 'en cours de calibration'}
- Bilan Labo Physique : ${laboLine}
- Programme actif : ${trainingSummary.activeSplitLabel} (${program?.splitType || 'auto'}) · Méthode ${trainingSummary.activeMethodLabel} (${program?.progressionMethod || 'double_progression'}) · Phase ${program?.phase || 'calibration'} (Sem. ${program?.weekNumber || 1}) · ${profile?.sessionsPerWeek || 4} j/sem · ${profile?.sessionDurationMin || 60} min${activeSession ? ` · Séance en cours : ${activeSession.dayName}` : ''}
- Exercices du programme actif :
${programLines || '  (aucun)'}
- 10 dernières séances réelles :
${workoutHistoryLines}
- Mémoire du Coach (${memoryItems.length} repères) : ${memoryLines}`;

  // Sections structurées pour la modale "Contexte actif" cliquable dans l'en-tête du Coach
  const rawSections = [
    {
      title: 'Profil & Morpho-Posture',
      items: [
        `${profile?.name || 'Athlète'} · ${profile?.weightKg || 75} kg · ${profile?.heightCm || 176} cm · ${profile?.goal || 'recomp'} (${profile?.level || 'intermediate'})`,
        morphSummary,
        `Blessures : ${(profile?.injuries || []).map((i) => `${i.zone} (niv.${i.severity})`).join(', ') || 'aucune'} · Matériel : ${(profile?.equipment || []).length} types`,
      ],
    },
    {
      title: 'Biométrie 30j & Métabolisme',
      items: [
        `EWMA : ${ewma?.latestEwmaKg ?? profile?.weightKg} kg (${ewma?.weeklyDeltaKg >= 0 ? '+' : ''}${ewma?.weeklyDeltaKg ?? 0} kg/sem) · ${bio30.length} mesure(s) sur 30j`,
        `BMR ${macros.bmrKcal} kcal · TDEE ${adaptive.estimatedTdeeKcal} kcal · Cible ${macros.kcal} kcal (${macros.isOverride ? 'SURCHARGE' : `AUTO ${adaptiveAdj >= 0 ? '+' : ''}${adaptiveAdj}`})`,
        `%MG : ${latestBf !== null ? `${latestBf} %` : 'non mesuré'} · WHtR : ${latestWhtr ?? '--'}`,
      ],
    },
    {
      title: 'Nutrition Jour + 7j / 14j & Météo',
      items: [
        `Aujourd'hui (${intel.nutritionTiming.dayType === 'training' ? 'Jour Entraînement' : 'Jour Repos'}) : ${consumed.kcal}/${macros.kcal} kcal · P ${consumed.proteinG}g · G ${consumed.carbsG}g · L ${consumed.fatG}g · Eau ${hydration?.totalMl || 0}/${intel.nutritionTiming.recommendedWaterTodayMl} ml`,
        `Prises >= 30g prot (seuil leucine) : ${intel.nutritionTiming.todayLeucineMeals}/${intel.nutritionTiming.targetLeucineMeals} · Plancher lipides : ${intel.nutritionTiming.hormonalFatFloorG} g · ${novaLine}`,
        `Météo : ${weatherLine}`,
        adherenceLine,
      ],
    },
    {
      title: 'Moteur Pro (SFR / CNS / Volume 7j / Articulations)',
      items: [
        `Récupération CNS : ${intel.recoveryScore}/100 (${intel.cnsStatus}) · ${intel.totalEffectiveSets7d} séries effectives (RIR <= 3) sur 7j`,
        `Tendance e1RM : ${intel.avgStrengthTrendPct >= 0 ? '+' : ''}${intel.avgStrengthTrendPct}% · Stagnations : ${stagLine}`,
        `Vigilance articulaire 14j : ${jointAlertLine}`,
        ...(intel.correlations.length ? [`Corrélations : ${intel.correlations.join(' · ')}`] : []),
      ],
    },
    {
      title: `Programme & ${last10Workouts.length} dernières séances`,
      items: [
        `${trainingSummary.activeSplitLabel} · ${trainingSummary.activeMethodLabel} · Phase ${program?.phase || 'calibration'}`,
        laboLine,
        `Mémoire Coach : ${memoryItems.length} repère(s) actif(s)`,
      ],
    },
  ];

  const sections = rawSections.map((s) => ({
    ...s,
    body: s.items.map((line) => `• ${line}`).join('\n'),
  }));

  return {
    promptText,
    sections,
    proIntel: intel,
    stats: {
      workoutsCount: last10Workouts.length,
      bioCount30d: bio30.length,
      biometricsCount: bio30.length,
      memoryCount: memoryItems.length,
      recoveryScore: intel.recoveryScore,
    },
  };
}
