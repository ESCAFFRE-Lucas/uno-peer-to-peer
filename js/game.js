/**
 * game.js — Moteur de jeu UNO P2P (Single Page App)
 * Appelé depuis lobby.js via startGameView() — les connexions PeerJS sont déjà établies.
 */

// ===== ÉTAT LOCAL DU JEU =====
const game = {
  myId: null,
  myName: null,
  myPeerId: null,
  isHost: false,
  players: [],
  myHand: [],
  publicState: null,
  pendingCardId: null,
  seed: null,
};

/**
 * Point d'entrée appelé par lobby.js quand la partie commence.
 * Les connexions PeerJS sont DÉJÀ établies — on ne les recrée pas.
 */
function startGameView(info) {
  game.myId = info.myId;
  game.myName = info.myName;
  game.myPeerId = info.myPeerId;
  game.isHost = info.isHost;
  game.seed = info.seed;
  game.players = info.players || [];
  game.myHand = [];
  game.publicState = null;

  // Basculer sur la vue de jeu
  document.getElementById("view-lobby")?.classList.add("hidden");
  document.getElementById("view-game")?.classList.remove("hidden");

  // Rebrancher le handler de messages sur le jeu
  peerManager.onMessage = handleGameMessage;
  peerManager.onDisconnect = onPlayerDisconnected;

  // Configurer les boutons de jeu
  setupGameButtons();

  if (game.isHost) {
    hostInitGame();
  }
  // Les guests attendent GAME_START de l'hôte (le message arrive via la connexion existante)
}

// ===== HÔTE : INITIALISER LE JEU =====
function hostInitGame() {
  // Écrire les joueurs dans le gameState (ils ont déjà été ajoutés dans le lobby)
  // S'assurer que les joueurs sont bien présents
  const activePlayers = gameState.players.filter((p) => p.isConnected);
  if (activePlayers.length === 0) {
    // Reconstruire depuis game.players si nécessaire
    game.players.forEach((p) => {
      if (!gameState.players.find((gp) => gp.id === p.id)) {
        gameState.addPlayer(p);
      }
    });
  }

  const firstCard = gameState.startGame(game.seed);
  game.myHand = gameState.getPlayerHand(game.myId);
  game.publicState = gameState.getPublicState();

  // Envoyer GAME_START à chaque guest avec sa main privée
  gameState.players
    .filter((p) => p.id !== game.myId && p.isConnected)
    .forEach((p) => {
      const hand = gameState.getPlayerHand(p.id);
      console.log(
        `[Host] Envoi GAME_START à ${p.name} (${p.peerId}) — ${hand.length} cartes`,
      );
      peerManager.send(p.peerId, {
        action: "GAME_START",
        payload: {
          gameId: gameState.gameId,
          players: gameState.getPublicState().players,
          firstCard,
          currentPlayerIndex: 0,
          direction: 1,
          activeColor: firstCard.color,
          deckRemaining: gameState.deck.length,
          lastActionId: 1,
          yourHand: hand,
        },
      });
    });

  renderGameState();
  showToast("La partie commence !", "success");
}

