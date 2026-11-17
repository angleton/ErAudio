const controls = {
  speed: document.querySelector('#speed-slider'),
  scrubber: document.querySelector('#scrubber'),
  volume: document.querySelector('#volume'),
};

const speedLimits = { min: 0.5, max: 1.5 };
const speedPositionLimit = 30000;

// Map each half separately so normal speed stays centered if the limits change.
function currentSpeedRate() {
  const position = Number(controls.speed.value);
  const span = position < 0 ? 1 - speedLimits.min : speedLimits.max - 1;
  return Number((1 + (position / speedPositionLimit) * span).toFixed(4));
}

function setSpeedRate(value) {
  const rate = Math.max(speedLimits.min, Math.min(speedLimits.max, Number(value)));
  const span = rate < 1 ? 1 - speedLimits.min : speedLimits.max - 1;
  controls.speed.value = String(Math.round(((rate - 1) / span) * speedPositionLimit));
  return currentSpeedRate();
}

function updateSpeedAccessibility(rate) {
  controls.speed.setAttribute('aria-valuetext', `${formatValue('speed', rate)} (${rate.toFixed(4)}x)`);
}

const valueDisplays = {
  speed: document.querySelector('#val-speed'),
};

const eventStatus = document.querySelector('#event-status');
const savedLocationsLayer = document.querySelector('#saved-locations');
const memoryMessage = document.querySelector('#memory-message');
const locationsToggle = document.querySelector('#toggle-locations');
const locationsPanel = document.querySelector('#locations-panel');
const locationsList = document.querySelector('#locations-list');
const removeLocationButton = document.querySelector('#remove-location');
const locationEditor = document.querySelector('#location-editor');
const locationTimeInput = document.querySelector('#location-time');
const locationEditError = document.querySelector('#location-edit-error');
const locationsFile = document.querySelector('#locations-file');
const nudgeMessage = document.querySelector('#nudge-message');
const savedLocationsStorageKey = 'eraudio:saved-locations';
const maxSavedLocations = 50;
const playlistSelect = document.querySelector('#playlist-select');
const playlistList = document.querySelector('#playlist-list');
const playlistInfo = document.querySelector('#playlist-info');
const addedTracksStorageKey = 'eraudio:added-tracks';
const defaultTrack = {
  title: 'Rooftop Party in the French Riviera | Settow',
  videoId: 'aXedWClewDU',
  duration: '--:--',
};
const youtubeLoginButton = document.querySelector('#youtube-login');
const youtubeLoginLabel = document.querySelector('#youtube-login-label');
const youtubeSettingsButton = document.querySelector('#youtube-settings');
const loginNotice = document.querySelector('#login-notice');
const loginNoticeMessage = document.querySelector('#login-notice-message');
const credentialsStorageKey = 'eraudio:youtube-credentials';
const credentialsDialog = document.querySelector('#credentials-dialog');
const credentialsForm = document.querySelector('#credentials-form');
const credentialsError = document.querySelector('#credentials-error');
const apiKeyInput = document.querySelector('#api-key-input');
const clientIdInput = document.querySelector('#client-id-input');
const openDialog = document.querySelector('#open-dialog');
const openForm = document.querySelector('#open-form');
const openDialogTitle = document.querySelector('#open-dialog-title');
const youtubeInput = document.querySelector('#youtube-input');
const youtubeInputError = document.querySelector('#youtube-input-error');
const fallbackStorage = new Map();
let googleClientId = '';
let youtubeApiKey = '';
let credentialsLoadError = '';
try {
  const savedCredentials = localStorage.getItem(credentialsStorageKey);
  if (savedCredentials !== null) {
    const parsed = JSON.parse(savedCredentials);
    if (!parsed || typeof parsed.googleClientId !== 'string' || typeof parsed.youtubeApiKey !== 'string') {
      throw new Error('Invalid stored credentials');
    }
    googleClientId = parsed.googleClientId;
    youtubeApiKey = parsed.youtubeApiKey;
  }
} catch {
  credentialsLoadError = 'Could not read YouTube settings from browser storage. Open API SETUP to check or replace them.';
}
const youtubeScope = 'https://www.googleapis.com/auth/youtube.readonly';
let youtubeAccessToken = '';
let youtubeAuthGeneration = 0;

const favoriteLists = [
  {
    id: 'favorites',
    name: 'Local videos',
    tracks: [defaultTrack],
  },
];

const trackTitleDisplay = document.querySelector('#track-title');
const playButton = document.querySelector('.main-window [data-action="play"]');
const playbackIndicator = document.querySelector('#playback-indicator');
const pauseButtons = document.querySelectorAll('[data-action="pause"]');
const markerList = document.querySelector('#marker-list');
const markerInfo = document.querySelector('#marker-info');
const markerSourceToggle = document.querySelector('#marker-source-toggle');
const markerViewToggle = document.querySelector('#marker-view-toggle');
const timeDisplay = document.querySelector('#time-display');
const idleTitle = 'ErAudio - press ⏏ to open a YouTube video';
let ytPlayer = null;
let ytReady = false;
let playingTrack = defaultTrack;
let playingList = favoriteLists[0];
let scrubbing = false;
let savedLocations = new Map();
let savedLocationsReadError = false;
let savedLocationsRenderKey = '';
let locationsListRenderKey = '';
let selectedLocation = null;
let editingLocation = null;
let lastLocationClick = null;
let nudgePreview = null;

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
  saveAddedTracks();
  announceEvent({ type: 'playlist', name: selectedList.name });
}

function saveAddedTracks() {
  const added = favoriteLists.flatMap((list) => list.tracks.filter((track) => track.added));
  writeStoredValue(addedTracksStorageKey, JSON.stringify(added.map(({ title, videoId, duration }) => (
    { title, videoId, duration }
  ))));
}

function restoreAddedTracks() {
  try {
    const saved = JSON.parse(readStoredValue(addedTracksStorageKey) || '[]');
    const seen = new Set(favoriteLists.flatMap((list) => list.tracks.map((track) => track.videoId)));
    saved.forEach((entry) => {
      if (typeof entry?.videoId !== 'string' || seen.has(entry.videoId)) return;
      seen.add(entry.videoId);
      favoriteLists[0].tracks.push({
        title: String(entry.title || `YouTube video ${entry.videoId}`),
        videoId: entry.videoId,
        duration: String(entry.duration || '--:--'),
        added: true,
      });
    });
  } catch {
    // Ignore corrupt saved data.
  }
}

function initializeFavorites() {
  restoreAddedTracks();
  renderFavoritesList(favoriteLists[0].id);
}

function setYouTubeAccount(accountName) {
  const normalizedName = String(accountName || '').trim();
  if (!youtubeAccessToken || !normalizedName) return;

  youtubeLoginLabel.textContent = normalizedName;
  youtubeLoginButton.dataset.tooltip = `Signed in as ${normalizedName}`;
  youtubeLoginButton.setAttribute('aria-label', `YouTube account: ${normalizedName}`);
}

function parseIsoDurationSeconds(value) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value || '');
  if (!match || !match.slice(1).some(Boolean)) return null;
  const totalSeconds = (Number(match[1] || 0) * 86400) + (Number(match[2] || 0) * 3600)
    + (Number(match[3] || 0) * 60) + Number(match[4] || 0);
  return Number.isSafeInteger(totalSeconds) && totalSeconds > 0 ? totalSeconds : null;
}

async function youtubeApi(path, params, { apiKey = '' } = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  if (apiKey) url.searchParams.set('key', apiKey);
  const headers = apiKey ? {} : { Authorization: `Bearer ${youtubeAccessToken}` };
  const response = await fetch(url, { headers });
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

function setPlaylistPlaceholder(message) {
  playlistSelect.replaceChildren(new Option(message, ''));
  playlistSelect.disabled = true;
}

async function loadAccountPlaylists(generation) {
  setPlaylistPlaceholder('Loading playlists...');
  const channels = await youtubeApi('channels', { part: 'snippet', mine: 'true' });
  if (generation !== youtubeAuthGeneration) return;
  const channel = channels.items?.[0];
  if (!channel) throw new Error('No YouTube channel found for this account.');
  setYouTubeAccount(channel.snippet.title);

  const playlists = await fetchAllPages('playlists', { part: 'snippet', mine: 'true', maxResults: '50' });
  if (generation !== youtubeAuthGeneration) return;
  if (!playlists.length) {
    setPlaylistPlaceholder('No playlists found');
    return;
  }
  const placeholder = new Option('Select a playlist', '', true, true);
  placeholder.disabled = true;
  playlistSelect.replaceChildren(placeholder, ...playlists.map((playlist) => (
    new Option(playlist.snippet.title, playlist.id)
  )));
  playlistSelect.disabled = false;
}

let tokenClient = null;
let silentAttempt = false;

function showLoginError(message) {
  loginNoticeMessage.textContent = message;
  loginNotice.hidden = false;
  announceEvent({ type: 'error', name: message });
}

function getTokenClient() {
  if (tokenClient) return tokenClient;
  if (!googleClientId || !window.google?.accounts?.oauth2) return null;

  const generation = youtubeAuthGeneration;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: googleClientId,
    scope: youtubeScope,
    callback: async (tokenResponse) => {
      if (generation !== youtubeAuthGeneration) return;
      const wasSilent = silentAttempt;
      silentAttempt = false;
      if (tokenResponse.error) {
        if (!wasSilent) showLoginError(`YouTube sign-in failed: ${tokenResponse.error}. Try again or check the setup instructions.`);
        return;
      }
      loginNotice.hidden = true;
      youtubeAccessToken = tokenResponse.access_token;
      ensureMarkers(playingTrack);
      try {
        await loadAccountPlaylists(generation);
      } catch (error) {
        if (generation !== youtubeAuthGeneration) return;
        setPlaylistPlaceholder('Could not load playlists');
        showLoginError(`Could not load YouTube playlists: ${error.message}`);
      }
    },
    error_callback: (error) => {
      if (generation !== youtubeAuthGeneration) return;
      const wasSilent = silentAttempt;
      silentAttempt = false;
      if (!wasSilent) showLoginError(`YouTube sign-in failed: ${error.message || error.type}. Try again or check the setup instructions.`);
    },
  });
  return tokenClient;
}

