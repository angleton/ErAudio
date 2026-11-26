import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { chromium, firefox } from 'playwright';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/history.js', ['history.js', 'text/javascript']],
  ['/history-sync.js', ['history-sync.js', 'text/javascript']],
  ['/tempo.js', ['tempo.js', 'text/javascript']],
  ['/visualizer/spectrum.js', ['visualizer/spectrum.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']],
]);
const playerScript = `
  window.playerEvents = [];
  window.YT = {
    Player: class {
      constructor(id, options) {
        this.state = -1;
        this.rate = 1;
        this.availableRates = [0.5, 1, 1.25, 1.5, 2];
        this.options = options;
        window.playerOptions = options;
        const frame = document.createElement('iframe');
        frame.id = id;
        frame.title = 'YouTube video player';
        document.getElementById(id).replaceWith(frame);
        queueMicrotask(() => options.events.onReady());
      }
      setVolume() {}
      setPlaybackRate(requested) {
        const supported = this.availableRates.filter((rate) => requested >= 1
          ? rate >= 1 && rate <= requested : rate <= 1 && rate >= requested);
        const rate = requested >= 1 ? Math.max(...supported) : Math.min(...supported);
        if (rate === this.rate) return;
        this.rate = rate;
        queueMicrotask(() => this.options.events.onPlaybackRateChange({ data: rate }));
      }
      getPlaybackRate() { return this.rate; }
      getAvailablePlaybackRates() { return this.availableRates; }
      loadVideoById(video) {
        this.videoId = typeof video === 'string' ? video : video.videoId;
        this.position = 0;
        this.rate = 1;
        this.state = 1;
        window.playerEvents.push(['play', this.videoId]);
      }
      cueVideoById(videoId) { this.videoId = videoId; this.position = 0; this.rate = 1; this.state = 5; window.playerEvents.push(['cue', videoId]); }
      getPlayerState() { return this.state; }
      getDuration() { return this.duration || 0; }
      getCurrentTime() { return this.position || 0; }
      seekTo(position) { this.position = position; window.playerEvents.push(['seek', position]); }
      getVideoData() { return { video_id: this.videoId }; }
      playVideo() { this.state = 1; }
      pauseVideo() { this.state = 2; }
      stopVideo() { this.state = -1; }
    },
    PlayerState: { PLAYING: 1, PAUSED: 2, CUED: 5, BUFFERING: 3, ENDED: 0 },
  };
  window.onYouTubeIframeAPIReady();
`;

function item(id, videoId, title) {
  return { id, snippet: { title }, contentDetails: { videoId } };
}

async function setup(t, initScript, { unifiedSignIn = false, combinedSignIn = false, browserType = chromium } = {}) {
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/ErAudio.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(
        unifiedSignIn || combinedSignIn ? { historySync: { endpoint: 'https://history.example.test',
          googleClientId: 'test.apps.googleusercontent.com', combinedGoogleSignIn: combinedSignIn } } : {},
      ));
      const asset = assets.get(req.url);
      if (!asset) return res.writeHead(404).end();
      const [file, type] = asset;
      res.writeHead(200, { 'Content-Type': type }).end(await readFile(new URL(`../${file}`, import.meta.url)));
    } catch (error) {
      res.writeHead(500).end(error.message);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  if (initScript) await page.addInitScript(initScript);
  const requests = [];
  const historyRequests = [];
  let historyStateStatus = 200;
  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  t.after(releaseSlow);
  await page.addInitScript(() => {
    window.oauthRequests = [];
    window.oauthCallbacks = [];
    window.codeRequests = [];
    window.identityPrompts = 0;
    window.google = {
      accounts: {
        id: {
          initialize(options) { this.options = options; },
          renderButton(parent, options) {
            const button = document.createElement('button');
            button.textContent = 'Sign in with Google';
            button.onclick = () => {
              options.click_listener?.();
              this.options.callback({ credential: 'history-id-token', select_by: 'btn' });
            };
            parent.append(button);
          },
          prompt() {
            window.identityPrompts++;
            if (window.autoIdentity) this.options.callback({ credential: 'history-id-token', select_by: 'auto' });
          },
          cancel() { window.identityCancelled = true; },
          disableAutoSelect() { window.identityAutoSelectDisabled = true; },
        },
        oauth2: {
          initCodeClient: (options) => ({
            requestCode: () => {
              window.codeRequests.push({ client_id: options.client_id, scope: options.scope,
                active: navigator.userActivation.isActive });
              window.codeCallback = options.callback;
              if (!window.deferCode) queueMicrotask(() => {
                if (window.codePopupError) options.error_callback({ type: 'popup_failed_to_open' });
                else options.callback(window.codeError ? { error: 'access_denied' } : { code: 'test-code' });
              });
            },
          }),
          initTokenClient: ({ callback, client_id }) => ({
            requestAccessToken: (options) => {
              window.oauthRequests.push({ client_id, ...options });
              window.oauthCallbacks.push(callback);
              if (!window.deferYouTube) callback(window.youtubeError
                ? { error: 'consent_required' } : { access_token: 'test-token' });
            },
          }),
        },
      },
    };
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.hostname === 'history.example.test') {
      historyRequests.push({ path: url.pathname, authorization: request.headers().authorization });
      if (url.pathname === '/google-code') {
        assert.equal(request.headers()['x-requested-with'], 'XmlHttpRequest');
        assert.deepEqual(request.postDataJSON(), { code: 'test-code' });
        return route.fulfill({ json: { credential: 'history-id-token', accessToken: 'test-token' } });
      }
      if (url.pathname === '/state') return route.fulfill({ status: historyStateStatus, json: {
        account: 'account-a', email: 'listener@example.test', epoch: 1, revision: 0, periodHistory: true,
      } });
      if (url.pathname === '/rows') return route.fulfill({ json: { rows: [], next: null } });
      return route.fulfill({ json: { now: Math.floor(Date.now() / 1000) } });
    }
    if (url.href === 'https://www.youtube.com/iframe_api') {
      return route.fulfill({ contentType: 'text/javascript', body: playerScript });
    }
    if (url.hostname === 'www.youtube.com' && url.pathname === '/oembed') {
      return route.fulfill({ json: { title: 'Local video' } });
    }
    if (url.hostname !== 'www.googleapis.com' || !url.pathname.startsWith('/youtube/v3/')) return route.abort();
    const path = url.pathname.split('/').pop();
    const params = Object.fromEntries(url.searchParams);
    requests.push({ path, params, authorization: request.headers().authorization });
    if (path === 'channels') return route.fulfill({ json: { items: [{ snippet: { title: 'Test account' } }] } });
    if (path === 'playlists') {
      return route.fulfill({ json: params.pageToken ? {
        items: [{ id: 'list-b', snippet: { title: 'Playlist B' } }, { id: 'fail', snippet: { title: 'Unavailable' } },
          { id: 'slow', snippet: { title: 'Slow playlist' } }, { id: 'empty', snippet: { title: 'Empty playlist' } }],
      } : {
        items: [{ id: 'list-a', snippet: { title: 'Playlist A' } }], nextPageToken: 'catalog-next',
      } });
    }
    if (path === 'playlistItems') {
      if (params.playlistId === 'fail') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      if (params.playlistId === 'slow') await slowGate;
      const data = params.playlistId === 'list-a'
        ? params.pageToken
          ? { items: [item('item-a3', 'aaaaaaaaaaa', 'A again'), { id: 'unavailable', snippet: { title: 'Unavailable' } }] }
          : { items: [item('item-a1', 'aaaaaaaaaaa', 'First A'), item('item-a2', 'bbbbbbbbbbb', 'Second A')], nextPageToken: 'items-next' }
        : params.playlistId === 'empty' ? { items: [] }
          : params.playlistId === 'slow' && !params.pageToken
            ? { items: [item('item-slow', 'ccccccccccc', 'Slow video')], nextPageToken: 'slow-next' }
          : { items: [item('item-b1', 'ccccccccccc', 'First B')] };
      return route.fulfill({ json: data });
    }
    if (path === 'videos') return route.fulfill({ json: { items: [] } });
    return route.abort();
  });
  await page.goto(origin);
  await page.waitForFunction(() => ytReady);
  return { page, requests, historyRequests, releaseSlow,
    setHistoryStateStatus: (status) => { historyStateStatus = status; } };
}

async function signIn(page) {
  await page.evaluate(() => {
    googleClientId = 'test.apps.googleusercontent.com';
    requestYouTubeLogin();
  });
  await page.waitForFunction(() => document.querySelectorAll('#playlist-select option').length === 6);
}

async function openVideo(page, videoId) {
  await page.getByRole('button', { name: 'Open a YouTube URL or video ID' }).click();
  await page.getByLabel('VIDEO URL OR ID').fill(videoId);
  await page.getByRole('button', { name: 'OPEN', exact: true }).click();
}

function comment(id, text, likes, author = 'Listener') {
  return { snippet: { topLevelComment: { id, snippet: { textDisplay: text, likeCount: likes, authorDisplayName: author } } } };
}

async function setupCommentTest(t) {
  return setup(t, () => {
    localStorage.setItem('eraudio:youtube-credentials', JSON.stringify({ googleClientId: '', youtubeApiKey: 'test-key' }));
  });
}