// ===== HANDLER MESSAGES DE JEU =====
function handleGameMessage(data, fromPeerId) {
  const { action, payload } = data;

  switch (action) {
    // ---- Réception de l'état initial (guest) ----
    case "GAME_START": {
      game.myHand = payload.yourHand || [];
      game.players = payload.players || game.players;
      game.publicState = {
        gameId: payload.gameId,
        gameStatus: "playing",
        players: payload.players,
        discardTop: payload.firstCard,
        currentPlayerIndex: payload.currentPlayerIndex,
        direction: payload.direction || 1,
        activeColor: payload.activeColor || payload.firstCard?.color,
        pendingDrawCount: 0,
        deckRemaining: payload.deckRemaining || 0,
        lastActionId: payload.lastActionId,
      };
      renderGameState();
      showToast("La partie commence !", "success");
      break;
    }

    // ---- Jouer une carte (guest → hôte) ----
    case "PLAY_CARD": {
      if (!game.isHost) return;
      hostHandlePlayCard(payload, fromPeerId);
      break;
    }

    // ---- Carte jouée confirmée (hôte → tous) ----
    case "CARD_PLAYED": {
      if (game.isHost) return;
      const { playerId, card, publicState } = payload;
      game.publicState = publicState;
      if (playerId === game.myId) {
        game.myHand = game.myHand.filter((c) => c.id !== card.id);
      }
      renderGameState();
      showToast(
        `${getPlayerName(playerId)} joue ${getCardLabel(card.value)}`,
        "info",
        2000,
      );
      break;
    }

    // ---- Demande de pioche (guest → hôte) ----
    case "REQUEST_DRAW": {
      if (!game.isHost) return;
      hostHandleDrawRequest(payload, fromPeerId);
      break;
    }

    // ---- Cartes piochées (hôte → joueur concerné) ----
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
      if (playerId !== game.myId)
        showToast(`${getPlayerName(playerId)} a pioché`, "info", 1500);
      break;
    }

    // ---- Choix de couleur (guest → hôte) ----
    case "SELECT_COLOR": {
      if (!game.isHost) return;
      hostHandleSelectColor(payload);
      break;
    }

    // ---- Couleur mise à jour (hôte → tous) ----
    case "UPDATE_COLOR": {
      if (game.publicState) {
        game.publicState.activeColor = payload.activeColor;
        game.publicState.currentPlayerIndex = payload.newCurrentPlayer;
        game.publicState.pendingDrawCount = payload.pendingDrawCount || 0;
        game.publicState.lastActionId = payload.lastActionId;
      }
      renderGameState();
      showToast(`Couleur active : ${payload.activeColor}`, "info", 2000);
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
      if (payload.hasSaidUno)
        showToast(`${getPlayerName(payload.playerId)} dit UNO !`, "uno", 3000);
      break;
    }

    // ---- État public mis à jour (hôte → tous) ----
    case "PUBLIC_STATE_UPDATE": {
      if (game.isHost) return;
      game.publicState = payload;
      renderGameState();
      break;
    }

    // ---- Fin de partie ----
    case "GAME_OVER": {
      handleGameOver(
        payload.winnerId,
        getPlayerName(payload.winnerId),
        payload.finalScores,
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
      showToast(`${getPlayerName(payload.playerId)} a quitté.`, "warning");
      break;
    }

    // ---- Migration hôte ----
    case "HOST_MIGRATION": {
      if (payload.newHostId === game.myId) {
        game.isHost = true;
        peerManager.isHost = true;
        showToast("Vous êtes maintenant l'hôte !", "info");
      }
      break;
    }
  }
}

