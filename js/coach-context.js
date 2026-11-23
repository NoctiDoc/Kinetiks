/**
 * Kinetix Lab — Constructeur de Dossier Omni-Contexte Coach IA (js/coach-context.js)
 *
 * Rassemble en un dossier ultra-compact (< 2 500 tokens) les données réelles de l'athlète :
 * - Profil complet (morpho, posture, blessures, matériel, régime, objectif)
 * - Biométrie récente (EWMA, vitesse, %MG, WHtR, BMR, TDEE, 5 dernières pesées)
 * - Nutrition du jour + moyenne & adhérence 7j
 * - Programme actif + 5 dernières séances réelles
 * - Sous-ensemble filtré <= 45 exercices essentiels (matériel + blessures) au format id:Nom sur 1 ligne
 * - Synthèse pro-intelligence.js, bilan Labo Physique et mémoire Coach
 */

import { EXERCISES_DB, MUSCLE_GROUPS } from './exercises-db.js';
import { buildCoachRuntimeContext, estimate1RM } from './biomechanics-engine.js';
import { getProfileAdaptiveAdjustmentKcal } from './nutrition-db.js';
import { computeProIntelligence } from './pro-intelligence.js';

const DAY_MS = 86400000;
const MAX_COMPACT_CATALOG_EXERCISES = 45;

const INJURY_CONTRAINDICATION_MAP = Object.freeze({
  lumbar: ['lumbar_shear', 'lumbar_flexion'],
  shoulder: ['shoulder_impingement', 'anterior_shoulder'],
  knee: ['knee_shear'],
  wrist: ['wrist_extension'],
  elbow: ['elbow_tendon'],
  neck: ['cervical_load'],
});

function hasProfileEquipment(exercise, userEquipment = []) {
  const eqList = Array.isArray(exercise?.equipment) ? exercise.equipment : [];
  if (eqList.length === 0) return true;
  const owned = new Set([...(Array.isArray(userEquipment) ? userEquipment : []), 'bodyweight']);
  if (eqList.includes('bench') && !owned.has('bench')) return false;
  const nonBench = eqList.filter((eq) => eq !== 'bench');
  if (nonBench.length === 0) return true;
  return nonBench.some((eq) => owned.has(eq));
}

function getInjuryFilters(injuries = []) {
  const blocked = new Set();
  const caution = new Set();
  for (const inj of Array.isArray(injuries) ? injuries : []) {
    const tags = INJURY_CONTRAINDICATION_MAP[inj?.zone] || [];
    const sev = Number(inj?.severity) || 1;
    for (const tag of tags) {
      if (sev >= 2) blocked.add(tag);
      else caution.add(tag);
    }
  }
  return { blocked, caution };
}

/**
 * Sélectionne au maximum 45 exercices essentiels de EXERCISES_DB filtrés strictement
 * selon le matériel et les blessures du profil, répartis équitablement sur tous les
 * groupes musculaires (priorité aux groupes [LAG] et exercices de référence natifs).
 * Exclut les exercices déjà présents dans le programme actif (déjà listés dans PROG).
 */