test('comment fallback selects and attributes a plausible sampled tracklist without saving it to history', async (t) => {
  const { page } = await setupCommentTest(t);
  let commentRequests = 0;
  await page.route('**/youtube/v3/videos?*', (route) => route.fulfill({ json: {
    items: [{ snippet: { description: 'No tracklist here' }, contentDetails: { duration: 'PT5M' } }],
  } }));
  await page.route('**/youtube/v3/commentThreads?*', (route) => {
    commentRequests++;
    const url = new URL(route.request().url());
    assert.equal(url.searchParams.get('maxResults'), '50');
    assert.equal(url.searchParams.get('order'), 'relevance');
    assert.equal(url.searchParams.get('textFormat'), 'plainText');
    return route.fulfill({ json: { items: [
      comment('popular-moment', '0:20 Amazing transition!', 1000),
      comment('less-popular', '0:00 Track A\n0:30 Track B\n1:00 Track C', 2),
      comment('selected', '0:00 Artist - First\n0:30 <img src=x> - Second\n1:00 Artist - Third\n7:00 Out of range', 20, 'DJ <test>'),
      comment('duplicate', '0:00 First\n0:00 Second\n0:30 Third', 200),
      comment('questions', '0:00 what song?\n0:30 what song?\n1:00 what song?', 300),
      ...Array.from({ length: 45 }, (_, index) => comment(`filler-${index}`, 'No timestamps', 0)),
      comment('beyond-sample', '0:00 One\n0:30 Two\n1:00 Three', 10000),
    ] } });
  });
  await page.getByRole('button', { name: 'PL', exact: true }).click();
  await openVideo(page, 'aaaaaaaaaaa');
  await page.waitForFunction(() => document.querySelector('#marker-info').textContent.includes('POSSIBLE COMMENT TRACKLIST'));
  assert.equal(commentRequests, 1);
  assert.deepEqual(await page.locator('#marker-list button').allTextContents(),
    ['1. [00:00] Artist - First', '2. [00:30] <img src=x> - Second', '3. [01:00] Artist - Third']);
  assert.equal(await page.locator('#marker-list img').count(), 0);
  assert.match(await page.locator('#marker-comment-source').textContent(), /DJ <test> \(20 likes\)/);
  assert.equal(await page.locator('#marker-comment-source a').getAttribute('href'),
    'https://www.youtube.com/watch?v=aaaaaaaaaaa&lc=selected');
  assert.deepEqual(await page.evaluate(() => trackHistoryMeta(playingTrack).timestamps), []);
  await page.locator('#marker-list button').nth(1).dblclick();
  assert.deepEqual((await page.evaluate(() => window.playerEvents)).at(-1), ['seek', 30]);
  await page.locator('#marker-source-toggle').click();
  assert.equal(await page.locator('#marker-comment-source').isHidden(), true);
});

test('description timestamps bypass comment lookup and comment failures are explained', async (t) => {
  const { page } = await setupCommentTest(t);
  let commentRequests = 0;
  await page.route('**/youtube/v3/videos?*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('id');
    if (id === 'ccccccccccc') return route.fulfill({ status: 503 });
    return route.fulfill({ json: { items: [{ snippet: { description: id === 'aaaaaaaaaaa' ? '0:10 Description marker' : 'No timestamps' },
      contentDetails: { duration: 'PT5M' } }] } });
  });
  await page.route('**/youtube/v3/commentThreads?*', (route) => {
    commentRequests++;
    return route.fulfill({ status: 403, json: { error: { errors: [{ reason: 'commentsDisabled' }] } } });
  });
  await page.getByRole('button', { name: 'PL', exact: true }).click();
  await openVideo(page, 'aaaaaaaaaaa');
  await page.waitForFunction(() => document.querySelector('#marker-list').textContent.includes('Description marker'));
  assert.equal(commentRequests, 0);
  await openVideo(page, 'bbbbbbbbbbb');
  await page.waitForFunction(() => document.querySelector('#marker-list').textContent.includes('comments are disabled'));
  assert.equal(commentRequests, 1);
  await openVideo(page, 'ccccccccccc');
  await page.waitForFunction(() => document.querySelector('#marker-info').textContent === 'ERROR');
  assert.equal(commentRequests, 1);
});

test('comment fallback handles no candidates, retryable failures and late responses', async (t) => {
  const { page } = await setupCommentTest(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  let attempts = 0;
  await page.route('**/youtube/v3/videos?*', (route) => route.fulfill({ json: {
    items: [{ snippet: { description: 'Nothing here' }, contentDetails: { duration: 'PT5M' } }],
  } }));
  await page.route('**/youtube/v3/commentThreads?*', async (route) => {
    const id = new URL(route.request().url()).searchParams.get('videoId');
    if (id === 'aaaaaaaaaaa') {
      await gate;
      return route.fulfill({ json: { items: [comment('late', '0:00 One\n0:30 Two\n1:00 Three', 10)] } });
    }
    if (id === 'bbbbbbbbbbb' && ++attempts === 1) return route.fulfill({ status: 503, json: { error: {} } });
    return route.fulfill({ json: { items: [comment('moment', '0:12 Great!', 9)] } });
  });
  await page.getByRole('button', { name: 'PL', exact: true }).click();
  await openVideo(page, 'aaaaaaaaaaa');
  await page.waitForFunction(() => playingTrack?.markersLoading);
  await openVideo(page, 'bbbbbbbbbbb');
  await page.waitForFunction(() => document.querySelector('#marker-info').textContent === 'COMMENTS UNAVAILABLE');
  release();
  await page.waitForTimeout(100);
  assert.match(await page.locator('#marker-list').textContent(), /could not check YouTube comments/);
  await openVideo(page, 'bbbbbbbbbbb');
  await page.waitForFunction(() => document.querySelector('#marker-list').textContent.includes('no timestamps') ||
    document.querySelector('#marker-list').textContent.includes('No timestamps in the description or plausible'));
  assert.equal(attempts, 2);
  assert.equal(await page.locator('#marker-comment-source').isHidden(), true);
});

test('comment results are discarded if the API key changes while loading', async (t) => {
  const { page } = await setupCommentTest(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  await page.route('**/youtube/v3/videos?*', (route) => route.fulfill({ json: {
    items: [{ snippet: { description: 'No timestamps' }, contentDetails: { duration: 'PT5M' } }],
  } }));
  let requested = false;
  await page.route('**/youtube/v3/commentThreads?*', async (route) => {
    requested = true;
    await gate;
    return route.fulfill({ json: { items: [comment('stale', '0:00 One\n0:30 Two\n1:00 Three', 10)] } });
  });
  await page.getByRole('button', { name: 'PL', exact: true }).click();
  await openVideo(page, 'aaaaaaaaaaa');
  while (!requested) await page.waitForTimeout(20);
  await page.evaluate(() => { youtubeApiKey = ''; });
  release();
  await page.waitForFunction(() => !playingTrack.markersLoading);
  assert.equal(await page.evaluate(() => Boolean(playingTrack.markers)), false);
  assert.equal(await page.locator('#marker-comment-source').isHidden(), true);
  assert.equal(await page.locator('#marker-info').textContent(), 'SETUP REQUIRED');
});

test('comment-derived results expire and are refreshed without persisting old entries', async (t) => {
  const { page } = await setupCommentTest(t);
  let requests = 0;
  await page.route('**/youtube/v3/videos?*', (route) => route.fulfill({ json: {
    items: [{ snippet: { description: 'No timestamps' }, contentDetails: { duration: 'PT5M' } }],
  } }));
  await page.route('**/youtube/v3/commentThreads?*', (route) => {
    requests++;
    return route.fulfill({ json: requests === 1
      ? { items: [comment('old', '0:00 One\n0:30 Two\n1:00 Three', 5)] } : {} });
  });
  await page.evaluate(() => {
    const original = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 30 * 60 * 1000) {
        window.expireComment = callback;
        return 0;
      }
      return original(callback, delay, ...args);
    };
  });
  await page.getByRole('button', { name: 'PL', exact: true }).click();
  await openVideo(page, 'aaaaaaaaaaa');
  await page.waitForFunction(() => document.querySelector('#marker-info').textContent.includes('POSSIBLE COMMENT TRACKLIST'));
  await page.evaluate(() => window.expireComment());
  await page.waitForFunction(() => document.querySelector('#marker-list').textContent.includes('No timestamps in the description or plausible'));
  assert.equal(requests, 2);
  assert.equal(await page.locator('#marker-comment-source').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => trackHistoryMeta(playingTrack).timestamps), []);
});

async function checkPitchforkSpeed(t, browserType) {
  const { page } = await setup(t, null, { browserType });
  await page.getByRole('button', { name: 'DJ', exact: true }).click();
  const slider = page.locator('#speed-slider');
  const marker = page.locator('#speed-marker-value');
  const actual = page.locator('#speed-actual');
  assert.match(await actual.textContent(), /unavailable/);
  await openVideo(page, 'lkII03srb3U');
  await page.waitForFunction(() => document.querySelector('#speed-actual').textContent.includes('1.0000x'));

  await slider.fill('12000');
  assert.equal(await marker.textContent(), '20.00%');
  assert.equal(await page.locator('#val-speed').textContent(), '20.00%');
  assert.match(await slider.getAttribute('aria-valuetext'), /Requested 20.00%/);
  assert.match(await actual.textContent(), /0.00% \(1.0000x\)/);
  await slider.fill('18000');
  await page.waitForFunction(() => document.querySelector('#speed-actual').textContent.includes('1.2500x'));
  assert.equal(await marker.textContent(), '30.00%');
  await slider.fill('30000');
  await page.waitForFunction(() => document.querySelector('#speed-actual').textContent.includes('1.5000x'));
  assert.equal(await marker.textContent(), '50.00%');
  const bounds = await page.evaluate(() => {
    const row = document.querySelector('.pf-slider-row').getBoundingClientRect();
    const label = document.querySelector('#speed-marker-value').getBoundingClientRect();
    return { rowLeft: row.left, rowRight: row.right, labelLeft: label.left, labelRight: label.right };
  });
  assert.ok(bounds.labelLeft >= bounds.rowLeft && bounds.labelRight <= bounds.rowRight);

  await page.evaluate(() => {
    ytPlayer.availableRates = [0.5, 1, 1.25, 2];
    ytPlayer.rate = 1.25;
    playerOptions.events.onPlaybackRateChange({ data: 1.25 });
  });
  assert.match(await actual.textContent(), /25.00% \(1.2500x\)/);
  assert.equal(await marker.textContent(), '50.00%');
  await slider.fill('29999');
  assert.match(await actual.textContent(), /25.00% \(1.2500x\)/);
  await page.evaluate(() => {
    ytPlayer.rate = 1;
    playerOptions.events.onPlaybackRateChange({ data: 1 });
  });
  assert.match(await actual.textContent(), /0.00% \(1.0000x\)/);

  await openVideo(page, 'mmmmmmmmmmm');
  await page.waitForFunction(() => document.querySelector('#speed-actual').textContent.includes('1.0000x'));
  await page.evaluate(() => playerOptions.events.onError({ data: 150 }));
  await page.waitForTimeout(300);
  assert.match(await actual.textContent(), /video could not be played/);
}

test('Pitchfork distinguishes requested and actual speed in Chromium', { timeout: 20000 },
  (t) => checkPitchforkSpeed(t, chromium));
