const controls = {
  speed: document.querySelector('#speed-slider'),
  scrubber: document.querySelector('#scrubber'),
  volume: document.querySelector('#volume'),
};

const valueDisplays = {
  speed: document.querySelector('#val-speed'),
};

const eventStatus = document.querySelector('#event-status');
const favoritesSelect = document.querySelector('#favorites-select');
const playlistSourceRow = document.querySelector('#playlist-source-row');
const playlistList = document.querySelector('#playlist-list');
const playlistInfo = document.querySelector('#playlist-info');
const favoritesStorageKey = 'eraudio:selected-favorites-list';
const youtubeLoginButton = document.querySelector('#youtube-login');
const youtubeAccountStorageKey = 'eraudio:youtube-account-name';
const openDialog = document.querySelector('#open-dialog');
const openForm = document.querySelector('#open-form');
const openDialogTitle = document.querySelector('#open-dialog-title');
const youtubeInput = document.querySelector('#youtube-input');
const youtubeInputError = document.querySelector('#youtube-input-error');
const fallbackStorage = new Map();
const googleClientId = window.ERAUDIO_CONFIG?.googleClientId || '';
const youtubeScope = 'https://www.googleapis.com/auth/youtube.readonly';
let youtubeAccessToken = '';

const trackTitleDisplay = document.querySelector('#track-title');
const timeDisplay = document.querySelector('#time-display');
const idleTitle = 'ErAudio - press ⏏ to open a YouTube video';
let ytPlayer = null;
let ytReady = false;
let playingTrack = null;
let playingList = null;
let scrubbing = false;

const favoriteLists = [
  {
    id: 'favorites',
    name: 'Favorites',
    tracks: [],
  },
];

function readStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return fallbackStorage.get(key) ?? null;
  }
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    fallbackStorage.set(key, value);
  }
}

function parseYouTubeInput(value) {
  const input = String(value || '').trim();
  const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

  if (videoIdPattern.test(input)) {
    return { videoId: input };
  }
  if (!input) {
    throw new Error('Paste a YouTube link or enter an 11-character video ID.');
  }

  let url;
  try {
    const normalizedInput = /^[a-z][a-z\d+.-]*:/i.test(input)
      ? input
      : `https://${input.replace(/^\/\//, '')}`;
    url = new URL(normalizedInput);
  } catch {
    throw new Error('Enter a valid YouTube link or an 11-character video ID.');
  }

  const hostname = url.hostname.toLowerCase();
  const supportedHosts = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be',
  ]);
  if (!['https:', 'http:'].includes(url.protocol) || !supportedHosts.has(hostname)) {
    throw new Error('Use a link from youtube.com or youtu.be.');
  }

  const pathSegments = url.pathname.split('/').filter(Boolean);
  const videoId = hostname.endsWith('youtu.be')
    ? pathSegments[0]
    : url.searchParams.get('v') || (['embed', 'shorts', 'live', 'v'].includes(pathSegments[0]) ? pathSegments[1] : null);

  if (!videoId || !videoIdPattern.test(videoId)) {
    throw new Error('That link does not contain a valid 11-character YouTube video ID.');
  }

  return { videoId };
}

