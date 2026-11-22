/**
 * Kinetix Lab — Labo Physique & Analyse Morpho-Posturale Locale (js/physique-lab.js)
 * - Caméra guidée 3 angles (Face, Profil, Dos) avec Ghost Overlay (calque Jour 1) & retardateur
 * - Compression WebP / JPEG (~180 Ko max) pour stockage local isolé dans IndexedDB
 * - Comparateur Avant / Après à curseur glissant fluide (tactile + clavier)
 * - MediaPipe Pose Landmarker (client-side WASM/WebGL) : 33 landmarks squelettiques,
 *   ratios segmentaires (fémur/tibia, envergure/taille, épaules/bassin), asymétries G/D et posture
 * - Pipeline Double Analyse (MediaPipe local + IA Vision via ai-router.js en JSON strict)
 */

import { routeAIRequest } from './ai-router.js';
import { MUSCLE_GROUPS } from './exercises-db.js';

export const PHOTO_ANGLES = Object.freeze([
  { id: 'front', label: 'Face', cue: 'Pieds largeur d’épaules, bras relâchés légèrement écartés, regard horizontal.' },
  { id: 'side', label: 'Profil', cue: 'Profil strict, posture naturelle sans rentrer le ventre, bras le long du corps.' },
  { id: 'back', label: 'Dos', cue: 'Dos face caméra, omoplates neutres, pieds alignés sur les mêmes repères.' },
]);

/* ==========================================================================
   1. COMPRESSION IMAGE (~180 KO WEBP / JPEG FALLBACK)
   ========================================================================== */

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Impossible de charger l’image source.'));
    img.src = src;
  });
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Erreur lecture Blob.'));
    reader.readAsDataURL(blob);
  });
}

export async function compressPhysiqueImage(
  source,
  { maxWidth = 1080, maxHeight = 1440, targetBytes = 180000 } = {}
) {
  let drawable = source;
  let tempObjectUrl = null;

  try {
    if (source instanceof Blob || source instanceof File) {
      tempObjectUrl = URL.createObjectURL(source);
      drawable = await loadImageElement(tempObjectUrl);
    } else if (typeof source === 'string') {
      drawable = await loadImageElement(source);
    }

    const srcW = drawable.videoWidth || drawable.naturalWidth || drawable.width;
    const srcH = drawable.videoHeight || drawable.naturalHeight || drawable.height;
    if (!srcW || !srcH) {
      throw new Error('Dimensions image/vidéo nulles.');
    }

    const scale = Math.min(1, maxWidth / srcW, maxHeight / srcH);
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(drawable, 0, 0, width, height);

    // Test support WebP natif (Safari iOS ancien bascule proprement en JPEG)
    let mimeType = 'image/webp';
    let quality = 0.84;
    let blob = await canvasToBlob(canvas, mimeType, quality);

    if (!blob || blob.type !== 'image/webp') {
      mimeType = 'image/jpeg';
      blob = await canvasToBlob(canvas, mimeType, quality);
    }

    // Réduction progressive de qualité pour rester proche de ~180 Ko
    let attempts = 0;
    while (blob && blob.size > targetBytes && quality > 0.42 && attempts < 6) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, mimeType, Number(quality.toFixed(2)));
      attempts += 1;
    }

    if (!blob) {
      throw new Error('Échec de la compression canvas.');
    }

    const dataUrl = await blobToDataUrl(blob);
    return {
      blob,
      dataUrl,
      mimeType: blob.type || mimeType,
      sizeBytes: blob.size,
      width,
      height,
    };
  } finally {
    if (tempObjectUrl) URL.revokeObjectURL(tempObjectUrl);
  }
}

/* ==========================================================================
   2. CAMÉRA GUIDÉE 3 ANGLES AVEC GHOST OVERLAY (JOUR 1)
   ========================================================================== */

export class PhysiqueCameraController {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
    this.facingMode = 'user'; // 'user' (selfie miroir) ou 'environment' (caméra arrière)
  }

  async start(facingMode = this.facingMode) {
    this.stop();
    this.facingMode = facingMode;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Caméra non supportée dans ce navigateur. Utilisez l’import fichier.');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: this.facingMode },
        width: { ideal: 1080 },
        height: { ideal: 1440 },
      },
    });

    if (this.video) {
      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', 'true');
      await this.video.play();
    }
    return this.stream;
  }

  async toggleFacingMode() {
    const next = this.facingMode === 'user' ? 'environment' : 'user';
    return this.start(next);
  }

  async captureCompressed(options = {}) {
    if (!this.video || !this.stream) {
      throw new Error('Flux caméra inactif.');
    }
    return compressPhysiqueImage(this.video, options);
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }
}