// Reuses the browser's existing Google session: with prior consent this signs in
// without any UI; otherwise Google shows a one-click account chooser.
function requestYouTubeLogin({ silent = false } = {}) {
  if (!silent) {
    loginNotice.hidden = true;
    document.dispatchEvent(new CustomEvent('eraudio:youtube-login-request'));
    announceEvent({ type: 'login', name: 'YouTube' });
  }

  if (location.protocol === 'file:') {
    if (!silent) showLoginError('YouTube sign-in cannot run from a local file. Use the hosted player or serve ErAudio over HTTP with a configured Google OAuth client ID.');
    return;
  }
  if (!googleClientId) {
    if (!silent) showCredentialsDialog('login');
    return;
  }
  const client = getTokenClient();
  if (!client) {
    if (!silent) showLoginError('Google sign-in could not load. Check your connection or browser blockers, then try again.');
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

function showCredentialsDialog(purpose = 'settings') {
  if (credentialsDialog.open) return;
  credentialsDialog.dataset.purpose = purpose;
  apiKeyInput.value = youtubeApiKey;
  clientIdInput.value = googleClientId;
  credentialsError.textContent = '';
  credentialsDialog.showModal();
  (purpose === 'login' ? clientIdInput : apiKeyInput).focus();
}

function resetAccountSession() {
  youtubeAuthGeneration += 1;
  tokenClient = null;
  silentAttempt = false;
  youtubeAccessToken = '';
  youtubeLoginLabel.textContent = 'YOUTUBE LOGIN';
  youtubeLoginButton.dataset.tooltip = 'Sign in to YouTube';
  youtubeLoginButton.setAttribute('aria-label', 'Sign in to YouTube');
  setPlaylistPlaceholder('Sign in to load playlists');
}

youtubeSettingsButton.addEventListener('click', () => showCredentialsDialog());
document.querySelector('#credentials-cancel').addEventListener('click', () => credentialsDialog.close());
credentialsDialog.addEventListener('close', () => {
  apiKeyInput.value = '';
  clientIdInput.value = '';
});
credentialsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const nextApiKey = apiKeyInput.value.trim();
  const nextClientId = clientIdInput.value.trim();
  if (nextClientId && !/^[^\s]+\.apps\.googleusercontent\.com$/.test(nextClientId)) {
    credentialsError.textContent = 'Enter a Google OAuth client ID ending in .apps.googleusercontent.com, not a client secret.';
    clientIdInput.focus();
    return;
  }
  if (nextApiKey.startsWith('GOCSPX-')) {
    credentialsError.textContent = 'Enter a YouTube Data API key, not an OAuth client secret.';
    apiKeyInput.focus();
    return;
  }
  if (credentialsDialog.dataset.purpose === 'login' && !nextClientId) {
    credentialsError.textContent = 'Enter a Google OAuth client ID to sign in, or cancel.';
    clientIdInput.focus();
    return;
  }
  try {
    if (nextApiKey || nextClientId) {
      localStorage.setItem(credentialsStorageKey, JSON.stringify({ youtubeApiKey: nextApiKey, googleClientId: nextClientId }));
    } else {
      localStorage.removeItem(credentialsStorageKey);
    }
  } catch {
    credentialsError.textContent = 'Could not save YouTube settings in browser storage. No settings were changed.';
    return;
  }
  const clientChanged = nextClientId !== googleClientId;
  const apiKeyChanged = nextApiKey !== youtubeApiKey;
  googleClientId = nextClientId;
  youtubeApiKey = nextApiKey;
  if (clientChanged) resetAccountSession();
  const purpose = credentialsDialog.dataset.purpose;
  credentialsDialog.close();
  loginNotice.hidden = true;
  if (apiKeyChanged || clientChanged) {
    if (playingTrack) delete playingTrack.markerError;
    renderMarkers();
    ensureMarkers(playingTrack);
  }
  if (purpose === 'login') requestYouTubeLogin();
});

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateNowPlaying() {
  renderMarkers();
  renderSavedLocations();
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
  updatePlayButton(false);
}

function updatePlayButton(isPlaying) {
  playButton.textContent = isPlaying ? '⏸' : '▶';
  playButton.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  playButton.classList.toggle('playing', isPlaying);
  playButton.classList.toggle('pulsing', isPlaying);
  playbackIndicator.hidden = !isPlaying;
}

function parseClockToSeconds(value) {
  return value.split(':').map(Number).reduce((total, part) => (total * 60) + part, 0);
}

function parseDescriptionMarkers(description, duration) {
  const timestampPattern = /(?:^|[\s(\[])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=$|[\s)\]\-–—:.,|])/;
  const trimPattern = /^[\s\-–—:.,|()[\]]+|[\s\-–—:.,|()[\]]+$/g;
  const timestamps = [];
  const groups = [];
  let group = [];
  String(description || '').split(/\r?\n/).forEach((line) => {
    const match = timestampPattern.exec(line);
    if (!match) {
      if (group.length) groups.push(group);
      group = [];
      return;
    }
    const parts = match[1].split(':').map(Number);
    if (parts[parts.length - 1] >= 60 || (parts.length === 3 && parts[1] >= 60)) {
      if (group.length) groups.push(group);
      group = [];
      return;
    }
    const start = parseClockToSeconds(match[1]);
    const title = line.replace(match[1], '').replace(trimPattern, '');
    const entry = { start, title };
    timestamps.push(entry);
    group.push(entry);
  });
  if (group.length) groups.push(group);
  timestamps.sort((a, b) => a.start - b.start);
  timestamps.forEach((entry, index) => { entry.title ||= `Part ${index + 1}`; });

  const chapters = duration ? groups.map((entries) => entries.filter((entry) => entry.start < duration))
    .find((entries) => entries.length >= 3 && entries[0].start === 0
      && entries.every((entry, index) => index === 0 || entry.start - entries[index - 1].start >= 10)
      && duration - entries[entries.length - 1].start >= 10) || [] : [];
  return { chapters, timestamps, duration };
}

let markerRenderKey = '';
let activeMarkerIndex = -1;
let markerSource = 'video';

function currentMarkerEntries() {
  if (markerSource === 'user') {
    if (savedLocationsReadError) return [];
    return (savedLocations.get(playingTrack?.videoId) || [])
      .map((start, locationIndex) => ({ start, locationIndex }))
      .sort((a, b) => a.start - b.start || a.locationIndex - b.locationIndex);
  }
  const markers = playingTrack?.markers;
  if (!markers) return [];
  return playingTrack.markerView === 'timestamps' || !markers.chapters.length
    ? markers.timestamps : markers.chapters;
}

