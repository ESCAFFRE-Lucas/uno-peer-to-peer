let connections = new Map();
let hostConn = null;
let isHost = false;
let roomState = null;

const inputNameCreate = document.getElementById("input-name-create");
const inputNameJoin   = document.getElementById("input-name-join");
const inputRoomCode   = document.getElementById("input-room-code");
const inputMaxPlayers = document.getElementById("input-max-players");

document.getElementById("btn-create").addEventListener("click", createGame);
document.getElementById("btn-join").addEventListener("click", joinGame);

function createGame() {
    const name       = inputNameCreate.value.trim() || "Anonyme";
    const maxPlayers = parseInt(inputMaxPlayers.value, 10);
    const hostId     = peer.id; // L'ID PeerJS sert de code de Room

    isHost    = true;
    roomState = {
        gameStatus: "waiting",
        hostId,
        maxPlayers,
        players: [{ id: hostId, name, isReady: false, isConnected: true }],
    };

    dispatch("ROOM_CREATED", { ...roomState });

    peer.on("connection", (conn) => {
        conn.on("open", () => {
            const newPlayer = {
                id: conn.peer,
                name: conn.metadata?.name || "Joueur",
                isReady: false,
                isConnected: true,
            };

            connections.set(conn.peer, conn);
            roomState.players.push(newPlayer);

            // On envoie l'état de la salle au nouveau venu
            conn.send({ action: "ROOM_JOINED", payload: { ...roomState } });

            // On met à jour l'interface du Host
            dispatch("ROOM_UPDATE", { players: roomState.players });

            // On informe TOUS LES AUTRES invités du nouvel état
            broadcastToGuests("ROOM_UPDATE", { players: roomState.players });
        });

        conn.on("data", (data) => {
            // NOUVEAU : Le Host écoute les actions des Guests (comme ton bouton Prêt)
            if (data.action === "TOGGLE_READY") {
                const player = roomState.players.find(p => p.id === conn.peer);
                if (player) {
                    player.isReady = data.payload.isReady;
                    // On met à jour l'interface locale et on prévient tout le monde
                    dispatch("ROOM_UPDATE", { players: roomState.players });
                    broadcastToGuests("ROOM_UPDATE", { players: roomState.players });
                }
            }
        });

        conn.on("close", () => {
            connections.delete(conn.peer);
            roomState.players = roomState.players.filter((p) => p.id !== conn.peer);
            dispatch("ROOM_UPDATE", { players: roomState.players });
            broadcastToGuests("ROOM_UPDATE", { players: roomState.players });
        });
    });
}

function joinGame() {
    const name     = inputNameJoin.value.trim() || "Anonyme";
    const roomCode = inputRoomCode.value.trim();
    if (!roomCode) { alert("Entre un code de room."); return; }

    isHost = false;

    // On se connecte au Host en lui passant notre pseudo dans les metadata
    hostConn = peer.connect(roomCode, { metadata: { name } });

    hostConn.on("open", () => {
        console.log("Connecté au Host !");
    });

    hostConn.on("data", (data) => {
        // Quand le Host nous envoie quelque chose, on le transfère à notre interface
        dispatch(data.action, data.payload);
    });
}

function dispatch(action, payload) {
    document.dispatchEvent(new CustomEvent("uno", { detail: { action, payload } }));
}

function broadcastToGuests(action, payload) {
    connections.forEach(conn => conn.send({ action, payload }));
}