/**
 * Kinetix Lab — Moteur Nutritionnel Auto-Adaptatif & Biométrie Avancée (js/nutrition-db.js)
 * - Base française Ciqual (ANSES) embarquée 100 % hors-ligne (~60 aliments clés)
 * - Intégration Open Food Facts API (0 clé) + Scanner Code-Barres caméra (html5-qrcode)
 * - Poids lissé EWMA & TDEE Auto-Adaptatif sur 14–21 jours avec proposition d'ajustement ±100/150 kcal
 * - Biométrie multi-sources : Katch-McArdle / Mifflin-St Jeor, %MG US Navy & ratio Taille/Hauteur (WHtR)
 * - Analyse photo d'assiette & OCR balance via ai-router.js
 * - Générateur de plans types & liste de courses interactive classée par rayon
 */

import { routeAIRequest } from './ai-router.js';

/* ==========================================================================
   1. BASE FRANÇAISE CIQUAL (ANSES) EMBARQUÉE HORS-LIGNE (VALEURS POUR 100 G)
   ========================================================================== */

export const CIQUAL_DB = Object.freeze([
  // Protéines animales & œufs
  { id: 'ciq_poulet_filet', name: 'Blanc de poulet (filet, cru)', kcal: 114, proteinG: 23.2, carbsG: 0, fatG: 1.9, fiberG: 0, aisle: 'Boucherie & Poissonnerie', diets: ['omnivore', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_dinde_escalope', name: 'Escalope de dinde', kcal: 109, proteinG: 23.6, carbsG: 0, fatG: 1.4, fiberG: 0, aisle: 'Boucherie & Poissonnerie', diets: ['omnivore', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_boeuf_5', name: 'Steak haché bœuf 5 % MG', kcal: 127, proteinG: 21.0, carbsG: 0, fatG: 4.8, fiberG: 0, aisle: 'Boucherie & Poissonnerie', diets: ['omnivore', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_saumon', name: 'Pavé de saumon frais', kcal: 205, proteinG: 20.4, carbsG: 0, fatG: 13.6, fiberG: 0, aisle: 'Boucherie & Poissonnerie', diets: ['omnivore', 'pescatarian', 'halal', 'gluten_free'], allergens: ['fish'] },
  { id: 'ciq_cabillaud', name: 'Dos de cabillaud', kcal: 82, proteinG: 18.0, carbsG: 0, fatG: 0.7, fiberG: 0, aisle: 'Boucherie & Poissonnerie', diets: ['omnivore', 'pescatarian', 'halal', 'gluten_free'], allergens: ['fish'] },
  { id: 'ciq_thon_nat', name: 'Thon au naturel (égoutté)', kcal: 112, proteinG: 25.5, carbsG: 0, fatG: 1.0, fiberG: 0, aisle: 'Épicerie & Conserves', diets: ['omnivore', 'pescatarian', 'halal', 'gluten_free'], allergens: ['fish'] },
  { id: 'ciq_sardines', name: 'Sardines au naturel', kcal: 158, proteinG: 21.2, carbsG: 0, fatG: 8.1, fiberG: 0, aisle: 'Épicerie & Conserves', diets: ['omnivore', 'pescatarian', 'halal', 'gluten_free'], allergens: ['fish'] },
  { id: 'ciq_crevettes', name: 'Crevettes cuites décortiquées', kcal: 94, proteinG: 20.8, carbsG: 0.5, fatG: 0.9, fiberG: 0, aisle: 'Boucherie & Poissonnerie', diets: ['omnivore', 'pescatarian', 'gluten_free'], allergens: ['shellfish'] },
  { id: 'ciq_oeuf', name: 'Œuf entier (calibre M ≈ 60 g)', kcal: 145, proteinG: 12.7, carbsG: 0.7, fatG: 10.1, fiberG: 0, aisle: 'Crèmerie & Œufs', diets: ['omnivore', 'vegetarian', 'pescatarian', 'halal', 'gluten_free'], allergens: ['eggs'] },
  { id: 'ciq_blanc_oeuf', name: 'Blanc d’œuf liquide', kcal: 48, proteinG: 10.8, carbsG: 0.7, fatG: 0.2, fiberG: 0, aisle: 'Crèmerie & Œufs', diets: ['omnivore', 'vegetarian', 'pescatarian', 'halal', 'gluten_free'], allergens: ['eggs'] },

  // Produits laitiers & Protéines
  { id: 'ciq_skyr', name: 'Skyr nature 0 % MG', kcal: 62, proteinG: 10.0, carbsG: 4.0, fatG: 0.2, fiberG: 0, aisle: 'Crèmerie & Œufs', diets: ['omnivore', 'vegetarian', 'pescatarian', 'halal', 'gluten_free'], allergens: ['dairy'] },
  { id: 'ciq_fromage_blanc_0', name: 'Fromage blanc 0 % MG', kcal: 47, proteinG: 7.8, carbsG: 3.8, fatG: 0.1, fiberG: 0, aisle: 'Crèmerie & Œufs', diets: ['omnivore', 'vegetarian', 'pescatarian', 'halal', 'gluten_free'], allergens: ['dairy'] },
  { id: 'ciq_fromage_blanc_3', name: 'Fromage blanc 3 % MG', kcal: 73, proteinG: 7.4, carbsG: 3.6, fatG: 3.2, fiberG: 0, aisle: 'Crèmerie & Œufs', diets: ['omnivore', 'vegetarian', 'pescatarian', 'halal', 'gluten_free'], allergens: ['dairy'] },
  { id: 'ciq_cottage', name: 'Cottage cheese nature', kcal: 98, proteinG: 12.2, carbsG: 2.7, fatG: 4.2, fiberG: 0, aisle: 'Crèmerie & Œufs', diets: ['omnivore', 'vegetarian', 'pescatarian', 'halal', 'gluten_free'], allergens: ['dairy'] },
  { id: 'ciq_whey_iso', name: 'Whey Isolate nature', kcal: 372, proteinG: 86.0, carbsG: 2.5, fatG: 1.5, fiberG: 0, aisle: 'Nutrition Sportive', diets: ['omnivore', 'vegetarian', 'pescatarian', 'halal', 'gluten_free'], allergens: ['dairy'] },
  { id: 'ciq_prot_pois', name: 'Protéine végétale (pois/riz)', kcal: 380, proteinG: 78.0, carbsG: 6.0, fatG: 4.5, fiberG: 3.5, aisle: 'Nutrition Sportive', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },

  // Protéines végétales
  { id: 'ciq_tofu_ferme', name: 'Tofu ferme nature', kcal: 138, proteinG: 14.5, carbsG: 1.8, fatG: 8.2, fiberG: 1.2, aisle: 'Protéines Végétales', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: ['soy'] },
  { id: 'ciq_tempeh', name: 'Tempeh nature', kcal: 193, proteinG: 19.5, carbsG: 7.6, fatG: 10.8, fiberG: 4.5, aisle: 'Protéines Végétales', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: ['soy'] },
  { id: 'ciq_lentilles_cuites', name: 'Lentilles vertes cuites', kcal: 116, proteinG: 9.0, carbsG: 16.5, fatG: 0.4, fiberG: 7.9, aisle: 'Épicerie & Féculents', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_pois_chiches', name: 'Pois chiches cuits', kcal: 148, proteinG: 8.3, carbsG: 21.0, fatG: 2.6, fiberG: 7.2, aisle: 'Épicerie & Féculents', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_edamame', name: 'Edamame (fèves de soja cuites)', kcal: 122, proteinG: 11.9, carbsG: 8.9, fatG: 5.2, fiberG: 5.2, aisle: 'Surgelés & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: ['soy'] },
  { id: 'ciq_seitan', name: 'Seitan nature', kcal: 148, proteinG: 24.5, carbsG: 6.5, fatG: 2.1, fiberG: 1.2, aisle: 'Protéines Végétales', diets: ['omnivore', 'vegetarian', 'vegan', 'halal'], allergens: ['gluten'] },

  // Glucides complexes & Féculents
  { id: 'ciq_riz_basmati_cru', name: 'Riz basmati (poids cru)', kcal: 354, proteinG: 8.2, carbsG: 77.5, fatG: 0.7, fiberG: 1.4, aisle: 'Épicerie & Féculents', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_riz_basmati_cuit', name: 'Riz basmati cuit', kcal: 126, proteinG: 2.9, carbsG: 27.6, fatG: 0.3, fiberG: 0.5, aisle: 'Épicerie & Féculents', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_flocons_avoine', name: 'Flocons d’avoine complets', kcal: 368, proteinG: 13.5, carbsG: 58.7, fatG: 7.0, fiberG: 10.1, aisle: 'Épicerie & Féculents', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal'], allergens: ['gluten'] },
  { id: 'ciq_patate_douce', name: 'Patate douce cuite vapeur', kcal: 86, proteinG: 1.6, carbsG: 18.2, fatG: 0.2, fiberG: 3.0, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_pomme_terre', name: 'Pomme de terre vapeur', kcal: 80, proteinG: 2.0, carbsG: 16.7, fatG: 0.1, fiberG: 1.8, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_pates_completes_cru', name: 'Pâtes complètes (poids cru)', kcal: 348, proteinG: 13.2, carbsG: 66.0, fatG: 2.1, fiberG: 7.5, aisle: 'Épicerie & Féculents', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal'], allergens: ['gluten'] },
  { id: 'ciq_quinoa_cuit', name: 'Quinoa cuit', kcal: 120, proteinG: 4.4, carbsG: 20.3, fatG: 1.9, fiberG: 2.8, aisle: 'Épicerie & Féculents', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_pain_complet', name: 'Pain complet au levain', kcal: 247, proteinG: 9.2, carbsG: 45.8, fatG: 1.8, fiberG: 6.8, aisle: 'Boulangerie', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal'], allergens: ['gluten'] },
  { id: 'ciq_sarrasin_cuit', name: 'Sarrasin (kasha) cuit', kcal: 108, proteinG: 3.8, carbsG: 21.0, fatG: 0.8, fiberG: 2.7, aisle: 'Épicerie & Féculents', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },

  // Légumes & Fibres
  { id: 'ciq_brocoli', name: 'Brocoli vapeur', kcal: 34, proteinG: 2.8, carbsG: 4.0, fatG: 0.4, fiberG: 3.0, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_haricots_verts', name: 'Haricots verts cuits', kcal: 31, proteinG: 1.9, carbsG: 4.5, fatG: 0.2, fiberG: 3.4, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_epinards', name: 'Épinards frais / cuits', kcal: 23, proteinG: 2.9, carbsG: 1.4, fatG: 0.4, fiberG: 2.6, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_courgette', name: 'Courgette cuite', kcal: 17, proteinG: 1.2, carbsG: 2.4, fatG: 0.2, fiberG: 1.1, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_poivron', name: 'Poivron rouge cru', kcal: 31, proteinG: 1.0, carbsG: 5.5, fatG: 0.3, fiberG: 2.1, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_tomate', name: 'Tomate fraîche', kcal: 19, proteinG: 0.9, carbsG: 3.2, fatG: 0.2, fiberG: 1.2, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },

  // Fruits
  { id: 'ciq_banane', name: 'Banane fraîche', kcal: 90, proteinG: 1.1, carbsG: 20.5, fatG: 0.3, fiberG: 2.6, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_pomme', name: 'Pomme fraîche', kcal: 54, proteinG: 0.3, carbsG: 12.5, fatG: 0.2, fiberG: 2.4, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_myrtilles', name: 'Myrtilles / Fruits rouges', kcal: 57, proteinG: 0.7, carbsG: 12.2, fatG: 0.3, fiberG: 2.4, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_kiwi', name: 'Kiwi frais', kcal: 61, proteinG: 1.1, carbsG: 12.0, fatG: 0.5, fiberG: 3.0, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },

  // Lipides de qualité & Oléagineux
  { id: 'ciq_huile_olive', name: 'Huile d’olive vierge extra', kcal: 900, proteinG: 0, carbsG: 0, fatG: 100.0, fiberG: 0, aisle: 'Oléagineux & Huiles', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_avocat', name: 'Avocat frais (pulpe)', kcal: 169, proteinG: 1.8, carbsG: 1.8, fatG: 15.8, fiberG: 6.7, aisle: 'Fruits & Légumes', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_amandes', name: 'Amandes naturelles', kcal: 598, proteinG: 21.4, carbsG: 9.5, fatG: 51.5, fiberG: 12.2, aisle: 'Oléagineux & Huiles', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: ['nuts'] },
  { id: 'ciq_noix', name: 'Cerneaux de noix (Oméga-3)', kcal: 673, proteinG: 15.2, carbsG: 7.0, fatG: 65.2, fiberG: 6.7, aisle: 'Oléagineux & Huiles', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: ['nuts'] },
  { id: 'ciq_beurre_cacahuete', name: 'Purée de cacahuète 100 %', kcal: 604, proteinG: 25.8, carbsG: 12.0, fatG: 49.6, fiberG: 8.0, aisle: 'Oléagineux & Huiles', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: ['peanuts'] },
  { id: 'ciq_graines_chia', name: 'Graines de chia', kcal: 486, proteinG: 16.5, carbsG: 8.0, fatG: 30.7, fiberG: 34.4, aisle: 'Oléagineux & Huiles', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
  { id: 'ciq_chocolat_85', name: 'Chocolat noir 85 % cacao', kcal: 584, proteinG: 10.5, carbsG: 21.0, fatG: 48.0, fiberG: 12.0, aisle: 'Épicerie & Féculents', diets: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'], allergens: [] },
]);

export function searchCiqualOffline(query = '', profile = null) {
  const q = String(query || '').trim().toLowerCase();
  const diet = profile?.nutritionPrefs?.dietType || 'omnivore';
  const allergies = new Set((profile?.nutritionPrefs?.allergies || []).map((a) => String(a).toLowerCase()));

  return CIQUAL_DB.filter((item) => {
    const dietOk = diet === 'omnivore' || item.diets.includes(diet);
    const allergyOk = !item.allergens.some((a) => allergies.has(a));
    if (!dietOk || !allergyOk) return false;
    if (!q) return true;
    return item.name.toLowerCase().includes(q) || item.aisle.toLowerCase().includes(q);
  });
}

export function scaleFoodMacros(foodPer100g, grams = 100) {
  const factor = Math.max(0, Number(grams) || 0) / 100;
  return {
    grams: Math.round(Number(grams) || 0),
    kcal: Math.round((foodPer100g.kcal || 0) * factor),
    proteinG: Math.round((foodPer100g.proteinG || 0) * factor * 10) / 10,
    carbsG: Math.round((foodPer100g.carbsG || 0) * factor * 10) / 10,
    fatG: Math.round((foodPer100g.fatG || 0) * factor * 10) / 10,
    fiberG: Math.round((foodPer100g.fiberG || 0) * factor * 10) / 10,
  };
}

/* ==========================================================================
   2. OPEN FOOD FACTS API (0 CLÉ) & SCANNER CODE-BARRES (HTML5-QRCODE)
   ========================================================================== */

const barcodeCache = new Map();

function normalizeOpenFoodFactsProduct(product) {
  if (!product) return null;
  const n = product.nutriments || {};
  const kcal =
    Number(n['energy-kcal_100g']) ||
    (Number(n['energy-kj_100g']) ? Math.round(Number(n['energy-kj_100g']) / 4.184) : 0);

  return {
    barcode: product.code || '',
    name: product.product_name_fr || product.product_name || 'Produit scanné',
    brand: product.brands || '',
    servingSize: product.serving_size || '100 g',
    nutriscore: product.nutriscore_grade ? String(product.nutriscore_grade).toUpperCase() : null,
    kcal: Math.round(kcal),
    proteinG: Number((Number(n.proteins_100g) || 0).toFixed(1)),
    carbsG: Number((Number(n.carbohydrates_100g) || 0).toFixed(1)),
    fatG: Number((Number(n.fat_100g) || 0).toFixed(1)),
    fiberG: Number((Number(n.fiber_100g) || 0).toFixed(1)),
    imageUrl: product.image_front_small_url || null,
    source: 'open_food_facts',
  };
}

export async function lookupBarcodeOpenFoodFacts(barcode) {
  const cleanCode = String(barcode || '').replace(/\D+/g, '');
  if (cleanCode.length < 6) {
    throw new Error('Code-barres invalide (minimum 6 chiffres).');
  }
  if (barcodeCache.has(cleanCode)) {
    return barcodeCache.get(cleanCode);
  }

  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanCode)}.json?fields=code,product_name,product_name_fr,brands,serving_size,nutriscore_grade,nutriments,image_front_small_url`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open Food Facts indisponible (HTTP ${res.status}).`);
  }
  const json = await res.json();
  if (json.status !== 1 || !json.product) {
    throw new Error(`Produit introuvable pour le code ${cleanCode}.`);
  }
  const normalized = normalizeOpenFoodFactsProduct(json.product);
  barcodeCache.set(cleanCode, normalized);
  return normalized;
}

export async function searchOpenFoodFactsText(query, pageSize = 8) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const url = `https://fr.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=${pageSize}&fields=code,product_name,product_name_fr,brands,serving_size,nutriscore_grade,nutriments,image_front_small_url`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.products || [])
    .map(normalizeOpenFoodFactsProduct)
    .filter((p) => p && p.name && (p.kcal > 0 || p.proteinG > 0));
}

let html5QrcodeScriptPromise = null;

function ensureHtml5QrcodeLoaded() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Navigateur requis.'));
  if (window.Html5Qrcode) return Promise.resolve(window.Html5Qrcode);
  if (html5QrcodeScriptPromise) return html5QrcodeScriptPromise;

  html5QrcodeScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    script.async = true;
    script.onload = () => {
      if (window.Html5Qrcode) resolve(window.Html5Qrcode);
      else reject(new Error('html5-qrcode introuvable après chargement.'));
    };
    script.onerror = () => {
      html5QrcodeScriptPromise = null;
      reject(new Error('Impossible de charger html5-qrcode (vérifiez la connexion).'));
    };
    document.head.appendChild(script);
  });
  return html5QrcodeScriptPromise;
}

