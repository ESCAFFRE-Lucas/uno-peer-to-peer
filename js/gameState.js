/**
 * gameState.js — État global du jeu UNO P2P
 * L'hôte est le seul à avoir accès à l'intégralité (deck complet).
 * Les guests reçoivent uniquement l'état public (getPublicState).
 */

class GameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.gameId = null;
    this.gameStatus = "waiting"; // 'waiting' | 'playing' | 'finished'
    this.seed = null;
    this.hostId = null;

    this.players = []; // [{ id, peerId, name, hand, handCount, hasSaidUno, isConnected, isReady }]
    this.maxPlayers = 4;

    this.deck = []; // cartes restantes à piocher (hôte uniquement)
    this.discardPile = []; // pile de défausse (la dernière = visible)
    this.currentPlayerIndex = 0;
    this.direction = 1; // 1 = sens normal, -1 = sens inverse
    this.activeColor = null; // couleur active (important pour les jokers)
    this.pendingDrawCount = 0; // cumul des +2/+4
    this.lastActionId = 0;
  }

  /** Initialise la salle (appelé par l'hôte) */
  initRoom(gameId, hostPlayer) {
    this.reset();
    this.gameId = gameId;
    this.hostId = hostPlayer.id;
    this.players = [
      {
        id: hostPlayer.id,
        peerId: hostPlayer.peerId,
        name: hostPlayer.name,
        hand: [],
        handCount: 0,
        hasSaidUno: false,
        isConnected: true,
        isReady: true,
      },
    ];
    this.gameStatus = "waiting";
    return this.getRoomState();
  }

  /** Ajoute un guest au lobby */
  addPlayer(player) {
    if (this.players.length >= this.maxPlayers) return false;
    if (this.players.find((p) => p.id === player.id)) return false;
    this.players.push({
      id: player.id,
      peerId: player.peerId,
      name: player.name,
      hand: [],
      handCount: 0,
      hasSaidUno: false,
      isConnected: true,
      isReady: false,
    });
    return true;
  }

  /** Supprime un joueur (déconnexion) */
  removePlayer(playerId) {
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return false;
    this.players[idx].isConnected = false;
    return true;
  }

  /** Met à jour le statut prêt d'un joueur */
  setPlayerReady(playerId, isReady) {
    const player = this.players.find((p) => p.id === playerId);
    if (player) player.isReady = isReady;
  }

  /** Validations lobby : peut-on lancer la partie ? */
  getLobbyValidation() {
    const connectedPlayers = this.players.filter((p) => p.isConnected);
    const notReadyPlayers = connectedPlayers.filter((p) => !p.isReady);
    const canStart =
      connectedPlayers.length >= 2 && notReadyPlayers.length === 0;
    return {
      canStart,
      missingPlayers: Math.max(0, 2 - connectedPlayers.length),
      notReadyCount: notReadyPlayers.length,
      validationMessage: canStart
        ? "Tous les joueurs sont prêts. Lancement imminent !"
        : notReadyPlayers.length > 0
          ? `${notReadyPlayers.length} joueur(s) pas encore prêt(s)`
          : "Il faut au moins 2 joueurs pour lancer la partie",
    };
  }

  /**
   * Initialise le jeu : génère le deck, distribue 7 cartes à chaque joueur,
   * pose la première carte sur la pile.
   * @param {string} seed
   */
  startGame(seed) {
    this.seed = seed;
    this.gameStatus = "playing";
    this.lastActionId = 0;

    // Générer et distribuer le deck
    this.deck = generateDeck(seed);

    // Distribuer 7 cartes à chaque joueur connecté
    const activePlayers = this.players.filter((p) => p.isConnected);
    activePlayers.forEach((player) => {
      player.hand = this.deck.splice(0, 7);
      player.handCount = 7;
      player.hasSaidUno = false;
    });

    // La première carte ne doit pas être noire
    let firstCard;
    do {
      firstCard = this.deck.shift();
      if (firstCard.color === "black") {
        this.deck.push(firstCard); // remettre à la fin
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

  /** Joue une carte pour un joueur. Retourne false si invalide. */
  playCard(playerId, cardId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return null;

    const cardIdx = player.hand.findIndex((c) => c.id === cardId);
    if (cardIdx === -1) return null;

    const card = player.hand[cardIdx];
    const topCard = this.discardPile[this.discardPile.length - 1];

    // Vérification de la jouabilité
    if (!isPlayable(card, topCard, this.activeColor)) return null;

    // Retirer la carte de la main
    player.hand.splice(cardIdx, 1);
    player.handCount = player.hand.length;

    // Poser sur la pile
    this.discardPile.push(card);

    // Reset UNO si le joueur a plus d'1 carte
    if (player.hand.length > 1) player.hasSaidUno = false;

    this.lastActionId++;
    return card;
  }

  /** Applique les effets d'une carte (skip, reverse, +2, +4) */
  applyCardEffect(card, chosenColor = null) {
    const activePlayers = this.players.filter((p) => p.isConnected);
    const count = activePlayers.length;
    let nextPlayerIndex = this.currentPlayerIndex;
    let skipExtra = false;

    switch (card.value) {
      case "reverse":
        this.direction *= -1;
        if (count === 2) {
          // En 2 joueurs, reverse = skip
          skipExtra = true;
        }
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
      case "wild":
      case "wild+4":
        break;
    }

    // Couleur active
    if (card.color === "black" && chosenColor) {
      this.activeColor = chosenColor;
    } else {
      this.activeColor = card.color;
    }

    // Avancer au prochain joueur
    nextPlayerIndex = this.getNextPlayerIndex();
    if (skipExtra) {
      nextPlayerIndex = this.getNextPlayerIndex(nextPlayerIndex);
    }
    this.currentPlayerIndex = nextPlayerIndex;

    this.lastActionId++;
  }

  /** Calcule l'index du prochain joueur actif */
  getNextPlayerIndex(from = null) {
    const activePlayers = this.players.filter((p) => p.isConnected);
    if (activePlayers.length === 0) return 0;

    const currentIdx = from !== null ? from : this.currentPlayerIndex;
    const currentPlayer = activePlayers[currentIdx % activePlayers.length];
    const currentRealIdx = this.players.indexOf(currentPlayer);

    let nextRealIdx = currentRealIdx;
    do {
      nextRealIdx =
        (nextRealIdx + this.direction + this.players.length) %
        this.players.length;
    } while (!this.players[nextRealIdx].isConnected);

    // Retourner l'index dans activePlayers
    return activePlayers.indexOf(this.players[nextRealIdx]);
  }

  /** Pioche N cartes pour un joueur */
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
    this.lastActionId++;
    return drawn;
  }

  /** Remet la défausse dans le deck quand il est vide */
  reshuffleDeck() {
    if (this.discardPile.length <= 1) return;
    const top = this.discardPile.pop();
    const random = mulberry32(
      parseSeed(this.seed + "_reshuffle_" + this.lastActionId),
    );
    this.deck = shuffle([...this.discardPile], random);
    this.discardPile = [top];
  }

  /** Valide l'annonce UNO */
  validateUno(shouterId, targetId, type) {
    if (type === "UNO") {
      // Le joueur annonce UNO pour lui-même
      const player = this.players.find((p) => p.id === shouterId);
      if (player && player.hand.length === 1) {
        player.hasSaidUno = true;
        this.lastActionId++;
        return { valid: true, playerId: shouterId, hasSaidUno: true };
      }
    } else if (type === "COUNTER_UNO") {
      // Contre-UNO : cibler quelqu'un qui a 1 carte et n'a pas dit UNO
      const target = this.players.find((p) => p.id === targetId);
      if (target && target.hand.length === 1 && !target.hasSaidUno) {
        // Pénalité : piocher 2 cartes
        this.drawCards(targetId, 2);
        this.lastActionId++;
        return { valid: true, playerId: targetId, penalty: 2 };
      }
    }
    return { valid: false };
  }

  /** Vérifie si un joueur a gagné */
  checkWinner() {
    const winner = this.players.find(
      (p) => p.hand.length === 0 && p.isConnected,
    );
    return winner || null;
  }

  /** Calcule les scores finaux */
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

  /** Retourne l'état public (sans les mains privées, sans le deck) */
  getPublicState() {
    return {
      gameId: this.gameId,
      gameStatus: this.gameStatus,
      hostId: this.hostId,
      players: this.players.map((p) => ({
        id: p.id,
        peerId: p.peerId,
        name: p.name,
        handCount: p.handCount,
        hasSaidUno: p.hasSaidUno,
        isConnected: p.isConnected,
        isReady: p.isReady,
      })),
      discardTop: this.discardPile.length
        ? this.discardPile[this.discardPile.length - 1]
        : null,
      deckRemaining: this.deck.length,
      currentPlayerIndex: this.currentPlayerIndex,
      direction: this.direction,
      activeColor: this.activeColor,
      pendingDrawCount: this.pendingDrawCount,
      lastActionId: this.lastActionId,
    };
  }

  /** Retourne l'état de la salle (lobby) */
  getRoomState() {
    return {
      gameId: this.gameId,
      gameStatus: this.gameStatus,
      hostId: this.hostId,
      players: this.players.map((p) => ({
        id: p.id,
        peerId: p.peerId,
        name: p.name,
        isReady: p.isReady,
        isConnected: p.isConnected,
      })),
      maxPlayers: this.maxPlayers,
    };
  }

  /** Retourne la main privée d'un joueur (uniquement pour lui) */
  getPlayerHand(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    return player ? player.hand : [];
  }

  /** Retourne l'ID du joueur actif */
  getCurrentPlayerId() {
    const activePlayers = this.players.filter((p) => p.isConnected);
    const player =
      activePlayers[this.currentPlayerIndex % activePlayers.length];
    return player ? player.id : null;
  }
}

// Singleton partagé
const gameState = new GameState();
