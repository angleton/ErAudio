const controls = {
  speed: document.querySelector('#speed-slider'),
  scrubber: document.querySelector('#scrubber'),
  volume: document.querySelector('#volume'),
};

const valueDisplays = {
  speed: document.querySelector('#val-speed'),
};

const eventStatus = document.querySelector('#event-status');
const savedLocationsLayer = document.querySelector('#saved-locations');
const memoryMessage = document.querySelector('#memory-message');
const locationsToggle = document.querySelector('#toggle-locations');
const locationsPanel = document.querySelector('#locations-panel');
const locationsList = document.querySelector('#locations-list');
const locationsFile = document.querySelector('#locations-file');
const savedLocationsStorageKey = 'eraudio:saved-locations';
const maxSavedLocations = 50;
const favoritesSelect = document.querySelector('#favorites-select');
const playlistSourceRow = document.querySelector('#playlist-source-row');
const playlistList = document.querySelector('#playlist-list');
const playlistInfo = document.querySelector('#playlist-info');
const favoritesStorageKey = 'eraudio:selected-favorites-list';
const addedTracksStorageKey = 'eraudio:added-tracks';
const defaultTrack = {
  title: 'Bedrock - Heaven Scent (Original Mix) (1999)',
  videoId: '5scF4Rx9uP0',
  duration: '--:--',
};
const youtubeLoginButton = document.querySelector('#youtube-login');
const loginNotice = document.querySelector('#login-notice');
const loginNoticeMessage = document.querySelector('#login-notice-message');
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

const favoriteLists = [
  {
    id: 'favorites',
    name: 'Favorites',
    tracks: [defaultTrack],
  },
];

const trackTitleDisplay = document.querySelector('#track-title');
const pauseButtons = document.querySelectorAll('[data-action="pause"]');
const markerList = document.querySelector('#marker-list');
const markerInfo = document.querySelector('#marker-info');
const timeDisplay = document.querySelector('#time-display');
const idleTitle = 'ErAudio - press ⏏ to open a YouTube video';
let ytPlayer = null;
let ytReady = false;
let playingTrack = defaultTrack;
let playingList = favoriteLists[0];
let scrubbing = false;
let savedLocations = new Map();
let savedLocationsRenderKey = '';
let locationsListRenderKey = '';
let selectedLocation = null;

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

function showLoginError(message) {
  loginNoticeMessage.textContent = message;
  loginNotice.hidden = false;
  announceEvent({ type: 'error', name: message });
}

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
        if (!wasSilent) showLoginError(`YouTube sign-in failed: ${tokenResponse.error}. Try again or check the setup instructions.`);
        return;
      }
      loginNotice.hidden = true;
      youtubeAccessToken = tokenResponse.access_token;
      ensureMarkers(playingTrack);
      try {
        await loadAccountPlaylists();
      } catch (error) {
        announceEvent({ type: 'error', name: error.message });
      }
    },
    error_callback: (error) => {
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
    if (!silent) showLoginError('YouTube sign-in is not configured for this copy of ErAudio. The maintainer must set a Google OAuth client ID. You can still play YouTube links.');
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
}

function parseClockToSeconds(value) {
  return value.split(':').map(Number).reduce((total, part) => (total * 60) + part, 0);
}

// Extracts timestamp lines from a video description. If they satisfy YouTube's chapter
// rules (start at 0:00, at least 3 entries, each at least 10s long) they are chapters.
function parseDescriptionMarkers(description) {
  const timestampPattern = /(?:^|[\s(\[])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=$|[\s)\]\-–—:.,|])/;
  const trimPattern = /^[\s\-–—:.,|()[\]]+|[\s\-–—:.,|()[\]]+$/g;
  const byStart = new Map();
  String(description || '').split(/\r?\n/).forEach((line) => {
    const match = timestampPattern.exec(line);
    if (!match) return;
    const start = parseClockToSeconds(match[1]);
    if (byStart.has(start)) return;
    const title = line.replace(match[1], '').replace(trimPattern, '');
    byStart.set(start, { start, title });
  });
  const entries = [...byStart.values()].sort((a, b) => a.start - b.start);
  if (entries.length < 2) return { kind: 'none', entries: [] };
  entries.forEach((entry, index) => { entry.title ||= `Part ${index + 1}`; });
  const isChapters = entries.length >= 3 && entries[0].start === 0
    && entries.every((entry, index) => index === 0 || entry.start - entries[index - 1].start >= 10);
  return { kind: isChapters ? 'chapters' : 'timestamps', entries };
}

