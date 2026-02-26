// public/guestRoom/guestRoom.js

const peer = new Peer();
let hostConnection = null;
let isReady = false;

const playersListUl = document.getElementById('players-list');
const readyBtn = document.getElementById('ready-btn');

const FAKE_HOST_ID = "12345-abcde-host-fictif";
const MON_PSEUDO = "John";

peer.on('open', (monId) => {
	console.log(` Mon ID: ${monId} | Pseudo: ${MON_PSEUDO}`);

	hostConnection = peer.connect(FAKE_HOST_ID);

	hostConnection.on('open', () => {
		console.log(" Connecté au Host !");
		readyBtn.disabled = false;

		hostConnection.send({
			type: 'PLAYER_JOINED',
			id: monId,
			pseudo: MON_PSEUDO
		});
	});

	hostConnection.on('data', (data) => {
		if (data.type === 'ROOM_UPDATE') {
			mettreAJourInterface(data.players);
		}
	});
});

readyBtn.addEventListener('click', () => {
	isReady = !isReady;
	readyBtn.innerText = isReady ? "Annuler (Pas prêt)" : "Je suis prêt !";

	if (hostConnection && hostConnection.open) {
		hostConnection.send({ type: 'TOGGLE_READY', isReady: isReady });
	}
});

function mettreAJourInterface(playersArray) {
	playersListUl.innerHTML = '';

	playersArray.forEach(player => {
		const li = document.createElement('li');

		const isMe = player.id === peer.id ? " (Moi)" : "";

		li.innerText = `${player.pseudo}${isMe} - `;

		const statusSpan = document.createElement('span');
		statusSpan.innerText = player.isReady ? "Prêt" : "Pas prêt";
		statusSpan.className = player.isReady ? "ready" : "not-ready";

		li.appendChild(statusSpan);
		playersListUl.appendChild(li);
	});
}