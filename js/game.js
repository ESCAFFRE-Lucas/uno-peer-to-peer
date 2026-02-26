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
  seed: null,
};

function startGameView(info) {
  game.myId = info.myId;
  game.myName = info.myName;
  game.myPeerId = info.myPeerId;
  game.isHost = info.isHost;
  game.seed = info.seed;
  game.players = info.players || [];
  game.myHand = [];
  game.publicState = null;

  document.getElementById("view-lobby")?.classList.add("hidden");
  document.getElementById("view-game")?.classList.remove("hidden");

  peerManager.onMessage = handleGameMessage;
  peerManager.onDisconnect = onPlayerDisconnected;

  setupGameButtons();

  if (game.isHost) {
    hostInitGame();
  }
}

// ===== HÔTE : INITIALISER LE JEU =====
function hostInitGame() {
  const activePlayers = gameState.players.filter((p) => p.isConnected);
  if (activePlayers.length === 0) {
    game.players.forEach((p) => {
      if (!gameState.players.find((gp) => gp.id === p.id)) {
        gameState.addPlayer(p);
      }
    });
  }

  const firstCard = gameState.startGame(game.seed);
  game.myHand = gameState.getPlayerHand(game.myId);
  game.publicState = gameState.getPublicState();

  gameState.players
    .filter((p) => p.id !== game.myId && p.isConnected)
    .forEach((p) => {
      const hand = gameState.getPlayerHand(p.id);
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
    case "GAME_START":
      game.myHand = payload.yourHand || [];
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

    case "PLAY_CARD":
      if (!game.isHost) return;
      hostHandlePlayCard(payload, fromPeerId);
      break;

    case "CARD_PLAYED":
      if (game.isHost) return;
      game.publicState = payload.publicState;
      if (payload.playerId === game.myId) {
        game.myHand = game.myHand.filter((c) => c.id !== payload.card.id);
      }
      renderGameState();
      showToast(
        `${getPlayerName(payload.playerId)} joue ${getCardLabel(payload.card.value)}`,
        "info",
        2000,
      );
      break;

    case "REQUEST_DRAW":
      if (!game.isHost) return;
      hostHandleDrawRequest(payload, fromPeerId);
      break;

    case "PLAYER_DRAW":
      const {
        playerId,
        drawnCards,
        newHandCount,
        deckRemaining,
        nextPlayerId,
      } = payload;
      if (playerId === game.myId && drawnCards) {
        game.myHand.push(...drawnCards);
      }
      if (game.publicState) {
        const p = game.publicState.players.find((pl) => pl.id === playerId);
        if (p) p.handCount = newHandCount;
        game.publicState.deckRemaining = deckRemaining;
        // On met aussi à jour le joueur actuel pour éviter les désynchronisations visuelles
        if (nextPlayerId) {
          const nextIdx = game.publicState.players.findIndex(
            (pl) => pl.id === nextPlayerId,
          );
          if (nextIdx !== -1) game.publicState.currentPlayerIndex = nextIdx;
        }
      }
      renderGameState();
      if (playerId !== game.myId)
        showToast(`${getPlayerName(playerId)} a pioché`, "info", 1500);
      break;

    case "SELECT_COLOR":
      if (!game.isHost) return;
      hostHandleSelectColor(payload);
      break;

    case "UPDATE_COLOR":
      if (game.publicState) {
        game.publicState.activeColor = payload.activeColor;
        game.publicState.currentPlayerIndex = payload.newCurrentPlayer;
        game.publicState.pendingDrawCount = payload.pendingDrawCount || 0;
      }
      renderGameState();
      showToast(`Couleur active : ${payload.activeColor}`, "info", 2000);
      break;

    case "SHOUT_UNO":
      if (!game.isHost) return;
      hostHandleUno(payload, fromPeerId);
      break;

    case "UNO_VALIDATED":
      if (game.publicState) {
        const p = game.publicState.players.find(
          (pl) => pl.id === payload.playerId,
        );
        if (p) p.hasSaidUno = payload.hasSaidUno;
      }
      renderGameState();
      if (payload.hasSaidUno)
        showToast(`${getPlayerName(payload.playerId)} dit UNO !`, "uno", 3000);
      break;

    case "PUBLIC_STATE_UPDATE":
      if (game.isHost) return;
      game.publicState = payload;
      renderGameState();
      break;

    case "GAME_OVER":
      handleGameOver(
        payload.winnerId,
        getPlayerName(payload.winnerId),
        payload.finalScores,
      );
      break;

    case "PLAYER_LEFT":
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
}

// ===== LOGIQUE HÔTE =====
function hostHandlePlayCard(payload, fromPeerId) {
  const { playerId, card } = payload;
  if (playerId !== gameState.getCurrentPlayerId()) return;

  const playedCard = gameState.playCard(playerId, card.id);
  if (!playedCard) return;

  // Si ce n'est pas une carte noire, on applique l'effet (et change de tour) immédiatement
  if (playedCard.color !== "black") {
    gameState.applyCardEffect(playedCard);
  }

  // On broadcast l'état MIS À JOUR (incluant le nouveau tour)
  const publicState = gameState.getPublicState();
  peerManager.broadcast({
    action: "CARD_PLAYED",
    payload: {
      playerId,
      card: playedCard,
      publicState: publicState,
    },
  });

  game.publicState = publicState;
  if (playerId === game.myId) game.myHand = gameState.getPlayerHand(game.myId);

  renderGameState();
  hostCheckGameOver();
}

function hostHandleDrawRequest(payload, fromPeerId) {
  const { playerId } = payload;
  if (playerId !== gameState.getCurrentPlayerId()) return;

  const count = gameState.pendingDrawCount > 0 ? gameState.pendingDrawCount : 1;
  const drawnCards = gameState.drawCards(playerId, count);
  const newHandCount =
    gameState.players.find((p) => p.id === playerId)?.handCount || 0;

  // Appliquer le tour suivant et remettre le cumul à 0
  gameState.pendingDrawCount = 0;
  gameState.nextTurn();
  const nextPlayerId = gameState.getCurrentPlayerId();

  if (playerId === game.myId) {
    game.myHand.push(...drawnCards);
  } else {
    peerManager.send(fromPeerId, {
      action: "PLAYER_DRAW",
      payload: {
        playerId,
        drawnCards,
        newHandCount,
        deckRemaining: gameState.deck.length,
        nextPlayerId,
      },
    });
  }

  peerManager.broadcast(
    {
      action: "PLAYER_DRAW",
      payload: {
        playerId,
        drawnCards: null,
        newHandCount,
        deckRemaining: gameState.deck.length,
        nextPlayerId,
      },
    },
    fromPeerId,
  );

  hostBroadcastPublicState();
  renderGameState();
}

function hostHandleSelectColor(payload) {
  const topCard = gameState.discardPile[gameState.discardPile.length - 1];
  gameState.applyCardEffect(topCard, payload.selectedColor);

  peerManager.broadcast({
    action: "UPDATE_COLOR",
    payload: {
      activeColor: payload.selectedColor,
      newCurrentPlayer: gameState.currentPlayerIndex,
      pendingDrawCount: gameState.pendingDrawCount,
    },
  });

  hostBroadcastPublicState();
  hostCheckGameOver();
  renderGameState();
}

function hostHandleUno(payload, fromPeerId) {
  const { shouterId, targetId, type } = payload;
  const result = gameState.validateUno(shouterId, targetId, type);

  if (result.valid) {
    peerManager.broadcast({
      action: "UNO_VALIDATED",
      payload: {
        playerId: result.playerId,
        hasSaidUno: result.hasSaidUno || false,
      },
    });

    if (result.penalty) {
      const target = gameState.players.find((p) => p.id === result.playerId);
      if (target && target.id !== game.myId) {
        const penaltyCards = target.hand.slice(-2);
        peerManager.send(target.peerId, {
          action: "PLAYER_DRAW",
          payload: {
            playerId: target.id,
            drawnCards: penaltyCards,
            newHandCount: target.handCount,
            deckRemaining: gameState.deck.length,
          },
        });
      }
    }
    renderGameState();
  }
}

function hostBroadcastPublicState() {
  const state = gameState.getPublicState();
  game.publicState = state;
  renderGameState(); // S'assurer que l'hôte rend après chaque broadcast
  peerManager.broadcast({ action: "PUBLIC_STATE_UPDATE", payload: state });
}

function hostCheckGameOver() {
  const winner = gameState.checkWinner();
  if (!winner) return;

  const scores = gameState.calculateScores();
  peerManager.broadcast({
    action: "GAME_OVER",
    payload: { winnerId: winner.id, finalScores: scores },
  });
  handleGameOver(winner.id, winner.name, scores);
}

// ===== ACTIONS DU JOUEUR LOCAL =====
function handleCardPlay(cardId) {
  if (game.myId !== getCurrentPlayerId())
    return showToast("Ce n'est pas votre tour !", "warning");

  const card = game.myHand.find((c) => c.id === cardId);
  if (!card) return;

  if (card.color === "black") {
    showColorPicker((color) => {
      peerManager.sendAction({
        action: "PLAY_CARD",
        payload: { playerId: game.myId, card },
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
    payload: { playerId: game.myId, card },
  });
}

function handleDrawCard() {
  if (game.myId !== getCurrentPlayerId())
    return showToast("Ce n'est pas votre tour !", "warning");
  peerManager.sendAction({
    action: "REQUEST_DRAW",
    payload: { playerId: game.myId },
  });
}

function handleShoutUno() {
  peerManager.sendAction({
    action: "SHOUT_UNO",
    payload: { shouterId: game.myId, targetId: game.myId, type: "UNO" },
  });
}

// ===== RENDU =====
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
      pendingEl.textContent = `+${state.pendingDrawCount} !`;
      pendingEl.classList.remove("hidden");
    } else {
      pendingEl.classList.add("hidden");
    }
  }
}

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
  if (dp) {
    gameState.removePlayer(dp.id);
    peerManager.broadcast({
      action: "PLAYER_LEFT",
      payload: { playerId: dp.id },
    });
    renderGameState();
  }
}

function setupGameButtons() {
  const btnDraw = document.getElementById("btn-draw");
  if (btnDraw) btnDraw.onclick = handleDrawCard;

  const btnUno = document.getElementById("btn-uno");
  if (btnUno) btnUno.onclick = handleShoutUno;

  const deckArea = document.getElementById("deck-draw-area");
  if (deckArea) deckArea.onclick = handleDrawCard;

  const btnLeave = document.getElementById("btn-leave");
  if (btnLeave) {
    btnLeave.onclick = () => {
      if (confirm("Quitter ?")) {
        peerManager.destroy();
        window.location.reload();
      }
    };
  }
  const btnReplay = document.getElementById("btn-replay");
  if (btnReplay) btnReplay.onclick = () => window.location.reload();
}
