(() => {
  const players = [
    { track: 'Night Drive', time: '02:18', bpm: 124, status: 'PLAYING', audible: false },
    { track: 'Neon Horizon', time: '01:42', bpm: 126, status: 'PLAYING', audible: false },
    { track: 'After Hours', time: '00:36', bpm: 122, status: 'PAUSED', audible: false },
    { track: 'Electric Current', time: '03:07', bpm: 128, status: 'PLAYING', audible: true },
    { track: 'Distant Signals', time: '04:11', bpm: 120, status: 'PLAYING', audible: false },
    { track: 'Last Light', time: '00:00', bpm: 125, status: 'CUED', audible: false },
  ];
  const stage = document.querySelector('#carousel-stage');
  const selector = document.querySelector('#selector');
  const selection = document.querySelector('#selection');
  let selected = 0;

  const cards = players.map((player, index) => {
    const number = String(index + 1).padStart(2, '0');
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'player';
    card.setAttribute('aria-label', `Select ErAudio ${number}, ${player.track}, ${player.status.toLowerCase()}${player.audible ? ', audible in mix' : ''}`);
    const levels = [35, 62, 90, 54, 72, 39, 67, 45, 80, 57, 32, 63]
      .map((level, band) => `<span style="height:${20 + (level + index * 13 + band * index * 3) % 80}%"></span>`).join('');
    card.innerHTML = `
      <div class="player-title"><span>ErAudio ${number}</span><span>${player.audible ? 'AUDIBLE IN MIX' : player.status}</span></div>
      <div class="screen">
        <div class="track">${player.track}</div>
        <div class="screen-meta"><span>${player.time} &nbsp; ${player.status}</span><span>${player.bpm} BPM</span></div>
        <div class="spectrum" aria-hidden="true">${levels}</div>
      </div>
      <div class="seek"></div>
      <div class="player-controls" aria-hidden="true"><span>|&lt;</span><span>&#9654;</span><span>||</span><span>&gt;|</span><span class="volume"></span><span>DJ</span></div>`;
    card.addEventListener('click', () => select(index));
    stage.append(card);
    return card;
  });

  const buttons = players.map((player, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(index + 1).padStart(2, '0');
    button.setAttribute('aria-label', `Select ErAudio ${index + 1}: ${player.track}${player.audible ? ', audible in mix' : ''}`);
    button.addEventListener('click', () => select(index));
    selector.append(button);
    return button;
  });

  function render() {
    const radiusX = Math.max(0, (stage.clientWidth - cards[0].offsetWidth) / 2 - 12) * 0.85;
    const radiusY = stage.clientHeight * 0.27;
    cards.forEach((card, index) => {
      const angle = (index - selected) * 2 * Math.PI / players.length;
      const depth = (Math.cos(angle) + 1) / 2;
      const x = Math.sin(angle) * radiusX;
      const y = Math.cos(angle) * radiusY;
      const scale = 0.48 + depth * 0.52;
      const turn = -Math.sin(angle) * 18;
      card.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) perspective(800px) rotateY(${turn}deg) scale(${scale})`;
      card.style.zIndex = String(Math.round(depth * 10) + (depth > 0.5 ? 21 : 1));
      card.style.opacity = String(0.65 + depth * 0.35);
      card.classList.toggle('selected', index === selected);
      card.setAttribute('aria-pressed', String(index === selected));
      buttons[index].setAttribute('aria-pressed', String(index === selected));
    });
    const player = players[selected];
    selection.innerHTML = `<strong>SELECTED: ErAudio ${String(selected + 1).padStart(2, '0')} / ${player.track}</strong><br>${player.status} &middot; ${player.bpm} BPM${player.audible ? ' &middot; AUDIBLE IN MIX' : ' &middot; NOT AUDIBLE IN MIX'}`;
  }

  function select(index) {
    selected = (index + players.length) % players.length;
    render();
  }

  document.querySelector('#previous').addEventListener('click', () => select(selected - 1));
  document.querySelector('#next').addEventListener('click', () => select(selected + 1));
  document.querySelector('.carousel').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    select(selected + (event.key === 'ArrowRight' ? 1 : -1));
  });
  window.addEventListener('resize', render);
  render();
})();
