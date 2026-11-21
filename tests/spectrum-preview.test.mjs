import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

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
    const result = { continuous: render(256), subtle: render(255), sparse: render(16) };
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
