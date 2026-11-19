const assert = require('node:assert/strict');
const test = require('node:test');
const LiveTempo = require('../tempo.js');

function feed(detector, start, end, getLevel) {
  let actual = null;
  for (let time = start, i = 0; time < end; time += [16, 17, 14, 20][i++ % 4]) {
    const level = getLevel(time);
    actual = detector.update(time, Float32Array.of(level, level * 0.6, level * 0.3));
  }
  return actual;
}

function beat(bpm) {
  const period = 60000 / bpm;
  return (time) => {
    const phase = (time + period - 100) % period;
    return Math.max(0, 1 - Math.abs(phase - 44) / 44);
  };
}

test('estimates periodic beats across the supported range with uneven frame times', () => {
  for (const bpm of [55, 90, 128, 174, 200]) {
    const detector = new LiveTempo();
    assert.equal(feed(detector, 0, 5000, beat(bpm)), null);
    const actual = feed(detector, 5000, 9500, beat(bpm));
    assert.ok(actual !== null && Math.abs(actual - bpm) <= 1, `${bpm} BPM measured as ${actual}`);
  }
});

test('does not report steady audio or keep an estimate across silence or a capture gap', () => {
  const detector = new LiveTempo();
  assert.equal(feed(detector, 0, 8000, () => 0.8), null);
  detector.reset();
  assert.equal(feed(detector, 0, 8000, beat(128)), 128);
  assert.equal(feed(detector, 8000, 10300, () => 0), null);
  assert.equal(feed(detector, 11000, 19000, beat(90)), 90);
  assert.equal(detector.update(20000, new Float32Array(3)), null);
});