function renderMarkers() {
  const markers = playingTrack?.markers;
  const state = markers ? 'ready' : playingTrack?.markersLoading ? 'loading'
    : playingTrack?.markerError ? 'error' : (youtubeApiKey || youtubeAccessToken) ? 'loading'
      : googleClientId ? 'signin' : 'setup';
  const key = JSON.stringify([playingTrack?.videoId, markerSource, state, playingTrack?.markerView,
    markerSource === 'user' ? savedLocations.get(playingTrack?.videoId) : null, savedLocationsReadError]);
  if (key === markerRenderKey) return;
  markerRenderKey = key;
  activeMarkerIndex = -1;
  markerViewToggle.hidden = true;
  markerSourceToggle.textContent = markerSource === 'user' ? 'SHOW VIDEO MARKERS' : 'SHOW MY LOCATIONS';
  markerList.setAttribute('aria-label', markerSource === 'user'
    ? 'Saved locations of the active video' : 'Chapters and timestamps of the active video');

  const placeholder = (text) => {
    const empty = document.createElement('div');
    empty.className = 'playlist-empty';
    empty.textContent = text;
    markerList.replaceChildren(empty);
  };

  if (!playingTrack) {
    placeholder('Open a video to see its markers.');
    markerInfo.textContent = 'NO VIDEO';
  } else if (markerSource === 'user') {
    const entries = currentMarkerEntries();
    if (savedLocationsReadError) {
      placeholder('Could not read saved locations from browser storage.');
      markerInfo.textContent = 'STORAGE ERROR';
    } else if (!entries.length) {
      placeholder('No saved locations for this video. Press M+ to add one.');
      markerInfo.textContent = 'MY LOCATIONS / 0 ENTRIES';
    } else {
      markerList.replaceChildren(...entries.map((entry, index) => {
        const item = document.createElement('button');
        item.className = 'playlist-item';
        item.type = 'button';
        item.dataset.marker = String(index);
        item.dataset.userLocation = String(entry.locationIndex);
        item.textContent = `${index + 1}. [${formatLocationTime(entry.start)}]`;
        item.setAttribute('aria-label', `Seek to saved location ${formatLocationTime(entry.start)}`);
        return item;
      }));
      markerInfo.textContent = `MY LOCATIONS / ${entries.length} ENTRIES`;
    }
  } else if (state === 'error') {
    placeholder(playingTrack.markerError);
    markerInfo.textContent = 'ERROR';
  } else if (!markers) {
    placeholder(state === 'loading' ? 'Looking for chapters / timestamps...'
      : state === 'signin' ? 'Sign in to YouTube to detect chapters / timestamps.'
        : 'Use API SETUP to enter a YouTube API key or sign in to detect chapters / timestamps.');
    markerInfo.textContent = state === 'loading' ? 'LOADING' : state === 'signin' ? 'SIGN IN REQUIRED' : 'SETUP REQUIRED';
  } else if (!markers.timestamps.length) {
    placeholder('No chapters or timestamps found in this video\'s description.');
    markerInfo.textContent = 'NONE FOUND';
  } else {
    const entries = currentMarkerEntries();
    const sameEntries = markers.chapters.length === markers.timestamps.length
      && markers.chapters.every((entry, index) => entry === markers.timestamps[index]);
    const showingChapters = entries === markers.chapters;
    if (markers.chapters.length && !sameEntries) {
      markerViewToggle.hidden = false;
      markerViewToggle.textContent = showingChapters ? 'SHOW TIMESTAMPS' : 'SHOW CHAPTERS';
      markerViewToggle.setAttribute('aria-label', showingChapters ? 'Show description timestamps' : 'Show inferred chapters');
    }
    markerList.replaceChildren(...entries.map((entry, index) => {
      const item = document.createElement('button');
      item.className = 'playlist-item';
      item.type = 'button';
      item.dataset.marker = String(index);
      item.textContent = `${index + 1}. [${formatClock(entry.start)}] ${entry.title}`;
      if (markers.duration && entry.start >= markers.duration) {
        item.textContent = `${index + 1}. [${formatClock(entry.start)}] [OUT OF RANGE] ${entry.title}`;
        item.disabled = true;
        item.title = 'This timestamp is beyond the video duration and cannot be played.';
        item.setAttribute('aria-label', `${item.textContent}. Beyond video duration; cannot be played.`);
      }
      return item;
    }));
    const label = sameEntries && showingChapters ? 'INFERRED CHAPTERS & TIMESTAMPS'
      : showingChapters ? 'INFERRED CHAPTERS' : 'TIMESTAMPS';
    markerInfo.textContent = `${label} / ${entries.length} ENTRIES${markers.duration ? '' : ' / CHAPTERS UNAVAILABLE'}`;
  }
}

async function ensureMarkers(track) {
  if (!track || track.markers || track.markersLoading || (!youtubeAccessToken && !youtubeApiKey)) return;
  const accessToken = youtubeAccessToken;
  const apiKey = youtubeApiKey;
  let retryWithCredentials = false;
  track.markersLoading = true;
  delete track.markerError;
  if (track === playingTrack) renderMarkers();
  try {
    const data = await youtubeApi('videos', { part: 'snippet,contentDetails', id: track.videoId }, {
      apiKey: accessToken ? '' : apiKey,
    });
    if (accessToken !== youtubeAccessToken || (!accessToken && apiKey !== youtubeApiKey)) {
      retryWithCredentials = true;
      return;
    }
    const description = data.items?.[0]?.snippet?.description;
    if (typeof description !== 'string') throw new Error('Video description unavailable');
    const duration = parseIsoDurationSeconds(data.items[0].contentDetails?.duration);
    track.markers = parseDescriptionMarkers(description, duration);
  } catch {
    retryWithCredentials = accessToken !== youtubeAccessToken || (!accessToken && apiKey !== youtubeApiKey);
    if (!retryWithCredentials) {
      track.markerError = 'Could not load chapters / timestamps. Check the connection, API configuration, and video availability; reopen the video or reload to retry.';
      announceEvent({ type: 'error', name: track.markerError });
    }
  } finally {
    track.markersLoading = false;
    if (retryWithCredentials && (youtubeAccessToken || youtubeApiKey)) ensureMarkers(track);
    else if (track === playingTrack) renderMarkers();
  }
}

function highlightActiveMarker(position) {
  const entries = currentMarkerEntries();
  if (!entries.length) return;
  let index = -1;
  entries.forEach((entry, i) => { if (position >= entry.start) index = i; });
  if (index === activeMarkerIndex) return;
  activeMarkerIndex = index;
  markerList.querySelectorAll('[data-marker]').forEach((item) => {
    item.classList.toggle('active', Number(item.dataset.marker) === index);
  });
}

function seekToMarker(index) {
  const entry = currentMarkerEntries()[index];
  if (!entry || !ytReady || (playingTrack.markers.duration && entry.start >= playingTrack.markers.duration)) return;
  cancelNudgePreview(true);
  ytPlayer.seekTo(entry.start, true);
  ytPlayer.playVideo();
}

function playTrack(list, track) {
  cancelNudgePreview(true);
  if (track !== playingTrack) stopSpeedRamp();
  playingList = list;
  playingTrack = track;
  updateNowPlaying();
  ensureMarkers(track);
  resetTransportDisplay();
  if (ytReady) ytPlayer.loadVideoById(track.videoId);
  if (currentListId === list.id) renderFavoritesList(list.id);
}

// Makes the track active; keeps playing if already playing, otherwise just cues it.
function loadTrackIntoPlayer(list, track) {
  if (track === playingTrack) return;
  cancelNudgePreview(true);
  stopSpeedRamp();
  const wasPlaying = ytReady && playingTrack
    && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
  if (wasPlaying) {
    playTrack(list, track);
    return;
  }
  playingList = list;
  playingTrack = track;
  updateNowPlaying();
  ensureMarkers(track);
  resetTransportDisplay();
  if (ytReady) ytPlayer.cueVideoById(track.videoId);
  if (currentListId === list.id) renderFavoritesList(list.id);
}

function stopPlayback() {
  cancelNudgePreview(true);
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

function togglePlayback() {
  const wasPlaying = ytReady && playingTrack && !nudgePreview
    && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
  cancelNudgePreview(true);
  if (playingTrack) {
    if (ytReady) {
      if (wasPlaying) ytPlayer.pauseVideo();
      else ytPlayer.playVideo();
    }
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
  if (event.data !== YT.PlayerState.BUFFERING) {
    const isPlaying = event.data === YT.PlayerState.PLAYING;
    updatePlayButton(isPlaying);
  } else {
    playButton.classList.remove('pulsing');
    playbackIndicator.hidden = true;
  }
  pauseButtons.forEach((button) => {
    button.classList.toggle('paused', event.data === YT.PlayerState.PAUSED);
    button.setAttribute('aria-pressed', String(event.data === YT.PlayerState.PAUSED));
  });
  renderSavedLocations();
  if (!playingTrack) return;
  if (handleNudgeStateChange(event.data)) return;
  if (event.data === YT.PlayerState.PLAYING) {
    applyControl('speed', currentSpeedRate());
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
  updatePlayButton(false);
  if (nudgePreview) {
    cancelNudgePreview(true);
    nudgeError('The nudge preview failed because the video could not be played.');
  }
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
        onAutoplayBlocked: () => {
          if (!nudgePreview) return;
          cancelNudgePreview(true);
          nudgeError('The browser blocked the nudge preview. Check playback permissions and try again.');
        },
      },
    });
  };
  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(script);

  setInterval(() => {
    if (!ytReady || !playingTrack) return;
    renderSavedLocations();
    const state = ytPlayer.getPlayerState();
    if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.PAUSED) return;
    const duration = ytPlayer.getDuration();
    const position = ytPlayer.getCurrentTime();
    if (scrubbing) return;
    timeDisplay.textContent = formatClock(position);
    highlightActiveMarker(position);
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
  if (controlName === 'speed') return `${((Number(value) - 1) * 100).toFixed(2)}%`;
  return value;
}

function announceEvent(detail) {
  const event = new CustomEvent('eraudio:control', { detail });
  document.dispatchEvent(event);
  eventStatus.textContent = `Event: ${detail.type} (${detail.name})`;
}

// The player reports 0 until a video has loaded, so fall back to the track's known duration.
function currentDuration() {
  const playerDuration = ytReady ? ytPlayer.getDuration() : 0;
  if (playerDuration > 0) return playerDuration;
  const [minutes, seconds] = String(playingTrack?.duration || '').split(':').map(Number);
  return Number.isFinite(minutes) && Number.isFinite(seconds) ? (minutes * 60) + seconds : 0;
}

function memoryError(message, error) {
  memoryMessage.textContent = message;
  if (error) console.error(message, error);
  announceEvent({ type: 'error', name: message });
}

