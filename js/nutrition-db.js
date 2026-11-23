/**
 * Kinetix Lab — Moteur Nutritionnel Auto-Adaptatif & Biométrie Avancée (js/nutrition-db.js)
 * - Base française Ciqual (ANSES) embarquée 100 % hors-ligne (~60 aliments clés)
 * - Intégration Open Food Facts API (0 clé) + Scanner Code-Barres caméra (html5-qrcode)
 * - Poids lissé EWMA & TDEE Auto-Adaptatif sur 14–21 jours avec proposition d'ajustement ±100/150 kcal
 * - Biométrie multi-sources : Katch-McArdle / Mifflin-St Jeor, %MG US Navy & ratio Taille/Hauteur (WHtR)
 * - Analyse photo d'assiette & OCR balance via ai-router.js
 * - Générateur de plans types & liste de courses interactive classée par rayon
 */

import { routeAIRequest, normalizeMealVisionPayload } from './ai-router.js';

/* ==========================================================================
   1. BASE FRANÇAISE CIQUAL (ANSES) ENRICHIE (~175 ALIMENTS COURANTS + PORTIONS)
   ========================================================================== */

const ALL_DIETS = ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'gluten_free'];
const ALL_DIETS_GLUTEN = ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal'];
const DAIRY_DIETS = ['omnivore', 'vegetarian', 'pescatarian', 'halal', 'gluten_free'];
const FISH_DIETS = ['omnivore', 'pescatarian', 'halal', 'gluten_free'];
const MEAT_HALAL = ['omnivore', 'halal', 'gluten_free'];
const PORK_DIETS = ['omnivore', 'gluten_free'];

