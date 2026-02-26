// On initialise PeerJS globalement pour qu'il soit accessible partout
const peer = new Peer();

peer.on('open', (id) => {
    console.log("✅ Connecté au réseau PeerJS. Mon ID caché est :", id);
});