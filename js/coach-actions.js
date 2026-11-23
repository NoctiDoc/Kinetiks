/**
 * Kinetix Lab — Moteur d'Actions Agentiques du Coach IA (js/coach-actions.js)
 *
 * Donne au Coach IA un véritable contrôle lecture + écriture réelle en base IndexedDB
 * (Nutrition, EWMA, Repas, Profil, Programme, Swap d'exercices, Mémoire du Coach)
 * compatible avec TOUS les fournisseurs du routeur IA (Gemini, Ollama, Groq, OpenRouter, Puter.js)
 * ainsi qu'un parseur déterministe Niveau 0 (100 % hors-ligne, sans clé API).
 *
 * Protocole universel structuré :
 *   <<<KINETIX_ACTIONS>>>
 *   [{"type": "...", "payload": {...}}]
 *   <<<END_ACTIONS>>>
 */

import { generateId, getTodayISO } from './db.js';
import { repairAndParseJSON, normalizeMealVisionPayload } from './ai-router.js';
import { EXERCISES_DB, MUSCLE_GROUPS, getExerciseById } from './exercises-db.js';
import {
  TRAINING_SPLITS,
  TRAINING_METHODS,
  GOAL_PROFILES,
  generateProgram,
  applyPreservationMode,
  findBiomechanicalSwaps,
  buildSetScheme,
  calculateWeeklyVolume,
  buildCoachRuntimeContext,
  roundToIncrement,
} from './biomechanics-engine.js';
import {
  computeCoherentMacrosForCalories,
  getProfileAdaptiveAdjustmentKcal,
} from './nutrition-db.js';

export const ACTIONS_START_MARKER = '<<<KINETIX_ACTIONS>>>';
export const ACTIONS_END_MARKER = '<<<END_ACTIONS>>>';

const SPLIT_ALIASES = Object.freeze({
  auto: 'auto',
  full_body: 'full_body',
  fullbody: 'full_body',
  'full-body': 'full_body',
  upper_lower: 'upper_lower',
  upperlower: 'upper_lower',
  'upper-lower': 'upper_lower',
  ul: 'upper_lower',
  ppl: 'ppl',
  push_pull_legs: 'ppl',
  hybrid: 'hybrid_ul_ppl',
  hybrid_ul_ppl: 'hybrid_ul_ppl',
  hybride: 'hybrid_ul_ppl',
  arnold: 'arnold',
  arnold_split: 'arnold',
  bro_split: 'bro_split',
  bro: 'bro_split',
  split: 'bro_split',
  split_classique: 'bro_split',
});

const METHOD_ALIASES = Object.freeze({
  double_progression: 'double_progression',
  straight_sets: 'double_progression',
  standard: 'double_progression',
  reverse_pyramid: 'reverse_pyramid',
  rpt: 'reverse_pyramid',
  pyramidal_inverse: 'reverse_pyramid',
  top_set_backoff: 'top_set_backoff',
  top_set: 'top_set_backoff',
  classic_pyramid: 'classic_pyramid',
  pyramidal_montant: 'classic_pyramid',
  rest_pause: 'rest_pause',
  myo_reps: 'rest_pause',
  dup: 'dup',
  ondulatoire: 'dup',
});

const GOAL_ALIASES = Object.freeze({
  recomp: 'recomp',
  recomposition: 'recomp',
  fat_loss: 'fat_loss',
  seche: 'fat_loss',
  perte_gras: 'fat_loss',
  cut: 'fat_loss',
  lean_bulk: 'lean_bulk',
  prise_masse: 'lean_bulk',
  bulk: 'lean_bulk',
  hypertrophy: 'hypertrophy',
  hypertrophie: 'hypertrophy',
  strength: 'strength',
  force: 'strength',
  health_posture: 'health_posture',
  sante: 'health_posture',
});

const ACTIVITY_ALIASES = Object.freeze({
  sedentary: 'sedentary',
  sedentaire: 'sedentary',
  low: 'sedentary',
  mixed: 'mixed',
  moderate: 'mixed',
  modere: 'mixed',
  active: 'active',
  actif: 'active',
  high: 'active',
});

const DIET_ALIASES = Object.freeze({
  omnivore: 'omnivore',
  standard: 'omnivore',
  vegetarian: 'vegetarian',
  vegetarien: 'vegetarian',
  vegan: 'vegan',
  vegetalien: 'vegan',
  pescatarian: 'pescatarian',
  pescetarien: 'pescatarian',
  halal: 'halal',
  gluten_free: 'gluten_free',
  sans_gluten: 'gluten_free',
});

const PAIN_ZONE_ALIASES = Object.freeze({
  shoulder: 'shoulder',
  epaule: 'shoulder',
  epaules: 'shoulder',
  lumbar: 'lumbar',
  lombaire: 'lumbar',
  lombaires: 'lumbar',
  dos: 'lumbar',
  knee: 'knee',
  genou: 'knee',
  genoux: 'knee',
  elbow: 'elbow',
  coude: 'elbow',
  coudes: 'elbow',
  wrist: 'wrist',
  poignet: 'wrist',
  poignets: 'wrist',
  neck: 'neck',
  nuque: 'neck',
  cervical: 'neck',
});

const PAIN_ZONE_LABELS = Object.freeze({
  shoulder: 'Épaule',
  lumbar: 'Lombaires',
  knee: 'Genou',
  elbow: 'Coude',
  wrist: 'Poignet',
  neck: 'Cervicales',
});

const PAIN_CONTRAINDICATION_MAP = Object.freeze({
  lumbar: ['lumbar_shear', 'lumbar_flexion'],
  shoulder: ['shoulder_impingement', 'anterior_shoulder'],
  knee: ['knee_shear'],
  wrist: ['wrist_extension'],
  elbow: ['elbow_tendon'],
  neck: ['cervical_load'],
});