function parseSavedLocations(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid saved locations.');
  }
  const entries = Object.entries(data);
  if (entries.some(([videoId, locations]) => !/^[A-Za-z0-9_-]{11}$/.test(videoId)
    || !Array.isArray(locations) || locations.length > maxSavedLocations
    || locations.some((position) => typeof position !== 'number' || !Number.isFinite(position) || position < 0))) {
    throw new Error('Invalid saved locations.');
  }
  return new Map(entries);
}

function loadSavedLocations() {
  try {
    const raw = localStorage.getItem(savedLocationsStorageKey);
    savedLocations = parseSavedLocations(raw === null ? {} : JSON.parse(raw));
    savedLocationsReadError = false;
    return true;
  } catch (error) {
    savedLocationsReadError = true;
    memoryError('Could not read saved locations from browser storage. No locations were changed.', error);
    if (markerSource === 'user') renderMarkers();
    return false;
  }
}

function activeVideoDuration() {
  if (!ytReady || !playingTrack || ytPlayer.getVideoData?.()?.video_id !== playingTrack.videoId) return 0;
  const duration = ytPlayer.getDuration();
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function formatLocationTime(position) {
  const wholeSeconds = Math.floor(position);
  const milliseconds = Math.round((position - wholeSeconds) * 1000);
  return `${formatClock(wholeSeconds + Math.floor(milliseconds / 1000))}.${String(milliseconds % 1000).padStart(3, '0')}`;
}

function formatLocationEditTime(position) {
  const [mantissa, exponent = '0'] = String(position).split('e');
  const [integer, decimals = ''] = mantissa.split('.');
  const digits = integer + decimals;
  const split = integer.length + Number(exponent);
  const fraction = split <= 0 ? '0'.repeat(-split) + digits : digits.slice(split);
  return `${formatClock(Math.floor(position))}.${fraction.padEnd(3, '0')}`;
}

function updateSelectedLocation() {
  removeLocationButton.disabled = !selectedLocation;
  locationsList.querySelectorAll('[data-location-index]').forEach((item) => {
    item.setAttribute('aria-current', String(Number(item.dataset.locationIndex) === selectedLocation?.index));
  });
}

function renderSavedLocations() {
  const duration = activeVideoDuration();
  const locations = duration ? savedLocations.get(playingTrack.videoId) || [] : [];
  const key = JSON.stringify([playingTrack?.videoId, locations]);
  if (key !== savedLocationsRenderKey) {
    savedLocationsRenderKey = key;
    savedLocationsLayer.replaceChildren(...locations.map((position, index) => {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'saved-location';
      marker.dataset.savedLocation = String(index);
      marker.title = `Saved location ${index + 1}: ${formatClock(position)}`;
      marker.setAttribute('aria-label', `Seek to ${marker.title.toLowerCase()}`);
      return marker;
    }));
  }
  locations.forEach((position, index) => {
    savedLocationsLayer.children[index].style.left = `${Math.min(100, (position / duration) * 100)}%`;
  });

  const videoId = playingTrack?.videoId;
  const saved = savedLocations.get(videoId) || [];
  if (editingLocation && (editingLocation.videoId !== videoId
    || saved[editingLocation.index] !== editingLocation.position)) {
    const editorHasFocus = locationEditor.contains(document.activeElement);
    closeLocationEditor(false);
    if (editorHasFocus) locationsToggle.focus();
    memoryError('Saved locations changed; the unfinished edit was canceled.');
  }
  if (selectedLocation && (selectedLocation.videoId !== videoId
    || saved[selectedLocation.index] !== selectedLocation.position)) selectedLocation = null;
  const listKey = JSON.stringify([videoId, saved]);
  if (listKey !== locationsListRenderKey) {
    locationsListRenderKey = listKey;
    if (!saved.length) {
      const empty = document.createElement('p');
      empty.className = 'playlist-empty';
      empty.textContent = videoId ? 'NO SAVED LOCATIONS' : 'NO VIDEO';
      locationsList.replaceChildren(empty);
    } else {
      const entries = saved.map((position, index) => ({ position, index, time: formatLocationTime(position) }));
      const distinctByTime = new Map();
      entries.forEach(({ time, position }) => {
        if (!distinctByTime.has(time)) distinctByTime.set(time, new Set());
        distinctByTime.get(time).add(position);
      });
      entries.sort((a, b) => a.position - b.position || a.index - b.index);
      locationsList.replaceChildren(...entries.map(({ position, index, time }) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'locations-entry';
        item.dataset.locationIndex = String(index);
        item.textContent = distinctByTime.get(time).size > 1 ? `${time} (${position}s)` : time;
        item.setAttribute('aria-label', `Seek to saved location ${index + 1}: ${item.textContent}. Double-click or press F2 to edit.`);
        return item;
      }));
    }
    updateSelectedLocation();
  }
  if (markerSource === 'user') renderMarkers();
}

function addSavedLocation() {
  const duration = activeVideoDuration();
  const state = ytReady ? ytPlayer.getPlayerState() : null;
  if (!duration || (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.PAUSED)) {
    memoryError('Play or pause a loaded video with a known duration before saving a location.');
    return;
  }
  const position = ytPlayer.getCurrentTime();
  if (!Number.isFinite(position) || position < 0 || position > duration) {
    memoryError('The current playback position is unavailable. Try again.');
    return;
  }
  if (!loadSavedLocations()) return;
  renderSavedLocations();
  const locations = savedLocations.get(playingTrack.videoId) || [];
  if (locations.length >= maxSavedLocations) {
    memoryError('The maximum of 50 saved locations for this video has been reached.');
    return;
  }
  const updated = new Map(savedLocations);
  updated.set(playingTrack.videoId, [...locations, position]);
  try {
    localStorage.setItem(savedLocationsStorageKey, JSON.stringify(Object.fromEntries(updated)));
  } catch (error) {
    memoryError('Could not save the location in browser storage. No location was added.', error);
    return;
  }
  savedLocations = updated;
  memoryMessage.textContent = '';
  renderSavedLocations();
  announceEvent({ type: 'memory', name: 'saved location', videoId: playingTrack.videoId, value: position });
}

function clearSavedLocations() {
  try {
    localStorage.removeItem(savedLocationsStorageKey);
  } catch (error) {
    memoryError('Could not clear saved locations from browser storage.', error);
    return;
  }
  savedLocations.clear();
  savedLocationsReadError = false;
  memoryMessage.textContent = '';
  renderSavedLocations();
}

function removeSelectedLocation() {
  const selection = selectedLocation;
  if (!selection || !loadSavedLocations()) return;
  const locations = savedLocations.get(selection.videoId);
  if (selection.videoId !== playingTrack?.videoId || locations?.[selection.index] !== selection.position) {
    selectedLocation = null;
    renderSavedLocations();
    updateSelectedLocation();
    memoryError('The selected location has changed. Select a location and try again.');
    return;
  }
  const updated = new Map(savedLocations);
  const remaining = locations.filter((_, index) => index !== selection.index);
  if (remaining.length) updated.set(selection.videoId, remaining);
  else updated.delete(selection.videoId);
  try {
    localStorage.setItem(savedLocationsStorageKey, JSON.stringify(Object.fromEntries(updated)));
  } catch (error) {
    memoryError('Could not remove the location from browser storage. No location was removed.', error);
    return;
  }
  savedLocations = updated;
  selectedLocation = null;
  if (document.activeElement === removeLocationButton) document.querySelector('#close-locations').focus();
  renderSavedLocations();
  updateSelectedLocation();
  memoryMessage.textContent = `Removed saved location ${formatLocationTime(selection.position)}.`;
  announceEvent({ type: 'memory', name: 'removed location', videoId: selection.videoId, value: selection.position });
}

