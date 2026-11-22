/**
 * Kinetix Lab — Routeur IA Unifié à 4 Niveaux + Validateur JSON Strict (js/ai-router.js)
 *
 * Niveau 0 : Local Offline Déterministe (0 réseau, 0 clé, toujours actif en filet de sécurité)
 * Niveau 1 : Cloud Gratuit Sans Clé (Puter.js par défaut + secours Pollinations.ai avec garde-fou photos corporelles)
 * Niveau 2 : Connecteur Universel BYO OpenAI-Compatible (/v1/chat/completions) + Gemini natif
 *            Préréglages 1-clic : Ollama, LM Studio, Groq (+ Whisper audio), OpenRouter (:free), Gemini
 * Niveau 3 : LLM Local Embarqué dans le Navigateur (WebLLM / Transformers.js via WebGPU/WASM + alerte RAM iOS)
 *
 * Couche obligatoire : Parseur/Réparateur JSON tolérant + Validateur de schéma strict vérifiant les exercise_id.
 */

export const AI_TIERS = Object.freeze({
  TIER_0_LOCAL: 0,
  TIER_1_FREE_CLOUD: 1,
  TIER_2_BYO: 2,
  TIER_3_WEBLLM: 3,
});

export const TIER2_PRESETS = Object.freeze({
  ollama: {
    id: 'ollama',
    label: 'Ollama (Local / Tunnel)',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    visionModel: 'qwen2.5vl:7b',
    requiresApiKey: false,
    supportsVision: true,
    supportsWhisper: false,
    corsNote:
      'Lancez Ollama avec OLLAMA_ORIGINS="*" (ex. OLLAMA_ORIGINS="*" ollama serve). Depuis un téléphone en HTTPS (GitHub Pages), utilisez un tunnel HTTPS Tailscale Funnel ou Cloudflare Tunnel pour éviter le blocage Mixed Content.',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (Local)',
    protocol: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    visionModel: 'local-vision-model',
    requiresApiKey: false,
    supportsVision: true,
    supportsWhisper: false,
    corsNote:
      'Activez "Enable CORS" dans l’onglet Local Server de LM Studio. Utilisez un tunnel HTTPS depuis mobile.',
  },
  groq: {
    id: 'groq',
    label: 'Groq (Tier gratuit + Whisper)',
    protocol: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    whisperModel: 'whisper-large-v3',
    requiresApiKey: true,
    supportsVision: true,
    supportsWhisper: true,
    corsNote: 'CORS natif navigateur. Clé API gratuite sur console.groq.com. Inclut la dictée vocale Whisper.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (Modèles :free)',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    visionModel: 'qwen/qwen2.5-vl-72b-instruct:free',
    requiresApiKey: true,
    supportsVision: true,
    supportsWhisper: false,
    corsNote: 'CORS natif navigateur. Prise en charge directe des identifiants se terminant par :free.',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini (API Native)',
    protocol: 'gemini_native',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    visionModel: 'gemini-2.5-flash',
    requiresApiKey: true,
    supportsVision: true,
    supportsWhisper: false,
    corsNote:
      'CORS natif navigateur via x-goog-api-key. Compatible clés AQ. (Google AI Studio) et AIza…. Si HTTP 401 : vérifiez que "Generative Language API" est bien autorisée dans Google Cloud Console → Credentials.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (GPT-4o mini / GPT-4o)',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
    requiresApiKey: true,
    supportsVision: true,
    supportsWhisper: false,
    corsNote: 'CORS natif navigateur. Clé API OpenAI (commence par sk-). Texte + Vision.',
  },
  custom: {
    id: 'custom',
    label: 'Endpoint OpenAI Personnalisé',
    protocol: 'openai',
    baseUrl: '',
    model: '',
    visionModel: '',
    requiresApiKey: false,
    supportsVision: true,
    supportsWhisper: false,
    corsNote: 'Tout serveur exposant /v1/chat/completions avec en-têtes CORS autorisés.',
  },
});

/**
 * Détecte automatiquement le fournisseur probable d'une clé API collée
 * (simple aide au pré-remplissage — aucun préfixe n'est jamais bloqué).
 */
