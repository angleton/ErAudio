import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from '../cloudflare/history-worker.mjs';
import client from '../history-sync.js';

const origin = 'http://localhost:8000';
const endpoint = 'http://localhost:8787';
const audience = 'test.apps.googleusercontent.com';
const videoId = 'abcdefghijk';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test' };
const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
function token(sub, extra = {}) {
  const body = `${encode({ alg: 'RS256', kid: 'test' })}.${encode({
    sub, aud: audience, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 60,
    ...extra,
  })}`;
  return `${body}.${sign('sha256', Buffer.from(body), privateKey).toString('base64url')}`;
}

function testDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../cloudflare/history-schema.sql', import.meta.url), 'utf8'));
  const prepare = (sql) => ({
    bind(...args) {
      const run = () => {
        const values = [];
        let next = 0;
        const statement = db.prepare(sql.replace(/\?(\d*)/g, (_, index) => {
          values.push(args[index ? Number(index) - 1 : next++]);
          return '?';
        }));
        return statement.columns().length
          ? { results: statement.all(...values) }
          : { results: [], meta: statement.run(...values) };
      };
      return { run, first: () => run().results[0] ?? null };
    },
  });
  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.run());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
}

test('isolates accounts, merges two browsers and rejects uploads from before a clear', async (t) => {
  const db = testDatabase();
  t.after(() => db.close());
  const env = { APP_ORIGIN: origin, GOOGLE_CLIENT_ID: audience, HISTORY_DB: db };
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
  assert.equal(merged.videos[0].plays, 3);
  assert.equal(await first.upload(firstHistory), false);

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