function locationsExportFilename(track) {
  const title = (track.title || '').replace(/[^\p{L}\p{M}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const encoder = new TextEncoder();
  let name = '';
  let bytes = 0;
  for (const character of title) {
    const size = encoder.encode(character).length;
    if (bytes + size > 180) break;
    name += character;
    bytes += size;
  }
  return `ErAudio - ${name.trim() || track.videoId}.json`;
}

document.querySelector('#export-locations').addEventListener('click', () => {
  if (!playingTrack?.videoId) {
    memoryError('Select a video before exporting saved locations.');
    return;
  }
  if (!loadSavedLocations()) return;
  renderSavedLocations();
  const locations = savedLocations.get(playingTrack.videoId);
  if (!locations?.length) {
    memoryError('There are no saved locations for the current video to export.');
    return;
  }
  const data = {
    format: 'ErAudio saved locations',
    version: 1,
    videos: { [playingTrack.videoId]: locations },
  };
  let url;
  try {
    url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = locationsExportFilename(playingTrack);
    link.click();
    memoryMessage.textContent = "Export started for the current video's saved locations.";
  } catch (error) {
    memoryError('Could not export saved locations.', error);
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});

document.querySelector('#import-locations').addEventListener('click', () => locationsFile.click());
locationsFile.addEventListener('change', async () => {
  const file = locationsFile.files[0];
  locationsFile.value = '';
  if (!file) return;

  let imported;
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.format !== 'ErAudio saved locations' || data.version !== 1) {
      throw new Error('Unrecognized saved locations file.');
    }
    imported = parseSavedLocations(data.videos);
  } catch (error) {
    memoryError('Could not read the locations file. No locations were changed.', error);
    return;
  }

  if (!loadSavedLocations()) return;
  const updated = new Map(savedLocations);
  let added = 0;
  for (const [videoId, locations] of imported) {
    const merged = [...(updated.get(videoId) || [])];
    for (const position of locations) {
      if (!merged.includes(position)) {
        merged.push(position);
        added++;
      }
    }
    if (merged.length > maxSavedLocations) {
      memoryError(`Import would exceed the 50-location limit for video ${videoId}. No locations were changed.`);
      return;
    }
    if (merged.length) updated.set(videoId, merged);
  }
  if (added) {
    try {
      localStorage.setItem(savedLocationsStorageKey, JSON.stringify(Object.fromEntries(updated)));
    } catch (error) {
      memoryError('Could not save imported locations in browser storage. No locations were changed.', error);
      return;
    }
    savedLocations = updated;
  }
  renderSavedLocations();
  memoryMessage.textContent = `Imported ${added} new saved location${added === 1 ? '' : 's'}.`;
  announceEvent({ type: 'memory', name: 'imported locations', value: added });
});

function recallSavedLocation(index, { allowUnavailableSelection = false } = {}) {
  const duration = activeVideoDuration();
  const position = savedLocations.get(playingTrack?.videoId)?.[index];
  if (!duration || !Number.isFinite(position) || position > duration) {
    if (allowUnavailableSelection && Number.isFinite(position)) {
      selectedLocation = { videoId: playingTrack.videoId, index, position };
      updateSelectedLocation();
    }
    memoryError('This saved location is not available for the current video.');
    return;
  }
  cancelNudgePreview(true);
  ytPlayer.seekTo(position, true);
  controls.scrubber.value = (position / duration) * 100;
  timeDisplay.textContent = formatClock(position);
  highlightActiveMarker(position);
  memoryMessage.textContent = '';
  selectedLocation = { videoId: playingTrack.videoId, index, position };
  updateSelectedLocation();
  announceEvent({ type: 'memory', name: 'recalled location', videoId: playingTrack.videoId, value: position });
}

function closeLocationEditor(restoreFocus) {
  const previous = editingLocation;
  editingLocation = null;
  locationEditor.hidden = true;
  locationEditError.textContent = '';
  locationTimeInput.removeAttribute('aria-invalid');
  if (restoreFocus && previous) {
    const item = locationsList.querySelector(`[data-location-index="${previous.index}"]`);
    (item || locationsToggle).focus();
  }
}

function openLocationEditor(index) {
  if (editingLocation) {
    if (editingLocation.index !== index) {
      locationEditError.textContent = 'Save or cancel the current edit first.';
    }
    locationTimeInput.focus();
    return;
  }
  const position = savedLocations.get(playingTrack?.videoId)?.[index];
  if (!Number.isFinite(position)) {
    memoryError('This saved location is no longer available.');
    return;
  }
  const initialValue = formatLocationEditTime(position);
  editingLocation = { videoId: playingTrack.videoId, index, position, initialValue };
  locationTimeInput.value = initialValue;
  locationEditError.textContent = '';
  locationTimeInput.removeAttribute('aria-invalid');
  locationEditor.hidden = false;
  locationTimeInput.focus();
  locationTimeInput.select();
}

function locationEditInvalid(message) {
  locationEditError.textContent = message;
  locationTimeInput.setAttribute('aria-invalid', 'true');
  locationTimeInput.focus();
}

function updateSavedLocation(selection, position) {
  if (!loadSavedLocations()) return false;
  const locations = savedLocations.get(selection.videoId);
  if (playingTrack?.videoId !== selection.videoId || locations?.[selection.index] !== selection.position) {
    renderSavedLocations();
    updateSelectedLocation();
    memoryError('The saved location changed. Select it and try again.');
    return false;
  }
  const updated = new Map(savedLocations);
  const editedLocations = [...locations];
  editedLocations[selection.index] = position;
  updated.set(selection.videoId, editedLocations);
  try {
    localStorage.setItem(savedLocationsStorageKey, JSON.stringify(Object.fromEntries(updated)));
  } catch (error) {
    memoryError('Could not update the location in browser storage. No location was changed.', error);
    return false;
  }
  savedLocations = updated;
  selectedLocation = { videoId: selection.videoId, index: selection.index, position };
  return true;
}

locationEditor.addEventListener('submit', (event) => {
  event.preventDefault();
  const edit = editingLocation;
  if (!edit) return;
  const value = locationTimeInput.value.trim();
  if (value === edit.initialValue) {
    closeLocationEditor(true);
    return;
  }
  const match = /^(\d+):([0-5]\d)(?:\.(\d+))?$/.exec(value);
  const wholeSeconds = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  const position = Number.isSafeInteger(wholeSeconds)
    ? Number(`${wholeSeconds}.${match[3] || '0'}`)
    : NaN;
  if (!Number.isFinite(position)) {
    locationEditInvalid('Enter a nonnegative time as MM:SS or MM:SS.sss.');
    return;
  }
  if (position === edit.position) {
    closeLocationEditor(true);
    return;
  }
  const duration = activeVideoDuration();
  if (!duration) {
    locationEditInvalid('Load the current video and wait for its duration before saving.');
    return;
  }
  if (position > duration) {
    locationEditInvalid('The location cannot be beyond the video duration.');
    return;
  }
  if (!updateSavedLocation(edit, position)) return;
  closeLocationEditor(false);
  renderSavedLocations();
  recallSavedLocation(edit.index);
  const item = locationsList.querySelector(`[data-location-index="${edit.index}"]`);
  if (item) item.focus();
  memoryMessage.textContent = `Updated saved location to ${formatLocationTime(position)}.`;
});

document.querySelector('#cancel-location-edit').addEventListener('click', () => closeLocationEditor(true));
locationEditor.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLocationEditor(true);
  }
});

locationsToggle.addEventListener('click', () => {
  if (!locationsPanel.hidden) closeLocationEditor(false);
  locationsPanel.hidden = !locationsPanel.hidden;
  locationsToggle.setAttribute('aria-expanded', String(!locationsPanel.hidden));
});

document.querySelector('#close-locations').addEventListener('click', () => {
  closeLocationEditor(false);
  locationsPanel.hidden = true;
  locationsToggle.setAttribute('aria-expanded', 'false');
  locationsToggle.focus();
});

locationsList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-location-index]');
  if (event.detail <= 1) {
    lastLocationClick = null;
    if (!item) return;
    const index = Number(item.dataset.locationIndex);
    const videoId = playingTrack?.videoId;
    lastLocationClick = { index, videoId, position: savedLocations.get(videoId)?.[index] };
    recallSavedLocation(index, { allowUnavailableSelection: true });
  }
});

locationsList.addEventListener('dblclick', () => {
  const clicked = lastLocationClick;
  lastLocationClick = null;
  if (!clicked) return;
  if (playingTrack?.videoId !== clicked.videoId
    || savedLocations.get(clicked.videoId)?.[clicked.index] !== clicked.position) {
    memoryError('The saved location changed. Select it and try again.');
    return;
  }
  openLocationEditor(clicked.index);
});

locationsList.addEventListener('keydown', (event) => {
  const item = event.target.closest('[data-location-index]');
  if (item && event.key === 'F2') {
    event.preventDefault();
    openLocationEditor(Number(item.dataset.locationIndex));
  }
});

removeLocationButton.addEventListener('click', removeSelectedLocation);

savedLocationsLayer.addEventListener('click', (event) => {
  const marker = event.target.closest('[data-saved-location]');
  if (marker) recallSavedLocation(Number(marker.dataset.savedLocation));
});

window.addEventListener('storage', (event) => {
  if (event.key !== savedLocationsStorageKey && event.key !== null) return;
  if (loadSavedLocations()) {
    memoryMessage.textContent = '';
    renderSavedLocations();
  }
});

function updateControl(controlName, value, { fromRamp = false } = {}) {
  const control = controls[controlName];
  if (!control) return;

  if (controlName === 'speed' && !fromRamp) stopSpeedRamp();
  const appliedValue = controlName === 'speed' ? setSpeedRate(value) : value;
  if (controlName !== 'speed') control.value = value;
  else updateSpeedAccessibility(appliedValue);
  applyControl(controlName, appliedValue);
  if (valueDisplays[controlName]) {
    valueDisplays[controlName].textContent = formatValue(controlName, appliedValue);
  }
  announceEvent({ type: 'input', name: controlName, value: controlName === 'speed' ? String(appliedValue) : control.value });
}