export class BarcodeScannerController {
  constructor(elementId) {
    this.elementId = elementId;
    this.instance = null;
    this.running = false;
  }

  async start(onDetected, onError = null) {
    await this.stop();
    const Html5Qrcode = await ensureHtml5QrcodeLoaded();
    this.instance = new Html5Qrcode(this.elementId);
    this.running = true;

    await this.instance.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 130 } },
      async (decodedText) => {
        await this.stop();
        if (typeof onDetected === 'function') onDetected(decodedText);
      },
      (scanErr) => {
        if (typeof onError === 'function') onError(scanErr);
      }
    );
  }

  async stop() {
    if (this.instance && this.running) {
      try {
        await this.instance.stop();
        await this.instance.clear();
      } catch {
        // Ignorer arrêt déjà effectif
      }
    }
    this.running = false;
    this.instance = null;
  }
}

/* ==========================================================================
   3. BIOMÉTRIE AVANCÉE : US NAVY %MG, WHtR, KATCH-McARDLE / MIFFLIN-ST JEOR
   ========================================================================== */

export function computeUSNavyBodyFat({ sex = 'male', heightCm, neckCm, waistCm, hipsCm = null }) {
  const h = Number(heightCm);
  const neck = Number(neckCm);
  const waist = Number(waistCm);
  const hips = Number(hipsCm);

  if (!h || !neck || !waist || h < 120 || waist <= neck) {
    return null;
  }

  const hIn = h / 2.54;
  const neckIn = neck / 2.54;
  const waistIn = waist / 2.54;
  const hipsIn = hips ? hips / 2.54 : 0;

  let bf = null;
  if (sex === 'female') {
    if (!hipsIn || waistIn + hipsIn <= neckIn) return null;
    bf =
      163.205 * Math.log10(waistIn + hipsIn - neckIn) -
      97.684 * Math.log10(hIn) -
      78.387;
  } else {
    bf =
      86.01 * Math.log10(waistIn - neckIn) -
      70.041 * Math.log10(hIn) +
      36.76;
  }

  if (!Number.isFinite(bf)) return null;
  return Number(Math.max(4, Math.min(60, bf)).toFixed(1));
}

