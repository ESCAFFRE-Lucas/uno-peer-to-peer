/**
 * ui.js — Rendu de l'interface du jeu UNO P2P
 */

/** Affiche un toast de notification */
function showToast(message, type = "info", duration = 3500) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const colors = {
    info: "#64b5f6",
    success: "#81c784",
    warning: "#fff176",
    error: "#ef9a9a",
    uno: "#e53935",
  };

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.style.borderLeft = `4px solid ${colors[type] || colors.info}`;
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    toast.style.opacity = "0";
    toast.style.transform = "translateX(20px)";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/** Retourne la classe CSS d'une carte */
function getCardClass(card) {
  const colorMap = {
    red: "card-red",
    blue: "card-blue",
    green: "card-green",
    yellow: "card-yellow",
    black: "card-black",
  };
  return colorMap[card.color] || "card-black";
}

/** Génère l'HTML d'une carte UNO */
function renderCardHTML(card, extra = "") {
  const colorClass = getCardClass(card);
  const label = getCardLabel(card.value);
  return `
    <div class="uno-card ${colorClass} ${extra}" 
         data-card-id="${card.id}" 
         data-card-color="${card.color}"
         data-card-value="${card.value}"
         title="${card.color} ${card.value}">
      <span class="uno-card-inner-top">${label}</span>
      <span class="uno-card-value">${label}</span>
      <span class="uno-card-inner-bottom">${label}</span>
    </div>
  `;
}

/** Affiche la main du joueur local */
function renderPlayerHand(cards, activeColor, topCard, isMyTurn) {
  const container = document.getElementById("my-hand");
  if (!container) return;

  if (cards.length === 0) {
    container.innerHTML =
      '<p style="color: var(--text-secondary); margin: auto;">Vous n\'avez plus de cartes !</p>';
    return;
  }

  container.innerHTML = cards
    .map((card) => {
      const playable = isMyTurn && isPlayable(card, topCard, activeColor);
      const cls = isMyTurn ? (playable ? "playable" : "not-playable") : "";
      return renderCardHTML(card, cls);
    })
    .join("");

  // Listener sur chaque carte
  if (isMyTurn) {
    container.querySelectorAll(".uno-card.playable").forEach((el) => {
      el.addEventListener("click", () => {
        const cardId = el.dataset.cardId;
        handleCardPlay(cardId);
      });
    });
  }
}

/** Met à jour la carte du dessus de la défausse */
function renderDiscardTop(card, activeColor) {
  const container = document.getElementById("discard-pile");
  if (!container || !card) return;

  // Pour les cartes noires, afficher la couleur active
  const displayCard =
    card.color === "black" ? { ...card, color: activeColor || "black" } : card;

  container.innerHTML = renderCardHTML(displayCard, "large discard-top");
}

/** Met à jour les infos des adversaires */
function renderOpponents(players, myId, currentPlayerId) {
  const container = document.getElementById("opponents-area");
  if (!container) return;

  const opponents = players.filter((p) => p.id !== myId && p.isConnected);

  container.innerHTML = opponents
    .map((player) => {
      const isActive = player.id === currentPlayerId;
      const avatarColors = ["#8b5cf6", "#e53935", "#1e88e5", "#43a047"];
      const colorIdx = players.indexOf(player) % 4;
      const initial = player.name.charAt(0).toUpperCase();

      return `
      <div class="opponent-card ${isActive ? "active-turn" : ""} ${player.hasSaidUno ? "has-uno" : ""}" data-player-id="${player.id}">
        ${player.hasSaidUno ? '<span class="uno-badge">UNO!</span>' : ""}
        <div class="opponent-avatar" style="background: ${avatarColors[colorIdx]}20; color: ${avatarColors[colorIdx]}; border: 2px solid ${avatarColors[colorIdx]}40;">
          ${initial}
        </div>
        <div class="opponent-name">${escapeHtml(player.name)}</div>
        <div class="opponent-cards">
          <span>${player.handCount}</span> carte${player.handCount > 1 ? "s" : ""}
        </div>
        ${isActive ? '<div style="font-size:0.7rem;color:var(--accent-yellow);margin-top:4px;font-weight:700;">C\'est son tour</div>' : ""}
      </div>
    `;
    })
    .join("");
}

