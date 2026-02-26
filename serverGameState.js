/**
 * serverGameState.js — État global du jeu UNO centralisé sur le serveur
 */

const {
  generateDeck,
  isPlayable,
  mulberry32,
  parseSeed,
  shuffle,
} = require("./serverDeck");

class GameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.gameId = null;
    this.gameStatus = "waiting"; // 'waiting' | 'playing' | 'finished'
    this.seed = null;
    this.hostId = null;

    this.players = []; // [{ id, socketId, name, hand, handCount, hasSaidUno, isConnected, isReady }]
    this.maxPlayers = 4;

    this.deck = [];
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.activeColor = null;
    this.pendingDrawCount = 0;
    this.lastActionId = 0;
  }

  initRoom(gameId, hostPlayer) {
    this.reset();
    this.gameId = gameId;
    this.hostId = hostPlayer.id;
    this.players = [
      {
        id: hostPlayer.id,
        socketId: hostPlayer.socketId,
        name: hostPlayer.name,
        hand: [],
        handCount: 0,
        hasSaidUno: false,
        isConnected: true,
        isReady: true,
      },
    ];
    this.gameStatus = "waiting";
  }

  addPlayer(player) {
    if (this.players.length >= this.maxPlayers) return false;
    if (this.players.find((p) => p.id === player.id)) return false;
    this.players.push({
      id: player.id,
      socketId: player.socketId,
      name: player.name,
      hand: [],
      handCount: 0,
      hasSaidUno: false,
      isConnected: true,
      isReady: false,
    });
    return true;
  }

  removePlayerBySocket(socketId) {
    const player = this.players.find((p) => p.socketId === socketId);
    if (player) {
      player.isConnected = false;
      return player.id;
    }
    return null;
  }

  setPlayerReady(playerId, isReady) {
    const player = this.players.find((p) => p.id === playerId);
    if (player) player.isReady = isReady;
  }

  getLobbyValidation() {
    const connectedPlayers = this.players.filter((p) => p.isConnected);
    const notReadyPlayers = connectedPlayers.filter((p) => !p.isReady);
    const canStart =
      connectedPlayers.length >= 2 && notReadyPlayers.length === 0;
    return {
      canStart,
      validationMessage: canStart
        ? "Prêt !"
        : notReadyPlayers.length > 0
          ? `${notReadyPlayers.length} joueur(s) non prêt(s)`
          : "Besoin de 2 joueurs",
    };
  }

  startGame(seed) {
    this.seed = seed;
    this.gameStatus = "playing";
    this.deck = generateDeck(seed);

    this.players
      .filter((p) => p.isConnected)
      .forEach((player) => {
        player.hand = this.deck.splice(0, 7);
        player.handCount = 7;
        player.hasSaidUno = false;
      });

    let firstCard;
    do {
      firstCard = this.deck.shift();
      if (firstCard.color === "black") {
        this.deck.push(firstCard);
        firstCard = null;
      }
    } while (!firstCard);

    this.discardPile = [firstCard];
    this.activeColor = firstCard.color;
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.pendingDrawCount = 0;
    this.lastActionId = 1;

    return firstCard;
  }

  playCard(playerId, cardId, chosenColor = null) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return null;

    const cardIdx = player.hand.findIndex((c) => c.id === cardId);
    if (cardIdx === -1) return null;

    const card = player.hand[cardIdx];
    const topCard = this.discardPile[this.discardPile.length - 1];

    if (!isPlayable(card, topCard, this.activeColor)) return null;

    player.hand.splice(cardIdx, 1);
    player.handCount = player.hand.length;
    this.discardPile.push(card);

    if (player.hand.length > 1) player.hasSaidUno = false;

    this.applyCardEffect(card, chosenColor);
    this.lastActionId++;
    return card;
  }

  applyCardEffect(card, chosenColor = null) {
    const activePlayers = this.players.filter((p) => p.isConnected);
    let skipExtra = false;

    switch (card.value) {
      case "reverse":
        this.direction *= -1;
        if (activePlayers.length === 2) skipExtra = true;
        break;
      case "skip":
        skipExtra = true;
        break;
      case "+2":
        this.pendingDrawCount += 2;
        skipExtra = true;
        break;
      case "+4":
        this.pendingDrawCount += 4;
        skipExtra = true;
        break;
    }

    if (card.color === "black" && chosenColor) {
      this.activeColor = chosenColor;
    } else {
      this.activeColor = card.color;
    }

    this.currentPlayerIndex = this.getNextPlayerIndex();
    if (skipExtra) {
      this.currentPlayerIndex = this.getNextPlayerIndex();
    }
  }

  getNextPlayerIndex() {
    const activePlayers = this.players.filter((p) => p.isConnected);
    if (activePlayers.length === 0) return 0;

    const currentPlayer =
      activePlayers[this.currentPlayerIndex % activePlayers.length];
    const realIdx = this.players.indexOf(currentPlayer);

    let nextRealIdx = realIdx;
    do {
      nextRealIdx =
        (nextRealIdx + this.direction + this.players.length) %
        this.players.length;
    } while (!this.players[nextRealIdx].isConnected);

    return activePlayers.indexOf(this.players[nextRealIdx]);
  }

  drawCards(playerId, count = 1) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return [];

    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (this.deck.length === 0) this.reshuffleDeck();
      if (this.deck.length === 0) break;
      const card = this.deck.shift();
      player.hand.push(card);
      drawn.push(card);
    }
    player.handCount = player.hand.length;
    player.hasSaidUno = false;

    // Si on a pioché 1 seule carte car on ne pouvait pas jouer, on passe le tour
    if (count === 1 && this.pendingDrawCount === 0) {
      this.currentPlayerIndex = this.getNextPlayerIndex();
    } else {
      this.pendingDrawCount = 0; // On vient de subir la pénalité
      this.currentPlayerIndex = this.getNextPlayerIndex();
    }

    this.lastActionId++;
    return drawn;
  }

  reshuffleDeck() {
    if (this.discardPile.length <= 1) return;
    const top = this.discardPile.pop();
    const random = mulberry32(
      parseSeed(this.seed + "_reshuffle_" + this.lastActionId),
    );
    this.deck = shuffle([...this.discardPile], random);
    this.discardPile = [top];
  }

  validateUno(shouterId, targetId, type) {
    if (type === "UNO") {
      const player = this.players.find((p) => p.id === shouterId);
      if (player && player.hand.length === 1) {
        player.hasSaidUno = true;
        this.lastActionId++;
        return { valid: true, playerId: shouterId, hasSaidUno: true };
      }
    } else if (type === "COUNTER_UNO") {
      const target = this.players.find((p) => p.id === targetId);
      if (target && target.hand.length === 1 && !target.hasSaidUno) {
        this.drawCards(targetId, 2);
        this.lastActionId++;
        return { valid: true, playerId: targetId, penalty: 2 };
      }
    }
    return { valid: false };
  }

  checkWinner() {
    return this.players.find((p) => p.hand.length === 0 && p.isConnected);
  }

  calculateScores() {
    const scores = {};
    this.players.forEach((p) => {
      let points = 0;
      p.hand.forEach((card) => {
        if (["wild", "+4"].includes(card.value)) points += 50;
        else if (["skip", "reverse", "+2"].includes(card.value)) points += 20;
        else points += parseInt(card.value) || 0;
      });
      scores[p.id] = points;
    });
    return scores;
  }

  getPublicState() {
    return {
      gameId: this.gameId,
      gameStatus: this.gameStatus,
      hostId: this.hostId,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        handCount: p.handCount,
        hasSaidUno: p.hasSaidUno,
        isConnected: p.isConnected,
        isReady: p.isReady,
      })),
      discardTop: this.discardPile[this.discardPile.length - 1] || null,
      deckRemaining: this.deck.length,
      currentPlayerIndex: this.currentPlayerIndex,
      direction: this.direction,
      activeColor: this.activeColor,
      pendingDrawCount: this.pendingDrawCount,
      lastActionId: this.lastActionId,
    };
  }

  getCurrentPlayerId() {
    const activePlayers = this.players.filter((p) => p.isConnected);
    return activePlayers[this.currentPlayerIndex]?.id;
  }
}

module.exports = GameState;
