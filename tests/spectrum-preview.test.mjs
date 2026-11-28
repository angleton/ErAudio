import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

test('player and preview block injected base URLs and embedded objects', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ offline: true });

  for (const path of ['../index.html', '../visualizer/preview.html']) {
    await page.goto(new URL(path, import.meta.url).href);
    const result = await page.evaluate(async () => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', (event) => violations.push(event.violatedDirective));
      const originalBase = document.baseURI;
      const base = document.createElement('base');
      base.href = 'https://example.invalid/';
      document.head.append(base);
      const object = document.createElement('object');
      object.data = 'https://example.invalid/plugin';
      document.body.append(object);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { originalBase, currentBase: document.baseURI, violations };
    });
    assert.equal(result.currentBase, result.originalBase);
    assert.ok(result.violations.includes('base-uri'));
    assert.ok(result.violations.includes('object-src'));
  }
});

test('standalone preview works offline, pauses and resumes, and changes band count', { timeout: 15000 }, async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  const errors = [];
  const remoteRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
  });
  await page.goto(new URL('../visualizer/preview.html', import.meta.url).href);
  const canvas = page.locator('#live-spectrum');
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#live-spectrum');
    return canvas.width > 0 && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      .data.some((value, index) => index % 4 === 3 && value > 0);
  });
  await page.getByRole('button', { name: 'Pause' }).click();
  assert.equal(await page.getByRole('button', { name: 'Resume' }).getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(1600);
  const paused = await canvas.evaluate((element) => element.toDataURL());
  await page.waitForTimeout(250);
  assert.equal(await canvas.evaluate((element) => element.toDataURL()), paused);
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForFunction((previous) => document.querySelector('#live-spectrum').toDataURL() !== previous, paused);
  await page.locator('#preview-bands').evaluate((input) => {
    input.value = '512';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.locator('#preview-band-value').textContent(), '512');
  assert.match(await canvas.getAttribute('aria-label'), /512 frequency bands/);
  await page.locator('#preview-bands').evaluate((input) => {
    input.value = '8';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.locator('#preview-band-value').textContent(), '8');
  assert.match(await canvas.getAttribute('aria-label'), /8 frequency bands/);
  const pixels = await page.evaluate(() => {
    const sample = document.createElement('canvas');
    sample.style.width = '512px';
    sample.style.height = '160px';
    document.body.append(sample);
    const context = sample.getContext('2d');
    const renderer = new ErAudioSpectrum(sample, context, 48000, 32768, 0);
    const bins = new Float32Array(16384).fill(-25);
    const render = (bands) => {
      renderer.draw(bins, bands, 0, false, 1);
      const { data } = context.getImageData(0, 0, 512, 160);
      let total = 0;
      for (let y = 4; y < 158; y++) {
        for (let x = 0; x < 512; x++) total += data[(y * 512 + x) * 4 + 3];
      }
      return {
        average: total / (512 * 154),
        columnGap: data[(8 * 512 + 32) * 4 + 3],
        rowGap: data[(16 * 512 + 16) * 4 + 3],
        block: data[(8 * 512 + 16) * 4 + 3],
      };
    };
    const result = { continuous: render(512), subtle: render(511), sparse: render(16) };
    sample.remove();
    return result;
  });
  assert.equal(pixels.continuous.columnGap, 255);
  assert.ok(pixels.continuous.average - pixels.subtle.average < 2);
  assert.equal(pixels.sparse.columnGap, 0);
  assert.equal(pixels.sparse.rowGap, 0);
  assert.equal(pixels.sparse.block, 255);
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteRequests, []);
});

test('drawn spectra respond to levels perpendicular to the line and expire after ten seconds', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(new URL('../visualizer/preview.html', import.meta.url).href);
  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 100;
    const renderer = new ErAudioDrawnSpectrum(canvas, canvas);
    const paths = [];
    let path;
    const drawing = {
      save() {}, restore() {},
      beginPath() { path = []; },
      moveTo(x, y) { path.push([x, y]); },
      lineTo(x, y) { path.push([x, y]); },
      stroke() { paths.push(path); },
    };
    renderer.strokes.push({
      points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
      expiresAt: 10000,
    });
    renderer.draw(drawing, new Float32Array([1]), 9999, 1);
    const loud = paths.slice();
    paths.length = 0;
    renderer.draw(drawing, new Float32Array([0]), 9999, 1);
    const silent = paths.slice();
    paths.length = 0;
    renderer.draw(drawing, new Float32Array([1]), 10000, 1);
    return { loud, silent, expired: paths, remaining: renderer.strokes.length };
  });
  assert.deepEqual(result.loud, [[[10, 50], [90, 50]], [[50, 50], [50, 25]]]);
  assert.deepEqual(result.silent, [[[10, 50], [90, 50]]]);
  assert.deepEqual(result.expired, []);
  assert.equal(result.remaining, 0);
});

