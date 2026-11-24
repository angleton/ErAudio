import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../cloudflare/history-worker.mjs';
import client from '../history-sync.js';
import { audience, jwk, token, testDatabase } from './history-fixture.mjs';

const origin = 'http://localhost:8000';
const endpoint = 'http://localhost:8787';
const videoId = 'abcdefghijk';

test('isolates accounts, merges two browsers and rejects uploads from before a clear', async (t) => {
  const db = testDatabase();
  t.after(() => db.close());
  const env = { APP_ORIGINS: origin, GOOGLE_CLIENT_ID: audience, HISTORY_DB: db };
  t.mock.method(globalThis, 'fetch', (url, init) => {
    if (String(url) === 'https://www.googleapis.com/oauth2/v3/certs') {
      return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'max-age=3600' } });
    }
    const request = new Request(url, init);
    request.headers.set('Origin', origin);
    return worker.fetch(request, env);
  });
  const browser = (credential) => new client.HistorySync(endpoint, credential, crypto.randomUUID());
  const accountToken = token('10000001');
  const first = browser(accountToken);
  const second = browser(token('10000001'));
  const otherAccount = browser(token('10000002'));
  await assert.rejects(browser(token('10000001', { aud: 'wrong' })).state(), { status: 401 });
  await assert.rejects(browser(token('10000001', { exp: 1 })).state(), { status: 401 });
  const [claims, signature] = accountToken.split(/\.(?=[^.]+$)/);
  const forgedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  await assert.rejects(browser(`${claims}.${forgedSignature}`).state(), { status: 401 });

  const span = (start, end, playedAt) => ({ videoId, start, end, playedAt });
  const history = (spans, plays) => ({ spans, videos: [{
    videoId, title: 'Test video', duration: 2000, chapters: [], timestamps: [], plays, lastPlayed: 100 + plays,
  }] });
  const refresh = async (browser) => browser.pull(await browser.state());
  const firstHistory = history(Array.from({ length: 104 }, (_, i) => span(i, i + 10, i + 100)), 2);
  Object.assign(firstHistory.spans[0], { sessionId: crypto.randomUUID(), sessionStartedAt: 100, playedUntil: 110 });
  await refresh(first);
  await first.upload(firstHistory);
  await refresh(second);
  assert.equal(second.rows.size, 105);
  assert.equal(client.combine(second.rows, { spans: [], videos: [] }, second.device).videos[0].plays, 2);

  const secondHistory = history([span(0, 15, 100), span(1000, 1010, 1000)], 1);
  await second.upload(secondHistory);
  await refresh(first);
  const merged = client.combine(first.rows, firstHistory, first.device);
  assert.equal(merged.spans.length, 105);
  assert.equal(merged.spans.find(({ start }) => start === 0).end, 15);
  assert.equal(merged.spans.find(({ start }) => start === 0).sessionId, firstHistory.spans[0].sessionId);
  assert.equal(merged.videos[0].plays, 3);
  assert.equal(await first.upload(firstHistory), false);

  const extra = { ...span(2000, 2010, 2000), playedUntil: 2010,
    sessionId: crypto.randomUUID(), sessionStartedAt: 2000 };
  firstHistory.spans.push(extra);
  await first.pull({ ...await first.state(), periodHistory: false });
  await first.upload(firstHistory);
  await refresh(first);
  assert.equal(first.rows.get(`s:${videoId}:2000:2000`).sessionId, undefined);
  assert.equal(first.rows.get(`s:${videoId}:2000:2000`).playedUntil, undefined);
  await first.upload(firstHistory);
  await refresh(second);
  assert.equal(second.rows.get(`s:${videoId}:2000:2000`).sessionId, extra.sessionId);
  assert.equal(second.rows.get(`s:${videoId}:2000:2000`).playedUntil, 2010);
  await assert.rejects(first.request('/rows', 'POST', JSON.stringify({
    device: first.device, epoch: first.epoch, rows: [{ type: 'span', data: { ...extra, sessionId: 'invalid' } }],
  })), { status: 400 });

  await refresh(otherAccount);
  assert.notEqual((await first.state()).account, (await otherAccount.state()).account);
  assert.equal(otherAccount.rows.size, 0);
  await otherAccount.upload(history([span(1, 10, 4)], 1));
  await first.clear();
  await assert.rejects(second.upload(history([span(0, 20, 100)], 2)), { status: 409 });
  await refresh(first);
  assert.equal(first.rows.size, 0);
  await refresh(otherAccount);
  assert.equal(otherAccount.rows.size, 2);
});

test('allows only configured origins through CORS', async () => {
  const env = { APP_ORIGINS: ' https://ericangleton.com, https://audio.ericangleton.com, http://localhost:8000 ' };
  for (const origin of ['https://ericangleton.com', 'https://audio.ericangleton.com', 'http://localhost:8000']) {
    const response = await worker.fetch(new Request(`${endpoint}/state`, {
      method: 'OPTIONS',
      headers: { Origin: origin },
    }), env);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  }
  const rejected = await worker.fetch(new Request(`${endpoint}/state`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://unlisted.example' },
  }), env);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null);
});