function normalizeKey(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function normalizeSearch(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/* ==========================================================================
   1. SYSTEM PROMPT AGENTIQUE (ÉTAT COMPLET + CATALOGUE D'ACTIONS + ANTI-BLUFF)
   ========================================================================== */

export function buildAgenticCoachSystemPrompt({
  profile,
  program,
  telemetry,
  workouts = [],
  nutritionToday = [],
  hydration = { totalMl: 0 },
  activeSession = null,
}) {
  const { ewma, adaptive, macros, consumed } = telemetry;
  const trainingSummary = buildCoachRuntimeContext(profile, program, workouts);
  const adaptiveAdj = getProfileAdaptiveAdjustmentKcal(profile);
  const memoryItems = Array.isArray(profile?.coachMemory) ? profile.coachMemory : [];

  // Résumé compact des séances du programme actif avec exerciseId réels
  const programLines = (program?.days || [])
    .map((day, dIdx) => {
      const exList = (day.exercises || [])
        .map(
          (ex) =>
            `${ex.exerciseId} ("${ex.name}", ${ex.sets}×${ex.repRange?.[0] || 8}-${ex.repRange?.[1] || 12} @ ${ex.suggestedLoadKg}kg, RIR ${ex.targetRir})`
        )
        .join(' ; ');
      return `  - Jour ${dIdx + 1} [${day.name}] : ${exList}`;
    })
    .join('\n');

  // Repas logués aujourd'hui
  const todayMealsLine =
    (nutritionToday || []).length > 0
      ? nutritionToday
          .slice(0, 8)
          .map((m) => `${m.label} (${m.kcal} kcal, P ${m.proteinG}g/G ${m.carbsG}g/L ${m.fatG}g)`)
          .join(' | ')
      : 'aucun repas logué';

  // Mémoire du Coach avec IDs pour permettre REMOVE_COACH_MEMORY
  const memoryLines =
    memoryItems.length > 0
      ? memoryItems.map((m) => `[${m.id}] ${m.text}`).join(' | ')
      : 'aucun repère mémorisé';

  // Catalogue compact des IDs valides d'exercices pour SWAP_EXERCISE
  const validExerciseIdsLine = EXERCISES_DB.map((e) => `${e.id}:${e.name}`).join(' | ');

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

  return `Tu es le Coach IA Biomécanique & Nutritionnel de Kinetix Lab. Tu réponds en français concis, structuré (puces courtes, chiffres précis, zéro blabla).
Tu as un VÉRITABLE contrôle lecture + écriture sur la base de données locale de l'application via un bloc d'actions JSON.

=== RÈGLE CRITIQUE ANTI-BLUFF ===
Tu n'as JAMAIS le droit d'affirmer avoir modifié la nutrition, le programme, un exercice, le profil, un repas ou ta mémoire SANS émettre le bloc d'actions JSON correspondant à la toute fin de ta réponse.
Si l'utilisateur demande une modification (ou te donne une information durable à retenir comme une douleur, un objectif, une préférence), ou t'envoie une photo contenant des données exploitables, tu DOIS inclure le bloc JSON exact ci-dessous. Si tu réponds à une simple question informative sans rien modifier, n'émets aucun bloc JSON.

=== ÉTAT TEMPS RÉEL DE L'ATHLÈTE ===
- Profil : ${profile?.name || 'Athlète'}, ${profile?.sex || 'male'}, ${profile?.age || 28} ans, ${profile?.heightCm || 176} cm, ${profile?.weightKg || 75} kg (Masse maigre est. ${macros.leanMassKg} kg)
- Morpho & Posture : ${morphSummary}
- Objectif : ${profile?.goal || 'recomp'} · Niveau : ${profile?.level || 'intermediate'} · Activité NEAT : ${profile?.lifestyle?.neatLevel || 'mixed'}
- Régime : ${profile?.nutritionPrefs?.dietType || 'omnivore'} · Allergies : ${(profile?.nutritionPrefs?.allergies || []).join(', ') || 'aucune'} · Repas/j : ${profile?.nutritionPrefs?.mealsPerDay || 3}
- Matériel : ${(profile?.equipment || []).join(', ') || 'bodyweight'}
- Blessures/Sensibilités : ${(profile?.injuries || []).map((i) => `${i.zone}(sev ${i.severity})`).join(', ') || 'aucune'}
- Priorités [LAG] : ${(profile?.lagPriorities || []).join(', ') || 'aucune'}
- EWMA : ${ewma?.latestEwmaKg ?? profile?.weightKg} kg · Tendance : ${ewma?.weeklyDeltaKg ?? 0} kg/sem · Ajustement adaptatif actif : ${adaptiveAdj} kcal (borné [-400, +400])
- Nutrition Cible : ${macros.kcal} kcal (P ${macros.proteinG}g · G ${macros.carbsG}g · L ${macros.fatG}g · Eau ${macros.waterTargetMl} ml) · Mode : ${macros.isOverride ? `SURCHARGE (${macros.overrideSource}${macros.overrideLocked ? ', VERROUILLÉE' : ''})` : 'AUTO'} · TDEE : ${adaptive.estimatedTdeeKcal} kcal · Plancher sûr : ${macros.safeFloorKcal} kcal
- Nutrition Aujourd'hui : ${consumed.kcal} kcal (P ${consumed.proteinG}g · G ${consumed.carbsG}g · L ${consumed.fatG}g) · Eau : ${hydration?.totalMl || 0} ml
- Repas du jour : ${todayMealsLine}
- Programme actif : ${trainingSummary.activeSplitLabel} (${program?.splitType || 'auto'}) · Méthode : ${trainingSummary.activeMethodLabel} (${program?.progressionMethod || 'double_progression'}) · Phase : ${program?.phase || 'calibration'} (Sem. ${program?.weekNumber || 1}) · ${profile?.sessionsPerWeek || 4} j/sem · ${profile?.sessionDurationMin || 60} min${activeSession ? ` · Séance en cours : ${activeSession.dayName}` : ''}
- Exercices du programme actif :
${programLines || '  (aucun)'}
- Retours séances récentes (${trainingSummary.recentWorkoutsCount} séances, Readiness moyen ${trainingSummary.readinessAvg ?? 'N/A'}/100) : Douleurs [${trainingSummary.painExercises.join(', ') || 'aucune'}] · Limites [${trainingSummary.limitExercises.join(', ') || 'aucun'}] · Faciles [${trainingSummary.easyExercises.join(', ') || 'aucun'}]
- Mémoire du Coach (${memoryItems.length} repères) : ${memoryLines}

=== PROTOCOLE VISION MULTIMODALE (SI PHOTO JOINTE) ===
Lorsque l'utilisateur t'envoie une photo, identifie automatiquement sa catégorie et émets les actions structurées correspondantes (qui seront présentées en carte de confirmation sélective avant écriture) :
- Cas A (Capture balance / impédancemètre / Apple Santé) : extrais poids, %MG, masse musculaire, muscle squelettique, graisse viscérale, % eau, BMR -> émets LOG_BIOMETRICS + UPDATE_PROFILE (weight, bodyFat, bmrKcal).
- Cas B (Photo physique / posture) : analyse morphotype, proportions segmentaires (femurTorsoRatio, armSpanRatio, claviclePelvisRatio, ribcageType), signes posturaux visibles (anterior_pelvic_tilt, kyphosis, forward_head, protracted_shoulders), %MG visuel et groupes [LAG]/[DOMINANT] -> émets UPDATE_PROFILE (morphology, bodyFat, lagPriorities, dominantGroups, injuries) + éventuellement APPLY_PHYSIQUE_ASSESSMENT.
- Cas C (Photo de plat OU étiquette nutritionnelle) :
  * Plat : décompose chaque ingrédient (name, state, grams, kcal, protein, carbs, fat, fiber) et émets LOG_MEAL avec "ingredients".
  * Tableau nutritionnel / emballage : extrais nom, marque et valeurs POUR 100 g -> émets SAVE_CUSTOM_FOOD.
- Cas D (Photo d'équipement / machine / zone sensible) : propose UPDATE_PROFILE (addEquipment ou injuries), SWAP_EXERCISE et/ou SAVE_COACH_MEMORY.

=== FORMAT STRICT DES ACTIONS EXÉCUTABLES ===
Quand tu modifies l'application ou proposes des mises à jour depuis une photo, termine TOUJOURS ta réponse par ce bloc EXACT (JSON valide, tableau d'objets) :
${ACTIONS_START_MARKER}
[{"type": "NOM_ACTION", "payload": {...}}]
${ACTIONS_END_MARKER}

Catalogue des actions supportées :
1. SET_NUTRITION_TARGETS : {"kcal": 2450, "protein": 185, "carbs": 245, "fat": 78, "hydrationMl": 3000, "resetAdaptiveAdjustment": true, "lockOverride": true}
2. RESET_NUTRITION_AUTO : {}
3. RESET_EWMA_BASELINE : {"weightKg": 82.0}
4. LOG_MEAL : {"label": "Poulet riz brocolis", "kcal": 620, "protein": 48, "carbs": 72, "fat": 14, "fiber": 6, "mealSlot": "Déjeuner", "confidence": "high|medium|low", "hiddenFatsWarning": false, "ingredients": [{"name": "Poulet grillé", "state": "cuit", "grams": 160, "kcal": 264, "protein": 49.6, "carbs": 0, "fat": 5.8, "fiber": 0}]}
5. DELETE_LAST_MEAL : {}
6. LOG_BIOMETRICS : {"weightKg": 78.4, "bodyFatPct": 16.2, "muscleMassKg": 62.1, "skeletalMuscleKg": 36.4, "visceralFat": 6, "hydrationPct": 58.2, "bmrKcal": 1810, "waistCm": 82}
7. SAVE_CUSTOM_FOOD : {"name": "Skyr nature", "brand": "Yoplait", "kcal": 62, "protein": 9.8, "carbs": 4.0, "fat": 0.2, "fiber": 0, "portionLabel": "1 pot", "portionGrams": 150}
8. UPDATE_PROFILE : {"goal": "fat_loss|recomp|lean_bulk|hypertrophy|strength|health_posture", "weight": 82, "bodyFat": 16, "waistCm": 82, "bmrKcal": 1810, "activityLevel": "sedentary|mixed|active", "sessionsPerWeek": 4, "sessionDuration": 60, "equipment": ["barbell","dumbbells","cables","machines","bench","pullup_bar"], "addEquipment": ["kettlebell"], "diet": "omnivore|vegetarian|vegan|pescatarian|halal|gluten_free", "allergies": ["dairy"], "injuries": [{"zone":"shoulder","severity":2}], "lagPriorities": ["delts_lat","pecs_upper"], "dominantGroups": ["quads"], "morphology": {"morphotype": "mesomorph", "femurTorsoRatio": "long_femur|balanced|short_femur", "armSpanRatio": "long_arms|balanced|short_arms", "claviclePelvisRatio": "broad_shoulders|balanced|narrow_shoulders", "ribcageType": "narrow|medium|wide", "postureFlags": ["anterior_pelvic_tilt","kyphosis","forward_head","protracted_shoulders"]}}
9. APPLY_PHYSIQUE_ASSESSMENT : {"lagPriorities": ["delts_lat","lats_width"], "dominantGroups": ["delts_ant"], "asymmetries": [{"zone": "Ceinture scapulaire", "description": "Épaule droite plus basse"}], "rebuildProgram": true}
10. MUTATE_PROGRAM : {"split": "full_body|upper_lower|ppl|hybrid|arnold|bro_split", "method": "double_progression|reverse_pyramid|top_set_backoff|classic_pyramid|rest_pause|dup", "sessionsPerWeek": 3, "sessionDurationMin": 45, "phase": "calibration|accumulation|intensification|deload", "preservationMode": true, "setsDelta": -1, "repsDelta": 2, "rirDelta": 1, "regenerate": true}
11. SWAP_EXERCISE : {"fromExerciseId": "id_existant", "toExerciseId": "id_valide_ci_dessous"} OU {"painZone": "shoulder|lumbar|knee|elbow|wrist|neck"}
12. SAVE_COACH_MEMORY : {"text": "Préfère les haltères au squat barre", "category": "preference|pain|nutrition|training|posture"}
13. REMOVE_COACH_MEMORY : {"id": "mem_xxx"} ou {"match": "texte à oublier"}

IDs d'exercices valides pour SWAP_EXERCISE :
${validExerciseIdsLine}`;
}

/* ==========================================================================
   2. PARSEUR UNIVERSEL DU BLOC <<<KINETIX_ACTIONS>>>...<<<END_ACTIONS>>>
   ========================================================================== */

export function parseCoachActionsResponse(rawText) {
  const text = String(rawText || '');
  const startIdx = text.indexOf(ACTIONS_START_MARKER);
  if (startIdx === -1) {
    return { cleanText: text.trim(), actions: [], parseError: null };
  }

  const afterStart = text.slice(startIdx + ACTIONS_START_MARKER.length);
  const endIdx = afterStart.indexOf(ACTIONS_END_MARKER);

  let jsonSegment = '';
  let trailingText = '';
  if (endIdx !== -1) {
    jsonSegment = afterStart.slice(0, endIdx).trim();
    trailingText = afterStart.slice(endIdx + ACTIONS_END_MARKER.length).trim();
  } else {
    jsonSegment = afterStart.trim();
  }

  // Nettoie les éventuels ```json ... ``` à l'intérieur des marqueurs
  jsonSegment = jsonSegment
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const beforeStart = text.slice(0, startIdx).trim();
  const cleanText = [beforeStart, trailingText].filter(Boolean).join('\n\n').trim();

  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(jsonSegment);
  } catch {
    const repaired = repairAndParseJSON(jsonSegment);
    if (repaired.ok) {
      parsed = repaired.data;
    } else {
      parseError = repaired.error || 'JSON d’actions invalide';
    }
  }

  let actions = [];
  if (Array.isArray(parsed)) {
    actions = parsed;
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.actions)) actions = parsed.actions;
    else if (parsed.type) actions = [parsed];
  }

  const validActions = actions
    .filter((a) => a && typeof a === 'object' && typeof a.type === 'string')
    .map((a) => ({
      type: a.type.trim().toUpperCase(),
      payload: a.payload && typeof a.payload === 'object' ? a.payload : {},
    }));

  return {
    cleanText,
    actions: validActions,
    parseError,
  };
}

/* ==========================================================================
   3. PARSEUR DÉTERMINISTE NIVEAU 0 (COMMANDES DIRECTES 100 % HORS-LIGNE)
   ========================================================================== */