export function computeWHtR(waistCm, heightCm) {
  const w = Number(waistCm);
  const h = Number(heightCm);
  if (!w || !h || h < 100) return null;
  const ratio = Number((w / h).toFixed(3));
  let classification = 'Optimal';
  if (ratio < 0.43) classification = 'Minceur prononcée';
  else if (ratio <= 0.5) classification = 'Zone santé optimale (< 0,50)';
  else if (ratio <= 0.57) classification = 'Risque métabolique modéré';
  else classification = 'Risque viscéral élevé (>= 0,58)';
  return { ratio, classification };
}

export function computeBMR(profile, bodyFatPct = null) {
  const weight = Number(profile?.weightKg) || 75;
  const height = Number(profile?.heightCm) || 176;
  const age = Number(profile?.age) || 28;
  const sex = profile?.sex || 'male';

  if (typeof bodyFatPct === 'number' && bodyFatPct >= 4 && bodyFatPct <= 60) {
    const leanMassKg = weight * (1 - bodyFatPct / 100);
    return {
      formula: 'Katch-McArdle',
      bmrKcal: Math.round(370 + 21.6 * leanMassKg),
      leanMassKg: Number(leanMassKg.toFixed(1)),
    };
  }

  const mifflin =
    10 * weight + 6.25 * height - 5 * age + (sex === 'female' ? -161 : 5);
  const estimatedBf = sex === 'female' ? 24 : 17;
  return {
    formula: 'Mifflin-St Jeor',
    bmrKcal: Math.round(mifflin),
    leanMassKg: Number((weight * (1 - estimatedBf / 100)).toFixed(1)),
  };
}