test('Pitchfork distinguishes requested and actual speed in Firefox', { timeout: 20000 },
  (t) => checkPitchforkSpeed(t, firefox));

test('one main Google sign-in syncs TOP without requesting YouTube access', async (t) => {
  const { page, historyRequests } = await setup(t, null, { unifiedSignIn: true });
  const google = page.getByRole('button', { name: 'Sign in with Google', exact: true });
  assert.equal(await google.count(), 1);
  assert.equal(await page.locator('.main-window').getByRole('button', { name: 'Sign in with Google', exact: true }).count(), 1);
  assert.equal(await page.locator('#history-account-sign-in, #history-sign-out').count(), 0);
  assert.equal(await page.evaluate(() => window.identityPrompts), 0);
  await google.click();
  await page.waitForFunction(() => historySync?.token && !historySyncBusy);
  assert.equal(await page.locator('#account-label').innerText(), 'listener@example.test');
  assert.equal(await page.locator('#account-sign-out').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => window.oauthRequests), []);
  assert.ok(historyRequests.length > 0);
  assert.ok(historyRequests.every((request) => request.authorization === 'Bearer history-id-token'));
  await page.setViewportSize({ width: 320, height: 700 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.addInitScript(() => { window.autoIdentity = true; });
  await page.reload();
  await page.waitForFunction(() => historySync?.token && !historySyncBusy);
  assert.deepEqual(await page.evaluate(() => window.oauthRequests), []);
});

test('combined code flow starts in the click and connects history and YouTube without reconnecting on reload', async (t) => {
  const { page, historyRequests } = await setup(t, null, { combinedSignIn: true });
  assert.equal(await page.locator('#youtube-login').isHidden(), true);
  await page.getByRole('button', { name: 'AUTHORIZE GOOGLE AND YOUTUBE' }).click();
  await page.waitForFunction(() => historySync?.token && youtubeAccessToken === 'test-token');
  assert.deepEqual(await page.evaluate(() => window.codeRequests), [{
    client_id: 'test.apps.googleusercontent.com',
    scope: 'openid email https://www.googleapis.com/auth/youtube.readonly',
    active: true,
  }]);
  assert.equal(await page.evaluate(() => window.oauthRequests.length), 0);
  assert.ok(historyRequests.some(({ path }) => path === '/google-code'));
  await page.waitForFunction(() => document.querySelectorAll('#playlist-select option').length === 6);
  const stored = await page.evaluate(() => Object.values(localStorage).join(' '));
  assert.ok(!stored.includes('history-id-token') && !stored.includes('test-token'));
  await page.locator('#youtube-settings').click();
  assert.equal(await page.locator('#client-id-input').isDisabled(), true);
  await page.locator('#credentials-cancel').click();
  await page.locator('#account-sign-out:enabled').click();
  assert.equal(await page.evaluate(() => youtubeAccessToken), '');
  await page.getByRole('button', { name: 'AUTHORIZE GOOGLE AND YOUTUBE' }).click();
  await page.waitForFunction(() => historySync?.token && youtubeAccessToken === 'test-token');
  await page.reload();
  assert.equal(await page.getByRole('button', { name: 'AUTHORIZE GOOGLE AND YOUTUBE' }).isVisible(), true);
  assert.equal(await page.evaluate(() => Boolean(historySync?.token)), false);
  assert.deepEqual(await page.evaluate(() => window.codeRequests), []);
});

test('combined code flow reports rejected consent and permits retry', async (t) => {
  const { page, historyRequests } = await setup(t, () => { window.codeError = true; }, { combinedSignIn: true });
  const button = page.getByRole('button', { name: 'AUTHORIZE GOOGLE AND YOUTUBE' });
  await button.click();
  await page.waitForFunction(() => document.querySelector('#login-notice-message').textContent.includes('not completed'));
  assert.equal(historyRequests.length, 0);
  assert.equal(await button.isEnabled(), true);
  await page.evaluate(() => { window.codeError = false; });
  await button.click();
  await page.waitForFunction(() => historySync?.token && youtubeAccessToken === 'test-token');
});

test('combined code flow reports a blocked popup and allows another attempt', async (t) => {
  const { page, historyRequests } = await setup(t, () => { window.codePopupError = true; }, { combinedSignIn: true });
  const button = page.getByRole('button', { name: 'AUTHORIZE GOOGLE AND YOUTUBE' });
  await button.click();
  await page.waitForFunction(() => document.querySelector('#login-notice-message').textContent.includes('popup_failed_to_open'));
  assert.equal(await button.isEnabled(), true);
  assert.equal(historyRequests.length, 0);
  await page.evaluate(() => { window.codePopupError = false; });
  await button.click();
  await page.waitForFunction(() => historySync?.token && youtubeAccessToken === 'test-token');
});

test('optional YouTube access reuses the signed-in account and reconnects only after prior consent', async (t) => {
  const { page, historyRequests, requests } = await setup(t, null, { unifiedSignIn: true });
  await page.locator('#youtube-login').click();
  assert.deepEqual(await page.evaluate(() => window.oauthRequests), []);
  assert.match(await page.locator('#login-notice-message').innerText(), /Sign in with Google in the main window first/);
  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  await page.waitForFunction(() => historySync?.token && !historySyncBusy);
  await page.locator('#youtube-login').click();
  await page.waitForFunction(() => document.querySelectorAll('#playlist-select option').length === 6);
  assert.deepEqual(await page.evaluate(() => window.oauthRequests), [{
    client_id: 'test.apps.googleusercontent.com', prompt: '', login_hint: 'listener@example.test',
  }]);
  assert.ok(requests.every((request) => request.authorization === 'Bearer test-token'));
  assert.ok(historyRequests.every((request) => request.authorization === 'Bearer history-id-token'));
  await page.addInitScript(() => { window.autoIdentity = true; });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#playlist-select option').length === 6);
  assert.equal(await page.evaluate(() => window.identityPrompts), 1);
  assert.deepEqual(await page.evaluate(() => window.oauthRequests), [{
    client_id: 'test.apps.googleusercontent.com', prompt: 'none', login_hint: 'listener@example.test',
  }]);
  await page.locator('#btn-hist').click();
  await page.locator('#account-sign-out:enabled').click();
  assert.equal(await page.evaluate(() => historySync), null);
  assert.equal(await page.evaluate(() => youtubeAccessToken), '');
  const stored = await page.evaluate(() => Object.values(localStorage).join(' '));
  assert.ok(!stored.includes('history-id-token') && !stored.includes('test-token') && !stored.includes('listener@example.test'));
});

test('sign-out clears both sessions and rejects late authorization and automatic sign-in', async (t) => {
  const { page } = await setup(t, null, { unifiedSignIn: true });
  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  await page.waitForFunction(() => historySync?.token && !historySyncBusy);
  await page.evaluate(() => { window.deferYouTube = true; });
  await page.locator('#youtube-login').click();
  await page.locator('#account-sign-out').click();
  await page.evaluate(() => {
    window.oauthCallbacks[0]({ access_token: 'late-token' });
    google.accounts.id.options.callback({ credential: 'history-id-token', select_by: 'auto' });
  });
  assert.equal(await page.evaluate(() => youtubeAccessToken), '');
  assert.equal(await page.evaluate(() => historySync), null);
  assert.equal(await page.evaluate(() => window.identityAutoSelectDisabled && window.identityCancelled), true);
  await page.addInitScript(() => { window.autoIdentity = true; });
  await page.reload();
  await page.waitForFunction(() => accountClientId !== '');
  assert.equal(await page.evaluate(() => window.identityPrompts), 0);
  assert.deepEqual(await page.evaluate(() => window.oauthRequests), []);
  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  await page.waitForFunction(() => historySync?.token && !historySyncBusy);
});

test('failed YouTube reconnection leaves history signed in and offers manual reconnection', async (t) => {
  const { page } = await setup(t, () => {
    localStorage.setItem('eraudio:account-reconnect', 'true');
    localStorage.setItem('eraudio:youtube-reconnect:test.apps.googleusercontent.com', 'true');
    window.autoIdentity = true;
    window.youtubeError = true;
  }, { unifiedSignIn: true });
  await page.waitForFunction(() => window.oauthRequests.length === 1 && !historySyncBusy);
  assert.ok(await page.evaluate(() => Boolean(historySync?.token)));
  assert.equal(await page.evaluate(() => youtubeAccessToken), '');
  assert.match(await page.locator('#playlist-status').innerText(), /Select CONNECT YOUTUBE/);
  await page.evaluate(() => { window.youtubeError = false; });
  await page.locator('#youtube-login').click();
  await page.waitForFunction(() => youtubeAccessToken === 'test-token');
});

test('expired history sign-in reconnects once and shared-computer pairing suppresses Google reconnection', async (t) => {
  const { page, setHistoryStateStatus } = await setup(t, null, { unifiedSignIn: true });
  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  await page.waitForFunction(() => historySync?.token && !historySyncBusy);
  setHistoryStateStatus(401);
  await page.evaluate(() => syncHistory());
  assert.equal(await page.evaluate(() => window.identityPrompts), 1);
  assert.equal(await page.evaluate(() => historySync.token), null);
  await page.evaluate(() => syncHistory());
  assert.equal(await page.evaluate(() => window.identityPrompts), 1);
  setHistoryStateStatus(200);
  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  await page.waitForFunction(() => historySync?.token && !historySyncBusy);
  await page.locator('#account-sign-out').click();
  await page.locator('#btn-hist').click();
  await page.locator('#history-sync-help').click();
  setHistoryStateStatus(401);
  await page.locator('#history-shared-start').click();
  await page.evaluate(() => google.accounts.id.options.callback({ credential: 'history-id-token', select_by: 'auto' }));
  assert.equal(await page.evaluate(() => historySync), null);
  assert.equal(await page.evaluate(() => window.identityCancelled), true);
  await page.locator('#shared-pair-cancel').click();
});

test('transport mode navigates the selected PL markers and keeps playback state', async (t) => {
  const { page } = await setup(t);
  await openVideo(page, 'aaaaaaaaaaa');
  await page.evaluate(() => {
    ytPlayer.duration = 90;
    ytPlayer.position = 15;
    ytPlayer.pauseVideo();
    playingTrack.markers = {
      chapters: [{ start: 0, title: 'First' }, { start: 10, title: 'Second' }, { start: 30, title: 'Third' }],
      timestamps: [{ start: 0, title: 'First' }, { start: 20, title: 'Other' }, { start: 100, title: 'Out of range' }],
      duration: 90,
    };
    renderMarkers();
  });
  await page.locator('#btn-pl').click();
  await page.getByRole('button', { name: 'Next track' }).click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: 'CURRENT PL' }).click();
  const next = page.getByRole('button', { name: 'Next PL item' });
  const previous = page.getByRole('button', { name: 'Previous PL item' });
  await next.click();
  assert.equal(await page.evaluate(() => ytPlayer.getCurrentTime()), 30);
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 2);
  assert.equal(await page.locator('#marker-list [data-marker="2"]').evaluate((item) => item.classList.contains('active')), true);
  await next.click();
  assert.match(await page.locator('#event-status').textContent(), /last PL item/);
  await previous.click();
  assert.equal(await page.evaluate(() => ytPlayer.getCurrentTime()), 10);
  await previous.click();
  assert.equal(await page.evaluate(() => ytPlayer.getCurrentTime()), 0);
  await previous.click();
  assert.match(await page.locator('#event-status').textContent(), /first PL item/);

  await page.locator('#marker-view-toggle').click();
  await next.click();
  assert.equal(await page.evaluate(() => ytPlayer.getCurrentTime()), 20);
  await next.click();
  assert.match(await page.locator('#event-status').textContent(), /last PL item/);
  assert.equal(await page.evaluate(() => ytPlayer.getCurrentTime()), 20);

  await page.reload();
  assert.equal(await page.getByRole('button', { name: 'Next PL item' }).count(), 1);
  await page.getByRole('button', { name: 'Previous PL item' }).focus();
  await page.keyboard.press('Shift+F10');
  assert.equal(await page.getByRole('menuitemradio', { name: 'CURRENT PL' }).getAttribute('aria-checked'), 'true');
  await page.getByRole('menuitemradio', { name: 'VIDEOS' }).click();
  assert.equal(await page.getByRole('button', { name: 'Next track' }).count(), 1);
});

