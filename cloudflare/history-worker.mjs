const googleKeysUrl = 'https://www.googleapis.com/oauth2/v3/certs';
const videoId = /^[A-Za-z0-9_-]{11}$/;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const decode = (part) => Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const parse = (part) => JSON.parse(new TextDecoder().decode(decode(part)));
const encode = (text) => new TextEncoder().encode(text);
let keys = [];
let keysUntil = 0;

async function authenticate(header, audience) {
  const token = /^Bearer ([\w.-]+)$/.exec(header || '')?.[1];
  if (!token || token.length > 8192) return null;
  const parts = token.split('.');
  let claims, alg, kid, signature;
  try {
    if (parts.length !== 3) return null;
    ({ alg, kid } = parse(parts[0]));
    claims = parse(parts[1]);
    signature = decode(parts[2]);
  } catch {
    return null;
  }
  if (alg !== 'RS256' || typeof kid !== 'string' || !claims
    || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)
    || claims.aud !== audience || typeof claims.sub !== 'string' || !/^[\w-]{1,255}$/.test(claims.sub)
    || !Number.isSafeInteger(claims.exp) || claims.exp <= Date.now() / 1000) return null;
  if (Date.now() >= keysUntil) {
    const response = await fetch(googleKeysUrl);
    if (!response.ok) throw new Error('Google signing keys unavailable');
    ({ keys } = await response.json());
    const seconds = Number(/max-age=(\d+)/i.exec(response.headers.get('Cache-Control') || '')?.[1] || 0);
    keysUntil = Date.now() + seconds * 1000;
  }
  const jwk = keys.find((key) => key.kid === kid && key.kty === 'RSA');
  if (!jwk) return null;
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
  if (!await crypto.subtle.verify(algorithm, key, signature, encode(`${parts[0]}.${parts[1]}`))) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encode(claims.sub)));
  const account = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { account, email: claims.email_verified === true && typeof claims.email === 'string' ? claims.email : '' };
}

const nonnegative = (n) => Number.isFinite(n) && n >= 0;
const markersValid = (markers) => Array.isArray(markers)
  && markers.every((m) => m && nonnegative(m.start) && typeof m.title === 'string' && m.title.length <= 200);

