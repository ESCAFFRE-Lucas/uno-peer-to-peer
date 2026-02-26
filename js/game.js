/**
 * game.js — Moteur de jeu UNO P2P
 * L'hôte valide et diffuse toutes les actions.
 * Les guests envoient leurs actions à l'hôte.
 */

// ===== ÉTAT LOCAL DU JEU =====
const game = {
  myId: null,
  myName: null,
  myPeerId: null,
  isHost: false,
  roomCode: null,
  hostPeerId: null,
  players: [],
  myHand: [], // Main locale du joueur
  publicState: null, // Dernier état public reçu
  pendingCardId: null, // Carte en attente de choix de couleur
};

// ===== INITIALISATION =====
document.addEventListener("DOMContentLoaded", async () => {
  loadSessionData();

  if (!game.myId || !game.roomCode) {
    window.location.href = "index.html";
    return;
  }

  try {
    await initPeerForGame();
    await startGameSession();
  } catch (err) {
    showToast("Erreur de connexion : " + err.message, "error");
    setTimeout(() => (window.location.href = "index.html"), 3000);
  }

  setupGameButtons();
});

// ===== CHARGER LES DONNÉES DE SESSION =====
function loadSessionData() {
  game.myId = sessionStorage.getItem("uno_my_id");
  game.myName = sessionStorage.getItem("uno_my_name");
  game.myPeerId = sessionStorage.getItem("uno_my_peer_id");
  game.isHost = sessionStorage.getItem("uno_is_host") === "1";
  game.roomCode = sessionStorage.getItem("uno_room_code");
  game.hostPeerId = sessionStorage.getItem("uno_host_peer_id");
  game.seed = sessionStorage.getItem("uno_seed");
  try {
    game.players = JSON.parse(sessionStorage.getItem("uno_players") || "[]");
  } catch {
    game.players = [];
  }
}

// ===== INITIALISER PEER POUR LE JEU =====
async function initPeerForGame() {
  // Recréer le peer avec le même ID (si possible) ou un nouveau
  await peerManager.initPeer(game.myName);
  game.myPeerId = peerManager.myPeerId;

  peerManager.onMessage = handleGameMessage;
  peerManager.onDisconnect = onPlayerDisconnected;

  if (game.isHost) {
    peerManager.isHost = true;
    peerManager.listenAsHost();
  } else {
    // Guest reconnecte à l'hôte
    await peerManager.connectToHost(game.hostPeerId);
  }
}

// ===== DÉMARRER LA SESSION DE JEU =====
async function startGameSession() {
  if (game.isHost) {
    // L'hôte initialise le jeu localement
    hostInitGame();
  } else {
    // Le guest demande son état initial
    peerManager.sendToHost({
      action: "REQUEST_GAME_STATE",
      payload: { playerId: game.myId },
    });
  }
}

// ===== HÔTE : INITIALISER LE JEU =====
function hostInitGame() {
  // Reconstruire les joueurs dans le gameState
  game.players.forEach((p) => {
    if (!gameState.players.find((gp) => gp.id === p.id)) {
      gameState.addPlayer(p);
    }
  });

  const firstCard = gameState.startGame(game.seed);
  game.myHand = gameState.getPlayerHand(game.myId);
  game.publicState = gameState.getPublicState();

  // Envoyer GAME_START à chaque guest avec sa main privée
  gameState.players
    .filter((p) => p.id !== game.myId && p.isConnected)
    .forEach((p) => {
      const hand = gameState.getPlayerHand(p.id);
      peerManager.send(p.peerId, {
        action: "GAME_START",
        payload: {
          gameId: gameState.gameId,
          status: "playing",
          seed: game.seed,
          players: gameState.getPublicState().players,
          firstCard,
          currentPlayerIndex: 0,
          lastActionId: 1,
          yourHand: hand,
        },
      });
    });

  renderGameState();
}