test('transport PL mode navigates saved locations and reports an empty view', async (t) => {
  const { page } = await setup(t);
  await openVideo(page, 'aaaaaaaaaaa');
  await page.evaluate(() => {
    ytPlayer.duration = 90;
    ytPlayer.position = 5;
    savedLocations.set('aaaaaaaaaaa', [60, 10, 30, 100]);
    renderMarkers();
  });
  await page.locator('#btn-pl').click();
  await page.locator('#marker-source-toggle').click();
  await page.getByRole('button', { name: 'Previous track' }).click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: 'CURRENT PL' }).click();
  await page.getByRole('button', { name: 'Next PL item' }).click();
  assert.equal(await page.evaluate(() => ytPlayer.getCurrentTime()), 10);
  assert.equal(await page.evaluate(() => selectedLocation.index), 1);
  await page.getByRole('button', { name: 'Next PL item' }).click();
  assert.equal(await page.evaluate(() => ytPlayer.getCurrentTime()), 30);
  await page.getByRole('button', { name: 'Previous PL item' }).click();
  assert.equal(await page.evaluate(() => ytPlayer.getCurrentTime()), 10);
  await page.evaluate(() => { savedLocations.clear(); renderMarkers(); });
  await page.getByRole('button', { name: 'Next PL item' }).click();
  assert.match(await page.locator('#event-status').textContent(), /No playable items/);
});

test('PL navigation mode does not change automatic next-video playback', async (t) => {
  const { page } = await setup(t);
  await page.locator('#btn-vid').click();
  await signIn(page);
  await page.locator('#playlist-select').selectOption('youtube:list-a');
  await page.waitForFunction(() => document.querySelectorAll('#playlist-list button').length === 3);
  await page.locator('#playlist-list button').first().click({ clickCount: 2 });
  await page.getByRole('button', { name: 'Next track' }).click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: 'CURRENT PL' }).click();
  await page.evaluate(() => onPlayerStateChange({ data: YT.PlayerState.ENDED }));
  assert.deepEqual((await page.evaluate(() => window.playerEvents)).slice(-1), [['play', 'bbbbbbbbbbb']]);
});

test('brand pronunciation tooltip matches the README and works on hover and keyboard focus', async (t) => {
  const { page } = await setup(t);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const pronunciation = readme.split(/\r?\n/).find((line) => line.startsWith('**ErAudio:**')).replaceAll('**', '');
  const brand = page.locator('.title-bar-brand');
  assert.equal(await brand.getAttribute('data-tooltip'), pronunciation);
  assert.equal(await page.locator('#brand-pronunciation').textContent(), pronunciation);
  await page.setViewportSize({ width: 320, height: 480 });
  await brand.hover();
  const hovered = await brand.evaluate((element) => {
    const tooltip = getComputedStyle(element, '::after');
    return { visibility: tooltip.visibility, left: element.getBoundingClientRect().left + parseFloat(tooltip.left) };
  });
  assert.equal(hovered.visibility, 'visible');
  assert.ok(hovered.left >= 0);
  await page.mouse.move(319, 479);
  await page.keyboard.press('Tab');
  assert.equal(await brand.evaluate((element) => document.activeElement === element), true);
  assert.equal(await brand.evaluate((element) => getComputedStyle(element, '::after').visibility), 'visible');
});

test('timer and title overlay the spectrum without losing playback controls', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  await openVideo(page, 'aaaaaaaaaaa');
  await page.evaluate(() => {
    ytPlayer.duration = 180;
    ytPlayer.position = 45;
    onPlayerStateChange({ data: YT.PlayerState.PLAYING });
    updateTimeDisplay(45, 180);
  });
  const timer = page.locator('#timer-display');
  assert.equal(await page.locator('#playback-indicator').isVisible(), true);
  assert.equal(await page.locator('#time-display').textContent(), '00:45');
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector('#live-spectrum').getBoundingClientRect();
    const timer = document.querySelector('#timer-display').getBoundingClientRect();
    const title = document.querySelector('.marquee-container').getBoundingClientRect();
    return {
      inside: [timer, title].every((rect) => rect.top >= canvas.top && rect.bottom <= canvas.bottom
        && rect.left >= canvas.left && rect.right <= canvas.right),
      animated: getComputedStyle(document.querySelector('#track-title')).animationName,
      timerBackground: getComputedStyle(document.querySelector('#timer-display')).backgroundColor,
      titleBackground: getComputedStyle(document.querySelector('.marquee-container')).backgroundColor,
    };
  });
  assert.equal(layout.inside, true);
  assert.equal(layout.animated, 'marquee');
  assert.equal(layout.timerBackground, 'rgba(0, 0, 0, 0)');
  assert.equal(layout.titleBackground, 'rgba(0, 0, 0, 0)');

  await timer.click();
  assert.equal(await page.locator('#time-display').textContent(), '-02:15');
  assert.equal(await timer.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);
  await timer.press('Enter');
  assert.equal(await page.locator('#time-display').textContent(), '00:45');
  await page.evaluate(() => onPlayerStateChange({ data: YT.PlayerState.PAUSED }));
  assert.equal(await page.locator('#playback-indicator').isHidden(), true);

  const spectrum = page.locator('#live-spectrum');
  const canvas = await spectrum.boundingBox();
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height - 5, { button: 'right' });
  assert.equal(await page.locator('#spectrum-settings').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.locator('#visualizer-play').focus();
  await page.keyboard.press('Shift+F10');
  assert.equal(await page.locator('#spectrum-settings').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 480 });
  const narrowTimer = await timer.boundingBox();
  const narrowSpectrum = await page.locator('#live-spectrum').boundingBox();
  assert.ok(narrowTimer.x >= narrowSpectrum.x && narrowTimer.x + narrowTimer.width <= narrowSpectrum.x + narrowSpectrum.width);
  await timer.click();
  assert.equal(await page.locator('#time-display').textContent(), '-02:15');
});

test('right-clicking the visualizer toggles its interactive frequency settings', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  await openVideo(page, 'aaaaaaaaaaa');
  const canvas = await page.locator('#live-spectrum').boundingBox();
  const settings = page.locator('#spectrum-settings');
  const left = { x: canvas.x + 5, y: canvas.y + canvas.height - 5 };
  const right = { x: canvas.x + canvas.width - 5, y: canvas.y + canvas.height - 5 };
  await page.mouse.click(left.x, left.y, { button: 'right' });
  assert.equal(await settings.isVisible(), true);
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);
  const slider = await page.locator('#spectrum-bands').boundingBox();
  const sliderY = slider.y + slider.height / 2;
  await page.mouse.move(slider.x + slider.width * 0.35, sliderY);
  await page.mouse.down();
  await page.mouse.move(slider.x + slider.width * 0.75, sliderY, { steps: 5 });
  await page.mouse.up();
  const draggedBands = Number(await page.locator('#spectrum-bands').inputValue());
  assert.ok(draggedBands > 192);
  assert.equal(await page.evaluate(() => localStorage.getItem('eraudio:spectrum-bands')), String(draggedBands));
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);
  const bandCount = page.getByRole('spinbutton', { name: 'Spectrum band count' });
  await bandCount.click();
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);
  await bandCount.fill('64');
  assert.equal(await page.evaluate(() => localStorage.getItem('eraudio:spectrum-bands')), '64');
  await page.mouse.click(right.x, right.y, { button: 'right' });
  assert.equal(await settings.isHidden(), true);
  await page.mouse.click(left.x, left.y, { button: 'right' });
  assert.equal(await settings.isVisible(), true);
  assert.equal(await page.locator('#spectrum-bands').inputValue(), '64');
  await settings.click({ button: 'right', position: { x: 5, y: 5 } });
  assert.equal(await settings.isHidden(), true);
  await page.mouse.click(left.x, left.y, { button: 'right' });
  assert.equal(await settings.isVisible(), true);
  await page.mouse.click(right.x, right.y);
  assert.equal(await settings.isHidden(), true);
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 2);
  await page.mouse.click(left.x, left.y, { button: 'right' });
  await bandCount.click();
  await bandCount.fill('96');
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 2);
  assert.equal(await settings.isVisible(), true);
});