document.querySelectorAll('[data-control]').forEach((control) => {
  control.addEventListener('input', () => {
    const controlName = control.dataset.control;
    const value = controlName === 'speed' ? currentSpeedRate() : control.value;
    if (controlName === 'scrubber') {
      cancelNudgePreview(true);
      scrubbing = true;
      timeDisplay.textContent = formatClock((Number(control.value) / 100) * currentDuration());
    } else {
      if (controlName === 'speed') {
        stopSpeedRamp();
        updateSpeedAccessibility(value);
      }
      applyControl(controlName, value);
    }
    if (valueDisplays[controlName]) {
      valueDisplays[controlName].textContent = formatValue(controlName, value);
    }
    announceEvent({ type: 'input', name: controlName, value: String(value) });
  });

  control.addEventListener('change', () => {
    if (control.dataset.control === 'scrubber') {
      scrubbing = false;
      const target = (Number(control.value) / 100) * currentDuration();
      timeDisplay.textContent = formatClock(target);
      if (ytReady && playingTrack) ytPlayer.seekTo(target, true);
    }
    const value = control.dataset.control === 'speed' ? String(currentSpeedRate()) : control.value;
    announceEvent({ type: 'change', name: control.dataset.control, value });
  });
});

let speedKeyChanged = false;
controls.speed.addEventListener('keydown', (event) => {
  const direction = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
  if (!direction) return;
  event.preventDefault();
  const previous = currentSpeedRate();
  const next = setSpeedRate((previous + direction * 0.0001).toFixed(4));
  if (next === previous) return;
  speedKeyChanged = true;
  controls.speed.dispatchEvent(new Event('input', { bubbles: true }));
});

function finishSpeedKeyChange() {
  if (!speedKeyChanged) return;
  speedKeyChanged = false;
  controls.speed.dispatchEvent(new Event('change', { bubbles: true }));
}

controls.speed.addEventListener('keyup', (event) => {
  if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) finishSpeedKeyChange();
});
controls.speed.addEventListener('blur', finishSpeedKeyChange);

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
      // Handled here rather than via dblclick because the first click re-renders the list items.
      if (event.detail >= 2 && !event.ctrlKey && !event.metaKey) playTrack(currentList(), track);
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

  if (button.dataset.action === 'play') togglePlayback();
  if (button.dataset.action === 'pause' && ytReady && playingTrack) {
    cancelNudgePreview(true);
    if (ytPlayer.getPlayerState() === YT.PlayerState.PAUSED) ytPlayer.playVideo();
    else ytPlayer.pauseVideo();
  }
  if (button.dataset.action === 'stop') stopPlayback();
  if (button.dataset.action === 'next') stepTrack(1);
  if (button.dataset.action === 'previous') stepTrack(-1);

  if (button.dataset.action?.startsWith('toggle-')) {
    const isActive = button.classList.toggle('active');
    button.setAttribute('aria-pressed', String(isActive));
    const targetId = {
      'toggle-videos': 'videos-window',
      'toggle-playlist': 'playlist-window',
    }[button.dataset.action] || 'pitchfork-window';
    document.getElementById(targetId).hidden = !isActive;
  }

  if (button.dataset.action === 'open') showInputDialog('open');

  if (button.dataset.action === 'close-open-dialog') {
    openDialog.close();
  }

  announceEvent({
    type: 'click',
    name: button.dataset.action || button.dataset.track || (button.hasAttribute('data-bpm') ? button.id : button.textContent.trim()),
  });
});

markerSourceToggle.addEventListener('click', () => {
  markerSource = markerSource === 'video' ? 'user' : 'video';
  renderMarkers();
});

markerViewToggle.addEventListener('click', () => {
  if (!playingTrack?.markers) return;
  playingTrack.markerView = currentMarkerEntries() === playingTrack.markers.chapters ? 'timestamps' : 'chapters';
  renderMarkers();
});

markerList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-user-location]');
  if (item) recallSavedLocation(Number(item.dataset.userLocation));
});

markerList.addEventListener('dblclick', (event) => {
  if (markerSource !== 'video') return;
  const item = event.target.closest('[data-marker]');
  if (item) seekToMarker(Number(item.dataset.marker));
});

const copyNotice = document.querySelector('#copy-notice');
const copyMenu = document.querySelector('#copy-menu');
const copyMenuItems = [...copyMenu.querySelectorAll('[role="menuitem"]')];
let copyNoticeTimer = null;
let copySelection = null;

function closeCopyMenu(restoreFocus = false) {
  const item = copySelection?.item;
  copyMenu.hidden = true;
  copySelection = null;
  if (restoreFocus && item?.isConnected && !item.disabled) item.focus();
}

[playlistList, markerList].forEach((list) => {
  list.addEventListener('contextmenu', (event) => {
    const item = event.target.closest('.playlist-item');
    if (!item || !list.contains(item)) return;
    event.preventDefault();
    copySelection = {
      item,
      text: item.textContent.trim(),
      videoId: list === playlistList ? item.dataset.videoId : playingTrack?.videoId,
      position: list === markerList ? currentMarkerEntries()[Number(item.dataset.marker)]?.start : null,
    };
    copyMenu.hidden = false;
    const itemRect = item.getBoundingClientRect();
    const x = event.clientX || itemRect.left;
    const y = event.clientY || itemRect.bottom;
    const menuRect = copyMenu.getBoundingClientRect();
    copyMenu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - menuRect.width))}px`;
    copyMenu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - menuRect.height))}px`;
    copyMenuItems[0].focus();
  });
});

copyMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeCopyMenu(true);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const index = copyMenuItems.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? copyMenuItems.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + copyMenuItems.length) % copyMenuItems.length;
    copyMenuItems[next].focus();
  }
});

copyMenu.addEventListener('focusout', (event) => {
  if (!copyMenu.contains(event.relatedTarget)) closeCopyMenu();
});

document.addEventListener('pointerdown', (event) => {
  if (!copyMenu.hidden && !copyMenu.contains(event.target)) closeCopyMenu();
});

copyMenu.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button || !copySelection) return;
  event.stopPropagation();
  const selection = copySelection;
  closeCopyMenu(true);
  clearTimeout(copyNoticeTimer);
  copyNotice.hidden = true;

  let value = selection.text;
  if (button.dataset.copy === 'link') {
    let videoId;
    try {
      videoId = parseYouTubeInput(selection.videoId).videoId;
    } catch (error) {
      console.error('Could not create a YouTube link for this item.', error);
      announceEvent({ type: 'error', name: 'Could not create a YouTube link: the video ID is unavailable.' });
      return;
    }
    if (selection.position !== null && (!Number.isFinite(selection.position) || selection.position < 0)) {
      announceEvent({ type: 'error', name: 'Could not create a YouTube link: the timestamp is unavailable.' });
      return;
    }
    const url = new URL('https://www.youtube.com/watch');
    url.searchParams.set('v', videoId);
    if (selection.position !== null) url.searchParams.set('t', `${Math.floor(selection.position)}s`);
    value = url.toString();
  }

  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable.');
    await navigator.clipboard.writeText(value);
    announceEvent({ type: 'copy', name: 'List item copied to clipboard' });
    clearTimeout(copyNoticeTimer);
    copyNotice.hidden = false;
    copyNoticeTimer = setTimeout(() => { copyNotice.hidden = true; }, 2000);
  } catch (error) {
    clearTimeout(copyNoticeTimer);
    copyNotice.hidden = true;
    console.error('Could not copy the list item to the clipboard.', error);
    announceEvent({ type: 'error', name: 'Could not copy the list item. Check clipboard permissions and use HTTPS or localhost.' });
  }
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

function resetPitch() {
  updateControl('speed', '1.00');
  announceEvent({ type: 'reset', name: 'playback speed' });
}

document.querySelector('[data-pf-reset]').addEventListener('click', resetPitch);

// Steps are in percentage points of the pitch readout (0.01 = 0.01%).
// Defaults are overridden at load by ErAudio.json (left = permanent, right = temporary).
const stepConfig = {
  permanent: { large: 0.10, small: 0.01 },
  temporary: { large: 0.10, small: 0.01 },
  ramp: { percentPerSecond: 1 },
};
const stepGroups = ['permanent', 'temporary'];
const stepSizes = ['large', 'small'];
const stepStorageKey = 'eraudio:speed-steps';
const stepMessage = document.querySelector('#step-message');
const stepDefaults = {};
const stepButtons = document.querySelectorAll('[data-step-size]');

function renderSpeedSteps() {
  stepButtons.forEach((button) => {
    const group = button.closest('.pf-left') ? 'permanent' : 'temporary';
    const value = stepConfig[group][button.dataset.stepSize];
    button.dataset.stepValue = String(value);
    const description = `${button.textContent} ${group} speed step: ${value} percentage points. Right-click or press Shift+F10 to edit.`;
    button.setAttribute('aria-label', description);
    button.title = description;
  });
}

function readStepOverrides() {
  const raw = localStorage.getItem(stepStorageKey);
  if (raw === null) return {};
  const stored = JSON.parse(raw);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error('Invalid saved speed steps.');
  }
  const overrides = {};
  stepGroups.forEach((group) => {
    if (stored[group] === undefined) return;
    if (!stored[group] || typeof stored[group] !== 'object' || Array.isArray(stored[group])) {
      throw new Error('Invalid saved speed steps.');
    }
    overrides[group] = {};
    stepSizes.forEach((size) => {
      const value = stored[group][size];
      if (value === undefined) return;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error('Invalid saved speed steps.');
      }
      overrides[group][size] = value;
    });
  });
  return overrides;
}

function applyStepOverrides(overrides) {
  stepGroups.forEach((group) => {
    stepSizes.forEach((size) => {
      stepConfig[group][size] = overrides[group]?.[size] ?? stepDefaults[group][size];
    });
  });
  renderSpeedSteps();
}

