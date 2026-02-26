/**
 * lobby.js — Logique du lobby UNO P2P
 * Gère la création/rejoindre une salle, les joueurs, et le lancement
 */

// ===== ÉTAT LOCAL DU LOBBY =====
const lobby = {
  myId: null, // ID du joueur local (ex: "p1", "p2")
  myName: null, // Pseudo du joueur local
  myPeerId: null, // PeerID WebRTC local
  isHost: false,
  hostPeerId: null,
  roomCode: null, // PeerID de l'hôte = code de la room
  players: [], // Copie locale de la liste des joueurs
};

// ===== INITIALISATION =====
document.addEventListener("DOMContentLoaded", () => {
  setupLobbyUI();
});

function setupLobbyUI() {
  const createBtn = document.getElementById("btn-create");
  const joinBtn = document.getElementById("btn-join");
  const readyBtn = document.getElementById("btn-ready");
  const startBtn = document.getElementById("btn-start");

  if (createBtn) createBtn.addEventListener("click", onCreateLobby);
  if (joinBtn) joinBtn.addEventListener("click", onJoinLobby);
  if (readyBtn) readyBtn.addEventListener("click", onToggleReady);
  if (startBtn) startBtn.addEventListener("click", onStartGame);

  // Copier le code de la room
  const copyBtn = document.getElementById("btn-copy-room");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(lobby.roomCode || "");
      copyBtn.textContent = "Copié !";
      setTimeout(() => (copyBtn.textContent = "Copier"), 1500);
    });
  }
}

// ===== CRÉER UNE PARTIE =====
async function onCreateLobby() {
  const name = document.getElementById("host-name")?.value?.trim();
  if (!name) return showLobbyError("Entrez votre pseudo !");

  setLoadingState(true);

  try {
    lobby.myName = name;
    lobby.isHost = true;
    peerManager.isHost = true;

    const peerId = await peerManager.initPeer(name);
    lobby.myPeerId = peerId;
    lobby.myId = "p1";
    lobby.roomCode = peerId;

    // Initialiser la salle dans le GameState
    gameState.initRoom(`uno-${peerId.slice(-6)}`, {
      id: "p1",
      peerId: peerId,
      name: name,
    });
    lobby.players = [...gameState.players];

    // Écouter les guests entrants
    peerManager.listenAsHost();
    peerManager.onMessage = handleLobbyMessage;
    peerManager.onConnect = onPeerConnected;
    peerManager.onDisconnect = onPeerDisconnected;

    // Afficher l'interface hôte
    showRoomPanel(peerId);
    updateLobbyUI();

    setLoadingState(false);
  } catch (err) {
    setLoadingState(false);
    showLobbyError("Impossible de créer la partie : " + err.message);
  }
}

// ===== REJOINDRE UNE PARTIE =====
async function onJoinLobby() {
  const name = document.getElementById("guest-name")?.value?.trim();
  const code = document.getElementById("room-code")?.value?.trim();
  if (!name) return showLobbyError("Entrez votre pseudo !");
  if (!code) return showLobbyError("Entrez le code de la partie !");

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

    // Envoyer JOIN_GAME à l'hôte
    const joinMsg = {
      action: "JOIN_GAME",
      payload: {
        peerId: peerId,
        name: name,
        isReady: false,
      },
    };
    peerManager.sendToHost(joinMsg);

    showRoomPanel(code);
    setLoadingState(false);
  } catch (err) {
    setLoadingState(false);
    showLobbyError("Impossible de rejoindre la partie : " + err.message);
  }
}

// ===== TOGGLE PRÊT =====
function onToggleReady() {
  if (lobby.isHost) return; // L'hôte est toujours prêt
  const me = lobby.players.find((p) => p.id === lobby.myId);
  const newReady = !(me?.isReady || false);

  peerManager.sendAction({
    action: "PLAYER_READY_CHANGE",
    payload: {
      playerId: lobby.myId,
      isReady: newReady,
    },
  });

  // Mise à jour optimiste locale
  if (me) me.isReady = newReady;
  updateLobbyUI();
}