test('visualizer fullscreen keeps the timer and title at the top without interrupting playback', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t, () => {
    let handle;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        setCaptureHandleConfig(config) { handle = config.handle; },
        async getDisplayMedia() {
          const context = new AudioContext();
          const [audio] = context.createMediaStreamDestination().stream.getAudioTracks();
          const video = { stop() {}, getCaptureHandle: () => ({ handle }) };
          window.endTestAudioSharing = () => {
            audio.dispatchEvent(new Event('ended'));
            return context.close();
          };
          return { getAudioTracks: () => [audio], getVideoTracks: () => [video], getTracks: () => [audio, video] };
        },
      },
    });
  });
  await openVideo(page, 'aaaaaaaaaaa');
  await page.waitForFunction(() => playingTrack?.title === 'Local video');
  const fullscreen = page.locator('#visualizer-fullscreen');
  const canvas = page.locator('#live-spectrum');
  const timer = page.locator('#timer-display');
  const title = page.locator('.marquee-container');
  assert.equal(await fullscreen.isHidden(), true);
  await fullscreen.evaluate((button) => button.click());
  assert.equal(await page.evaluate(() => document.fullscreenElement), null);
  await page.getByRole('button', { name: 'SHARE TAB AUDIO FOR VISUALIZER' }).click();
  await fullscreen.waitFor({ state: 'visible' });
  const original = await canvas.boundingBox();

  await fullscreen.click();
  await page.getByRole('button', { name: 'Exit visualizer fullscreen' }).waitFor();
  const layout = await page.evaluate(() => {
    const spectrum = document.querySelector('#live-spectrum').getBoundingClientRect();
    return { x: spectrum.x, y: spectrum.y, rightGap: innerWidth - spectrum.right,
      bottomGap: innerHeight - spectrum.bottom };
  });
  for (const inset of Object.values(layout)) assert.ok(Math.abs(inset) < 1);
  const [timerBox, titleBox, buttonBox] = await Promise.all([timer.boundingBox(), title.boundingBox(), fullscreen.boundingBox()]);
  assert.ok(timerBox.y < 8 && titleBox.y < 8 && titleBox.width > 0);
  assert.ok(timerBox.x + timerBox.width <= titleBox.x && titleBox.x + titleBox.width <= buttonBox.x);
  assert.match(await title.innerText(), /Local video/);
  await timer.click();
  assert.equal(await timer.getAttribute('aria-pressed'), 'true');
  await page.mouse.click(100, 100, { button: 'right' });
  assert.equal(await page.locator('#spectrum-settings').isVisible(), true);
  assert.equal(await page.locator('#spectrum-bands').evaluate((input) => input === document.activeElement), true);
  await fullscreen.click();
  await page.getByRole('button', { name: 'Enter visualizer fullscreen' }).waitFor();
  assert.deepEqual(await canvas.boundingBox(), original);
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);

  for (const key of ['Escape', 'a', 'Space']) {
    await fullscreen.click();
    await page.getByRole('button', { name: 'Exit visualizer fullscreen' }).waitFor();
    await page.keyboard.press(key);
    await page.getByRole('button', { name: 'Enter visualizer fullscreen' }).waitFor();
    assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);
  }

  await fullscreen.click();
  await page.getByRole('button', { name: 'Exit visualizer fullscreen' }).waitFor();
  await page.evaluate(() => window.endTestAudioSharing());
  await page.waitForFunction(() => document.fullscreenElement === null);
  assert.equal(await fullscreen.isHidden(), true);
});

test('the visualizer uses the transport play and pause actions', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  await openVideo(page, 'aaaaaaaaaaa');
  const syncPlayerUi = () => page.evaluate(() => onPlayerStateChange({ data: ytPlayer.getPlayerState() }));
  await syncPlayerUi();

  const visualizer = page.locator('#visualizer-play');
  const transport = page.locator('.transport-btn.play');
  const box = await visualizer.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 5);
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 2);
  await syncPlayerUi();
  assert.equal(await transport.getAttribute('aria-label'), 'Play');
  assert.equal(await visualizer.getAttribute('aria-label'), 'Play from visualizer');
  assert.equal(await page.locator('#playback-indicator').isHidden(), true);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 5);
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);
  await syncPlayerUi();
  assert.equal(await transport.getAttribute('aria-label'), 'Pause');
  assert.equal(await visualizer.getAttribute('aria-label'), 'Pause from visualizer');
  assert.equal(await page.locator('#playback-indicator').isVisible(), true);

  await visualizer.press('Space');
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 2);
});

test('the track title handles both mouse buttons without toggling playback', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  await openVideo(page, 'aaaaaaaaaaa');
  await page.waitForFunction(() => playingTrack?.title === 'Local video');
  const trackTitle = page.locator('#track-title');
  await trackTitle.evaluate((element) => { element.textContent = 'A long video title with more text to reveal. '.repeat(10); });
  const container = await page.locator('.marquee-container').boundingBox();
  const x = container.x + container.width / 2;
  const y = container.y + container.height / 2;
  const bounds = () => trackTitle.evaluate((element) => {
    const title = element.getBoundingClientRect();
    const container = element.parentElement;
    const clip = container.getBoundingClientRect();
    const style = getComputedStyle(container);
    return {
      left: title.left,
      leading: title.left - clip.left - parseFloat(style.paddingLeft),
      trailing: title.right - clip.right + parseFloat(style.paddingRight),
      animation: getComputedStyle(element).animationName,
    };
  });

  await page.mouse.click(x, y, { button: 'left' });
  const start = await bounds();
  assert.equal(start.animation, 'none');
  assert.ok(Math.abs(start.leading) < 1);
  assert.ok(start.trailing > 0);
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);
  assert.equal(await page.locator('#spectrum-settings').isHidden(), true);
  await trackTitle.evaluate((element) => new Promise((resolve) => {
    element.addEventListener('animationstart', resolve, { once: true });
  }));

  // Freeze the title partway through scrolling so the grab position is reproducible.
  await trackTitle.evaluate((element) => {
    const [animation] = element.getAnimations();
    const titleWidth = element.getBoundingClientRect().width;
    const overflow = titleWidth - element.parentElement.clientWidth;
    animation.pause();
    animation.currentTime = animation.effect.getTiming().duration * overflow / (4 * titleWidth);
  });
  const beforeDrag = await bounds();
  assert.ok(beforeDrag.leading < -1);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x, y }), 'track-title');
  await page.mouse.move(x, y);
  await page.mouse.down();
  assert.ok(Math.abs((await bounds()).leading - beforeDrag.leading) < 1);
  await page.mouse.move(Math.floor(container.x), y);
  const leftEdge = await bounds();
  assert.ok(Math.abs(leftEdge.trailing) < 1, `title end is ${leftEdge.trailing}px from the right inset`);
  await page.mouse.move(Math.ceil(container.x + container.width), y);
  const rightEdge = await bounds();
  const rightInset = await trackTitle.evaluate((element) => {
    const clip = element.parentElement;
    return clip.getBoundingClientRect().right - parseFloat(getComputedStyle(clip).paddingRight);
  });
  assert.ok(Math.abs(rightEdge.left - rightInset) < 1, `title start is ${rightEdge.left - rightInset}px from the right inset`);
  const releaseX = Math.ceil(container.x + container.width) - 12;
  await page.mouse.move(releaseX, y);
  const releasedAt = await bounds();
  assert.ok(releasedAt.leading > 0, 'the title can be released past the left inset');
  assert.ok(releasedAt.left < rightEdge.left);
  await page.mouse.move(releaseX, container.y + container.height + 5);
  await page.mouse.up();
  const resumedOffset = (time) => trackTitle.evaluate((element, time) => {
    const [animation] = element.getAnimations();
    animation.currentTime = time;
    return element.getBoundingClientRect().left;
  }, time);
  const resumedAt = await resumedOffset(0);
  assert.ok(Math.abs(resumedAt - releasedAt.left) < 1);
  assert.ok(await resumedOffset(100) < resumedAt - 1);
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);

  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  assert.deepEqual(await bounds(), start);
  await page.mouse.move(0, y, { steps: 5 });
  const end = await bounds();
  assert.ok(end.leading < 0);
  assert.ok(Math.abs(end.trailing) < 1, `title end is ${end.trailing}px from the right inset`);
  await page.mouse.up({ button: 'right' });
  assert.deepEqual(await bounds(), end);
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);
  assert.equal(await page.locator('#spectrum-settings').isHidden(), true);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#track-title')).animationName === 'marquee');
});

test('VID reveals the same player in a border-only responsive pane without interrupting audio', async (t) => {
  const { page } = await setup(t);
  assert.equal(await page.getByRole('button', { name: 'VID', exact: true }).count(), 1);
  const toggle = page.locator('#btn-video');
  const pane = page.locator('#video-window');
  const frame = page.locator('#yt-player');
  assert.equal(await pane.getAttribute('aria-hidden'), 'true');
  assert.equal(await pane.evaluate((element) => element.hidden && element.inert), true);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.getByRole('region', { name: 'Video', exact: true }).count(), 0);
  await openVideo(page, 'aaaaaaaaaaa');
  await page.evaluate(() => {
    ytPlayer.position = 42;
    window.originalPlayerFrame = document.querySelector('#yt-player');
  });
  const events = await page.evaluate(() => window.playerEvents);

  for (const width of [800, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await toggle.click();
    assert.equal(await pane.evaluate((element) => !element.hidden && !element.inert), true);
    assert.equal(await pane.getAttribute('aria-hidden'), 'false');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('region', { name: 'Video', exact: true }).count(), 1);
    assert.equal(await pane.locator('.title-bar, button').count(), 0);
    const paneBox = await pane.boundingBox();
    const frameBox = await frame.boundingBox();
    assert.ok(Math.abs(frameBox.width - (paneBox.width - 2)) < 1);
    assert.ok(Math.abs(frameBox.height - (paneBox.height - 2)) < 1);
    assert.ok(frameBox.width >= 200 && frameBox.height >= 200);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await toggle.click();
    assert.equal(await pane.evaluate((element) => element.hidden && element.inert), true);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);
    assert.equal(await page.evaluate(() => ytPlayer.getCurrentTime()), 42);
    assert.equal(await frame.evaluate((element) => element === window.originalPlayerFrame), true);
    assert.deepEqual(await page.evaluate(() => window.playerEvents), events);
  }
  assert.equal(await page.evaluate(() => window.playerOptions.playerVars.controls), 1);
  await page.getByRole('button', { name: 'DJ', exact: true }).click();
  await page.locator('[data-action="pause"]').first().click();
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 2);
  await toggle.press('Space');
  await toggle.press('Space');
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 2);
});

