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

  /**
   * Crée un peer PeerJS avec un ID aléatoire.
   * @param {string} displayName — Nom d'affichage (pour les logs)
   * @returns {Promise<string>} myPeerId
   */
  initPeer(displayName = "") {
    return new Promise((resolve, reject) => {
      this.peer = new Peer(undefined, {
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

  /**
   * MODE HÔTE : écoute les connexions entrantes des guests.
   */
  listenAsHost() {
    this.isHost = true;

    this.peer.on("connection", (conn) => {
      console.log(`[Host] Nouvelle connexion entrante : ${conn.peer}`);
      this._setupConnection(conn);
    });
  }

  /**
   * MODE GUEST : se connecte à l'hôte.
   * @param {string} hostPeerId
   * @returns {Promise<void>}
   */
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

  /**
   * Configure les listeners sur une connexion.
   * @param {DataConnection} conn
   */
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

  /**
   * Envoie un message à un peer spécifique.
   * @param {string} peerId
   * @param {object} data
   */
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

  /**
   * Diffuse un message à tous les peers connectés (hôte → tous les guests).
   * @param {object} data
   * @param {string|null} excludePeerId — exclure ce peer du broadcast
   */
  broadcast(data, excludePeerId = null) {
    Object.entries(this.connections).forEach(([peerId, conn]) => {
      if (peerId !== excludePeerId && conn.open) {
        conn.send(data);
      }
    });
  }

  /**
   * Envoie un message à l'hôte (depuis un guest).
   * @param {object} data
   */
  sendToHost(data) {
    if (this.hostConn && this.hostConn.open) {
      this.hostConn.send(data);
    } else if (this.isHost) {
      // L'hôte traite ses propres messages directement
      if (this.onMessage) this.onMessage(data, this.myPeerId);
    } else {
      console.warn("[Guest] Connexion à l'hôte non disponible.");
    }
  }

  /**
   * Envoi sécurisé : si on est hôte, traite localement. Sinon envoie à l'hôte.
   * Utilisé par les guests ET l'hôte pour les messages de jeu.
   * @param {object} data
   */
  sendAction(data) {
    if (this.isHost) {
      // L'hôte traite ses propres actions
      if (this.onMessage) this.onMessage(data, this.myPeerId);
    } else {
      this.sendToHost(data);
    }
  }

  /** Retourne la liste des peerId connectés */
  getConnectedPeers() {
    return Object.keys(this.connections);
  }

  /** Ferme toutes les connexions */
  destroy() {
    if (this.peer) {
      this.peer.destroy();
    }
  }
}

// Singleton
const peerManager = new PeerManager();