function normalize(row, device) {
  const data = row?.data;
  if (typeof data?.videoId !== 'string' || !videoId.test(data.videoId)) return null;
  if (row.type === 'span' && nonnegative(data.start) && nonnegative(data.end) && data.end > data.start
    && nonnegative(data.playedAt)) {
    const { videoId, start, end, playedAt, playedUntil, sessionId, sessionStartedAt } = data;
    if ((playedUntil !== undefined && (!nonnegative(playedUntil) || playedUntil < playedAt))
      || ((sessionId !== undefined || sessionStartedAt !== undefined)
        && (typeof sessionId !== 'string' || !uuid.test(sessionId) || !nonnegative(sessionStartedAt)))) return null;
    const payload = { videoId, start, end, playedAt,
      ...(playedUntil !== undefined ? { playedUntil } : {}),
      ...(sessionId !== undefined ? { sessionId, sessionStartedAt } : {}) };
    return { key: `s:${videoId}:${start}:${playedAt}`, payload: JSON.stringify(payload), span: true };
  }
  if (row.type === 'video' && typeof data.title === 'string' && data.title.length <= 300
    && nonnegative(data.duration) && Number.isSafeInteger(data.plays) && data.plays >= 0
    && nonnegative(data.lastPlayed) && markersValid(data.chapters) && markersValid(data.timestamps)) {
    const { videoId, title, duration, chapters, timestamps, plays, lastPlayed } = data;
    const clean = (markers) => markers.map(({ start, title }) => ({ start, title }));
    return { key: `v:${device}:${videoId}`, payload: JSON.stringify({
      videoId, title, duration, chapters: clean(chapters), timestamps: clean(timestamps), plays, lastPlayed,
    }), span: false };
  }
  return null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = { 'Cache-Control': 'no-store', Vary: 'Origin' };
    const reply = (data, status = 200) => Response.json(data, { headers, status });
    if (!env.APP_ORIGIN || origin !== env.APP_ORIGIN) return reply({ error: 'Origin not allowed.' }, 403);
    headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        ...headers, 'Access-Control-Allow-Methods': 'GET, POST, DELETE',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600',
      } });
    }
    if (!env.GOOGLE_CLIENT_ID || !env.HISTORY_DB) return reply({ error: 'Sync is not configured.' }, 503);
    try {
      const identity = await authenticate(request.headers.get('Authorization'), env.GOOGLE_CLIENT_ID);
      if (!identity) return reply({ error: 'Sign in with Google again.' }, 401);
      const { account, email } = identity;
      const db = env.HISTORY_DB;
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/state') {
        let state = await db.prepare('SELECT epoch, revision FROM history_accounts WHERE account = ?').bind(account).first();
        if (!state) {
          await db.prepare('INSERT OR IGNORE INTO history_accounts (account) VALUES (?)').bind(account).run();
          state = await db.prepare('SELECT epoch, revision FROM history_accounts WHERE account = ?').bind(account).first();
        }
        return reply({ account, email, ...state, periodHistory: true });
      }
      if (request.method === 'GET' && url.pathname === '/rows') {
        const [epoch, from, until, id] = ['epoch', 'from', 'until', 'id']
          .map((key) => Number(url.searchParams.get(key)));
        if (![epoch, from, until, id].every((n) => Number.isSafeInteger(n) && n >= 0) || from > until) {
          return reply({ error: 'Invalid history cursor.' }, 400);
        }
        const [state, page] = await db.batch([
          db.prepare('SELECT epoch FROM history_accounts WHERE account = ?').bind(account),
          db.prepare(`SELECT id, revision, item_key, payload FROM history_rows
            WHERE account = ? AND (revision, id) > (?, ?) AND revision <= ?
            ORDER BY revision, id LIMIT 100`).bind(account, from, id, until),
        ]);
        if (state.results[0]?.epoch !== epoch) return reply({ error: 'History was cleared. Refresh sync.' }, 409);
        const rows = page.results.map(({ item_key, payload }) => ({ key: item_key, data: JSON.parse(payload) }));
        const last = page.results.at(-1);
        return reply({ rows, next: rows.length === 100 ? [last.revision, last.id] : null });
      }
      if (request.method === 'POST' && url.pathname === '/rows') {
        const reader = request.body?.getReader();
        if (!reader) return reply({ error: 'Missing history batch.' }, 400);
        const decoder = new TextDecoder();
        let text = '', size = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024 * 1024) {
            await reader.cancel();
            return reply({ error: 'History batch is too large.' }, 413);
          }
          text += decoder.decode(value, { stream: true });
        }
        let body;
        try { body = JSON.parse(text + decoder.decode()); } catch {
          return reply({ error: 'Invalid history JSON.' }, 400);
        }
        const { device, epoch, rows } = body || {};
        if (typeof device !== 'string' || !uuid.test(device) || !Number.isSafeInteger(epoch) || epoch < 0
          || !Array.isArray(rows) || !rows.length || rows.length > 40) return reply({ error: 'Invalid history batch.' }, 400);
        const records = rows.map((row) => normalize(row, device));
        if (records.some((row) => !row)) return reply({ error: 'Invalid history record.' }, 400);
        const results = await db.batch([
          ...records.map(({ key, payload, span }) => db.prepare(`
            INSERT INTO history_rows (account, item_key, revision, payload)
            SELECT account, ?1, revision + 1, json(?2) FROM history_accounts WHERE account = ?3 AND epoch = ?4
            ON CONFLICT(account, item_key) DO UPDATE SET revision = excluded.revision, payload = ${span
              ? `json_patch(json_set(json_patch(history_rows.payload, excluded.payload),
                  '$.end', max(json_extract(history_rows.payload, '$.end'), json_extract(excluded.payload, '$.end'))),
                  CASE WHEN coalesce(json_extract(history_rows.payload, '$.playedUntil'),
                    json_extract(excluded.payload, '$.playedUntil')) IS NULL THEN '{}'
                  ELSE json_object('playedUntil', max(coalesce(json_extract(history_rows.payload, '$.playedUntil'), 0),
                    coalesce(json_extract(excluded.payload, '$.playedUntil'), 0))) END)`
              : `json_set(CASE WHEN json_extract(history_rows.payload, '$.lastPlayed') > json_extract(excluded.payload, '$.lastPlayed')
                  THEN history_rows.payload ELSE excluded.payload END, '$.plays',
                  max(json_extract(history_rows.payload, '$.plays'), json_extract(excluded.payload, '$.plays')))`}
          `).bind(key, payload, account, epoch)),
          db.prepare(`UPDATE history_accounts SET revision = revision + 1
            WHERE account = ? AND epoch = ? RETURNING revision`).bind(account, epoch),
        ]);
        if (!results.at(-1).results.length) return reply({ error: 'History was cleared. Refresh sync.' }, 409);
        return reply({ revision: results.at(-1).results[0].revision });
      }
      if (request.method === 'DELETE' && url.pathname === '/rows') {
        const epoch = Number(url.searchParams.get('epoch'));
        if (!url.searchParams.has('epoch') || !Number.isSafeInteger(epoch) || epoch < 0) {
          return reply({ error: 'Invalid history generation.' }, 400);
        }
        const [removed, updated] = await db.batch([
          db.prepare(`DELETE FROM history_rows WHERE account = ?1
            AND EXISTS (SELECT 1 FROM history_accounts WHERE account = ?1 AND epoch = ?2)`).bind(account, epoch),
          db.prepare(`UPDATE history_accounts SET epoch = epoch + 1, revision = revision + 1
            WHERE account = ? AND epoch = ? RETURNING epoch, revision`).bind(account, epoch),
        ]);
        if (!updated.results.length) return reply({ error: 'History was already cleared. Refresh sync.' }, 409);
        return reply({ ...updated.results[0], removed: removed.meta.changes });
      }
      return reply({ error: 'Not found.' }, 404);
    } catch (error) {
      console.error('Listening history sync request failed:', error.name);
      return reply({ error: 'History service is temporarily unavailable.' }, 503);
    }
  },
};