export function parseTier0DeterministicActions(userText, { profile = null } = {}) {
  const raw = String(userText || '').trim();
  if (!raw) return [];
  const norm = normalizeSearch(raw);
  const actions = [];

  // 1) Reset EWMA baseline
  if (/(reset|reinitialise|repart|remettre a zero|remise a zero|purge).*(ewma|pesee|poids|derive)/.test(norm)) {
    const wMatch = norm.match(/(\d{2,3}(?:[.,]\d)?)\s*kg/);
    actions.push({
      type: 'RESET_EWMA_BASELINE',
      payload: wMatch ? { weightKg: Number(wMatch[1].replace(',', '.')) } : {},
    });
  }

  // 2) Reset Nutrition Auto
  if (
    /(reset|reinitialise|remets?|revenir|repasse).*(nutrition|cibles?|calories?|auto|ewma|ajustement)/.test(norm) &&
    !/(ewma\s+poids|pesee)/.test(norm) &&
    !/\b\d{4}\s*kcal/.test(norm)
  ) {
    actions.push({ type: 'RESET_NUTRITION_AUTO', payload: {} });
  }

  // 3) Fixer cibles nutrition ("passe à 2500 kcal", "2450 kcal P 185 G 245 L 78")
  const kcalMatch =
    norm.match(/(?:passe|mets|fixe|regle|cible|objectif|monte|descends|baisse|ajuste|calories?|kcal)[^0-9]{0,20}(\d{4})\s*(?:kcal|cal)?/) ||
    norm.match(/\b(\d{4})\s*(?:kcal|calories?)\b/);
  if (kcalMatch && !/(ajoute|log|mange|repas|dejeuner|diner|petit)/.test(norm)) {
    const kcal = Number(kcalMatch[1]);
    if (kcal >= 1200 && kcal <= 6000) {
      const pMatch = norm.match(/\b(?:p|prot(?:eines?)?)\s*[:=]?\s*(\d{2,3})\s*g?\b/);
      const cMatch = norm.match(/\b(?:g|gluc(?:ides?)?|carbs?)\s*[:=]?\s*(\d{2,3})\s*g?\b/);
      const fMatch = norm.match(/\b(?:l|lip(?:ides?)?|fat)\s*[:=]?\s*(\d{2,3})\s*g?\b/);
      const wMatch = norm.match(/\b(?:eau|hydrat(?:ation)?)\s*[:=]?\s*(\d{4})\s*ml\b/);
      actions.push({
        type: 'SET_NUTRITION_TARGETS',
        payload: {
          kcal,
          ...(pMatch ? { protein: Number(pMatch[1]) } : {}),
          ...(cMatch ? { carbs: Number(cMatch[1]) } : {}),
          ...(fMatch ? { fat: Number(fMatch[1]) } : {}),
          ...(wMatch ? { hydrationMl: Number(wMatch[1]) } : {}),
          resetAdaptiveAdjustment: true,
          lockOverride: true,
        },
      });
    }
  }

  // 4) Supprimer dernier repas
  if (/(supprime|efface|annule|retire).*(dernier\s+repas|repas\s+precedent)/.test(norm)) {
    actions.push({ type: 'DELETE_LAST_MEAL', payload: {} });
  }

  // 5) Ajouter un repas simple ("ajoute un repas poulet riz 650 kcal P 45 G 70 L 15")
  if (/(ajoute|log|enregistre|note).*(repas|collation|dejeuner|diner|petit.?dejeuner|shaker)/.test(norm)) {
    const mealKcal = norm.match(/\b(\d{2,4})\s*(?:kcal|cal)\b/);
    if (mealKcal) {
      const pM = norm.match(/\b(?:p|prot(?:eines?)?)\s*[:=]?\s*(\d{1,3})\s*g?\b/);
      const cM = norm.match(/\b(?:g|gluc(?:ides?)?)\s*[:=]?\s*(\d{1,3})\s*g?\b/);
      const fM = norm.match(/\b(?:l|lip(?:ides?)?)\s*[:=]?\s*(\d{1,3})\s*g?\b/);
      actions.push({
        type: 'LOG_MEAL',
        payload: {
          label: raw.replace(/(ajoute|log|enregistre|note)\s+(un|une|le|la|mon)?\s*/i, '').slice(0, 60),
          kcal: Number(mealKcal[1]),
          protein: pM ? Number(pM[1]) : 0,
          carbs: cM ? Number(cM[1]) : 0,
          fat: fM ? Number(fM[1]) : 0,
        },
      });
    }
  }

  // 6) Mutations programme (split, méthode, fréquence, durée, deload, préservation)
  const progPayload = {};
  if (/full\s*body/.test(norm)) progPayload.split = 'full_body';
  else if (/upper\s*\/?\s*lower|haut\s*\/?\s*bas/.test(norm)) progPayload.split = 'upper_lower';
  else if (/hybride/.test(norm)) progPayload.split = 'hybrid_ul_ppl';
  else if (/\bppl\b|push\s*\/?\s*pull/.test(norm)) progPayload.split = 'ppl';
  else if (/arnold/.test(norm)) progPayload.split = 'arnold';
  else if (/bro\s*split|split\s*classique/.test(norm)) progPayload.split = 'bro_split';

  if (/pyramidal\s*invers|\brpt\b|reverse\s*pyramid/.test(norm)) progPayload.method = 'reverse_pyramid';
  else if (/top\s*set|back[\s-]*off/.test(norm)) progPayload.method = 'top_set_backoff';
  else if (/pyramidal\s*(montant|classique)/.test(norm)) progPayload.method = 'classic_pyramid';
  else if (/rest[\s-]*pause|myo[\s-]*rep/.test(norm)) progPayload.method = 'rest_pause';
  else if (/\bdup\b|ondulatoire/.test(norm)) progPayload.method = 'dup';
  else if (/double\s*progression|straight\s*sets?|series?\s*fixes?/.test(norm)) progPayload.method = 'double_progression';

  const daysMatch = norm.match(/\b([2-6])\s*(?:jours?|j\b|seances?)/);
  if (daysMatch && (progPayload.split || /(passe|change|mets|programme|seances?)/.test(norm))) {
    progPayload.sessionsPerWeek = Number(daysMatch[1]);
  }
  const durMatch = norm.match(/\b(35|40|45|50|60|75|90)\s*min/);
  if (durMatch) {
    progPayload.sessionDurationMin = Number(durMatch[1]);
  }
  if (/deload|decharge|semaine\s*legere/.test(norm)) {
    progPayload.phase = 'deload';
  }
  if (/mode\s*preservation|preservation/.test(norm)) {
    progPayload.preservationMode = true;
  }

  if (Object.keys(progPayload).length > 0) {
    actions.push({ type: 'MUTATE_PROGRAM', payload: progPayload });
  }

  // 7) Douleur -> protection articulaire + swap auto
  if (/douleur|mal\s+(a|au|aux)|gene|tendinite|pincement/.test(norm)) {
    let painZone = null;
    if (/epaule|coiffe|deltoide/.test(norm)) painZone = 'shoulder';
    else if (/lombaire|bas\s*du\s*dos|dos/.test(norm)) painZone = 'lumbar';
    else if (/genou|rotule/.test(norm)) painZone = 'knee';
    else if (/coude|epicondyl/.test(norm)) painZone = 'elbow';
    else if (/poignet/.test(norm)) painZone = 'wrist';
    else if (/nuque|cervical/.test(norm)) painZone = 'neck';

    if (painZone) {
      actions.push({ type: 'SWAP_EXERCISE', payload: { painZone } });
    }
  }

  // 8) Mémorisation explicite ("retiens que ...", "mémorise que ...")
  const memMatch = raw.match(/(?:retiens|mémorise|memorise|rappelle-toi|note\s+dans\s+ta\s+m[ée]moire)\s*(?:que|:)?\s*(.+)$/i);
  if (memMatch && memMatch[1]?.trim().length >= 4) {
    const existing = Array.isArray(profile?.coachMemory) ? profile.coachMemory : [];
    const text = memMatch[1].trim().slice(0, 160);
    if (!existing.some((m) => m.text.toLowerCase() === text.toLowerCase())) {
      actions.push({
        type: 'SAVE_COACH_MEMORY',
        payload: { text, category: 'preference' },
      });
    }
  }

  return actions;
}

/* ==========================================================================
   4. EXÉCUTEUR INDEXEDDB RÉEL AVEC SNAPSHOT & ANNULATION (UNDO 5S)
   ========================================================================== */

function findProgramExerciseSlot(program, { fromExerciseId = null, fromName = null, dayIndex = null } = {}) {
  const days = program?.days || [];
  const normId = fromExerciseId ? String(fromExerciseId).trim().toLowerCase() : '';
  const normName = fromName ? normalizeSearch(fromName) : '';
  const matches = [];

  days.forEach((day, dIdx) => {
    if (dayIndex !== null && dayIndex !== undefined && Number(dayIndex) !== dIdx) return;
    (day.exercises || []).forEach((slot, eIdx) => {
      const slotExId = String(slot.exerciseId || '').toLowerCase();
      const slotName = normalizeSearch(slot.name || '');
      if (
        (normId && slotExId === normId) ||
        (normName && (slotName.includes(normName) || normName.includes(slotName)))
      ) {
        matches.push({ dayIdx: dIdx, exIdx: eIdx, slot });
      }
    });
  });

  return matches;
}

function buildSwappedSlot(oldSlot, targetEx, profile, program) {
  const sourceEx = getExerciseById(oldSlot.exerciseId);
  const ratio = (targetEx.loadTransferFactor || 1) / (sourceEx?.loadTransferFactor || 1);
  const rawConverted = Number(oldSlot.suggestedLoadKg) > 0 ? Number(oldSlot.suggestedLoadKg) * ratio : 20;
  const convertedLoadKg =
    targetEx.loadMode === 'bodyweight_plus'
      ? 0
      : Math.max(targetEx.barWeightKg || targetEx.incrementKg || 2, roundToIncrement(rawConverted, targetEx.incrementKg));

  const methodId = program?.progressionMethod || profile?.progressionMethod || 'double_progression';
  const repRange = Array.isArray(oldSlot.repRange) && oldSlot.repRange.length === 2 ? oldSlot.repRange : [8, 12];
  const setsCount = Number(oldSlot.sets) || 3;

  return {
    ...oldSlot,
    exerciseId: targetEx.id,
    name: targetEx.name,
    category: targetEx.category,
    primaryMuscles: [...(targetEx.primaryMuscles || [])],
    loadMode: targetEx.loadMode,
    incrementKg: targetEx.incrementKg,
    suggestedLoadKg: convertedLoadKg,
    setScheme: buildSetScheme(methodId, setsCount, repRange, convertedLoadKg, targetEx, oldSlot.targetRir ?? 2),
  };
}