/** Met à jour la barre supérieure du jeu */
function renderTopBar(state) {
  const dirEl = document.getElementById("direction-indicator");
  const colorEl = document.getElementById("active-color");
  const drawEl = document.getElementById("pending-draw");

  if (dirEl) {
    dirEl.textContent = state.direction === 1 ? "→" : "←";
  }

  if (colorEl) {
    const colorEmojis = { red: "🔴", blue: "🔵", green: "🟢", yellow: "🟡" };
    colorEl.textContent = colorEmojis[state.activeColor] || "⚫";
  }

  if (drawEl) {
    if (state.pendingDrawCount > 0) {
      drawEl.textContent = `+${state.pendingDrawCount} en attente`;
      drawEl.classList.remove("hidden");
    } else {
      drawEl.classList.add("hidden");
    }
  }
}

/** Affiche / masque le bandeau "C'est votre tour" */
function renderTurnBanner(isMyTurn, playerName = "") {
  const banner = document.getElementById("turn-banner");
  if (!banner) return;
  if (isMyTurn) {
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

/** Met à jour le compteur de cartes du deck */
function renderDeckCount(count) {
  const el = document.getElementById("deck-count");
  if (el) el.textContent = `${count} carte${count > 1 ? "s" : ""}`;
}

/** Affiche le sélecteur de couleur (modal) */
function showColorPicker(callback) {
  const overlay = document.getElementById("color-picker-overlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");

  overlay.querySelectorAll(".color-choice").forEach((btn) => {
    btn.onclick = () => {
      const color = btn.dataset.color;
      overlay.classList.add("hidden");
      callback(color);
    };
  });
}

/** Masque le sélecteur de couleur */
function hideColorPicker() {
  const overlay = document.getElementById("color-picker-overlay");
  if (overlay) overlay.classList.add("hidden");
}

/** Affiche l'écran de fin de partie */
function showGameOver(winnerId, winnerName, scores, players) {
  const overlay = document.getElementById("gameover-overlay");
  if (!overlay) return;

  const titleEl = overlay.querySelector(".gameover-title");
  const winnerEl = overlay.querySelector(".gameover-winner");
  const scoresList = overlay.querySelector(".scores-list");

  if (titleEl) titleEl.textContent = "🎉 Fin de partie !";
  if (winnerEl)
    winnerEl.innerHTML = `Vainqueur : <strong>${escapeHtml(winnerName)}</strong>`;

  if (scoresList && scores) {
    scoresList.innerHTML = players
      .map(
        (p) => `
      <li class="score-item">
        <span>${escapeHtml(p.name)} ${p.id === winnerId ? "👑" : ""}</span>
        <span>${scores[p.id] || 0} pts</span>
      </li>
    `,
      )
      .join("");
  }

  overlay.classList.remove("hidden");
}

/** Affiche la liste des joueurs dans le lobby */
function renderLobbyPlayers(players, myId) {
  const container = document.getElementById("player-list");
  if (!container) return;

  const colors = ["#8b5cf6", "#e53935", "#1e88e5", "#43a047"];

  container.innerHTML = players
    .map((p, i) => {
      const isMe = p.id === myId;
      const initial = p.name.charAt(0).toUpperCase();
      const color = colors[i % 4];

      return `
      <div class="player-item">
        <div class="player-avatar" style="background: ${color}20; color: ${color};">
          ${initial}
        </div>
        <div class="player-name">
          ${escapeHtml(p.name)} ${isMe ? '<span style="font-size:0.75rem;color:var(--text-secondary)">(Vous)</span>' : ""}
        </div>
        ${
          p.isReady && p.id !== players[0]?.id
            ? '<span class="player-badge badge-ready">Prêt ✓</span>'
            : p.id === players[0]?.id
              ? '<span class="player-badge badge-host">Hôte</span>'
              : '<span class="player-badge badge-waiting">En attente</span>'
        }
      </div>
    `;
    })
    .join("");
}

/** Échappe les caractères HTML */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
