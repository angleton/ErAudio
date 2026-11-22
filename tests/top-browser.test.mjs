import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { chromium, firefox } from 'playwright';
import worker from '../cloudflare/history-worker.mjs';
import { audience, jwk, token, testDatabase } from './history-fixture.mjs';

async function serve(t, handler) {
  const server = createServer((req, res) => {
    handler(req, res).catch((error) => {
      t.diagnostic(error.stack);
      res.writeHead(500).end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/history.js', ['history.js', 'text/javascript']],
  ['/history-sync.js', ['history-sync.js', 'text/javascript']],
  ['/tempo.js', ['tempo.js', 'text/javascript']],
  ['/visualizer/spectrum.js', ['visualizer/spectrum.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']],
]);

test('the interface fills the viewport while retaining usable controls in smaller windows', { timeout: 20000 }, async (t) => {
  const origin = await serve(t, async (req, res) => {
    if (req.url === '/ErAudio.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    const asset = assets.get(req.url);
    if (!asset) return res.writeHead(404).end();
    const [file, type] = asset;
    res.writeHead(200, { 'Content-Type': type }).end(await readFile(new URL(`../${file}`, import.meta.url)));
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);

  const dimensions = () => page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    return {
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      app: { width: rect('.winamp-container').width, height: rect('.winamp-container').height },
      spectrum: rect('#live-spectrum').height,
      videos: rect('#playlist-list').height,
      history: rect('#history-list').height,
      timerFont: getComputedStyle(document.querySelector('#time-display')).fontSize,
    };
  });
  const normal = await dimensions();
  assert.equal(normal.app.width, normal.width);
  assert.equal(normal.scrollWidth, normal.width);
  assert.equal(normal.scrollHeight, normal.height);

  await page.setViewportSize({ width: 1100, height: 1100 });
  const taller = await dimensions();
  assert.ok(taller.spectrum > normal.spectrum + 250);
  assert.equal(taller.timerFont, normal.timerFont);
  assert.equal(taller.scrollHeight, taller.height);

  await page.getByRole('button', { name: 'VID', exact: true }).click();
  await page.getByRole('button', { name: 'TOP', exact: true }).click();
  const historyBox = await page.locator('#history-window').boundingBox();
  const mainBox = await page.locator('.main-window').boundingBox();
  const videosBox = await page.locator('#videos-window').boundingBox();
  assert.ok(historyBox.y + historyBox.height <= mainBox.y);
  assert.ok(mainBox.y + mainBox.height <= videosBox.y);
  assert.equal(await page.evaluate(() => Boolean(
    document.querySelector('#history-window').compareDocumentPosition(document.querySelector('.main-window'))
      & Node.DOCUMENT_POSITION_FOLLOWING,
  )), true);
  const lists = await dimensions();
  await page.setViewportSize({ width: 1100, height: 1600 });
  const tallerLists = await dimensions();
  assert.ok(tallerLists.videos > lists.videos + 100);
  assert.ok(tallerLists.history > lists.history + 100);
  assert.equal(tallerLists.scrollHeight, tallerLists.height);
  await page.getByRole('button', { name: 'TOP', exact: true }).click();
  assert.equal(await page.locator('#history-window').isHidden(), true);
  await page.getByRole('button', { name: 'TOP', exact: true }).click();
  assert.equal(await page.locator('#history-window').isVisible(), true);

  await page.getByRole('button', { name: 'PL', exact: true }).click();
  await page.getByRole('button', { name: 'DJ', exact: true }).click();
  await page.getByRole('button', { name: 'TOP', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 360 });
  await page.getByRole('button', { name: 'TOP', exact: true }).click();
  const historyTop = await page.locator('#history-window').evaluate((element) => element.getBoundingClientRect().top);
  assert.ok(historyTop >= 0 && historyTop < 10, 'opening TOP brings its top into view');
  const small = await dimensions();
  assert.equal(small.app.width, small.width);
  assert.equal(small.scrollWidth, small.width);
  assert.ok(small.scrollHeight > small.height);
  assert.equal(small.timerFont, normal.timerFont);
  const smallHistory = await page.locator('#history-window').boundingBox();
  const smallMain = await page.locator('.main-window').boundingBox();
  const smallDj = await page.locator('#pitchfork-window').boundingBox();
  const smallVideos = await page.locator('#videos-window').boundingBox();
  const smallChapters = await page.locator('#playlist-window').boundingBox();
  assert.ok(smallHistory.y + smallHistory.height <= smallMain.y);
  assert.ok(smallMain.y + smallMain.height <= smallDj.y);
  assert.ok(smallDj.y + smallDj.height <= smallVideos.y);
  assert.ok(smallVideos.y + smallVideos.height <= smallChapters.y);
  const lastControl = page.locator('#history-clear');
  await lastControl.scrollIntoViewIfNeeded();
  const box = await lastControl.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= small.width);
});

test('the main player can grow and shrink with every panel open', { timeout: 20000 }, async (t) => {
  const origin = await serve(t, async (req, res) => {
    if (req.url === '/ErAudio.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    const asset = assets.get(req.url);
    if (!asset) return res.writeHead(404).end();
    const [file, type] = asset;
    res.writeHead(200, { 'Content-Type': type }).end(await readFile(new URL(`../${file}`, import.meta.url)));
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  for (const id of ['btn-hist', 'btn-vid', 'btn-pl', 'btn-pf']) await page.locator(`#${id}`).click();

  const panel = page.locator('.main-window');
  const handle = page.getByRole('button', { name: 'Resize main player vertically' });
  const height = () => panel.evaluate((element) => element.offsetHeight);
  const before = await height();
  const spectrumBefore = (await page.locator('#live-spectrum').boundingBox()).height;
  await handle.scrollIntoViewIfNeeded();
  const grip = await handle.boundingBox();
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  const distance = 100;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + distance, { steps: 8 });
  await page.mouse.up();
  assert.ok(await height() >= before + 95);
  assert.ok((await page.locator('#live-spectrum').boundingBox()).height >= spectrumBefore + 95);
  const saved = await height();
  await page.reload();
  assert.equal(await height(), saved);

  await page.setViewportSize({ width: 360, height: 700 });
  for (let i = 0; i < Math.ceil(saved / 10); i++) await handle.press('ArrowUp');
  const min = await height();
  assert.ok(min < saved);
  await handle.press('ArrowUp');
  assert.equal(await height(), min);
  const bounds = await panel.boundingBox();
  for (const selector of ['#live-level-setup', '.control-panel', '#player-resize']) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box.y >= bounds.y && box.y + box.height <= bounds.y + bounds.height, `${selector} stays inside the player`);
  }
  assert.ok((await page.locator('#live-spectrum').boundingBox()).height >= 80);
});

test('a populated TOP list can shrink to one or two visible entries', { timeout: 20000 }, async (t) => {
  const origin = await serve(t, async (req, res) => {
    if (req.url === '/ErAudio.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    const asset = assets.get(req.url);
    if (!asset) return res.writeHead(404).end();
    const [file, type] = asset;
    res.writeHead(200, { 'Content-Type': type }).end(await readFile(new URL(`../${file}`, import.meta.url)));
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(async () => {
    await localHistoryReady;
    const now = Date.now();
    const videos = Array.from({ length: 12 }, (_, index) => ({
      videoId: `video${String(index).padStart(6, '0')}`,
      title: `Test video ${index + 1}`,
      duration: 60,
    }));
    await localHistory.importData({
      type: 'eraudio-listening-history', version: 1, videos,
      spans: videos.map(({ videoId }) => ({ videoId, start: 0, end: 30, playedAt: now })),
    });
  });

  const openTop = async () => {
    await page.getByRole('button', { name: 'TOP', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#history-list [role="listitem"]').length === 12);
  };
  const panel = page.locator('#history-window');
  const handle = page.locator('#history-resize');
  const list = page.locator('#history-list');
  const visibleRows = () => list.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [...element.children].filter((row) => {
      const { top, bottom } = row.getBoundingClientRect();
      return top >= bounds.top && bottom <= bounds.bottom;
    }).length;
  });
  await openTop();
  const before = await panel.boundingBox();
  assert.ok(await visibleRows() > 2);
  await handle.scrollIntoViewIfNeeded();
  const grip = await handle.boundingBox();
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, Math.max(1, y - before.height), { steps: 10 });
  await page.mouse.up();

  const rows = await visibleRows();
  assert.ok(rows >= 1 && rows <= 2, `expected 1 or 2 complete rows after shrinking, got ${rows}`);
  assert.equal(await list.evaluate((element) => element.scrollHeight > element.clientHeight), true);
  await page.locator('#history-clear').click({ trial: true });
  const compactHeight = (await panel.boundingBox()).height;
  await page.reload();
  await openTop();
  assert.equal((await panel.boundingBox()).height, compactHeight);
  await page.setViewportSize({ width: 1100, height: 1200 });
  assert.equal((await panel.boundingBox()).height, compactHeight);
  for (let i = 0; i < 8; i++) await handle.press('ArrowDown');
  assert.ok(await visibleRows() > rows);
});

test('starts idle and persists video additions and context-menu removals', { timeout: 20000 }, async (t) => {
  const origin = await serve(t, async (req, res) => {
    if (req.url === '/ErAudio.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    const asset = assets.get(req.url);
    if (!asset) return res.writeHead(404).end();
    const [file, type] = asset;
    res.writeHead(200, { 'Content-Type': type }).end(await readFile(new URL(`../${file}`, import.meta.url)));
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.href !== 'https://www.youtube.com/iframe_api') return route.abort();
    return route.fulfill({
      contentType: 'text/javascript',
      body: `window.videoLoads = [];
        window.YT = { Player: class {
          constructor(id, options) { queueMicrotask(() => options.events.onReady()); }
          setVolume() {}
          loadVideoById(videoId) { window.videoLoads.push(videoId); }
          getPlayerState() { return -1; }
        }, PlayerState: { PLAYING: 1, PAUSED: 2, CUED: 5 } };
        window.onYouTubeIframeAPIReady();`,
    });
  });
  async function checkIdle() {
    await page.waitForFunction(() => ytReady);
    assert.deepEqual(await page.evaluate(() => window.videoLoads), []);
    assert.match(await page.locator('#track-title').textContent(), /press .* to open a YouTube video/);
  }
  await page.goto(origin);
  await checkIdle();
  await page.getByRole('button', { name: 'VID', exact: true }).click();
  assert.equal(await page.locator('#playlist-list button').count(), 0);

  await page.getByRole('button', { name: 'Open a YouTube URL or video ID' }).click();
  await page.getByLabel('VIDEO URL OR ID').fill('abcdefghijk');
  await page.getByRole('button', { name: 'OPEN', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.videoLoads), ['abcdefghijk']);
  await page.reload();
  await checkIdle();
  await page.getByRole('button', { name: 'VID', exact: true }).click();
  assert.equal(await page.locator('#playlist-list button').count(), 1);
  assert.equal(await page.locator('#playlist-list button').getAttribute('data-video-id'), 'abcdefghijk');

  await page.getByRole('button', { name: '+ ADD URL', exact: true }).click();
  await page.getByLabel('VIDEO URL OR ID').fill('lmnopqrstuv');
  await page.locator('#open-dialog [type="submit"]').click();
  const kept = page.locator('#playlist-list [data-video-id="abcdefghijk"]');
  const removed = page.locator('#playlist-list [data-video-id="lmnopqrstuv"]');
  await kept.click({ modifiers: ['Control'] });
  await removed.click({ button: 'right' });
  await page.keyboard.press('End');
  const remove = page.getByRole('menuitem', { name: 'REMOVE FROM VIDEOS' });
  assert.equal(await remove.evaluate((item) => item === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await removed.count(), 0);
  assert.equal(await kept.getAttribute('aria-pressed'), 'true');
  await page.reload();
  await page.getByRole('button', { name: 'VID', exact: true }).click();
  assert.equal(await removed.count(), 0);
  assert.equal(await kept.count(), 1);

  await page.locator('.vis-container').click({ button: 'right' });
  const spectrumBands = page.getByRole('slider', { name: 'FREQUENCY BANDS' });
  await spectrumBands.evaluate((input) => {
    input.value = '512';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.locator('#spectrum-band-value').inputValue(), '512');
  assert.equal(await page.evaluate(() => localStorage.getItem('eraudio:spectrum-bands')), '512');

  const spectrumBandNumber = page.getByRole('spinbutton', { name: 'Spectrum band count' });
  await spectrumBandNumber.fill('800');
  await spectrumBandNumber.press('Enter');
  assert.equal(await page.evaluate(() => localStorage.getItem('eraudio:spectrum-bands')), '512');

  await page.locator('.vis-container').click({ button: 'right' });
  await spectrumBandNumber.fill('128');
  await spectrumBandNumber.press('Escape');
  assert.equal(await page.evaluate(() => localStorage.getItem('eraudio:spectrum-bands')), '512');
  assert.match(await page.locator('#live-spectrum').getAttribute('aria-label'), /512 frequency bands/);

  await page.locator('.vis-container').click({ button: 'right' });
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  assert.equal(await page.locator('#spectrum-settings').isHidden(), true);

  await page.reload();
  await page.locator('.vis-container').click({ button: 'right' });
  assert.equal(await page.locator('#spectrum-bands').inputValue(), '512');
  assert.match(await page.locator('#live-spectrum').getAttribute('aria-label'), /512 frequency bands/);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'DJ', exact: true }).click();
  await page.evaluate(() => showLiveTempo(128));
  assert.equal(await page.locator('#bpm-left').innerText(), '128\nAUTO');
  assert.equal(await page.locator('#bpm-right').innerText(), '128\nAUTO');
  await page.locator('#bpm-left').click();
  assert.equal(await page.locator('#bpm-left .pf-bpm-mode').textContent(), 'MANUAL');
  await page.evaluate(() => showLiveTempo(130));
  assert.equal(await page.locator('#bpm-left .pf-bpm-reading').textContent(), '128');
  assert.equal(await page.locator('#bpm-right .pf-bpm-reading').textContent(), '130');
});

test('live spectrum uses the shared renderer and stops sampling while paused', { timeout: 15000 }, async (t) => {
  const origin = await serve(t, async (req, res) => {
    if (req.url === '/ErAudio.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    const asset = assets.get(req.url);
    if (!asset) return res.writeHead(404).end();
    const [file, type] = asset;
    res.writeHead(200, { 'Content-Type': type }).end(await readFile(new URL(`../${file}`, import.meta.url)));
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let handle;
    const audio = {
      readyState: 'live', stop() {},
      addEventListener(event, callback) { if (event === 'ended') window.stopSharedAudio = callback; },
    };
    const video = { stop() {}, getCaptureHandle: () => ({ handle }) };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        setCaptureHandleConfig(config) { handle = config.handle; },
        async getDisplayMedia() {
          return {
            getVideoTracks: () => [video], getAudioTracks: () => [audio], getTracks: () => [video, audio],
          };
        },
      },
    });
    window.MediaStream = class {};
    window.spectrumReads = 0;
    window.AudioContext = class {
      sampleRate = 44100;
      state = 'running';
      createAnalyser() {
        return {
          fftSize: 0,
          get frequencyBinCount() { return this.fftSize / 2; },
          getFloatFrequencyData(bins) { window.spectrumReads++; bins.fill(-55); },
        };
      }
      createMediaStreamSource() { return { connect() {} }; }
      async resume() {}
      async close() { this.state = 'closed'; }
    };
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    return route.abort();
  });
  await page.goto(origin);
  const share = page.getByRole('button', { name: 'SHARE TAB AUDIO FOR VISUALIZER' });
  assert.match(await page.locator('#live-level-status').textContent(), /Enable the visualizer and BPM/);
  await share.click();
  await page.waitForFunction(() => window.spectrumReads > 2);
  assert.equal(await page.locator('#live-level-setup').isHidden(), true);
  assert.equal(await page.locator('#live-spectrum').evaluate((canvas) =>
    canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      .data.some((value, index) => index % 4 === 3 && value > 0)), true);
  const readsAtPause = await page.evaluate(() => { liveLevelsPaused = true; return window.spectrumReads; });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.spectrumReads), readsAtPause);
  await page.evaluate(() => { liveLevelsPaused = false; });
  await page.waitForFunction((previous) => window.spectrumReads > previous, readsAtPause);
  await page.evaluate(() => window.stopSharedAudio());
  assert.equal(await share.isVisible(), true);
  assert.match(await page.locator('#live-level-status').textContent(), /restore the visualizer and BPM/);
  assert.deepEqual(errors, []);
});