test('completed drawn spectra fade from five to ten seconds while active strokes stay visible', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(new URL('../visualizer/preview.html', import.meta.url).href);
  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 100;
    const renderer = new ErAudioDrawnSpectrum(canvas, canvas);
    const alphas = [];
    const drawing = {
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() { alphas.push(this.globalAlpha); },
    };
    const stroke = {
      points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
      expiresAt: Infinity,
    };
    renderer.strokes.push(stroke);
    const at = (now) => {
      alphas.length = 0;
      renderer.draw(drawing, new Float32Array([1]), now, 1);
      return [...alphas];
    };
    const active = at(12000);
    stroke.expiresAt = 10000;
    const beforeFade = at(4999);
    const full = at(5000);
    const halfway = at(7500);
    const almostGone = at(9999);
    const expired = at(10000);
    return { active, beforeFade, full, halfway, almostGone, expired };
  });
  assert.deepEqual(result.active, [0.9, 0.9]);
  assert.deepEqual(result.beforeFade, [0.9, 0.9]);
  assert.deepEqual(result.full, [0.9, 0.9]);
  assert.deepEqual(result.halfway, [0.45, 0.45]);
  assert.ok(result.almostGone.every((alpha) => alpha > 0 && alpha < 0.001));
  assert.equal(result.almostGone.length, 2);
  assert.deepEqual(result.expired, []);
});

test('minimum bands show whole lights at varying levels and sizes while maximum bands stay smooth', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(new URL('../visualizer/preview.html', import.meta.url).href);
  const result = await page.evaluate(() => {
    const sample = document.createElement('canvas');
    document.body.append(sample);
    const context = sample.getContext('2d');
    const levels = [0, 0.049, 0.051, 0.37, 0.86, 1];
    const mismatches = [];
    for (const [cssWidth, cssHeight, ratio] of [[512, 160, 1], [509, 157, 1], [509, 157, 2]]) {
      sample.style.width = `${cssWidth}px`;
      sample.style.height = `${cssHeight}px`;
      const renderer = new ErAudioSpectrum(sample, context, 48000, 32768, 0);
      const bins = new Float32Array(16384).fill(-90);
      renderer.draw(bins, 16, 0, false, ratio);
      levels.forEach((level, index) => {
        const band = index + 8;
        bins.fill(-90 + level * 65, renderer.bandEdges[band], renderer.bandEdges[band + 1]);
      });
      renderer.draw(bins, 16, 1, true, ratio);
      const { width, height } = sample;
      const step = width / 16;
      const preferredRowHeight = Math.max(2 * ratio, Math.min(16 * ratio, step * 0.75));
      const rowCount = Math.max(1, Math.round(height / preferredRowHeight));
      const rowHeight = height / rowCount;
      const { data } = context.getImageData(0, 0, width, height);
      levels.forEach((level, index) => {
        const band = index + 8;
        for (let row = 0; row < rowCount; row++) {
          for (const xPart of [0.2, 0.8]) {
            for (const yPart of [0.3, 0.7]) {
              const x = Math.floor((band + xPart) * step);
              const y = Math.floor(height - (row + 1 - yPart) * rowHeight);
              const alpha = data[(y * width + x) * 4 + 3];
              const expected = row < Math.round(level * rowCount) ? 255 : 0;
              if (alpha !== expected) mismatches.push({ cssWidth, cssHeight, ratio, band, row, x, y, alpha, expected });
            }
          }
        }
      });
    }

    sample.style.width = '512px';
    sample.style.height = '160px';
    const renderer = new ErAudioSpectrum(sample, context, 48000, 32768, 0);
    const bins = new Float32Array(16384).fill(-90 + 0.37 * 65);
    renderer.draw(bins, 512, 0, false, 1);
    const smooth = context.getImageData(8, 98, 1, 5).data;
    const smoothAlphas = Array.from({ length: 5 }, (_, index) => smooth[index * 4 + 3]);
    sample.remove();
    return { mismatches, smoothAlphas };
  });
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.smoothAlphas.slice(0, 2), [0, 0]);
  assert.ok(result.smoothAlphas[2] > 0 && result.smoothAlphas[2] < 255);
  assert.deepEqual(result.smoothAlphas.slice(3), [255, 255]);
});

test('minimum-band peak fills one white LED-sized rectangle', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(new URL('../visualizer/preview.html', import.meta.url).href);
  const colors = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.style.width = '512px';
    canvas.style.height = '160px';
    document.body.append(canvas);
    const drawing = canvas.getContext('2d');
    const renderer = new ErAudioSpectrum(canvas, drawing, 48000, 32768, 0);
    renderer.draw(new Float32Array(16384).fill(-25), 16, 0, false, 1);
    const pixel = (x, y) => Array.from(drawing.getImageData(x, y, 1, 1).data);
    const result = [pixel(2, 8), pixel(29, 8), pixel(0, 8), pixel(16, 24)];
    canvas.remove();
    return result;
  });
  assert.deepEqual(colors[0], [255, 255, 255, 255]);
  assert.deepEqual(colors[1], [255, 255, 255, 255]);
  assert.notDeepEqual(colors[2], [255, 255, 255, 255]);
  assert.notDeepEqual(colors[3], [255, 255, 255, 255]);
});