// ===== MESSAGES DE JEU (reçus) =====
function handleGameMessage(data, fromPeerId) {
  const { action, payload } = data;

  switch (action) {
    // ---- L'hôte envoie l'état initial ----
    case "GAME_START": {
      game.myHand = payload.yourHand || [];
      game.players = payload.players || game.players;
      game.publicState = {
        gameId: payload.gameId,
        gameStatus: "playing",
        players: payload.players,
        discardTop: payload.firstCard,
        currentPlayerIndex: payload.currentPlayerIndex,
        direction: 1,
        activeColor: payload.firstCard?.color,
        pendingDrawCount: 0,
        deckRemaining: 108 - payload.players.length * 7 - 1,
        lastActionId: payload.lastActionId,
      };
      renderGameState();
      break;
    }

    // ---- Un guest demande l'état initial (rejoint après lancement) ----
    case "REQUEST_GAME_STATE": {
      if (!game.isHost) return;
      const requestingPlayer = gameState.players.find(
        (p) => p.id === payload.playerId,
      );
      if (!requestingPlayer) return;
      const hand = gameState.getPlayerHand(payload.playerId);
      peerManager.send(fromPeerId, {
        action: "GAME_START",
        payload: {
          gameId: gameState.gameId,
          status: "playing",
          seed: game.seed,
          players: gameState.getPublicState().players,
          firstCard: gameState.discardPile[gameState.discardPile.length - 1],
          currentPlayerIndex: gameState.currentPlayerIndex,
          lastActionId: gameState.lastActionId,
          yourHand: hand,
        },
      });
      break;
    }

    // ---- Jouer une carte (guest → hôte) ----
    case "PLAY_CARD": {
      if (!game.isHost) return;
      hostHandlePlayCard(payload, fromPeerId);
      break;
    }

    // ---- Mise à jour après une carte jouée (hôte → tous) ----
    case "CARD_PLAYED": {
      if (game.isHost) return;
      const { playerId, card, publicState } = payload;
      game.publicState = publicState;

      // Retirer la carte de la main si c'est moi
      if (playerId === game.myId) {
        game.myHand = game.myHand.filter((c) => c.id !== card.id);
      }

      renderGameState();
      showToast(
        `${getPlayerName(playerId)} a joué ${getCardLabel(card.value)} ${card.color}`,
        "info",
        2000,
      );

      // Si la carte jouée est noire ET que c'est moi qui l'ai jouée → picker
      if (card.color === "black" && playerId === game.myId) {
        // On attend le SELECT_COLOR
      }
      break;
    }

    // ---- Demande de pioche (guest → hôte) ----
    case "REQUEST_DRAW": {
      if (!game.isHost) return;
      hostHandleDrawRequest(payload, fromPeerId);
      break;
    }

    // ---- Distribution de carte(s) (hôte → joueur concerné) ----
    case "PLAYER_DRAW": {
      const { playerId, drawnCards, newHandCount, deckRemaining } = payload;
      if (playerId === game.myId && drawnCards) {
        game.myHand.push(...drawnCards);
      }
      if (game.publicState) {
        const p = game.publicState.players.find((pl) => pl.id === playerId);
        if (p) p.handCount = newHandCount;
        game.publicState.deckRemaining = deckRemaining;
        game.publicState.lastActionId = payload.lastActionId;
      }
      renderGameState();
      showToast(`${getPlayerName(playerId)} a pioché`, "info", 1500);
      break;
    }

    // ---- Choix de couleur (guest → hôte) ----
    case "SELECT_COLOR": {
      if (!game.isHost) return;
      hostHandleSelectColor(payload);
      break;
    }

    // ---- Mise à jour couleur (hôte → tous) ----
    case "UPDATE_COLOR": {
      if (game.publicState) {
        game.publicState.activeColor = payload.activeColor;
        game.publicState.currentPlayerIndex = payload.newCurrentPlayer;
        game.publicState.lastActionId = payload.lastActionId;
      }
      renderGameState();
      showToast(`Couleur choisie : ${payload.activeColor}`, "info", 2000);
      break;
    }

    // ---- Annoncer UNO (guest → hôte) ----
    case "SHOUT_UNO": {
      if (!game.isHost) return;
      hostHandleUno(payload, fromPeerId);
      break;
    }

    // ---- UNO validé (hôte → tous) ----
    case "UNO_VALIDATED": {
      if (game.publicState) {
        const p = game.publicState.players.find(
          (pl) => pl.id === payload.playerId,
        );
        if (p) p.hasSaidUno = payload.hasSaidUno;
        game.publicState.lastActionId = payload.lastActionId;
      }
      renderGameState();
      if (payload.hasSaidUno) {
        showToast(`${getPlayerName(payload.playerId)} dit UNO !`, "uno", 3000);
      }
      break;
    }

    // ---- Tour suivant (après pioche forcée) ----
    case "NEXT_TURN": {
      if (game.publicState) {
        game.publicState.currentPlayerIndex = payload.currentPlayerIndex;
        game.publicState.pendingDrawCount = payload.pendingDrawCount;
        game.publicState.lastActionId = payload.lastActionId;
      }
      renderGameState();
      break;
    }

    // ---- Fin de partie ----
    case "GAME_OVER": {
      showGameOver(
        payload.winnerId,
        getPlayerName(payload.winnerId),
        payload.finalScores,
        game.publicState?.players || [],
      );
      break;
    }

    // ---- Joueur parti ----
    case "PLAYER_LEFT": {
      if (game.publicState) {
        const p = game.publicState.players.find(
          (pl) => pl.id === payload.playerId,
        );
        if (p) p.isConnected = false;
      }
      renderGameState();
      showToast(
        `${getPlayerName(payload.playerId)} a quitté la partie.`,
        "warning",
      );
      break;
    }

    // ---- Migration d'hôte ----
    case "HOST_MIGRATION": {
      if (payload.newHostId === game.myId) {
        game.isHost = true;
        peerManager.isHost = true;
        // Reconstruire l'état hôte depuis le dernier état public connu
        showToast("Vous êtes maintenant l'hôte !", "info");
      }
      break;
    }
  }
}

