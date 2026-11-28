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

test('acquires and keeps a tempo through brief gaps in frame delivery', () => {
  const detector = new LiveTempo();
  const pulse = beat(128);
  for (let time = 0; time <= 14000; time += 20) {
    if (time % 3000 >= 2000 && time % 3000 < 2200) continue;
    const actual = detector.update(time, Float32Array.of(pulse(time), 0, 0));
    if (time >= 6500) assert.ok(actual !== null && Math.abs(actual - 128) <= 1, `${time} ms: ${actual}`);
  }
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
  assert.equal(feed(detector, 0, 10000, (time) => 0.72 + 0.004 * pulse(time)), 120);

  detector.reset();
  let seed = 42;
  assert.equal(feed(detector, 0, 10000, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return 0.72 + 0.03 * (seed / 2 ** 32);
  }), null);
});

test('uses weaker alternating beats without doubling a genuine slow tempo', () => {
  const slowBeat = beat(62);
  const detector = new LiveTempo();
  assert.equal(feed(detector, 0, 10000, (time) => 0.65 + 0.2 * slowBeat(time)), 62);

  detector.reset();
  const beatInterval = 60000 / 124;
  const alternating = (time) => 0.65 + 0.2 * slowBeat(time) + 0.064 * slowBeat(time + beatInterval);
  assert.equal(feed(detector, 0, 10000, alternating), 124);
  assert.equal(feed(detector, 10000, 14000, alternating), 124);
});

test('a tap hint lasts beyond 15 seconds, expires after 30 seconds, and is discarded on reset', () => {
  const detector = new LiveTempo();
  const slowBeat = beat(62);
  const alternating = (time) => 0.65 + 0.2 * slowBeat(time) + 0.064 * slowBeat(time + 60000 / 124);
  assert.equal(feed(detector, 0, 10000, alternating), 124);
  detector.setTempoHint(62);
  assert.equal(feed(detector, 10000, 12000, alternating), 62);
  assert.equal(feed(detector, 12000, 27000, alternating), 62);
  assert.equal(feed(detector, 27000, 42000, alternating), 124);
  detector.setTempoHint(62);
  detector.reset();
  assert.equal(feed(detector, 42000, 50000, alternating), 124);
});

test('a steady tap favors a weaker audio beat initially, then its influence fades', () => {
  const detector = new LiveTempo();
  const slowBeat = beat(62);
  const alternating = (time) => 0.65 + 0.2 * slowBeat(time) + 0.05 * slowBeat(time + 60000 / 124);
  assert.equal(feed(detector, 0, 10000, alternating), 62);
  detector.setTempoHint(124);
  assert.equal(feed(detector, 10000, 20000, alternating), 124);
  assert.equal(feed(detector, 20000, 22000, alternating), 124);
  assert.equal(feed(detector, 22000, 30000, alternating), 62);
  assert.equal(feed(detector, 30000, 42000, alternating), 62);
});

test('a tap hint does not create an unsupported audio tempo or an estimate in silence', () => {
  const detector = new LiveTempo();
  assert.equal(feed(detector, 0, 8000, beat(120)), 120);
  detector.setTempoHint(90);
  assert.equal(feed(detector, 8000, 9500, beat(120)), 120);
  assert.equal(feed(detector, 9500, 12500, () => 0), null);
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
    if (time === 15000) lastConfident = actual;
    if (time === 17000) {
      assert.ok(Math.abs(lastConfident - 120) <= 1);
      assert.equal(actual, lastConfident);
    }
    if (time === 18000) assert.equal(actual, null);
  }
});

test('estimates beat phase from periodic audio and clears it after silence or reset', () => {
  const detector = new LiveTempo();
  assert.equal(feed(detector, 0, 10000, beat(120)), 120);
  assert.deepEqual(detector.beatAt(10120), { lit: true, confidence: 'estimated' });
  assert.deepEqual(detector.beatAt(10370), { lit: false, confidence: 'estimated' });
  feed(detector, 10000, 12500, () => 0);
  assert.equal(detector.beatAt(12500), null);
  detector.reset();
  assert.equal(detector.beatAt(12500), null);
});

test('steady taps supply uncertain timing and audio gradually corrects a nearby phase', () => {
  const detector = new LiveTempo();
  detector.setBeatTapHint(120, 10020);
  assert.deepEqual(detector.beatAt(10020), { lit: true, confidence: 'uncertain' });
  assert.equal(feed(detector, 0, 10000, beat(120)), 120);
  feed(detector, 10000, 14000, beat(120));
  assert.ok(detector.beatHint.phase > 10020 && detector.beatHint.phase < 10120);
  assert.equal(detector.beatAt(14020).confidence, 'estimated');
});

test('taps help select one of two audio-supported beat phases', () => {
  const pulse = beat(120);
  const alternating = (time) => pulse(time) + pulse(time + 250);
  const automatic = new LiveTempo();
  assert.equal(feed(automatic, 0, 10000, alternating), 120);
  assert.equal(automatic.beatAt(10120), null);

  const guided = new LiveTempo();
  guided.setBeatTapHint(120, 5120);
  assert.equal(feed(guided, 0, 10000, alternating), 120);
  assert.equal(guided.beatAt(10120).confidence, 'estimated');
  assert.equal(guided.beatAt(10120).lit, true);
});

test('conflicting taps stay uncertain and cannot create an audio tempo', () => {
  const detector = new LiveTempo();
  assert.equal(feed(detector, 0, 10000, beat(120)), 120);
  detector.setTempoHint(90);
  detector.setBeatTapHint(90, 10000);
  assert.equal(feed(detector, 10000, 14000, beat(120)), 120);
  assert.equal(detector.beatAt(14000).confidence, 'uncertain');

  detector.setBeatTapHint(120, 14370);
  feed(detector, 14000, 18000, beat(120));
  assert.equal(detector.beatAt(18000).confidence, 'uncertain');
  feed(detector, 18000, 20500, () => 0);
  assert.equal(detector.bpm, null);
  assert.equal(detector.beatAt(20500).confidence, 'uncertain');
  assert.equal(detector.beatAt(44370), null);
});

test('tap guidance expires after 30 seconds and capture gaps or reset discard it', () => {
  const detector = new LiveTempo();
  detector.setBeatTapHint(120, 1000);
  assert.equal(detector.beatAt(30999).confidence, 'uncertain');
  assert.equal(detector.beatAt(31000), null);
  detector.update(1000, new Float32Array(3));
  detector.setBeatTapHint(120, 1000);
  detector.update(1600, new Float32Array(3));
  assert.equal(detector.beatAt(1600), null);
  detector.setBeatTapHint(120, 1600);
  detector.reset();
  assert.equal(detector.beatAt(1600), null);
});