let markerRenderKey = '';
let activeMarkerIndex = -1;

function renderMarkers() {
  const markers = playingTrack?.markers;
  const key = `${playingTrack?.videoId || ''}|${markers ? markers.kind : (youtubeAccessToken ? 'loading' : 'signin')}`;
  if (key === markerRenderKey) return;
  markerRenderKey = key;
  activeMarkerIndex = -1;

  const placeholder = (text) => {
    const empty = document.createElement('div');
    empty.className = 'playlist-empty';
    empty.textContent = text;
    markerList.replaceChildren(empty);
  };

  if (!playingTrack) {
    placeholder('Open a video to see its chapters or timestamps.');
    markerInfo.textContent = 'NO VIDEO';
  } else if (!markers) {
    placeholder(youtubeAccessToken ? 'Looking for chapters / timestamps...' : 'Sign in to YouTube to detect chapters / timestamps.');
    markerInfo.textContent = youtubeAccessToken ? 'LOADING' : 'SIGN IN REQUIRED';
  } else if (!markers.entries.length) {
    placeholder('No chapters or timestamps found in this video\'s description.');
    markerInfo.textContent = 'NONE FOUND';
  } else {
    markerList.replaceChildren(...markers.entries.map((entry, index) => {
      const item = document.createElement('button');
      item.className = 'playlist-item';
      item.type = 'button';
      item.dataset.marker = String(index);
      item.textContent = `${index + 1}. ${entry.title} [${formatClock(entry.start)}]`;
      return item;
    }));
    markerInfo.textContent = `${markers.kind.toUpperCase()} / ${markers.entries.length} ENTRIES`;
  }
}

async function ensureMarkers(track) {
  if (!track || track.markers || track.markersLoading || !youtubeAccessToken) return;
  track.markersLoading = true;
  try {
    const data = await youtubeApi('videos', { part: 'snippet', id: track.videoId });
    const description = data.items?.[0]?.snippet?.description;
    if (description === undefined) return;
    track.markers = parseDescriptionMarkers(description);
  } catch {
    // Leave unresolved so a later attempt (e.g. after re-login) can retry.
  } finally {
    track.markersLoading = false;
    if (track === playingTrack) renderMarkers();
  }
}

function highlightActiveMarker(position) {
  const entries = playingTrack?.markers?.entries;
  if (!entries?.length) return;
  let index = -1;
  entries.forEach((entry, i) => { if (position >= entry.start) index = i; });
  if (index === activeMarkerIndex) return;
  activeMarkerIndex = index;
  markerList.querySelectorAll('[data-marker]').forEach((item) => {
    item.classList.toggle('active', Number(item.dataset.marker) === index);
  });
}

function seekToMarker(index) {
  const entry = playingTrack?.markers?.entries[index];
  if (!entry || !ytReady) return;
  ytPlayer.seekTo(entry.start, true);
  ytPlayer.playVideo();
}

function playTrack(list, track) {
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
  pauseButtons.forEach((button) => {
    button.classList.toggle('paused', event.data === YT.PlayerState.PAUSED);
    button.setAttribute('aria-pressed', String(event.data === YT.PlayerState.PAUSED));
  });
  renderSavedLocations();
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
    return true;
  } catch (error) {
    memoryError('Could not read saved locations from browser storage. No locations were changed.', error);
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

function updateSelectedLocation() {
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
        item.setAttribute('aria-label', `Seek to saved location ${index + 1}: ${item.textContent}`);
        return item;
      }));
    }
    updateSelectedLocation();
  }
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
  memoryMessage.textContent = '';
  renderSavedLocations();
}

