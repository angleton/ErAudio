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
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteRequests, []);
});
