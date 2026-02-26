/**
 * peer.js — Gestion PeerJS pour UNO P2P
 * Architecture : Hôte (hub) ↔ Guests (connexions directes)
 */

class PeerManager {
  constructor() {
    this.peer = null;
    this.connections = {}; // { peerId: DataConnection }
    this.myPeerId = null;
    this.isHost = false;
    this.hostConn = null; // Connexion vers l'hôte (pour les guests)

    // Callbacks externes
    this.onMessage = null; // (data, fromPeerId) => void
    this.onConnect = null; // (peerId) => void
    this.onDisconnect = null; // (peerId) => void
    this.onError = null; // (err) => void
    this.onReady = null; // (myPeerId) => void
  }

  initPeer(displayName = "") {
    return new Promise((resolve, reject) => {
      this.peer = new Peer(undefined, {
        host: window.location.hostname,
        port: 9000,
        path: "/peerjs",
        debug: 0,
      });

      this.peer.on("open", (id) => {
        this.myPeerId = id;
        console.log(
          `[Peer] Connecté au serveur PeerJS. Mon ID : ${id} (${displayName})`,
        );
        if (this.onReady) this.onReady(id);
        resolve(id);
      });

      this.peer.on("error", (err) => {
        console.error("[Peer] Erreur :", err);
        if (this.onError) this.onError(err);
        reject(err);
      });

      this.peer.on("disconnected", () => {
        console.warn(
          "[Peer] Déconnecté du serveur de signalisation. Tentative de reconnexion...",
        );
        setTimeout(() => this.peer.reconnect(), 2000);
      });
    });
  }

  listenAsHost() {
    this.isHost = true;
    this.peer.on("connection", (conn) => {
      console.log(`[Host] Nouvelle connexion entrante : ${conn.peer}`);
      this._setupConnection(conn);
    });
  }

  connectToHost(hostPeerId) {
    return new Promise((resolve, reject) => {
      const conn = this.peer.connect(hostPeerId, {
        reliable: true,
        metadata: { version: "1.0" },
      });

      conn.on("open", () => {
        console.log(`[Guest] Connecté à l'hôte : ${hostPeerId}`);
        this.hostConn = conn;
        this._setupConnection(conn);
        resolve();
      });

      conn.on("error", (err) => {
        reject(err);
      });

      setTimeout(() => reject(new Error("Timeout de connexion")), 10000);
    });
  }

  _setupConnection(conn) {
    this.connections[conn.peer] = conn;

    conn.on("open", () => {
      if (this.onConnect) this.onConnect(conn.peer);
    });

    conn.on("data", (data) => {
      console.log(`[Peer] Message reçu de ${conn.peer}:`, data.action);
      if (this.onMessage) this.onMessage(data, conn.peer);
    });

    conn.on("close", () => {
      console.log(`[Peer] Connexion fermée avec : ${conn.peer}`);
      delete this.connections[conn.peer];
      if (this.onDisconnect) this.onDisconnect(conn.peer);
    });

    conn.on("error", (err) => {
      console.error(`[Peer] Erreur de connexion avec ${conn.peer}:`, err);
      if (this.onError) this.onError(err);
    });
  }

  send(peerId, data) {
    const conn = this.connections[peerId];
    if (conn && conn.open) {
      conn.send(data);
    } else {
      console.warn(
        `[Peer] Impossible d'envoyer à ${peerId} : connexion fermée.`,
      );
    }
  }

  broadcast(data, excludePeerId = null) {
    Object.entries(this.connections).forEach(([peerId, conn]) => {
      if (peerId !== excludePeerId && conn.open) {
        conn.send(data);
      }
    });
  }

  sendToHost(data) {
    if (this.hostConn && this.hostConn.open) {
      this.hostConn.send(data);
    } else if (this.isHost) {
      if (this.onMessage) this.onMessage(data, this.myPeerId);
    } else {
      console.warn("[Guest] Connexion à l'hôte non disponible.");
    }
  }

  sendAction(data) {
    if (this.isHost) {
      if (this.onMessage) this.onMessage(data, this.myPeerId);
    } else {
      this.sendToHost(data);
    }
  }

  getConnectedPeers() {
    return Object.keys(this.connections);
  }

  destroy() {
    if (this.peer) {
      this.peer.destroy();
    }
  }
}

const peerManager = new PeerManager();