export function detectPresetFromApiKey(rawKey) {
  const key = String(rawKey || '').replace(/[\r\n\t\s"'`]+/g, '');
  if (!key || key.length < 16) return null;
  if (key.startsWith('AQ.') || key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('sk-')) return 'openai';
  return null;
}

export const TIER3_MODELS = Object.freeze([
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 1.5B (WebGPU — ~1.1 Go)',
    backend: 'webllm',
    supportsVision: false,
    minRamGb: 4,
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B (WebGPU — ~0.9 Go)',
    backend: 'webllm',
    supportsVision: false,
    minRamGb: 4,
  },
  {
    id: 'HuggingFaceTB/SmolVLM-256M-Instruct',
    label: 'SmolVLM 256M (Transformers.js WASM/WebGPU)',
    backend: 'transformers',
    supportsVision: true,
    minRamGb: 3,
  },
]);

export const DEFAULT_AI_SETTINGS = Object.freeze({
  activeTier: AI_TIERS.TIER_1_FREE_CLOUD,
  tier1Provider: 'puter', // 'puter' | 'pollinations'
  allowPublicBodyPhotos: false, // Garde-fou confidentialité strict par défaut
  tier2Preset: 'ollama',
  protocol: 'openai',
  baseUrl: TIER2_PRESETS.ollama.baseUrl,
  model: TIER2_PRESETS.ollama.model,
  visionModel: TIER2_PRESETS.ollama.visionModel,
  apiKey: '',
  groqWhisperEnabled: false,
  tier3ModelId: TIER3_MODELS[0].id,
  tier3AcceptedRamWarning: false,
});

export function normalizeAISettings(saved = null) {
  return { ...DEFAULT_AI_SETTINGS, ...(saved || {}) };
}

/* ==========================================================================
   REGISTRE DES IDENTIFIANTS D'EXERCICES VALIDES (ANTI-HALLUCINATION)
   Alimenté automatiquement par js/exercises-db.js en Phase 2.
   ========================================================================== */

const validExerciseIdRegistry = new Set([
  'incline_db_press',
  'flat_db_press',
  'machine_chest_press',
  'cable_fly_low_to_high',
  'barbell_bench_press',
  'weighted_dips',
  'lat_pulldown_neutral',
  'chest_supported_row',
  'single_arm_db_row',
  'seated_cable_row_wide',
  'pull_up_assisted',
  'straight_arm_pulldown',
  'db_lateral_raise',
  'cable_lateral_raise',
  'rear_delt_cable_fly',
  'seated_db_overhead_press',
  'face_pull',
  'leg_press_45',
  'hack_squat_machine',
  'bulgarian_split_squat',
  'romanian_deadlift_db',
  'seated_leg_curl',
  'lying_leg_curl',
  'leg_extension',
  'hip_thrust_barbell',
  'standing_calf_raise',
  'seated_calf_raise',
  'incline_db_curl',
  'cable_hammer_curl',
  'overhead_cable_triceps_ext',
  'triceps_rope_pushdown',
  'cable_crunch',
  'dead_bug_weighted',
]);

export function registerValidExerciseIds(ids) {
  if (!ids) return;
  validExerciseIdRegistry.clear();
  for (const id of ids) {
    if (typeof id === 'string' && id.trim()) {
      validExerciseIdRegistry.add(id.trim());
    }
  }
}

export function getValidExerciseIds() {
  return new Set(validExerciseIdRegistry);
}

/* ==========================================================================
   PARSEUR / RÉPARATEUR JSON TOLÉRANT (POUR PETITS MODÈLES 1.5B–7B & GRATUITS)
   ========================================================================== */

function extractBalancedJsonBlock(text) {
  const startObj = text.indexOf('{');
  const startArr = text.indexOf('[');
  let start = -1;
  let openChar = '{';
  let closeChar = '}';

  if (startObj !== -1 && (startArr === -1 || startObj < startArr)) {
    start = startObj;
    openChar = '{';
    closeChar = '}';
  } else if (startArr !== -1) {
    start = startArr;
    openChar = '[';
    closeChar = ']';
  }

  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  // Bloc tronqué : on tente une fermeture minimale
  if (depth > 0) {
    return text.slice(start) + closeChar.repeat(depth);
  }
  return null;
}

function sanitizeJsonCandidate(candidate) {
  let s = candidate
    // Guillemets typographiques -> droits
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    // Commentaires JS hors chaînes simples
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Virgules traînantes avant } ou ]
    .replace(/,\s*([}\]])/g, '$1')
    // Valeurs NaN / Infinity non conformes JSON
    .replace(/:\s*NaN\b/g, ': null')
    .replace(/:\s*undefined\b/g, ': null');

  // Échappement des retours à la ligne bruts à l'intérieur des chaînes JSON
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === '\\') {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        // ignore CR
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out.trim();
}

export function repairAndParseJSON(rawText) {
  if (rawText && typeof rawText === 'object') {
    return { ok: true, data: rawText, repaired: false };
  }
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { ok: false, error: 'Réponse vide.' };
  }

  // 1. Retrait des balises de raisonnement (<think>...</think>) et fences Markdown
  let cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();

  const fenceMatch = cleaned.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  }

  // 2. Tentative directe
  try {
    return { ok: true, data: JSON.parse(cleaned), repaired: cleaned !== rawText.trim() };
  } catch {
    // Poursuit vers la réparation
  }

  // 3. Extraction du bloc équilibré + nettoyage syntaxique
  const extracted = extractBalancedJsonBlock(cleaned);
  if (!extracted) {
    return { ok: false, error: 'Aucun bloc JSON détecté dans la réponse.' };
  }

  const sanitized = sanitizeJsonCandidate(extracted);
  try {
    return { ok: true, data: JSON.parse(sanitized), repaired: true };
  } catch (err) {
    return {
      ok: false,
      error: `Échec réparation JSON : ${err.message}`,
      candidate: sanitized.slice(0, 260),
    };
  }
}

/* ==========================================================================
   VALIDATEUR DE SCHÉMA STRICT (INCLUANT CONTRÔLE exercise_id)
   ========================================================================== */

const MUSCLE_STATUS_VALUES = new Set(['LAG', 'BALANCED', 'DOMINANT']);