function formatPlaylistDuration(tracks) {
  const seconds = tracks.reduce((total, track) => {
    const [minutes, remainingSeconds] = track.duration.split(':').map(Number);
    return total + (Number.isFinite(minutes) && Number.isFinite(remainingSeconds) ? (minutes * 60) + remainingSeconds : 0);
  }, 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

let currentListId = favoriteLists[0].id;

function currentList() {
  return favoriteLists.find((list) => list.id === currentListId) || favoriteLists[0];
}

function renderFavoritesList(listId) {
  const selectedList = favoriteLists.find((list) => list.id === listId) || favoriteLists[0];
  currentListId = selectedList.id;
  writeStoredValue(favoritesStorageKey, selectedList.id);
  favoritesSelect.value = selectedList.id;
  playlistList.replaceChildren(...selectedList.tracks.map((track, index) => {
    const item = document.createElement('button');
    item.className = `playlist-item${track === playingTrack ? ' active' : ''}${track.selected ? ' selected' : ''}`;
    item.type = 'button';
    item.setAttribute('aria-pressed', String(Boolean(track.selected)));
    item.dataset.track = String(index + 1);
    if (track.videoId) item.dataset.videoId = track.videoId;
    item.textContent = `${index + 1}. ${track.title} [${track.duration}]`;
    return item;
  }));
  playlistInfo.textContent = `${selectedList.name.toUpperCase()} / ${selectedList.tracks.length} TRACKS / ${formatPlaylistDuration(selectedList.tracks)} TOTAL`;
  announceEvent({ type: 'playlist', name: selectedList.name });
}

function initializeFavorites() {
  favoritesSelect.replaceChildren(...favoriteLists.map((list) => {
    const option = document.createElement('option');
    option.value = list.id;
    option.textContent = list.name;
    return option;
  }));
  playlistSourceRow.hidden = favoriteLists.length < 2;
  const savedListId = readStoredValue(favoritesStorageKey);
  renderFavoritesList(favoriteLists.some((list) => list.id === savedListId) ? savedListId : favoriteLists[0].id);
}

function setYouTubeAccount(accountName) {
  const normalizedName = String(accountName || '').trim();
  if (!normalizedName) return;

  writeStoredValue(youtubeAccountStorageKey, normalizedName);
  youtubeLoginButton.textContent = `${normalizedName} ErAudio`;
  youtubeLoginButton.dataset.tooltip = `Signed in as ${normalizedName}`;
  youtubeLoginButton.setAttribute('aria-label', `YouTube account: ${normalizedName}`);
}

function parseIsoDuration(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value || '');
  if (!match) return '00:00';
  const totalSeconds = (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

async function youtubeApi(path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${youtubeAccessToken}` } });
  if (!response.ok) throw new Error(`YouTube API ${path} failed (${response.status})`);
  return response.json();
}

async function fetchAllPages(path, params) {
  const items = [];
  let pageToken = '';
  do {
    const page = await youtubeApi(path, pageToken ? { ...params, pageToken } : params);
    items.push(...page.items);
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return items;
}

async function loadPlaylistTracks(list) {
  if (list.loaded || !list.playlistId) return;
  const entries = await fetchAllPages('playlistItems', {
    part: 'snippet,contentDetails',
    playlistId: list.playlistId,
    maxResults: '50',
  });
  const playable = entries.filter((entry) => entry.contentDetails?.videoId
    && !['Private video', 'Deleted video'].includes(entry.snippet?.title));
  const durations = new Map();
  for (let start = 0; start < playable.length; start += 50) {
    const ids = playable.slice(start, start + 50).map((entry) => entry.contentDetails.videoId);
    const videos = await youtubeApi('videos', { part: 'contentDetails', id: ids.join(','), maxResults: '50' });
    videos.items.forEach((video) => durations.set(video.id, parseIsoDuration(video.contentDetails.duration)));
  }
  list.tracks = playable.map((entry) => ({
    title: entry.snippet.title,
    videoId: entry.contentDetails.videoId,
    duration: durations.get(entry.contentDetails.videoId) || '00:00',
  }));
  list.loaded = true;
}

async function selectFavoritesList(listId) {
  const list = favoriteLists.find((candidate) => candidate.id === listId) || favoriteLists[0];
  try {
    await loadPlaylistTracks(list);
  } catch (error) {
    announceEvent({ type: 'error', name: error.message });
  }
  renderFavoritesList(list.id);
}

async function loadAccountPlaylists() {
  const channels = await youtubeApi('channels', { part: 'snippet,contentDetails', mine: 'true' });
  const channel = channels.items?.[0];
  if (!channel) throw new Error('No YouTube channel found for this account.');
  setYouTubeAccount(channel.snippet.title);

  const playlists = await fetchAllPages('playlists', { part: 'snippet', mine: 'true', maxResults: '50' });
  const accountLists = [];
  const related = channel.contentDetails.relatedPlaylists;
  const addedTracks = favoriteLists.flatMap((list) => list.tracks.filter((track) => track.added));
  if (related.likes) accountLists.push({ id: related.likes, playlistId: related.likes, name: 'Liked videos', tracks: [] });
  playlists.forEach((playlist) => {
    accountLists.push({ id: playlist.id, playlistId: playlist.id, name: playlist.snippet.title, tracks: [] });
  });
  if (addedTracks.length) accountLists.push({ id: 'added-videos', name: 'Added videos', tracks: addedTracks, loaded: true });
  if (!accountLists.length) return;

  favoriteLists.splice(0, favoriteLists.length, ...accountLists);
  playingList = favoriteLists.find((list) => list.tracks.includes(playingTrack)) || playingList;
  favoritesSelect.replaceChildren(...favoriteLists.map((list) => {
    const option = document.createElement('option');
    option.value = list.id;
    option.textContent = list.name;
    return option;
  }));
  playlistSourceRow.hidden = false;
  await selectFavoritesList(favoriteLists[0].id);
}

let tokenClient = null;
let silentAttempt = false;

function getTokenClient() {
  if (tokenClient) return tokenClient;
  if (!googleClientId || !window.google?.accounts?.oauth2) return null;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: googleClientId,
    scope: youtubeScope,
    callback: async (tokenResponse) => {
      const wasSilent = silentAttempt;
      silentAttempt = false;
      if (tokenResponse.error) {
        if (!wasSilent) announceEvent({ type: 'error', name: tokenResponse.error });
        return;
      }
      youtubeAccessToken = tokenResponse.access_token;
      try {
        await loadAccountPlaylists();
      } catch (error) {
        announceEvent({ type: 'error', name: error.message });
      }
    },
    error_callback: (error) => {
      const wasSilent = silentAttempt;
      silentAttempt = false;
      if (!wasSilent) announceEvent({ type: 'error', name: error.message || error.type });
    },
  });
  return tokenClient;
}

// Reuses the browser's existing Google session: with prior consent this signs in
// without any UI; otherwise Google shows a one-click account chooser.
function requestYouTubeLogin({ silent = false } = {}) {
  if (!silent) {
    document.dispatchEvent(new CustomEvent('eraudio:youtube-login-request'));
    announceEvent({ type: 'login', name: 'YouTube' });
  }

  if (!googleClientId) {
    if (!silent) announceEvent({ type: 'error', name: 'Set googleClientId in config.js to enable YouTube sign-in' });
    return;
  }
  const client = getTokenClient();
  if (!client) {
    if (!silent) announceEvent({ type: 'error', name: 'Google sign-in script failed to load' });
    return;
  }

  silentAttempt = silent;
  client.requestAccessToken({ prompt: silent ? 'none' : '' });
}

function trySilentLogin(attemptsLeft = 20) {
  if (!googleClientId) return;
  if (window.google?.accounts?.oauth2) {
    requestYouTubeLogin({ silent: true });
  } else if (attemptsLeft > 0) {
    setTimeout(() => trySilentLogin(attemptsLeft - 1), 250);
  }
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateNowPlaying() {
  if (!playingTrack) {
    trackTitleDisplay.textContent = idleTitle;
    return;
  }
  const index = (playingList?.tracks || []).indexOf(playingTrack);
  trackTitleDisplay.textContent = `${index >= 0 ? `${index + 1}. ` : ''}${playingTrack.title}`;
}

function applyControl(name, value) {
  if (!ytReady) return;
  if (name === 'volume') ytPlayer.setVolume(Number(value));
  if (name === 'speed') ytPlayer.setPlaybackRate(Number(value));
}

function resetTransportDisplay() {
  timeDisplay.textContent = '00:00';
  controls.scrubber.value = 0;
}

function playTrack(list, track) {
  playingList = list;
  playingTrack = track;
  updateNowPlaying();
  resetTransportDisplay();
  if (ytReady) ytPlayer.loadVideoById(track.videoId);
  if (currentListId === list.id) renderFavoritesList(list.id);
}

// Makes the track active; keeps playing if already playing, otherwise just cues it.
function loadTrackIntoPlayer(list, track) {
  if (track === playingTrack) return;
  const wasPlaying = ytReady && playingTrack
    && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
  if (wasPlaying) {
    playTrack(list, track);
    return;
  }
  playingList = list;
  playingTrack = track;
  updateNowPlaying();
  resetTransportDisplay();
  if (ytReady) ytPlayer.cueVideoById(track.videoId);
  if (currentListId === list.id) renderFavoritesList(list.id);
}

function stopPlayback() {
  if (ytReady) ytPlayer.stopVideo();
  resetTransportDisplay();
}

function stepTrack(step, { wrap = true } = {}) {
  const tracks = playingList?.tracks || [];
  const index = tracks.indexOf(playingTrack);
  if (index < 0 || !tracks.length) return false;
  let nextIndex = index + step;
  if (nextIndex < 0 || nextIndex >= tracks.length) {
    if (!wrap) return false;
    nextIndex = (nextIndex + tracks.length) % tracks.length;
  }
  playTrack(playingList, tracks[nextIndex]);
  return true;
}

function startPlayback() {
  if (playingTrack) {
    if (ytReady) ytPlayer.playVideo();
    return;
  }
  const list = currentList();
  const track = list.tracks.find((candidate) => candidate.selected) || list.tracks[0];
  if (track) {
    playTrack(list, track);
  } else {
    showInputDialog('open');
  }
}

// Single place that applies a resolved video title to the playlist and now-playing display.
function setTrackTitle(track, title) {
  if (!track || !title || track.title === title) return;
  track.title = title;
  if (track === playingTrack) updateNowPlaying();
  renderFavoritesList(currentListId);
}

function onPlayerStateChange(event) {
  if (!playingTrack) return;
  if (event.data === YT.PlayerState.PLAYING) {
    applyControl('speed', controls.speed.value);
    const duration = ytPlayer.getDuration();
    if (duration > 0 && playingTrack.duration === '--:--') {
      playingTrack.duration = formatClock(duration);
      if (currentListId === playingList?.id) renderFavoritesList(currentListId);
    }
    setTrackTitle(playingTrack, ytPlayer.getVideoData?.().title);
  } else if (event.data === YT.PlayerState.ENDED) {
    if (!stepTrack(1, { wrap: false })) resetTransportDisplay();
  }
}

function onPlayerError() {
  announceEvent({ type: 'error', name: 'This video cannot be played (it may be private or not embeddable)' });
  trackTitleDisplay.textContent = `Unable to play: ${playingTrack?.title || 'video'}`;
}

function initYouTubePlayer() {
  window.onYouTubeIframeAPIReady = () => {
    ytPlayer = new YT.Player('yt-player', {
      width: '1',
      height: '1',
      playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
      events: {
        onReady: () => {
          ytReady = true;
          ytPlayer.setVolume(Number(controls.volume.value));
          if (playingTrack) ytPlayer.loadVideoById(playingTrack.videoId);
        },
        onStateChange: onPlayerStateChange,
        onError: onPlayerError,
      },
    });
  };
  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(script);

  setInterval(() => {
    if (!ytReady || !playingTrack) return;
    const state = ytPlayer.getPlayerState();
    if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.PAUSED) return;
    const duration = ytPlayer.getDuration();
    const position = ytPlayer.getCurrentTime();
    if (scrubbing) return;
    timeDisplay.textContent = formatClock(position);
    if (duration > 0) controls.scrubber.value = (position / duration) * 100;
  }, 250);
}

function addTrack(videoId) {
  const list = currentList();
  let track = list.tracks.find((candidate) => candidate.videoId === videoId);
  if (!track) {
    track = { title: `YouTube video ${videoId}`, videoId, duration: '--:--', added: true };
    list.tracks.push(track);
    renderFavoritesList(list.id);
  }
  if (track.title === `YouTube video ${videoId}`) resolveTrackTitle(track);
  return { list, track };
}

async function resolveTrackTitle(track) {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${track.videoId}`)}`);
    if (!response.ok) return;
    const title = (await response.json()).title;
    if (!title) return;
    setTrackTitle(track, title);
  } catch {
    // Best effort; the player supplies the title once playback starts.
  }
}

function showInputDialog(mode) {
  openDialog.dataset.mode = mode;
  openDialogTitle.textContent = mode === 'add' ? 'ADD URL TO PLAYLIST' : 'OPEN YOUTUBE VIDEO';
  youtubeInput.value = '';
  youtubeInputError.textContent = '';
  youtubeInput.removeAttribute('aria-invalid');
  openDialog.showModal();
  youtubeInput.focus();
}

function formatValue(controlName, value) {
  if (controlName === 'speed') return `${Number(value).toFixed(3)}x`;
  return value;
}

function announceEvent(detail) {
  const event = new CustomEvent('eraudio:control', { detail });
  document.dispatchEvent(event);
  eventStatus.textContent = `Event: ${detail.type} (${detail.name})`;
}

function updateControl(controlName, value) {
  const control = controls[controlName];
  if (!control) return;

  control.value = value;
  applyControl(controlName, value);
  if (valueDisplays[controlName]) {
    valueDisplays[controlName].textContent = formatValue(controlName, value);
  }
  announceEvent({ type: 'input', name: controlName, value: control.value });
}

document.querySelectorAll('[data-control]').forEach((control) => {
  control.addEventListener('input', () => {
    const controlName = control.dataset.control;
    if (controlName === 'scrubber') {
      scrubbing = true;
      const duration = ytReady ? ytPlayer.getDuration() : 0;
      timeDisplay.textContent = formatClock((Number(control.value) / 100) * duration);
    } else {
      applyControl(controlName, control.value);
    }
    if (valueDisplays[controlName]) {
      valueDisplays[controlName].textContent = formatValue(controlName, control.value);
    }
    announceEvent({ type: 'input', name: controlName, value: control.value });
  });

  control.addEventListener('change', () => {
    if (control.dataset.control === 'scrubber') {
      scrubbing = false;
      if (ytReady && playingTrack) ytPlayer.seekTo((Number(control.value) / 100) * ytPlayer.getDuration(), true);
    }
    announceEvent({ type: 'change', name: control.dataset.control, value: control.value });
  });
});

favoritesSelect.addEventListener('change', () => {
  selectFavoritesList(favoritesSelect.value);
});

youtubeLoginButton.addEventListener('click', () => requestYouTubeLogin());
trySilentLogin();

document.addEventListener('eraudio:youtube-authenticated', (event) => {
  setYouTubeAccount(event.detail?.accountName);
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  if (button.dataset.speed) {
    document.querySelectorAll('[data-speed]').forEach((preset) => preset.classList.remove('active'));
    button.classList.add('active');
    updateControl('speed', button.dataset.speed);
  }

  if (button.dataset.track) {
    const tracks = currentList().tracks;
    const track = tracks[Number(button.dataset.track) - 1];
    if (track) {
      // Ctrl/Cmd-click toggles one track; a plain click selects only that track.
      if (event.ctrlKey || event.metaKey) {
        track.selected = !track.selected;
      } else {
        tracks.forEach((candidate) => { candidate.selected = candidate === track; });
        loadTrackIntoPlayer(currentList(), track);
      }
      document.querySelectorAll('[data-track]').forEach((item) => {
        const itemTrack = tracks[Number(item.dataset.track) - 1];
        item.classList.toggle('selected', Boolean(itemTrack?.selected));
        item.setAttribute('aria-pressed', String(Boolean(itemTrack?.selected)));
      });
    }
  }

  if (button.dataset.action === 'select-all') {
    const tracks = currentList().tracks;
    const allSelected = tracks.length > 0 && tracks.every((track) => track.selected);
    tracks.forEach((track) => { track.selected = !allSelected; });
    renderFavoritesList(currentListId);
  }

  if (button.dataset.action === 'remove-track') {
    const list = currentList();
    if (list.tracks.some((track) => track.selected)) {
      if (playingTrack?.selected && list.tracks.includes(playingTrack)) {
        stopPlayback();
        playingTrack = null;
        playingList = null;
        updateNowPlaying();
      }
      list.tracks = list.tracks.filter((track) => !track.selected);
      renderFavoritesList(list.id);
      updateNowPlaying();
    }
  }

  if (button.dataset.action === 'add-url') showInputDialog('add');

  if (button.dataset.action === 'play') startPlayback();
  if (button.dataset.action === 'pause' && ytReady && playingTrack) ytPlayer.pauseVideo();
  if (button.dataset.action === 'stop') stopPlayback();
  if (button.dataset.action === 'next') stepTrack(1);
  if (button.dataset.action === 'previous') stepTrack(-1);

  if (button.dataset.action?.startsWith('toggle-')) {
    const isActive = button.classList.toggle('active');
    button.setAttribute('aria-pressed', String(isActive));
    const targetId = button.dataset.action === 'toggle-playlist' ? 'playlist-window' : 'pitchfork-window';
    document.getElementById(targetId).hidden = !isActive;
  }

  if (button.dataset.action === 'open') showInputDialog('open');

  if (button.dataset.action === 'close-open-dialog') {
    openDialog.close();
  }

  announceEvent({
    type: 'click',
    name: button.dataset.action || button.dataset.track || button.textContent.trim(),
  });
});

playlistList.addEventListener('dblclick', (event) => {
  const item = event.target.closest('[data-track]');
  const list = currentList();
  const track = item && list.tracks[Number(item.dataset.track) - 1];
  if (track) playTrack(list, track);
});

openForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const parsedInput = parseYouTubeInput(youtubeInput.value);
    youtubeInputError.textContent = '';
    youtubeInput.removeAttribute('aria-invalid');
    openDialog.close();
    const { list, track } = addTrack(parsedInput.videoId);
    if (openDialog.dataset.mode !== 'add') playTrack(list, track);
    announceEvent({
      type: openDialog.dataset.mode === 'add' ? 'add-request' : 'open-request',
      name: parsedInput.videoId,
      videoId: parsedInput.videoId,
    });
  } catch (error) {
    youtubeInputError.textContent = error.message;
    youtubeInput.setAttribute('aria-invalid', 'true');
    youtubeInput.focus();
  }
});

document.querySelector('#btn-reset-all').addEventListener('click', () => {
  updateControl('speed', '1.00');
  document.querySelectorAll('[data-speed]').forEach((preset) => {
    preset.classList.toggle('active', preset.dataset.speed === '1.0');
  });
  announceEvent({ type: 'reset', name: 'playback speed' });
});

initializeFavorites();
initYouTubePlayer();
updateNowPlaying();
setYouTubeAccount(readStoredValue(youtubeAccountStorageKey));

// Application code can react here without coupling the controls to playback yet.
document.addEventListener('eraudio:control', (event) => {
  console.debug('ErAudio control event', event.detail);
});