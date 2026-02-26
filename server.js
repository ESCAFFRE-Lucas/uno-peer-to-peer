const { PeerServer } = require("peer");

const peerServer = PeerServer({
    port: 9000,
    path: "/peerjs",
    allow_discovery: true,
});

peerServer.on("connection", (client) => {
    console.log(`[PeerServer] Client connecté : ${client.getId()}`);
});

peerServer.on("disconnect", (client) => {
    console.log(`[PeerServer] Client déconnecté : ${client.getId()}`);
});

console.log("✅ Serveur PeerJS local démarré sur http://localhost:9000/peerjs");
console.log("   Ouvrez index.html sur http://localhost:3000");