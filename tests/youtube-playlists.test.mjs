import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

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
      constructor(id, options) { this.state = -1; queueMicrotask(() => options.events.onReady()); }
      setVolume() {}
      setPlaybackRate() {}
      loadVideoById(video) {
        this.videoId = typeof video === 'string' ? video : video.videoId;
        this.state = 1;
        window.playerEvents.push(['play', this.videoId]);
      }
      cueVideoById(videoId) { this.videoId = videoId; this.state = 5; window.playerEvents.push(['cue', videoId]); }
      getPlayerState() { return this.state; }
      getDuration() { return 0; }
      getCurrentTime() { return 0; }
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

async function setup(t) {
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/ErAudio.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
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
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const requests = [];
  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  t.after(releaseSlow);
  await page.addInitScript(() => {
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: ({ callback }) => ({
            requestAccessToken: () => callback({ access_token: 'test-token' }),
          }),
        },
      },
    };
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
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
  return { page, requests, releaseSlow };
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

test('YouTube playlists are read-only views and preserve the local list and playing queue', { timeout: 20000 }, async (t) => {
  const { page, requests } = await setup(t);
  const select = page.locator('#playlist-select');
  await page.getByRole('button', { name: 'VID', exact: true }).click();
  assert.deepEqual(await select.locator('option').allTextContents(), ['Local Videos']);
  await openVideo(page, 'lllllllllll');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('eraudio:added-tracks'))[0]?.title === 'Local video');
  const saved = await page.evaluate(() => localStorage.getItem('eraudio:added-tracks'));
  await signIn(page);
  assert.deepEqual(await select.locator('option').allTextContents(),
    ['Local Videos', 'Playlist A', 'Playlist B', 'Unavailable', 'Slow playlist', 'Empty playlist']);
  const eventsBefore = await page.evaluate(() => window.playerEvents.length);
  await select.selectOption('youtube:list-a');
  await page.waitForFunction(() => document.querySelector('#playlist-status').textContent.includes('1 unavailable item omitted'));
  assert.deepEqual(await page.locator('#playlist-list button').allTextContents(),
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
  await page.getByRole('button', { name: 'VID', exact: true }).click();
  assert.deepEqual(await page.locator('#playlist-list button').evaluateAll((buttons) => buttons.map((button) => button.dataset.videoId)),
    ['lllllllllll', 'mmmmmmmmmmm']);
  assert.ok(requests.some((request) => request.path === 'playlists' && request.params.pageToken === 'catalog-next'));
  assert.ok(requests.some((request) => request.path === 'playlistItems' && request.params.pageToken === 'items-next'));
  assert.ok(requests.filter((request) => request.path === 'playlistItems').every((request) => request.authorization === 'Bearer test-token'));
});

test('playlist errors and late responses leave the selected local or newer view intact', { timeout: 20000 }, async (t) => {
  const { page, requests, releaseSlow } = await setup(t);
  await page.getByRole('button', { name: 'VID', exact: true }).click();
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
  await page.getByRole('button', { name: 'VID', exact: true }).click();
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
