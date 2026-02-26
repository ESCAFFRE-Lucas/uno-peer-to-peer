/**
 * deck.js — Génération déterministe du deck UNO via seed (Mulberry32)
 */

/**
 * PRNG Mulberry32 : générateur pseudo-aléatoire à partir d'un seed numérique.
 * @param {number} seed
 * @returns {function} random() → float [0, 1)
 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convertit un seed string ou numérique en nombre.
 * @param {string|number} seed
 * @returns {number}
 */
function parseSeed(seed) {
  if (typeof seed === "number") return seed;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Génère un deck UNO standard de 108 cartes.
 * @returns {Array} tableau de cartes non mélangées
 */
function createRawDeck() {
  const colors = ["red", "blue", "green", "yellow"];
  const cards = [];
  let id = 0;

  colors.forEach((color) => {
    // Une carte 0
    cards.push({ id: `card_${id++}`, color, value: "0" });
    // Deux de chaque pour 1-9, skip, reverse, +2
    const vals = [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "skip",
      "reverse",
      "+2",
    ];
    vals.forEach((v) => {
      cards.push({ id: `card_${id++}`, color, value: v });
      cards.push({ id: `card_${id++}`, color, value: v });
    });
  });

  // 4 jokers (wild)
  for (let i = 0; i < 4; i++) {
    cards.push({ id: `card_${id++}`, color: "black", value: "wild" });
  }
  // 4 +4 (wild+4)
  for (let i = 0; i < 4; i++) {
    cards.push({ id: `card_${id++}`, color: "black", value: "+4" });
  }

  return cards; // 108 cartes
}

/**
 * Mélange un tableau en utilisant l'algorithme Fisher-Yates avec le PRNG fourni.
 * @param {Array} arr
 * @param {function} random
 * @returns {Array} tableau mélangé (in-place)
 */
function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Génère un deck UNO mélangé de façon déterministe à partir d'un seed.
 * Tous les peers qui utilisent le même seed obtiendront le même deck.
 * @param {string|number} seed
 * @returns {Array} tableau de 108 cartes mélangées
 */
function generateDeck(seed) {
  const numericSeed = parseSeed(seed);
  const random = mulberry32(numericSeed);
  const deck = createRawDeck();
  return shuffle(deck, random);
}

/**
 * Génère un seed aléatoire (utilisé par l'hôte au moment du lancement).
 * @returns {string}
 */
function generateSeed() {
  return `seed_${Date.now()}_${Math.floor(Math.random() * 99999)}`;
}

/**
 * Retourne l'emoji ou le label de la valeur d'une carte.
 * @param {string} value
 * @returns {string}
 */
function getCardLabel(value) {
  const labels = {
    skip: "⊘",
    reverse: "⇄",
    "+2": "+2",
    wild: "★",
    "+4": "+4",
  };
  return labels[value] || value;
}

/**
 * Vérifie si une carte peut être jouée sur la carte du dessus.
 * @param {object} card — carte à jouer
 * @param {object} topCard — carte du dessus de la pile
 * @param {string} activeColor — couleur active (importante pour les noirs)
 * @returns {boolean}
 */
function isPlayable(card, topCard, activeColor) {
  if (!card || !topCard) return false;
  // Les cartes noires (wild, +4) sont toujours jouables
  if (card.color === "black") return true;
  // Même couleur que la couleur active
  if (card.color === activeColor) return true;
  // Même valeur que la carte du dessus
  if (card.value === topCard.value) return true;
  return false;
}
