const assert = require('node:assert/strict');
const test = require('node:test');
const SpectrumVisualizer = require('../visualizer/spectrum.js');

function fixture() {
  const canvas = { clientWidth: 320, clientHeight: 80, width: 0, height: 0 };
  const drawing = {
    lines: [],
    dots: [],
    colors: [],
    clearRect() { this.lines = []; this.dots = []; this.colors = []; },
    createLinearGradient() { return { addColorStop: (position, color) => this.colors.push([position, color]) }; },
    beginPath() {},
    moveTo(x, y) { this.lines.push([x, y]); },
    lineTo(x, y) { this.lines.push([x, y]); },
    closePath() {},
    fill() {},
    arc(x, y) { this.dots.push([x, y]); },
  };
  return { canvas, drawing, visualizer: new SpectrumVisualizer(canvas, drawing, 32000, 64, 0) };
}

test('pause holds the spectrum fill while its peak dot holds and falls', () => {
  const { drawing, visualizer } = fixture();
  const bins = new Float32Array(32).fill(-Infinity);
  bins[1] = -25;
  visualizer.draw(bins, 1, 0, false, 1);
  const fill = drawing.lines.slice();
  const initialY = drawing.dots[0][1];

  visualizer.draw(bins, 1, 100, true, 1);
  assert.deepEqual(drawing.lines, fill);
  assert.equal(drawing.dots[0][1], initialY);
  visualizer.draw(bins, 1, 300, true, 1);
  assert.deepEqual(drawing.lines, fill);
  assert.ok(drawing.dots[0][1] > initialY);
  visualizer.draw(bins, 1, 1600, true, 1);
  assert.deepEqual(drawing.lines, fill);
  assert.equal(drawing.dots.length, 0);
});

test('dense bands display narrow frequency bins and reset old peaks when the band count changes', () => {
  const { drawing, visualizer } = fixture();
  const bins = new Float32Array(32).fill(-Infinity);
  bins[1] = -25;
  visualizer.draw(bins, 512, 0, false, 1);
  assert.ok(drawing.dots.length > 1, 'empty narrow bands use the nearest frequency bin');
  bins.fill(-Infinity);
  visualizer.draw(bins, 16, 10, false, 1);
  assert.equal(drawing.dots.length, 0);
});