test('native video playback changes update the main player and visualizer controls', async (t) => {
  const { page } = await setup(t);
  await openVideo(page, 'aaaaaaaaaaa');
  await page.locator('#btn-video').click();
  for (const [state, label] of [[1, 'Pause'], [2, 'Play'], [1, 'Pause']]) {
    await page.evaluate((state) => {
      ytPlayer.state = state;
      window.playerOptions.events.onStateChange({ data: state });
    }, state);
    assert.equal(await page.locator('.transport-btn[data-action="play"]').getAttribute('aria-label'), label);
    assert.equal(await page.locator('#visualizer-play').getAttribute('aria-label'), `${label} from visualizer`);
    assert.equal(await page.locator('[data-action="pause"]').first().getAttribute('aria-pressed'), String(state === 2));
    assert.equal(await page.locator('#video-window').evaluate((pane) => pane.hidden), false);
  }
});

test('optional panes minimize independently and reopen from the main player', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  assert.equal(await page.getByRole('button', { name: 'YT', exact: true }).getAttribute('data-tooltip'), 'YouTube');
  const panes = [
    ['btn-hist', 'history-window', 'Minimize listening history'],
    ['btn-vid', 'videos-window', 'Minimize videos'],
    ['btn-pl', 'playlist-window', 'Minimize chapters and timestamps'],
    ['btn-pf', 'pitchfork-window', 'Minimize Pitchfork'],
  ];
  assert.equal(await page.locator('.main-window').getByRole('button', { name: /Minimize/ }).count(), 0);
  for (const [toggleId] of panes) await page.locator(`#${toggleId}`).click();
  for (const [toggleId, paneId, label] of panes) {
    const toggle = page.locator(`#${toggleId}`);
    const pane = page.locator(`#${paneId}`);
    const title = pane.locator('.title-bar');
    const minimize = title.getByRole('button', { name: label });
    const titleBox = await title.boundingBox();
    const buttonBox = await minimize.boundingBox();
    assert.ok(titleBox.x + titleBox.width - (buttonBox.x + buttonBox.width) <= 5);
    await minimize.press('Enter');
    assert.equal(await pane.isHidden(), true);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await toggle.evaluate((button) => button === document.activeElement), true);
    for (const [, otherId] of panes) {
      if (otherId !== paneId) assert.equal(await page.locator(`#${otherId}`).isVisible(), true);
    }
    await toggle.press('Space');
    assert.equal(await pane.isVisible(), true);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  }
});

test('last played local video is selected and cued on reload, not an unplayed selection', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  assert.deepEqual(await page.evaluate(() => window.playerEvents), []);
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  await openVideo(page, 'aaaaaaaaaaa');
  await page.waitForFunction(() => playingTrack?.title === 'Local video');
  await page.evaluate(() => onPlayerStateChange({ data: YT.PlayerState.PLAYING }));
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: '+ ADD URL' }).click();
  await page.getByLabel('VIDEO URL OR ID').fill('bbbbbbbbbbb');
  await page.getByRole('button', { name: 'OPEN', exact: true }).click();
  await page.locator('#playlist-list button').nth(1).click();
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 5);

  await page.reload();
  await page.waitForFunction(() => ytReady && window.playerEvents.length > 0);
  assert.deepEqual(await page.evaluate(() => window.playerEvents), [['cue', 'aaaaaaaaaaa']]);
  assert.match(await page.locator('#track-title').textContent(), /Local video/);
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  const first = page.locator('#playlist-list button').first();
  assert.equal(await first.getAttribute('aria-pressed'), 'true');
  assert.equal(await first.evaluate((element) => element.classList.contains('active')), true);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);
  assert.equal(await page.evaluate(() => ytPlayer.videoId), 'aaaaaaaaaaa');
  await page.evaluate(() => onPlayerStateChange({ data: YT.PlayerState.PLAYING }));

  await first.click();
  await page.getByRole('button', { name: '- REMOVE' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('eraudio:last-played')), null);
  await page.reload();
  await page.waitForFunction(() => ytReady);
  assert.deepEqual(await page.evaluate(() => window.playerEvents), []);
});

test('last played playlist and history videos restore without adding them to Local Videos', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  await signIn(page);
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  await page.locator('#playlist-select').selectOption('youtube:list-a');
  await page.waitForFunction(() => document.querySelectorAll('#playlist-list button').length === 3);
  await page.locator('#playlist-list button').nth(1).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.evaluate(() => onPlayerStateChange({ data: YT.PlayerState.PLAYING }));
  await page.reload();
  await page.waitForFunction(() => ytReady && window.playerEvents.length > 0);
  assert.deepEqual(await page.evaluate(() => window.playerEvents), [['cue', 'bbbbbbbbbbb']]);
  assert.equal(await page.locator('#track-title').textContent(), 'Second A');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('eraudio:added-tracks'))), []);

  await page.evaluate(() => {
    playHistoryEntry({ videoId: 'ccccccccccc', start: 5, title: 'History video' });
    onPlayerStateChange({ data: YT.PlayerState.PLAYING });
  });
  await page.reload();
  await page.waitForFunction(() => ytReady && window.playerEvents.length > 0);
  assert.deepEqual(await page.evaluate(() => window.playerEvents), [['cue', 'ccccccccccc']]);
  assert.equal(await page.locator('#track-title').textContent(), 'History video');
});

test('invalid last played data is reported without preventing normal playback', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  await page.evaluate(() => localStorage.setItem('eraudio:last-played', '{bad json'));
  await page.reload();
  await page.waitForFunction(() => ytReady);
  assert.deepEqual(await page.evaluate(() => window.playerEvents), []);
  assert.match(await page.locator('#event-status').textContent(), /Could not restore the last played video/);
  await openVideo(page, 'aaaaaaaaaaa');
  await page.evaluate(() => onPlayerStateChange({ data: YT.PlayerState.PLAYING }));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('eraudio:last-played')).videoId), 'aaaaaaaaaaa');
});

test('play and cue requests before the player is ready retain their intended behavior', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  const events = await page.evaluate(async () => {
    const list = favoriteLists[0];
    list.tracks.push(
      { videoId: 'aaaaaaaaaaa', title: 'First', duration: '--:--' },
      { videoId: 'bbbbbbbbbbb', title: 'Second', duration: '--:--' },
    );
    ytReady = false;
    playTrack(list, list.tracks[0]);
    window.onYouTubeIframeAPIReady();
    await new Promise((resolve) => setTimeout(resolve, 0));
    ytReady = false;
    loadTrackIntoPlayer(list, list.tracks[1]);
    window.onYouTubeIframeAPIReady();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return window.playerEvents;
  });
  assert.deepEqual(events, [['play', 'aaaaaaaaaaa'], ['cue', 'bbbbbbbbbbb']]);
});

test('last played storage failures are reported without interrupting playback', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  await openVideo(page, 'aaaaaaaaaaa');
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'eraudio:last-played') throw new Error('Storage unavailable');
      return setItem.call(this, key, value);
    };
    onPlayerStateChange({ data: YT.PlayerState.PLAYING });
  });
  assert.equal(await page.evaluate(() => ytPlayer.getPlayerState()), 1);
  assert.match(await page.locator('#event-status').textContent(), /Could not save the last played video/);
});

test('playlist help toggles guidance while important statuses remain visible', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  const help = page.locator('#playlist-help-button');
  const status = page.locator('#playlist-status');
  const sortStatus = page.locator('#playlist-sort-status');
  assert.equal(await status.isHidden(), true);
  assert.equal(await help.getAttribute('aria-expanded'), 'false');
  await help.focus();
  await page.keyboard.press('Enter');
  assert.equal(await status.isVisible(), true);
  assert.equal(await help.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Space');
  assert.equal(await status.isHidden(), true);

  await signIn(page);
  await page.locator('#playlist-select').selectOption('youtube:list-b');
  await page.waitForFunction(() => document.querySelector('#playlist-sort-status').textContent.includes('Display only'));
  assert.equal(await status.isHidden(), true);
  assert.equal(await sortStatus.isHidden(), true);
  await help.click();
  assert.equal(await status.isVisible(), true);
  assert.equal(await sortStatus.isVisible(), true);
  await help.click();
  await page.locator('#playlist-select').selectOption('youtube:fail');
  await page.waitForFunction(() => document.querySelector('#playlist-status').textContent.includes('Could not load playlist'));
  assert.equal(await status.isVisible(), true);
  assert.equal(await help.getAttribute('aria-expanded'), 'false');
});

test('YouTube playlists are read-only views and preserve the local list and playing queue', { timeout: 20000 }, async (t) => {
  const { page, requests } = await setup(t);
  const select = page.locator('#playlist-select');
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  assert.deepEqual(await select.locator('option').allTextContents(), ['Local Videos']);
  await openVideo(page, 'lllllllllll');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('eraudio:added-tracks'))[0]?.title === 'Local video');
  const saved = await page.evaluate(() => localStorage.getItem('eraudio:added-tracks'));
  await signIn(page);
  assert.deepEqual(await select.locator('option').allTextContents(),
    ['Local Videos', 'Empty playlist', 'Playlist A', 'Playlist B', 'Slow playlist', 'Unavailable']);
  const eventsBefore = await page.evaluate(() => window.playerEvents.length);
  await select.selectOption('youtube:list-a');
  await page.waitForFunction(() => document.querySelector('#playlist-status').textContent.includes('1 unavailable item omitted'));
  assert.deepEqual(await page.locator('#playlist-list .playlist-track-title').allTextContents(),
    ['1. First A [--:--]', '2. Second A [--:--]', '3. A again [--:--]']);
  assert.equal(await page.evaluate(() => window.playerEvents.length), eventsBefore);
  assert.equal(await page.evaluate(() => localStorage.getItem('eraudio:added-tracks')), saved);
  assert.equal(await page.locator('[data-action="add-url"]').isDisabled(), true);
  assert.equal(await page.locator('[data-action="remove-track"]').isDisabled(), true);
  await page.locator('#playlist-list button').first().click({ button: 'right' });
  assert.equal(await page.getByRole('menuitem', { name: 'REMOVE FROM VIDEOS', includeHidden: true }).isHidden(), true);
  await page.keyboard.press('Escape');
  await page.locator('#playlist-list button').first().click();
  await select.selectOption('favorites');
  assert.equal(await page.locator('#playlist-list button').count(), 1);
  assert.equal(await page.locator('[data-action="add-url"]').isEnabled(), true);
  await page.getByRole('button', { name: 'Next track' }).click();
  assert.deepEqual((await page.evaluate(() => window.playerEvents)).slice(-2),
    [['play', 'aaaaaaaaaaa'], ['play', 'bbbbbbbbbbb']]);
  await select.selectOption('youtube:list-a');
  await page.waitForFunction(() => document.querySelector('#playlist-list')?.children.length === 3);
  assert.equal(await page.locator('#playlist-list button').nth(1).evaluate((element) => element.classList.contains('active')), true);
  await openVideo(page, 'mmmmmmmmmmm');
  assert.equal(await select.inputValue(), 'favorites');
  assert.equal(await page.locator('#playlist-list button').count(), 2);
  await page.reload();
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  assert.deepEqual(await page.locator('#playlist-list button').evaluateAll((buttons) => buttons.map((button) => button.dataset.videoId)),
    ['lllllllllll', 'mmmmmmmmmmm']);
  assert.ok(requests.some((request) => request.path === 'playlists' && request.params.pageToken === 'catalog-next'));
  assert.ok(requests.some((request) => request.path === 'playlistItems' && request.params.pageToken === 'items-next'));
  assert.ok(requests.filter((request) => request.path === 'playlistItems').every((request) => request.authorization === 'Bearer test-token'));
});