/* ==========================================================================
   4. POIDS LISSÉ (EWMA), GARDE-FOUS DÉRIVE & TDEE AUTO-ADAPTATIF (14–21 J)
   ========================================================================== */

export const ADAPTIVE_KCAL_MIN = -400;
export const ADAPTIVE_KCAL_MAX = 400;
export const EWMA_MAX_CONSECUTIVE_JUMP_KG = 2.5;

export function clampAdaptiveAdjustmentKcal(value) {
  const n = Math.round(Number(value) || 0);
  return Math.max(ADAPTIVE_KCAL_MIN, Math.min(ADAPTIVE_KCAL_MAX, n));
}

/**
 * Vérifie une valeur persistée d'ajustement adaptatif :
 * si elle est hors-bornes (< -400 ou > +400, ex. bug historique -2280 kcal),
 * elle est automatiquement réinitialisée à 0 pour débloquer le profil.
 */
export function sanitizeStoredAdaptiveAdjustmentKcal(rawValue) {
  const n = Number(rawValue);
  if (!Number.isFinite(n)) {
    return { value: 0, wasCorrupted: false };
  }
  if (n < ADAPTIVE_KCAL_MIN || n > ADAPTIVE_KCAL_MAX) {
    return { value: 0, wasCorrupted: true, previousValue: Math.round(n) };
  }
  return { value: Math.round(n), wasCorrupted: false };
}

export function getProfileAdaptiveAdjustmentKcal(profile) {
  const prefs = profile?.nutritionPrefs || {};
  const raw =
    prefs.adaptiveAdjustmentKcal !== undefined && prefs.adaptiveAdjustmentKcal !== null
      ? prefs.adaptiveAdjustmentKcal
      : prefs.manualKcalOffset;
  return sanitizeStoredAdaptiveAdjustmentKcal(raw).value;
}

export function computeSafeCalorieFloor(bmrKcal) {
  const bmr = Number(bmrKcal) || 1750;
  return Math.max(1500, Math.round(bmr * 0.85));
}

export function computeEWMASeries(biometrics = [], alpha = 0.2, { baselineDate = null, maxJumpKg = EWMA_MAX_CONSECUTIVE_JUMP_KG } = {}) {
  const sorted = [...(biometrics || [])]
    .filter((b) => typeof b?.weightKg === 'number' && Number.isFinite(b.weightKg) && b.weightKg > 25 && b.weightKg < 300)
    .filter((b) => !baselineDate || !b.date || b.date >= baselineDate)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.timestamp || 0) - (b.timestamp || 0));

  // Si un point "baseline_reset" explicite existe dans la série, on démarre proprement à partir du dernier reset
  let startIdx = 0;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].source === 'baseline_reset') {
      startIdx = i;
      break;
    }
  }
  const activeCandidates = sorted.slice(startIdx);

  // Garde-fou dérive pondérale : filtre les sauts aberrants (> 2,5 kg entre deux pesées consécutives)
  const accepted = [];
  const skippedOutliers = [];
  let prevWeight = null;

  for (const entry of activeCandidates) {
    if (prevWeight !== null && Math.abs(entry.weightKg - prevWeight) > maxJumpKg) {
      skippedOutliers.push({
        date: entry.date,
        weightKg: entry.weightKg,
        prevWeightKg: prevWeight,
        deltaKg: Number((entry.weightKg - prevWeight).toFixed(2)),
      });
      continue;
    }
    accepted.push(entry);
    prevWeight = entry.weightKg;
  }

  let ewma = null;
  const series = accepted.map((entry) => {
    ewma = ewma === null ? entry.weightKg : alpha * entry.weightKg + (1 - alpha) * ewma;
    return {
      ...entry,
      ewmaWeightKg: Number(ewma.toFixed(2)),
    };
  });

  const latest = series[series.length - 1] || null;
  let weeklyDeltaKg = 0;

  if (series.length >= 2) {
    const lookbackIdx = Math.max(0, series.length - Math.min(series.length, 8));
    const ref = series[lookbackIdx];
    const latestTs = new Date(latest.date).getTime();
    const refTs = new Date(ref.date).getTime();
    const daysDiff = Number.isFinite(latestTs) && Number.isFinite(refTs)
      ? Math.max(0, (latestTs - refTs) / (24 * 60 * 60 * 1000))
      : 0;

    // Évite l'extrapolation ×7 absurde sur un écart de 0–2 jours
    const rawWeekly =
      daysDiff >= 3
        ? ((latest.ewmaWeightKg - ref.ewmaWeightKg) / daysDiff) * 7
        : latest.ewmaWeightKg - ref.ewmaWeightKg;

    // Plafond de sécurité physiologique absolu sur la vitesse hebdo lissée
    weeklyDeltaKg = Number(Math.max(-2.5, Math.min(2.5, rawWeekly)).toFixed(2));
  }

  return {
    series,
    skippedOutliers,
    latestRawKg: latest?.weightKg ?? null,
    latestEwmaKg: latest?.ewmaWeightKg ?? null,
    weeklyDeltaKg,
  };
}

