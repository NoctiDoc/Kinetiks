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
import { repairAndParseJSON } from './ai-router.js';
import { EXERCISES_DB, getExerciseById } from './exercises-db.js';
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

  return `Tu es le Coach IA Biomécanique & Nutritionnel de Kinetix Lab. Tu réponds en français concis, structuré (puces courtes, chiffres précis, zéro blabla).
Tu as un VÉRITABLE contrôle lecture + écriture sur la base de données locale de l'application via un bloc d'actions JSON.

=== RÈGLE CRITIQUE ANTI-BLUFF ===
Tu n'as JAMAIS le droit d'affirmer avoir modifié la nutrition, le programme, un exercice, le profil, un repas ou ta mémoire SANS émettre le bloc d'actions JSON correspondant à la toute fin de ta réponse.
Si l'utilisateur demande une modification (ou te donne une information durable à retenir comme une douleur, un objectif, une préférence), tu DOIS inclure le bloc JSON exact ci-dessous. Si tu réponds à une simple question informative sans rien modifier, n'émets aucun bloc JSON.

=== ÉTAT TEMPS RÉEL DE L'ATHLÈTE ===
- Profil : ${profile?.name || 'Athlète'}, ${profile?.sex || 'male'}, ${profile?.age || 28} ans, ${profile?.heightCm || 176} cm, ${profile?.weightKg || 75} kg (Masse maigre est. ${macros.leanMassKg} kg)
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

=== FORMAT STRICT DES ACTIONS EXÉCUTABLES ===
Quand tu modifies l'application, termine TOUJOURS ta réponse par ce bloc EXACT (JSON valide, tableau d'objets) :
${ACTIONS_START_MARKER}
[{"type": "NOM_ACTION", "payload": {...}}]
${ACTIONS_END_MARKER}

Catalogue des actions supportées :
1. SET_NUTRITION_TARGETS : {"kcal": 2450, "protein": 185, "carbs": 245, "fat": 78, "hydrationMl": 3000, "resetAdaptiveAdjustment": true, "lockOverride": true}
   (Note : tu peux ne fournir que "kcal" ; les macros cohérentes seront calculées automatiquement.)
2. RESET_NUTRITION_AUTO : {}
   (Supprime la surcharge manuelle/Coach, remet adaptiveAdjustmentKcal à 0 et recalcule depuis le TDEE.)
3. RESET_EWMA_BASELINE : {"weightKg": 82.0}
   (Réinitialise la série EWMA à partir d'aujourd'hui pour supprimer toute dérive erronée.)
4. LOG_MEAL : {"label": "Poulet riz brocolis", "kcal": 620, "protein": 48, "carbs": 72, "fat": 14, "mealSlot": "Déjeuner"}
5. DELETE_LAST_MEAL : {}
6. UPDATE_PROFILE : {"goal": "fat_loss|recomp|lean_bulk|hypertrophy|strength|health_posture", "weight": 82, "bodyFat": 16, "activityLevel": "sedentary|mixed|active", "sessionsPerWeek": 4, "sessionDuration": 60, "equipment": ["barbell","dumbbells","cables","machines","bench","pullup_bar"], "diet": "omnivore|vegetarian|vegan|pescatarian|halal|gluten_free", "allergies": ["dairy"], "injuries": [{"zone":"shoulder","severity":2}]}
7. MUTATE_PROGRAM : {"split": "full_body|upper_lower|ppl|hybrid|arnold|bro_split", "method": "double_progression|reverse_pyramid|top_set_backoff|classic_pyramid|rest_pause|dup", "sessionsPerWeek": 3, "sessionDurationMin": 45, "phase": "calibration|accumulation|intensification|deload", "preservationMode": true, "setsDelta": -1, "repsDelta": 2, "rirDelta": 1, "regenerate": true}
8. SWAP_EXERCISE : {"fromExerciseId": "id_existant", "toExerciseId": "id_valide_ci_dessous"} OU {"painZone": "shoulder|lumbar|knee|elbow|wrist|neck"} pour filtrer automatiquement tous les exercices incompatibles avec une douleur.
9. SAVE_COACH_MEMORY : {"text": "Préfère les haltères au squat barre", "category": "preference|pain|nutrition|training"}
10. REMOVE_COACH_MEMORY : {"id": "mem_xxx"} ou {"match": "texte à oublier"}

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
    try {
      parsed = repairAndParseJSON(jsonSegment);
    } catch (err) {
      parseError = err?.message || 'JSON d’actions invalide';
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
        const label = String(payload.label || payload.name || 'Repas Coach').trim().slice(0, 80);
        const kcal = Math.max(0, Math.round(Number(payload.kcal ?? payload.calories) || 0));
        const proteinG = Math.max(0, Math.round((Number(payload.protein ?? payload.proteinG) || 0) * 10) / 10);
        const carbsG = Math.max(0, Math.round((Number(payload.carbs ?? payload.carbsG) || 0) * 10) / 10);
        const fatG = Math.max(0, Math.round((Number(payload.fat ?? payload.fatG) || 0) * 10) / 10);
        const computedKcal = kcal || Math.round(proteinG * 4 + carbsG * 4 + fatG * 9);

        if (computedKcal <= 0 && proteinG <= 0) {
          errors.push('LOG_MEAL ignoré : valeurs nutritionnelles vides.');
          continue;
        }

        const saved = await db.saveNutritionLog(curProfile.id, {
          date: todayISO,
          label,
          mealSlot: String(payload.mealSlot || 'Coach IA'),
          kcal: computedKcal,
          proteinG,
          carbsG,
          fatG,
          source: 'coach_ai',
        });
        snapshot.addedMealIds.push(saved.id);
        curNutritionToday = [saved, ...curNutritionToday];
        changedModules.add('nutrition');
        executedBadges.push(`EXÉCUTÉ · Repas ajouté : ${label} (${computedKcal} kcal)`);
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
          patch.equipment = payload.equipment.map((e) => String(e).trim()).filter(Boolean);
          changedLabels.push('Matériel');
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

        const newBf = Number(payload.bodyFat ?? payload.bodyFatPct);
        if (Number.isFinite(newBf) && newBf >= 4 && newBf <= 55) {
          await db.saveBiometric(curProfile.id, {
            date: todayISO,
            weightKg: patch.weightKg || curProfile.weightKg,
            bodyFatPct: Number(newBf.toFixed(1)),
            source: 'coach_ai',
          });
          snapshot.biometricsModified = true;
          changedLabels.push(`MG ${newBf.toFixed(1)}%`);
        }

        if (Object.keys(patch).length > 0) {
          curProfile = await db.updateProfile(curProfile.id, patch);
          snapshot.profileModified = true;
          changedModules.add('profile');
          changedModules.add('nutrition');
        }
        if (shouldRebuildProgram) {
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