test('playlist filter matches as typed without changing the selected list or playback', { timeout: 20000 }, async (t) => {
  const { page, requests, releaseSlow } = await setup(t);
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  await signIn(page);
  const select = page.locator('#playlist-select');
  const filter = page.getByRole('searchbox', { name: 'FIND' });
  const visibleOptions = () => select.locator('option:not([hidden])').allTextContents();
  assert.deepEqual(await visibleOptions(),
    ['Local Videos', 'Empty playlist', 'Playlist A', 'Playlist B', 'Slow playlist', 'Unavailable']);

  await select.selectOption('youtube:list-a');
  await page.waitForFunction(() => document.querySelector('#playlist-info').textContent.includes('PLAYLIST A'));
  await page.locator('#playlist-list button').first().click();
  const eventsBefore = await page.evaluate(() => window.playerEvents.length);
  const requestsBefore = requests.length;
  await filter.fill('pLaYlIsT');
  assert.deepEqual(await visibleOptions(), ['Empty playlist', 'Playlist A', 'Playlist B', 'Slow playlist']);
  await filter.fill('playlist b');
  assert.deepEqual(await visibleOptions(), ['Playlist B']);
  assert.equal(await select.inputValue(), 'youtube:list-a');
  assert.equal(await page.locator('#playlist-list button').count(), 3);
  assert.equal(await page.evaluate(() => window.playerEvents.length), eventsBefore);
  assert.equal(requests.length, requestsBefore);
  await select.selectOption('youtube:list-b');
  await page.waitForFunction(() => document.querySelector('#playlist-info').textContent.includes('PLAYLIST B'));
  await filter.fill('no match');
  assert.deepEqual(await visibleOptions(), []);
  assert.match(await page.locator('#playlist-filter-status').textContent(), /No matching playlists/);
  assert.equal(await select.inputValue(), 'youtube:list-b');
  await filter.fill('local');
  assert.deepEqual(await visibleOptions(), ['Local Videos']);
  await select.selectOption('favorites');
  assert.equal(await select.inputValue(), 'favorites');

  await filter.fill('');
  await select.selectOption('youtube:slow');
  while (!requests.some((request) => request.params.playlistId === 'slow')) await page.waitForTimeout(20);
  await filter.fill('empty');
  releaseSlow();
  await page.waitForFunction(() => document.querySelector('#playlist-info').textContent.includes('SLOW PLAYLIST'));
  assert.equal(await select.inputValue(), 'youtube:slow');
  assert.deepEqual(await visibleOptions(), ['Empty playlist']);
  await filter.fill('');
  assert.deepEqual(await visibleOptions(),
    ['Local Videos', 'Empty playlist', 'Playlist A', 'Playlist B', 'Slow playlist', 'Unavailable']);
  await filter.fill('unavailable');
  await select.selectOption('youtube:fail');
  await page.waitForFunction(() => document.querySelector('#playlist-status').textContent.includes('Could not load playlist'));
  assert.equal(await select.inputValue(), 'youtube:slow');
  assert.deepEqual(await visibleOptions(), ['Unavailable']);
  await page.evaluate(() => resetAccountSession());
  assert.equal(await filter.inputValue(), '');
  assert.deepEqual(await visibleOptions(), ['Local Videos']);
});

test('playlist sorting uses view counts and all-time history without changing playback order', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  const statisticsRequests = [];
  await page.route('**/youtube/v3/videos?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('part') !== 'statistics') return route.fallback();
    assert.equal(url.searchParams.has('maxResults'), false);
    statisticsRequests.push({ ids: url.searchParams.get('id'), authorization: route.request().headers().authorization });
    return route.fulfill({ json: { items: [
      { id: 'aaaaaaaaaaa', statistics: { viewCount: '10' } },
      { id: 'bbbbbbbbbbb', statistics: { viewCount: '100' } },
    ] } });
  });
  await page.evaluate(async () => {
    await localHistoryReady;
    await localHistory.importData({
      type: 'eraudio-listening-history', version: 1,
      videos: [{ videoId: 'aaaaaaaaaaa', plays: 1 }, { videoId: 'bbbbbbbbbbb', plays: 5 }],
      spans: [
        { videoId: 'aaaaaaaaaaa', start: 0, end: 30, playedAt: 1 },
        { videoId: 'bbbbbbbbbbb', start: 0, end: 10, playedAt: 1 },
      ],
    });
  });
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  assert.equal(await page.locator('#playlist-columns').isHidden(), true);
  await signIn(page);
  await page.locator('#playlist-select').selectOption('youtube:list-a');
  await page.waitForFunction(() => document.querySelectorAll('#playlist-list button').length === 3);
  const items = page.locator('#playlist-list button');
  const ids = () => items.evaluateAll((buttons) => buttons.map((button) => button.dataset.track));
  const heading = (name) => page.locator(`[data-playlist-sort="${name}"]`);
  await page.waitForFunction(() => document.querySelector('#playlist-list button .playlist-metric:nth-child(3)')?.textContent === '1');
  assert.equal(statisticsRequests.length, 0);
  assert.deepEqual(await items.first().locator('.playlist-metric').allTextContents(), ['--', '1', '00:30']);
  await heading('views').click();
  await page.waitForFunction(() => document.querySelector('#playlist-list button .playlist-metric')?.textContent === '100');
  assert.deepEqual(await ids(), ['2', '1', '3']);
  assert.deepEqual(await items.first().locator('.playlist-metric').allTextContents(), ['100', '5', '00:10']);
  assert.equal(await heading('views').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(statisticsRequests, [{ ids: 'aaaaaaaaaaa,bbbbbbbbbbb', authorization: 'Bearer test-token' }]);

  await heading('views').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await ids(), ['1', '3', '2']);
  assert.match(await heading('views').getAttribute('aria-label'), /ascending/);
  await heading('views').click();
  await items.first().click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Next track' }).click();
  assert.equal(await page.evaluate(() => playingTrack.playlistItemId), 'item-a3');

  await heading('plays').click();
  await page.waitForFunction(() => document.querySelector('#playlist-list button .playlist-metric:nth-child(3)')?.textContent === '5');
  assert.deepEqual(await ids(), ['2', '1', '3']);
  await heading('time').click();
  await page.waitForFunction(() => document.querySelector('#playlist-list button .playlist-metric:nth-child(4)')?.textContent === '00:30');
  assert.deepEqual(await ids(), ['1', '3', '2']);
  await page.evaluate(async () => {
    await localHistory.importData({
      type: 'eraudio-listening-history', version: 1, videos: [],
      spans: [{ videoId: 'bbbbbbbbbbb', start: 10, end: 40, playedAt: 2 }],
    });
  });
  await page.waitForFunction(() => document.querySelector('#playlist-list button .playlist-metric:nth-child(4)')?.textContent === '00:40');
  assert.deepEqual(await ids(), ['2', '1', '3']);
  await heading('original').click();
  assert.deepEqual(await ids(), ['1', '2', '3']);
  await page.locator('#playlist-select').selectOption('favorites');
  assert.equal(await page.locator('#playlist-columns').isHidden(), true);
});

test('playlist sorting reports missing statistics and API failures without changing playlist order', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  let fail = false;
  await page.route('**/youtube/v3/videos?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('part') !== 'statistics') return route.fallback();
    if (fail) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    return route.fulfill({ json: { items: [{ id: 'bbbbbbbbbbb', statistics: { viewCount: '0' } }] } });
  });
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  await signIn(page);
  await page.locator('#playlist-select').selectOption('youtube:list-a');
  await page.waitForFunction(() => document.querySelectorAll('#playlist-list button').length === 3);
  await page.locator('[data-playlist-sort="views"]').click();
  await page.waitForFunction(() => document.querySelector('#playlist-sort-status').textContent.includes('unavailable'));
  const items = page.locator('#playlist-list button');
  assert.deepEqual(await items.evaluateAll((buttons) => buttons.map((button) => button.dataset.track)), ['2', '1', '3']);
  assert.equal(await items.nth(1).locator('.playlist-metric').first().textContent(), '--');
  await page.locator('[data-playlist-sort="original"]').click();
  fail = true;
  await page.locator('#playlist-select').selectOption('youtube:fail');
  await page.waitForFunction(() => document.querySelector('#playlist-status').textContent.includes('Could not load playlist'));
  assert.equal(await page.locator('[data-playlist-sort="original"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await items.evaluateAll((buttons) => buttons.map((button) => button.dataset.track)), ['1', '2', '3']);
  await page.locator('[data-playlist-sort="views"]').click();
  await page.waitForFunction(() => document.querySelector('#playlist-sort-status').textContent.includes('Could not load YouTube view counts'));
  assert.equal(await page.locator('#playlist-sort-status').isVisible(), true);
  assert.equal(await page.locator('[data-playlist-sort="original"]').getAttribute('aria-pressed'), 'true');
  fail = false;
  await page.locator('[data-playlist-sort="views"]').click();
  await page.waitForFunction(() => document.querySelector('#playlist-sort-status').textContent.includes('unavailable'));
});