export function computeBaselineTDEE(profile, bodyFatPct = null) {
  const { bmrKcal, formula, leanMassKg } = computeBMR(profile, bodyFatPct);
  const neatMap = { sedentary: 1.25, mixed: 1.4, active: 1.58 };
  const neatFactor = neatMap[profile?.lifestyle?.neatLevel] || 1.4;
  const sessions = Number(profile?.sessionsPerWeek) || 4;
  const trainingBonusKcal = Math.round((sessions * 260) / 7);
  const tdeeKcal = Math.round(bmrKcal * neatFactor + trainingBonusKcal);

  return { bmrKcal, formula, leanMassKg, tdeeKcal };
}

export function computeAdaptiveTDEE({ biometrics = [], nutritionLogs = [], profile, bodyFatPct = null, windowDays = 14 }) {
  const baseline = computeBaselineTDEE(profile, bodyFatPct);
  const baselineDate = profile?.nutritionPrefs?.ewmaBaselineDate || null;
  const ewmaInfo = computeEWMASeries(biometrics, 0.2, { baselineDate });
  const overrideLocked = Boolean(profile?.nutritionPrefs?.nutritionOverride?.enabled && profile?.nutritionPrefs?.nutritionOverride?.locked);

  if (ewmaInfo.series.length < 4) {
    return {
      ...baseline,
      adaptiveActive: false,
      confidence: 'low',
      estimatedTdeeKcal: baseline.tdeeKcal,
      ewmaDeltaKg: 0,
      avgLoggedKcal: null,
      adjustmentProposal: null,
      skippedOutliersCount: ewmaInfo.skippedOutliers.length,
      note: 'Enregistrez au moins 4 pesées cohérentes et 5 jours de calories pour activer le calcul TDEE adaptatif.',
    };
  }

  const latestDate = new Date(ewmaInfo.series[ewmaInfo.series.length - 1].date);
  const cutoffTs = latestDate.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const windowWeights = ewmaInfo.series.filter((e) => new Date(e.date).getTime() >= cutoffTs);
  if (windowWeights.length < 2) {
    return {
      ...baseline,
      adaptiveActive: false,
      confidence: 'low',
      estimatedTdeeKcal: baseline.tdeeKcal,
      ewmaDeltaKg: 0,
      avgLoggedKcal: null,
      adjustmentProposal: null,
      skippedOutliersCount: ewmaInfo.skippedOutliers.length,
      note: 'Fenêtre de pesées insuffisante sur les 14–21 derniers jours.',
    };
  }

  // Agrégation calories par jour sur la fenêtre
  const dailyKcalMap = new Map();
  for (const log of nutritionLogs || []) {
    if (!log.date) continue;
    if (baselineDate && log.date < baselineDate) continue;
    const ts = new Date(log.date).getTime();
    if (ts >= cutoffTs && ts <= latestDate.getTime()) {
      dailyKcalMap.set(log.date, (dailyKcalMap.get(log.date) || 0) + (Number(log.kcal) || 0));
    }
  }

  const loggedDays = Array.from(dailyKcalMap.values()).filter((k) => k >= 600);
  if (loggedDays.length < 5) {
    return {
      ...baseline,
      adaptiveActive: false,
      confidence: 'low',
      estimatedTdeeKcal: baseline.tdeeKcal,
      ewmaDeltaKg: Number((windowWeights[windowWeights.length - 1].ewmaWeightKg - windowWeights[0].ewmaWeightKg).toFixed(2)),
      avgLoggedKcal: loggedDays.length ? Math.round(loggedDays.reduce((a, b) => a + b, 0) / loggedDays.length) : null,
      adjustmentProposal: null,
      skippedOutliersCount: ewmaInfo.skippedOutliers.length,
      note: `${loggedDays.length}/5 jours caloriques complets : continuez la saisie pour calibrer votre TDEE réel.`,
    };
  }

  const first = windowWeights[0];
  const last = windowWeights[windowWeights.length - 1];
  const spanDays = Math.max(
    7,
    Math.round((new Date(last.date).getTime() - new Date(first.date).getTime()) / (24 * 60 * 60 * 1000))
  );
  const ewmaDeltaKg = Number((last.ewmaWeightKg - first.ewmaWeightKg).toFixed(2));
  const avgLoggedKcal = Math.round(loggedDays.reduce((a, b) => a + b, 0) / loggedDays.length);

  // 1 kg tissu corporel ≈ 7700 kcal -> TDEE = Apports - (deltaKg * 7700 / jours)
  const rawAdaptiveTdee = Math.round(avgLoggedKcal - (ewmaDeltaKg * 7700) / spanDays);
  // Amortissement sécuritaire (±25 % max par rapport à la base théorique)
  const estimatedTdeeKcal = Math.max(
    Math.round(baseline.tdeeKcal * 0.75),
    Math.min(Math.round(baseline.tdeeKcal * 1.25), rawAdaptiveTdee)
  );

  const weeklyRatePct = ((ewmaDeltaKg / spanDays) * 7) / Math.max(35, last.ewmaWeightKg) * 100;
  const currentAdaptiveAdj = getProfileAdaptiveAdjustmentKcal(profile);
  let adjustmentProposal = null;

  if (!overrideLocked) {
    if (profile?.goal === 'fat_loss') {
      if (weeklyRatePct > -0.25 && currentAdaptiveAdj > ADAPTIVE_KCAL_MIN) {
        const delta = Math.max(ADAPTIVE_KCAL_MIN - currentAdaptiveAdj, -150);
        if (delta !== 0) {
          adjustmentProposal = {
            deltaKcal: delta,
            reason: `Plateau détecté (tendance EWMA ${ewmaDeltaKg >= 0 ? '+' : ''}${ewmaDeltaKg} kg sur ${spanDays} j) : réduire de ${Math.abs(delta)} kcal/j.`,
          };
        }
      } else if (weeklyRatePct < -1.1 && currentAdaptiveAdj < ADAPTIVE_KCAL_MAX) {
        const delta = Math.min(ADAPTIVE_KCAL_MAX - currentAdaptiveAdj, +125);
        if (delta !== 0) {
          adjustmentProposal = {
            deltaKcal: delta,
            reason: `Perte trop rapide (${weeklyRatePct.toFixed(2)} %/sem) : remonter de +${delta} kcal/j pour préserver la masse musculaire.`,
          };
        }
      }
    } else if (profile?.goal === 'lean_bulk' || profile?.goal === 'hypertrophy') {
      if (weeklyRatePct < 0.1 && currentAdaptiveAdj < ADAPTIVE_KCAL_MAX) {
        const delta = Math.min(ADAPTIVE_KCAL_MAX - currentAdaptiveAdj, +150);
        if (delta !== 0) {
          adjustmentProposal = {
            deltaKcal: delta,
            reason: `Prise de poids insuffisante (${ewmaDeltaKg} kg sur ${spanDays} j) : ajouter +${delta} kcal/j (glucides péri-séance).`,
          };
        }
      } else if (weeklyRatePct > 0.55 && currentAdaptiveAdj > ADAPTIVE_KCAL_MIN) {
        const delta = Math.max(ADAPTIVE_KCAL_MIN - currentAdaptiveAdj, -100);
        if (delta !== 0) {
          adjustmentProposal = {
            deltaKcal: delta,
            reason: `Prise trop rapide (${weeklyRatePct.toFixed(2)} %/sem) : ajuster de ${delta} kcal/j pour limiter le gras.`,
          };
        }
      }
    }
  }

  return {
    ...baseline,
    adaptiveActive: true,
    confidence: loggedDays.length >= 10 ? 'high' : 'medium',
    spanDays,
    loggedDaysCount: loggedDays.length,
    ewmaDeltaKg,
    avgLoggedKcal,
    estimatedTdeeKcal,
    adjustmentProposal,
    skippedOutliersCount: ewmaInfo.skippedOutliers.length,
    note: `TDEE réel calibré sur ${loggedDays.length} jours d’apports et tendance EWMA (${spanDays} j).`,
  };
}