export function validateStructuredOutput(taskType, data, customValidIds = null) {
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Payload JSON nul ou non-objet.'] };
  }

  const validIds = customValidIds instanceof Set ? customValidIds : validExerciseIdRegistry;
  const errors = [];

  if (taskType === 'physique_analysis') {
    if (!Array.isArray(data.muscle_scores) || data.muscle_scores.length === 0) {
      errors.push('muscle_scores doit être un tableau non vide.');
    } else {
      for (const m of data.muscle_scores) {
        if (!m || typeof m.group !== 'string') {
          errors.push('Entrée muscle_scores sans propriété group.');
          break;
        }
        if (!MUSCLE_STATUS_VALUES.has(String(m.status || '').toUpperCase())) {
          errors.push(`Statut invalide pour ${m.group} (attendu LAG | BALANCED | DOMINANT).`);
          break;
        }
      }
    }
    if (!Array.isArray(data.asymmetries)) {
      errors.push('asymmetries doit être un tableau.');
    }
    if (!data.posture || typeof data.posture !== 'object') {
      errors.push('posture doit être un objet.');
    }
  } else if (taskType === 'meal_analysis') {
    if (!Array.isArray(data.items) || data.items.length === 0) {
      errors.push('items doit contenir au moins un aliment détecté.');
    }
    const totals = data.totals || {};
    for (const key of ['kcal', 'protein_g', 'carbs_g', 'fat_g']) {
      if (typeof totals[key] !== 'number' || Number.isNaN(totals[key]) || totals[key] < 0) {
        errors.push(`totals.${key} doit être un nombre positif.`);
      }
    }
  } else if (taskType === 'scale_ocr') {
    if (typeof data.weight_kg !== 'number' || data.weight_kg < 25 || data.weight_kg > 300) {
      errors.push('weight_kg hors plage physiologique (25–300 kg).');
    }
  } else if (taskType === 'program_mutation' || taskType === 'workout_swap') {
    const candidates = [];
    if (Array.isArray(data.exercise_changes)) {
      for (const ch of data.exercise_changes) {
        if (ch.exercise_id) candidates.push(ch.exercise_id);
        if (ch.replacement_exercise_id) candidates.push(ch.replacement_exercise_id);
      }
    }
    if (Array.isArray(data.exercises)) {
      for (const ex of data.exercises) {
        if (ex.exercise_id) candidates.push(ex.exercise_id);
      }
    }
    if (typeof data.replacement_exercise_id === 'string') {
      candidates.push(data.replacement_exercise_id);
    }

    if (candidates.length === 0) {
      errors.push('Aucun exercise_id référencé dans la mutation.');
    } else {
      for (const id of candidates) {
        if (!validIds.has(id)) {
          errors.push(`exercise_id halluciné ou inconnu : "${id}" absent de exercises-db.js.`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/* ==========================================================================
   NIVEAU 0 — MOTEUR EXPERT LOCAL DÉTERMINISTE (0 RÉSEAU, 0 CLÉ)
   ========================================================================== */

function runTier0PhysiqueAnalysis(context = {}) {
  const ratios = context.segmentRatios || {};
  const posture = context.postureMetrics || {};
  const shoulderHip = Number(ratios.shoulderToHipRatio) || 1.32;
  const femurTibia = Number(ratios.femurToTibiaRatio) || 1.04;
  const armSpanRatio = Number(ratios.armSpanToHeightRatio) || 1.01;
  const shoulderTiltDeg = Number(posture.shoulderTiltDeg) || 0;
  const pelvicTiltDeg = Number(posture.pelvicTiltDeg) || 0;
  const forwardHeadDeg = Number(posture.forwardHeadDeg) || 0;

  const muscleScores = [
    { group: 'pecs_upper', label: 'Pectoraux haut', score: shoulderHip < 1.28 ? 58 : 74, status: shoulderHip < 1.28 ? 'LAG' : 'BALANCED' },
    { group: 'pecs_lower', label: 'Pectoraux bas', score: 75, status: 'BALANCED' },
    { group: 'delts_ant', label: 'Deltoïdes antérieurs', score: 80, status: 'DOMINANT' },
    { group: 'delts_lat', label: 'Deltoïdes latéraux', score: shoulderHip < 1.34 ? 56 : 74, status: shoulderHip < 1.34 ? 'LAG' : 'BALANCED' },
    { group: 'delts_post', label: 'Deltoïdes postérieurs', score: forwardHeadDeg > 12 ? 54 : 68, status: forwardHeadDeg > 12 ? 'LAG' : 'BALANCED' },
    { group: 'lats_width', label: 'Grand dorsal (largeur)', score: shoulderHip < 1.32 ? 60 : 76, status: shoulderHip < 1.32 ? 'LAG' : 'BALANCED' },
    { group: 'traps_rhomboids', label: 'Trapèzes & Rhomboïdes', score: forwardHeadDeg > 10 ? 58 : 74, status: forwardHeadDeg > 10 ? 'LAG' : 'BALANCED' },
    { group: 'quads', label: 'Quadriceps', score: femurTibia > 1.12 ? 62 : 76, status: femurTibia > 1.12 ? 'LAG' : 'BALANCED' },
    { group: 'hamstrings', label: 'Ischio-jambiers', score: pelvicTiltDeg > 10 ? 60 : 73, status: pelvicTiltDeg > 10 ? 'LAG' : 'BALANCED' },
    { group: 'glutes', label: 'Fessiers', score: 74, status: 'BALANCED' },
    { group: 'calves', label: 'Mollets', score: 68, status: 'BALANCED' },
    { group: 'biceps', label: 'Biceps', score: 75, status: 'BALANCED' },
    { group: 'triceps', label: 'Triceps', score: 76, status: 'BALANCED' },
    { group: 'abs', label: 'Sangle abdominale', score: pelvicTiltDeg > 10 ? 61 : 74, status: pelvicTiltDeg > 10 ? 'LAG' : 'BALANCED' },
  ];

  const asymmetries = [];
  if (Math.abs(shoulderTiltDeg) >= 2.2) {
    const lowSide = shoulderTiltDeg > 0 ? 'droite' : 'gauche';
    asymmetries.push({
      zone: 'Ceinture scapulaire',
      delta_deg: Number(Math.abs(shoulderTiltDeg).toFixed(1)),
      description: `Épaule ${lowSide} plus basse (${Math.abs(shoulderTiltDeg).toFixed(1)}°). Prioriser tirages et élévations unilatérales en démarrant côté faible.`,
      action: 'inject_unilateral',
    });
  }

  const postureFlags = [];
  if (forwardHeadDeg > 12) postureFlags.push('Projection antérieure de la tête (renforcer fléchisseurs profonds + deltoïdes postérieurs)');
  if (pelvicTiltDeg > 10) postureFlags.push('Tendance antéversion pelvienne (renforcer abdos anti-extension + ischios)');
  if (femurTibia > 1.12) postureFlags.push('Fémurs longs détectés : privilégier presse inclinée / hack squat pour limiter la flexion lombaire');
  if (armSpanRatio > 1.04) postureFlags.push('Envergure longue : privilégier haltères et machines convergentes sur les poussées');

  return {
    source: 'tier0_local_mediapipe',
    muscle_scores: muscleScores,
    asymmetries,
    posture: {
      shoulder_tilt_deg: Number(shoulderTiltDeg.toFixed(1)),
      pelvic_tilt_deg: Number(pelvicTiltDeg.toFixed(1)),
      forward_head_deg: Number(forwardHeadDeg.toFixed(1)),
      femur_tibia_ratio: Number(femurTibia.toFixed(2)),
      shoulder_hip_ratio: Number(shoulderHip.toFixed(2)),
      arm_span_ratio: Number(armSpanRatio.toFixed(2)),
      flags: postureFlags.length > 0 ? postureFlags : ['Alignement postural global dans les normes fonctionnelles.'],
    },
    visual_evolution_summary:
      'Analyse biomécanique calculée 100 % localement à partir des 33 landmarks MediaPipe (zéro image transférée sur le réseau).',
  };
}

function runTier0ProgramMutation(context = {}) {
  const lags = Array.isArray(context.lagGroups) && context.lagGroups.length > 0
    ? context.lagGroups
    : ['delts_lat', 'pecs_upper'];
  const exerciseChanges = [];

  if (lags.includes('delts_lat')) {
    exerciseChanges.push({
      exercise_id: 'cable_lateral_raise',
      action: 'front_load_and_add_sets',
      delta_sets: 3,
      reason: 'Groupe [LAG] : placé en début de séance avec +3 séries/semaine.',
    });
  }
  if (lags.includes('pecs_upper')) {
    exerciseChanges.push({
      exercise_id: 'incline_db_press',
      action: 'front_load_and_add_sets',
      delta_sets: 2,
      reason: 'Pectoraux haut [LAG] : priorité nerveuse et surcharge progressive.',
    });
  }
  if (lags.includes('lats_width')) {
    exerciseChanges.push({
      exercise_id: 'lat_pulldown_neutral',
      action: 'front_load_and_add_sets',
      delta_sets: 3,
      reason: 'Largeur dorsale [LAG] : fréquence augmentée à 2-3x/semaine.',
    });
  }
  if (exerciseChanges.length === 0) {
    exerciseChanges.push({
      exercise_id: 'chest_supported_row',
      action: 'maintain_mav',
      delta_sets: 2,
      reason: 'Réallocation vers le volume optimal adaptatif (MAV).',
    });
  }

  return {
    source: 'tier0_deterministic_engine',
    exercise_changes: exerciseChanges,
    dominant_reductions: (context.dominantGroups || ['delts_ant']).map((g) => ({
      group: g,
      target_volume: 'MEV',
      delta_sets: -2,
    })),
    summary: 'Mutation générée localement par le moteur biomécanique déterministe (Niveau 0).',
  };
}

function runTier0CoachReply(prompt = '', context = {}) {
  const raw = String(prompt || '');
  const lower = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const profile = context.profile || {};
  const summary = context.trainingSummary || {};
  const action = context.actionProposal || null;
  const name = profile.name || 'Athlète';

  const actionSuffix = action
    ? `\n\n→ Adaptation prête ci-dessous : ${action.summary}. Appuie sur « ${action.applyLabel} » pour reconstruire ton programme immédiatement.`
    : '';

  if (/(pyramidal\s*invers|reverse\s*pyramid|\brpt\b)/.test(lower)) {
    return `${name}, le pyramidal inversé (RPT) est redoutable pour préserver la force et limiter le volume inutile :\n• Série 1 (TOP) : charge maximale sur ta fraîcheur nerveuse (ex. 5–7 réps à RIR 1).\n• Série 2 (-10 %) : +2 répétitions avec contrôle technique.\n• Série 3 (-15 à -18 %) : +4 répétitions pour le stress métabolique.\nTa progression est pilotée uniquement par le Top Set : dès que la série 1 atteint son plafond, toutes les séries suivantes montent automatiquement.${actionSuffix}`;
  }

  if (/(top\s*set|back[\s-]*off|pyramidal|rest[\s-]*pause|myo[\s-]*reps?|ondulatoire|\bdup\b)/.test(lower)) {
    return `${name}, Kinetix Lab gère nativement 6 méthodes de progression :\n• Double progression (séries fixes)\n• Pyramidal inversé (RPT : Top Set lourd puis -10 % / -18 %)\n• Top Set + Back-off (-12 % volume contrôlé)\n• Pyramidal montant (80 → 90 → 100 %)\n• Rest-Pause / Myo-Reps (densité rapide sur isolations)\n• Ondulatoire DUP (alternance séances Force / Hypertrophie / Métabolique).\nChaque méthode recalcule automatiquement tes charges et cibles de répétitions série par série.${actionSuffix}`;
  }

  if (/(full\s*body|upper\s*\/?\s*lower|ppl|push\s*pull|arnold|bro\s*split|split)/.test(lower)) {
    return `${name}, tu peux changer de split à tout moment selon ta récupération et ton agenda :\n• Full Body (2–4 j) : stimulation fréquente, top si séances limitées ou priorité force.\n• Upper / Lower (4 j) : meilleur compromis volume/récupération (2×/muscle/semaine).\n• PPL (3 ou 6 j) : spécialisation poussée / tirage / jambes.\n• Hybride UL + PPL (5 j), Arnold Split (Pecs-Dos / Épaules-Bras / Jambes) ou Split classique (4–5 j).\nSplit actuel : ${summary.activeSplitLabel || 'adaptatif'} · Méthode : ${summary.activeMethodLabel || 'Double progression'}.${actionSuffix}`;
  }

  if (/(douleur|epaule|lombaire|genou|coude|poignet|mal|pincement|tendinite)/.test(lower)) {
    const recentPain = summary.painExercises?.length
      ? `\nDouleurs déjà notées en séance : ${summary.painExercises.join(', ')}.`
      : '';
    return `${name}, en présence d’une gêne articulaire : réduis la charge de 10 à 15 % ou utilise le bouton Swap biomécanique pour une variante sans contrainte (ex. presse inclinée / hack squat pour préserver les lombaires, haltères prise neutre ou machine convergente pour les épaules).${recentPain}${actionSuffix}`;
  }

  if (/(plateau|poids|calorie|tdee|seche|prise\s*de\s*masse)/.test(lower)) {
    return `${name}, ne juge jamais sur une pesée isolée : suis la courbe EWMA sur 14 à 21 jours. Si elle stagne malgré une journalisation fiable, ajuste de ±100 à 150 kcal (surtout via les glucides péri-entraînement) en gardant les protéines entre 1,8 et 2,2 g/kg et les lipides >= 0,7 g/kg.${actionSuffix}`;
  }

  if (/(deload|fatigue|sommeil|readiness|creve|epuise)/.test(lower)) {
    const rdTxt = summary.readinessAvg ? `Ton Readiness moyen récent est de ${summary.readinessAvg}/100.` : '';
    return `${name}, ${rdTxt} Si la fatigue s’accumule ou si tes performances baissent sur 2 séances d’affilée, passe en Mode Préservation (-1 série, +1 RIR) ou déclenche une semaine de Deload (volume réduit de ~45 %, RIR 3) pour relancer la surcompensation.${actionSuffix}`;
  }

  const memLine = summary.memoryItems?.length
    ? `\n• Mémoire active : ${summary.memoryItems.slice(-3).join(' | ')}`
    : '';
  const fbLine = summary.painExercises?.length
    ? `\n• Alerte séances récentes : douleur signalée sur ${summary.painExercises.join(', ')}.`
    : summary.limitExercises?.length
      ? `\n• Exercices en zone limite récents : ${summary.limitExercises.join(', ')}.`
      : '';

  return `[Coach Local Déterministe — Niveau 0]\n${name}, configuration active : ${summary.activeSplitLabel || 'Split adaptatif'} · ${summary.activeMethodLabel || 'Double progression'}.${memLine}${fbLine}\nDis-moi directement si tu veux changer de split (Full Body, Upper/Lower, PPL, Arnold, Split classique), de méthode (Pyramidal inversé RPT, Top Set + Back-off, Myo-Reps, DUP), raccourcir tes séances ou protéger une articulation : je prépare l’adaptation en 1 clic.${actionSuffix}`;
}

export function runTier0Fallback(taskType, prompt, context = {}) {
  switch (taskType) {
    case 'physique_analysis':
      return runTier0PhysiqueAnalysis(context);
    case 'program_mutation':
      return runTier0ProgramMutation(context);
    case 'meal_analysis':
      return {
        source: 'tier0_local_fallback',
        items: [{ name: 'Assiette à confirmer manuellement (hors-ligne)', grams: 350, kcal: 520, protein_g: 36, carbs_g: 52, fat_g: 16 }],
        totals: { kcal: 520, protein_g: 36, carbs_g: 52, fat_g: 16 },
        alignment_score: 75,
        advice: 'Mode hors-ligne actif : utilisez la base Ciqual embarquée ou le scanner code-barres pour un grammage exact.',
      };
    case 'scale_ocr':
      return {
        source: 'tier0_local_fallback',
        weight_kg: Number(context.profile?.weightKg) || 75,
        body_fat_pct: null,
        muscle_mass_kg: null,
        visceral_fat: null,
        hydration_pct: null,
        bmr_kcal: null,
        note: 'OCR indisponible en Niveau 0 hors-ligne. Saisissez la valeur manuellement ou activez le Niveau 1/2 vision.',
      };
    default:
      return runTier0CoachReply(prompt, context);
  }
}

/* ==========================================================================
   NIVEAU 1 — CLOUD GRATUIT SANS CLÉ (PUTER.JS + POLLINATIONS GUARDRAIL)
   ========================================================================== */

let puterLoadPromise = null;

function ensurePuterLoaded() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Environnement navigateur requis.'));
  if (window.puter && window.puter.ai && typeof window.puter.ai.chat === 'function') {
    return Promise.resolve(window.puter);
  }
  if (puterLoadPromise) return puterLoadPromise;

  puterLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-kinetix-puter]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.puter));
      existing.addEventListener('error', () => reject(new Error('Échec chargement Puter.js')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js.puter.com/v2/';
    script.async = true;
    script.dataset.kinetixPuter = 'true';
    const timeout = setTimeout(() => reject(new Error('Délai dépassé pour Puter.js')), 8000);
    script.onload = () => {
      clearTimeout(timeout);
      if (window.puter?.ai?.chat) {
        resolve(window.puter);
      } else {
        reject(new Error('Puter.js chargé mais puter.ai.chat indisponible.'));
      }
    };
    script.onerror = () => {
      clearTimeout(timeout);
      puterLoadPromise = null;
      reject(new Error('Impossible de charger Puter.js (hors-ligne ou bloqué).'));
    };
    document.head.appendChild(script);
  });

  return puterLoadPromise;
}

function extractTextFromPuterResponse(res) {
  if (typeof res === 'string') return res;
  if (res?.message?.content) {
    if (typeof res.message.content === 'string') return res.message.content;
    if (Array.isArray(res.message.content)) {
      return res.message.content.map((part) => part.text || part).join('\n');
    }
  }
  if (typeof res?.text === 'string') return res.text;
  return JSON.stringify(res);
}

function sanitizeHistoryMessages(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 1400) }));
}