// ===== HÔTE : Traitement PLAY_CARD =====
function hostHandlePlayCard(payload, fromPeerId) {
  const { playerId, card, lastActionId } = payload;

  // Vérifier si c'est bien le tour du joueur
  const currentId = gameState.getCurrentPlayerId();
  if (playerId !== currentId) {
    peerManager.send(fromPeerId, {
      action: "ERROR",
      payload: { message: "Ce n'est pas votre tour." },
    });
    return;
  }

  const playedCard = gameState.playCard(playerId, card.id);
  if (!playedCard) {
    peerManager.send(fromPeerId, {
      action: "ERROR",
      payload: { message: "Carte invalide." },
    });
    return;
  }

  // Si carte noire : attendre le SELECT_COLOR avant d'avancer le tour
  if (playedCard.color === "black") {
    // Notifier tout le monde de la carte jouée
    broadcastCardPlayed(playerId, playedCard);
    // Le joueur concerné doit choisir une couleur
    if (playerId === game.myId) {
      // L'hôte est lui-même le joueur → afficher le picker
      showColorPicker((color) => {
        hostApplyColorChoice(playerId, color, playedCard);
      });
    }
    // Sinon attendre SELECT_COLOR du guest
  } else {
    // Appliquer les effets et avancer le tour
    gameState.applyCardEffect(playedCard);
    broadcastCardPlayed(playerId, playedCard);
    broadcastPublicState();
    checkGameOver();
  }
}

function broadcastCardPlayed(playerId, card) {
  const msg = {
    action: "CARD_PLAYED",
    payload: { playerId, card, publicState: gameState.getPublicState() },
  };
  peerManager.broadcast(msg);
  // Mise à jour hôte local
  if (game.publicState) game.publicState = gameState.getPublicState();
  if (playerId === game.myId) {
    game.myHand = gameState.getPlayerHand(game.myId);
  }
  renderGameState();
}