export async function executeCoachActions(actions = [], deps = {}) {
  const {
    profile: initialProfile,
    program: initialProgram,
    biometrics: initialBiometrics = [],
    nutritionToday: initialNutritionToday = [],
    todayISO = getTodayISO(),
    db,
  } = deps;

  if (!Array.isArray(actions) || actions.length === 0 || !initialProfile?.id || !db) {
    return {
      executedBadges: [],
      errors: [],
      changedModules: [],
      profile: initialProfile,
      program: initialProgram,
      undo: null,
    };
  }

  // Snapshot complet avant exécution pour Toast Annuler 5s
  const snapshot = {
    profile: structuredClone(initialProfile),
    program: initialProgram ? structuredClone(initialProgram) : null,
    biometrics: structuredClone(initialBiometrics),
    addedMealIds: [],
    deletedMeals: [],
    addedCustomFoodIds: [],
    biometricsModified: false,
    programModified: false,
    profileModified: false,
  };

  let curProfile = structuredClone(initialProfile);
  let curProgram = initialProgram ? structuredClone(initialProgram) : null;
  let curNutritionToday = structuredClone(initialNutritionToday);

  const executedBadges = [];
  const errors = [];
  const changedModules = new Set();

  for (const action of actions) {
    const type = String(action?.type || '').toUpperCase();
    const payload = action?.payload && typeof action.payload === 'object' ? action.payload : {};

    try {
      /* ---------------- 1. SET_NUTRITION_TARGETS ---------------- */
      if (type === 'SET_NUTRITION_TARGETS') {
        const rawKcal = Number(payload.kcal ?? payload.calories);
        const rawP = payload.protein ?? payload.proteinG ?? null;
        const rawC = payload.carbs ?? payload.carbsG ?? null;
        const rawF = payload.fat ?? payload.fatG ?? null;
        const rawWater = Number(payload.hydrationMl ?? payload.waterTargetMl ?? payload.water);

        // Si seules les macros sont données sans kcal, on calcule kcal
        let baseKcal = Number.isFinite(rawKcal) && rawKcal >= 1200 ? Math.round(rawKcal) : 0;
        if (!baseKcal && (Number(rawP) > 0 || Number(rawC) > 0 || Number(rawF) > 0)) {
          baseKcal = Math.round((Number(rawP) || 0) * 4 + (Number(rawC) || 0) * 4 + (Number(rawF) || 0) * 9);
        }
        if (baseKcal < 1200 || baseKcal > 6500) {
          errors.push('SET_NUTRITION_TARGETS ignoré : calories hors plage sûre (1200–6500 kcal).');
          continue;
        }

        const estLbm = Math.max(40, (Number(curProfile.weightKg) || 75) * (curProfile.sex === 'female' ? 0.76 : 0.83));
        const coherent = computeCoherentMacrosForCalories(baseKcal, {
          leanMassKg: estLbm,
          goal: curProfile.goal,
          proteinOverride: rawP !== null && rawP !== undefined ? Number(rawP) : null,
          fatOverride: rawF !== null && rawF !== undefined ? Number(rawF) : null,
          carbsOverride: rawC !== null && rawC !== undefined ? Number(rawC) : null,
        });

        const resetAdj = payload.resetAdaptiveAdjustment !== false;
        const lockOverride = payload.lockOverride !== false;
        const waterTargetMl =
          Number.isFinite(rawWater) && rawWater >= 1500 && rawWater <= 5500
            ? Math.round(rawWater / 50) * 50
            : curProfile.nutritionPrefs?.nutritionOverride?.waterTargetMl || null;

        const prefsPatch = {
          nutritionOverride: {
            enabled: true,
            locked: lockOverride,
            source: 'coach',
            kcal: coherent.kcal,
            proteinG: coherent.proteinG,
            carbsG: coherent.carbsG,
            fatG: coherent.fatG,
            waterTargetMl,
            updatedAt: Date.now(),
          },
          smoothingPlan: null,
        };
        if (resetAdj) {
          prefsPatch.adaptiveAdjustmentKcal = 0;
          prefsPatch.manualKcalOffset = 0;
        }

        curProfile = await db.updateProfile(curProfile.id, { nutritionPrefs: prefsPatch });
        snapshot.profileModified = true;
        changedModules.add('nutrition');
        executedBadges.push(
          `EXÉCUTÉ · Nutrition : ${coherent.kcal} kcal | P ${coherent.proteinG}g · G ${coherent.carbsG}g · L ${coherent.fatG}g${waterTargetMl ? ` · Eau ${waterTargetMl} ml` : ''}`
        );
        continue;
      }

      /* ---------------- 2. RESET_NUTRITION_AUTO ---------------- */
      if (type === 'RESET_NUTRITION_AUTO') {
        curProfile = await db.updateProfile(curProfile.id, {
          nutritionPrefs: {
            nutritionOverride: null,
            adaptiveAdjustmentKcal: 0,
            manualKcalOffset: 0,
            smoothingPlan: null,
          },
        });
        snapshot.profileModified = true;
        changedModules.add('nutrition');
        executedBadges.push('EXÉCUTÉ · Nutrition Auto réinitialisée (Ajust. 0 kcal)');
        continue;
      }

      /* ---------------- 3. RESET_EWMA_BASELINE ---------------- */
      if (type === 'RESET_EWMA_BASELINE') {
        const weight =
          Number(payload.weightKg ?? payload.weight) > 25
            ? Number(payload.weightKg ?? payload.weight)
            : Number(curProfile.weightKg) || 75;

        await db.resetBiometricsBaseline(curProfile.id, weight, todayISO);
        snapshot.biometricsModified = true;

        curProfile = await db.updateProfile(curProfile.id, {
          weightKg: Number(weight.toFixed(1)),
          nutritionPrefs: {
            ewmaBaselineDate: todayISO,
            adaptiveAdjustmentKcal: 0,
            manualKcalOffset: 0,
          },
        });
        snapshot.profileModified = true;
        changedModules.add('biometrics');
        changedModules.add('nutrition');
        executedBadges.push(`EXÉCUTÉ · EWMA réinitialisé (${weight.toFixed(1)} kg · ${todayISO})`);
        continue;
      }

      /* ---------------- 4. LOG_MEAL ---------------- */
      if (type === 'LOG_MEAL') {
        const label = String(payload.label || payload.dishName || payload.name || 'Repas Coach').trim().slice(0, 80);
        const kcal = Math.max(0, Math.round(Number(payload.kcal ?? payload.calories) || 0));
        const proteinG = Math.max(0, Math.round((Number(payload.protein ?? payload.proteinG) || 0) * 10) / 10);
        const carbsG = Math.max(0, Math.round((Number(payload.carbs ?? payload.carbsG) || 0) * 10) / 10);
        const fatG = Math.max(0, Math.round((Number(payload.fat ?? payload.fatG) || 0) * 10) / 10);
        const fiberG = Math.max(0, Math.round((Number(payload.fiber ?? payload.fiberG) || 0) * 10) / 10);
        const computedKcal = kcal || Math.round(proteinG * 4 + carbsG * 4 + fatG * 9);

        if (computedKcal <= 0 && proteinG <= 0) {
          errors.push('LOG_MEAL ignoré : valeurs nutritionnelles vides.');
          continue;
        }

        const ingredients = Array.isArray(payload.ingredients) ? payload.ingredients : null;
        const saved = await db.saveNutritionLog(curProfile.id, {
          date: todayISO,
          label,
          mealSlot: String(payload.mealSlot || 'Coach IA'),
          kcal: computedKcal,
          proteinG,
          carbsG,
          fatG,
          fiberG,
          ...(ingredients ? { ingredients } : {}),
          source: 'coach_ai',
        });
        snapshot.addedMealIds.push(saved.id);
        curNutritionToday = [saved, ...curNutritionToday];
        changedModules.add('nutrition');
        executedBadges.push(`EXÉCUTÉ · Repas ajouté : ${label} (${computedKcal} kcal)`);
        continue;
      }

      /* ---------------- 4b. LOG_BIOMETRICS ---------------- */
      if (type === 'LOG_BIOMETRICS') {
        const entry = {
          date: String(payload.date || todayISO),
          source: String(payload.source || 'coach_vision'),
        };
        const badgeParts = [];
        const w = Number(payload.weightKg ?? payload.weight ?? payload.weight_kg);
        if (Number.isFinite(w) && w >= 25 && w <= 250) {
          entry.weightKg = Number(w.toFixed(1));
          badgeParts.push(`${entry.weightKg} kg`);
        }
        const bf = Number(payload.bodyFatPct ?? payload.bodyFat ?? payload.body_fat_pct);
        if (Number.isFinite(bf) && bf >= 4 && bf <= 55) {
          entry.bodyFatPct = Number(bf.toFixed(1));
          badgeParts.push(`MG ${entry.bodyFatPct}%`);
        }
        const mm = Number(payload.muscleMassKg ?? payload.muscle_mass_kg);
        if (Number.isFinite(mm) && mm >= 15 && mm <= 150) {
          entry.muscleMassKg = Number(mm.toFixed(1));
          badgeParts.push(`Muscle ${entry.muscleMassKg} kg`);
        }
        const skm = Number(payload.skeletalMuscleKg ?? payload.skeletal_muscle_kg);
        if (Number.isFinite(skm) && skm >= 10 && skm <= 100) {
          entry.skeletalMuscleKg = Number(skm.toFixed(1));
          badgeParts.push(`Musc. sq. ${entry.skeletalMuscleKg} kg`);
        }
        const vf = Number(payload.visceralFat ?? payload.visceral_fat);
        if (Number.isFinite(vf) && vf >= 1 && vf <= 40) {
          entry.visceralFat = Number(vf.toFixed(1));
          badgeParts.push(`Visc. ${entry.visceralFat}`);
        }
        const hyd = Number(payload.hydrationPct ?? payload.hydration_pct ?? payload.waterPct);
        if (Number.isFinite(hyd) && hyd >= 30 && hyd <= 80) {
          entry.hydrationPct = Number(hyd.toFixed(1));
          badgeParts.push(`Eau ${entry.hydrationPct}%`);
        }
        const bmr = Number(payload.bmrKcal ?? payload.bmr_kcal ?? payload.bmr);
        if (Number.isFinite(bmr) && bmr >= 900 && bmr <= 4500) {
          entry.bmrKcal = Math.round(bmr);
          badgeParts.push(`BMR ${entry.bmrKcal}`);
        }
        const waist = Number(payload.waistCm ?? payload.waist_cm);
        if (Number.isFinite(waist) && waist >= 45 && waist <= 180) {
          entry.waistCm = Number(waist.toFixed(1));
          badgeParts.push(`Taille ${entry.waistCm} cm`);
        }

        if (badgeParts.length === 0) {
          errors.push('LOG_BIOMETRICS ignoré : aucune mesure biométrique valide.');
          continue;
        }
        if (!entry.weightKg && Number(curProfile.weightKg) > 25) {
          entry.weightKg = Number(curProfile.weightKg);
        }

        await db.saveBiometric(curProfile.id, entry);
        snapshot.biometricsModified = true;
        changedModules.add('biometrics');
        changedModules.add('nutrition');

        if (entry.weightKg && Math.abs(entry.weightKg - Number(curProfile.weightKg || 0)) >= 0.1) {
          curProfile = await db.updateProfile(curProfile.id, { weightKg: entry.weightKg });
          snapshot.profileModified = true;
          changedModules.add('profile');
        }
        executedBadges.push(`EXÉCUTÉ · Biométrie : ${badgeParts.join(' · ')}`);
        continue;
      }

      /* ---------------- 4c. SAVE_CUSTOM_FOOD ---------------- */
      if (type === 'SAVE_CUSTOM_FOOD') {
        if (typeof db.saveCustomFood !== 'function') {
          errors.push('SAVE_CUSTOM_FOOD indisponible.');
          continue;
        }
        const name = String(payload.name || payload.label || '').trim().slice(0, 90);
        if (!name) {
          errors.push('SAVE_CUSTOM_FOOD ignoré : nom manquant.');
          continue;
        }
        const proteinG = Math.max(0, Math.round((Number(payload.protein ?? payload.proteinG) || 0) * 10) / 10);
        const carbsG = Math.max(0, Math.round((Number(payload.carbs ?? payload.carbsG) || 0) * 10) / 10);
        const fatG = Math.max(0, Math.round((Number(payload.fat ?? payload.fatG) || 0) * 10) / 10);
        const fiberG = Math.max(0, Math.round((Number(payload.fiber ?? payload.fiberG) || 0) * 10) / 10);
        const kcal = Math.max(0, Math.round(Number(payload.kcal ?? payload.calories) || proteinG * 4 + carbsG * 4 + fatG * 9));
        const pGrams = Math.round(Number(payload.portionGrams ?? payload.portion?.grams) || 0);
        const pLabel = String(payload.portionLabel ?? payload.portion?.label ?? '').trim();

        const savedFood = await db.saveCustomFood(curProfile.id, {
          name,
          brand: String(payload.brand || '').trim(),
          kcal,
          proteinG,
          carbsG,
          fatG,
          fiberG,
          portion: pGrams >= 5 && pGrams <= 1500 ? { label: pLabel || '1 portion', grams: pGrams } : null,
          source: 'coach_vision',
        });
        snapshot.addedCustomFoodIds.push(savedFood.id);
        changedModules.add('nutrition');
        executedBadges.push(`EXÉCUTÉ · Aliment perso : ${savedFood.name} (${savedFood.kcal} kcal/100g)`);
        continue;
      }

      /* ---------------- 4d. APPLY_PHYSIQUE_ASSESSMENT ---------------- */
      if (type === 'APPLY_PHYSIQUE_ASSESSMENT') {
        const patch = {};
        const parts = [];
        if (Array.isArray(payload.lagPriorities)) {
          const validLags = payload.lagPriorities.filter((g) => MUSCLE_GROUPS[g]);
          if (validLags.length > 0) {
            patch.lagPriorities = validLags;
            parts.push(`LAG: ${validLags.map((g) => MUSCLE_GROUPS[g].label).join(', ')}`);
          }
        }
        if (Array.isArray(payload.dominantGroups)) {
          const validDom = payload.dominantGroups.filter((g) => MUSCLE_GROUPS[g]);
          if (validDom.length > 0) {
            patch.dominantGroups = validDom;
            parts.push(`DOM: ${validDom.map((g) => MUSCLE_GROUPS[g].label).join(', ')}`);
          }
        }
        if (Array.isArray(payload.asymmetries)) {
          patch.asymmetries = payload.asymmetries;
          if (payload.asymmetries.length > 0) parts.push(`${payload.asymmetries.length} asymétrie(s)`);
        }
        if (Object.keys(patch).length > 0) {
          curProfile = await db.updateProfile(curProfile.id, patch);
          snapshot.profileModified = true;
          changedModules.add('profile');
        }
        if (payload.rebuildProgram !== false && Object.keys(patch).length > 0) {
          const rebuilt = generateProgram(curProfile, {
            phase: curProgram?.phase || 'accumulation',
            mesocycleNumber: curProgram?.mesocycleNumber || 1,
          });
          curProgram = await db.saveProgram(curProfile.id, rebuilt);
          snapshot.programModified = true;
          changedModules.add('program');
        }
        if (parts.length > 0) {
          executedBadges.push(`EXÉCUTÉ · Bilan physique : ${parts.join(' · ')}`);
        }
        continue;
      }

      /* ---------------- 5. DELETE_LAST_MEAL ---------------- */
      if (type === 'DELETE_LAST_MEAL') {
        const latestMeal = curNutritionToday[0];
        if (!latestMeal) {
          errors.push('DELETE_LAST_MEAL : aucun repas à supprimer aujourd’hui.');
          continue;
        }
        await db.deleteNutritionLog(latestMeal.id);
        snapshot.deletedMeals.push(latestMeal);
        curNutritionToday = curNutritionToday.slice(1);
        changedModules.add('nutrition');
        executedBadges.push(`EXÉCUTÉ · Repas supprimé : ${latestMeal.label} (${latestMeal.kcal} kcal)`);
        continue;
      }

      /* ---------------- 6. UPDATE_PROFILE ---------------- */
      if (type === 'UPDATE_PROFILE') {
        const patch = {};
        const changedLabels = [];
        let shouldRebuildProgram = false;

        if (payload.goal) {
          const mappedGoal = GOAL_ALIASES[normalizeKey(payload.goal)];
          if (mappedGoal && GOAL_PROFILES[mappedGoal]) {
            patch.goal = mappedGoal;
            changedLabels.push(`Objectif ${GOAL_PROFILES[mappedGoal].label}`);
            shouldRebuildProgram = true;
          }
        }
        const newWeight = Number(payload.weight ?? payload.weightKg);
        if (Number.isFinite(newWeight) && newWeight >= 35 && newWeight <= 220) {
          patch.weightKg = Number(newWeight.toFixed(1));
          changedLabels.push(`${patch.weightKg} kg`);
        }
        if (payload.activityLevel || payload.neatLevel) {
          const mappedAct = ACTIVITY_ALIASES[normalizeKey(payload.activityLevel || payload.neatLevel)];
          if (mappedAct) {
            patch.lifestyle = { neatLevel: mappedAct };
            changedLabels.push(`NEAT ${mappedAct}`);
          }
        }
        const spw = Number(payload.sessionsPerWeek);
        if (Number.isFinite(spw) && spw >= 2 && spw <= 6) {
          patch.sessionsPerWeek = Math.round(spw);
          changedLabels.push(`${patch.sessionsPerWeek} j/sem`);
          shouldRebuildProgram = true;
        }
        const dur = Number(payload.sessionDuration ?? payload.sessionDurationMin);
        if (Number.isFinite(dur) && dur >= 30 && dur <= 120) {
          patch.sessionDurationMin = Math.round(dur);
          changedLabels.push(`${patch.sessionDurationMin} min`);
          shouldRebuildProgram = true;
        }
        if (Array.isArray(payload.equipment) && payload.equipment.length > 0) {
          patch.equipment = Array.from(new Set(payload.equipment.map((e) => String(e).trim()).filter(Boolean)));
          changedLabels.push('Matériel');
          shouldRebuildProgram = true;
        }
        if (Array.isArray(payload.addEquipment) && payload.addEquipment.length > 0) {
          const mergedEq = Array.from(
            new Set([
              ...(Array.isArray(curProfile.equipment) ? curProfile.equipment : []),
              ...payload.addEquipment.map((e) => String(e).trim()).filter(Boolean),
            ])
          );
          patch.equipment = mergedEq;
          changedLabels.push(`+${payload.addEquipment.join(', ')}`);
          shouldRebuildProgram = true;
        }
        if (payload.diet || payload.dietType) {
          const mappedDiet = DIET_ALIASES[normalizeKey(payload.diet || payload.dietType)];
          if (mappedDiet) {
            patch.nutritionPrefs = { ...(patch.nutritionPrefs || {}), dietType: mappedDiet };
            changedLabels.push(`Régime ${mappedDiet}`);
          }
        }
        if (Array.isArray(payload.allergies)) {
          patch.nutritionPrefs = {
            ...(patch.nutritionPrefs || {}),
            allergies: payload.allergies.map((a) => String(a).trim().toLowerCase()).filter(Boolean),
          };
          changedLabels.push('Allergies');
        }
        if (Array.isArray(payload.injuries)) {
          const cleanInjuries = payload.injuries
            .map((inj) => {
              const z = PAIN_ZONE_ALIASES[normalizeKey(typeof inj === 'string' ? inj : inj?.zone)];
              if (!z) return null;
              return {
                zone: z,
                severity: Math.max(1, Math.min(3, Number(inj?.severity) || 2)),
                notes: String(inj?.notes || 'Déclaré via Coach IA'),
              };
            })
            .filter(Boolean);
          patch.injuries = cleanInjuries;
          changedLabels.push('Zones sensibles');
          shouldRebuildProgram = true;
        }
        if (payload.morphology && typeof payload.morphology === 'object') {
          const m = payload.morphology;
          const morphPatch = {};
          if (typeof m.morphotype === 'string' && m.morphotype.trim()) {
            morphPatch.morphotype = m.morphotype.trim();
          }
          if (['long_femur', 'balanced', 'short_femur'].includes(m.femurTorsoRatio)) {
            morphPatch.femurTorsoRatio = m.femurTorsoRatio;
          }
          if (['long_arms', 'balanced', 'short_arms'].includes(m.armSpanRatio)) {
            morphPatch.armSpanRatio = m.armSpanRatio;
          }
          if (['broad_shoulders', 'balanced', 'narrow_shoulders'].includes(m.claviclePelvisRatio)) {
            morphPatch.claviclePelvisRatio = m.claviclePelvisRatio;
          }
          if (['narrow', 'medium', 'wide'].includes(m.ribcageType)) {
            morphPatch.ribcageType = m.ribcageType;
          }
          if (Array.isArray(m.postureFlags)) {
            const validFlags = ['anterior_pelvic_tilt', 'kyphosis', 'forward_head', 'protracted_shoulders'];
            morphPatch.postureFlags = Array.from(new Set(m.postureFlags.filter((fl) => validFlags.includes(fl))));
          }
          if (Object.keys(morphPatch).length > 0) {
            patch.morphology = morphPatch;
            changedLabels.push('Morpho/Posture');
          }
        }
        if (Array.isArray(payload.lagPriorities)) {
          const validLags = payload.lagPriorities.filter((g) => MUSCLE_GROUPS[g]);
          if (validLags.length > 0) {
            patch.lagPriorities = validLags;
            changedLabels.push(`LAG (${validLags.length})`);
          }
        }
        if (Array.isArray(payload.dominantGroups)) {
          const validDom = payload.dominantGroups.filter((g) => MUSCLE_GROUPS[g]);
          if (validDom.length > 0) {
            patch.dominantGroups = validDom;
            changedLabels.push(`DOM (${validDom.length})`);
          }
        }
        if (Array.isArray(payload.asymmetries)) {
          patch.asymmetries = payload.asymmetries;
          if (payload.asymmetries.length > 0) changedLabels.push('Asymétries');
        }

        const newBf = Number(payload.bodyFat ?? payload.bodyFatPct);
        const newWaist = Number(payload.waistCm ?? payload.waist_cm);
        const newBmr = Number(payload.bmrKcal ?? payload.bmr_kcal);
        const hasBioExtras =
          (Number.isFinite(newBf) && newBf >= 4 && newBf <= 55) ||
          (Number.isFinite(newWaist) && newWaist >= 45 && newWaist <= 180) ||
          (Number.isFinite(newBmr) && newBmr >= 900 && newBmr <= 4500);

        if (hasBioExtras) {
          const bioEntry = {
            date: todayISO,
            weightKg: patch.weightKg || curProfile.weightKg,
            source: 'coach_ai',
          };
          if (Number.isFinite(newBf) && newBf >= 4 && newBf <= 55) {
            bioEntry.bodyFatPct = Number(newBf.toFixed(1));
            changedLabels.push(`MG ${bioEntry.bodyFatPct}%`);
          }
          if (Number.isFinite(newWaist) && newWaist >= 45 && newWaist <= 180) {
            bioEntry.waistCm = Number(newWaist.toFixed(1));
            changedLabels.push(`Taille ${bioEntry.waistCm} cm`);
          }
          if (Number.isFinite(newBmr) && newBmr >= 900 && newBmr <= 4500) {
            bioEntry.bmrKcal = Math.round(newBmr);
            changedLabels.push(`BMR ${bioEntry.bmrKcal}`);
          }
          await db.saveBiometric(curProfile.id, bioEntry);
          snapshot.biometricsModified = true;
          changedModules.add('biometrics');
        }

        if (Object.keys(patch).length > 0) {
          curProfile = await db.updateProfile(curProfile.id, patch);
          snapshot.profileModified = true;
          changedModules.add('profile');
          changedModules.add('nutrition');
        }
        if (shouldRebuildProgram && payload.skipProgramRebuild !== true) {
          const rebuilt = generateProgram(curProfile, {
            phase: curProgram?.phase || 'accumulation',
            mesocycleNumber: curProgram?.mesocycleNumber || 1,
          });
          curProgram = await db.saveProgram(curProfile.id, rebuilt);
          snapshot.programModified = true;
          changedModules.add('program');
        }
        if (changedLabels.length > 0) {
          executedBadges.push(`EXÉCUTÉ · Profil : ${changedLabels.join(' · ')}`);
        }
        continue;
      }

      /* ---------------- 7. MUTATE_PROGRAM ---------------- */
      if (type === 'MUTATE_PROGRAM') {
        const profilePatch = {};
        const badgeParts = [];
        let mustRegenerate = Boolean(payload.regenerate);

        if (payload.split) {
          const mappedSplit = SPLIT_ALIASES[normalizeKey(payload.split)];
          if (mappedSplit && TRAINING_SPLITS[mappedSplit]) {
            profilePatch.splitPreference = mappedSplit;
            badgeParts.push(TRAINING_SPLITS[mappedSplit].shortLabel);
            mustRegenerate = true;
          }
        }
        if (payload.method || payload.progressionMethod) {
          const mappedMethod = METHOD_ALIASES[normalizeKey(payload.method || payload.progressionMethod)];
          if (mappedMethod && TRAINING_METHODS[mappedMethod]) {
            profilePatch.progressionMethod = mappedMethod;
            badgeParts.push(TRAINING_METHODS[mappedMethod].shortLabel);
            mustRegenerate = true;
          }
        }
        const spw = Number(payload.sessionsPerWeek);
        if (Number.isFinite(spw) && spw >= 2 && spw <= 6) {
          profilePatch.sessionsPerWeek = Math.round(spw);
          badgeParts.push(`${profilePatch.sessionsPerWeek} j/sem`);
          mustRegenerate = true;
        }
        const dur = Number(payload.sessionDurationMin ?? payload.sessionDuration);
        if (Number.isFinite(dur) && dur >= 30 && dur <= 120) {
          profilePatch.sessionDurationMin = Math.round(dur);
          badgeParts.push(`${profilePatch.sessionDurationMin} min`);
          mustRegenerate = true;
        }

        if (Object.keys(profilePatch).length > 0) {
          curProfile = await db.updateProfile(curProfile.id, profilePatch);
          snapshot.profileModified = true;
          changedModules.add('profile');
        }

        const nextPhase =
          typeof payload.phase === 'string' &&
          ['calibration', 'accumulation', 'intensification', 'deload'].includes(payload.phase.toLowerCase())
            ? payload.phase.toLowerCase()
            : null;
        if (nextPhase) {
          badgeParts.push(nextPhase === 'deload' ? 'Deload (-45% vol.)' : `Phase ${nextPhase}`);
          mustRegenerate = true;
        }

        if (mustRegenerate || !curProgram) {
          const rebuilt = generateProgram(curProfile, {
            phase: nextPhase || curProgram?.phase || 'accumulation',
            mesocycleNumber: curProgram?.mesocycleNumber || 1,
          });
          curProgram = await db.saveProgram(curProfile.id, rebuilt);
          snapshot.programModified = true;
          changedModules.add('program');
        }

        // Ajustements fins sur le programme actif (Mode Préservation, setsDelta, repsDelta, rirDelta)
        let fineTuned = false;
        if (curProgram && Array.isArray(curProgram.days)) {
          if (payload.preservationMode === true) {
            curProgram = {
              ...curProgram,
              preservationMode: true,
              days: curProgram.days.map((d) => applyPreservationMode(d)),
            };
            curProgram.weeklyVolume = calculateWeeklyVolume(curProgram.days);
            badgeParts.push('Mode Préservation (-1 série, +1 RIR)');
            fineTuned = true;
          }

          const setsDelta = Number(payload.setsDelta) || 0;
          const repsDelta = Number(payload.repsDelta) || 0;
          const rirDelta = Number(payload.rirDelta) || 0;
          if (setsDelta !== 0 || repsDelta !== 0 || rirDelta !== 0) {
            const targetDayIdx =
              payload.dayIndex !== undefined && payload.dayIndex !== null ? Number(payload.dayIndex) : null;
            curProgram = {
              ...curProgram,
              days: curProgram.days.map((day, dIdx) => {
                if (targetDayIdx !== null && dIdx !== targetDayIdx) return day;
                return {
                  ...day,
                  exercises: (day.exercises || []).map((ex) => {
                    const nextSets = Math.max(1, Math.min(6, (Number(ex.sets) || 3) + setsDelta));
                    const repMin = Math.max(3, (ex.repRange?.[0] || 8) + repsDelta);
                    const repMax = Math.max(repMin + 1, (ex.repRange?.[1] || 12) + repsDelta);
                    const nextRir = Math.max(0, Math.min(4, (Number(ex.targetRir) || 1) + rirDelta));
                    const dbEx = getExerciseById(ex.exerciseId);
                    return {
                      ...ex,
                      sets: nextSets,
                      repRange: [repMin, repMax],
                      targetRir: nextRir,
                      setScheme: dbEx
                        ? buildSetScheme(
                            curProgram.progressionMethod || 'double_progression',
                            nextSets,
                            [repMin, repMax],
                            ex.suggestedLoadKg,
                            dbEx,
                            nextRir
                          )
                        : ex.setScheme,
                    };
                  }),
                };
              }),
            };
            curProgram.weeklyVolume = calculateWeeklyVolume(curProgram.days);
            if (setsDelta) badgeParts.push(`Séries ${setsDelta > 0 ? '+' : ''}${setsDelta}`);
            if (repsDelta) badgeParts.push(`Reps ${repsDelta > 0 ? '+' : ''}${repsDelta}`);
            if (rirDelta) badgeParts.push(`RIR ${rirDelta > 0 ? '+' : ''}${rirDelta}`);
            fineTuned = true;
          }

          if (fineTuned) {
            curProgram = await db.saveProgram(curProfile.id, curProgram);
            snapshot.programModified = true;
            changedModules.add('program');
          }
        }

        if (badgeParts.length > 0 || mustRegenerate) {
          executedBadges.push(
            `EXÉCUTÉ · Programme : ${badgeParts.length ? badgeParts.join(' · ') : `${curProgram.splitLabel} · ${curProgram.methodLabel}`}`
          );
        }
        continue;
      }

      /* ---------------- 8. SWAP_EXERCISE ---------------- */
      if (type === 'SWAP_EXERCISE') {
        if (!curProgram?.days?.length) {
          errors.push('SWAP_EXERCISE : aucun programme actif.');
          continue;
        }

        // Mode B : filtrage automatique d'une douleur déclarée
        const rawPainZone = payload.painZone || payload.injuryZone || null;
        if (rawPainZone) {
          const zone = PAIN_ZONE_ALIASES[normalizeKey(rawPainZone)];
          if (!zone) {
            errors.push(`SWAP_EXERCISE : zone douleur inconnue (${rawPainZone}).`);
            continue;
          }
          // Enregistre la sensibilité dans le profil
          const existingInj = Array.isArray(curProfile.injuries) ? curProfile.injuries : [];
          const nextInj = existingInj.some((i) => i.zone === zone)
            ? existingInj.map((i) => (i.zone === zone ? { ...i, severity: Math.max(2, Number(i.severity) || 2) } : i))
            : [...existingInj, { zone, severity: 2, notes: 'Signalé au Coach IA' }];
          curProfile = await db.updateProfile(curProfile.id, { injuries: nextInj });
          snapshot.profileModified = true;
          changedModules.add('profile');

          const blockedFlags = new Set(PAIN_CONTRAINDICATION_MAP[zone] || []);
          let swappedCount = 0;
          const swappedNames = [];

          const updatedDays = curProgram.days.map((day) => ({
            ...day,
            exercises: (day.exercises || []).map((slot) => {
              const dbEx = getExerciseById(slot.exerciseId);
              const isRisky = (dbEx?.contraindications || []).some((c) => blockedFlags.has(c));
              if (!isRisky) return slot;

              const swaps = findBiomechanicalSwaps(slot.exerciseId, curProfile, slot.suggestedLoadKg);
              const safePick = swaps[0]?.exercise || null;
              if (!safePick) return slot;

              swappedCount += 1;
              swappedNames.push(`${slot.name} → ${safePick.name}`);
              return buildSwappedSlot(slot, safePick, curProfile, curProgram);
            }),
          }));

          curProgram = await db.saveProgram(curProfile.id, {
            ...curProgram,
            days: updatedDays,
            weeklyVolume: calculateWeeklyVolume(updatedDays),
          });
          snapshot.programModified = true;
          changedModules.add('program');
          executedBadges.push(
            swappedCount > 0
              ? `EXÉCUTÉ · Protection ${PAIN_ZONE_LABELS[zone] || zone} : ${swappedCount} exercice(s) adapté(s)`
              : `EXÉCUTÉ · Alerte ${PAIN_ZONE_LABELS[zone] || zone} enregistrée (programme déjà sûr)`
          );
          continue;
        }

        // Mode A : swap ciblé validé strictement contre js/exercises-db.js
        const toId = String(payload.toExerciseId || payload.newExerciseId || payload.exercise_id || '').trim();
        const targetEx = getExerciseById(toId);
        if (!targetEx) {
          errors.push(`SWAP_EXERCISE rejeté : exercise_id inconnu ("${toId}").`);
          continue;
        }

        const matches = findProgramExerciseSlot(curProgram, {
          fromExerciseId: payload.fromExerciseId || payload.oldExerciseId,
          fromName: payload.fromName || payload.oldName,
          dayIndex: payload.dayIndex,
        });

        if (matches.length === 0) {
          errors.push(`SWAP_EXERCISE : exercice source introuvable dans le programme actif.`);
          continue;
        }

        const firstOldName = matches[0].slot.name;
        const matchSet = new Set(matches.map((m) => `${m.dayIdx}:${m.exIdx}`));
        const updatedDays = curProgram.days.map((day, dIdx) => ({
          ...day,
          exercises: (day.exercises || []).map((slot, eIdx) =>
            matchSet.has(`${dIdx}:${eIdx}`) ? buildSwappedSlot(slot, targetEx, curProfile, curProgram) : slot
          ),
        }));

        curProgram = await db.saveProgram(curProfile.id, {
          ...curProgram,
          days: updatedDays,
          weeklyVolume: calculateWeeklyVolume(updatedDays),
        });
        snapshot.programModified = true;
        changedModules.add('program');
        executedBadges.push(`EXÉCUTÉ · Swap : ${firstOldName} → ${targetEx.name}`);
        continue;
      }

      /* ---------------- 9. SAVE_COACH_MEMORY ---------------- */
      if (type === 'SAVE_COACH_MEMORY') {
        const text = String(payload.text || payload.note || '').trim().slice(0, 180);
        if (text.length < 3) continue;
        const existingMem = Array.isArray(curProfile.coachMemory) ? curProfile.coachMemory : [];
        if (existingMem.some((m) => normalizeSearch(m.text) === normalizeSearch(text))) {
          continue;
        }
        const nextMem = [
          ...existingMem,
          {
            id: generateId('mem'),
            category: String(payload.category || 'coach'),
            text,
            createdAt: Date.now(),
          },
        ].slice(-16);

        curProfile = await db.updateProfile(curProfile.id, { coachMemory: nextMem });
        snapshot.profileModified = true;
        changedModules.add('memory');
        executedBadges.push(`EXÉCUTÉ · Mémoire +1`);
        continue;
      }

      /* ---------------- 10. REMOVE_COACH_MEMORY ---------------- */
      if (type === 'REMOVE_COACH_MEMORY') {
        const existingMem = Array.isArray(curProfile.coachMemory) ? curProfile.coachMemory : [];
        const targetId = payload.id ? String(payload.id).trim() : '';
        const matchStr = payload.match || payload.text ? normalizeSearch(payload.match || payload.text) : '';
        const nextMem = existingMem.filter((m) => {
          if (targetId && m.id === targetId) return false;
          if (matchStr && normalizeSearch(m.text).includes(matchStr)) return false;
          return true;
        });

        if (nextMem.length === existingMem.length) continue;
        curProfile = await db.updateProfile(curProfile.id, { coachMemory: nextMem });
        snapshot.profileModified = true;
        changedModules.add('memory');
        executedBadges.push(`EXÉCUTÉ · Mémoire -${existingMem.length - nextMem.length}`);
        continue;
      }

      errors.push(`Action inconnue ignorée : ${type}`);
    } catch (err) {
      errors.push(`Erreur ${type} : ${err?.message || String(err)}`);
    }
  }

  // Fonction d'annulation complète (Toast Annuler 5s)
  const undo =
    executedBadges.length > 0
      ? async () => {
          if (snapshot.profileModified) {
            await db.updateProfile(snapshot.profile.id, {
              goal: snapshot.profile.goal,
              weightKg: snapshot.profile.weightKg,
              sessionsPerWeek: snapshot.profile.sessionsPerWeek,
              sessionDurationMin: snapshot.profile.sessionDurationMin,
              splitPreference: snapshot.profile.splitPreference,
              progressionMethod: snapshot.profile.progressionMethod,
              equipment: snapshot.profile.equipment,
              injuries: snapshot.profile.injuries,
              morphology: snapshot.profile.morphology,
              lagPriorities: snapshot.profile.lagPriorities,
              dominantGroups: snapshot.profile.dominantGroups,
              asymmetries: snapshot.profile.asymmetries,
              lifestyle: snapshot.profile.lifestyle,
              nutritionPrefs: snapshot.profile.nutritionPrefs,
              coachMemory: snapshot.profile.coachMemory,
            });
          }
          if (snapshot.programModified && snapshot.program) {
            await db.saveProgram(snapshot.profile.id, snapshot.program);
          }
          if (snapshot.biometricsModified && typeof db.restoreBiometricsForProfile === 'function') {
            await db.restoreBiometricsForProfile(snapshot.profile.id, snapshot.biometrics);
          }
          for (const mealId of snapshot.addedMealIds) {
            await db.deleteNutritionLog(mealId);
          }
          for (const deletedMeal of snapshot.deletedMeals) {
            await db.saveNutritionLog(snapshot.profile.id, deletedMeal);
          }
          if (typeof db.deleteCustomFood === 'function') {
            for (const cfId of snapshot.addedCustomFoodIds) {
              await db.deleteCustomFood(cfId);
            }
          }
        }
      : null;

  return {
    executedBadges,
    errors,
    changedModules: Array.from(changedModules),
    profile: curProfile,
    program: curProgram,
    undo,
  };
}