const ids = { a: 'aaaaaaaaaaa', b: 'bbbbbbbbbbb', z: 'zzzzzzzzzzz' };

function fixture(entries) {
  return {
    type: 'eraudio-listening-history', version: 1,
    videos: entries.map(([name, playedAt]) => ({
      videoId: ids[name], title: `Video ${name.toUpperCase()}`, duration: 30,
      chapters: [{ start: 0, title: 'Opening' }, { start: 10, title: 'Next' }],
      timestamps: [], plays: 1, lastPlayed: playedAt,
    })),
    spans: entries.map(([name, playedAt, start = 0]) => ({ videoId: ids[name], start, end: start + 10, playedAt })),
  };
}

test('TOP filters calendar periods and preserves dated plays in backups', { timeout: 20000 }, async (t) => {
  const origin = await serve(t, async (req, res) => {
    if (req.url === '/ErAudio.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    const asset = assets.get(req.url);
    if (!asset) return res.writeHead(404).end();
    const [file, type] = asset;
    res.writeHead(200, { 'Content-Type': type }).end(await readFile(new URL(`../${file}`, import.meta.url)));
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ timezoneId: 'America/New_York' });
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    await localHistoryReady;
    const today = Date.parse('2026-03-09T10:00:00-04:00');
    const yesterday = Date.parse('2026-03-08T10:00:00-04:00');
    Date.now = () => Date.parse('2026-03-09T12:00:00-04:00');
    const data = {
      type: 'eraudio-listening-history', version: 1,
      videos: [
        { videoId: 'aaaaaaaaaaa', title: 'Recent', duration: 30, chapters: [], timestamps: [], plays: 2, lastPlayed: today },
        { videoId: 'bbbbbbbbbbb', title: 'Older', duration: 30, chapters: [], timestamps: [], plays: 1, lastPlayed: yesterday },
        { videoId: 'zzzzzzzzzzz', title: 'Legacy', duration: 30, chapters: [], timestamps: [], plays: 5, lastPlayed: today },
      ],
      spans: [
        { videoId: 'aaaaaaaaaaa', start: 0, end: 10, playedAt: today, playedUntil: today + 10000,
          sessionId: '00000000-0000-0000-0000-000000000001', sessionStartedAt: today },
        { videoId: 'aaaaaaaaaaa', start: 0, end: 10, playedAt: yesterday },
        { videoId: 'bbbbbbbbbbb', start: 0, end: 10, playedAt: yesterday },
        { videoId: 'zzzzzzzzzzz', start: 0, end: 10, playedAt: today },
      ],
    };
    const legacy = structuredClone(data);
    delete legacy.spans[0].sessionId;
    delete legacy.spans[0].sessionStartedAt;
    delete legacy.spans[0].playedUntil;
    const first = await localHistory.importData(legacy);
    const second = await localHistory.importData(data);
    await localHistory.importData(legacy);
    const exported = await localHistory.exportData();
    return { first, second, exported };
  });
  assert.equal(result.first.spans, 4);
  assert.equal(result.second.spans, 0);
  assert.equal(result.exported.spans[0].sessionId, '00000000-0000-0000-0000-000000000001');
  await page.getByRole('button', { name: 'TOP', exact: true }).click();
  const period = page.getByLabel('TIME PERIOD');
  assert.equal(await period.inputValue(), 'all');
  await period.selectOption('today');
  await page.locator('#history-view').click();
  await page.waitForFunction(() => document.querySelectorAll('#history-list button').length === 2);
  assert.match(await page.locator('#history-list [data-history-location="aaaaaaaaaaa:0"]').innerText(), /PLAYS 1 \/ TIME 00:10/);
  assert.match(await page.locator('#history-list [data-history-location="zzzzzzzzzzz:0"]').innerText(), /PLAYS ≥0 \/ TIME 00:10/);
  assert.equal(await page.locator('#history-list [data-history-location="bbbbbbbbbbb:0"]').count(), 0);
  assert.equal(await page.locator('#history-period-note').isVisible(), true);
  await period.selectOption('week');
  await page.waitForFunction(() => document.querySelectorAll('#history-list button').length === 3);
  await period.selectOption('all');
  await page.waitForFunction(() => document.querySelector('#history-list [data-history-location="zzzzzzzzzzz:0"] .history-detail')?.textContent === 'PLAYS 5 / TIME 00:10');
  assert.equal(await page.locator('#history-period-note').isHidden(), true);
});