// ===== HÔTE : Traitement REQUEST_DRAW =====
function hostHandleDrawRequest(payload, fromPeerId) {
  const { playerId } = payload;

  // Vérifier si c'est son tour
  if (playerId !== gameState.getCurrentPlayerId()) {
    peerManager.send(fromPeerId, {
      action: "ERROR",
      payload: { message: "Ce n'est pas votre tour." },
    });
    return;
  }

  let count = 1;
  if (gameState.pendingDrawCount > 0) {
    count = gameState.pendingDrawCount;
    gameState.pendingDrawCount = 0;
  }

  const drawnCards = gameState.drawCards(playerId, count);
  gameState.lastActionId++;

  // Envoyer les cartes au joueur concerné
  const drawMsg = {
    action: "PLAYER_DRAW",
    payload: {
      playerId,
      drawnCards,
      newHandCount:
        gameState.players.find((p) => p.id === playerId)?.handCount || 0,
      deckRemaining: gameState.deck.length,
      lastActionId: gameState.lastActionId,
    },
  };

  if (playerId === game.myId) {
    // L'hôte pioche lui-même
    game.myHand.push(...drawnCards);
    if (game.publicState) {
      const p = game.publicState.players.find((pl) => pl.id === playerId);
      if (p) p.handCount = drawnCards.length + (p.handCount || 0);
    }
  } else {
    peerManager.send(fromPeerId, drawMsg);
  }

  // Diffuser l'info à tous (sans les cartes)
  peerManager.broadcast(
    {
      action: "PLAYER_DRAW",
      payload: {
        playerId,
        drawnCards: null,
        newHandCount:
          gameState.players.find((p) => p.id === playerId)?.handCount || 0,
        deckRemaining: gameState.deck.length,
        lastActionId: gameState.lastActionId,
      },
    },
    fromPeerId,
  );

  // Passer au tour suivant
  gameState.currentPlayerIndex = gameState.getNextPlayerIndex();
  gameState.lastActionId++;
  broadcastPublicState();
  renderGameState();
}

// ===== HÔTE : Traitement SELECT_COLOR =====
function hostHandleSelectColor(payload) {
  const { playerId, selectedColor } = payload;
  const topCard = gameState.discardPile[gameState.discardPile.length - 1];
  hostApplyColorChoice(playerId, selectedColor, topCard);
}

function hostApplyColorChoice(playerId, color, card) {
  gameState.applyCardEffect(card, color);
  gameState.activeColor = color;
  gameState.lastActionId++;

  const updateMsg = {
    action: "UPDATE_COLOR",
    payload: {
      activeColor: color,
      playedCardId: card.id,
      newCurrentPlayer: gameState.currentPlayerIndex,
      lastActionId: gameState.lastActionId,
    },
  };
  peerManager.broadcast(updateMsg);

  if (game.publicState) {
    game.publicState.activeColor = color;
    game.publicState.currentPlayerIndex = gameState.currentPlayerIndex;
    game.publicState.lastActionId = gameState.lastActionId;
  }

  broadcastPublicState();
  checkGameOver();
  renderGameState();
}