/* ==========================================================================
   5. GARDE-FOU "APERÇU & CONFIRMATION SÉLECTIVE" (PHOTOS COACH & LABO)
   ========================================================================== */

const MORPH_LABELS = Object.freeze({
  long_femur: 'Fémurs longs',
  short_femur: 'Fémurs courts',
  balanced: 'Équilibré',
  long_arms: 'Bras longs',
  short_arms: 'Bras courts',
  broad_shoulders: 'Épaules larges',
  narrow_shoulders: 'Épaules étroites',
  narrow: 'Étroite',
  medium: 'Moyenne',
  wide: 'Large',
  anterior_pelvic_tilt: 'Antéversion bassin',
  kyphosis: 'Cyphose thoracique',
  forward_head: 'Tête projetée',
  protracted_shoulders: 'Épaules enroulées',
  ectomorph: 'Ectomorphe',
  mesomorph: 'Mésomorphe',
  endomorph: 'Endomorphe',
  ecto_meso: 'Ecto-mésomorphe',
  meso_endo: 'Méso-endomorphe',
});

function formatMorphValue(val) {
  if (Array.isArray(val)) {
    return val.length > 0 ? val.map((v) => MORPH_LABELS[v] || v).join(', ') : 'Non renseigné';
  }
  if (!val) return 'Non renseigné';
  return MORPH_LABELS[val] || String(val);
}

