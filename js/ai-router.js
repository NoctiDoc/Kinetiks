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
    model: 'gemini-flash-lite-latest',
    visionModel: 'gemini-flash-lite-latest',
    requiresApiKey: true,
    supportsVision: true,
    supportsWhisper: false,
    corsNote:
      'Pré-câblé d’usine : en-tête x-goog-api-key uniquement, bascule auto gemini-flash-lite-latest → gemini-2.5-flash. Compatible clés AQ. et AIza…',
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

export const GEMINI_FAILOVER_MODELS = Object.freeze([
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
]);

export const DEFAULT_AI_SETTINGS = Object.freeze({
  activeTier: AI_TIERS.TIER_2_BYO,
  tier1Provider: 'puter', // 'puter' | 'pollinations'
  allowPublicBodyPhotos: false, // Garde-fou confidentialité strict par défaut
  tier2Preset: 'gemini',
  protocol: 'gemini_native',
  baseUrl: TIER2_PRESETS.gemini.baseUrl,
  model: TIER2_PRESETS.gemini.model,
  visionModel: TIER2_PRESETS.gemini.visionModel,
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

const VALID_ING_STATES = new Set(['cuit', 'cru', 'prêt']);

function parseLooseNumber(val, fallback = 0) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (cleaned) {
      const n = Number(cleaned[0]);
      if (Number.isFinite(n)) return n;
    }
  }
  return fallback;
}

function normalizeIngredientState(rawState) {
  const s = String(rawState || '').trim().toLowerCase();
  if (s.includes('cru') || s === 'raw') return 'cru';
  if (s.includes('pret') || s.includes('prêt') || s.includes('ready') || s.includes('frais')) return 'prêt';
  if (s.includes('cuit') || s.includes('grill') || s.includes('rôti') || s.includes('cooked')) return 'cuit';
  return VALID_ING_STATES.has(s) ? s : 'cuit';
}

/**
 * Normalise de façon tolérante la sortie JSON d'une analyse photo repas
 * (supporte les petits modèles type gemini-flash-lite-latest, Ollama, Puter.js
 * et les variantes de clés legacy items/protein_g ou Pro ingredients/protein).
 */