// ===== HÔTE : Traitement SHOUT_UNO =====
function hostHandleUno(payload, fromPeerId) {
  const { shouterId, targetId, type } = payload;
  const result = gameState.validateUno(shouterId, targetId, type);

  if (result.valid) {
    const unoMsg = {
      action: "UNO_VALIDATED",
      payload: {
        playerId: result.playerId,
        hasSaidUno: result.hasSaidUno || false,
        lastActionId: gameState.lastActionId,
      },
    };
    peerManager.broadcast(unoMsg);

    if (game.publicState) {
      const p = game.publicState.players.find(
        (pl) => pl.id === result.playerId,
      );
      if (p) p.hasSaidUno = result.hasSaidUno || false;
    }

    // Si pénalité (Contre-UNO)
    if (result.penalty) {
      const target = gameState.players.find((p) => p.id === result.playerId);
      if (target) {
        const drawnCards = gameState
          .getPlayerHand(target.id)
          .slice(-result.penalty);
        const targetConn = peerManager.connections[target.peerId];
        if (targetConn) {
          peerManager.send(target.peerId, {
            action: "PLAYER_DRAW",
            payload: {
              playerId: target.id,
              drawnCards,
              newHandCount: target.handCount,
              deckRemaining: gameState.deck.length,
              lastActionId: gameState.lastActionId,
            },
          });
        }
        showToast(`${target.name} prend 2 cartes (Contre-UNO) !`, "warning");
      }
    }

    renderGameState();
  }
}

// ===== BROADCAST ÉTAT PUBLIC =====
function broadcastPublicState() {
  const state = gameState.getPublicState();
  game.publicState = state;
  peerManager.broadcast({ action: "PUBLIC_STATE_UPDATE", payload: state });
}

// ===== VÉRIFIER FIN DE PARTIE =====
function checkGameOver() {
  const winner = gameState.checkWinner();
  if (winner) {
    gameState.gameStatus = "finished";
    const scores = gameState.calculateScores();
    const gameOverMsg = {
      action: "GAME_OVER",
      payload: {
        winnerId: winner.id,
        finalScores: scores,
        status: "finished",
        lastActionId: gameState.lastActionId,
        message: `Félicitations à ${winner.name} !`,
      },
    };
    peerManager.broadcast(gameOverMsg);
    showGameOver(winner.id, winner.name, scores, gameState.players);
  }
}

// ===== ACTIONS DU JOUEUR LOCAL =====

/** Jouer une carte */
function handleCardPlay(cardId) {
  const myId = game.myId;
  const currentId = getCurrentPlayerId();
  if (myId !== currentId) {
    showToast("Ce n'est pas votre tour !", "warning");
    return;
  }

  const card = game.myHand.find((c) => c.id === cardId);
  if (!card) return;

  // Si carte noire → demander la couleur d'abord
  if (card.color === "black") {
    game.pendingCardId = cardId;
    showColorPicker((color) => {
      game.pendingCardId = null;
      peerManager.sendAction({
        action: "PLAY_CARD",
        payload: {
          playerId: myId,
          card,
          lastActionId: game.publicState?.lastActionId || 0,
        },
      });
      // Envoyer SELECT_COLOR après
      setTimeout(() => {
        peerManager.sendAction({
          action: "SELECT_COLOR",
          payload: { playerId: myId, selectedColor: color },
        });
      }, 100);
    });
    return;
  }

  peerManager.sendAction({
    action: "PLAY_CARD",
    payload: {
      playerId: myId,
      card,
      lastActionId: game.publicState?.lastActionId || 0,
    },
  });

  // Mise à jour optimiste (guest uniquement, l'hôte le fait via handleGameMessage)
  if (!game.isHost) {
    game.myHand = game.myHand.filter((c) => c.id !== cardId);
    renderGameState();
  }
}

/** Piocher une carte */
function handleDrawCard() {
  const myId = game.myId;
  const currentId = getCurrentPlayerId();
  if (myId !== currentId) {
    showToast("Ce n'est pas votre tour !", "warning");
    return;
  }

  peerManager.sendAction({
    action: "REQUEST_DRAW",
    payload: { playerId: myId, reason: "no_playable_card" },
  });
}

/** Annoncer UNO */
function handleShoutUno() {
  const myId = game.myId;
  peerManager.sendAction({
    action: "SHOUT_UNO",
    payload: { shouterId: myId, targetId: myId, type: "UNO" },
  });
}

/** Contre-UNO sur un adversaire */
function handleCounterUno(targetId) {
  const myId = game.myId;
  peerManager.sendAction({
    action: "SHOUT_UNO",
    payload: { shouterId: myId, targetId, type: "COUNTER_UNO" },
  });
}