function stepError(message, error) {
  stepMessage.textContent = message;
  if (error) console.error(message, error);
  announceEvent({ type: 'error', name: message });
}

async function loadStepConfig() {
  try {
    const response = await fetch('ErAudio.json', { cache: 'no-store' });
    if (response.ok) {
      const config = await response.json();
      stepGroups.forEach((group) => {
        stepSizes.forEach((key) => {
          const value = Number(config?.[group]?.[key]);
          if (Number.isFinite(value) && value >= 0) stepConfig[group][key] = value;
        });
      });
      if (config?.ramp?.percentPerSecond !== undefined) {
        const rate = config.ramp.percentPerSecond;
        if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
          stepConfig.ramp.percentPerSecond = rate;
        } else {
          console.warn('Invalid ramp.percentPerSecond in ErAudio.json; using the default.');
        }
      }
    }
  } catch {
    // Missing or invalid file: keep the defaults.
  }
  stepGroups.forEach((group) => { stepDefaults[group] = { ...stepConfig[group] }; });
  try {
    applyStepOverrides(readStepOverrides());
  } catch (error) {
    stepError('Could not read saved speed steps from browser storage.', error);
    renderSpeedSteps();
  }
}
renderSpeedSteps();
const stepConfigReady = loadStepConfig();

window.addEventListener('storage', async (event) => {
  if (event.key !== stepStorageKey && event.key !== null) return;
  await stepConfigReady;
  try {
    applyStepOverrides(readStepOverrides());
    stepMessage.textContent = '';
  } catch (error) {
    stepError('Could not read saved speed steps from browser storage.', error);
  }
});

const speedRampMessage = document.querySelector('#speed-ramp-message');
const speedRampButtons = {
  up: document.querySelector('[data-pf="Pitch Up"]'),
  down: document.querySelector('[data-pf="Pitch Down"]'),
};
let speedRamp = null;

function stopSpeedRamp() {
  if (!speedRamp) return;
  clearInterval(speedRamp.timer);
  speedRamp = null;
  Object.values(speedRampButtons).forEach((button) => button.setAttribute('aria-pressed', 'false'));
  speedRampMessage.textContent = '';
}

async function startSpeedRamp(direction) {
  const wasSameDirection = speedRamp?.direction === direction;
  stopSpeedRamp();
  if (wasSameDirection) return;

  const ramp = { direction, timer: null };
  speedRamp = ramp;
  speedRampButtons[direction].setAttribute('aria-pressed', 'true');
  await stepConfigReady;
  if (speedRamp !== ramp) return;

  const availableRates = ytReady && playingTrack ? ytPlayer.getAvailablePlaybackRates() : [];
  const rates = availableRates.filter((rate) => Number.isFinite(rate) && rate > 0);
  if (!rates.length) {
    stopSpeedRamp();
    speedRampMessage.textContent = 'Load a YouTube video before starting a speed ramp.';
    announceEvent({ type: 'error', name: speedRampMessage.textContent });
    return;
  }

  const min = Math.max(speedLimits.min, Math.min(...rates));
  const max = Math.min(speedLimits.max, Math.max(...rates));
  const start = currentSpeedRate();
  const normal = Math.min(max, Math.max(min, 1));
  const target = direction === 'up'
    ? (start < normal ? normal : max)
    : (start > normal ? normal : min);

  if ((direction === 'up' && start >= target) || (direction === 'down' && start <= target)) {
    stopSpeedRamp();
    speedRampMessage.textContent = 'The speed is already at the supported limit.';
    return;
  }

  speedRampMessage.textContent = 'YouTube playback changes in supported rate steps, not continuously.';
  const startedAt = performance.now();
  const ratePerMs = stepConfig.ramp.percentPerSecond / 100 / 1000;
  ramp.timer = setInterval(() => {
    const change = (performance.now() - startedAt) * ratePerMs;
    const next = direction === 'up' ? Math.min(target, start + change) : Math.max(target, start - change);
    updateControl('speed', next.toFixed(4), { fromRamp: true });
    if (next === target) stopSpeedRamp();
  }, 250);
}

function steppedSpeed(button, base, group) {
  const sign = button.dataset.stepDir === 'down' ? -1 : 1;
  const next = base + (sign * stepConfig[group][button.dataset.stepSize] / 100);
  return Math.min(speedLimits.max, Math.max(speedLimits.min, next)).toFixed(4);
}

// Left-side buttons change the speed permanently.
document.querySelectorAll('.pf-left [data-step-size]').forEach((button) => {
  button.addEventListener('click', async () => {
    await stepConfigReady;
    updateControl('speed', steppedSpeed(button, currentSpeedRate(), 'permanent'));
  });
});

function bindMomentarySpeed(button, pressedSpeed, ready = null) {
  let restoreValue = null;
  let pressedBy = null;
  const press = (source, id) => {
    if (pressedBy) return;
    const currentPress = { source, id };
    pressedBy = currentPress;
    const apply = () => {
      if (pressedBy !== currentPress) return;
      restoreValue = currentSpeedRate();
      updateControl('speed', pressedSpeed(Number(restoreValue)));
    };
    if (ready) ready.then(apply);
    else apply();
  };
  const release = (source, id) => {
    if (!pressedBy || (source && (pressedBy.source !== source || pressedBy.id !== id))) return;
    pressedBy = null;
    if (restoreValue === null) return;
    const previous = restoreValue;
    restoreValue = null;
    updateControl('speed', previous);
  };
  button.addEventListener('pointerdown', (event) => {
    if (event.button === 0) press('pointer', event.pointerId);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
    button.addEventListener(type, (event) => release('pointer', event.pointerId));
  });
  button.addEventListener('blur', () => release());
  window.addEventListener('blur', () => release());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') press('key', event.key);
  });
  button.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') release('key', event.key);
  });
}

// Right-side buttons apply their steps only while held.
document.querySelectorAll('.pf-right [data-step-size]').forEach((button) => {
  bindMomentarySpeed(button, (base) => steppedSpeed(button, base, 'temporary'), stepConfigReady);
});

bindMomentarySpeed(document.querySelector('[data-pf="="]'), () => '1.00');

let stepEditor = null;
stepButtons.forEach((button) => {
  button.addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    await stepConfigReady;
    if (stepEditor) {
      stepError('Save or cancel the current speed step edit first.');
      stepEditor.focus();
      return;
    }
    const group = button.closest('.pf-left') ? 'permanent' : 'temporary';
    const size = button.dataset.stepSize;
    const editor = document.createElement('input');
    editor.type = 'number';
    editor.min = '0';
    editor.step = 'any';
    editor.inputMode = 'decimal';
    editor.className = `pf-step-editor${group === 'temporary' ? ` ${button.classList.contains('pf-r-plus2') ? 'pf-r-plus2' : 'pf-r-plus'}` : ''}`;
    editor.setAttribute('aria-label', `Edit ${group} ${size} speed step in percentage points`);
    editor.setAttribute('aria-describedby', 'step-message');
    editor.value = String(stepConfig[group][size]);
    stepEditor = editor;
    button.after(editor);
    button.hidden = true;
    stepMessage.textContent = 'Enter a nonnegative percentage-point step. Press Enter to save or Escape to cancel.';
    editor.focus();
    editor.select();

    function closeEditor(restoreFocus) {
      stepEditor = null;
      editor.remove();
      button.hidden = false;
      if (restoreFocus) button.focus();
    }

    function saveEditor(restoreFocus) {
      if (stepEditor !== editor) return;
      const value = editor.valueAsNumber;
      if (!Number.isFinite(value) || value < 0) {
        editor.setAttribute('aria-invalid', 'true');
        stepError('Enter a nonnegative speed step in percentage points.');
        return;
      }
      try {
        const overrides = readStepOverrides();
        overrides[group] = { ...overrides[group], [size]: value };
        localStorage.setItem(stepStorageKey, JSON.stringify(overrides));
        applyStepOverrides(overrides);
      } catch (error) {
        stepError('Could not save speed steps in browser storage. No step was changed.', error);
        return;
      }
      closeEditor(restoreFocus);
      stepMessage.textContent = `Saved ${group} ${size} speed step: ${value} percentage points.`;
      announceEvent({ type: 'speed-step', name: `${group} ${size}`, value });
    }

    editor.addEventListener('keydown', (keyEvent) => {
      if (keyEvent.key === 'Enter') {
        keyEvent.preventDefault();
        saveEditor(true);
      } else if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        closeEditor(true);
        stepMessage.textContent = '';
      }
    });
    editor.addEventListener('blur', () => saveEditor(false));
  });
});

const bpmValues = new Map();
const bpmTaps = new Map();
const bpmEditors = new Map();
const bpmMessage = document.querySelector('#bpm-message');
const defaultNudgeBpm = 130;

function nudgeError(message) {
  nudgeMessage.textContent = message;
  announceEvent({ type: 'error', name: message });
}

function cancelNudgePreview(pause = false) {
  if (!nudgePreview) return;
  clearTimeout(nudgePreview.timer);
  clearTimeout(nudgePreview.watchdog);
  nudgePreview = null;
  if (pause && ytReady) ytPlayer.pauseVideo();
  nudgeMessage.textContent = '';
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !nudgePreview) return;
  cancelNudgePreview(true);
  nudgeError('The nudge preview was stopped because the page was hidden.');
});