document.querySelector('#export-locations').addEventListener('click', () => {
  if (!loadSavedLocations()) return;
  renderSavedLocations();
  const data = {
    format: 'ErAudio saved locations',
    version: 1,
    videos: Object.fromEntries(savedLocations),
  };
  let url;
  try {
    url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ErAudio-locations.json';
    link.click();
    memoryMessage.textContent = 'Export started for saved locations from all videos.';
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

function recallSavedLocation(index) {
  const duration = activeVideoDuration();
  const position = savedLocations.get(playingTrack?.videoId)?.[index];
  if (!duration || !Number.isFinite(position) || position > duration) {
    memoryError('This saved location is not available for the current video.');
    return;
  }
  ytPlayer.seekTo(position, true);
  controls.scrubber.value = (position / duration) * 100;
  timeDisplay.textContent = formatClock(position);
  highlightActiveMarker(position);
  memoryMessage.textContent = '';
  selectedLocation = { videoId: playingTrack.videoId, index, position };
  updateSelectedLocation();
  announceEvent({ type: 'memory', name: 'recalled location', videoId: playingTrack.videoId, value: position });
}

locationsToggle.addEventListener('click', () => {
  locationsPanel.hidden = !locationsPanel.hidden;
  locationsToggle.setAttribute('aria-expanded', String(!locationsPanel.hidden));
});

document.querySelector('#close-locations').addEventListener('click', () => {
  locationsPanel.hidden = true;
  locationsToggle.setAttribute('aria-expanded', 'false');
  locationsToggle.focus();
});

locationsList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-location-index]');
  if (item) recallSavedLocation(Number(item.dataset.locationIndex));
});

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
      timeDisplay.textContent = formatClock((Number(control.value) / 100) * currentDuration());
    } else {
      if (controlName === 'speed') stopSpeedRamp();
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
      const target = (Number(control.value) / 100) * currentDuration();
      timeDisplay.textContent = formatClock(target);
      if (ytReady && playingTrack) ytPlayer.seekTo(target, true);
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

  if (button.dataset.action === 'play') startPlayback();
  if (button.dataset.action === 'pause' && ytReady && playingTrack) {
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

markerList.addEventListener('dblclick', (event) => {
  const item = event.target.closest('[data-marker]');
  if (item) seekToMarker(Number(item.dataset.marker));
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

async function loadStepConfig() {
  try {
    const response = await fetch('ErAudio.json', { cache: 'no-store' });
    if (!response.ok) return;
    const config = await response.json();
    ['permanent', 'temporary'].forEach((group) => {
      Object.keys(stepConfig[group]).forEach((key) => {
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
  } catch {
    // Missing or invalid file: keep the defaults.
  }
}
const stepConfigReady = loadStepConfig();

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

  const min = Math.max(Number(controls.speed.min), Math.min(...rates));
  const max = Math.min(Number(controls.speed.max), Math.max(...rates));
  const start = Number(controls.speed.value);
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
  const slider = controls.speed;
  const sign = button.dataset.stepDir === 'down' ? -1 : 1;
  const next = base + (sign * stepConfig[group][button.dataset.stepSize] / 100);
  return Math.min(Number(slider.max), Math.max(Number(slider.min), next)).toFixed(4);
}

// Left-side buttons change the speed permanently.
document.querySelectorAll('.pf-left [data-step-size]').forEach((button) => {
  button.addEventListener('click', async () => {
    await stepConfigReady;
    updateControl('speed', steppedSpeed(button, Number(controls.speed.value), 'permanent'));
  });
});

// Right-side buttons are momentary: the step applies only while held, then the prior speed is restored.
document.querySelectorAll('.pf-right [data-step-size]').forEach((button) => {
  let restoreValue = null;
  const press = () => {
    if (restoreValue !== null) return;
    restoreValue = controls.speed.value;
    updateControl('speed', steppedSpeed(button, Number(restoreValue), 'temporary'));
  };
  const release = () => {
    if (restoreValue === null) return;
    updateControl('speed', restoreValue);
    restoreValue = null;
  };
  button.addEventListener('pointerdown', press);
  ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach((type) => button.addEventListener(type, release));
  button.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') press();
  });
  button.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') release();
  });
});

const bpmValues = new Map();
const bpmTaps = new Map();
const bpmEditors = new Map();
const bpmMessage = document.querySelector('#bpm-message');

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
  const min = Number(controls.speed.min);
  const max = Number(controls.speed.max);
  const boundedRate = Math.min(max, Math.max(min, rate));
  bpmMessage.textContent = rate !== boundedRate
    ? 'The required speed is outside the slider range; the nearest limit was selected.'
    : '';
  updateControl('speed', boundedRate.toFixed(4));
}

document.querySelectorAll('[data-pf]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.pf === 'AC') {
      resetPitch();
      resetBpm();
      clearSavedLocations();
    }
    if (button.dataset.pf === 'M+') addSavedLocation();
    if (button.dataset.pf === 'M2=M') matchBpm('bpm-left', 'bpm-right');
    if (button.dataset.pf === 'M-M2') matchBpm('bpm-right', 'bpm-left');
    if (button.dataset.pf === 'Pitch Up') startSpeedRamp('up');
    if (button.dataset.pf === 'Pitch Down') startSpeedRamp('down');
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
setYouTubeAccount(readStoredValue(youtubeAccountStorageKey));

// Application code can react here without coupling the controls to playback yet.
document.addEventListener('eraudio:control', (event) => {
  console.debug('ErAudio control event', event.detail);
});