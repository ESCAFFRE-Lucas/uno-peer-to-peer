/**
 * serverDeck.js — Logique de cartes UNO (Node.js/CommonJS)
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

function createRawDeck() {
  const colors = ["red", "blue", "green", "yellow"];
  const cards = [];
  let id = 0;

  colors.forEach((color) => {
    cards.push({ id: `card_${id++}`, color, value: "0" });
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

  for (let i = 0; i < 4; i++)
    cards.push({ id: `card_${id++}`, color: "black", value: "wild" });
  for (let i = 0; i < 4; i++)
    cards.push({ id: `card_${id++}`, color: "black", value: "+4" });

  return cards;
}

function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateDeck(seed) {
  const numericSeed = parseSeed(seed);
  const random = mulberry32(numericSeed);
  const deck = createRawDeck();
  return shuffle(deck, random);
}

function generateSeed() {
  return `seed_${Date.now()}_${Math.floor(Math.random() * 99999)}`;
}

function isPlayable(card, topCard, activeColor) {
  if (!card || !topCard) return false;
  if (card.color === "black") return true;
  if (card.color === activeColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

module.exports = {
  generateDeck,
  generateSeed,
  isPlayable,
  mulberry32,
  parseSeed,
  shuffle,
};
