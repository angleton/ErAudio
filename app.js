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
    tracks: [
      { title: 'Retro Synthwave - ErAudio Theme', duration: '03:45' },
      { title: 'Chiptune Symphony No. 9', duration: '04:12' },
      { title: 'HTML5 & Wasm Audio Demo', duration: '02:30' },
      { title: 'Pitchfork High Precision Speed Test', duration: '05:00' },
    ],
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

function collectQueryParameters(searchParams) {
  return [...searchParams.entries()].reduce((parameters, [key, value]) => {
    if (Object.hasOwn(parameters, key)) {
      parameters[key] = Array.isArray(parameters[key])
        ? [...parameters[key], value]
        : [parameters[key], value];
    } else {
      parameters[key] = value;
    }
    return parameters;
  }, {});
}

function parseYouTubeInput(value) {
  const input = String(value || '').trim();
  const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

  if (videoIdPattern.test(input)) {
    return { videoId: input, input, url: null, queryParameters: {}, fragment: '' };
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

  const queryParameters = collectQueryParameters(url.searchParams);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const videoId = hostname.endsWith('youtu.be')
    ? pathSegments[0]
    : queryParameters.v || (['embed', 'shorts', 'live', 'v'].includes(pathSegments[0]) ? pathSegments[1] : null);

  if (!videoId || !videoIdPattern.test(videoId)) {
    throw new Error('That link does not contain a valid 11-character YouTube video ID.');
  }

  return {
    videoId,
    input,
    url: url.href,
    queryParameters,
    fragment: url.hash ? url.hash.slice(1) : '',
  };
}

function formatPlaylistDuration(tracks) {
  const seconds = tracks.reduce((total, track) => {
    const [minutes, remainingSeconds] = track.duration.split(':').map(Number);
    return total + (minutes * 60) + remainingSeconds;
  }, 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderFavoritesList(listId) {
  const selectedList = favoriteLists.find((list) => list.id === listId) || favoriteLists[0];
  writeStoredValue(favoritesStorageKey, selectedList.id);
  favoritesSelect.value = selectedList.id;
  playlistList.replaceChildren(...selectedList.tracks.map((track, index) => {
    const item = document.createElement('button');
    item.className = `playlist-item${index === 0 ? ' active' : ''}`;
    item.type = 'button';
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
  if (related.likes) accountLists.push({ id: related.likes, playlistId: related.likes, name: 'Liked videos', tracks: [] });
  playlists.forEach((playlist) => {
    accountLists.push({ id: playlist.id, playlistId: playlist.id, name: playlist.snippet.title, tracks: [] });
  });
  if (!accountLists.length) return;

  favoriteLists.splice(0, favoriteLists.length, ...accountLists);
  favoritesSelect.replaceChildren(...favoriteLists.map((list) => {
    const option = document.createElement('option');
    option.value = list.id;
    option.textContent = list.name;
    return option;
  }));
  playlistSourceRow.hidden = false;
  await selectFavoritesList(favoriteLists[0].id);
}

function requestYouTubeLogin() {
  document.dispatchEvent(new CustomEvent('eraudio:youtube-login-request'));
  announceEvent({ type: 'login', name: 'YouTube' });

  if (!googleClientId) {
    announceEvent({ type: 'error', name: 'Set googleClientId in config.js to enable YouTube sign-in' });
    return;
  }
  if (!window.google?.accounts?.oauth2) {
    announceEvent({ type: 'error', name: 'Google sign-in script failed to load' });
    return;
  }

  google.accounts.oauth2.initTokenClient({
    client_id: googleClientId,
    scope: youtubeScope,
    callback: async (tokenResponse) => {
      if (tokenResponse.error) {
        announceEvent({ type: 'error', name: tokenResponse.error });
        return;
      }
      youtubeAccessToken = tokenResponse.access_token;
      try {
        await loadAccountPlaylists();
      } catch (error) {
        announceEvent({ type: 'error', name: error.message });
      }
    },
  }).requestAccessToken();
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
  if (valueDisplays[controlName]) {
    valueDisplays[controlName].textContent = formatValue(controlName, value);
  }
  announceEvent({ type: 'input', name: controlName, value: control.value });
}

document.querySelectorAll('[data-control]').forEach((control) => {
  control.addEventListener('input', () => {
    const controlName = control.dataset.control;
    if (valueDisplays[controlName]) {
      valueDisplays[controlName].textContent = formatValue(controlName, control.value);
    }
    announceEvent({ type: 'input', name: controlName, value: control.value });
  });

  control.addEventListener('change', () => {
    announceEvent({ type: 'change', name: control.dataset.control, value: control.value });
  });
});

favoritesSelect.addEventListener('change', () => {
  selectFavoritesList(favoritesSelect.value);
});

youtubeLoginButton.addEventListener('click', requestYouTubeLogin);

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
    document.querySelectorAll('[data-track]').forEach((track) => track.classList.remove('active'));
    button.classList.add('active');
  }

  if (button.dataset.action?.startsWith('toggle-')) {
    const isActive = button.classList.toggle('active');
    button.setAttribute('aria-pressed', String(isActive));
  }

  if (button.dataset.action === 'open') {
    youtubeInputError.textContent = '';
    youtubeInput.removeAttribute('aria-invalid');
    openDialog.showModal();
    youtubeInput.focus();
  }

  if (button.dataset.action === 'close-open-dialog') {
    openDialog.close();
  }

  announceEvent({
    type: 'click',
    name: button.dataset.action || button.dataset.track || button.textContent.trim(),
  });
});

openForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const parsedInput = parseYouTubeInput(youtubeInput.value);
    youtubeInputError.textContent = '';
    youtubeInput.removeAttribute('aria-invalid');
    openDialog.close();
    announceEvent({
      type: 'open-request',
      name: parsedInput.videoId,
      ...parsedInput,
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
setYouTubeAccount(readStoredValue(youtubeAccountStorageKey));

// Application code can react here without coupling the controls to playback yet.
document.addEventListener('eraudio:control', (event) => {
  console.debug('ErAudio control event', event.detail);
});