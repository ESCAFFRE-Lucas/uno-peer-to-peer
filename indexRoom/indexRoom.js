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
    const gameId     = crypto.randomUUID();
    const hostId     = peer.id;

    isHost    = true;
    roomState = {
        gameId,
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
                name: conn.metadata?.name || conn.peer,
                isReady: false,
                isConnected: true,
            };

            connections.set(conn.peer, conn);
            roomState.players.push(newPlayer);

            conn.send({
                action: "ROOM_JOINED",
                payload: { ...roomState },
            });

            dispatch("PLAYER_JOINED", { player: newPlayer });
        });

        conn.on("close", () => {
            connections.delete(conn.peer);
            roomState.players = roomState.players.filter((p) => p.id !== conn.peer);
            dispatch("PLAYER_LEFT", { playerId: conn.peer });
        });

        conn.on("error", console.error);
    });
}

function joinGame() {
    const name     = inputNameJoin.value.trim() || "Anonyme";
    const roomCode = inputRoomCode.value.trim();
    if (!roomCode) { alert("Entre un code de room."); return; }

    isHost = false;

    peer.on("open", (id) => {
        hostConn = peer.connect(roomCode, { metadata: { name } });

        hostConn.on("open", () => {
            dispatch("PLAYER_JOINED", {
                player: { id, name, isReady: false, isConnected: true },
            });
        });

        hostConn.on("data", (data) => {
            dispatch(data.action, data.payload);
        });

        hostConn.on("close", () => dispatch("HOST_DISCONNECTED", {}));
        hostConn.on("error", console.error);
    });
}

function dispatch(action, payload) {
    console.log(`[UNO] ▶ ${action}`, JSON.stringify({ action, payload }, null, 2));
    document.dispatchEvent(new CustomEvent("uno", { detail: { action, payload } }));
}