/**
 * Transforme les actions émises par le Coach Vision suite à une photo en une liste
 * sélective vérifiable (Ancienne valeur -> Nouvelle valeur + tag [NOUVEAU]).
 * Garantit zéro écrasement silencieux du profil.
 */
export function buildPhotoUpdateProposal(actions = [], { profile = {}, latestBiometrics = null } = {}) {
  if (!Array.isArray(actions) || actions.length === 0) return null;

  const items = [];
  let mealPreview = null;
  let seq = 0;
  const nextId = () => `pu_${seq++}_${Date.now().toString(36)}`;
  const morph = profile?.morphology || {};

  const pushItem = ({ label, oldValue, newValue, isNew = false, action }) => {
    items.push({
      id: nextId(),
      label,
      oldValue: oldValue ?? 'Non renseigné',
      newValue,
      isNew: Boolean(isNew),
      checked: true,
      action,
    });
  };

  for (const act of actions) {
    const type = String(act?.type || '').toUpperCase();
    const p = act?.payload && typeof act.payload === 'object' ? act.payload : {};

    if (type === 'LOG_BIOMETRICS') {
      const bioSummaryParts = [];
      const w = Number(p.weightKg ?? p.weight ?? p.weight_kg);
      const bf = Number(p.bodyFatPct ?? p.bodyFat ?? p.body_fat_pct);
      const mm = Number(p.muscleMassKg ?? p.muscle_mass_kg);
      const skm = Number(p.skeletalMuscleKg ?? p.skeletal_muscle_kg);
      const vf = Number(p.visceralFat ?? p.visceral_fat);
      const hyd = Number(p.hydrationPct ?? p.hydration_pct);
      const bmr = Number(p.bmrKcal ?? p.bmr_kcal);
      const waist = Number(p.waistCm ?? p.waist_cm);

      if (Number.isFinite(w) && w >= 25) bioSummaryParts.push(`${w.toFixed(1)} kg`);
      if (Number.isFinite(bf) && bf >= 4) bioSummaryParts.push(`${bf.toFixed(1)}% MG`);
      if (Number.isFinite(mm) && mm >= 15) bioSummaryParts.push(`Muscle ${mm.toFixed(1)} kg`);
      if (Number.isFinite(skm) && skm >= 10) bioSummaryParts.push(`Musc. sq. ${skm.toFixed(1)} kg`);
      if (Number.isFinite(vf) && vf >= 1) bioSummaryParts.push(`Visc. ${vf}`);
      if (Number.isFinite(hyd) && hyd >= 30) bioSummaryParts.push(`Eau ${hyd.toFixed(1)}%`);
      if (Number.isFinite(bmr) && bmr >= 900) bioSummaryParts.push(`BMR ${Math.round(bmr)} kcal`);
      if (Number.isFinite(waist) && waist >= 45) bioSummaryParts.push(`Taille ${waist.toFixed(1)} cm`);

      if (bioSummaryParts.length > 0) {
        const oldParts = [];
        if (latestBiometrics?.weightKg) oldParts.push(`${latestBiometrics.weightKg} kg`);
        if (latestBiometrics?.bodyFatPct) oldParts.push(`${latestBiometrics.bodyFatPct}% MG`);
        if (latestBiometrics?.bmrKcal) oldParts.push(`BMR ${latestBiometrics.bmrKcal}`);
        pushItem({
          label: 'Pesée & Biométrie datée',
          oldValue: oldParts.length ? oldParts.join(' · ') : 'Aucune mesure',
          newValue: bioSummaryParts.join(' · '),
          isNew: !latestBiometrics || (!latestBiometrics.bmrKcal && Number.isFinite(bmr)) || (!latestBiometrics.bodyFatPct && Number.isFinite(bf)),
          action: { type: 'LOG_BIOMETRICS', payload: p },
        });
      }
      continue;
    }

    if (type === 'UPDATE_PROFILE') {
      const w = Number(p.weight ?? p.weightKg);
      if (Number.isFinite(w) && w >= 35 && w <= 220) {
        pushItem({
          label: 'Poids de référence profil',
          oldValue: profile?.weightKg ? `${profile.weightKg} kg` : 'Non renseigné',
          newValue: `${w.toFixed(1)} kg`,
          isNew: !profile?.weightKg,
          action: { type: 'UPDATE_PROFILE', payload: { weightKg: w, skipProgramRebuild: true } },
        });
      }
      const bf = Number(p.bodyFat ?? p.bodyFatPct);
      if (Number.isFinite(bf) && bf >= 4 && bf <= 55) {
        pushItem({
          label: 'Masse grasse (%MG)',
          oldValue: latestBiometrics?.bodyFatPct ? `${latestBiometrics.bodyFatPct} %` : 'Non renseigné',
          newValue: `${bf.toFixed(1)} %`,
          isNew: !latestBiometrics?.bodyFatPct,
          action: { type: 'UPDATE_PROFILE', payload: { bodyFatPct: bf, skipProgramRebuild: true } },
        });
      }
      const waist = Number(p.waistCm ?? p.waist_cm);
      if (Number.isFinite(waist) && waist >= 45 && waist <= 180) {
        pushItem({
          label: 'Tour de taille',
          oldValue: latestBiometrics?.waistCm ? `${latestBiometrics.waistCm} cm` : 'Non renseigné',
          newValue: `${waist.toFixed(1)} cm`,
          isNew: !latestBiometrics?.waistCm,
          action: { type: 'UPDATE_PROFILE', payload: { waistCm: waist, skipProgramRebuild: true } },
        });
      }
      const bmr = Number(p.bmrKcal ?? p.bmr_kcal);
      if (Number.isFinite(bmr) && bmr >= 900 && bmr <= 4500) {
        pushItem({
          label: 'Métabolisme de base (BMR)',
          oldValue: latestBiometrics?.bmrKcal ? `${latestBiometrics.bmrKcal} kcal` : 'Non renseigné',
          newValue: `${Math.round(bmr)} kcal`,
          isNew: !latestBiometrics?.bmrKcal,
          action: { type: 'UPDATE_PROFILE', payload: { bmrKcal: Math.round(bmr), skipProgramRebuild: true } },
        });
      }
      if (p.morphology && typeof p.morphology === 'object') {
        const m = p.morphology;
        if (m.morphotype) {
          pushItem({
            label: 'Morphotype',
            oldValue: formatMorphValue(morph.morphotype),
            newValue: formatMorphValue(m.morphotype),
            isNew: !morph.morphotype,
            action: { type: 'UPDATE_PROFILE', payload: { morphology: { morphotype: m.morphotype }, skipProgramRebuild: true } },
          });
        }
        const segKeys = [
          ['femurTorsoRatio', 'Ratio Fémur / Buste'],
          ['armSpanRatio', 'Envergure bras'],
          ['claviclePelvisRatio', 'Clavicules / Bassin'],
          ['ribcageType', 'Cage thoracique'],
        ];
        for (const [k, lbl] of segKeys) {
          if (m[k] && m[k] !== morph[k]) {
            pushItem({
              label: lbl,
              oldValue: formatMorphValue(morph[k]),
              newValue: formatMorphValue(m[k]),
              isNew: !morph[k],
              action: { type: 'UPDATE_PROFILE', payload: { morphology: { [k]: m[k] }, skipProgramRebuild: true } },
            });
          }
        }
        if (Array.isArray(m.postureFlags) && m.postureFlags.length > 0) {
          const oldFlags = Array.isArray(morph.postureFlags) ? morph.postureFlags : [];
          pushItem({
            label: 'Repères posturaux',
            oldValue: oldFlags.length ? formatMorphValue(oldFlags) : 'Neutre / vide',
            newValue: formatMorphValue(m.postureFlags),
            isNew: oldFlags.length === 0,
            action: { type: 'UPDATE_PROFILE', payload: { morphology: { postureFlags: m.postureFlags }, skipProgramRebuild: true } },
          });
        }
      }
      if (Array.isArray(p.lagPriorities) && p.lagPriorities.length > 0) {
        const valid = p.lagPriorities.filter((g) => MUSCLE_GROUPS[g]);
        if (valid.length > 0) {
          const oldLags = Array.isArray(profile?.lagPriorities) ? profile.lagPriorities : [];
          pushItem({
            label: 'Points faibles [LAG]',
            oldValue: oldLags.length ? oldLags.map((g) => MUSCLE_GROUPS[g]?.label || g).join(', ') : 'Aucun',
            newValue: valid.map((g) => MUSCLE_GROUPS[g]?.label || g).join(', '),
            isNew: oldLags.length === 0,
            action: { type: 'UPDATE_PROFILE', payload: { lagPriorities: valid, skipProgramRebuild: true } },
          });
        }
      }
      if (Array.isArray(p.dominantGroups) && p.dominantGroups.length > 0) {
        const valid = p.dominantGroups.filter((g) => MUSCLE_GROUPS[g]);
        if (valid.length > 0) {
          const oldDom = Array.isArray(profile?.dominantGroups) ? profile.dominantGroups : [];
          pushItem({
            label: 'Points forts [DOMINANT]',
            oldValue: oldDom.length ? oldDom.map((g) => MUSCLE_GROUPS[g]?.label || g).join(', ') : 'Aucun',
            newValue: valid.map((g) => MUSCLE_GROUPS[g]?.label || g).join(', '),
            isNew: oldDom.length === 0,
            action: { type: 'UPDATE_PROFILE', payload: { dominantGroups: valid, skipProgramRebuild: true } },
          });
        }
      }
      if (Array.isArray(p.injuries) && p.injuries.length > 0) {
        const oldInj = Array.isArray(profile?.injuries) ? profile.injuries : [];
        pushItem({
          label: 'Zones sensibles / douleurs',
          oldValue: oldInj.length ? oldInj.map((i) => PAIN_ZONE_LABELS[i.zone] || i.zone).join(', ') : 'Aucune',
          newValue: p.injuries.map((i) => PAIN_ZONE_LABELS[typeof i === 'string' ? i : i.zone] || (typeof i === 'string' ? i : i.zone)).join(', '),
          isNew: oldInj.length === 0,
          action: { type: 'UPDATE_PROFILE', payload: { injuries: p.injuries } },
        });
      }
      if ((Array.isArray(p.addEquipment) && p.addEquipment.length > 0) || (Array.isArray(p.equipment) && p.equipment.length > 0)) {
        const eqList = Array.isArray(p.addEquipment) && p.addEquipment.length > 0 ? p.addEquipment : p.equipment;
        pushItem({
          label: 'Équipement disponible',
          oldValue: (profile?.equipment || []).join(', ') || 'Aucun',
          newValue: Array.isArray(p.addEquipment) ? `+ ${eqList.join(', ')}` : eqList.join(', '),
          isNew: !(profile?.equipment || []).length,
          action: {
            type: 'UPDATE_PROFILE',
            payload: Array.isArray(p.addEquipment) ? { addEquipment: eqList } : { equipment: eqList },
          },
        });
      }
      if (p.goal && GOAL_PROFILES[GOAL_ALIASES[normalizeKey(p.goal)]]) {
        const mapped = GOAL_ALIASES[normalizeKey(p.goal)];
        pushItem({
          label: 'Objectif principal',
          oldValue: GOAL_PROFILES[profile?.goal]?.label || profile?.goal || 'Non renseigné',
          newValue: GOAL_PROFILES[mapped].label,
          isNew: !profile?.goal,
          action: { type: 'UPDATE_PROFILE', payload: { goal: mapped } },
        });
      }
      continue;
    }

    if (type === 'APPLY_PHYSIQUE_ASSESSMENT') {
      const lags = (p.lagPriorities || []).filter((g) => MUSCLE_GROUPS[g]);
      pushItem({
        label: 'Adapter le programme au bilan physique',
        oldValue: 'Programme actuel',
        newValue: lags.length ? `Priorité [LAG] : ${lags.map((g) => MUSCLE_GROUPS[g].label).join(', ')}` : 'Ajustement biomécanique',
        isNew: false,
        action: { type: 'APPLY_PHYSIQUE_ASSESSMENT', payload: p },
      });
      continue;
    }

    if (type === 'LOG_MEAL') {
      const normalized = normalizeMealVisionPayload({
        dishName: p.label || p.dishName || p.name,
        confidence: p.confidence || 'medium',
        hiddenFatsWarning: p.hiddenFatsWarning,
        ingredients: Array.isArray(p.ingredients) && p.ingredients.length > 0
          ? p.ingredients
          : [
              {
                name: p.label || p.name || 'Plat détecté',
                state: 'cuit',
                grams: Number(p.grams) || 300,
                kcal: Number(p.kcal) || 0,
                protein: Number(p.protein ?? p.proteinG) || 0,
                carbs: Number(p.carbs ?? p.carbsG) || 0,
                fat: Number(p.fat ?? p.fatG) || 0,
                fiber: Number(p.fiber ?? p.fiberG) || 0,
              },
            ],
      });
      mealPreview = normalized;
      pushItem({
        label: `Ajouter repas : ${normalized.dishName}`,
        oldValue: 'Non journalisé',
        newValue: `${normalized.totals.kcal} kcal · P ${normalized.totals.protein_g}g · G ${normalized.totals.carbs_g}g · L ${normalized.totals.fat_g}g`,
        isNew: true,
        action: {
          type: 'LOG_MEAL',
          payload: {
            label: normalized.dishName,
            kcal: normalized.totals.kcal,
            protein: normalized.totals.protein_g,
            carbs: normalized.totals.carbs_g,
            fat: normalized.totals.fat_g,
            fiber: normalized.totals.fiber_g,
            ingredients: normalized.ingredients,
            mealSlot: p.mealSlot || 'Photo Coach',
          },
        },
      });
      continue;
    }

    if (type === 'SAVE_CUSTOM_FOOD') {
      const kcal = Math.round(Number(p.kcal) || 0);
      pushItem({
        label: `Enregistrer aliment perso : ${p.name || 'Produit'}`,
        oldValue: 'Absent des aliments perso',
        newValue: `${kcal} kcal/100g · P ${p.protein ?? p.proteinG ?? 0}g · G ${p.carbs ?? p.carbsG ?? 0}g · L ${p.fat ?? p.fatG ?? 0}g`,
        isNew: true,
        action: { type: 'SAVE_CUSTOM_FOOD', payload: p },
      });
      continue;
    }

    if (type === 'SWAP_EXERCISE') {
      pushItem({
        label: p.painZone ? `Adapter programme (protection ${PAIN_ZONE_LABELS[p.painZone] || p.painZone})` : 'Remplacer un exercice',
        oldValue: p.fromExerciseId || 'Programme actuel',
        newValue: p.toExerciseId || `Variantes sûres (${PAIN_ZONE_LABELS[p.painZone] || p.painZone})`,
        isNew: false,
        action: { type: 'SWAP_EXERCISE', payload: p },
      });
      continue;
    }

    if (type === 'SAVE_COACH_MEMORY') {
      const txt = String(p.text || '').trim();
      if (txt.length >= 3) {
        pushItem({
          label: 'Mémoriser un repère Coach',
          oldValue: 'Absent de la mémoire',
          newValue: txt,
          isNew: true,
          action: { type: 'SAVE_COACH_MEMORY', payload: p },
        });
      }
      continue;
    }

    if (type === 'SET_NUTRITION_TARGETS') {
      pushItem({
        label: 'Mettre à jour cibles nutritionnelles',
        oldValue: 'Cibles actuelles',
        newValue: `${p.kcal || '--'} kcal`,
        isNew: false,
        action: { type: 'SET_NUTRITION_TARGETS', payload: p },
      });
    }
  }

  if (items.length === 0) return null;

  return {
    id: `prop_${Date.now().toString(36)}`,
    title: 'Mises à jour détectées depuis ta photo',
    status: 'pending', // 'pending' | 'applied' | 'ignored'
    items,
    mealPreview,
  };
}