async function runPollinationsFallback({ prompt, systemPrompt, history = [], images, taskType, settings }) {
  // Garde-fou confidentialité strict : bloque l'envoi de photos corporelles sur endpoint public
  if (taskType === 'physique_analysis' && images.length > 0 && !settings.allowPublicBodyPhotos) {
    const err = new Error(
      'Confidentialité : envoi de photos corporelles bloqué sur l’endpoint public Pollinations. Bascule locale Niveau 0.'
    );
    err.code = 'PRIVACY_BLOCK_PUBLIC_BODY_PHOTO';
    throw err;
  }

  const userContent =
    images.length > 0
      ? [
          { type: 'text', text: prompt },
          ...images.map((img) => ({ type: 'image_url', image_url: { url: img } })),
        ]
      : prompt;

  const prior = sanitizeHistoryMessages(history);
  const res = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...prior,
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Pollinations HTTP ${res.status}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Réponse Pollinations vide.');
  return { rawText: content, provider: 'pollinations' };
}

async function runTier1FreeCloud({ prompt, systemPrompt, history = [], images, taskType, settings }) {
  const prior = sanitizeHistoryMessages(history);
  const historyTranscript =
    prior.length > 0
      ? `Historique récent de la discussion :\n${prior.map((m) => `${m.role === 'user' ? 'Athlète' : 'Coach'} : ${m.content}`).join('\n')}\n\n`
      : '';
  const fullPrompt = `${systemPrompt ? `${systemPrompt}\n\n` : ''}${historyTranscript}Nouvelle demande : ${prompt}`;

  if (settings.tier1Provider !== 'pollinations') {
    try {
      const puter = await ensurePuterLoaded();
      const response =
        images.length > 0
          ? await puter.ai.chat(fullPrompt, images[0])
          : await puter.ai.chat(fullPrompt);
      return { rawText: extractTextFromPuterResponse(response), provider: 'puter' };
    } catch (puterErr) {
      // Secours Pollinations si autorisé (avec garde-fou photos corporelles)
      if (taskType === 'physique_analysis' && images.length > 0 && !settings.allowPublicBodyPhotos) {
        throw puterErr;
      }
      return runPollinationsFallback({ prompt, systemPrompt, history, images, taskType, settings });
    }
  }

  return runPollinationsFallback({ prompt, systemPrompt, history, images, taskType, settings });
}