test('view statistics are batched and late responses cannot reorder another playlist', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  const batches = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  await page.route('**/youtube/v3/videos?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('part') !== 'statistics') return route.fallback();
    const ids = url.searchParams.get('id').split(',');
    batches.push(ids);
    if (batches.length === 4) await gate;
    return route.fulfill({ json: { items: ids.map((id) => ({ id, statistics: { viewCount: String(Number(id)) } })) } });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  await page.evaluate(() => {
    const tracks = Array.from({ length: 101 }, (_, index) => ({
      videoId: String(index).padStart(11, '0'), title: `Video ${index}`, duration: '--:--',
    }));
    favoriteLists.push({ id: 'youtube:large', name: 'Large', tracks });
    playlistSelect.add(new Option('Large', 'youtube:large'));
    playlistSelect.value = 'youtube:large';
    renderFavoritesList('youtube:large');
  });
  await page.setViewportSize({ width: 360, height: 720 });
  const layout = await page.evaluate(() => {
    const table = document.querySelector('.playlist-table');
    const headers = [...document.querySelectorAll('#playlist-columns button')];
    const cells = [...document.querySelector('#playlist-list button').children];
    return {
      scrolls: table.scrollWidth > table.clientWidth,
      pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      offsets: headers.map((header, index) => Math.abs(header.getBoundingClientRect().left - cells[index].getBoundingClientRect().left)),
    };
  });
  assert.equal(layout.scrolls, true);
  assert.equal(layout.pageFits, true);
  assert.ok(layout.offsets.every((offset) => offset <= 3), `Columns should align: ${layout.offsets}`);
  await page.locator('[data-playlist-sort="views"]').click();
  await page.waitForFunction(() => document.querySelector('#playlist-list button .playlist-metric')?.textContent === '100');
  assert.deepEqual(batches.map((batch) => batch.length), [50, 50, 1]);
  assert.equal(await page.locator('#playlist-list button').first().getAttribute('data-track'), '101');

  await page.evaluate(() => { resetPlaylistSort(); renderFavoritesList(currentListId); });
  await page.locator('[data-playlist-sort="views"]').click();
  await page.waitForTimeout(100);
  assert.equal(batches.length, 4);
  await page.locator('#playlist-select').selectOption('youtube:list-b');
  await page.waitForFunction(() => document.querySelector('#playlist-info').textContent.includes('PLAYLIST B'));
  release();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-playlist-sort="original"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#playlist-list button').first().getAttribute('data-video-id'), 'ccccccccccc');
  assert.equal(batches.length, 4);
});

test('playlist errors and late responses leave the selected local or newer view intact', { timeout: 20000 }, async (t) => {
  const { page, requests, releaseSlow } = await setup(t);
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  await openVideo(page, 'lllllllllll');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('eraudio:added-tracks') || '[]')[0]?.title === 'Local video');
  const saved = await page.evaluate(() => localStorage.getItem('eraudio:added-tracks'));
  await signIn(page);
  const select = page.locator('#playlist-select');
  await select.selectOption('youtube:fail');
  await page.waitForFunction(() => document.querySelector('#playlist-status').textContent.includes('Could not load playlist'));
  assert.equal(await select.inputValue(), 'favorites');
  assert.equal(await page.locator('#playlist-list button').first().getAttribute('data-video-id'), 'lllllllllll');
  assert.equal(await page.evaluate(() => localStorage.getItem('eraudio:added-tracks')), saved);

  await select.selectOption('youtube:slow');
  while (!requests.some((request) => request.params.playlistId === 'slow')) {
    await page.waitForTimeout(20);
  }
  await select.selectOption('youtube:list-b');
  await page.waitForFunction(() => document.querySelector('#playlist-info').textContent.includes('PLAYLIST B'));
  releaseSlow();
  await page.waitForTimeout(150);
  assert.equal(await select.inputValue(), 'youtube:list-b');
  assert.equal(await page.locator('#playlist-list button').first().getAttribute('data-video-id'), 'ccccccccccc');
  await page.evaluate(() => playHistoryEntry({ videoId: 'ccccccccccc', start: 0, title: 'First B' }));
  assert.equal(await page.evaluate(() => playingList), null);
  await select.selectOption('youtube:empty');
  await page.waitForFunction(() => document.querySelector('#playlist-status').textContent.includes('has no videos'));
  assert.equal(await page.locator('#playlist-list button').count(), 0);
  await select.selectOption('favorites');
  assert.equal(await page.evaluate(() => localStorage.getItem('eraudio:added-tracks')), saved);
});

test('resetting YouTube settings cancels an in-flight playlist without changing local videos', { timeout: 20000 }, async (t) => {
  const { page, requests, releaseSlow } = await setup(t);
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  await openVideo(page, 'lllllllllll');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('eraudio:added-tracks') || '[]')[0]?.title === 'Local video');
  const saved = await page.evaluate(() => localStorage.getItem('eraudio:added-tracks'));
  await signIn(page);
  const select = page.locator('#playlist-select');
  await select.selectOption('youtube:slow');
  while (!requests.some((request) => request.params.playlistId === 'slow')) {
    await page.waitForTimeout(20);
  }
  await page.evaluate(() => resetAccountSession());
  releaseSlow();
  await page.waitForTimeout(150);
  assert.deepEqual(await select.locator('option').allTextContents(), ['Local Videos']);
  assert.equal(await select.inputValue(), 'favorites');
  assert.equal(await page.locator('#playlist-list button').first().getAttribute('data-video-id'), 'lllllllllll');
  assert.equal(await page.evaluate(() => localStorage.getItem('eraudio:added-tracks')), saved);
  assert.equal(requests.some((request) => request.params.pageToken === 'slow-next'), false);
});

async function checkPlaylistHistory(t, endFirst) {
  const { page } = await setup(t);
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  await openVideo(page, 'aaaaaaaaaaa');
  await page.evaluate(async (endFirst) => {
    await localHistoryReady;
    window.testNow = new Date(2026, 2, 9, 12).getTime();
    Date.now = () => window.testNow;
    ytPlayer.duration = 60;
    ytPlayer.position = 0;
    recordListening(YT.PlayerState.PLAYING);
    window.testNow += 7000;
    ytPlayer.position = 7;
    recordListening(YT.PlayerState.PLAYING);
    if (endFirst) {
      ytPlayer.state = YT.PlayerState.ENDED;
      onPlayerStateChange({ data: YT.PlayerState.ENDED });
    }
    await listeningHistory.queue;
  }, endFirst);
  await signIn(page);
  await page.locator('#playlist-select').selectOption('youtube:list-a');
  await page.waitForFunction(() => document.querySelector('#playlist-info').textContent.includes('PLAYLIST A'));
  await page.locator('#playlist-list button').first().click();
  if (endFirst) await page.getByRole('button', { name: 'Play', exact: true }).click();
  const history = await page.evaluate(async () => {
    window.testNow += 1000;
    ytPlayer.position = 0;
    recordListening(YT.PlayerState.PLAYING);
    window.testNow += 7000;
    ytPlayer.position = 7;
    recordListening(YT.PlayerState.PLAYING);
    ytPlayer.state = YT.PlayerState.ENDED;
    onPlayerStateChange({ data: YT.PlayerState.ENDED });
    await listeningHistory.queue;
    return listeningHistory.getAll();
  });
  assert.equal(history.videos.length, 1);
  assert.equal(history.videos[0].videoId, 'aaaaaaaaaaa');
  assert.equal(history.videos[0].plays, 2);
  assert.notEqual(history.spans[0].sessionId, history.spans[1].sessionId);
  assert.ok(history.spans.every((span) => span.playedUntil > span.playedAt && span.sessionStartedAt <= span.playedAt));
  assert.deepEqual(history.spans.map(({ videoId, start, end }) => ({ videoId, start, end })), [
    { videoId: 'aaaaaaaaaaa', start: 0, end: 7 },
    { videoId: 'aaaaaaaaaaa', start: 0, end: 7 },
  ]);
  const today = await page.evaluate((data) => ErAudioHistory.filterPeriod(data, 'today'), history);
  assert.equal(today.videos[0].plays, 2);
  await page.getByRole('button', { name: 'TOP', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#history-list .history-detail')?.textContent === 'LISTENS 2 / TIME 00:14');
  await page.getByRole('radio', { name: 'VIDEOS', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#history-list .history-detail')?.textContent === 'PLAYS 2 / TIME 00:14');
  await page.reload();
  await page.waitForFunction(() => ytReady);
  await page.getByRole('button', { name: 'TOP', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#history-list .history-detail')?.textContent === 'LISTENS 2 / TIME 00:14');
}

test('TOP combines the same video across playlists after finishing', { timeout: 20000 }, (t) => checkPlaylistHistory(t, true));
test('TOP combines the same video across playlists when restarted while playing', { timeout: 20000 }, (t) => checkPlaylistHistory(t, false));

test('pausing and resuming still counts as one play', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
  await page.getByRole('button', { name: 'YT', exact: true }).click();
  await openVideo(page, 'aaaaaaaaaaa');
  const history = await page.evaluate(async () => {
    await localHistoryReady;
    window.testNow = Date.now();
    Date.now = () => window.testNow;
    ytPlayer.duration = 60;
    ytPlayer.position = 0;
    recordListening(YT.PlayerState.PLAYING);
    window.testNow += 7000;
    ytPlayer.position = 7;
    recordListening(YT.PlayerState.PLAYING);
    ytPlayer.state = YT.PlayerState.PAUSED;
    onPlayerStateChange({ data: YT.PlayerState.PAUSED });
    window.testNow += 1000;
    ytPlayer.state = YT.PlayerState.PLAYING;
    onPlayerStateChange({ data: YT.PlayerState.PLAYING });
    window.testNow += 7000;
    ytPlayer.position = 14;
    recordListening(YT.PlayerState.PLAYING);
    ytPlayer.state = YT.PlayerState.ENDED;
    onPlayerStateChange({ data: YT.PlayerState.ENDED });
    await listeningHistory.queue;
    return listeningHistory.getAll();
  });
  assert.equal(history.videos[0].plays, 1);
  assert.deepEqual(history.spans.map(({ start, end }) => ({ start, end })), [{ start: 0, end: 14 }]);
});