/* ==========================================================================
   5. CIBLES MACROS & HYDRATATION COHÉRENTES (MASSE MAIGRE + PLANCHER SÛR)
   ========================================================================== */

export function computeCoherentMacrosForCalories(targetKcal, { leanMassKg = 62, goal = 'recomp', proteinOverride = null, fatOverride = null, carbsOverride = null } = {}) {
  const safeKcal = Math.max(1200, Math.round(Number(targetKcal) || 2000));
  const lbm = Math.max(35, Number(leanMassKg) || 62);

  // Protéines sur masse maigre (2.0 à 2.3 g/kg LBM), plafonnées entre 130 g et 210 g
  const proteinPerKgLbm = goal === 'fat_loss' || goal === 'recomp' ? 2.2 : 2.05;
  let proteinG =
    proteinOverride !== null && proteinOverride !== undefined && Number(proteinOverride) > 0
      ? Math.round(Number(proteinOverride))
      : Math.max(130, Math.min(210, Math.round(lbm * proteinPerKgLbm)));

  // Plancher lipidique sain sur masse maigre (0.8 à 1.0 g/kg LBM, ~60-85 g)
  const fatPerKgLbm = goal === 'fat_loss' ? 0.85 : 0.95;
  let fatG =
    fatOverride !== null && fatOverride !== undefined && Number(fatOverride) > 0
      ? Math.round(Number(fatOverride))
      : Math.max(55, Math.min(88, Math.round(lbm * fatPerKgLbm)));

  // Si les 3 macros ont été explicitement fournies par l'utilisateur/Coach, on recalcule kcal si incohérent ou on garde la cohérence exacte
  if (
    proteinOverride !== null &&
    proteinOverride !== undefined &&
    fatOverride !== null &&
    fatOverride !== undefined &&
    carbsOverride !== null &&
    carbsOverride !== undefined
  ) {
    const carbsG = Math.max(0, Math.round(Number(carbsOverride) || 0));
    const computedKcal = proteinG * 4 + carbsG * 4 + fatG * 9;
    return {
      kcal: Math.abs(computedKcal - safeKcal) <= 15 ? safeKcal : computedKcal,
      proteinG,
      carbsG,
      fatG,
    };
  }

  // Assure qu'il reste au moins 160 kcal (40 g) pour les glucides si budget calorique très bas
  let remainingKcal = safeKcal - proteinG * 4 - fatG * 9;
  if (remainingKcal < 160) {
    if (fatOverride === null || fatOverride === undefined) {
      const fatNeeded = Math.ceil((160 - remainingKcal) / 9);
      fatG = Math.max(45, fatG - fatNeeded);
      remainingKcal = safeKcal - proteinG * 4 - fatG * 9;
    }
    if (remainingKcal < 160 && (proteinOverride === null || proteinOverride === undefined)) {
      const protNeeded = Math.ceil((160 - remainingKcal) / 4);
      proteinG = Math.max(115, proteinG - protNeeded);
      remainingKcal = safeKcal - proteinG * 4 - fatG * 9;
    }
  }

  let carbsG =
    carbsOverride !== null && carbsOverride !== undefined && Number(carbsOverride) >= 0
      ? Math.round(Number(carbsOverride))
      : Math.max(0, Math.round(remainingKcal / 4));

  // Garantit mathématiquement |4*P + 4*G + 9*L - targetKcal| <= 15 kcal
  const macroSumKcal = proteinG * 4 + carbsG * 4 + fatG * 9;
  const diff = safeKcal - macroSumKcal;
  if (Math.abs(diff) > 15) {
    if (carbsOverride === null || carbsOverride === undefined) {
      carbsG = Math.max(0, carbsG + Math.round(diff / 4));
    } else {
      return {
        kcal: macroSumKcal,
        proteinG,
        carbsG,
        fatG,
      };
    }
  }

  return {
    kcal: safeKcal,
    proteinG,
    carbsG,
    fatG,
  };
}

