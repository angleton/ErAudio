const assert = require('node:assert/strict');
const test = require('node:test');
const { filterPeriod } = require('../history.js');

process.env.TZ = 'America/New_York';
const at = (value) => new Date(value).getTime();
const now = at('2026-03-09T12:00:00-04:00');
const video = (videoId, plays = 1) => ({ videoId, title: videoId, plays });
const span = (videoId, playedAt, options = {}) => ({
  videoId, start: 0, end: 10, playedAt: at(playedAt), ...options,
});
const id = (number) => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;

test('calendar periods use local time and weeks start Sunday across daylight saving', () => {
  const history = {
    videos: ['today', 'sunday', 'month', 'year', 'previous'].map((name) => video(name)),
    spans: [
      span('today', '2026-03-09T01:00:00-04:00'),
      span('sunday', '2026-03-08T00:00:00-05:00'),
      span('month', '2026-03-01T00:00:00-05:00'),
      span('year', '2026-01-01T00:00:00-05:00'),
      span('previous', '2025-12-31T23:59:59-05:00'),
    ],
  };
  const names = (period) => filterPeriod(history, period, now).spans.map(({ videoId }) => videoId);
  assert.deepEqual(names('today'), ['today']);
  assert.deepEqual(names('week'), ['today', 'sunday']);
  assert.deepEqual(names('month'), ['today', 'sunday', 'month']);
  assert.deepEqual(names('year'), ['today', 'sunday', 'month', 'year']);
  assert.equal(filterPeriod(history, 'all', now).videos[0].plays, 1);
});

test('period time is split approximately and session plays are deduplicated without inventing legacy counts', () => {
  const start = at('2026-03-08T23:59:50-04:00');
  const recent = at('2026-03-09T10:00:00-04:00');
  const history = {
    videos: [video('crossing', 3), video('legacy', 7)],
    spans: [
      { videoId: 'crossing', start: 0, end: 20, playedAt: start, playedUntil: start + 20000,
        sessionId: id(1), sessionStartedAt: start },
      { videoId: 'crossing', start: 20, end: 30, playedAt: recent, playedUntil: recent + 10000,
        sessionId: id(2), sessionStartedAt: recent },
      { videoId: 'crossing', start: 40, end: 50, playedAt: recent + 20000, playedUntil: recent + 30000,
        sessionId: id(2), sessionStartedAt: recent },
      span('legacy', '2026-03-09T11:00:00-04:00'),
    ],
  };
  const result = filterPeriod(history, 'today', now);
  assert.deepEqual(result.spans.filter(({ videoId }) => videoId === 'crossing').map(({ start, end }) => [start, end]),
    [[10, 20], [20, 30], [40, 50]]);
  assert.equal(result.videos.find(({ videoId }) => videoId === 'crossing').plays, 1);
  assert.equal(result.videos.find(({ videoId }) => videoId === 'crossing').incompletePlays, false);
  assert.equal(result.videos.find(({ videoId }) => videoId === 'legacy').plays, 0);
  assert.equal(result.videos.find(({ videoId }) => videoId === 'legacy').incompletePlays, true);
  assert.equal(history.videos[1].plays, 7);
});
