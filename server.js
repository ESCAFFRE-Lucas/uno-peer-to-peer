const http = require("http");
const fs = require("fs");
const path = require("path");
const { PeerServer } = require("peer");

// --- Serveur HTTP statique (port 3000) ---
const MIME_TYPES = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".ico": "image/x-icon",
};

const httpServer = http.createServer((req, res) => {
    const safePath = req.url === "/" ? "/index.html" : req.url;
    const filePath = path.join(__dirname, "public", safePath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("404 Not Found");
            return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "text/plain" });
        res.end(data);
    });
});

httpServer.listen(3000, () => {
    console.log("✅ Serveur HTTP démarré sur http://localhost:3000");
});

// --- Serveur PeerJS (port 9000) ---
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

console.log("✅ Serveur PeerJS démarré sur http://localhost:9000/peerjs");