/**
 * Construit la même proposition sélective pour la passerelle Labo Physique -> Profil.
 */
export function buildLaboProfileProposal(analysis, profile = {}, latestBiometrics = null) {
  if (!analysis || typeof analysis !== 'object') return null;

  const actions = [];
  const updatePayload = {};
  const morphPatch = {};

  if (analysis.morphotype) {
    morphPatch.morphotype = analysis.morphotype;
  }
  const seg = analysis.segment_proportions || {};
  for (const key of ['femurTorsoRatio', 'armSpanRatio', 'claviclePelvisRatio', 'ribcageType']) {
    if (seg[key]) morphPatch[key] = seg[key];
  }
  const flagCodes = analysis.posture?.flag_codes || [];
  if (Array.isArray(flagCodes) && flagCodes.length > 0) {
    morphPatch.postureFlags = flagCodes;
  }
  if (Object.keys(morphPatch).length > 0) {
    updatePayload.morphology = morphPatch;
  }

  if (typeof analysis.estimated_body_fat_pct === 'number' && analysis.estimated_body_fat_pct >= 4 && analysis.estimated_body_fat_pct <= 55) {
    updatePayload.bodyFatPct = analysis.estimated_body_fat_pct;
  }

  const lags = (analysis.muscle_scores || []).filter((m) => m.status === 'LAG').map((m) => m.group);
  const doms = (analysis.muscle_scores || []).filter((m) => m.status === 'DOMINANT').map((m) => m.group);
  if (lags.length > 0) updatePayload.lagPriorities = lags;
  if (doms.length > 0) updatePayload.dominantGroups = doms;
  if (Array.isArray(analysis.asymmetries) && analysis.asymmetries.length > 0) {
    updatePayload.asymmetries = analysis.asymmetries;
  }

  if (Object.keys(updatePayload).length > 0) {
    actions.push({ type: 'UPDATE_PROFILE', payload: updatePayload });
  }

  if (analysis.posture?.flags?.length) {
    actions.push({
      type: 'SAVE_COACH_MEMORY',
      payload: {
        category: 'posture',
        text: `Bilan Labo : ${analysis.posture.flags.slice(0, 2).join(' ; ')}`.slice(0, 175),
      },
    });
  }

  const prop = buildPhotoUpdateProposal(actions, { profile, latestBiometrics });
  if (!prop) return null;
  prop.title = 'Mettre à jour ton profil depuis le Labo Physique';
  return prop;
}

/**
 * Compile uniquement les actions cochées par l'utilisateur dans une carte de confirmation sélective.
 */
export function compileSelectedProposalActions(proposal, selectedIds = []) {
  if (!proposal || !Array.isArray(proposal.items)) return [];
  const allowed = new Set(selectedIds);
  const selectedItems = proposal.items.filter((it) => allowed.has(it.id) && it.action);
  return selectedItems.map((it) => it.action);
}
