/**
 * lobby.js — Logique du lobby UNO P2P (Single Page App)
 * Pas de redirection — on affiche/masque les vues directement.
 */

// ===== ÉTAT LOCAL DU LOBBY =====
const lobby = {
  myId: null,
  myName: null,
  myPeerId: null,
  isHost: false,
  hostPeerId: null,
  roomCode: null,
  players: [],
};

// ===== INITIALISATION =====
document.addEventListener("DOMContentLoaded", () => {
  setupLobbyUI();
});

function setupLobbyUI() {
  document
    .getElementById("btn-create")
    ?.addEventListener("click", onCreateLobby);
  document.getElementById("btn-join")?.addEventListener("click", onJoinLobby);
  document
    .getElementById("btn-ready")
    ?.addEventListener("click", onToggleReady);
  document.getElementById("btn-start")?.addEventListener("click", onStartGame);
  document
    .getElementById("btn-quit-lobby")
    ?.addEventListener("click", () => window.location.reload());

  document.getElementById("btn-copy-room")?.addEventListener("click", () => {
    navigator.clipboard.writeText(lobby.roomCode || "");
    const btn = document.getElementById("btn-copy-room");
    btn.textContent = "Copié !";
    setTimeout(() => (btn.textContent = "Copier"), 1500);
  });
}

// ===== CRÉER UNE PARTIE (Hôte) =====
async function onCreateLobby() {
  const name = document.getElementById("host-name")?.value?.trim();
  if (!name) return showToast("Entrez votre pseudo !", "error");

  setLoadingState(true);
  try {
    lobby.myName = name;
    lobby.isHost = true;
    peerManager.isHost = true;

    const peerId = await peerManager.initPeer(name);
    lobby.myPeerId = peerId;
    lobby.myId = "p1";
    lobby.roomCode = peerId;

    gameState.initRoom(`uno-${peerId.slice(-6)}`, { id: "p1", peerId, name });
    lobby.players = [...gameState.players];

    peerManager.listenAsHost();
    peerManager.onMessage = handleLobbyMessage;
    peerManager.onConnect = onPeerConnected;
    peerManager.onDisconnect = onPeerDisconnected;

    showRoomPanel(peerId);
    updateLobbyUI();
    setLoadingState(false);
  } catch (err) {
    setLoadingState(false);
    showToast("Impossible de créer la partie : " + err.message, "error");
  }
}

// ===== REJOINDRE UNE PARTIE (Guest) =====
async function onJoinLobby() {
  const name = document.getElementById("guest-name")?.value?.trim();
  const code = document.getElementById("room-code")?.value?.trim();
  if (!name) return showToast("Entrez votre pseudo !", "error");
  if (!code) return showToast("Entrez le code de la partie !", "error");

  setLoadingState(true);
  try {
    lobby.myName = name;
    lobby.isHost = false;
    lobby.hostPeerId = code;

    const peerId = await peerManager.initPeer(name);
    lobby.myPeerId = peerId;
    lobby.roomCode = code;

    peerManager.onMessage = handleLobbyMessage;
    peerManager.onDisconnect = onPeerDisconnected;

    await peerManager.connectToHost(code);

    peerManager.sendToHost({
      action: "JOIN_GAME",
      payload: { peerId, name, isReady: false },
    });

    showRoomPanel(code);
    setLoadingState(false);
  } catch (err) {
    setLoadingState(false);
    showToast("Impossible de rejoindre : " + err.message, "error");
  }
}

// ===== TOGGLE PRÊT (Guest) =====
function onToggleReady() {
  if (lobby.isHost) return;
  const me = lobby.players.find((p) => p.id === lobby.myId);
  const newReady = !(me?.isReady || false);

  peerManager.sendAction({
    action: "PLAYER_READY_CHANGE",
    payload: { playerId: lobby.myId, isReady: newReady },
  });

  if (me) me.isReady = newReady;
  updateLobbyUI();
}

// ===== LANCER LA PARTIE (Hôte) =====
function onStartGame() {
  if (!lobby.isHost) return;

  const validation = gameState.getLobbyValidation();
  if (!validation.canStart) {
    showToast(validation.validationMessage, "warning");
    return;
  }

  peerManager.broadcast({
    action: "LOBBY_VALIDATION",
    payload: {
      canStart: true,
      validationMessage: "Tous les joueurs sont prêts. Lancement imminent !",
    },
  });

  const seed = generateSeed();
  peerManager.broadcast({
    action: "START_GAME_SIGNAL",
    payload: {
      gameStatus: "playing",
      seed,
      initialTurnIndex: 0,
      lastActionId: 1,
    },
  });

  handleStartGame(seed);
}

