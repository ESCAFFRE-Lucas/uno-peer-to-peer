// --- ÉLÉMENTS DU DOM ---
const screenHome = document.getElementById("screen-home");
const screenRoom = document.getElementById("screen-room");
const displayRoomCode = document.getElementById("display-room-code");
const playersListUl = document.getElementById("players-list");
const readyBtn = document.getElementById("ready-btn");
const screenGame = document.getElementById("screen-game");
const btnStart = document.getElementById("btn-start");

let monEtatPret = false;

// --- ÉCOUTE DES ÉVÉNEMENTS DU JEU ---
document.addEventListener("uno", (e) => {
    const { action, payload } = e.detail;

    if (action === "ROOM_CREATED" || action === "ROOM_JOINED") {
        afficherEcranSalle(payload.hostId, payload.players);
    }
    else if (action === "ROOM_UPDATE") {
        mettreAJourListeJoueurs(payload.players);
    }
    // NOUVEAU : On écoute le signal de départ
    else if (action === "START_GAME") {
        lancerLeJeu();
    }
});

btnStart.addEventListener("click", () => {
    if (isHost) {
        // Le Host prévient son propre navigateur
        document.dispatchEvent(new CustomEvent("uno", { detail: { action: "START_GAME", payload: {} } }));
        // Le Host prévient tous les invités
        connections.forEach(conn => conn.send({ action: "START_GAME", payload: {} }));
    }
});

// --- GESTION DE TON BOUTON "PRÊT" ---
readyBtn.addEventListener("click", () => {
    monEtatPret = !monEtatPret;
    readyBtn.innerText = monEtatPret ? "Annuler (Pas prêt)" : "Je suis prêt !";

    if (isHost) {
        // Si je suis le Host, je mets à jour mon propre état
        const moi = roomState.players.find(p => p.id === peer.id);
        moi.isReady = monEtatPret;
        // Je mets à jour mon affichage et je préviens les invités
        document.dispatchEvent(new CustomEvent("uno", { detail: { action: "ROOM_UPDATE", payload: { players: roomState.players } } }));
        connections.forEach(conn => conn.send({ action: "ROOM_UPDATE", payload: { players: roomState.players } }));
    } 
    else if (hostConn && hostConn.open) {
        // Si je suis un Guest, j'envoie mon nouvel état au Host
        hostConn.send({
            action: "TOGGLE_READY",
            payload: { isReady: monEtatPret }
        });
    }
});

// --- FONCTIONS D'AFFICHAGE ---
function afficherEcranSalle(roomCode, players) {
    screenHome.hidden = true;
    screenRoom.hidden = false;
    displayRoomCode.innerText = roomCode;
    mettreAJourListeJoueurs(players);
}

function mettreAJourListeJoueurs(playersArray) {
    playersListUl.innerHTML = ''; 

    // 1. On recrée la liste visuelle
    playersArray.forEach(player => {
        const li = document.createElement('li');
        const isMe = player.id === peer.id ? " (Moi)" : ""; 
        li.innerText = `${player.name}${isMe}`;
        
        const statusSpan = document.createElement('span');
        statusSpan.innerText = player.isReady ? "Prêt" : "Pas prêt";
        statusSpan.className = player.isReady ? "ready" : "not-ready";
        
        li.appendChild(statusSpan);
        playersListUl.appendChild(li);
    });

    // 2. NOUVEAU : Logique du bouton "Démarrer" pour le Host
    if (isHost) {
        btnStart.hidden = false; // On l'affiche pour le Host
        
        // On vérifie si TOUT LE MONDE est prêt (la méthode .every() de JS est parfaite pour ça)
        const toutLeMondeEstPret = playersArray.every(p => p.isReady);
        const assezDeJoueurs = playersArray.length >= 2; // Il faut au moins 2 joueurs

        // On active le bouton seulement si les conditions sont remplies
        btnStart.disabled = !(toutLeMondeEstPret && assezDeJoueurs);
    }
}

function lancerLeJeu() {
    console.log("🎮 Lancement du jeu de UNO !");
    screenRoom.hidden = true; // On cache le lobby
    screenGame.hidden = false; // On affiche le plateau
    
    // Ici, plus tard, on appellera la fonction pour initialiser le deck de cartes !
}