export function normalizeMealVisionPayload(raw = {}) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const rawList = Array.isArray(data.ingredients)
    ? data.ingredients
    : Array.isArray(data.items)
      ? data.items
      : [];

  const ingredients = rawList
    .filter((entry) => entry && typeof entry === 'object' && String(entry.name || entry.label || '').trim())
    .map((entry, idx) => {
      const grams = Math.max(1, Math.round(parseLooseNumber(entry.grams ?? entry.weight_g ?? entry.weightGrams, 100)));
      const protein = Math.max(0, Math.round(parseLooseNumber(entry.protein ?? entry.protein_g ?? entry.proteinG, 0) * 10) / 10);
      const carbs = Math.max(0, Math.round(parseLooseNumber(entry.carbs ?? entry.carbs_g ?? entry.carbsG, 0) * 10) / 10);
      const fat = Math.max(0, Math.round(parseLooseNumber(entry.fat ?? entry.fat_g ?? entry.fatG, 0) * 10) / 10);
      const fiber = Math.max(0, Math.round(parseLooseNumber(entry.fiber ?? entry.fiber_g ?? entry.fiberG, 0) * 10) / 10);
      const rawKcal = parseLooseNumber(entry.kcal ?? entry.calories, -1);
      const kcal = rawKcal >= 0 ? Math.round(rawKcal) : Math.round(protein * 4 + carbs * 4 + fat * 9);

      // Ancrage pour 100 g afin de permettre un redimensionnement sans perte lors de l'édition temps réel
      const to100 = 100 / grams;
      return {
        id: String(entry.id || `ing_${idx}_${Date.now().toString(36)}`),
        name: String(entry.name || entry.label).trim(),
        state: normalizeIngredientState(entry.state),
        grams,
        kcal,
        protein,
        carbs,
        fat,
        fiber,
        note: String(entry.note || '').trim(),
        per100: {
          kcal: Number((kcal * to100).toFixed(2)),
          protein: Number((protein * to100).toFixed(2)),
          carbs: Number((carbs * to100).toFixed(2)),
          fat: Number((fat * to100).toFixed(2)),
          fiber: Number((fiber * to100).toFixed(2)),
        },
      };
    });

  const totals = ingredients.reduce(
    (acc, item) => ({
      grams: acc.grams + item.grams,
      kcal: acc.kcal + item.kcal,
      protein: Math.round((acc.protein + item.protein) * 10) / 10,
      carbs: Math.round((acc.carbs + item.carbs) * 10) / 10,
      fat: Math.round((acc.fat + item.fat) * 10) / 10,
      fiber: Math.round((acc.fiber + item.fiber) * 10) / 10,
    }),
    { grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );

  const rawConf = String(data.confidence || 'medium').trim().toLowerCase();
  const confidence = rawConf.includes('high') || rawConf.includes('haut')
    ? 'high'
    : rawConf.includes('low') || rawConf.includes('faib')
      ? 'low'
      : 'medium';

  const confidenceReason = String(
    data.confidenceReason || data.confidence_reason || (confidence === 'low' ? 'Grammages ou sauces à vérifier visuellement' : '')
  ).trim();

  let hiddenFatsWarning = false;
  let hiddenFatsMessage = '';
  if (typeof data.hiddenFatsWarning === 'boolean') {
    hiddenFatsWarning = data.hiddenFatsWarning;
    hiddenFatsMessage = String(data.hiddenFatsMessage || data.hidden_fats_message || '').trim();
  } else if (data.hiddenFatsWarning && typeof data.hiddenFatsWarning === 'object') {
    hiddenFatsWarning = Boolean(data.hiddenFatsWarning.warning ?? data.hiddenFatsWarning.active ?? data.hiddenFatsWarning.detected ?? true);
    hiddenFatsMessage = String(data.hiddenFatsWarning.message || data.hiddenFatsWarning.note || '').trim();
  } else if (typeof data.hiddenFatsWarning === 'string' && data.hiddenFatsWarning.trim()) {
    hiddenFatsWarning = true;
    hiddenFatsMessage = data.hiddenFatsWarning.trim();
  } else if (data.hidden_fats_warning) {
    hiddenFatsWarning = Boolean(data.hidden_fats_warning);
    hiddenFatsMessage = String(data.hidden_fats_message || '').trim();
  }
  if (hiddenFatsWarning && !hiddenFatsMessage) {
    hiddenFatsMessage = 'Huile de cuisson, vinaigrette ou sauce dense probable — pense à l’ajouter si nécessaire.';
  }

  const dishName = String(
    data.dishName ||
      data.dish_name ||
      data.meal_label ||
      (ingredients.length > 0 ? ingredients.slice(0, 3).map((i) => i.name).join(' & ') : 'Assiette analysée')
  ).trim();

  const coachTip = String(data.coachTip || data.coach_tip || data.advice || '').trim();
  const estimatedTotalGrams = totals.grams || Math.round(parseLooseNumber(data.estimatedTotalGrams ?? data.estimated_total_grams, 0));
  const rawScore = parseLooseNumber(data.alignment_score ?? data.alignmentScore, 80);
  const alignment_score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    dishName,
    meal_label: dishName,
    confidence,
    confidenceReason,
    estimatedTotalGrams,
    ingredients,
    // Compatibilité descendante
    items: ingredients.map((i) => ({
      name: i.name,
      state: i.state,
      grams: i.grams,
      kcal: i.kcal,
      protein_g: i.protein,
      carbs_g: i.carbs,
      fat_g: i.fat,
      fiber_g: i.fiber,
      note: i.note,
    })),
    totals: {
      kcal: totals.kcal,
      protein_g: totals.protein,
      carbs_g: totals.carbs,
      fat_g: totals.fat,
      fiber_g: totals.fiber,
    },
    hiddenFatsWarning,
    hiddenFatsMessage,
    coachTip,
    advice: coachTip,
    alignment_score,
  };
}

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
    const normalized = normalizeMealVisionPayload(data);
    if (!Array.isArray(normalized.ingredients) || normalized.ingredients.length === 0) {
      errors.push('ingredients doit contenir au moins un ingrédient détecté.');
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
      return normalizeMealVisionPayload({
        source: 'tier0_local_fallback',
        dishName: 'Assiette à vérifier (hors-ligne)',
        confidence: 'low',
        confidenceReason: 'Mode hors-ligne Niveau 0 : ajustez les ingrédients et grammages manuellement.',
        ingredients: [
          { name: 'Protéine principale (ex. poulet)', state: 'cuit', grams: 150, kcal: 248, protein: 46.5, carbs: 0, fat: 5.4, fiber: 0, note: 'à ajuster' },
          { name: 'Féculent (ex. riz basmati)', state: 'cuit', grams: 180, kcal: 234, protein: 4.9, carbs: 50.4, fat: 0.7, fiber: 1.1, note: 'à ajuster' },
          { name: 'Légumes verts', state: 'cuit', grams: 150, kcal: 48, protein: 3.6, carbs: 7.5, fat: 0.5, fiber: 4.5, note: 'à ajuster' },
        ],
        hiddenFatsWarning: true,
        hiddenFatsMessage: 'Pensez à ajouter l’huile de cuisson ou la sauce éventuelle (+1 c.à.s = 90 kcal).',
        coachTip: 'Mode hors-ligne actif : ajustez directement les grammages ci-dessous ou ajoutez un aliment Ciqual.',
        alignment_score: 75,
      });
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
    case 'nutrition_advisor':
      return (
        context.tier0Reply ||
        'Conseiller Nutritionnel Niveau 0 actif : ouvrez la vue Conseiller Pro pour le diagnostic complet et les équivalents chiffrés.'
      );
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

export function isIOSStandalonePWA() {
  if (typeof window === 'undefined') return false;
  if (window.navigator?.standalone === true) return true;
  const isIOS = /iPhone|iPad|iPod/i.test(window.navigator?.userAgent || '');
  const isStandalone = Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches);
  return isIOS && isStandalone;
}

function isPuterAlreadyAuthenticated() {
  try {
    return Boolean(typeof window !== 'undefined' && window.puter?.auth?.isSignedIn?.());
  } catch {
    return false;
  }
}

export function detectGeminiKeyFormat(rawKey) {
  const k = cleanApiKey(rawKey);
  if (!k) return 'absente';
  if (/^AQ\./.test(k)) return 'Google AI Studio (AQ.)';
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(k)) return 'Google API Key (AIza)';
  if (/^gsk_/.test(k)) return 'Groq (gsk_)';
  if (/^sk-or-/.test(k)) return 'OpenRouter (sk-or-)';
  if (/^sk-/.test(k)) return 'OpenAI (sk-)';
  return `Personnalisée (${k.length} car.)`;
}