// ===== HANDLER MESSAGES LOBBY =====
function handleLobbyMessage(data, fromPeerId) {
  const { action, payload } = data;

  switch (action) {
    case "JOIN_GAME": {
      if (!lobby.isHost) return;
      const newId = `p${gameState.players.length + 1}`;
      const newPlayer = {
        id: newId,
        peerId: fromPeerId,
        name: payload.name,
        isReady: false,
        isConnected: true,
      };

      const added = gameState.addPlayer(newPlayer);
      if (!added) {
        peerManager.send(fromPeerId, {
          action: "ERROR",
          payload: { message: "Salle pleine" },
        });
        return;
      }

      lobby.players = gameState.players.slice();
      peerManager.send(fromPeerId, {
        action: "ROOM_CREATED",
        payload: { ...gameState.getRoomState(), yourPlayerId: newId },
      });
      peerManager.broadcast(
        { action: "PLAYER_JOINED", payload: { player: newPlayer } },
        fromPeerId,
      );

      updateLobbyUI();
      updateStartButton();
      showToast(`${payload.name} a rejoint la partie !`, "success");
      break;
    }

    case "ROOM_CREATED":
      lobby.myId = payload.yourPlayerId;
      lobby.players = payload.players || [];
      showRoomPanel(lobby.roomCode);
      updateLobbyUI();
      break;

    case "PLAYER_JOINED":
      if (!lobby.players.find((p) => p.id === payload.player.id)) {
        lobby.players.push(payload.player);
      }
      updateLobbyUI();
      showToast(`${payload.player.name} a rejoint la partie !`, "success");
      break;

    case "PLAYER_READY_CHANGE":
      if (lobby.isHost) {
        gameState.setPlayerReady(payload.playerId, payload.isReady);
        lobby.players = gameState.players.slice();
        peerManager.broadcast(
          { action: "PLAYER_READY_CHANGE", payload },
          fromPeerId,
        );
        updateStartButton();
      } else {
        const p = lobby.players.find((pl) => pl.id === payload.playerId);
        if (p) p.isReady = payload.isReady;
      }
      updateLobbyUI();
      break;

    case "START_GAME_SIGNAL":
      handleStartGame(payload.seed);
      break;

    case "PLAYER_LEFT": {
      const p = lobby.players.find((pl) => pl.id === payload.playerId);
      if (p) p.isConnected = false;
      updateLobbyUI();
      showToast(`${p?.name || "Un joueur"} a quitté la partie.`, "warning");
      break;
    }

    case "ERROR":
      showToast(payload.message, "error");
      break;
  }
}

function handleStartGame(seed) {
  // Passer le relais au module game.js avec les infos actuelles
  startGameView({
    myId: lobby.myId,
    myName: lobby.myName,
    myPeerId: lobby.myPeerId,
    isHost: lobby.isHost,
    seed: seed,
    players: lobby.players.slice(),
  });
}

function onPeerConnected(peerId) {
  console.log("[Lobby] Peer connecté:", peerId);
}

function onPeerDisconnected(peerId) {
  if (!lobby.isHost) return;
  const dp = gameState.players.find((p) => p.peerId === peerId);
  if (dp) {
    gameState.removePlayer(dp.id);
    lobby.players = gameState.players.slice();
    peerManager.broadcast({
      action: "PLAYER_LEFT",
      payload: { playerId: dp.id },
    });
    updateLobbyUI();
    updateStartButton();
  }
}

function showRoomPanel(roomCode) {
  lobby.roomCode = roomCode;
  document.getElementById("landing-section")?.classList.add("hidden");
  document.getElementById("room-section")?.classList.remove("hidden");

  const startBtn = document.getElementById("btn-start");
  const readyBtn = document.getElementById("btn-ready");
  if (lobby.isHost) {
    startBtn?.classList.remove("hidden");
    readyBtn?.classList.add("hidden");
    const el = document.getElementById("room-code-value");
    if (el) el.textContent = roomCode;
    document.getElementById("room-code-display")?.classList.remove("hidden");
  } else {
    startBtn?.classList.add("hidden");
    readyBtn?.classList.remove("hidden");
  }
}

function updateLobbyUI() {
  renderLobbyPlayers(lobby.players, lobby.myId);
  const count = lobby.players.filter((p) => p.isConnected).length;
  const statusEl = document.getElementById("lobby-status");
  if (statusEl) statusEl.textContent = `${count} / 4 joueur(s) connecté(s)`;

  if (!lobby.isHost) {
    const me = lobby.players.find((p) => p.id === lobby.myId);
    const readyBtn = document.getElementById("btn-ready");
    if (readyBtn && me) {
      readyBtn.textContent = me.isReady ? "✓ Prêt" : "Je suis prêt";
      readyBtn.className = me.isReady
        ? "btn btn-success btn-full"
        : "btn btn-secondary btn-full";
    }
  }
}

function updateStartButton() {
  if (!lobby.isHost) return;
  const btn = document.getElementById("btn-start");
  if (!btn) return;
  const val = gameState.getLobbyValidation();
  btn.disabled = !val.canStart;
}

function setLoadingState(loading) {
  const c = document.getElementById("btn-create");
  const j = document.getElementById("btn-join");
  if (c) c.disabled = loading;
  if (j) j.disabled = loading;
}