// ===== LANCER LA PARTIE (Hôte) =====
function onStartGame() {
  if (!lobby.isHost) return;

  const validation = gameState.getLobbyValidation();
  if (!validation.canStart) {
    showLobbyError(validation.validationMessage);
    return;
  }

  // Diffuser la validation
  const validationMsg = {
    action: "LOBBY_VALIDATION",
    payload: {
      canStart: true,
      missingPlayers: 0,
      notReadyCount: 0,
      validationMessage: "Tous les joueurs sont prêts. Lancement imminent !",
    },
  };
  peerManager.broadcast(validationMsg);

  // Générer le seed et lancer
  const seed = generateSeed();
  const startSignal = {
    action: "START_GAME_SIGNAL",
    payload: {
      gameStatus: "playing",
      seed: seed,
      initialTurnIndex: 0,
      lastActionId: 1,
    },
  };
  peerManager.broadcast(startSignal);

  // L'hôte aussi démarre
  handleStartGame(seed);
}

// ===== MESSAGES DU LOBBY (reçus) =====
function handleLobbyMessage(data, fromPeerId) {
  const { action, payload } = data;

  switch (action) {
    // ---- Guest rejoint ----
    case "JOIN_GAME": {
      if (!lobby.isHost) return;

      // Générer un ID joueur
      const playerCount = gameState.players.length;
      const newId = `p${playerCount + 1}`;

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

      // Envoyer l'état de la room au nouveau guest (son ID inclus)
      peerManager.send(fromPeerId, {
        action: "ROOM_CREATED",
        payload: {
          ...gameState.getRoomState(),
          yourPlayerId: newId,
        },
      });

      // Notifier tout le monde
      const joinedMsg = {
        action: "PLAYER_JOINED",
        payload: {
          player: {
            id: newId,
            peerId: fromPeerId,
            name: payload.name,
            isReady: false,
            isConnected: true,
          },
        },
      };
      peerManager.broadcast(joinedMsg, fromPeerId);

      updateLobbyUI();
      updateStartButton();
      break;
    }

    // ---- État initial de la room (reçu par le guest) ----
    case "ROOM_CREATED": {
      if (lobby.isHost) return;
      lobby.myId = payload.yourPlayerId;
      lobby.players = payload.players || [];
      updateLobbyUI();
      break;
    }

    // ---- Nouveau joueur arrivé (broadcast) ----
    case "PLAYER_JOINED": {
      if (lobby.isHost) return;
      const exists = lobby.players.find((p) => p.id === payload.player.id);
      if (!exists) lobby.players.push(payload.player);
      updateLobbyUI();
      break;
    }

    // ---- Changement de statut prêt ----
    case "PLAYER_READY_CHANGE": {
      if (lobby.isHost) {
        // L'hôte met à jour et rediffuse
        gameState.setPlayerReady(payload.playerId, payload.isReady);
        lobby.players = gameState.players.slice();
        peerManager.broadcast(
          { action: "PLAYER_READY_CHANGE", payload },
          fromPeerId,
        );
        updateStartButton();
      } else {
        // Guest reçoit la mise à jour
        const p = lobby.players.find((pl) => pl.id === payload.playerId);
        if (p) p.isReady = payload.isReady;
      }
      updateLobbyUI();
      break;
    }

    // ---- Validation du lancement ----
    case "LOBBY_VALIDATION": {
      if (!payload.canStart) {
        showLobbyError(payload.validationMessage);
      }
      break;
    }

    // ---- Signal de démarrage ----
    case "START_GAME_SIGNAL": {
      handleStartGame(payload.seed);
      break;
    }

    // ---- Joueur déconnecté ----
    case "PLAYER_LEFT": {
      const p = lobby.players.find((pl) => pl.id === payload.playerId);
      if (p) p.isConnected = false;
      updateLobbyUI();
      showToast(`${p?.name || "Un joueur"} a quitté la partie.`, "warning");
      break;
    }

    // ---- Migration d'hôte ----
    case "HOST_MIGRATION": {
      if (payload.newHostId === lobby.myId) {
        lobby.isHost = true;
        peerManager.isHost = true;
        showToast("Vous êtes maintenant l'hôte de la partie !", "info");
      }
      break;
    }

    case "ERROR": {
      showLobbyError(payload.message);
      break;
    }
  }
}