async function runTier1FreeCloud({ prompt, systemPrompt, history = [], images, taskType, settings }) {
  const prior = sanitizeHistoryMessages(history);
  const historyTranscript =
    prior.length > 0
      ? `Historique récent de la discussion :\n${prior.map((m) => `${m.role === 'user' ? 'Athlète' : 'Coach'} : ${m.content}`).join('\n')}\n\n`
      : '';
  const fullPrompt = `${systemPrompt ? `${systemPrompt}\n\n` : ''}${historyTranscript}Nouvelle demande : ${prompt}`;

  // Garde-fou PWA iOS standalone : ne jamais déclencher une popup auth Puter.js bloquée par WebKit
  const skipPuterOnIOS = isIOSStandalonePWA() && !isPuterAlreadyAuthenticated();

  if (settings.tier1Provider !== 'pollinations' && !skipPuterOnIOS) {
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

  if (skipPuterOnIOS && taskType === 'physique_analysis' && images.length > 0 && !settings.allowPublicBodyPhotos) {
    throw new Error('Puter.js désactivé en PWA iOS standalone sans session active.');
  }

  return runPollinationsFallback({ prompt, systemPrompt, history, images, taskType, settings });
}

/* ==========================================================================
   NIVEAU 2 — CONNECTEUR UNIVERSEL OPENAI-COMPATIBLE & GEMINI NATIF
   ========================================================================== */

function parseDataUri(dataUri) {
  const raw = String(dataUri || '').trim();
  if (!raw) return null;
  const match = raw.match(/^data:([^;,\s]+);base64,([\s\S]+)$/i);
  if (match) {
    return {
      mimeType: match[1].trim().toLowerCase(),
      base64: match[2].replace(/\s+/g, ''),
    };
  }
  // Supporte aussi un base64 brut déjà dépourvu du préfixe data:...;base64,
  if (/^[A-Za-z0-9+/=\s]{16,}$/.test(raw)) {
    return {
      mimeType: 'image/jpeg',
      base64: raw.replace(/\s+/g, ''),
    };
  }
  return null;
}

const EXCLUDED_GEMINI_MODEL_RE = /-tts|-image|embedding|lyria|transcribe|\baqa\b|\bimagen\b|\bveo\b/i;

export function isVisionCapableModel(modelName, isGeminiMode = false) {
  const m = String(modelName || '').trim().toLowerCase();
  if (!m) return Boolean(isGeminiMode);
  if (EXCLUDED_GEMINI_MODEL_RE.test(m)) return false;

  if (isGeminiMode || m.includes('gemini')) {
    return (
      /^gemini-3/i.test(m) ||
      /^gemini-flash/i.test(m) ||
      /^gemini-pro/i.test(m) ||
      /^gemini-2/i.test(m) ||
      /^gemini-1\.5/i.test(m) ||
      m.includes('gemini')
    );
  }

  return (
    m.includes('vl') ||
    m.includes('vision') ||
    m.includes('gpt-4o') ||
    m.includes('gpt-4.1') ||
    m.includes('gpt-5') ||
    m.includes('scout') ||
    m.includes('maverick') ||
    m.includes('claude') ||
    m.includes('llava') ||
    m.includes('pixtral')
  );
}

function scoreGeminiModelPriority(modelName) {
  const m = String(modelName || '').toLowerCase();
  if (m === 'gemini-flash-lite-latest') return 0;
  if (m === 'gemini-3.7-flash') return 1;
  if (m === 'gemini-3.8-flash') return 2;
  if (m.includes('flash-lite-latest')) return 3;
  if (m.includes('3.7-flash')) return 4;
  if (m.includes('3.8-flash')) return 5;
  if (/^gemini-3\./.test(m)) {
    const minorMatch = m.match(/^gemini-3\.(\d+)/);
    const minor = minorMatch ? Number(minorMatch[1]) : 0;
    const tierOffset = m.includes('flash-lite') ? 0 : m.includes('flash') ? 1 : m.includes('pro') ? 2 : 3;
    return 10 + Math.max(0, 9 - minor) + tierOffset * 0.1;
  }
  if (m === 'gemini-flash-latest') return 25;
  if (m === 'gemini-pro-latest') return 26;
  if (m.endsWith('-latest')) return 28;
  if (/^gemini-2\.5-flash/.test(m)) return 35;
  if (/^gemini-2\.5-pro/.test(m)) return 38;
  if (/^gemini-2\.0-flash/.test(m)) return 45;
  return 70;
}

export function filterAndSortGeminiModels(rawModels) {
  const seen = new Set();
  const filtered = [];
  for (const item of Array.isArray(rawModels) ? rawModels : []) {
    const rawName = typeof item === 'string' ? item : item?.name;
    const methods = typeof item === 'object' && Array.isArray(item?.supportedGenerationMethods)
      ? item.supportedGenerationMethods
      : [];
    const cleanName = String(rawName || '').replace(/^models\//i, '').trim();
    const lower = cleanName.toLowerCase();
    if (!cleanName || seen.has(lower)) continue;
    if (!lower.includes('gemini')) continue;
    if (EXCLUDED_GEMINI_MODEL_RE.test(lower)) continue;
    if (methods.length > 0 && !methods.includes('generateContent')) continue;
    seen.add(lower);
    filtered.push(cleanName);
  }

  return filtered.sort((a, b) => {
    const diff = scoreGeminiModelPriority(a) - scoreGeminiModelPriority(b);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
}

function waitAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      reject(abortErr);
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      reject(abortErr);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function extractRawProviderError(rawBody, fallbackStatus) {
  const rawStr = String(rawBody || '').trim();
  if (!rawStr) {
    return {
      statusLabel: `HTTP_${fallbackStatus}`,
      message: `HTTP ${fallbackStatus} (corps vide)`,
      formatted: `HTTP ${fallbackStatus} (corps vide)`,
    };
  }
  try {
    const parsed = JSON.parse(rawStr);
    const errObj = parsed?.error && typeof parsed.error === 'object' ? parsed.error : null;
    const statusLabel = errObj?.status || parsed?.status || (errObj?.code ? `CODE_${errObj.code}` : null);
    const msg =
      errObj?.message ||
      parsed?.message ||
      parsed?.detail ||
      (typeof parsed?.error === 'string' ? parsed.error : null);
    if (msg || statusLabel) {
      const formatted = statusLabel && msg ? `${statusLabel} — ${msg}` : String(msg || statusLabel);
      return {
        statusLabel: statusLabel ? String(statusLabel) : null,
        message: String(msg || statusLabel).slice(0, 400),
        formatted: formatted.slice(0, 500),
      };
    }
  } catch {
    // Texte brut ou HTML
  }
  const cleanText = rawStr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  return {
    statusLabel: null,
    message: cleanText || `HTTP ${fallbackStatus}`,
    formatted: cleanText || `HTTP ${fallbackStatus}`,
  };
}

function cleanApiKey(rawKey) {
  return String(rawKey || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[\r\n\t\s]+/g, '');
}

/**
 * Normalise strictement l'URL de base Gemini native :
 * - trim, suppression query/hash, slashs finaux et suffixes erronés (/openai, /chat/completions, /models/..., :generateContent)
 * - déduplication /v1beta/v1beta
 * - ajout automatique de /v1beta si absent
 */
export function normalizeGeminiBaseUrl(rawBaseUrl) {
  let base = String(rawBaseUrl || '').trim();
  if (!base) return TIER2_PRESETS.gemini.baseUrl;

  // Retire d'éventuels paramètres ?key=... ou #hash collés par erreur
  base = base.split(/[?#]/)[0].trim();
  if (!base) return TIER2_PRESETS.gemini.baseUrl;

  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }

  // Nettoie les doubles slashs hors protocole (https://)
  base = base.replace(/([^:]\/)\/+/g, '$1').replace(/\/+$/, '');

  // Retire d'éventuels suffixes copiés par erreur
  base = base
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/openai$/i, '')
    .replace(/\/models(?:\/.*)?$/i, '')
    .replace(/:(?:stream)?generateContent$/i, '')
    .replace(/\/+$/, '');

  // Supprime les doublons /v1beta/v1beta ou /v1/v1
  base = base.replace(/(\/v1(?:beta)?)\1+/gi, '$1');

  // Ajoute /v1beta automatiquement s'il est absent
  if (!/\/v1(?:beta)?$/i.test(base)) {
    base = `${base}/v1beta`;
  }

  return base;
}

export function normalizeGeminiModelName(rawModel, fallback = 'gemini-flash-lite-latest') {
  const cleaned = String(rawModel || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(?:models\/)+/i, '')
    .replace(/:(?:stream)?generateContent$/i, '')
    .trim();
  return cleaned || fallback;
}

export function buildGeminiGenerateUrl(rawBaseUrl, rawModel) {
  const base = normalizeGeminiBaseUrl(rawBaseUrl);
  const modelName = normalizeGeminiModelName(rawModel);
  return {
    base,
    modelName,
    safeUrl: `${base}/models/${encodeURIComponent(modelName)}:generateContent`,
  };
}

/**
 * Exécute un appel Gemini REST natif en passant OBLIGATOIREMENT la clé via l'en-tête HTTP
 * `x-goog-api-key` (jamais `?key=` dans l'URL), avec retry léger sur HTTP 503.
 */
async function fetchGeminiWithAuthFallback(
  safeUrl,
  { method = 'POST', body = null, apiKey, signal, max503Retries = 1, retryDelayMs = 1500 }
) {
  const executeOnce = async () => {
    const headers = { 'x-goog-api-key': apiKey };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(safeUrl, {
      method,
      headers,
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
      signal,
    });
    return { res, authMode: 'header:x-goog-api-key' };
  };

  let retriesUsed = 0;
  for (let attempt = 0; attempt <= max503Retries; attempt += 1) {
    const result = await executeOnce();
    if (result.res.status !== 503 || attempt === max503Retries) {
      return { ...result, retriesUsed };
    }
    try {
      await result.res.text();
    } catch {
      // ignore
    }
    retriesUsed += 1;
    await waitAbortable(retryDelayMs, signal);
  }
}

/**
 * Interroge GET /v1beta/models pour lister les modèles Gemini réellement actifs sur cette clé (diagnostic 404).
 * Priorise les modèles récents (flash-lite-latest, 3.7-flash, 3.8-flash) et exclut les modèles spécialisés.
 */
export async function listAvailableGeminiModels(rawBaseUrl, rawApiKey, timeoutMs = 35000, retryDelayMs = 2000) {
  const apiKey = cleanApiKey(rawApiKey);
  const base = normalizeGeminiBaseUrl(rawBaseUrl);
  const listSafeUrl = `${base}/models`;
  if (!apiKey) {
    return { ok: false, models: [], safeUrl: listSafeUrl, httpStatus: null, rawError: 'Clé API vide.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { res } = await fetchGeminiWithAuthFallback(listSafeUrl, {
      method: 'GET',
      body: null,
      apiKey,
      signal: controller.signal,
      max503Retries: 2,
      retryDelayMs,
    });
    const rawText = await res.text();
    if (!res.ok) {
      const parsedErr = extractRawProviderError(rawText, res.status);
      return {
        ok: false,
        models: [],
        safeUrl: listSafeUrl,
        httpStatus: res.status,
        rawError: parsedErr.formatted,
      };
    }
    const json = JSON.parse(rawText);
    const models = filterAndSortGeminiModels(json?.models);

    return { ok: true, models, safeUrl: listSafeUrl, httpStatus: res.status, rawError: null };
  } catch (err) {
    return {
      ok: false,
      models: [],
      safeUrl: listSafeUrl,
      httpStatus: null,
      rawError: String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

const GEMINI_VALID_MODEL_LS_KEY = 'kinetiks_gemini_valid_model';
let cachedDiscoveredGeminiModel = '';

export function getCachedValidGeminiModel() {
  if (cachedDiscoveredGeminiModel) return cachedDiscoveredGeminiModel;
  try {
    if (typeof localStorage !== 'undefined') {
      cachedDiscoveredGeminiModel = String(localStorage.getItem(GEMINI_VALID_MODEL_LS_KEY) || '').trim();
    }
  } catch {
    // ignore
  }
  return cachedDiscoveredGeminiModel;
}

export function setCachedValidGeminiModel(modelName) {
  const clean = normalizeGeminiModelName(modelName, '');
  if (!clean) return '';
  cachedDiscoveredGeminiModel = clean;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GEMINI_VALID_MODEL_LS_KEY, clean);
    }
  } catch {
    // ignore
  }
  return clean;
}

function buildGeminiCandidateModels(primaryModel) {
  const cleanPrimary = normalizeGeminiModelName(primaryModel, GEMINI_FAILOVER_MODELS[0]);
  const cached = getCachedValidGeminiModel();
  const ordered = [cleanPrimary, ...GEMINI_FAILOVER_MODELS, cached];
  return Array.from(new Set(ordered.filter(Boolean)));
}

function shouldFailoverGeminiModel(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  const st = Number(err.httpStatus);
  return st === 404 || st === 429 || st === 503;
}

async function runGeminiSingleModel({
  prompt,
  systemPrompt,
  history = [],
  images = [],
  baseUrl,
  rawModel,
  apiKey,
  expectJson = false,
  isHealthProbe = false,
  timeoutMs = 24000,
  retryDelayMs = 1500,
}) {
  const hasImages = Array.isArray(images) && images.length > 0;
  const { base, modelName, safeUrl } = buildGeminiGenerateUrl(baseUrl, rawModel);

  const imageParts = [];
  if (hasImages) {
    for (const img of images) {
      const parsed = parseDataUri(img);
      if (parsed) {
        imageParts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.base64,
          },
        });
      }
    }
  }

  let body;
  if (isHealthProbe) {
    body = {
      contents: [
        {
          parts: hasImages
            ? [{ text: prompt || 'OK' }, ...imageParts]
            : [{ text: 'ping' }],
        },
      ],
    };
  } else {
    const parts = [{ text: prompt }, ...imageParts];
    const priorContents = sanitizeHistoryMessages(history).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    body = {
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      contents: [...priorContents, { role: 'user', parts }],
      generationConfig: {
        temperature: expectJson ? 0.2 : 0.5,
        ...(expectJson ? { responseMimeType: 'application/json' } : {}),
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { res, authMode, retriesUsed } = await fetchGeminiWithAuthFallback(safeUrl, {
      method: 'POST',
      body,
      apiKey,
      signal: controller.signal,
      max503Retries: 1,
      retryDelayMs,
    });

    if (!res.ok) {
      const errBody = await res.text();
      const parsedErr = extractRawProviderError(errBody, res.status);
      const err = new Error(parsedErr.formatted);
      err.httpStatus = res.status;
      err.endpointUrl = safeUrl;
      err.geminiBaseUrl = base;
      err.geminiModel = modelName;
      err.rawError = parsedErr.formatted;
      err.googleStatus = parsedErr.statusLabel;
      err.googleMessage = parsedErr.message;
      err.authMode = authMode;
      err.retriesUsed = retriesUsed;
      err.isGeminiNative = true;
      err.isGeminiAuth = res.status === 401 || res.status === 403;
      throw err;
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim() || '';
    if (!text) {
      const blockReason = json?.promptFeedback?.blockReason;
      const err = new Error(blockReason ? `Réponse Gemini bloquée (${blockReason}).` : 'Réponse Gemini vide.');
      err.endpointUrl = safeUrl;
      err.rawError = JSON.stringify(json).slice(0, 350);
      throw err;
    }
    return {
      rawText: text,
      provider: `gemini:${modelName}`,
      modelName,
      endpointUrl: safeUrl,
      authMode,
      retriesUsed,
    };
  } catch (err) {
    if (err && typeof err === 'object' && !err.endpointUrl) {
      err.endpointUrl = safeUrl;
      err.isGeminiNative = true;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function runGeminiNative({
  prompt,
  systemPrompt,
  history = [],
  images = [],
  settings,
  expectJson = false,
  isHealthProbe = false,
  timeoutMs = 24000,
  retryDelayMs = 1500,
}) {
  const apiKey = cleanApiKey(settings.apiKey);
  const hasImages = Array.isArray(images) && images.length > 0;
  const primaryModel = hasImages
    ? settings.visionModel || settings.model || TIER2_PRESETS.gemini.visionModel
    : settings.model || TIER2_PRESETS.gemini.model;
  const candidates = buildGeminiCandidateModels(primaryModel);

  if (!apiKey) {
    const { safeUrl } = buildGeminiGenerateUrl(settings.baseUrl, candidates[0]);
    const err = new Error('Clé API Gemini vide.');
    err.endpointUrl = safeUrl;
    err.missingGeminiKey = true;
    throw err;
  }

  let lastErr = null;
  let saw404 = false;
  const attempted = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidateModel = candidates[i];
    attempted.push(candidateModel);
    try {
      const result = await runGeminiSingleModel({
        prompt,
        systemPrompt,
        history,
        images,
        baseUrl: settings.baseUrl || TIER2_PRESETS.gemini.baseUrl,
        rawModel: candidateModel,
        apiKey,
        expectJson,
        isHealthProbe,
        timeoutMs,
        retryDelayMs,
      });
      if (i > 0) {
        setCachedValidGeminiModel(result.modelName);
      }
      return {
        ...result,
        failoverUsed: i > 0,
        autoRepairedModel: null,
        attemptedModels: attempted,
      };
    } catch (err) {
      lastErr = err;
      if (Number(err?.httpStatus) === 404) saw404 = true;
      const hasMore = i < candidates.length - 1;
      if (hasMore && shouldFailoverGeminiModel(err)) {
        continue;
      }
      if (!saw404) {
        throw err;
      }
    }
  }

  // Auto-réparation HTTP 404 : interroge GET /v1beta/models avec x-goog-api-key,
  // sélectionne le premier modèle flash compatible generateContent, le mémorise et relance immédiatement
  if (saw404) {
    const listed = await listAvailableGeminiModels(
      settings.baseUrl || TIER2_PRESETS.gemini.baseUrl,
      apiKey,
      Math.min(15000, timeoutMs),
      Math.min(800, retryDelayMs)
    );
    if (listed.ok && listed.models.length > 0) {
      const preferredFlash =
        listed.models.find((m) => /flash/i.test(m) && !attempted.includes(m)) ||
        listed.models.find((m) => !attempted.includes(m)) ||
        null;
      if (preferredFlash) {
        attempted.push(preferredFlash);
        const repairedResult = await runGeminiSingleModel({
          prompt,
          systemPrompt,
          history,
          images,
          baseUrl: settings.baseUrl || TIER2_PRESETS.gemini.baseUrl,
          rawModel: preferredFlash,
          apiKey,
          expectJson,
          isHealthProbe,
          timeoutMs,
          retryDelayMs,
        });
        setCachedValidGeminiModel(repairedResult.modelName);
        if (settings && typeof settings === 'object') {
          settings.model = repairedResult.modelName;
          settings.visionModel = repairedResult.modelName;
        }
        return {
          ...repairedResult,
          failoverUsed: true,
          autoRepairedModel: repairedResult.modelName,
          attemptedModels: attempted,
        };
      }
    }
  }

  throw lastErr;
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
    const err = new Error('Nom du modèle manquant dans Profil → Clés IA.');
    err.endpointUrl = endpoint;
    throw err;
  }

  const headers = { 'Content-Type': 'application/json' };
  const apiKey = cleanApiKey(settings.apiKey);
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (TIER2_PRESETS[settings.tier2Preset]?.requiresApiKey) {
    const err = new Error(`Clé API requise pour ${TIER2_PRESETS[settings.tier2Preset].label}.`);
    err.endpointUrl = endpoint;
    throw err;
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
      const parsedErr = extractRawProviderError(errBody, res.status);
      const err = new Error(parsedErr.formatted);
      err.httpStatus = res.status;
      err.endpointUrl = endpoint;
      err.rawError = parsedErr.formatted;
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
    return { rawText, provider: `${settings.tier2Preset || 'custom'}:${model}`, endpointUrl: endpoint };
  } catch (err) {
    if (err && typeof err === 'object' && !err.endpointUrl) {
      err.endpointUrl = endpoint;
    }
    throw err;
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

// Pixel PNG 1x1 RGBA 24-bit valide pour micro-test Vision léger
const TINY_PROBE_PNG_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export async function testAIConnection(rawSettings, { retryDelayMs = 2000 } = {}) {
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

  const isGeminiMode =
    settings.activeTier === AI_TIERS.TIER_2_BYO &&
    (settings.protocol === 'gemini_native' ||
      settings.tier2Preset === 'gemini' ||
      String(settings.baseUrl || '').includes('generativelanguage.googleapis.com'));

  // Si aucune clé Gemini n'est renseignée, teste la bascule transparente Puter.js -> Local Niveau 0
  if (isGeminiMode && !cleanApiKey(settings.apiKey)) {
    try {
      const pRes = await runTier1FreeCloud({
        prompt: 'Réponds uniquement OK.',
        systemPrompt: 'Réponds très brièvement.',
        images: [],
        taskType: 'healthcheck',
        settings: { ...settings, tier1Provider: 'puter' },
      });
      const latencyMs = Math.round(performance.now() - started);
      return {
        ok: true,
        tier: 1,
        latencyMs,
        visionSupported: true,
        provider: pRes.provider,
        httpStatus: 200,
        diagnostic: `Clé Gemini vide — bascule transparente active sur ${pRes.provider} (${latencyMs} ms), puis Niveau 0 local hors-ligne.`,
      };
    } catch {
      const latencyMs = Math.round(performance.now() - started);
      return {
        ok: true,
        tier: 0,
        latencyMs,
        visionSupported: true,
        provider: 'local_deterministic_mediapipe',
        httpStatus: 200,
        diagnostic: 'Clé Gemini vide et Puter.js indisponible — moteur Niveau 0 déterministe local 100 % opérationnel.',
      };
    }
  }

  try {
    const probePrompt = isGeminiMode ? 'ping' : 'Réponds uniquement OK.';
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
            systemPrompt: isGeminiMode ? '' : 'Réponds très brièvement.',
            images: [],
            settings,
            expectJson: false,
            isHealthProbe: isGeminiMode,
            timeoutMs: 24000,
            retryDelayMs,
          });

    const latencyMs = Math.round(performance.now() - started);

    // Micro-test Vision réel (PNG 1x1 base64 natif inlineData sur Gemini)
    let visionSupported = false;
    let visionModelUsed = null;
    let visionEndpointUrl = null;
    let visionHttpStatus = null;
    let visionError = null;
    let visionSuggestedModels = [];

    if (settings.activeTier === AI_TIERS.TIER_1_FREE_CLOUD) {
      visionSupported = true;
    } else {
      const targetVisionModel = String(res.modelName || settings.visionModel || settings.model || '').trim();
      visionModelUsed = isGeminiMode
        ? normalizeGeminiModelName(targetVisionModel, TIER2_PRESETS.gemini.visionModel)
        : targetVisionModel;

      if (isVisionCapableModel(visionModelUsed, isGeminiMode)) {
        try {
          const visionRes = await runTier2BYO({
            prompt: 'Réponds OK.',
            systemPrompt: '',
            images: [TINY_PROBE_PNG_URI],
            settings,
            expectJson: false,
            isHealthProbe: isGeminiMode,
            timeoutMs: 35000,
            retryDelayMs,
          });
          visionSupported = true;
          visionModelUsed = visionRes.modelName || visionModelUsed;
          visionEndpointUrl = visionRes.endpointUrl || null;
          visionHttpStatus = 200;
        } catch (vErr) {
          visionSupported = false;
          visionHttpStatus = vErr?.httpStatus ?? null;
          visionEndpointUrl =
            vErr?.endpointUrl ||
            (isGeminiMode ? buildGeminiGenerateUrl(settings.baseUrl, visionModelUsed).safeUrl : null);
          visionError = String(vErr?.rawError || vErr?.message || vErr);

          if (isGeminiMode && visionHttpStatus === 404) {
            const listed = await listAvailableGeminiModels(settings.baseUrl, settings.apiKey, 35000, retryDelayMs);
            if (listed.ok && listed.models.length > 0) {
              visionSuggestedModels = listed.models.slice(0, 3);
            }
          }
        }
      }
    }

    const activeModelUsed = res.modelName || settings.model || null;
    const visionSummary = visionSupported
      ? `Vision : Oui${visionModelUsed ? ` (${visionModelUsed})` : ''}.`
      : visionError
        ? `Vision : Non sur ${visionModelUsed || 'modèle vision'} (HTTP ${visionHttpStatus ?? 'Réseau'} : ${visionError}).`
        : 'Vision : Non (modèle texte seul).';

    return {
      ok: true,
      tier: settings.activeTier,
      latencyMs,
      modelUsed: activeModelUsed,
      visionSupported,
      visionModelUsed,
      visionEndpointUrl,
      visionHttpStatus,
      visionError,
      visionSuggestedModels,
      provider: res.provider,
      endpointUrl: res.endpointUrl || null,
      httpStatus: 200,
      authMode: res.authMode || null,
      retriesUsed: res.retriesUsed || 0,
      rawError: null,
      suggestedModels: [],
      replyPreview: String(res.rawText || '').slice(0, 60),
      diagnostic: `Connexion validée en ${latencyMs} ms via ${res.provider}${activeModelUsed ? ` (${activeModelUsed})` : ''}${res.authMode ? ` · ${res.authMode}` : ''}. ${visionSummary}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const msg = String(err?.message || err);
    const rawError = String(err?.rawError || msg);
    const endpointUrl =
      err?.endpointUrl ||
      (isGeminiMode ? buildGeminiGenerateUrl(settings.baseUrl, settings.model).safeUrl : settings.baseUrl || null);
    const httpStatus = err?.httpStatus ?? null;
    const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const isHttpTarget = String(settings.baseUrl || '').startsWith('http://');

    let suggestedModels = [];
    let modelProbeNote = '';

    // En cas de HTTP 404 sur Gemini natif, liste automatiquement les modèles actifs triés sur /v1beta/models
    if (isGeminiMode && httpStatus === 404) {
      const listed = await listAvailableGeminiModels(settings.baseUrl, settings.apiKey, 35000, retryDelayMs);
      if (listed.ok && listed.models.length > 0) {
        suggestedModels = listed.models.slice(0, 3);
        modelProbeNote = ` Modèles Gemini actifs recommandés pour cette clé : ${suggestedModels.join(', ')}.`;
      } else if (listed.rawError) {
        modelProbeNote = ` Sondage GET /v1beta/models échoué (HTTP ${listed.httpStatus ?? 'réseau'}) : ${listed.rawError}`;
      }
    }

    let diagnostic = rawError;
    if (err.isGeminiAuth) {
      diagnostic = `Clé Gemini refusée (HTTP ${httpStatus}) : ${rawError}. Vérifiez la clé complète sans espace ni guillemets et, dans Google Cloud Console → APIs & Services → Credentials → API restrictions, assurez-vous que "Generative Language API" est cochée (patientez 60–90 s).`;
    } else if (httpStatus === 401 || httpStatus === 403) {
      diagnostic = `Clé API refusée (HTTP ${httpStatus}) : ${rawError}`;
    } else if (httpStatus === 404) {
      diagnostic = `HTTP 404 sur ${endpointUrl} — Réponse serveur : ${rawError}.${modelProbeNote}`;
    } else if (httpStatus === 429) {
      diagnostic = `Quota dépassé / limite de requêtes (HTTP 429) : ${rawError}`;
    } else if (httpStatus === 503) {
      diagnostic = `Serveur temporairement saturé (HTTP 503 après ${err.retriesUsed || 0} tentatives de reprise) : ${rawError}`;
    } else if (err.name === 'AbortError') {
      diagnostic = 'Délai dépassé (35 s) : le serveur ne répond pas.';
    } else if (msg.includes('Failed to fetch') || msg.includes('Load failed') || msg.includes('NetworkError') || err instanceof TypeError) {
      if (isHttpsPage && isHttpTarget) {
        diagnostic =
          'Blocage HTTPS → HTTP (Mixed Content) : sur mobile HTTPS, exposez Ollama/LM Studio via Tailscale Funnel ou Cloudflare Tunnel avec OLLAMA_ORIGINS="*".';
      } else {
        diagnostic = `Erreur réseau ou CORS (${msg}) sur ${endpointUrl || settings.baseUrl}. Vérifiez la connexion Internet ou l’autorisation CORS du serveur.`;
      }
    }

    return {
      ok: false,
      tier: settings.activeTier,
      latencyMs,
      visionSupported: false,
      provider: settings.tier2Preset || `tier_${settings.activeTier}`,
      endpointUrl,
      httpStatus,
      rawError,
      suggestedModels,
      diagnostic,
    };
  }
}

/* ==========================================================================
   POINT D'ENTRÉE UNIFIÉ DU ROUTEUR IA (AVEC FILET DE SÉCURITÉ NIVEAU 0)
   ========================================================================== */

function formatExplicitApiError(err, settings) {
  const isGemini =
    settings?.tier2Preset === 'gemini' ||
    settings?.protocol === 'gemini_native' ||
    Boolean(err?.isGeminiNative);
  const label = isGemini ? 'Gemini' : (TIER2_PRESETS[settings?.tier2Preset]?.label || 'API IA');
  const st = Number(err?.httpStatus);
  const raw = String(err?.googleMessage || err?.rawError || err?.message || 'Erreur inconnue').slice(0, 260);

  if (st === 400) return `${label} HTTP 400 : requête ou paramètre invalide (${raw})`;
  if (st === 401 || st === 403) return `${label} HTTP ${st} : clé invalide ou restreinte (${raw})`;
  if (st === 404) return `${label} HTTP 404 : modèle ou endpoint introuvable (${raw})`;
  if (st === 429) return `${label} HTTP 429 : quota dépassé ou limite de requêtes atteinte (${raw})`;
  if (st === 503) return `${label} HTTP 503 : service temporairement saturé (${raw})`;
  if (st > 0) return `${label} HTTP ${st} : ${raw}`;
  if (err?.name === 'AbortError') return `${label} : délai d’attente dépassé (timeout réseau).`;
  return `${label} : erreur réseau ou CORS (${raw})`;
}

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

  // Niveau 0 explicite
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

  const hasExplicitKey = settings.activeTier === AI_TIERS.TIER_2_BYO && Boolean(cleanApiKey(settings.apiKey));

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
  let effectiveTierUsed = settings.activeTier;
  const isDefaultGeminiNoKey =
    settings.activeTier === AI_TIERS.TIER_2_BYO &&
    (settings.tier2Preset === 'gemini' || settings.protocol === 'gemini_native') &&
    !cleanApiKey(settings.apiKey);

  try {
    if (isDefaultGeminiNoKey) {
      // En PWA iOS standalone sans Puter connecté : passage direct au moteur local Niveau 0 sans popup WebKit
      if (isIOSStandalonePWA() && !isPuterAlreadyAuthenticated()) {
        return buildFallback('Clé Gemini non configurée (PWA iOS standalone) : moteur local Niveau 0 actif.');
      }
      // Champ Gemini vide : bascule transparente sur Puter.js (Niveau 1 sans clé), puis Niveau 0 si indisponible
      effectiveTierUsed = AI_TIERS.TIER_1_FREE_CLOUD;
      rawResult = await runTier1FreeCloud({
        prompt,
        systemPrompt,
        history,
        images,
        taskType,
        settings: { ...settings, tier1Provider: 'puter' },
      });
    } else if (settings.activeTier === AI_TIERS.TIER_1_FREE_CLOUD) {
      rawResult = await runTier1FreeCloud({ prompt, systemPrompt, history, images, taskType, settings });
    } else if (settings.activeTier === AI_TIERS.TIER_2_BYO) {
      rawResult = await runTier2BYO({ prompt, systemPrompt, history, images, settings, expectJson });
    } else if (settings.activeTier === AI_TIERS.TIER_3_WEBLLM) {
      rawResult = await runTier3WebLLM({ prompt, systemPrompt, history, settings, onProgress });
    } else {
      return buildFallback('Niveau IA inconnu.');
    }
  } catch (err) {
    // Transparence totale : si une clé API explicite (ex. Gemini) est configurée,
    // NE JAMAIS déguiser son échec sous l'étiquette "Niveau 0"
    if (hasExplicitKey) {
      const explicitMsg = formatExplicitApiError(err, settings);
      return {
        ok: false,
        apiError: explicitMsg,
        httpStatus: err?.httpStatus ?? null,
        rawError: err?.rawError || err?.message || explicitMsg,
        endpointUrl: err?.endpointUrl || null,
        usedFallback: false,
        fallbackReason: explicitMsg,
        tierUsed: settings.activeTier,
        provider: err?.geminiModel ? `gemini:${err.geminiModel}` : `${settings.tier2Preset || 'api'}:error`,
        latencyMs: Math.round(performance.now() - startedAt),
        data: expectJson ? runTier0Fallback(taskType, prompt, context) : explicitMsg,
      };
    }
    return buildFallback(err?.message || 'Erreur réseau ou fournisseur IA.');
  }

  if (!expectJson) {
    return {
      ok: true,
      usedFallback: false,
      fallbackReason: null,
      tierUsed: effectiveTierUsed,
      provider: rawResult.provider,
      modelUsed: rawResult.modelName || null,
      autoRepairedModel: rawResult.autoRepairedModel || null,
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

  const finalData = taskType === 'meal_analysis' ? normalizeMealVisionPayload(parsed.data) : parsed.data;

  return {
    ok: true,
    usedFallback: false,
    fallbackReason: null,
    jsonRepaired: parsed.repaired,
    tierUsed: effectiveTierUsed,
    provider: rawResult.provider,
    modelUsed: rawResult.modelName || null,
    autoRepairedModel: rawResult.autoRepairedModel || null,
    latencyMs: Math.round(performance.now() - startedAt),
    data: finalData,
  };
}
