// app.js

const peer = new Peer();

peer.on('open', (monId) => {
    console.log("✅ Connecté au serveur public PeerJS !");
    console.log("🃏 Mon identifiant de joueur (à partager) est :", monId);
    
    // document.body.innerHTML += `<p>Mon ID : <strong>${monId}</strong></p>`;
});

peer.on('error', (err) => {
    console.error("Erreur PeerJS :", err);
});