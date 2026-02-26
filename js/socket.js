/**
 * js/socket.js — Gestion de la connexion Socket.io pour UNO
 */

class SocketManager {
  constructor() {
    this.socket = null;
    this.onMessage = null; // (action, data) => void
    this.onRoomState = null; // (state) => void
    this.onGameStart = null; // (data) => void
    this.onConnect = null;
    this.onError = null;
  }

  connect() {
    // Se connecte au même host que celui qui sert le fichier
    this.socket = io(`http://${window.location.hostname}:9000`);

    this.socket.on("connect", () => {
      console.log("[Socket] Connecté au serveur :", this.socket.id);
      if (this.onConnect) this.onConnect();
    });

    this.socket.on("roomState", (state) => {
      if (this.onRoomState) this.onRoomState(state);
    });

    this.socket.on("gameStart", (data) => {
      if (this.onGameStart) this.onGameStart(data);
    });

    this.socket.on("error", (err) => {
      console.error("[Socket] Erreur :", err.message);
      if (this.onError) this.onError(err.message);
      showToast(err.message, "danger");
    });

    // Événements génériques de jeu
    const gameEvents = [
      "cardPlayed",
      "playerDraw",
      "updateHand",
      "unoValidated",
      "playerLeft",
      "gameOver",
    ];

    gameEvents.forEach((event) => {
      this.socket.on(event, (data) => {
        if (this.onMessage) this.onMessage(event, data);
      });
    });
  }

  emit(event, data) {
    if (this.socket) {
      this.socket.emit(event, data);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Singleton
const socketManager = new SocketManager();