/* ==========================================================================
   3. COMPARATEUR AVANT / APRÈS À CURSEUR GLISSANT
   ========================================================================== */

export function mountBeforeAfterSlider(
  container,
  beforeUrl,
  afterUrl,
  { beforeLabel = 'Avant', afterLabel = 'Après', initialPct = 50 } = {}
) {
  if (!container) return;
  container.innerHTML = '';

  const stage = document.createElement('div');
  stage.className = 'compare-stage';

  const imgAfter = document.createElement('img');
  imgAfter.src = afterUrl;
  imgAfter.alt = afterLabel;

  const imgBefore = document.createElement('img');
  imgBefore.src = beforeUrl;
  imgBefore.alt = beforeLabel;

  const divider = document.createElement('div');
  divider.className = 'compare-divider';

  const labelLeft = document.createElement('span');
  labelLeft.className = 'mono';
  labelLeft.style.cssText =
    'position:absolute;top:10px;left:10px;background:#090a0ccc;padding:3px 8px;border:1px solid #242933;border-radius:4px;font-size:11px;';
  labelLeft.textContent = beforeLabel;

  const labelRight = document.createElement('span');
  labelRight.className = 'mono';
  labelRight.style.cssText =
    'position:absolute;top:10px;right:10px;background:#090a0ccc;padding:3px 8px;border:1px solid #242933;border-radius:4px;font-size:11px;';
  labelRight.textContent = afterLabel;

  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '100';
  range.value = String(initialPct);
  range.className = 'range-tech';
  range.setAttribute('aria-label', 'Curseur de comparaison Avant / Après');

  const update = (pct) => {
    const clamped = Math.max(0, Math.min(100, Number(pct)));
    imgBefore.style.clipPath = `inset(0 ${100 - clamped}% 0 0)`;
    divider.style.left = `${clamped}%`;
  };

  range.addEventListener('input', (e) => update(e.target.value));

  // Support glisser directement sur la photo au doigt / pointeur
  let dragging = false;
  const setFromClientX = (clientX) => {
    const rect = stage.getBoundingClientRect();
    const pct = ((clientX - rect.left) / Math.max(1, rect.width)) * 100;
    range.value = String(Math.round(Math.max(0, Math.min(100, pct))));
    update(range.value);
  };
  stage.addEventListener('pointerdown', (e) => {
    dragging = true;
    stage.setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX);
  });
  stage.addEventListener('pointermove', (e) => {
    if (dragging) setFromClientX(e.clientX);
  });
  stage.addEventListener('pointerup', () => {
    dragging = false;
  });

  stage.append(imgAfter, imgBefore, divider, labelLeft, labelRight);
  container.append(stage, range);
  update(initialPct);
}

/* ==========================================================================
   4. MEDIAPIPE POSE LANDMARKER (33 LANDMARKS — 100 % CLIENT-SIDE WASM/WEBGL)
   ========================================================================== */

const MEDIAPIPE_VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MEDIAPIPE_WASM_ROOT = `${MEDIAPIPE_VISION_CDN}/wasm`;
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let poseLandmarkerPromise = null;

async function getPoseLandmarker() {
  if (poseLandmarkerPromise) return poseLandmarkerPromise;

  poseLandmarkerPromise = (async () => {
    const vision = await import(/* @vite-ignore */ `${MEDIAPIPE_VISION_CDN}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
    return vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: POSE_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      numPoses: 1,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
    });
  })().catch(async () => {
    // Repli CPU WASM si GPU/WebGL indisponible
    const vision = await import(/* @vite-ignore */ `${MEDIAPIPE_VISION_CDN}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
    return vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: POSE_MODEL_URL,
        delegate: 'CPU',
      },
      runningMode: 'IMAGE',
      numPoses: 1,
    });
  });

  return poseLandmarkerPromise;
}