export function calculateMacroTargets(
  profile,
  { bodyFatPct = null, adaptiveTdeeKcal = null, manualKcalOffset = null, adaptiveAdjustmentKcal = null, smoothingDeltaKcal = 0 } = {}
) {
  const base = computeBaselineTDEE(profile, bodyFatPct);
  const tdee = Number(adaptiveTdeeKcal) || base.tdeeKcal;
  const weight = Number(profile?.weightKg) || 75;
  const lbm = base.leanMassKg;
  const safeFloorKcal = computeSafeCalorieFloor(base.bmrKcal);

  // Hydratation par défaut réaliste (2500 à 3500 ml/j selon poids & activité, surchargeable)
  const neatMl = profile?.lifestyle?.neatLevel === 'active' ? 500 : profile?.lifestyle?.neatLevel === 'mixed' ? 250 : 100;
  const defaultWaterMl = Math.max(2500, Math.min(3500, Math.round((weight * 33 + neatMl) / 50) * 50));

  const rawAdj =
    adaptiveAdjustmentKcal !== null && adaptiveAdjustmentKcal !== undefined
      ? adaptiveAdjustmentKcal
      : manualKcalOffset !== null && manualKcalOffset !== undefined
        ? manualKcalOffset
        : getProfileAdaptiveAdjustmentKcal(profile);
  const clampedAdaptiveAdj = clampAdaptiveAdjustmentKcal(rawAdj);
  const safeSmoothing = Math.max(-250, Math.min(0, Math.round(Number(smoothingDeltaKcal) || 0)));

  // Mode Surcharge Manuelle / Coach IA active
  const override = profile?.nutritionPrefs?.nutritionOverride;
  if (override?.enabled && Number(override.kcal) > 0) {
    const coherent = computeCoherentMacrosForCalories(override.kcal, {
      leanMassKg: lbm,
      goal: profile?.goal,
      proteinOverride: override.proteinG ?? null,
      fatOverride: override.fatG ?? null,
      carbsOverride: override.carbsG ?? null,
    });
    const waterTargetMl =
      Number(override.waterTargetMl) >= 1200
        ? Math.min(6000, Math.round(Number(override.waterTargetMl) / 50) * 50)
        : defaultWaterMl;

    return {
      tdeeKcal: tdee,
      bmrKcal: base.bmrKcal,
      safeFloorKcal,
      formula: base.formula,
      leanMassKg: lbm,
      kcal: coherent.kcal,
      proteinG: coherent.proteinG,
      carbsG: coherent.carbsG,
      fatG: coherent.fatG,
      fiberG: Math.max(25, Math.round((coherent.kcal / 1000) * 14)),
      waterTargetMl,
      adaptiveAdjustmentKcal: clampedAdaptiveAdj,
      isOverride: true,
      overrideLocked: Boolean(override.locked),
      overrideSource: override.source || 'manual',
    };
  }

  const goalOffsets = {
    recomp: -100,
    fat_loss: -420,
    lean_bulk: +240,
    hypertrophy: +200,
    strength: +150,
    health_posture: 0,
  };

  const targetKcal = Math.max(
    safeFloorKcal,
    Math.round(tdee + (goalOffsets[profile?.goal] ?? 0) + clampedAdaptiveAdj + safeSmoothing)
  );

  const coherent = computeCoherentMacrosForCalories(targetKcal, {
    leanMassKg: lbm,
    goal: profile?.goal,
  });

  return {
    tdeeKcal: tdee,
    bmrKcal: base.bmrKcal,
    safeFloorKcal,
    formula: base.formula,
    leanMassKg: lbm,
    kcal: coherent.kcal,
    proteinG: coherent.proteinG,
    carbsG: coherent.carbsG,
    fatG: coherent.fatG,
    fiberG: Math.max(25, Math.round((coherent.kcal / 1000) * 14)),
    waterTargetMl: defaultWaterMl,
    adaptiveAdjustmentKcal: clampedAdaptiveAdj,
    isOverride: false,
    overrideLocked: false,
    overrideSource: null,
  };
}

/* ==========================================================================
   6. ANALYSE PHOTO D'ASSIETTE & OCR BALANCE (IA VISION VIA ROUTEUR)
   ========================================================================== */

export async function analyzeMealPhoto(imageDataUrl, profile, aiSettings) {
  const targets = calculateMacroTargets(profile);
  const systemPrompt =
    'Tu es un nutritionniste sportif certifié. Analyse la photo du repas et renvoie STRICTEMENT un JSON valide sans texte parasite.';
  const prompt = `Identifie chaque aliment visible sur cette assiette, estime son grammage réaliste et ses macros.
Objectif utilisateur : ${profile?.goal || 'recomp'} (cible jour : ${targets.kcal} kcal, P ${targets.proteinG}g / G ${targets.carbsG}g / L ${targets.fatG}g).

Schéma JSON strict :
{
  "meal_label": "<titre court du repas>",
  "items": [
    { "name": "<aliment>", "grams": 150, "kcal": 200, "protein_g": 28, "carbs_g": 0, "fat_g": 8 }
  ],
  "totals": { "kcal": 550, "protein_g": 42, "carbs_g": 55, "fat_g": 16 },
  "alignment_score": 85,
  "advice": "<conseil concret d'ajustement pour le repas suivant>"
}`;

  return routeAIRequest({
    taskType: 'meal_analysis',
    prompt,
    systemPrompt,
    images: imageDataUrl ? [imageDataUrl] : [],
    context: { profile, targets },
    settings: aiSettings,
    expectJson: true,
  });
}

export async function extractScaleMetricsOCR(imageDataUrl, profile, aiSettings) {
  const systemPrompt =
    'Tu es un module OCR spécialisé dans les captures d’écran d’applications de balances connectées (OKOK, Withings, Xiaomi, Renpho, Garmin). Réponds STRICTEMENT en JSON.';
  const prompt = `Extrais les valeurs biométriques lisibles sur cette capture de balance (mets null si une donnée n'est pas visible) :
{
  "weight_kg": 76.4,
  "body_fat_pct": 16.8,
  "muscle_mass_kg": 60.2,
  "visceral_fat": 6,
  "hydration_pct": 58.4,
  "bmr_kcal": 1780
}`;

  return routeAIRequest({
    taskType: 'scale_ocr',
    prompt,
    systemPrompt,
    images: imageDataUrl ? [imageDataUrl] : [],
    context: { profile },
    settings: aiSettings,
    expectJson: true,
  });
}