// ===== DÉMARRAGE DU JEU =====
function handleStartGame(seed) {
  // Stocker les infos essentielles pour game.html
  sessionStorage.setItem("uno_seed", seed);
  sessionStorage.setItem("uno_my_id", lobby.myId);
  sessionStorage.setItem("uno_my_name", lobby.myName);
  sessionStorage.setItem("uno_is_host", lobby.isHost ? "1" : "0");
  sessionStorage.setItem("uno_room_code", lobby.roomCode);
  sessionStorage.setItem(
    "uno_host_peer_id",
    lobby.hostPeerId || lobby.myPeerId,
  );
  sessionStorage.setItem("uno_players", JSON.stringify(lobby.players));
  sessionStorage.setItem("uno_my_peer_id", lobby.myPeerId);

  // Redirection vers game.html
  window.location.href = "game.html";
}

// ===== EVENTS PeerManager =====
function onPeerConnected(peerId) {
  console.log("[Lobby] Peer connecté:", peerId);
}

function onPeerDisconnected(peerId) {
  if (lobby.isHost) {
    const dp = gameState.players.find((p) => p.peerId === peerId);
    if (dp) {
      gameState.removePlayer(dp.id);
      lobby.players = gameState.players.slice();

      // Notifier tout le monde
      peerManager.broadcast({
        action: "PLAYER_LEFT",
        payload: {
          playerId: dp.id,
          reason: "disconnected",
          newHostId: null,
          lastActionId: gameState.lastActionId,
        },
      });
      updateLobbyUI();
      updateStartButton();
    }
  }
}

// ===== UI HELPERS =====
function showRoomPanel(roomCode) {
  lobby.roomCode = roomCode;
  document.getElementById("landing-section")?.classList.add("hidden");
  document.getElementById("room-section")?.classList.remove("hidden");
  document.getElementById("room-code-display")?.classList.remove("hidden");

  const el = document.getElementById("room-code-value");
  if (el) el.textContent = roomCode;

  // Afficher les boutons selon le rôle
  const startBtn = document.getElementById("btn-start");
  const readyBtn = document.getElementById("btn-ready");

  if (lobby.isHost) {
    if (startBtn) startBtn.classList.remove("hidden");
    if (readyBtn) readyBtn.classList.add("hidden");
  } else {
    if (startBtn) startBtn.classList.add("hidden");
    if (readyBtn) readyBtn.classList.remove("hidden");
  }
}

function updateLobbyUI() {
  renderLobbyPlayers(lobby.players, lobby.myId);

  const count = lobby.players.filter((p) => p.isConnected).length;
  const statusEl = document.getElementById("lobby-status");
  if (statusEl) {
    statusEl.textContent = `${count} / 4 joueur(s) connecté(s)`;
  }

  // Mettre à jour le bouton prêt (guests seulement)
  const readyBtn = document.getElementById("btn-ready");
  if (lobby.isHost) {
    // L'hôte ne voit jamais le bouton prêt
    if (readyBtn) readyBtn.classList.add("hidden");
    return;
  }
  const me = lobby.players.find((p) => p.id === lobby.myId);
  if (readyBtn && me) {
    readyBtn.classList.remove("hidden");
    readyBtn.textContent = me.isReady ? "✓ Prêt" : "Je suis prêt";
    readyBtn.className = me.isReady
      ? "btn btn-success btn-full"
      : "btn btn-secondary btn-full";
  }
}

function updateStartButton() {
  if (!lobby.isHost) return;
  const btn = document.getElementById("btn-start");
  if (!btn) return;
  const validation = gameState.getLobbyValidation();
  btn.disabled = !validation.canStart;
  btn.title = validation.canStart ? "" : validation.validationMessage;
}

function showLobbyError(msg) {
  showToast(msg, "error");
}

function setLoadingState(loading) {
  const createBtn = document.getElementById("btn-create");
  const joinBtn = document.getElementById("btn-join");
  if (createBtn) createBtn.disabled = loading;
  if (joinBtn) joinBtn.disabled = loading;
}