// ===== RENDU DU JEU =====
function renderGameState() {
  const state = game.publicState;
  if (!state) return;

  const currentPlayerId = getCurrentPlayerId();
  const isMyTurn = currentPlayerId === game.myId;
  const topCard = state.discardTop;
  const activeColor = state.activeColor;

  // Barre supérieure
  renderTopBar(state);

  // Carte du dessus
  renderDiscardTop(topCard, activeColor);

  // Compteur de deck
  renderDeckCount(state.deckRemaining || 0);

  // Adversaires
  renderOpponents(state.players, game.myId, currentPlayerId);

  // Ma main
  renderPlayerHand(game.myHand, activeColor, topCard, isMyTurn);

  // Bandeau de tour
  renderTurnBanner(isMyTurn);

  // Bouton piocher
  const drawBtn = document.getElementById("btn-draw");
  if (drawBtn) {
    drawBtn.disabled = !isMyTurn;
  }

  // Bouton UNO (visible si j'ai 1 seule carte)
  const unoBtn = document.getElementById("btn-uno");
  if (unoBtn) {
    if (game.myHand.length === 1 && isMyTurn) {
      unoBtn.classList.remove("hidden");
    } else {
      unoBtn.classList.add("hidden");
    }
  }

  // Pending draw indicator
  const pendingEl = document.getElementById("pending-draw");
  if (pendingEl) {
    if (state.pendingDrawCount > 0) {
      pendingEl.textContent = `+${state.pendingDrawCount} à piocher !`;
      pendingEl.classList.remove("hidden");
    } else {
      pendingEl.classList.add("hidden");
    }
  }
}

// ===== UTILS =====
function getCurrentPlayerId() {
  if (!game.publicState) return null;
  const { players, currentPlayerIndex } = game.publicState;
  const active = players.filter((p) => p.isConnected);
  return active[currentPlayerIndex % active.length]?.id || null;
}

function getPlayerName(playerId) {
  const p = (game.publicState?.players || game.players).find(
    (pl) => pl.id === playerId,
  );
  return p?.name || playerId;
}

function onPlayerDisconnected(peerId) {
  if (game.isHost) {
    const dp = gameState.players.find((p) => p.peerId === peerId);
    if (dp) {
      gameState.removePlayer(dp.id);
      const wasHost = dp.id === gameState.hostId;

      peerManager.broadcast({
        action: "PLAYER_LEFT",
        payload: {
          playerId: dp.id,
          reason: "disconnected",
          newHostId: null,
          lastActionId: gameState.lastActionId,
        },
      });

      if (game.publicState) {
        const p = game.publicState.players.find((pl) => pl.id === dp.id);
        if (p) p.isConnected = false;
      }
      renderGameState();
      showToast(`${dp.name} a quitté la partie.`, "warning");
    }
  }
}

// ===== BOUTONS DU JEU =====
function setupGameButtons() {
  const drawBtn = document.getElementById("btn-draw");
  const unoBtn = document.getElementById("btn-uno");
  const leaveBtn = document.getElementById("btn-leave");

  if (drawBtn) drawBtn.addEventListener("click", handleDrawCard);
  if (unoBtn) unoBtn.addEventListener("click", handleShoutUno);
  if (leaveBtn)
    leaveBtn.addEventListener("click", () => {
      if (confirm("Quitter la partie ?")) {
        peerManager.sendAction({
          action: "PLAYER_LEFT",
          payload: {
            playerId: game.myId,
            reason: "quit",
            newHostId: null,
            lastActionId: game.publicState?.lastActionId || 0,
          },
        });
        peerManager.destroy();
        window.location.href = "index.html";
      }
    });

  // Bouton rejouer (game over)
  const replayBtn = document.getElementById("btn-replay");
  if (replayBtn)
    replayBtn.addEventListener("click", () => {
      peerManager.destroy();
      window.location.href = "index.html";
    });
}
