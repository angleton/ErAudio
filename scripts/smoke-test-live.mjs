// Checks the public site the way a first-time visitor reaches it.
// Usage: node scripts/smoke-test-live.mjs [origin]
import { readFile } from 'node:fs/promises';
import tls from 'node:tls';

const origin = (process.argv[2] ?? 'https://ericangleton.com').replace(/\/$/, '');
const host = new URL(origin).hostname;
const config = JSON.parse(await readFile(new URL('../ErAudio.json', import.meta.url), 'utf8'));
const workerEndpoint = config.historySync.endpoint;
const minCertDays = 14;
const failures = [];

async function check(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function get(url, options = {}) {
  return fetch(url, { redirect: 'manual', ...options });
}

for (const [path, text] of [
  ['/eraudio/', 'ErAudio'],
  ['/eraudio/app.js', null],
  ['/eraudio/styles.css', null],
  ['/blog/', null],
  ['/privacy.html', 'Privacy'],
]) {
  await check(`${path} returns 200`, async () => {
    const response = await get(`${origin}${path}`);
    assert(response.status === 200, `status ${response.status}`);
    if (text) assert((await response.text()).includes(text), `missing "${text}"`);
  });
}

await check('apex redirects to /eraudio/', async () => {
  const response = await get(`${origin}/`);
  const body = await response.text();
  assert(response.status === 200 && body.includes('url=/eraudio/'), 'homepage does not lead to /eraudio/');
});

await check('http redirects to https', async () => {
  const response = await get(`http://${host}/`);
  assert([301, 302, 308].includes(response.status), `status ${response.status}`);
  assert(response.headers.get('location')?.startsWith('https://'), `location ${response.headers.get('location')}`);
});

await check(`www.${host} redirects to apex`, async () => {
  const response = await get(`https://www.${host}/`);
  assert([301, 302, 308].includes(response.status), `status ${response.status}`);
  assert(response.headers.get('location')?.includes(host), `location ${response.headers.get('location')}`);
});

await check(`certificate valid for at least ${minCertDays} days`, async () => {
  const certificate = await new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host }, () => {
      const peer = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const reason = socket.authorizationError;
      socket.end();
      if (!authorized) reject(new Error(`untrusted certificate: ${reason}`));
      else resolve(peer);
    });
    socket.on('error', reject);
  });
  const days = (new Date(certificate.valid_to) - Date.now()) / 86_400_000;
  assert(days >= minCertDays, `expires in ${Math.floor(days)} days`);
});

await check('history Worker allows the site origin (CORS)', async () => {
  const response = await get(`${workerEndpoint}/state`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
  });
  assert(response.status < 400, `status ${response.status}`);
  assert(response.headers.get('access-control-allow-origin') === origin, `allow-origin ${response.headers.get('access-control-allow-origin')}`);
});

await check('history Worker rejects unauthenticated requests', async () => {
  const response = await get(`${workerEndpoint}/state`, { headers: { Origin: origin } });
  assert([401, 403].includes(response.status), `status ${response.status}`);
});

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nAll live checks passed.');