/* ==========================================================================
   NIVEAU 2 — CONNECTEUR UNIVERSEL OPENAI-COMPATIBLE & GEMINI NATIF
   ========================================================================== */

function parseDataUri(dataUri) {
  const match = String(dataUri).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function parseProviderErrorMessage(rawBody, fallbackStatus) {
  if (!rawBody) return `HTTP ${fallbackStatus}`;
  try {
    const parsed = JSON.parse(rawBody);
    const msg =
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.detail ||
      (typeof parsed?.error === 'string' ? parsed.error : null);
    if (msg) return String(msg).slice(0, 260);
  } catch {
    // Texte brut
  }
  return String(rawBody).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function cleanApiKey(rawKey) {
  return String(rawKey || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[\r\n\t\s]+/g, '');
}

async function runGeminiNative({ prompt, systemPrompt, history = [], images, settings, expectJson, timeoutMs = 35000 }) {
  const apiKey = cleanApiKey(settings.apiKey);
  if (!apiKey) {
    throw new Error('Clé API Gemini manquante. Collez votre clé Google AI Studio dans Profil → Clés IA.');
  }

  // Toujours cibler l'endpoint natif generativelanguage.googleapis.com (jamais la route /openai qui rejette les clés AQ.)
  const rawBase = (settings.baseUrl || TIER2_PRESETS.gemini.baseUrl)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/openai$/i, '');
  const base = rawBase || TIER2_PRESETS.gemini.baseUrl;
  const rawModel = (images.length > 0 ? settings.visionModel || settings.model : settings.model) || 'gemini-2.5-flash';
  const modelName = rawModel.trim().replace(/^models\//i, '');
  const endpoint = `${base}/models/${encodeURIComponent(modelName)}:generateContent`;

  const parts = [{ text: prompt }];
  for (const img of images) {
    const parsed = parseDataUri(img);
    if (parsed) {
      parts.push({
        inline_data: {
          mime_type: parsed.mimeType,
          data: parsed.base64,
        },
      });
    }
  }

  const priorContents = sanitizeHistoryMessages(history).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    contents: [...priorContents, { role: 'user', parts }],
    generationConfig: {
      temperature: expectJson ? 0.2 : 0.5,
      ...(expectJson ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text();
      const detail = parseProviderErrorMessage(errBody, res.status);
      const err = new Error(`Gemini HTTP ${res.status} : ${detail}`);
      err.httpStatus = res.status;
      err.isGeminiAuth = res.status === 401 || res.status === 403;
      throw err;
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim() || '';
    if (!text) {
      const blockReason = json?.promptFeedback?.blockReason;
      throw new Error(blockReason ? `Réponse Gemini bloquée (${blockReason}).` : 'Réponse Gemini vide.');
    }
    return { rawText: text, provider: `gemini:${modelName}` };
  } finally {
    clearTimeout(timer);
  }
}

async function runOpenAICompatible({ prompt, systemPrompt, history = [], images, settings, expectJson, timeoutMs = 45000 }) {
  let baseUrl = (settings.baseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('URL de base manquante dans Profil → Clés IA.');
  }
  // Auto-complète /v1 pour Ollama/LM Studio si oublié
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl)) {
    baseUrl = `${baseUrl}/v1`;
  }

  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const model = (images.length > 0 ? settings.visionModel || settings.model : settings.model || '').trim();
  if (!model) {
    throw new Error('Nom du modèle manquant dans Profil → Clés IA.');
  }

  const headers = { 'Content-Type': 'application/json' };
  const apiKey = cleanApiKey(settings.apiKey);
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (TIER2_PRESETS[settings.tier2Preset]?.requiresApiKey) {
    throw new Error(`Clé API requise pour ${TIER2_PRESETS[settings.tier2Preset].label}.`);
  }

  if (baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'https://kinetix-lab.local';
    headers['X-Title'] = 'Kinetix Lab';
  }

  const userContent =
    images.length > 0
      ? [
          { type: 'text', text: prompt },
          ...images.map((uri) => ({ type: 'image_url', image_url: { url: uri } })),
        ]
      : prompt;

  const prior = sanitizeHistoryMessages(history);
  const messages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...prior,
    { role: 'user', content: userContent },
  ];

  const payload = {
    model,
    messages,
    temperature: expectJson ? 0.15 : 0.45,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      const detail = parseProviderErrorMessage(errBody, res.status);
      const err = new Error(`HTTP ${res.status} : ${detail}`);
      err.httpStatus = res.status;
      throw err;
    }

    const json = await res.json();
    const rawContent = json?.choices?.[0]?.message?.content;
    const rawText = Array.isArray(rawContent)
      ? rawContent.map((part) => part?.text || '').join('\n').trim()
      : String(rawContent || '').trim();
    if (!rawText) {
      throw new Error('Réponse du serveur compatible OpenAI vide.');
    }
    return { rawText, provider: `${settings.tier2Preset || 'custom'}:${model}` };
  } finally {
    clearTimeout(timer);
  }
}

