const assert = require('node:assert/strict');
const test = require('node:test');
const SpectrumVisualizer = require('../visualizer/spectrum.js');

function fixture() {
  const canvas = { clientWidth: 320, clientHeight: 80, width: 0, height: 0 };
  const drawing = {
    lines: [],
    rectangles: [],
    dots: [],
    colors: [],
    erasures: [],
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    clearRect() { this.lines = []; this.rectangles = []; this.dots = []; this.colors = []; this.erasures = []; },
    createLinearGradient() { return { addColorStop: (position, color) => this.colors.push([position, color]) }; },
    beginPath() {},
    moveTo(x, y) { this.lines.push([x, y]); },
    lineTo(x, y) { this.lines.push([x, y]); },
    rect(x, y, width, height) { this.rectangles.push([x, y, width, height]); },
    closePath() {},
    fill() {
      if (this.globalCompositeOperation === 'destination-out') this.erasures.push(this.globalAlpha);
    },
    save() { this.saved = [this.globalAlpha, this.globalCompositeOperation]; },
    restore() { [this.globalAlpha, this.globalCompositeOperation] = this.saved; },
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
  assert.equal(drawing.rectangles.length, 0);
  assert.ok(drawing.dots.length > 1, 'empty narrow bands use the nearest frequency bin');
  bins.fill(-Infinity);
  visualizer.draw(bins, 16, 10, false, 1);
  assert.equal(drawing.dots.length, 0);
});

test('LED gaps gradually appear below 256 bands and rows become larger', () => {
  const { drawing, visualizer } = fixture();
  const bins = new Float32Array(32).fill(-25);
  visualizer.draw(bins, 256, 0, false, 1);
  assert.equal(drawing.rectangles.length, 0);

  visualizer.draw(bins, 255, 10, false, 1);
  const subtle = drawing.erasures[0];
  assert.ok(subtle > 0 && subtle < 0.01);
  assert.equal(drawing.globalAlpha, 1);
  assert.equal(drawing.globalCompositeOperation, 'source-over');
  const denseRows = drawing.rectangles.filter(([, , width]) => width === 320).length;

  visualizer.draw(bins, 16, 20, false, 1);
  assert.equal(drawing.erasures[0], 1);
  assert.equal(drawing.rectangles.filter(([, , , height]) => height === 80).length, 15);
  assert.ok(drawing.rectangles.filter(([, , width]) => width === 320).length < denseRows);
});