export const CIQUAL_DB = Object.freeze([
  // --- VIANDES & VOLAILLES (CRU & CUIT) ---
  { id: 'ciq_poulet_filet', name: 'Blanc de poulet (filet, cru)', kcal: 114, proteinG: 23.2, carbsG: 0, fatG: 1.9, fiberG: 0, portion: { label: '1 filet', grams: 150 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_poulet_filet_cuit', name: 'Blanc de poulet cuit (poêlé / grillé)', kcal: 156, proteinG: 31.0, carbsG: 0, fatG: 3.2, fiberG: 0, portion: { label: '1 filet cuit', grams: 130 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_poulet_cuisse', name: 'Cuisse de poulet rôtie (sans peau)', kcal: 174, proteinG: 25.5, carbsG: 0, fatG: 7.8, fiberG: 0, portion: { label: '1 cuisse', grams: 140 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_poulet_roti', name: 'Poulet rôti (chair et peau)', kcal: 215, proteinG: 26.2, carbsG: 0, fatG: 12.1, fiberG: 0, portion: { label: '1 portion', grams: 150 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_poulet_tranche', name: 'Blanc de poulet en tranches (charcuterie)', kcal: 108, proteinG: 21.5, carbsG: 1.5, fatG: 1.6, fiberG: 0, portion: { label: '1 tranche', grams: 40 }, aisle: 'Charcuterie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_dinde_escalope', name: 'Escalope de dinde (crue)', kcal: 109, proteinG: 23.6, carbsG: 0, fatG: 1.4, fiberG: 0, portion: { label: '1 escalope', grams: 140 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_dinde_cuite', name: 'Escalope de dinde cuite', kcal: 148, proteinG: 30.2, carbsG: 0, fatG: 2.6, fiberG: 0, portion: { label: '1 escalope cuite', grams: 120 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_dinde_tranche', name: 'Blanc de dinde en tranches', kcal: 104, proteinG: 20.8, carbsG: 1.4, fatG: 1.5, fiberG: 0, portion: { label: '1 tranche', grams: 40 }, aisle: 'Charcuterie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_boeuf_5', name: 'Steak haché bœuf 5 % MG (cru)', kcal: 127, proteinG: 21.0, carbsG: 0, fatG: 4.8, fiberG: 0, portion: { label: '1 steak', grams: 125 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_boeuf_5_cuit', name: 'Steak haché bœuf 5 % MG (cuit)', kcal: 162, proteinG: 26.8, carbsG: 0, fatG: 6.1, fiberG: 0, portion: { label: '1 steak cuit', grams: 100 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_boeuf_10', name: 'Steak haché bœuf 10 % MG', kcal: 174, proteinG: 20.2, carbsG: 0, fatG: 10.2, fiberG: 0, portion: { label: '1 steak', grams: 125 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_boeuf_15', name: 'Steak haché bœuf 15 % MG', kcal: 218, proteinG: 19.4, carbsG: 0, fatG: 15.2, fiberG: 0, portion: { label: '1 steak', grams: 125 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_boeuf_bavette', name: 'Bavette de bœuf grillée', kcal: 178, proteinG: 27.4, carbsG: 0, fatG: 7.4, fiberG: 0, portion: { label: '1 bavette', grams: 150 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_boeuf_faux_filet', name: 'Faux-filet de bœuf grillé', kcal: 204, proteinG: 26.8, carbsG: 0, fatG: 10.6, fiberG: 0, portion: { label: '1 pièce', grams: 160 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_boeuf_roti', name: 'Rôti de bœuf cuit (tranche)', kcal: 155, proteinG: 28.0, carbsG: 0, fatG: 4.5, fiberG: 0, portion: { label: '1 tranche', grams: 80 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_viande_grisons', name: 'Viande des Grisons / Bresaola', kcal: 172, proteinG: 36.5, carbsG: 0.5, fatG: 2.6, fiberG: 0, portion: { label: '4 tranches', grams: 50 }, aisle: 'Charcuterie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_veau_escalope', name: 'Escalope de veau cuite', kcal: 168, proteinG: 29.5, carbsG: 0, fatG: 5.2, fiberG: 0, portion: { label: '1 escalope', grams: 130 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_porc_filet_mignon', name: 'Filet mignon de porc cuit', kcal: 149, proteinG: 27.6, carbsG: 0, fatG: 4.1, fiberG: 0, portion: { label: '1 portion', grams: 140 }, aisle: 'Boucherie & Poissonnerie', diets: PORK_DIETS, allergens: [] },
  { id: 'ciq_porc_cote', name: 'Côte de porc grillée', kcal: 224, proteinG: 25.1, carbsG: 0, fatG: 13.8, fiberG: 0, portion: { label: '1 côte', grams: 150 }, aisle: 'Boucherie & Poissonnerie', diets: PORK_DIETS, allergens: [] },
  { id: 'ciq_jambon_blanc', name: 'Jambon blanc découenné dégraissé', kcal: 112, proteinG: 21.0, carbsG: 1.0, fatG: 2.6, fiberG: 0, portion: { label: '1 tranche', grams: 45 }, aisle: 'Charcuterie', diets: PORK_DIETS, allergens: [] },
  { id: 'ciq_jambon_cru', name: 'Jambon cru / Serrano / Bayonne', kcal: 238, proteinG: 29.0, carbsG: 0.5, fatG: 13.4, fiberG: 0, portion: { label: '2 tranches', grams: 40 }, aisle: 'Charcuterie', diets: PORK_DIETS, allergens: [] },
  { id: 'ciq_bacon_filet', name: 'Filet de bacon fumé (maigre)', kcal: 136, proteinG: 22.8, carbsG: 0.8, fatG: 4.5, fiberG: 0, portion: { label: '3 tranches', grams: 50 }, aisle: 'Charcuterie', diets: PORK_DIETS, allergens: [] },
  { id: 'ciq_lardons', name: 'Lardons fumés nature', kcal: 295, proteinG: 16.5, carbsG: 0.8, fatG: 25.2, fiberG: 0, portion: { label: '1/2 barquette', grams: 75 }, aisle: 'Charcuterie', diets: PORK_DIETS, allergens: [] },
  { id: 'ciq_merguez', name: 'Merguez grillée', kcal: 286, proteinG: 16.8, carbsG: 1.5, fatG: 23.8, fiberG: 0, portion: { label: '1 merguez', grams: 55 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },
  { id: 'ciq_canard_magret', name: 'Magret de canard (sans peau, cuit)', kcal: 194, proteinG: 26.8, carbsG: 0, fatG: 9.6, fiberG: 0, portion: { label: '1/2 magret', grams: 150 }, aisle: 'Boucherie & Poissonnerie', diets: MEAT_HALAL, allergens: [] },

  // --- POISSONS & FRUITS DE MER ---
  { id: 'ciq_saumon', name: 'Pavé de saumon frais (cru)', kcal: 205, proteinG: 20.4, carbsG: 0, fatG: 13.6, fiberG: 0, portion: { label: '1 pavé', grams: 140 }, aisle: 'Boucherie & Poissonnerie', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_saumon_cuit', name: 'Pavé de saumon cuit au four', kcal: 228, proteinG: 23.8, carbsG: 0, fatG: 14.5, fiberG: 0, portion: { label: '1 pavé cuit', grams: 130 }, aisle: 'Boucherie & Poissonnerie', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_saumon_fume', name: 'Saumon fumé (tranches)', kcal: 185, proteinG: 22.5, carbsG: 0.5, fatG: 10.4, fiberG: 0, portion: { label: '2 tranches', grams: 70 }, aisle: 'Boucherie & Poissonnerie', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_truite', name: 'Pavé de truite frais', kcal: 146, proteinG: 20.5, carbsG: 0, fatG: 6.9, fiberG: 0, portion: { label: '1 pavé', grams: 140 }, aisle: 'Boucherie & Poissonnerie', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_cabillaud', name: 'Dos de cabillaud', kcal: 82, proteinG: 18.0, carbsG: 0, fatG: 0.7, fiberG: 0, portion: { label: '1 dos', grams: 150 }, aisle: 'Boucherie & Poissonnerie', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_colin', name: 'Filet de colin / lieu noir', kcal: 88, proteinG: 19.2, carbsG: 0, fatG: 0.9, fiberG: 0, portion: { label: '1 filet', grams: 140 }, aisle: 'Boucherie & Poissonnerie', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_dorade', name: 'Filet de dorade royale', kcal: 118, proteinG: 20.4, carbsG: 0, fatG: 3.9, fiberG: 0, portion: { label: '1 filet', grams: 140 }, aisle: 'Boucherie & Poissonnerie', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_thon_nat', name: 'Thon au naturel (égoutté)', kcal: 112, proteinG: 25.5, carbsG: 0, fatG: 1.0, fiberG: 0, portion: { label: '1 boîte', grams: 130 }, aisle: 'Épicerie & Conserves', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_thon_huile', name: 'Thon à l’huile d’olive (égoutté)', kcal: 198, proteinG: 24.5, carbsG: 0, fatG: 11.0, fiberG: 0, portion: { label: '1 boîte', grams: 112 }, aisle: 'Épicerie & Conserves', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_sardines', name: 'Sardines au naturel', kcal: 158, proteinG: 21.2, carbsG: 0, fatG: 8.1, fiberG: 0, portion: { label: '1 boîte', grams: 95 }, aisle: 'Épicerie & Conserves', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_sardines_huile', name: 'Sardines à l’huile d’olive (égouttées)', kcal: 215, proteinG: 22.8, carbsG: 0, fatG: 13.8, fiberG: 0, portion: { label: '1 boîte', grams: 90 }, aisle: 'Épicerie & Conserves', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_maquereau', name: 'Filets de maquereau nature / grillés', kcal: 224, proteinG: 21.0, carbsG: 0, fatG: 15.5, fiberG: 0, portion: { label: '1 boîte', grams: 110 }, aisle: 'Épicerie & Conserves', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_crevettes', name: 'Crevettes cuites décortiquées', kcal: 94, proteinG: 20.8, carbsG: 0.5, fatG: 0.9, fiberG: 0, portion: { label: '1 portion', grams: 120 }, aisle: 'Boucherie & Poissonnerie', diets: ['omnivore', 'pescatarian', 'gluten_free'], allergens: ['shellfish'] },
  { id: 'ciq_moules', name: 'Moules cuites (chair)', kcal: 118, proteinG: 17.5, carbsG: 4.2, fatG: 3.1, fiberG: 0, portion: { label: '1 portion', grams: 150 }, aisle: 'Boucherie & Poissonnerie', diets: ['omnivore', 'pescatarian', 'gluten_free'], allergens: ['shellfish'] },
  { id: 'ciq_calamar', name: 'Calamars / Encornets cuits', kcal: 96, proteinG: 18.2, carbsG: 1.8, fatG: 1.6, fiberG: 0, portion: { label: '1 portion', grams: 140 }, aisle: 'Boucherie & Poissonnerie', diets: ['omnivore', 'pescatarian', 'gluten_free'], allergens: ['shellfish'] },
  { id: 'ciq_surimi', name: 'Bâtonnets de surimi', kcal: 98, proteinG: 8.5, carbsG: 11.2, fatG: 2.0, fiberG: 0, portion: { label: '4 bâtonnets', grams: 70 }, aisle: 'Boucherie & Poissonnerie', diets: ['omnivore', 'pescatarian'], allergens: ['fish', 'gluten'] },

  // --- ŒUFS & PRODUITS LAITIERS ---
  { id: 'ciq_oeuf', name: 'Œuf entier (calibre M)', kcal: 145, proteinG: 12.7, carbsG: 0.7, fatG: 10.1, fiberG: 0, portion: { label: '1 œuf', grams: 60 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['eggs'] },
  { id: 'ciq_oeuf_dur', name: 'Œuf dur', kcal: 147, proteinG: 12.9, carbsG: 0.8, fatG: 10.2, fiberG: 0, portion: { label: '1 œuf dur', grams: 60 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['eggs'] },
  { id: 'ciq_blanc_oeuf', name: 'Blanc d’œuf liquide', kcal: 48, proteinG: 10.8, carbsG: 0.7, fatG: 0.2, fiberG: 0, portion: { label: '1 blanc', grams: 35 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['eggs'] },
  { id: 'ciq_skyr', name: 'Skyr nature 0 % MG', kcal: 62, proteinG: 10.0, carbsG: 4.0, fatG: 0.2, fiberG: 0, portion: { label: '1 pot', grams: 150 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_fromage_blanc_0', name: 'Fromage blanc 0 % MG', kcal: 47, proteinG: 7.8, carbsG: 3.8, fatG: 0.1, fiberG: 0, portion: { label: '1 bol', grams: 200 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_fromage_blanc_3', name: 'Fromage blanc 3 % MG', kcal: 73, proteinG: 7.4, carbsG: 3.6, fatG: 3.2, fiberG: 0, portion: { label: '1 bol', grams: 200 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_yaourt_grec', name: 'Yaourt grec nature', kcal: 118, proteinG: 6.2, carbsG: 4.2, fatG: 8.5, fiberG: 0, portion: { label: '1 pot', grams: 150 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_yaourt_nature', name: 'Yaourt nature brassé', kcal: 58, proteinG: 4.1, carbsG: 4.8, fatG: 2.3, fiberG: 0, portion: { label: '1 pot', grams: 125 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_petit_suisse', name: 'Petit-suisse nature (3,8 % MG)', kcal: 96, proteinG: 9.2, carbsG: 3.6, fatG: 4.8, fiberG: 0, portion: { label: '1 pot', grams: 60 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_cottage', name: 'Cottage cheese nature', kcal: 98, proteinG: 12.2, carbsG: 2.7, fatG: 4.2, fiberG: 0, portion: { label: '1 pot', grams: 200 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_carre_frais', name: 'Carré frais 0 % MG', kcal: 72, proteinG: 12.8, carbsG: 3.8, fatG: 0.4, fiberG: 0, portion: { label: '1 carré', grams: 25 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_lait_demi', name: 'Lait demi-écrémé', kcal: 46, proteinG: 3.3, carbsG: 4.8, fatG: 1.6, fiberG: 0, portion: { label: '1 verre', grams: 250 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_lait_ecreme', name: 'Lait écrémé', kcal: 34, proteinG: 3.4, carbsG: 4.9, fatG: 0.1, fiberG: 0, portion: { label: '1 verre', grams: 250 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_lait_entier', name: 'Lait entier', kcal: 64, proteinG: 3.3, carbsG: 4.7, fatG: 3.6, fiberG: 0, portion: { label: '1 verre', grams: 250 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_lait_amande', name: 'Boisson / Lait d’amande sans sucre', kcal: 15, proteinG: 0.5, carbsG: 0.3, fatG: 1.2, fiberG: 0.3, portion: { label: '1 verre', grams: 250 }, aisle: 'Boissons Végétales', diets: ALL_DIETS, allergens: ['nuts'] },
  { id: 'ciq_lait_avoine', name: 'Boisson / Lait d’avoine sans sucre', kcal: 42, proteinG: 0.8, carbsG: 6.8, fatG: 1.2, fiberG: 0.8, portion: { label: '1 verre', grams: 250 }, aisle: 'Boissons Végétales', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_lait_soja', name: 'Boisson / Lait de soja nature', kcal: 36, proteinG: 3.4, carbsG: 1.2, fatG: 1.9, fiberG: 0.6, portion: { label: '1 verre', grams: 250 }, aisle: 'Boissons Végétales', diets: ALL_DIETS, allergens: ['soy'] },
  { id: 'ciq_emmental', name: 'Emmental râpé', kcal: 382, proteinG: 28.5, carbsG: 0.5, fatG: 29.5, fiberG: 0, portion: { label: '1 poignée', grams: 30 }, aisle: 'Fromagerie', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_mozzarella', name: 'Mozzarella boule', kcal: 255, proteinG: 18.5, carbsG: 1.5, fatG: 19.5, fiberG: 0, portion: { label: '1 boule', grams: 125 }, aisle: 'Fromagerie', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_comte', name: 'Comté affiné', kcal: 412, proteinG: 27.2, carbsG: 0.5, fatG: 33.8, fiberG: 0, portion: { label: '1 portion', grams: 30 }, aisle: 'Fromagerie', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_parmesan', name: 'Parmesan râpé', kcal: 402, proteinG: 35.8, carbsG: 0.4, fatG: 28.4, fiberG: 0, portion: { label: '1 c.à.s', grams: 15 }, aisle: 'Fromagerie', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_feta', name: 'Feta grecque', kcal: 276, proteinG: 15.2, carbsG: 1.2, fatG: 23.4, fiberG: 0, portion: { label: '1 portion', grams: 40 }, aisle: 'Fromagerie', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_chevre_frais', name: 'Fromage de chèvre frais', kcal: 215, proteinG: 11.5, carbsG: 2.2, fatG: 17.8, fiberG: 0, portion: { label: '1 portion', grams: 30 }, aisle: 'Fromagerie', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_ricotta', name: 'Ricotta nature', kcal: 152, proteinG: 9.8, carbsG: 3.4, fatG: 11.0, fiberG: 0, portion: { label: '2 c.à.s', grams: 60 }, aisle: 'Fromagerie', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_beurre', name: 'Beurre doux / demi-sel', kcal: 742, proteinG: 0.7, carbsG: 0.6, fatG: 82.0, fiberG: 0, portion: { label: '1 noisette', grams: 10 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },

  // --- PROTÉINES & COMPLÉMENTS ---
  { id: 'ciq_whey_iso', name: 'Whey Isolate nature', kcal: 372, proteinG: 86.0, carbsG: 2.5, fatG: 1.5, fiberG: 0, portion: { label: '1 scoop', grams: 30 }, aisle: 'Nutrition Sportive', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_whey_conc', name: 'Whey Concentrée (vanille/choco)', kcal: 392, proteinG: 76.0, carbsG: 7.5, fatG: 6.2, fiberG: 1.0, portion: { label: '1 scoop', grams: 30 }, aisle: 'Nutrition Sportive', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_caseine', name: 'Caséine micellaire', kcal: 365, proteinG: 80.0, carbsG: 4.5, fatG: 2.2, fiberG: 0.5, portion: { label: '1 scoop', grams: 30 }, aisle: 'Nutrition Sportive', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_prot_pois', name: 'Protéine végétale (pois/riz)', kcal: 380, proteinG: 78.0, carbsG: 6.0, fatG: 4.5, fiberG: 3.5, portion: { label: '1 scoop', grams: 30 }, aisle: 'Nutrition Sportive', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_barre_prot', name: 'Barre protéinée (standard)', kcal: 365, proteinG: 33.0, carbsG: 32.0, fatG: 12.0, fiberG: 7.5, portion: { label: '1 barre', grams: 60 }, aisle: 'Nutrition Sportive', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_boisson_prot', name: 'Boisson lactée hyperprotéinée (HiPRO / YoPRO)', kcal: 62, proteinG: 8.5, carbsG: 5.5, fatG: 0.5, fiberG: 0, portion: { label: '1 bouteille', grams: 300 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },

  // --- PROTÉINES VÉGÉTALES & LÉGUMINEUSES ---
  { id: 'ciq_tofu_ferme', name: 'Tofu ferme nature', kcal: 138, proteinG: 14.5, carbsG: 1.8, fatG: 8.2, fiberG: 1.2, portion: { label: '1 bloc', grams: 125 }, aisle: 'Protéines Végétales', diets: ALL_DIETS, allergens: ['soy'] },
  { id: 'ciq_tofu_soyeux', name: 'Tofu soyeux', kcal: 56, proteinG: 5.4, carbsG: 1.4, fatG: 3.1, fiberG: 0.5, portion: { label: '1 portion', grams: 150 }, aisle: 'Protéines Végétales', diets: ALL_DIETS, allergens: ['soy'] },
  { id: 'ciq_tempeh', name: 'Tempeh nature', kcal: 193, proteinG: 19.5, carbsG: 7.6, fatG: 10.8, fiberG: 4.5, portion: { label: '1 portion', grams: 100 }, aisle: 'Protéines Végétales', diets: ALL_DIETS, allergens: ['soy'] },
  { id: 'ciq_seitan', name: 'Seitan nature', kcal: 148, proteinG: 24.5, carbsG: 6.5, fatG: 2.1, fiberG: 1.2, portion: { label: '1 portion', grams: 100 }, aisle: 'Protéines Végétales', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_edamame', name: 'Edamame (fèves de soja cuites)', kcal: 122, proteinG: 11.9, carbsG: 8.9, fatG: 5.2, fiberG: 5.2, portion: { label: '1 bol', grams: 100 }, aisle: 'Surgelés & Légumes', diets: ALL_DIETS, allergens: ['soy'] },
  { id: 'ciq_pst', name: 'Protéines de soja texturées (sèches)', kcal: 335, proteinG: 51.0, carbsG: 22.0, fatG: 1.5, fiberG: 14.0, portion: { label: '1 portion sèche', grams: 50 }, aisle: 'Protéines Végétales', diets: ALL_DIETS, allergens: ['soy'] },
  { id: 'ciq_lentilles_cuites', name: 'Lentilles vertes cuites', kcal: 116, proteinG: 9.0, carbsG: 16.5, fatG: 0.4, fiberG: 7.9, portion: { label: '1 portion', grams: 180 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_lentilles_corail', name: 'Lentilles corail cuites', kcal: 114, proteinG: 8.6, carbsG: 17.8, fatG: 0.5, fiberG: 4.6, portion: { label: '1 portion', grams: 180 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_pois_chiches', name: 'Pois chiches cuits', kcal: 148, proteinG: 8.3, carbsG: 21.0, fatG: 2.6, fiberG: 7.2, portion: { label: '1 portion', grams: 150 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_haricots_rouges', name: 'Haricots rouges cuits', kcal: 124, proteinG: 8.7, carbsG: 18.6, fatG: 0.6, fiberG: 6.8, portion: { label: '1 portion', grams: 150 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_haricots_blancs', name: 'Haricots blancs cuits', kcal: 128, proteinG: 8.5, carbsG: 19.5, fatG: 0.5, fiberG: 7.0, portion: { label: '1 portion', grams: 150 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_houmous', name: 'Houmous nature', kcal: 235, proteinG: 7.2, carbsG: 14.5, fatG: 15.8, fiberG: 4.8, portion: { label: '2 c.à.s', grams: 50 }, aisle: 'Traiteur', diets: ALL_DIETS, allergens: [] },

  // --- FÉCULENTS, PAINS & CÉRÉALES (CRU & CUIT) ---
  { id: 'ciq_riz_basmati_cru', name: 'Riz basmati (poids cru)', kcal: 354, proteinG: 8.2, carbsG: 77.5, fatG: 0.7, fiberG: 1.4, portion: { label: '1 portion crue', grams: 80 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_riz_basmati_cuit', name: 'Riz basmati cuit', kcal: 126, proteinG: 2.9, carbsG: 27.6, fatG: 0.3, fiberG: 0.5, portion: { label: '1 bol cuit', grams: 200 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_riz_complet_cru', name: 'Riz complet (poids cru)', kcal: 358, proteinG: 7.6, carbsG: 73.5, fatG: 2.7, fiberG: 3.8, portion: { label: '1 portion crue', grams: 80 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_riz_complet_cuit', name: 'Riz complet cuit', kcal: 124, proteinG: 2.7, carbsG: 25.2, fatG: 1.0, fiberG: 1.6, portion: { label: '1 bol cuit', grams: 200 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_pates_blanches_cru', name: 'Pâtes blanches (poids cru)', kcal: 358, proteinG: 12.2, carbsG: 72.5, fatG: 1.5, fiberG: 3.0, portion: { label: '1 portion crue', grams: 90 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_pates_blanches_cuit', name: 'Pâtes blanches cuites', kcal: 138, proteinG: 4.8, carbsG: 27.6, fatG: 0.6, fiberG: 1.3, portion: { label: '1 assiette', grams: 220 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_pates_completes_cru', name: 'Pâtes complètes (poids cru)', kcal: 348, proteinG: 13.2, carbsG: 66.0, fatG: 2.1, fiberG: 7.5, portion: { label: '1 portion crue', grams: 90 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_pates_completes_cuit', name: 'Pâtes complètes cuites', kcal: 131, proteinG: 5.2, carbsG: 24.4, fatG: 0.9, fiberG: 3.2, portion: { label: '1 assiette', grams: 220 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_flocons_avoine', name: 'Flocons d’avoine complets', kcal: 368, proteinG: 13.5, carbsG: 58.7, fatG: 7.0, fiberG: 10.1, portion: { label: '1 bol', grams: 60 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_muesli', name: 'Muesli floconneux sans sucre ajouté', kcal: 362, proteinG: 10.8, carbsG: 62.5, fatG: 6.2, fiberG: 8.8, portion: { label: '1 bol', grams: 60 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_granola', name: 'Granola / Muesli croustillant', kcal: 445, proteinG: 8.6, carbsG: 62.0, fatG: 16.5, fiberG: 6.5, portion: { label: '1 portion', grams: 45 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_patate_douce', name: 'Patate douce cuite vapeur / four', kcal: 86, proteinG: 1.6, carbsG: 18.2, fatG: 0.2, fiberG: 3.0, portion: { label: '1 patate moy.', grams: 200 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_pomme_terre', name: 'Pomme de terre vapeur / eau', kcal: 80, proteinG: 2.0, carbsG: 16.7, fatG: 0.1, fiberG: 1.8, portion: { label: '2 pommes moy.', grams: 220 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_puree_pdt', name: 'Purée de pommes de terre (maison)', kcal: 96, proteinG: 2.2, carbsG: 14.5, fatG: 3.2, fiberG: 1.5, portion: { label: '1 portion', grams: 200 }, aisle: 'Épicerie & Féculents', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_semoule_cuite', name: 'Semoule de blé / Couscous cuit', kcal: 122, proteinG: 4.1, carbsG: 24.5, fatG: 0.4, fiberG: 1.5, portion: { label: '1 bol cuit', grams: 200 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_boulgour_cuit', name: 'Boulgour cuit', kcal: 105, proteinG: 3.6, carbsG: 20.5, fatG: 0.4, fiberG: 3.8, portion: { label: '1 bol cuit', grams: 200 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_quinoa_cuit', name: 'Quinoa cuit', kcal: 120, proteinG: 4.4, carbsG: 20.3, fatG: 1.9, fiberG: 2.8, portion: { label: '1 bol cuit', grams: 180 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_sarrasin_cuit', name: 'Sarrasin (kasha) cuit', kcal: 108, proteinG: 3.8, carbsG: 21.0, fatG: 0.8, fiberG: 2.7, portion: { label: '1 bol cuit', grams: 180 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_pain_complet', name: 'Pain complet au levain', kcal: 247, proteinG: 9.2, carbsG: 45.8, fatG: 1.8, fiberG: 6.8, portion: { label: '1 tranche', grams: 35 }, aisle: 'Boulangerie', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_baguette', name: 'Baguette tradition française', kcal: 274, proteinG: 8.6, carbsG: 56.2, fatG: 1.1, fiberG: 3.2, portion: { label: '1/4 baguette', grams: 60 }, aisle: 'Boulangerie', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_pain_mie_complet', name: 'Pain de mie complet', kcal: 256, proteinG: 8.8, carbsG: 44.5, fatG: 4.1, fiberG: 5.5, portion: { label: '1 tranche', grams: 38 }, aisle: 'Boulangerie', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_pain_mie_blanc', name: 'Pain de mie blanc', kcal: 268, proteinG: 7.8, carbsG: 49.5, fatG: 4.0, fiberG: 2.8, portion: { label: '1 tranche', grams: 35 }, aisle: 'Boulangerie', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_biscotte', name: 'Biscotte / Pain grillé complet', kcal: 392, proteinG: 11.5, carbsG: 70.0, fatG: 6.2, fiberG: 7.2, portion: { label: '2 biscottes', grams: 20 }, aisle: 'Boulangerie', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_galette_riz', name: 'Galettes de riz soufflé / maïs', kcal: 382, proteinG: 7.8, carbsG: 80.5, fatG: 2.8, fiberG: 3.4, portion: { label: '2 galettes', grams: 16 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_wrap_tortilla', name: 'Wrap / Tortilla de blé', kcal: 306, proteinG: 8.4, carbsG: 52.0, fatG: 6.8, fiberG: 3.2, portion: { label: '1 wrap', grams: 60 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_gnocchi', name: 'Gnocchis de pomme de terre (poêlés)', kcal: 178, proteinG: 4.2, carbsG: 34.5, fatG: 2.4, fiberG: 1.8, portion: { label: '1 portion', grams: 180 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS_GLUTEN, allergens: ['gluten'] },
  { id: 'ciq_mais_doux', name: 'Maïs doux en grains (égoutté)', kcal: 96, proteinG: 3.2, carbsG: 17.5, fatG: 1.4, fiberG: 2.8, portion: { label: '1 petite boîte', grams: 140 }, aisle: 'Épicerie & Conserves', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_petits_pois', name: 'Petits pois cuits', kcal: 78, proteinG: 5.2, carbsG: 11.2, fatG: 0.4, fiberG: 5.5, portion: { label: '1 portion', grams: 150 }, aisle: 'Surgelés & Légumes', diets: ALL_DIETS, allergens: [] },

  // --- LÉGUMES & FIBRES ---
  { id: 'ciq_brocoli', name: 'Brocoli vapeur', kcal: 34, proteinG: 2.8, carbsG: 4.0, fatG: 0.4, fiberG: 3.0, portion: { label: '1 portion', grams: 180 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_haricots_verts', name: 'Haricots verts cuits', kcal: 31, proteinG: 1.9, carbsG: 4.5, fatG: 0.2, fiberG: 3.4, portion: { label: '1 portion', grams: 180 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_epinards', name: 'Épinards frais / cuits', kcal: 23, proteinG: 2.9, carbsG: 1.4, fatG: 0.4, fiberG: 2.6, portion: { label: '1 portion', grams: 150 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_courgette', name: 'Courgette cuite', kcal: 17, proteinG: 1.2, carbsG: 2.4, fatG: 0.2, fiberG: 1.1, portion: { label: '1 courgette', grams: 200 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_poivron', name: 'Poivron rouge / vert', kcal: 31, proteinG: 1.0, carbsG: 5.5, fatG: 0.3, fiberG: 2.1, portion: { label: '1 poivron', grams: 150 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_tomate', name: 'Tomate fraîche', kcal: 19, proteinG: 0.9, carbsG: 3.2, fatG: 0.2, fiberG: 1.2, portion: { label: '1 tomate', grams: 120 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_tomates_cerises', name: 'Tomates cerises', kcal: 24, proteinG: 1.0, carbsG: 4.1, fatG: 0.3, fiberG: 1.4, portion: { label: '1 poignée', grams: 100 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_concombre', name: 'Concombre frais', kcal: 14, proteinG: 0.7, carbsG: 2.3, fatG: 0.1, fiberG: 0.8, portion: { label: '1/2 concombre', grams: 150 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_salade_verte', name: 'Salade verte / Laitue / Mâche', kcal: 16, proteinG: 1.4, carbsG: 1.8, fatG: 0.2, fiberG: 1.5, portion: { label: '1 bol', grams: 80 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_carotte', name: 'Carotte crue / râpée', kcal: 38, proteinG: 0.8, carbsG: 7.6, fatG: 0.2, fiberG: 2.8, portion: { label: '1 carotte', grams: 100 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_champignons', name: 'Champignons de Paris', kcal: 24, proteinG: 2.8, carbsG: 1.6, fatG: 0.4, fiberG: 1.8, portion: { label: '1 portion', grams: 120 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_aubergine', name: 'Aubergine cuite / grillée', kcal: 28, proteinG: 1.0, carbsG: 4.5, fatG: 0.2, fiberG: 2.8, portion: { label: '1 portion', grams: 180 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_chou_fleur', name: 'Chou-fleur vapeur', kcal: 25, proteinG: 2.0, carbsG: 3.1, fatG: 0.3, fiberG: 2.4, portion: { label: '1 portion', grams: 180 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_asperges', name: 'Asperges vertes cuites', kcal: 24, proteinG: 2.4, carbsG: 2.2, fatG: 0.2, fiberG: 2.1, portion: { label: '1 portion', grams: 150 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_poireau', name: 'Poireau cuit', kcal: 27, proteinG: 1.4, carbsG: 4.1, fatG: 0.2, fiberG: 2.6, portion: { label: '1 poireau', grams: 150 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_oignon', name: 'Oignon jaune / rouge', kcal: 38, proteinG: 1.1, carbsG: 7.4, fatG: 0.2, fiberG: 1.7, portion: { label: '1 oignon moy.', grams: 90 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_ratatouille', name: 'Ratatouille cuisinée', kcal: 62, proteinG: 1.4, carbsG: 5.5, fatG: 3.5, fiberG: 2.2, portion: { label: '1 portion', grams: 200 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_soupe_legumes', name: 'Soupe / Velouté de légumes', kcal: 38, proteinG: 1.1, carbsG: 5.4, fatG: 1.1, fiberG: 1.6, portion: { label: '1 bol', grams: 250 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },

  // --- FRUITS ---
  { id: 'ciq_banane', name: 'Banane fraîche', kcal: 90, proteinG: 1.1, carbsG: 20.5, fatG: 0.3, fiberG: 2.6, portion: { label: '1 banane', grams: 120 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_pomme', name: 'Pomme fraîche', kcal: 54, proteinG: 0.3, carbsG: 12.5, fatG: 0.2, fiberG: 2.4, portion: { label: '1 pomme', grams: 150 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_poire', name: 'Poire fraîche', kcal: 56, proteinG: 0.4, carbsG: 12.6, fatG: 0.2, fiberG: 3.1, portion: { label: '1 poire', grams: 160 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_myrtilles', name: 'Myrtilles / Fruits rouges', kcal: 57, proteinG: 0.7, carbsG: 12.2, fatG: 0.3, fiberG: 2.4, portion: { label: '1 poignée', grams: 100 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_fraises', name: 'Fraises fraîches', kcal: 35, proteinG: 0.7, carbsG: 6.5, fatG: 0.3, fiberG: 2.0, portion: { label: '1 barquette/2', grams: 125 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_framboises', name: 'Framboises fraîches', kcal: 48, proteinG: 1.2, carbsG: 6.5, fatG: 0.6, fiberG: 6.5, portion: { label: '1 barquette', grams: 125 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_kiwi', name: 'Kiwi frais', kcal: 61, proteinG: 1.1, carbsG: 12.0, fatG: 0.5, fiberG: 3.0, portion: { label: '1 kiwi', grams: 75 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_orange', name: 'Orange fraîche', kcal: 47, proteinG: 0.9, carbsG: 9.8, fatG: 0.2, fiberG: 2.2, portion: { label: '1 orange', grams: 160 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_clementine', name: 'Clémentine / Mandarine', kcal: 48, proteinG: 0.8, carbsG: 10.2, fatG: 0.2, fiberG: 1.8, portion: { label: '2 clémentines', grams: 120 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_raisin', name: 'Raisin blanc / noir', kcal: 72, proteinG: 0.7, carbsG: 16.5, fatG: 0.2, fiberG: 1.0, portion: { label: '1 grappe', grams: 120 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_mangue', name: 'Mangue fraîche', kcal: 64, proteinG: 0.8, carbsG: 14.5, fatG: 0.3, fiberG: 1.8, portion: { label: '1/2 mangue', grams: 150 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_ananas', name: 'Ananas frais', kcal: 52, proteinG: 0.5, carbsG: 11.8, fatG: 0.2, fiberG: 1.4, portion: { label: '2 tranches', grams: 150 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_pasteque', name: 'Pastèque fraîche', kcal: 32, proteinG: 0.6, carbsG: 7.2, fatG: 0.2, fiberG: 0.4, portion: { label: '1 tranche', grams: 250 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_melon', name: 'Melon charentais', kcal: 36, proteinG: 0.8, carbsG: 7.5, fatG: 0.2, fiberG: 0.9, portion: { label: '1/4 melon', grams: 200 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_peche', name: 'Pêche / Nectarine', kcal: 44, proteinG: 0.9, carbsG: 9.2, fatG: 0.2, fiberG: 1.6, portion: { label: '1 pêche', grams: 130 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_compote_ssa', name: 'Compote de pommes sans sucre ajouté', kcal: 56, proteinG: 0.3, carbsG: 12.6, fatG: 0.2, fiberG: 1.8, portion: { label: '1 gourde / pot', grams: 100 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_dattes', name: 'Dattes Medjool séchées', kcal: 282, proteinG: 2.2, carbsG: 67.5, fatG: 0.4, fiberG: 7.1, portion: { label: '2 dattes', grams: 40 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },

  // --- LIPIDES DE QUALITÉ & OLÉAGINEUX ---
  { id: 'ciq_huile_olive', name: 'Huile d’olive vierge extra', kcal: 900, proteinG: 0, carbsG: 0, fatG: 100.0, fiberG: 0, portion: { label: '1 c.à.s', grams: 10 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_huile_colza', name: 'Huile de colza (Oméga-3)', kcal: 900, proteinG: 0, carbsG: 0, fatG: 100.0, fiberG: 0, portion: { label: '1 c.à.s', grams: 10 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_huile_coco', name: 'Huile de coco vierge', kcal: 895, proteinG: 0, carbsG: 0, fatG: 99.5, fiberG: 0, portion: { label: '1 c.à.s', grams: 10 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_avocat', name: 'Avocat frais (pulpe)', kcal: 169, proteinG: 1.8, carbsG: 1.8, fatG: 15.8, fiberG: 6.7, portion: { label: '1/2 avocat', grams: 80 }, aisle: 'Fruits & Légumes', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_amandes', name: 'Amandes naturelles', kcal: 598, proteinG: 21.4, carbsG: 9.5, fatG: 51.5, fiberG: 12.2, portion: { label: '1 poignée', grams: 25 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: ['nuts'] },
  { id: 'ciq_noix', name: 'Cerneaux de noix (Oméga-3)', kcal: 673, proteinG: 15.2, carbsG: 7.0, fatG: 65.2, fiberG: 6.7, portion: { label: '1 poignée', grams: 25 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: ['nuts'] },
  { id: 'ciq_noix_cajou', name: 'Noix de cajou naturelles', kcal: 582, proteinG: 18.2, carbsG: 24.5, fatG: 45.8, fiberG: 3.4, portion: { label: '1 poignée', grams: 25 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: ['nuts'] },
  { id: 'ciq_noisettes', name: 'Noisettes décortiquées', kcal: 642, proteinG: 14.8, carbsG: 7.5, fatG: 61.5, fiberG: 9.5, portion: { label: '1 poignée', grams: 25 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: ['nuts'] },
  { id: 'ciq_pistaches', name: 'Pistaches décortiquées', kcal: 585, proteinG: 20.4, carbsG: 18.0, fatG: 46.5, fiberG: 10.2, portion: { label: '1 poignée', grams: 25 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: ['nuts'] },
  { id: 'ciq_beurre_cacahuete', name: 'Beurre / Purée de cacahuète 100 %', kcal: 604, proteinG: 25.8, carbsG: 12.0, fatG: 49.6, fiberG: 8.0, portion: { label: '1 c.à.s', grams: 15 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: ['peanuts'] },
  { id: 'ciq_puree_amande', name: 'Purée d’amandes complètes 100 %', kcal: 625, proteinG: 21.5, carbsG: 8.0, fatG: 54.5, fiberG: 11.0, portion: { label: '1 c.à.s', grams: 15 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: ['nuts'] },
  { id: 'ciq_graines_chia', name: 'Graines de chia', kcal: 486, proteinG: 16.5, carbsG: 8.0, fatG: 30.7, fiberG: 34.4, portion: { label: '1 c.à.s', grams: 15 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_graines_courge', name: 'Graines de courge / lin', kcal: 565, proteinG: 29.5, carbsG: 11.0, fatG: 44.5, fiberG: 6.5, portion: { label: '1 c.à.s', grams: 15 }, aisle: 'Oléagineux & Huiles', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_chocolat_85', name: 'Chocolat noir 85 % cacao', kcal: 584, proteinG: 10.5, carbsG: 21.0, fatG: 48.0, fiberG: 12.0, portion: { label: '2 carrés', grams: 20 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_chocolat_70', name: 'Chocolat noir 70 % cacao', kcal: 568, proteinG: 8.2, carbsG: 34.0, fatG: 42.5, fiberG: 9.5, portion: { label: '2 carrés', grams: 20 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },

  // --- SAUCES, CRÈMES & CONDIMENTS ---
  { id: 'ciq_ketchup', name: 'Ketchup tomate', kcal: 108, proteinG: 1.2, carbsG: 24.5, fatG: 0.2, fiberG: 0.6, portion: { label: '1 c.à.s', grams: 15 }, aisle: 'Sauces & Condiments', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_mayonnaise', name: 'Mayonnaise classique', kcal: 685, proteinG: 1.2, carbsG: 2.5, fatG: 74.5, fiberG: 0, portion: { label: '1 c.à.s', grams: 15 }, aisle: 'Sauces & Condiments', diets: DAIRY_DIETS, allergens: ['eggs'] },
  { id: 'ciq_moutarde', name: 'Moutarde de Dijon', kcal: 152, proteinG: 7.2, carbsG: 4.5, fatG: 11.2, fiberG: 3.4, portion: { label: '1 c.à.c', grams: 10 }, aisle: 'Sauces & Condiments', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_sauce_soja', name: 'Sauce soja salée', kcal: 62, proteinG: 8.5, carbsG: 6.2, fatG: 0.1, fiberG: 0.5, portion: { label: '1 c.à.s', grams: 15 }, aisle: 'Sauces & Condiments', diets: ALL_DIETS_GLUTEN, allergens: ['soy', 'gluten'] },
  { id: 'ciq_sriracha', name: 'Sauce Sriracha / Piment', kcal: 92, proteinG: 1.6, carbsG: 19.5, fatG: 0.8, fiberG: 1.2, portion: { label: '1 c.à.c', grams: 10 }, aisle: 'Sauces & Condiments', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_pesto', name: 'Pesto vert au basilic', kcal: 445, proteinG: 4.8, carbsG: 5.5, fatG: 44.0, fiberG: 1.8, portion: { label: '1 c.à.s', grams: 20 }, aisle: 'Sauces & Condiments', diets: DAIRY_DIETS, allergens: ['dairy', 'nuts'] },
  { id: 'ciq_sauce_tomate', name: 'Sauce tomate cuisinée / Coulis', kcal: 48, proteinG: 1.6, carbsG: 6.8, fatG: 1.4, fiberG: 1.6, portion: { label: '3 c.à.s', grams: 80 }, aisle: 'Sauces & Condiments', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_creme_15', name: 'Crème fraîche légère 15 % MG', kcal: 166, proteinG: 2.8, carbsG: 4.2, fatG: 15.2, fiberG: 0, portion: { label: '1 c.à.s', grams: 20 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_creme_30', name: 'Crème fraîche entière 30 % MG', kcal: 294, proteinG: 2.2, carbsG: 3.1, fatG: 30.2, fiberG: 0, portion: { label: '1 c.à.s', grams: 20 }, aisle: 'Crèmerie & Œufs', diets: DAIRY_DIETS, allergens: ['dairy'] },
  { id: 'ciq_creme_soja', name: 'Crème liquide soja cuisine', kcal: 175, proteinG: 3.2, carbsG: 2.5, fatG: 17.0, fiberG: 0.4, portion: { label: '1 c.à.s', grams: 20 }, aisle: 'Boissons Végétales', diets: ALL_DIETS, allergens: ['soy'] },
  { id: 'ciq_vinaigrette', name: 'Vinaigrette classique à l’huile', kcal: 420, proteinG: 0.5, carbsG: 3.2, fatG: 44.5, fiberG: 0, portion: { label: '1 c.à.s', grams: 15 }, aisle: 'Sauces & Condiments', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_miel', name: 'Miel toutes fleurs', kcal: 318, proteinG: 0.4, carbsG: 79.0, fatG: 0, fiberG: 0, portion: { label: '1 c.à.c', grams: 10 }, aisle: 'Épicerie & Féculents', diets: DAIRY_DIETS, allergens: [] },
  { id: 'ciq_confiture', name: 'Confiture de fruits (fraise/abricot)', kcal: 246, proteinG: 0.5, carbsG: 60.0, fatG: 0.2, fiberG: 1.2, portion: { label: '1 c.à.s', grams: 20 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },
  { id: 'ciq_sirop_erable', name: 'Sirop d’érable pur', kcal: 265, proteinG: 0, carbsG: 66.5, fatG: 0, fiberG: 0, portion: { label: '1 c.à.s', grams: 15 }, aisle: 'Épicerie & Féculents', diets: ALL_DIETS, allergens: [] },

  // --- CLASSIQUES DU QUOTIDIEN / RESTAURATION ---
  { id: 'ciq_pizza_margherita', name: 'Pizza Margherita', kcal: 242, proteinG: 10.4, carbsG: 30.2, fatG: 8.6, fiberG: 2.0, portion: { label: '1/2 pizza', grams: 180 }, aisle: 'Restauration & Plats', diets: ['omnivore', 'vegetarian', 'halal'], allergens: ['gluten', 'dairy'] },
  { id: 'ciq_pizza_reine', name: 'Pizza Reine / 4 Fromages', kcal: 258, proteinG: 11.8, carbsG: 28.5, fatG: 10.5, fiberG: 1.8, portion: { label: '1/2 pizza', grams: 190 }, aisle: 'Restauration & Plats', diets: ['omnivore'], allergens: ['gluten', 'dairy'] },
  { id: 'ciq_burger_classique', name: 'Burger classique bœuf fromage', kcal: 256, proteinG: 13.5, carbsG: 23.0, fatG: 12.2, fiberG: 1.6, portion: { label: '1 burger', grams: 240 }, aisle: 'Restauration & Plats', diets: ['omnivore', 'halal'], allergens: ['gluten', 'dairy'] },
  { id: 'ciq_cheeseburger', name: 'Cheeseburger (fast-food)', kcal: 268, proteinG: 13.0, carbsG: 26.5, fatG: 12.0, fiberG: 1.5, portion: { label: '1 cheeseburger', grams: 120 }, aisle: 'Restauration & Plats', diets: ['omnivore', 'halal'], allergens: ['gluten', 'dairy'] },
  { id: 'ciq_kebab', name: 'Kebab (pain ou galette, viande + crudités)', kcal: 224, proteinG: 13.2, carbsG: 20.5, fatG: 9.8, fiberG: 1.8, portion: { label: '1 kebab', grams: 350 }, aisle: 'Restauration & Plats', diets: ['omnivore', 'halal'], allergens: ['gluten'] },
  { id: 'ciq_tacos_fr', name: 'Tacos français (viande + frites + sauce)', kcal: 265, proteinG: 11.5, carbsG: 25.0, fatG: 13.2, fiberG: 1.6, portion: { label: '1 tacos M', grams: 380 }, aisle: 'Restauration & Plats', diets: ['omnivore', 'halal'], allergens: ['gluten', 'dairy'] },
  { id: 'ciq_sushi_saumon', name: 'Sushi saumon (Nigiri)', kcal: 158, proteinG: 8.6, carbsG: 22.8, fatG: 3.4, fiberG: 0.6, portion: { label: '2 pièces', grams: 70 }, aisle: 'Restauration & Plats', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_maki_saumon', name: 'Maki / California roll saumon avocat', kcal: 162, proteinG: 6.4, carbsG: 24.0, fatG: 4.2, fiberG: 1.4, portion: { label: '6 pièces', grams: 150 }, aisle: 'Restauration & Plats', diets: FISH_DIETS, allergens: ['fish'] },
  { id: 'ciq_poke_bowl', name: 'Poke bowl saumon avocat riz', kcal: 156, proteinG: 9.2, carbsG: 17.5, fatG: 5.4, fiberG: 2.2, portion: { label: '1 bol', grams: 420 }, aisle: 'Restauration & Plats', diets: FISH_DIETS, allergens: ['fish', 'soy'] },
  { id: 'ciq_sandwich_jb', name: 'Sandwich jambon-beurre (baguette)', kcal: 254, proteinG: 11.2, carbsG: 33.5, fatG: 8.2, fiberG: 2.0, portion: { label: '1 sandwich', grams: 200 }, aisle: 'Restauration & Plats', diets: ['omnivore'], allergens: ['gluten', 'dairy'] },
  { id: 'ciq_sandwich_poulet', name: 'Sandwich poulet crudités', kcal: 212, proteinG: 12.6, carbsG: 25.4, fatG: 6.5, fiberG: 2.2, portion: { label: '1 sandwich', grams: 210 }, aisle: 'Restauration & Plats', diets: ['omnivore', 'halal'], allergens: ['gluten', 'eggs'] },
  { id: 'ciq_salade_cesar', name: 'Salade César au poulet', kcal: 168, proteinG: 11.8, carbsG: 8.5, fatG: 9.6, fiberG: 1.8, portion: { label: '1 bol', grams: 300 }, aisle: 'Restauration & Plats', diets: ['omnivore', 'halal'], allergens: ['gluten', 'dairy', 'eggs'] },
  { id: 'ciq_quiche_lorraine', name: 'Quiche lorraine', kcal: 288, proteinG: 10.6, carbsG: 18.2, fatG: 19.2, fiberG: 0.9, portion: { label: '1 part', grams: 150 }, aisle: 'Restauration & Plats', diets: ['omnivore'], allergens: ['gluten', 'dairy', 'eggs'] },
  { id: 'ciq_crepe_nature', name: 'Crêpe nature au froment', kcal: 218, proteinG: 7.4, carbsG: 31.0, fatG: 6.8, fiberG: 1.1, portion: { label: '1 crêpe', grams: 60 }, aisle: 'Boulangerie', diets: ['omnivore', 'vegetarian', 'halal'], allergens: ['gluten', 'dairy', 'eggs'] },
  { id: 'ciq_croissant', name: 'Croissant au beurre', kcal: 418, proteinG: 8.2, carbsG: 45.2, fatG: 22.4, fiberG: 2.1, portion: { label: '1 croissant', grams: 55 }, aisle: 'Boulangerie', diets: ['omnivore', 'vegetarian', 'halal'], allergens: ['gluten', 'dairy', 'eggs'] },
  { id: 'ciq_pain_chocolat', name: 'Pain au chocolat / Chocolatine', kcal: 424, proteinG: 7.8, carbsG: 46.8, fatG: 22.6, fiberG: 2.6, portion: { label: '1 pièce', grams: 65 }, aisle: 'Boulangerie', diets: ['omnivore', 'vegetarian', 'halal'], allergens: ['gluten', 'dairy', 'eggs'] },
  { id: 'ciq_frites', name: 'Frites de pomme de terre (cuites)', kcal: 288, proteinG: 3.8, carbsG: 36.5, fatG: 13.8, fiberG: 3.4, portion: { label: '1 portion moy.', grams: 140 }, aisle: 'Restauration & Plats', diets: ALL_DIETS, allergens: [] },
]);

/**
 * Normalisation tolérante aux accents, ligatures (œ -> oe, æ -> ae) et espaces
 * pour une recherche multi-mots instantanée (ex. "pates", "oeuf", "creme", "poulet riz").
 */
export function normalizeFoodSearchText(str) {
  return String(str || '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .replace(/[’'`]/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

// Index pré-calculé en RAM une seule fois pour un filtrage < 1 ms sur mobile
const CIQUAL_SEARCH_INDEX = CIQUAL_DB.map((item) => ({
  item,
  haystack: normalizeFoodSearchText(`${item.name} ${item.aisle}`),
  nameNorm: normalizeFoodSearchText(item.name),
}));

function scoreFoodMatch(nameNorm, haystack, tokens, fullQuery) {
  if (tokens.length === 0) return 1;
  for (const tk of tokens) {
    if (!haystack.includes(tk)) return 0;
  }
  let score = 10;
  if (nameNorm === fullQuery) score += 100;
  else if (nameNorm.startsWith(fullQuery)) score += 60;
  else if (nameNorm.startsWith(tokens[0])) score += 30;
  for (const tk of tokens) {
    if (nameNorm.includes(` ${tk}`) || nameNorm.startsWith(tk)) score += 12;
  }
  return score;
}

export function searchCiqualOffline(query = '', profile = null, { respectDietaryFilter = true } = {}) {
  const normQ = normalizeFoodSearchText(query);
  const tokens = normQ ? normQ.split(' ').filter(Boolean) : [];
  const diet = profile?.nutritionPrefs?.dietType || 'omnivore';
  const allergies = new Set((profile?.nutritionPrefs?.allergies || []).map((a) => String(a).toLowerCase()));

  const matches = [];
  for (const entry of CIQUAL_SEARCH_INDEX) {
    const item = entry.item;
    if (respectDietaryFilter && profile) {
      const dietOk = diet === 'omnivore' || item.diets.includes(diet);
      const allergyOk = !item.allergens.some((a) => allergies.has(a));
      if (!dietOk || !allergyOk) continue;
    }
    if (tokens.length === 0) {
      matches.push({ item, score: 1 });
      continue;
    }
    const score = scoreFoodMatch(entry.nameNorm, entry.haystack, tokens, normQ);
    if (score > 0) {
      matches.push({ item, score });
    }
  }

  if (tokens.length > 0) {
    matches.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  }
  return matches.map((m) => m.item);
}

/**
 * Recherche locale hybride instantanée (< 1 ms) :
 * 1) Aliments perso & produits Open Food Facts mis en cache ([PERSO])
 * 2) Base Ciqual enrichie ([CIQUAL], sans masquer un aliment explicitement tapé par l'utilisateur)
 */
export function searchHybridLocalFoods(query = '', customFoods = [], profile = null, { ciqualLimit = 18 } = {}) {
  const normQ = normalizeFoodSearchText(query);
  const tokens = normQ ? normQ.split(' ').filter(Boolean) : [];

  const customScored = [];
  for (const cf of customFoods || []) {
    const nameNorm = normalizeFoodSearchText(cf.name);
    const haystack = normalizeFoodSearchText(`${cf.name} ${cf.brand || ''} ${cf.aisle || ''}`);
    const score = tokens.length === 0 ? 1 : scoreFoodMatch(nameNorm, haystack, tokens, normQ);
    if (score > 0) {
      customScored.push({ item: cf, score });
    }
  }
  if (tokens.length > 0) {
    customScored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  }

  // Si requête vide : affiche les incontournables adaptés au régime ; si requête tapée : cherche toute la base Ciqual enrichie
  const ciqualMatches = searchCiqualOffline(query, profile, {
    respectDietaryFilter: tokens.length === 0,
  }).slice(0, ciqualLimit);

  return {
    customMatches: customScored.slice(0, 12).map((m) => m.item),
    ciqualMatches,
  };
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
   2. OPEN FOOD FACTS API FRANCE (0 CLÉ + ABORTCONTROLLER) & SCANNER CODE-BARRES
   ========================================================================== */

const barcodeCache = new Map();

function parseServingPortion(servingSize) {
  const raw = String(servingSize || '').trim();
  if (!raw) return null;
  const gMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:g|ml)\b/i);
  if (!gMatch) return null;
  const grams = Math.round(Number(gMatch[1].replace(',', '.')));
  if (!Number.isFinite(grams) || grams < 5 || grams > 1200) return null;
  return {
    label: raw.length <= 24 ? raw : `1 portion`,
    grams,
  };
}

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
    portion: parseServingPortion(product.serving_size),
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

export async function searchOpenFoodFactsText(query, options = 12) {
  const opts = typeof options === 'number' ? { pageSize: options, signal: null } : options || {};
  const pageSize = Number(opts.pageSize) || 12;
  const signal = opts.signal || undefined;

  const q = String(query || '').trim();
  if (q.length < 2) return [];
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];

  const url = `https://fr.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=${pageSize}&fields=code,product_name,product_name_fr,brands,serving_size,nutriscore_grade,nutriments`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.products || [])
      .map(normalizeOpenFoodFactsProduct)
      .filter((p) => p && p.name && (p.kcal > 0 || p.proteinG > 0));
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    return [];
  }
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

export const HIDDEN_FAT_SHORTCUTS = Object.freeze([
  { id: 'hf_oil', label: '+1 c.à.s huile (10g · 90 kcal)', name: 'Huile d’olive (cuisson)', state: 'prêt', grams: 10, kcal: 90, protein: 0, carbs: 0, fat: 10, fiber: 0 },
  { id: 'hf_butter', label: '+Beurre (10g · 74 kcal)', name: 'Beurre doux', state: 'prêt', grams: 10, kcal: 74, protein: 0.1, carbs: 0.1, fat: 8.2, fiber: 0 },
  { id: 'hf_vinaigrette', label: '+Vinaigrette (15g · 68 kcal)', name: 'Vinaigrette classique', state: 'prêt', grams: 15, kcal: 68, protein: 0.1, carbs: 0.8, fat: 7.2, fiber: 0 },
  { id: 'hf_sauce', label: '+Sauce (20g · 45 kcal)', name: 'Sauce / crème d’accompagnement', state: 'prêt', grams: 20, kcal: 45, protein: 0.6, carbs: 3.0, fat: 3.4, fiber: 0.1 },
]);

/**
 * Recalcule instantanément et sans perte de précision les macros d'un ingrédient
 * lors d'une modification de grammage (ancrage per100 ou ratio nouveau/ancien).
 */
export function scaleMealIngredientGrams(ingredient, nextGrams) {
  const grams = Math.max(0, Math.min(2500, Math.round(Number(nextGrams) || 0)));
  const prevGrams = Math.max(1, Number(ingredient?.grams) || 100);
  const per100 = ingredient?.per100 || {
    kcal: ((Number(ingredient?.kcal) || 0) / prevGrams) * 100,
    protein: ((Number(ingredient?.protein) || 0) / prevGrams) * 100,
    carbs: ((Number(ingredient?.carbs) || 0) / prevGrams) * 100,
    fat: ((Number(ingredient?.fat) || 0) / prevGrams) * 100,
    fiber: ((Number(ingredient?.fiber) || 0) / prevGrams) * 100,
  };
  const f = grams / 100;
  return {
    ...ingredient,
    grams,
    kcal: Math.round(per100.kcal * f),
    protein: Math.round(per100.protein * f * 10) / 10,
    carbs: Math.round(per100.carbs * f * 10) / 10,
    fat: Math.round(per100.fat * f * 10) / 10,
    fiber: Math.round(per100.fiber * f * 10) / 10,
    per100,
  };
}

/**
 * Crée une ligne d'ingrédient normalisée depuis un aliment Ciqual / Perso ou une saisie manuelle.
 */
export function createMealIngredientFromFood(food, grams = 100, state = 'cuit') {
  const g = Math.max(1, Math.min(2500, Math.round(Number(grams) || 100)));
  const per100 = {
    kcal: Number(food?.kcal) || 0,
    protein: Number(food?.proteinG ?? food?.protein) || 0,
    carbs: Number(food?.carbsG ?? food?.carbs) || 0,
    fat: Number(food?.fatG ?? food?.fat) || 0,
    fiber: Number(food?.fiberG ?? food?.fiber) || 0,
  };
  return scaleMealIngredientGrams(
    {
      id: `ing_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: String(food?.name || 'Ingrédient').trim(),
      state,
      grams: g,
      note: food?.source === 'custom' ? 'aliment perso' : food?.id?.startsWith('hf_') ? 'ajout rapide' : 'ajout manuel',
      per100,
    },
    g
  );
}

/**
 * Calcule les totaux d'une liste d'ingrédients en tenant compte d'un multiplicateur de portion consommée.
 */
export function computeMealIngredientsTotals(ingredients = [], portionMultiplier = 1) {
  const mult = Math.max(0.1, Math.min(3, Number(portionMultiplier) || 1));
  const raw = (ingredients || []).reduce(
    (acc, item) => ({
      grams: acc.grams + (Number(item.grams) || 0),
      kcal: acc.kcal + (Number(item.kcal) || 0),
      protein: acc.protein + (Number(item.protein) || 0),
      carbs: acc.carbs + (Number(item.carbs) || 0),
      fat: acc.fat + (Number(item.fat) || 0),
      fiber: acc.fiber + (Number(item.fiber) || 0),
    }),
    { grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );

  return {
    grams: Math.round(raw.grams * mult),
    kcal: Math.round(raw.kcal * mult),
    protein: Math.round(raw.protein * mult * 10) / 10,
    carbs: Math.round(raw.carbs * mult * 10) / 10,
    fat: Math.round(raw.fat * mult * 10) / 10,
    fiber: Math.round(raw.fiber * mult * 10) / 10,
  };
}

export async function analyzeMealPhoto(imageDataUrl, profile, aiSettings, options = {}) {
  const targets = options.targets || calculateMacroTargets(profile);
  const consumed = options.consumed || null;
  const userHint = String(options.userHint || '').trim();

  const remainingLine = consumed
    ? `Reste à manger aujourd'hui : ${Math.max(0, Math.round(targets.kcal - consumed.kcal))} kcal (P ${Math.max(0, Math.round(targets.proteinG - consumed.proteinG))}g · G ${Math.max(0, Math.round(targets.carbsG - consumed.carbsG))}g · L ${Math.max(0, Math.round(targets.fatG - consumed.fatG))}g).`
    : `Cible journalière : ${targets.kcal} kcal (P ${targets.proteinG}g / G ${targets.carbsG}g / L ${targets.fatG}g).`;

  const hintBlock = userHint
    ? `\nPRÉCISION IMPORTANTE DE L'UTILISATEUR (à respecter en priorité) : "${userHint}".`
    : '';

  const systemPrompt =
    'Tu es un diététicien du sport français (référentiel Ciqual / ANSES). Analyse la photo d’assiette avec précision ingrédient par ingrédient et renvoie STRICTEMENT un objet JSON valide, sans texte ni balises markdown autour.';

  const prompt = `Identifie le plat global et décompose CHAQUE ingrédient visible sur la photo avec son état (cuit, cru ou prêt), son grammage réaliste et ses macros exactes pour ce grammage.
Objectif utilisateur : ${profile?.goal || 'recomp'}.
${remainingLine}${hintBlock}

Schéma JSON STRICT à respecter :
{
  "dishName": "Poulet curry & riz basmati",
  "confidence": "high | medium | low",
  "confidenceReason": "Courte justification (ex. Sauce partiellement masquée)",
  "estimatedTotalGrams": 420,
  "ingredients": [
    {
      "name": "Blanc de poulet grillé",
      "state": "cuit",
      "grams": 160,
      "kcal": 264,
      "protein": 49.6,
      "carbs": 0,
      "fat": 5.8,
      "fiber": 0,
      "note": "estimation visuelle"
    }
  ],
  "hiddenFatsWarning": true,
  "hiddenFatsMessage": "Sauce brillante ou huile de cuisson probable (+10 g).",
  "coachTip": "Conseil court d'alignement avec les macros restantes du jour.",
  "alignment_score": 84
}`;

  const routed = await routeAIRequest({
    taskType: 'meal_analysis',
    prompt,
    systemPrompt,
    images: imageDataUrl ? [imageDataUrl] : [],
    context: { profile, targets, userHint },
    settings: aiSettings,
    expectJson: true,
  });

  return {
    ...routed,
    data: normalizeMealVisionPayload(routed.data),
  };
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

/**
 * Estime les valeurs nutritionnelles pour 100 g (et portion usuelle) d'un aliment
 * ou plat introuvable en base, via le routeur IA multi-moteurs (avec repli prudent si Niveau 0).
 */
export async function estimateFoodMacrosWithAI(foodQuery, profile, aiSettings) {
  const cleanQuery = String(foodQuery || '').trim();
  if (!cleanQuery) {
    throw new Error('Saisis le nom d’un aliment à estimer.');
  }

  const systemPrompt =
    'Tu es un diététicien du sport français (référentiel Ciqual / ANSES). Réponds STRICTEMENT avec un objet JSON valide, sans texte ni balises markdown.';
  const prompt = `Estime de façon réaliste les valeurs nutritionnelles POUR 100 G (et une portion usuelle réaliste en grammes) de cet aliment ou plat : "${cleanQuery}".
Schéma JSON strict :
{
  "name": "<nom propre en français>",
  "kcal": 210,
  "protein_g": 12.5,
  "carbs_g": 22.0,
  "fat_g": 7.5,
  "fiber_g": 2.0,
  "portion_label": "1 portion",
  "portion_grams": 150
}`;

  const res = await routeAIRequest({
    taskType: 'food_estimate',
    prompt,
    systemPrompt,
    context: { profile, foodQuery: cleanQuery },
    settings: aiSettings,
    expectJson: true,
  });

  const d = res?.data && typeof res.data === 'object' ? res.data : {};
  const kcal = Math.max(0, Math.round(Number(d.kcal) || 0));
  const proteinG = Math.max(0, Math.round((Number(d.protein_g ?? d.proteinG) || 0) * 10) / 10);
  const carbsG = Math.max(0, Math.round((Number(d.carbs_g ?? d.carbsG) || 0) * 10) / 10);
  const fatG = Math.max(0, Math.round((Number(d.fat_g ?? d.fatG) || 0) * 10) / 10);
  const fiberG = Math.max(0, Math.round((Number(d.fiber_g ?? d.fiberG) || 0) * 10) / 10);
  const portionGrams = Math.round(Number(d.portion_grams ?? d.portionGrams) || 0);

  // Si Niveau 0 ou réponse incomplète, estimation prudente cohérente
  const fallbackKcal = kcal || Math.round(proteinG * 4 + carbsG * 4 + fatG * 9) || 180;

  return {
    tierUsed: res?.tierUsed ?? 0,
    provider: res?.provider || null,
    usedFallback: Boolean(res?.usedFallback),
    food: {
      name: String(d.name || cleanQuery).trim(),
      kcal: fallbackKcal,
      proteinG: proteinG || (kcal ? 0 : 10),
      carbsG: carbsG || (kcal ? 0 : 20),
      fatG: fatG || (kcal ? 0 : 6),
      fiberG,
      portion:
        portionGrams >= 5 && portionGrams <= 1000
          ? { label: String(d.portion_label || d.portionLabel || '1 portion').trim(), grams: portionGrams }
          : { label: '1 portion', grams: 150 },
      source: 'ai_estimated',
    },
  };
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