function dist2D(a, b) {
  if (!a || !b) return 0;
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

function angleFromHorizontalDeg(a, b) {
  if (!a || !b) return 0;
  return (Math.atan2((b.y || 0) - (a.y || 0), (b.x || 0) - (a.x || 0)) * 180) / Math.PI;
}

function angleFromVerticalDeg(upper, lower) {
  if (!upper || !lower) return 0;
  const dx = Math.abs((upper.x || 0) - (lower.x || 0));
  const dy = Math.max(0.0001, Math.abs((lower.y || 0) - (upper.y || 0)));
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/**
 * Calcul géométrique strict depuis les 33 landmarks MediaPipe :
 * Indices clés :
 * 0 Nez | 7/8 Oreilles | 11/12 Épaules | 13/14 Coudes | 15/16 Poignets
 * 23/24 Hanches | 25/26 Genoux | 27/28 Chevilles
 */
export function computeBiomechanicalRatiosFromLandmarks(landmarks, angle = 'front') {
  if (!Array.isArray(landmarks) || landmarks.length < 29) {
    return null;
  }

  const lEar = landmarks[7];
  const rEar = landmarks[8];
  const lSh = landmarks[11];
  const rSh = landmarks[12];
  const lElb = landmarks[13];
  const rElb = landmarks[14];
  const lWri = landmarks[15];
  const rWri = landmarks[16];
  const lHip = landmarks[23];
  const rHip = landmarks[24];
  const lKnee = landmarks[25];
  const rKnee = landmarks[26];
  const lAnk = landmarks[27];
  const rAnk = landmarks[28];

  const leftFemur = dist2D(lHip, lKnee);
  const rightFemur = dist2D(rHip, rKnee);
  const leftTibia = dist2D(lKnee, lAnk);
  const rightTibia = dist2D(rKnee, rAnk);

  const avgFemur = (leftFemur + rightFemur) / 2;
  const avgTibia = Math.max(0.001, (leftTibia + rightTibia) / 2);
  const femurToTibiaRatio = Number((avgFemur / avgTibia).toFixed(2));

  const shoulderWidth = dist2D(lSh, rSh);
  const hipWidth = Math.max(0.001, dist2D(lHip, rHip));
  const shoulderToHipRatio = Number((shoulderWidth / hipWidth).toFixed(2));

  const leftArm = dist2D(lSh, lElb) + dist2D(lElb, lWri);
  const rightArm = dist2D(rSh, rElb) + dist2D(rElb, rWri);
  const midEarY = ((lEar?.y || 0) + (rEar?.y || 0)) / 2;
  const midAnkY = ((lAnk?.y || 0) + (rAnk?.y || 0)) / 2;
  const approxHeight = Math.max(0.01, Math.abs(midAnkY - midEarY) * 1.12);
  const armSpanToHeightRatio = Number(((leftArm + rightArm + shoulderWidth) / approxHeight).toFixed(2));

  // Asymétries droite / gauche
  let shoulderTiltDeg = angleFromHorizontalDeg(lSh, rSh);
  if (shoulderTiltDeg > 90) shoulderTiltDeg -= 180;
  if (shoulderTiltDeg < -90) shoulderTiltDeg += 180;

  let hipTiltDeg = angleFromHorizontalDeg(lHip, rHip);
  if (hipTiltDeg > 90) hipTiltDeg -= 180;
  if (hipTiltDeg < -90) hipTiltDeg += 180;

  const armLengthDeltaPct = Number(
    ((Math.abs(leftArm - rightArm) / Math.max(0.001, (leftArm + rightArm) / 2)) * 100).toFixed(1)
  );

  // Estimation posturale (optimale sur photo Profil)
  const activeEar = (lEar?.visibility || 0) >= (rEar?.visibility || 0) ? lEar : rEar;
  const activeSh = (lSh?.visibility || 0) >= (rSh?.visibility || 0) ? lSh : rSh;
  const activeHip = (lHip?.visibility || 0) >= (rHip?.visibility || 0) ? lHip : rHip;
  const activeKnee = (lKnee?.visibility || 0) >= (rKnee?.visibility || 0) ? lKnee : rKnee;

  const forwardHeadDeg = angle === 'side' ? Number(angleFromVerticalDeg(activeEar, activeSh).toFixed(1)) : 0;
  const thoracicLeanDeg = angle === 'side' ? Number(angleFromVerticalDeg(activeSh, activeHip).toFixed(1)) : 0;
  const pelvicTiltDeg = angle === 'side' ? Number(angleFromVerticalDeg(activeHip, activeKnee).toFixed(1)) : 0;

  return {
    angle,
    landmarkCount: landmarks.length,
    segmentRatios: {
      femurToTibiaRatio,
      shoulderToHipRatio,
      armSpanToHeightRatio,
      femurClassification:
        femurToTibiaRatio > 1.12 ? 'long_femur' : femurToTibiaRatio < 0.94 ? 'short_femur' : 'balanced',
      armClassification:
        armSpanToHeightRatio > 1.04 ? 'long_arms' : armSpanToHeightRatio < 0.96 ? 'short_arms' : 'balanced',
      clavicleClassification:
        shoulderToHipRatio >= 1.42
          ? 'broad_shoulders'
          : shoulderToHipRatio <= 1.24
            ? 'narrow_shoulders'
            : 'balanced',
    },
    postureMetrics: {
      shoulderTiltDeg: Number(shoulderTiltDeg.toFixed(1)),
      hipTiltDeg: Number(hipTiltDeg.toFixed(1)),
      armLengthDeltaPct,
      forwardHeadDeg,
      thoracicLeanDeg,
      pelvicTiltDeg,
    },
  };
}

export async function analyzePhotoWithMediaPipe(imageSource, angle = 'front') {
  let imgEl = imageSource;
  let tempUrl = null;
  try {
    if (imageSource instanceof Blob || imageSource instanceof File) {
      tempUrl = URL.createObjectURL(imageSource);
      imgEl = await loadImageElement(tempUrl);
    } else if (typeof imageSource === 'string') {
      imgEl = await loadImageElement(imageSource);
    }

    const landmarker = await getPoseLandmarker();
    const result = landmarker.detect(imgEl);
    const landmarks = result?.landmarks?.[0] || null;
    if (!landmarks) {
      return {
        ok: false,
        landmarks: null,
        metrics: null,
        error: 'Silhouette non détectée clairement : vérifiez le cadrage corps entier et l’éclairage.',
      };
    }

    const metrics = computeBiomechanicalRatiosFromLandmarks(landmarks, angle);
    return { ok: true, landmarks, metrics };
  } catch (err) {
    return {
      ok: false,
      landmarks: null,
      metrics: null,
      error: `MediaPipe local indisponible (${err?.message || 'hors-ligne avant premier cache WASM'}).`,
    };
  } finally {
    if (tempUrl) URL.revokeObjectURL(tempUrl);
  }
}

/**
 * Trace les repères articulaires cliniques & fil à plomb sur un canvas superposé
 */
export function drawPoseLandmarksOverlay(canvas, landmarks) {
  if (!canvas || !Array.isArray(landmarks) || landmarks.length < 29) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Fil à plomb central de référence
  const midHipX = ((landmarks[23].x + landmarks[24].x) / 2) * w;
  ctx.save();
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(midHipX, 0);
  ctx.lineTo(midHipX, h);
  ctx.stroke();
  ctx.restore();

  // Axes d'alignement (épaules, bassin, segments fémur/tibia)
  const segments = [
    [11, 12],
    [23, 24],
    [11, 23],
    [12, 24],
    [23, 25],
    [25, 27],
    [24, 26],
    [26, 28],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
  ];

  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 2;
  for (const [aIdx, bIdx] of segments) {
    const a = landmarks[aIdx];
    const b = landmarks[bIdx];
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  }

  // Points de repère articulaires clés
  const keyJoints = [7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  for (const idx of keyJoints) {
    const pt = landmarks[idx];
    if (!pt) continue;
    ctx.fillStyle = '#090A0C';
    ctx.strokeStyle = '#F3F5F8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/* ==========================================================================
   5. PIPELINE DOUBLE ANALYSE (MEDIAPIPE LOCAL + IA VISION NORMALISÉE JSON)
   ========================================================================== */

export async function runDualPhysiqueAnalysis({
  photos = [], // [{ angle: 'front'|'side'|'back', dataUrl, blob }]
  profile = {},
  aiSettings = null,
  latestBiometrics = null,
}) {
  // Étape 1 : Extraction locale MediaPipe sur chaque angle disponible
  const mergedRatios = {};
  const mergedPosture = {};
  const perAngleMediaPipe = {};

  for (const photo of photos) {
    const source = photo.dataUrl || photo.blob;
    if (!source) continue;
    const mp = await analyzePhotoWithMediaPipe(source, photo.angle);
    perAngleMediaPipe[photo.angle] = mp;
    if (mp.ok && mp.metrics) {
      if (photo.angle === 'front' || photo.angle === 'back') {
        Object.assign(mergedRatios, mp.metrics.segmentRatios);
        mergedPosture.shoulderTiltDeg = mp.metrics.postureMetrics.shoulderTiltDeg;
        mergedPosture.hipTiltDeg = mp.metrics.postureMetrics.hipTiltDeg;
        mergedPosture.armLengthDeltaPct = mp.metrics.postureMetrics.armLengthDeltaPct;
      }
      if (photo.angle === 'side') {
        mergedPosture.forwardHeadDeg = mp.metrics.postureMetrics.forwardHeadDeg;
        mergedPosture.thoracicLeanDeg = mp.metrics.postureMetrics.thoracicLeanDeg;
        mergedPosture.pelvicTiltDeg = mp.metrics.postureMetrics.pelvicTiltDeg;
        if (!mergedRatios.femurToTibiaRatio) {
          mergedRatios.femurToTibiaRatio = mp.metrics.segmentRatios.femurToTibiaRatio;
        }
      }
    }
  }

  // Étape 2 : Construction du prompt biomécanique normalisé (14 groupes musculaires stricts)
  const groupKeys = Object.keys(MUSCLE_GROUPS).join(', ');
  const images = [];
  for (const p of photos) {
    if (p.dataUrl) images.push(p.dataUrl);
    else if (p.blob instanceof Blob) images.push(await blobToDataUrl(p.blob));
  }

  const systemPrompt =
    'Tu es un préparateur physique expert en biomécanique et évaluation morpho-anatomique. Réponds STRICTEMENT en JSON valide sans aucun texte autour.';

  const prompt = `Analyse ces photos de check-in physique (${photos.map((p) => p.angle).join(', ')}) croisées avec les mesures locales MediaPipe et biométriques.
Profil : ${profile.sex || 'male'}, ${profile.age || 28} ans, ${profile.heightCm || 176} cm, ${latestBiometrics?.weightKg || profile.weightKg || 75} kg, objectif : ${profile.goal || 'recomp'}.
Biométrie récente : %MG balance=${latestBiometrics?.bodyFatPct ?? 'inconnu'}, %MG US Navy=${latestBiometrics?.navyBodyFatPct ?? 'inconnu'}, tour de taille=${latestBiometrics?.waistCm ?? 'inconnu'} cm.
Ratios MediaPipe 33 landmarks : ${JSON.stringify(mergedRatios)}.
Angles posturaux MediaPipe : ${JSON.stringify(mergedPosture)}.

Renvoie EXACTEMENT ce schéma JSON :
{
  "muscle_scores": [
    { "group": "<un parmi: ${groupKeys}>", "label": "<nom FR>", "score": 0-100, "status": "LAG" | "BALANCED" | "DOMINANT" }
  ],
  "asymmetries": [
    { "zone": "<zone>", "delta_deg": 0.0, "description": "<description précise>", "action": "inject_unilateral" }
  ],
  "posture": {
    "shoulder_tilt_deg": 0.0,
    "pelvic_tilt_deg": 0.0,
    "forward_head_deg": 0.0,
    "flags": ["<observation posturale ou levier segmentaire>"]
  },
  "visual_evolution_summary": "<synthèse concise croisée avec la balance et les mensurations>"
}`;

  const routed = await routeAIRequest({
    taskType: 'physique_analysis',
    prompt,
    systemPrompt,
    images,
    context: {
      profile,
      segmentRatios: mergedRatios,
      postureMetrics: mergedPosture,
    },
    settings: aiSettings,
    expectJson: true,
  });

  // Normalisation des statuts & enrichissement systématique avec la géométrie MediaPipe locale
  const normalizedData = {
    ...routed.data,
    muscle_scores: (routed.data?.muscle_scores || []).map((m) => ({
      group: m.group,
      label: m.label || MUSCLE_GROUPS[m.group]?.label || m.group,
      score: Math.max(0, Math.min(100, Number(m.score) || 70)),
      status: String(m.status || 'BALANCED').toUpperCase(),
    })),
    mediapipe: {
      segmentRatios: mergedRatios,
      postureMetrics: mergedPosture,
      anglesProcessed: Object.keys(perAngleMediaPipe),
      landmarksByAngle: Object.fromEntries(
        Object.entries(perAngleMediaPipe).map(([ang, res]) => [ang, res.landmarks || null])
      ),
    },
    meta: {
      tierUsed: routed.tierUsed,
      provider: routed.provider,
      usedFallback: routed.usedFallback,
      fallbackReason: routed.fallbackReason,
      latencyMs: routed.latencyMs,
      analyzedAt: new Date().toISOString(),
    },
  };

  return normalizedData;
}