function startNudgePreview(preview) {
  if (nudgePreview !== preview) return;
  preview.phase = 'starting';
  ytPlayer.seekTo(preview.target, true);
  ytPlayer.playVideo();
}

function handleNudgeStateChange(state) {
  const preview = nudgePreview;
  if (!preview) return false;
  if (state === YT.PlayerState.ENDED) {
    cancelNudgePreview();
    nudgeError('The video ended during the nudge preview. Seek back to continue.');
    return true;
  }
  if (state === YT.PlayerState.PAUSED && preview.phase === 'pausing') {
    startNudgePreview(preview);
  } else if (state === YT.PlayerState.PLAYING && preview.phase === 'starting') {
    preview.phase = 'playing';
    preview.timer = setTimeout(() => {
      if (nudgePreview !== preview) return;
      preview.phase = 'finishing';
      ytPlayer.pauseVideo();
    }, 100);
  } else if (state === YT.PlayerState.PAUSED && preview.phase === 'finishing') {
    const target = preview.target;
    cancelNudgePreview();
    ytPlayer.seekTo(target, true);
    controls.scrubber.value = (target / activeVideoDuration()) * 100;
    timeDisplay.textContent = formatClock(target);
    highlightActiveMarker(target);
    nudgeMessage.textContent = `Requested ${formatLocationTime(target)}. YouTube seek and preview timing are approximate.`;
  }
  return false;
}

function nudgePosition(direction) {
  const bpm = bpmValues.get('bpm-left') ?? defaultNudgeBpm;
  if (!Number.isFinite(bpm) || bpm <= 0) {
    nudgeError('Measure or enter the left BPM before nudging.');
    return;
  }
  const duration = activeVideoDuration();
  const state = ytReady ? ytPlayer.getPlayerState() : null;
  if (!duration || (!nudgePreview && state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.PAUSED)) {
    nudgeError('Play or pause a loaded video before nudging.');
    return;
  }
  const selection = selectedLocation;
  if (selection && editingLocation) {
    nudgeError('Save or cancel the location edit before nudging.');
    return;
  }
  const position = selection?.position ?? nudgePreview?.target ?? ytPlayer.getCurrentTime();
  const step = 60 / bpm / 16;
  if (!Number.isFinite(position) || position < 0 || position > duration || !Number.isFinite(step) || step <= 0) {
    nudgeError('The playback position or left BPM cannot be used for nudging.');
    return;
  }
  const target = Math.max(0, Math.min(duration, position + direction * step));
  if (target === position) {
    nudgeError('The playback position cannot be nudged farther in that direction.');
    return;
  }
  if (selection) {
    if (!updateSavedLocation(selection, target)) {
      nudgeMessage.textContent = 'The saved location was not changed. See the location message for details.';
      return;
    }
    renderSavedLocations();
    memoryMessage.textContent = `Updated saved location to ${formatLocationTime(target)}.`;
  }
  cancelNudgePreview(true);
  const preview = { target, phase: 'pausing', timer: null, watchdog: null };
  nudgePreview = preview;
  nudgeMessage.textContent = 'Preparing nudge preview; YouTube timing is approximate.';
  preview.watchdog = setTimeout(() => {
    if (nudgePreview !== preview) return;
    cancelNudgePreview(true);
    nudgeError('The nudge preview did not complete. Check the video and try again.');
  }, 5000);
  if (ytPlayer.getPlayerState() === YT.PlayerState.PAUSED) startNudgePreview(preview);
  else ytPlayer.pauseVideo();
}

function displayBpm(button, value) {
  button.textContent = value === undefined ? 'BPM' : String(value);
  const side = button.id === 'bpm-left' ? 'Left' : 'Right';
  const description = value === undefined ? 'not measured' : String(value);
  button.setAttribute('aria-label', `${side} BPM: ${description}. Tap to measure; press Shift+F10 to enter manually.`);
}

function resetBpm() {
  bpmEditors.forEach((close) => close(false));
  bpmValues.clear();
  bpmTaps.forEach((taps) => { taps.length = 0; });
  document.querySelectorAll('[data-bpm]').forEach((button) => displayBpm(button));
  bpmMessage.textContent = '';
}

function matchBpm(sourceId, targetId) {
  const source = bpmValues.get(sourceId);
  const target = bpmValues.get(targetId);
  if (!Number.isFinite(source) || source <= 0 || !Number.isFinite(target) || target <= 0) {
    bpmMessage.textContent = 'Tap each BPM button at least twice to measure both tempos first.';
    announceEvent({ type: 'error', name: bpmMessage.textContent });
    return;
  }

  const rate = target / source;
  const min = speedLimits.min;
  const max = speedLimits.max;
  const boundedRate = Math.min(max, Math.max(min, rate));
  bpmMessage.textContent = rate !== boundedRate
    ? 'The required speed is outside the slider range; the nearest limit was selected.'
    : '';
  updateControl('speed', boundedRate.toFixed(4));
}

document.querySelectorAll('[data-pf]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.pf === 'AC') {
      cancelNudgePreview(true);
      resetPitch();
      resetBpm();
      clearSavedLocations();
    }
    if (button.dataset.pf === 'M+') addSavedLocation();
    if (button.dataset.pf === 'M2=M') matchBpm('bpm-left', 'bpm-right');
    if (button.dataset.pf === 'M-M2') matchBpm('bpm-right', 'bpm-left');
    if (button.dataset.pf === 'Pitch Up') startSpeedRamp('up');
    if (button.dataset.pf === 'Pitch Down') startSpeedRamp('down');
    if (button.dataset.pf === 'Previous N') nudgePosition(-1);
    if (button.dataset.pf === 'Next N') nudgePosition(1);
    announceEvent({ type: 'button', name: button.dataset.pf });
  });
});

// Each BPM button is a tap counter: taps within the gap window are averaged into a BPM.
const bpmMaxGapMs = 2500;
const bpmMaxTaps = 8;
document.querySelectorAll('[data-bpm]').forEach((button) => {
  const taps = [];
  let editor = null;
  bpmTaps.set(button.id, taps);

  function closeEditor(restoreFocus) {
    if (!editor) return;
    const activeEditor = editor;
    editor = null;
    activeEditor.remove();
    button.hidden = false;
    if (restoreFocus) button.focus();
  }
  bpmEditors.set(button.id, closeEditor);

  function saveEditor(restoreFocus) {
    if (!editor) return;
    const bpm = editor.valueAsNumber;
    if (!Number.isFinite(bpm) || bpm <= 0) {
      bpmMessage.textContent = 'Enter a BPM greater than zero.';
      announceEvent({ type: 'error', name: bpmMessage.textContent });
      if (!restoreFocus) closeEditor(false);
      return;
    }
    bpmValues.set(button.id, bpm);
    taps.length = 0;
    displayBpm(button, bpm);
    bpmMessage.textContent = '';
    announceEvent({ type: 'bpm', name: button.id, value: String(bpm) });
    closeEditor(restoreFocus);
  }

  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (editor) return;
    editor = document.createElement('input');
    editor.type = 'number';
    editor.step = 'any';
    editor.inputMode = 'decimal';
    editor.className = 'pf-bpm-editor';
    editor.setAttribute('aria-label', `Enter ${button.id === 'bpm-left' ? 'left' : 'right'} BPM`);
    const value = bpmValues.get(button.id);
    if (value !== undefined) editor.value = String(value);
    editor.addEventListener('keydown', (keyEvent) => {
      if (keyEvent.key === 'Enter') {
        keyEvent.preventDefault();
        saveEditor(true);
      } else if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        bpmMessage.textContent = '';
        closeEditor(true);
      }
    });
    editor.addEventListener('blur', () => saveEditor(false));
    button.after(editor);
    button.hidden = true;
    bpmMessage.textContent = '';
    editor.focus();
    editor.select();
  });

  button.addEventListener('click', () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > bpmMaxGapMs) taps.length = 0;
    taps.push(now);
    if (taps.length > bpmMaxTaps) taps.shift();
    if (taps.length < 2) {
      announceEvent({ type: 'button', name: button.id });
      return;
    }
    const bpm = 60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1));
    const displayedBpm = Math.round(bpm);
    if (!Number.isFinite(displayedBpm) || displayedBpm <= 0) {
      bpmMessage.textContent = 'Could not measure BPM. Tap the button again.';
      announceEvent({ type: 'error', name: bpmMessage.textContent });
      return;
    }
    bpmValues.set(button.id, displayedBpm);
    bpmMessage.textContent = '';
    displayBpm(button, displayedBpm);
    announceEvent({ type: 'bpm', name: button.id, value: bpm.toFixed(1) });
  });
});

loadSavedLocations();
initializeFavorites();
initYouTubePlayer();
updateNowPlaying();
ensureMarkers(playingTrack);
if (credentialsLoadError) showLoginError(credentialsLoadError);

// Application code can react here without coupling the controls to playback yet.
document.addEventListener('eraudio:control', (event) => {
  console.debug('ErAudio control event', event.detail);
});