export function selectCompactCoachExercises(profile = {}, program = null, maxCount = MAX_COMPACT_CATALOG_EXERCISES) {
  const cap = Math.max(1, Math.min(MAX_COMPACT_CATALOG_EXERCISES, Number(maxCount) || MAX_COMPACT_CATALOG_EXERCISES));
  const { blocked, caution } = getInjuryFilters(profile?.injuries);
  const userEquipment = Array.isArray(profile?.equipment) ? profile.equipment : [];

  const activeProgramIds = new Set();
  for (const day of program?.days || []) {
    for (const slot of day.exercises || []) {
      if (slot?.exerciseId) activeProgramIds.add(slot.exerciseId);
    }
  }

  const eligible = (EXERCISES_DB || []).filter((ex) => {
    if (!ex?.id || !ex?.name) return false;
    if (activeProgramIds.has(ex.id)) return false;
    if (!hasProfileEquipment(ex, userEquipment)) return false;
    const contras = Array.isArray(ex.contraindications) ? ex.contraindications : [];
    if (contras.some((c) => blocked.has(c))) return false;
    return true;
  });

  const scoreCandidate = (ex) => {
    let score = 0;
    // Priorité absolue aux exercices natifs biomécaniques (noms français propres & calibrés)
    if (!ex.isExternalCatalog && ex.source !== 'free-exercise-db') score += 50;
    if (ex.category === 'compound') score += 12;
    const contras = Array.isArray(ex.contraindications) ? ex.contraindications : [];
    if (contras.some((c) => caution.has(c))) score -= 18;
    return score;
  };

  const buckets = new Map();
  for (const ex of eligible) {
    const primary = ex.primaryMuscles?.[0] || 'other';
    if (!buckets.has(primary)) buckets.set(primary, []);
    buckets.get(primary).push(ex);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => scoreCandidate(b) - scoreCandidate(a) || a.id.localeCompare(b.id));
  }

  const lagList = Array.isArray(profile?.lagPriorities) ? profile.lagPriorities : [];
  const allGroups = Array.from(
    new Set([...lagList, ...Object.keys(MUSCLE_GROUPS), ...buckets.keys()])
  ).filter((g) => buckets.has(g));

  const selected = [];
  const seenIds = new Set();
  let round = 0;

  while (selected.length < cap) {
    let addedInRound = false;
    for (const grp of allGroups) {
      const list = buckets.get(grp);
      if (!list || round >= list.length) continue;
      const ex = list[round];
      if (!seenIds.has(ex.id)) {
        seenIds.add(ex.id);
        selected.push(ex);
        addedInRound = true;
        if (selected.length >= cap) break;
      }
    }
    if (!addedInRound) break;
    round += 1;
  }

  return selected;
}

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
  const tag =
    ex.feedback === 'joint_pain'
      ? '!PAIN'
      : ex.feedback === 'too_easy'
        ? '+EZ'
        : ex.feedback === 'at_limit'
          ? '!LIM'
          : '';
  return `${ex.exerciseId || ex.name}:${workSets.length}s@${best.weightKg}x${best.reps}${bestE1 > 0 ? `(1RM:${Math.round(bestE1)})` : ''}${tag}`;
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

  // 1. Morpho-posture
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

  const morphCompact = [
    morph.morphotype || 'std',
    `fem=${morph.femurTorsoRatio || 'bal'}`,
    `env=${morph.armSpanRatio || 'bal'}`,
    `clav=${morph.claviclePelvisRatio || 'bal'}`,
    Array.isArray(morph.postureFlags) && morph.postureFlags.length ? `post=${morph.postureFlags.join(',')}` : null,
  ]
    .filter(Boolean)
    .join(';');

  // 2. Biométrie 30j (5 dernières pesées dans le prompt compact)
  const nowMs = Date.now();
  const bio30 = (biometrics || []).filter((b) => {
    const ts = b.timestamp || Date.parse(`${b.date}T12:00:00Z`) || 0;
    return nowMs - ts <= 31 * DAY_MS;
  });
  const bioRecent5 = bio30.slice(-5);
  const bioTrendCompact =
    bioRecent5.length > 0
      ? bioRecent5
          .map((b) => `${b.date.slice(5)}:${b.weightKg ?? '-'}kg${b.bodyFatPct ? `/${b.bodyFatPct}%` : ''}`)
          .join(',')
      : 'aucune';

  const latestBf = latestBio?.bodyFatPct ?? latestBio?.navyBodyFatPct ?? null;
  const latestWhtr = latestBio?.whtr ?? null;

  // 3. Nutrition jour + moyenne 7j
  const todayMealsCompact =
    (nutritionToday || []).length > 0
      ? nutritionToday
          .slice(0, 5)
          .map((m) => `${String(m.label || '').slice(0, 28)}(${m.kcal}k/P${m.proteinG}/G${m.carbsG}/L${m.fatG})`)
          .join('|')
      : 'aucun';

  const p7 = intel.nutritionTiming.period7d;
  const p14 = intel.nutritionTiming.period14d;
  const adherenceCompact =
    p7.daysLogged > 0
      ? `${p7.daysLogged}j:avg=${p7.avgKcal}kcal(P${p7.avgProteinG}/G${p7.avgCarbsG}/L${p7.avgFatG}),adh=${p7.adherencePct}%`
      : 'insuffisant';
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

  // 4. Programme actif (compact avec dayIndex, [eIdx], exerciseId, sets×reps@load)
  const programLines = (program?.days || [])
    .map((day, dIdx) => {
      const exList = (day.exercises || [])
        .map(
          (ex, eIdx) =>
            `${eIdx}:${ex.exerciseId}:${ex.name}(${ex.sets}x${ex.repRange?.[0] || ex.repMin || 8}-${ex.repRange?.[1] || ex.repMax || 12}@${ex.suggestedLoadKg}kg,RIR${ex.targetRir})`
        )
        .join('|');
      return `J${dIdx}[${day.name}]:${exList}`;
    })
    .join('\n');

  // Catalogue compact filtré selon matériel + blessures (strictement <= 45 exercices, id:Nom sur 1 seule ligne)
  const compactCatalog = selectCompactCoachExercises(profile, program, MAX_COMPACT_CATALOG_EXERCISES);
  const exerciseCatalogLine = compactCatalog.map((e) => `${e.id}:${e.name}`).join('|');

  // 5. 5 dernières séances réelles (au lieu de 10)
  const last5Workouts = [...(workouts || [])]
    .sort((a, b) => (b.endedAt || Date.parse(b.date) || 0) - (a.endedAt || Date.parse(a.date) || 0))
    .slice(0, 5);

  const workoutHistoryLines =
    last5Workouts.length > 0
      ? last5Workouts
          .map((w) => {
            const rd = w.readiness?.score ? `Rd${w.readiness.score}` : 'Rd-';
            const exSummaries = (w.exercises || []).map(formatExerciseTopSet).filter(Boolean).slice(0, 4);
            return `${String(w.date || '').slice(5)}[${String(w.dayName || '').slice(0, 22)}](${rd}):${exSummaries.join(';') || 'ok'}`;
          })
          .join('\n')
      : 'aucune';

  // 6. Pro Intelligence compact
  const volumeCompact = Object.values(intel.volumeByMuscle)
    .filter((v) => v.sets > 0)
    .sort((a, b) => b.sets - a.sets)
    .slice(0, 6)
    .map((v) => `${v.label}:${v.sets}s(${v.mev}-${v.mrv}${v.zone === 'OVER_MRV' ? '!' : ''})`)
    .join('|');

  const jointAlertLine =
    intel.jointVigilance.recurringAlerts.length > 0
      ? intel.jointVigilance.recurringAlerts.map((a) => `${a.label}(${a.count}x)`).join(',')
      : '0';

  const stagLine =
    intel.stagnatingExercises.length > 0
      ? intel.stagnatingExercises.slice(0, 4).map((s) => `${s.name}(${s.sessionsFlat}s@${s.latestE1rm}kg)`).join(',')
      : '0';

  // 7. Labo Physique compact
  const lagLabels = (profile?.lagPriorities || []).map((g) => MUSCLE_GROUPS[g]?.label || g);
  const domLabels = (profile?.dominantGroups || []).map((g) => MUSCLE_GROUPS[g]?.label || g);
  const laboCompact = `bf=${lastPhysiqueAnalysis?.estimated_body_fat_pct ?? latestBf ?? '-'}%;LAG=[${(profile?.lagPriorities || []).join(',') || '-'}];DOM=[${(profile?.dominantGroups || []).join(',') || '-'}]`;
  const laboLine = lastPhysiqueAnalysis
    ? `Dernier scan Labo (${lastPhysiqueAnalysis.meta?.provider || 'local'}): %MG est. ${lastPhysiqueAnalysis.estimated_body_fat_pct ?? '--'}%, LAG [${lagLabels.join(', ') || 'aucun'}], DOMINANT [${domLabels.join(', ') || 'aucun'}]`
    : `LAG [${lagLabels.join(', ') || 'aucun'}] · DOMINANT [${domLabels.join(', ') || 'aucun'}]`;

  // 8. Mémoire Coach (10 derniers repères)
  const memoryRecent = memoryItems.slice(-10);
  const memoryLines =
    memoryRecent.length > 0 ? memoryRecent.map((m) => `[${m.id}]${String(m.text || '').slice(0, 90)}`).join('|') : '0';

  const wInfo = intel.nutritionTiming.weather;
  const weatherLine = wInfo
    ? `${wInfo.city || 'Local'} ${wInfo.tempC}°C (${wInfo.humidityPct}% HR, bonus eau +${intel.nutritionTiming.heatHydrationBonusMl} ml${intel.nutritionTiming.electrolytesRecommended ? ', électrolytes' : ''})`
    : 'non configurée';
  const weatherCompact = wInfo
    ? `${wInfo.tempC}C/+${intel.nutritionTiming.heatHydrationBonusMl}ml`
    : '-';
  const novaLine =
    intel.nutritionTiming.todayNova4Count > 0 || intel.nutritionTiming.avgNovaGroup7d
      ? `NOVA 4 aujourd'hui : ${intel.nutritionTiming.todayNova4Count}${intel.nutritionTiming.avgNovaGroup7d ? ` · Moy. 7j : ${intel.nutritionTiming.avgNovaGroup7d}` : ''}`
      : 'aucun produit NOVA 4';

  const injuriesCompact = (profile?.injuries || []).map((i) => `${i.zone}:s${i.severity}`).join(',') || '0';
  const equipCompact = (profile?.equipment || []).join(',') || 'bodyweight';
  const allergiesCompact = (profile?.nutritionPrefs?.allergies || []).join(',') || '0';

  const promptText = `=== DOSSIER ATHLETE (COMPACT) ===
PROF:nom=${profile?.name || 'Athlète'}|sex=${profile?.sex || 'male'}|age=${profile?.age || 28}|cm=${profile?.heightCm || 176}|kg=${profile?.weightKg || 75}|lbm=${macros.leanMassKg}|obj=${profile?.goal || 'recomp'}|niv=${profile?.level || 'intermediate'}|neat=${profile?.lifestyle?.neatLevel || 'mixed'}
MORPHO:${morphCompact}|MAT:${equipCompact}|BLESS:${injuriesCompact}|REG:${profile?.nutritionPrefs?.dietType || 'omnivore'}|ALLERG:${allergiesCompact}|REPAS_J:${profile?.nutritionPrefs?.mealsPerDay || 3}
BIO:ewma=${ewma?.latestEwmaKg ?? profile?.weightKg}kg|brut=${ewma?.latestRawKg ?? profile?.weightKg}kg|vel=${ewma?.weeklyDeltaKg ?? 0}kg/sem|bf=${latestBf ?? '-'}%|whtr=${latestWhtr ?? '-'}|bmr=${macros.bmrKcal}|tdee=${adaptive.estimatedTdeeKcal}|adj=${adaptiveAdj}|PESEES5:${bioTrendCompact}
NUT_CIBLE:${macros.kcal}kcal(P${macros.proteinG}/G${macros.carbsG}/L${macros.fatG}/F${macros.fiberG})|eau=${intel.nutritionTiming.recommendedWaterTodayMl}ml[${intel.nutritionTiming.dayType}]|mode=${macros.isOverride ? `OVERRIDE(${macros.overrideSource}${macros.overrideLocked ? ',LOCK' : ''})` : 'AUTO'}|min=${macros.safeFloorKcal}
NUT_JOUR:${consumed.kcal}kcal(P${consumed.proteinG}/G${consumed.carbsG}/L${consumed.fatG}/F${intel.nutritionTiming.todayFiberG})|eau=${hydration?.totalMl || 0}ml|leu=${intel.nutritionTiming.todayLeucineMeals}/${intel.nutritionTiming.targetLeucineMeals}|nova4=${intel.nutritionTiming.todayNova4Count}|meteo=${weatherCompact}
REPAS_JOUR:${todayMealsCompact}
NUT_7J:${adherenceCompact}
INTEL:rec=${intel.recoveryScore}/100(${intel.cnsStatus})|sets7j=${intel.totalEffectiveSets7d}|e1rm=${intel.avgStrengthTrendPct >= 0 ? '+' : ''}${intel.avgStrengthTrendPct}%|stag=${stagLine}|alert=${jointAlertLine}|vol7j=${volumeCompact || '-'}
LABO:${laboCompact}
PROG_META:split=${program?.splitType || 'auto'}(${trainingSummary.activeSplitLabel})|meth=${program?.progressionMethod || 'double_progression'}|phase=${program?.phase || 'calibration'}(S${program?.weekNumber || 1})|freq=${profile?.sessionsPerWeek || 4}j|dur=${profile?.sessionDurationMin || 60}m${activeSession ? `|live=${activeSession.dayName}` : ''}
PROG_EX(dayIndex:exIdx:id:Nom):
${programLines || 'aucun'}
CAT_EX(${compactCatalog.length},id:Nom):${exerciseCatalogLine}
HIST5:
${workoutHistoryLines}
MEM(${memoryRecent.length}):${memoryLines}`;

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
      title: `Programme, Catalogue Filtré (${compactCatalog.length} ex.) & ${last5Workouts.length} dernières séances`,
      items: [
        `${trainingSummary.activeSplitLabel} · ${trainingSummary.activeMethodLabel} · Phase ${program?.phase || 'calibration'}`,
        `Catalogue injecté : ${compactCatalog.length} exercices filtrés (matériel + blessures) · ~${Math.ceil(promptText.length / 4)} tokens`,
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
    compactCatalog,
    stats: {
      workoutsCount: last5Workouts.length,
      bioCount30d: bio30.length,
      biometricsCount: bio30.length,
      memoryCount: memoryItems.length,
      recoveryScore: intel.recoveryScore,
      catalogCount: compactCatalog.length,
      estimatedTokens: Math.ceil(promptText.length / 4),
    },
  };
}
