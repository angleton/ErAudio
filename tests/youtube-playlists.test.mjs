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
        this.position = 0;
        this.state = 1;
        window.playerEvents.push(['play', this.videoId]);
      }
      cueVideoById(videoId) { this.videoId = videoId; this.position = 0; this.state = 5; window.playerEvents.push(['cue', videoId]); }
      getPlayerState() { return this.state; }
      getDuration() { return this.duration || 0; }
      getCurrentTime() { return this.position || 0; }
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

test('optional panes minimize independently and reopen from the main player', { timeout: 20000 }, async (t) => {
  const { page } = await setup(t);
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
  await page.getByRole('button', { name: 'VID', exact: true }).click();
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
  await page.getByRole('button', { name: 'VID', exact: true }).click();
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
  await page.getByRole('button', { name: 'VID', exact: true }).click();
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

async function checkPlaylistHistory(t, endFirst) {
  const { page } = await setup(t);
  await page.getByRole('button', { name: 'VID', exact: true }).click();
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
  await page.getByRole('button', { name: 'VID', exact: true }).click();
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
