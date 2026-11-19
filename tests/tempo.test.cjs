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

test('detects a beat in the same frequency band as a louder sustained tone', () => {
  const detector = new LiveTempo();
  const pulse = beat(120);
  const bins = Float32Array.of(-15, -Infinity);
  const levels = new Float32Array(3);
  let actual = null;
  for (let time = 0; time < 10000; time += 16) {
    bins[1] = -23 + 20 * Math.log10(pulse(time));
    levels[0] = LiveTempo.bandLevel(bins, 0, 2);
    actual = detector.update(time, levels);
  }
  assert.equal(actual, 120);
});

test('detects small but regular changes without treating irregular fluctuations as a beat', () => {
  const detector = new LiveTempo();
  const pulse = beat(120);
  assert.equal(feed(detector, 0, 10000, (time) => 0.72 + 0.03 * pulse(time)), 120);

  detector.reset();
  let seed = 42;
  assert.equal(feed(detector, 0, 10000, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return 0.72 + 0.03 * (seed / 2 ** 32);
  }), null);
});

test('holds the last tempo through a brief confidence dip, then clears it if the beat does not return', () => {
  const detector = new LiveTempo();
  const pulse = beat(120);
  let seed = 42;
  let lastConfident;
  for (let time = 0; time <= 18000; time += 20) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const level = time < 8000 ? 0.3 * pulse(time) : 0.3 * (seed / 2 ** 32);
    const actual = detector.update(time, Float32Array.of(level, level * 0.6, level * 0.3));
    if (time === 8000) assert.equal(actual, 120);
    if (time === 14000) lastConfident = actual;
    if (time === 16000) {
      assert.ok(Math.abs(lastConfident - 120) <= 1);
      assert.equal(actual, lastConfident);
    }
    if (time === 18000) assert.equal(actual, null);
  }
});