async function runTier2BYO(args) {
  const isGeminiNative =
    args.settings.protocol === 'gemini_native' ||
    args.settings.tier2Preset === 'gemini' ||
    String(args.settings.baseUrl || '').includes('generativelanguage.googleapis.com');

  if (isGeminiNative) {
    return runGeminiNative(args);
  }
  return runOpenAICompatible(args);
}

/**
 * Dictée vocale en salle via Groq Whisper (whisper-large-v3)
 */
export async function transcribeAudioWithGroqWhisper(audioBlob, settings) {
  const cfg = normalizeAISettings(settings);
  const apiKey = (cfg.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('Clé API Groq requise pour la transcription Whisper.');
  }

  const formData = new FormData();
  formData.append('file', audioBlob, 'voice-note.webm');
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'fr');
  formData.append('response_format', 'json');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq Whisper HTTP ${res.status} : ${errText.slice(0, 160)}`);
  }
  const data = await res.json();
  return String(data.text || '').trim();
}

/* ==========================================================================
   NIVEAU 3 — LLM LOCAL EMBARQUÉ NAVIGATEUR (WEBLLM / TRANSFORMERS.JS)
   ========================================================================== */

let webLlmEngineInstance = null;
let loadedWebLlmModelId = null;

export function detectBrowserLlmCapability() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const platform = typeof navigator !== 'undefined' ? navigator.platform : '';
  const touch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && touch > 1);
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const deviceMemoryGb = typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : null;

  let warning = null;
  if (isIOS) {
    warning =
      'Attention iOS / WebKit : Safari impose un plafond strict de RAM par onglet. Télécharger un modèle local (0,9 à 1,5 Go) peut faire crasher l’onglet. Préférez le Niveau 0 (Local MediaPipe), Niveau 1 (Puter.js) ou Niveau 2 (Ollama / Groq).';
  } else if (!hasWebGPU) {
    warning =
      'WebGPU non détecté sur ce navigateur : l’inférence sera très lente (repli WASM) ou indisponible.';
  } else if (deviceMemoryGb !== null && deviceMemoryGb < 4) {
    warning = `Mémoire détectée limitée (${deviceMemoryGb} Go) : risque de ralentissement lors du chargement des poids.`;
  }

  return {
    isIOS,
    hasWebGPU,
    deviceMemoryGb,
    recommended: !isIOS && hasWebGPU && (deviceMemoryGb === null || deviceMemoryGb >= 4),
    warning,
  };
}

async function runTier3WebLLM({ prompt, systemPrompt, history = [], settings, onProgress }) {
  const cap = detectBrowserLlmCapability();
  if (cap.isIOS && !settings.tier3AcceptedRamWarning) {
    throw new Error(
      'Téléchargement bloqué par sécurité iOS : confirmez l’avertissement mémoire dans les Réglages avant d’activer le Niveau 3.'
    );
  }
  if (!cap.hasWebGPU) {
    throw new Error('WebGPU non disponible sur cet appareil pour WebLLM.');
  }

  const targetModel = settings.tier3ModelId || TIER3_MODELS[0].id;
  if (!webLlmEngineInstance || loadedWebLlmModelId !== targetModel) {
    const webllm = await import(/* @vite-ignore */ 'https://esm.run/@mlc-ai/web-llm');
    webLlmEngineInstance = await webllm.CreateMLCEngine(targetModel, {
      initProgressCallback: (report) => {
        if (typeof onProgress === 'function') {
          onProgress({
            progress: report.progress ?? 0,
            text: report.text || 'Chargement du modèle local WebGPU...',
          });
        }
      },
    });
    loadedWebLlmModelId = targetModel;
  }

  const prior = sanitizeHistoryMessages(history);
  const reply = await webLlmEngineInstance.chat.completions.create({
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...prior,
      { role: 'user', content: prompt },
    ],
    temperature: 0.25,
    max_tokens: 768,
  });

  const rawText = reply?.choices?.[0]?.message?.content || '';
  if (!rawText) throw new Error('Réponse WebLLM vide.');
  return { rawText, provider: `webllm:${targetModel}` };
}

/* ==========================================================================
   TESTEUR DE CONNEXION (LATENCE RÉELLE, VISION & DIAGNOSTIC CORS/AUTH)
   ========================================================================== */

// Pixel PNG 1x1 valide pour sonde vision légère
const TINY_PROBE_PNG_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export async function testAIConnection(rawSettings) {
  const settings = normalizeAISettings(rawSettings);
  const started = performance.now();

  if (settings.activeTier === AI_TIERS.TIER_0_LOCAL) {
    return {
      ok: true,
      tier: 0,
      latencyMs: Math.round(performance.now() - started),
      visionSupported: true,
      provider: 'local_deterministic_mediapipe',
      diagnostic: 'Niveau 0 opérationnel (100 % hors-ligne : MediaPipe local + moteur biomécanique déterministe).',
    };
  }

  if (settings.activeTier === AI_TIERS.TIER_3_WEBLLM) {
    const cap = detectBrowserLlmCapability();
    return {
      ok: cap.hasWebGPU && (!cap.isIOS || settings.tier3AcceptedRamWarning),
      tier: 3,
      latencyMs: Math.round(performance.now() - started),
      visionSupported: settings.tier3ModelId?.includes('SmolVLM') || false,
      provider: `webllm:${settings.tier3ModelId}`,
      diagnostic: cap.warning || `WebGPU prêt (${cap.deviceMemoryGb ? cap.deviceMemoryGb + ' Go RAM' : 'RAM non exposée'}).`,
    };
  }

  try {
    const probePrompt = 'Réponds uniquement OK.';
    const res =
      settings.activeTier === AI_TIERS.TIER_1_FREE_CLOUD
        ? await runTier1FreeCloud({
            prompt: probePrompt,
            systemPrompt: 'Réponds très brièvement.',
            images: [],
            taskType: 'healthcheck',
            settings,
          })
        : await runTier2BYO({
            prompt: probePrompt,
            systemPrompt: 'Réponds très brièvement.',
            images: [],
            settings,
            expectJson: false,
            timeoutMs: 18000,
          });

    const latencyMs = Math.round(performance.now() - started);

    // Détection rapide de capacité vision sur Niveau 2 / Niveau 1
    let visionSupported = false;
    if (settings.activeTier === AI_TIERS.TIER_1_FREE_CLOUD) {
      visionSupported = true;
    } else {
      const vModel = String(settings.visionModel || settings.model || '').toLowerCase();
      const likelyVision =
        vModel.includes('vl') ||
        vModel.includes('vision') ||
        vModel.includes('gemini') ||
        vModel.includes('gpt-4o') ||
        vModel.includes('gpt-4.1') ||
        vModel.includes('scout') ||
        vModel.includes('maverick') ||
        vModel.includes('claude') ||
        vModel.includes('llava');

      if (likelyVision) {
        try {
          await runTier2BYO({
            prompt: 'Reponds OK',
            systemPrompt: '',
            images: [TINY_PROBE_PNG_URI],
            settings,
            expectJson: false,
            timeoutMs: 12000,
          });
          visionSupported = true;
        } catch {
          visionSupported = false;
        }
      }
    }

    return {
      ok: true,
      tier: settings.activeTier,
      latencyMs,
      visionSupported,
      provider: res.provider,
      replyPreview: String(res.rawText || '').slice(0, 60),
      diagnostic: `Connexion validée en ${latencyMs} ms via ${res.provider}. Vision : ${visionSupported ? 'activée' : 'texte seul'}.`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const msg = String(err?.message || err);
    const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const isHttpTarget = String(settings.baseUrl || '').startsWith('http://');
    let diagnostic = msg;

    if (err.isGeminiAuth) {
      diagnostic = `Clé Gemini refusée (HTTP ${err.httpStatus}) : ${msg}. Vérifiez la clé complète sans espace ni guillemets et, dans Google Cloud Console → APIs & Services → Credentials → API restrictions, assurez-vous que "Generative Language API" est bien cochée (patientez 60–90 s après sauvegarde).`;
    } else if (err.httpStatus === 401 || err.httpStatus === 403) {
      diagnostic = `Clé API refusée (HTTP ${err.httpStatus}) : vérifiez que la clé correspond bien au fournisseur "${settings.tier2Preset}" (${msg}).`;
    } else if (err.httpStatus === 404) {
      diagnostic = `Modèle ou URL introuvable (HTTP 404) : vérifiez l’URL (${settings.baseUrl}) et le modèle (${settings.model}).`;
    } else if (err.httpStatus === 429) {
      diagnostic = 'Quota dépassé / limite de requêtes (HTTP 429). Patientez quelques instants ou changez de modèle.';
    } else if (err.name === 'AbortError') {
      diagnostic = 'Délai dépassé (18 s) : le serveur ne répond pas.';
    } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || err instanceof TypeError) {
      if (isHttpsPage && isHttpTarget) {
        diagnostic =
          'Blocage HTTPS → HTTP (Mixed Content) : sur mobile HTTPS, exposez Ollama/LM Studio via Tailscale Funnel ou Cloudflare Tunnel avec OLLAMA_ORIGINS="*".';
      } else {
        diagnostic =
          'Erreur réseau ou CORS (Failed to fetch) : vérifiez la connexion Internet ou l’autorisation CORS du serveur.';
      }
    }

    return {
      ok: false,
      tier: settings.activeTier,
      latencyMs,
      visionSupported: false,
      provider: settings.tier2Preset || `tier_${settings.activeTier}`,
      diagnostic,
    };
  }
}

/* ==========================================================================
   POINT D'ENTRÉE UNIFIÉ DU ROUTEUR IA (AVEC FILET DE SÉCURITÉ NIVEAU 0)
   ========================================================================== */

export async function routeAIRequest({
  taskType = 'coach_chat',
  prompt = '',
  systemPrompt = '',
  history = [],
  images = [],
  context = {},
  settings: rawSettings = null,
  expectJson = false,
  onProgress = null,
}) {
  const settings = normalizeAISettings(rawSettings);
  const startedAt = performance.now();

  const buildFallback = (reason) => ({
    ok: true,
    usedFallback: true,
    fallbackReason: reason,
    tierUsed: AI_TIERS.TIER_0_LOCAL,
    provider: 'tier0_local_deterministic',
    latencyMs: Math.round(performance.now() - startedAt),
    data: runTier0Fallback(taskType, prompt, context),
  });

  // Niveau 0 explicite ou appareil hors-ligne sur niveaux réseau
  if (settings.activeTier === AI_TIERS.TIER_0_LOCAL) {
    return {
      ok: true,
      usedFallback: false,
      fallbackReason: null,
      tierUsed: AI_TIERS.TIER_0_LOCAL,
      provider: 'tier0_local_deterministic',
      latencyMs: Math.round(performance.now() - startedAt),
      data: runTier0Fallback(taskType, prompt, context),
    };
  }

  if (
    typeof navigator !== 'undefined' &&
    navigator.onLine === false &&
    settings.activeTier !== AI_TIERS.TIER_3_WEBLLM &&
    !String(settings.baseUrl || '').includes('localhost') &&
    !String(settings.baseUrl || '').includes('127.0.0.1')
  ) {
    return buildFallback('Appareil hors-ligne : exécution immédiate sur le moteur local Niveau 0.');
  }

  let rawResult = null;
  try {
    if (settings.activeTier === AI_TIERS.TIER_1_FREE_CLOUD) {
      rawResult = await runTier1FreeCloud({ prompt, systemPrompt, history, images, taskType, settings });
    } else if (settings.activeTier === AI_TIERS.TIER_2_BYO) {
      rawResult = await runTier2BYO({ prompt, systemPrompt, history, images, settings, expectJson });
    } else if (settings.activeTier === AI_TIERS.TIER_3_WEBLLM) {
      rawResult = await runTier3WebLLM({ prompt, systemPrompt, history, settings, onProgress });
    } else {
      return buildFallback('Niveau IA inconnu.');
    }
  } catch (err) {
    return buildFallback(err?.message || 'Erreur réseau ou fournisseur IA.');
  }

  if (!expectJson) {
    return {
      ok: true,
      usedFallback: false,
      fallbackReason: null,
      tierUsed: settings.activeTier,
      provider: rawResult.provider,
      latencyMs: Math.round(performance.now() - startedAt),
      data: rawResult.rawText,
    };
  }

  // Couche obligatoire de réparation JSON & validation stricte de schéma
  const parsed = repairAndParseJSON(rawResult.rawText);
  if (!parsed.ok) {
    return buildFallback(`JSON irréparable renvoyé par ${rawResult.provider} : ${parsed.error}`);
  }

  const validation = validateStructuredOutput(taskType, parsed.data);
  if (!validation.valid) {
    return buildFallback(`Schéma invalide (${validation.errors.join(' ; ')}) — repli silencieux Niveau 0.`);
  }

  return {
    ok: true,
    usedFallback: false,
    fallbackReason: null,
    jsonRepaired: parsed.repaired,
    tierUsed: settings.activeTier,
    provider: rawResult.provider,
    latencyMs: Math.round(performance.now() - startedAt),
    data: parsed.data,
  };
}