test('playing video and segment highlights follow playback across the lists', { timeout: 20000 }, async (t) => {
  const origin = await serve(t, async (req, res) => {
    if (req.url === '/ErAudio.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    const asset = assets.get(req.url);
    if (!asset) return res.writeHead(404).end();
    const [file, type] = asset;
    res.writeHead(200, { 'Content-Type': type }).end(await readFile(new URL(`../${file}`, import.meta.url)));
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(async () => {
    await localHistoryReady;
    const markers = parseDescriptionMarkers('0:00 Opening\n0:20 Middle\n0:40 End', 60);
    const videoId = 'aaaaaaaaaaa';
    await localHistory.importData({
      type: 'eraudio-listening-history', version: 1,
      videos: [{ videoId, title: 'Test video', plays: 1, lastPlayed: Date.now(), ...markers }],
      spans: [{ videoId, start: 0, end: 60, playedAt: Date.now() }],
    });
    const { track } = addTrack(videoId);
    addTrack('bbbbbbbbbbb');
    window.YT = { PlayerState: { PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5, ENDED: 0 } };
    ytReady = true;
    ytPlayer = {
      state: -1,
      getVideoData() { return { video_id: this.videoId }; },
      getCurrentTime() { return this.position; },
      getDuration() { return 60; },
      getPlayerState() { return this.state; },
      setPlaybackRate() {},
      seekTo(position) { this.position = position; },
      loadVideoById({ videoId, startSeconds }) {
        this.videoId = videoId;
        this.position = startSeconds;
      },
      stopVideo() { this.state = -1; },
    };
    playTrack(null, { ...track, title: 'Test video', markers }, 5);
  });
  for (const name of ['VID', 'PL', 'TOP']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page.locator('#history-list [data-history-location="aaaaaaaaaaa:0"]').waitFor();
  const highlights = () => page.locator('.playlist-item.now-playing').evaluateAll((rows) => rows.map((row) => [
    row.closest('#history-list, #playlist-list, #marker-list').id,
    row.dataset.historyLocation ?? row.dataset.videoId ?? row.dataset.marker,
    row.getAttribute('aria-current'),
  ]));
  assert.deepEqual(await highlights(), []);
  await page.evaluate(() => {
    ytPlayer.state = YT.PlayerState.PLAYING;
    onPlayerStateChange({ data: ytPlayer.state });
  });
  assert.deepEqual(await highlights(), [
    ['history-list', 'aaaaaaaaaaa:0', 'time'], ['playlist-list', 'aaaaaaaaaaa', 'true'], ['marker-list', '0', 'time'],
  ]);

  await page.evaluate(() => seekPlayback(20));
  await page.locator('#history-list [data-history-location="aaaaaaaaaaa:20"].now-playing').waitFor();
  assert.deepEqual(await highlights(), [
    ['history-list', 'aaaaaaaaaaa:20', 'time'], ['playlist-list', 'aaaaaaaaaaa', 'true'], ['marker-list', '1', 'time'],
  ]);
  await page.locator('#history-view').click();
  await page.locator('#history-list [aria-current="true"]').waitFor();
  assert.deepEqual(await highlights(), [
    ['history-list', 'aaaaaaaaaaa:0', 'true'], ['playlist-list', 'aaaaaaaaaaa', 'true'], ['marker-list', '1', 'time'],
  ]);

  await page.evaluate(() => {
    ytPlayer.state = YT.PlayerState.PAUSED;
    onPlayerStateChange({ data: ytPlayer.state });
  });
  assert.deepEqual(await highlights(), []);
  await page.evaluate(() => {
    ytPlayer.state = YT.PlayerState.PLAYING;
    onPlayerStateChange({ data: ytPlayer.state });
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  assert.deepEqual(await highlights(), []);
});

function waitForTop(page, mode, entries) {
  const expected = entries.map(([name, count, seconds, start = 0], rank) => [
    `${ids[name]}:${start}`,
    `${rank + 1}. Video ${name.toUpperCase()}${mode === 'LISTENS'
      ? ` / [00:${String(start).padStart(2, '0')}] ${start ? 'Next' : 'Opening'}` : ''}`,
    `${mode} ${count} / TIME 00:${seconds}`,
  ]);
  return page.waitForFunction((wanted) => {
    const buttons = Array.from(document.querySelectorAll('#history-list button'));
    const rows = buttons.map((button) => [
      button.dataset.historyLocation,
      button.firstChild.textContent,
      button.querySelector('.history-detail').textContent,
    ]);
    return JSON.stringify(rows) === JSON.stringify(wanted);
  }, expected, { timeout: 8000 }).catch(async (error) => {
    const actual = await page.locator('#history-window').innerText();
    throw new Error(`TOP did not show ${JSON.stringify(expected)}.\nActual:\n${actual}`, { cause: error });
  });
}

async function importHistory(page, data) {
  const uploaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/rows' && response.request().method() === 'POST');
  await page.locator('#history-file').setInputFiles({
    name: 'synthetic-history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  assert.equal((await uploaded).status(), 200);
  await page.locator('#history-sign-out:enabled').waitFor();
}

test('TOP converges in both directions across Chromium and Firefox', { timeout: 45000 }, async (t) => {
  const db = testDatabase();
  t.after(() => db.close());
  const env = { GOOGLE_CLIENT_ID: audience, HISTORY_DB: db };
  const endpoint = await serve(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(new URL(req.url, endpoint), {
      method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers))
      .end(Buffer.from(await response.arrayBuffer()));
  });
  const origin = await serve(t, async (req, res) => {
    const { pathname } = new URL(req.url, origin);
    if (pathname === '/ErAudio.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ historySync: { endpoint, googleClientId: audience } }));
      return;
    }
    const asset = assets.get(pathname);
    if (!asset) return res.writeHead(404).end();
    const [file, type] = asset;
    res.writeHead(200, { 'Content-Type': type }).end(await readFile(new URL(`../${file}`, import.meta.url)));
  });
  env.APP_ORIGIN = origin;
  t.mock.method(globalThis, 'fetch', (url) => {
    assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
    return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'max-age=3600' } });
  });

  async function openBrowser(engine) {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if ([origin, endpoint].includes(url.origin)) return route.continue();
      if (url.href !== 'https://accounts.google.com/gsi/client') return route.abort();
      return route.fulfill({
        contentType: 'text/javascript',
        body: `window.google = { accounts: { id: {
          initialize({ callback }) { this.callback = callback; },
          disableAutoSelect() {},
          renderButton(parent) {
            parent.style.display = 'block';
            const button = document.createElement('button');
            button.textContent = 'Sign in with Google';
            button.onclick = () => this.callback({ credential: ${JSON.stringify(token('10000001'))} });
            parent.append(button);
          }
        } } };`,
      });
    });
    await page.goto(origin);
    const top = page.locator('#btn-hist');
    await top.click();
    const signIn = page.getByRole('button', { name: 'Sign in with Google', exact: true });
    const signOut = page.getByRole('button', { name: 'STOP SYNC & SIGN OUT' });
    const help = page.locator('#history-sync-help');
    const view = page.locator('#history-view');
    const assertToolbarOrder = async (accountButton) => {
      const [accountBox, helpBox, viewBox] = await Promise.all(
        [accountButton, help, view].map((button) => button.boundingBox()),
      );
      assert.ok(accountBox && helpBox && viewBox);
      assert.ok(accountBox.x + accountBox.width <= helpBox.x && helpBox.x + helpBox.width <= viewBox.x);
      const centerY = ({ y, height }) => y + height / 2;
      assert.ok(Math.abs(centerY(accountBox) - centerY(viewBox)) <= 1);
      assert.ok(Math.abs(centerY(helpBox) - centerY(viewBox)) <= 1);
    };
    await signIn.waitFor();
    await assertToolbarOrder(signIn);
    await signIn.click();
    await help.click();
    await page.getByText('Private history synced.', { exact: true }).waitFor().catch(async (error) => {
      throw new Error(`Could not sign into local sync: ${await page.locator('#history-sync-status').innerText()}`, { cause: error });
    });
    await page.locator('#history-google button').waitFor({ state: 'hidden' });
    await signOut.waitFor({ state: 'visible' });
    await help.click();
    await assertToolbarOrder(signOut);
    return { page, top, view, signIn, signOut };
  }

  async function reopenTop({ top }) {
    await top.click();
    await top.click();
  }

  const first = await openBrowser(chromium);
  const second = await openBrowser(firefox);
  await importHistory(first.page, fixture([['z', 100], ['b', 200]]));
  await reopenTop(second);
  const initial = [['b', 1, 10], ['z', 1, 10]];
  await Promise.all([first, second].map(({ page }) => waitForTop(page, 'LISTENS', initial)));

  await importHistory(second.page, fixture([['a', 300], ['z', 400], ['b', 500, 10]]));
  await reopenTop(first);
  const segments = [['z', 2, 20], ['a', 1, 10], ['b', 1, 10], ['b', 1, 10, 10]];
  await Promise.all([first, second].map(async ({ page, view }) => {
    await waitForTop(page, 'LISTENS', segments);
    await view.click();
    await waitForTop(page, 'PLAYS', [['b', 2, 20], ['z', 2, 20], ['a', 1, 10]]);
  }));
  const fixedNow = await first.page.evaluate(() => new Date(2026, 2, 9, 12).getTime());
  await Promise.all([first, second].map(({ page }) => page.evaluate((now) => { Date.now = () => now; }, fixedNow)));
  const recent = fixture([['a', fixedNow - 3600000]]);
  Object.assign(recent.spans[0], {
    sessionId: '00000000-0000-0000-0000-000000000001',
    sessionStartedAt: fixedNow - 3600000, playedUntil: fixedNow - 3590000,
  });
  await importHistory(first.page, recent);
  await reopenTop(second);
  await Promise.all([first, second].map(async ({ page }) => {
    await page.getByLabel('TIME PERIOD').selectOption('today');
    await waitForTop(page, 'PLAYS', [['a', 1, 10]]);
  }));
  await first.signOut.click();
  await first.signIn.waitFor({ state: 'visible' });
  await first.signOut.waitFor({ state: 'hidden' });
});