// ===== HÔTE : Traitement PLAY_CARD =====
function hostHandlePlayCard(payload, fromPeerId) {
  const { playerId, card } = payload;

  if (playerId !== gameState.getCurrentPlayerId()) {
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

  // Diffuser la carte jouée
  const cardPlayedMsg = {
    action: "CARD_PLAYED",
    payload: {
      playerId,
      card: playedCard,
      publicState: gameState.getPublicState(),
    },
  };
  peerManager.broadcast(cardPlayedMsg);

  // Mise à jour hôte local
  game.publicState = gameState.getPublicState();
  if (playerId === game.myId) game.myHand = gameState.getPlayerHand(game.myId);
  renderGameState();

  if (playedCard.color === "black") {
    // Attendre le SELECT_COLOR
    if (playerId === game.myId) {
      showColorPicker((color) =>
        hostApplyColorChoice(playerId, color, playedCard),
      );
    }
  } else {
    gameState.applyCardEffect(playedCard);
    hostBroadcastPublicState();
    hostCheckGameOver();
  }
}

// ===== HÔTE : Traitement REQUEST_DRAW =====
function hostHandleDrawRequest(payload, fromPeerId) {
  const { playerId } = payload;

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
  const updatedPlayer = gameState.players.find((p) => p.id === playerId);
  const newHandCount = updatedPlayer?.handCount || 0;

  // Envoyer les cartes privées au joueur concerné
  const drawPayload = {
    playerId,
    drawnCards,
    newHandCount,
    deckRemaining: gameState.deck.length,
    lastActionId: gameState.lastActionId,
  };

  if (playerId === game.myId) {
    // Hôte pioche lui-même
    game.myHand.push(...drawnCards);
    if (game.publicState) {
      const p = game.publicState.players.find((pl) => pl.id === playerId);
      if (p) p.handCount = newHandCount;
      game.publicState.deckRemaining = gameState.deck.length;
    }
  } else {
    // Envoyer les cartes au guest concerné
    peerManager.send(fromPeerId, {
      action: "PLAYER_DRAW",
      payload: drawPayload,
    });
  }

  // Diffuser l'info publique (nombre de cartes, mais PAS les cartes elles-mêmes)
  peerManager.broadcast(
    {
      action: "PLAYER_DRAW",
      payload: {
        playerId,
        drawnCards: null,
        newHandCount,
        deckRemaining: gameState.deck.length,
        lastActionId: gameState.lastActionId,
      },
    },
    fromPeerId,
  );

  // Passer au joueur suivant
  gameState.currentPlayerIndex = gameState.getNextPlayerIndex();
  gameState.lastActionId++;

  hostBroadcastPublicState();
  renderGameState();
}

// ===== HÔTE : Traitement SELECT_COLOR =====
function hostHandleSelectColor(payload) {
  const topCard = gameState.discardPile[gameState.discardPile.length - 1];
  hostApplyColorChoice(payload.playerId, payload.selectedColor, topCard);
}

function hostApplyColorChoice(playerId, color, card) {
  gameState.applyCardEffect(card, color);
  gameState.lastActionId++;

  peerManager.broadcast({
    action: "UPDATE_COLOR",
    payload: {
      activeColor: color,
      playedCardId: card.id,
      newCurrentPlayer: gameState.currentPlayerIndex,
      pendingDrawCount: gameState.pendingDrawCount,
      lastActionId: gameState.lastActionId,
    },
  });

  if (game.publicState) {
    game.publicState.activeColor = color;
    game.publicState.currentPlayerIndex = gameState.currentPlayerIndex;
    game.publicState.pendingDrawCount = gameState.pendingDrawCount;
    game.publicState.lastActionId = gameState.lastActionId;
  }

  hostBroadcastPublicState();
  hostCheckGameOver();
  renderGameState();
}

// ===== HÔTE : Traitement SHOUT_UNO =====
function hostHandleUno(payload, fromPeerId) {
  const { shouterId, targetId, type } = payload;
  const result = gameState.validateUno(shouterId, targetId, type);

  if (result.valid) {
    peerManager.broadcast({
      action: "UNO_VALIDATED",
      payload: {
        playerId: result.playerId,
        hasSaidUno: result.hasSaidUno || false,
        lastActionId: gameState.lastActionId,
      },
    });

    if (game.publicState) {
      const p = game.publicState.players.find(
        (pl) => pl.id === result.playerId,
      );
      if (p) p.hasSaidUno = result.hasSaidUno || false;
    }

    if (result.penalty) {
      const target = gameState.players.find((p) => p.id === result.playerId);
      if (target && target.id !== game.myId) {
        const penaltyCards = gameState
          .getPlayerHand(target.id)
          .slice(-result.penalty);
        peerManager.send(target.peerId, {
          action: "PLAYER_DRAW",
          payload: {
            playerId: target.id,
            drawnCards: penaltyCards,
            newHandCount: target.handCount,
            deckRemaining: gameState.deck.length,
            lastActionId: gameState.lastActionId,
          },
        });
      }
      showToast(
        `${getPlayerName(result.playerId)} prend 2 cartes (Contre-UNO) !`,
        "warning",
      );
    }
    renderGameState();
  }
}

// ===== HÔTE : Diffuser l'état public =====
function hostBroadcastPublicState() {
  const state = gameState.getPublicState();
  game.publicState = state;
  peerManager.broadcast({ action: "PUBLIC_STATE_UPDATE", payload: state });
}

// ===== HÔTE : Vérifier fin de partie =====
function hostCheckGameOver() {
  const winner = gameState.checkWinner();
  if (!winner) return;

  gameState.gameStatus = "finished";
  const scores = gameState.calculateScores();
  peerManager.broadcast({
    action: "GAME_OVER",
    payload: {
      winnerId: winner.id,
      finalScores: scores,
      status: "finished",
      lastActionId: gameState.lastActionId,
    },
  });
  handleGameOver(winner.id, winner.name, scores);
}

// ===== ACTIONS JOUEUR LOCAL =====

function handleCardPlay(cardId) {
  if (game.myId !== getCurrentPlayerId()) {
    showToast("Ce n'est pas votre tour !", "warning");
    return;
  }

  const card = game.myHand.find((c) => c.id === cardId);
  if (!card) return;

  if (card.color === "black") {
    showColorPicker((color) => {
      peerManager.sendAction({
        action: "PLAY_CARD",
        payload: {
          playerId: game.myId,
          card,
          lastActionId: game.publicState?.lastActionId || 0,
        },
      });
      setTimeout(() => {
        peerManager.sendAction({
          action: "SELECT_COLOR",
          payload: { playerId: game.myId, selectedColor: color },
        });
      }, 50);
    });
    return;
  }

  peerManager.sendAction({
    action: "PLAY_CARD",
    payload: {
      playerId: game.myId,
      card,
      lastActionId: game.publicState?.lastActionId || 0,
    },
  });
}

function handleDrawCard() {
  if (game.myId !== getCurrentPlayerId()) {
    showToast("Ce n'est pas votre tour !", "warning");
    return;
  }
  peerManager.sendAction({
    action: "REQUEST_DRAW",
    payload: { playerId: game.myId, reason: "no_playable_card" },
  });
}

function handleShoutUno() {
  peerManager.sendAction({
    action: "SHOUT_UNO",
    payload: { shouterId: game.myId, targetId: game.myId, type: "UNO" },
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

  renderTopBar(state);
  renderDiscardTop(topCard, activeColor);
  renderDeckCount(state.deckRemaining || 0);
  renderOpponents(state.players, game.myId, currentPlayerId);
  renderPlayerHand(game.myHand, activeColor, topCard, isMyTurn);
  renderTurnBanner(isMyTurn);

  const drawBtn = document.getElementById("btn-draw");
  if (drawBtn) drawBtn.disabled = !isMyTurn;

  const unoBtn = document.getElementById("btn-uno");
  if (unoBtn) {
    if (game.myHand.length === 1 && isMyTurn) unoBtn.classList.remove("hidden");
    else unoBtn.classList.add("hidden");
  }

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

// ===== FIN DE PARTIE =====
function handleGameOver(winnerId, winnerName, scores) {
  const overlay = document.getElementById("gameover-overlay");
  const winnerEl = document.getElementById("winner-name");
  const scoresList = document.getElementById("scores-list");

  if (winnerEl) winnerEl.textContent = winnerName || "?";
  if (scoresList) {
    const players = game.publicState?.players || game.players;
    scoresList.innerHTML = players
      .map(
        (p) => `
      <li class="score-item">
        <span>${escapeHtml(p.name)} ${p.id === winnerId ? "👑" : ""}</span>
        <span>${(scores && scores[p.id]) || 0} pts</span>
      </li>
    `,
      )
      .join("");
  }
  if (overlay) overlay.classList.remove("hidden");
}

// ===== UTILS =====
function getCurrentPlayerId() {
  if (!game.publicState) return null;
  const { players, currentPlayerIndex } = game.publicState;
  const active = (players || []).filter((p) => p.isConnected);
  if (active.length === 0) return null;
  return active[currentPlayerIndex % active.length]?.id || null;
}

function getPlayerName(playerId) {
  const p = (game.publicState?.players || game.players).find(
    (pl) => pl.id === playerId,
  );
  return p?.name || playerId;
}

function onPlayerDisconnected(peerId) {
  if (!game.isHost) return;
  const dp = gameState.players.find((p) => p.peerId === peerId);
  if (!dp) return;

  gameState.removePlayer(dp.id);
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

// ===== BOUTONS DU JEU =====
function setupGameButtons() {
  document
    .getElementById("btn-draw")
    ?.addEventListener("click", handleDrawCard);
  document.getElementById("btn-uno")?.addEventListener("click", handleShoutUno);
  document
    .getElementById("deck-draw-area")
    ?.addEventListener("click", handleDrawCard);

  document.getElementById("btn-leave")?.addEventListener("click", () => {
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
      window.location.reload();
    }
  });

  document.getElementById("btn-replay")?.addEventListener("click", () => {
    peerManager.destroy();
    window.location.reload();
  });
}