/* ==========================================================================
   7. GÉNÉRATEUR DE PLANS TYPES & LISTE DE COURSES PAR RAYON
   ========================================================================== */

export function generateMealPlanAndShoppingList(profile, targets = null) {
  const macroTargets = targets || calculateMacroTargets(profile);
  const mealsPerDay = Math.max(2, Math.min(5, Number(profile?.nutritionPrefs?.mealsPerDay) || 3));
  const eligible = searchCiqualOffline('', profile);

  const pickBy = (predicate, fallbackIdx = 0) =>
    eligible.find(predicate) || eligible[fallbackIdx] || CIQUAL_DB[0];

  const mainProt = pickBy((f) => f.proteinG >= 18 && f.fatG <= 6 && !f.id.includes('whey') && !f.id.includes('prot_'));
  const altProt = pickBy((f) => f.id !== mainProt.id && f.proteinG >= 12 && !f.id.includes('whey'));
  const snackProt = pickBy((f) => f.id.includes('skyr') || f.id.includes('fromage_blanc') || f.id.includes('tofu') || f.id.includes('prot_pois'));
  const breakfastCarb = pickBy((f) => f.id.includes('avoine') || f.id.includes('sarrasin') || f.id.includes('pain_complet'));
  const mainCarb = pickBy((f) => f.id.includes('riz_basmati_cru') || f.id.includes('quinoa') || f.id.includes('patate_douce'));
  const veg1 = pickBy((f) => f.id.includes('brocoli') || f.id.includes('haricots_verts'));
  const veg2 = pickBy((f) => f.id !== veg1.id && (f.id.includes('courgette') || f.id.includes('epinards') || f.id.includes('haricots_verts')));
  const fruit = pickBy((f) => f.id.includes('banane') || f.id.includes('myrtilles') || f.id.includes('pomme'));
  const fatSource = pickBy((f) => f.id.includes('huile_olive') || f.id.includes('avocat'));
  const nutSource = pickBy((f) => f.id.includes('amandes') || f.id.includes('noix') || f.id.includes('graines_chia'));

  const slotTemplates = [
    {
      slot: 'Repas 1 — Matin / Énergie',
      share: mealsPerDay === 2 ? 0.45 : 0.26,
      components: [
        { food: snackProt, role: 'protein' },
        { food: breakfastCarb, role: 'carb' },
        { food: fruit, role: 'fruit' },
        { food: nutSource, role: 'fat' },
      ],
    },
    {
      slot: 'Repas 2 — Déjeuner Performance',
      share: mealsPerDay === 2 ? 0.55 : 0.34,
      components: [
        { food: mainProt, role: 'protein' },
        { food: mainCarb, role: 'carb' },
        { food: veg1, role: 'veg' },
        { food: fatSource, role: 'fat' },
      ],
    },
    {
      slot: 'Repas 3 — Dîner Récupération',
      share: mealsPerDay === 3 ? 0.4 : 0.26,
      components: [
        { food: altProt, role: 'protein' },
        { food: mainCarb, role: 'carb' },
        { food: veg2, role: 'veg' },
        { food: fatSource, role: 'fat' },
      ],
    },
    {
      slot: 'Collation Péri-Entraînement',
      share: 0.14,
      components: [
        { food: snackProt, role: 'protein' },
        { food: fruit, role: 'carb' },
      ],
    },
    {
      slot: 'Collation Soir (Synthèse Protéique)',
      share: 0.12,
      components: [
        { food: snackProt, role: 'protein' },
        { food: nutSource, role: 'fat' },
      ],
    },
  ];

  const chosenSlots = slotTemplates.slice(0, mealsPerDay);
  const totalShare = chosenSlots.reduce((acc, s) => acc + s.share, 0);

  const weeklyTotals = new Map();
  const mealPlan = chosenSlots.map((slot) => {
    const ratio = slot.share / totalShare;
    const slotProt = macroTargets.proteinG * ratio;
    const slotCarbs = macroTargets.carbsG * ratio;
    const slotFat = macroTargets.fatG * ratio;

    const items = slot.components.map(({ food, role }) => {
      let grams = 100;
      if (role === 'protein') {
        grams = Math.round((slotProt / Math.max(5, food.proteinG)) * 100 / 5) * 5;
        grams = Math.max(40, Math.min(320, grams));
      } else if (role === 'carb') {
        grams = Math.round((slotCarbs / Math.max(10, food.carbsG)) * 100 / 5) * 5;
        grams = Math.max(35, Math.min(220, grams));
      } else if (role === 'fat') {
        grams = Math.round(((slotFat * 0.65) / Math.max(10, food.fatG)) * 100 / 5) * 5;
        grams = Math.max(10, Math.min(80, grams));
      } else if (role === 'veg') {
        grams = 180;
      } else if (role === 'fruit') {
        grams = 120;
      }

      const scaled = scaleFoodMacros(food, grams);
      const prev = weeklyTotals.get(food.id) || { food, totalGrams: 0 };
      prev.totalGrams += grams * 7;
      weeklyTotals.set(food.id, prev);

      return {
        foodId: food.id,
        name: food.name,
        aisle: food.aisle,
        ...scaled,
      };
    });

    const totals = items.reduce(
      (acc, i) => ({
        kcal: acc.kcal + i.kcal,
        proteinG: Math.round((acc.proteinG + i.proteinG) * 10) / 10,
        carbsG: Math.round((acc.carbsG + i.carbsG) * 10) / 10,
        fatG: Math.round((acc.fatG + i.fatG) * 10) / 10,
      }),
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
    );

    return { slot: slot.slot, items, totals };
  });

  const shoppingList = Array.from(weeklyTotals.values())
    .map(({ food, totalGrams }) => {
      const useKg = totalGrams >= 1000;
      return {
        aisle: food.aisle,
        name: food.name,
        quantity: useKg ? Number((totalGrams / 1000).toFixed(2)) : Math.round(totalGrams),
        unit: useKg ? 'kg' : 'g',
        checked: false,
      };
    })
    .sort((a, b) => a.aisle.localeCompare(b.aisle) || a.name.localeCompare(b.name));

  return {
    targets: macroTargets,
    mealPlan,
    shoppingList,
  };
}
