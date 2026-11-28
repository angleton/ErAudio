(() => {
  const lifetimeMs = 5000;
  const fadeMs = 1000;
  const maxStrokes = 32;
  const maxPoints = 1024;
  const pointSpacing = 3;
  const maxBands = 128;
  const heightFraction = 0.25;

  class DrawnSpectrum {
    constructor(canvas, target, canDraw = () => true, onUnavailable = () => {}) {
      this.canvas = canvas;
      this.target = target;
      this.canDraw = canDraw;
      this.onUnavailable = onUnavailable;
      this.strokes = [];
      this.gesture = null;
      this.suppressClick = false;

      target.addEventListener('pointerdown', (event) => this.start(event));
      target.addEventListener('pointermove', (event) => this.move(event));
      target.addEventListener('pointerup', (event) => this.finish(event));
      target.addEventListener('pointercancel', (event) => this.finish(event));
      target.addEventListener('lostpointercapture', (event) => this.finish(event));
      target.addEventListener('click', (event) => {
        if (this.suppressClick && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          this.suppressClick = false;
        }
      });
      window.addEventListener('keyup', (event) => {
        if (event.key === 'Shift' && !event.shiftKey && this.gesture?.stroke) {
          this.finishStroke(performance.now());
        }
      });
      window.addEventListener('blur', () => {
        this.finishStroke(performance.now());
        if (!this.gesture) return;
        const { pointerId } = this.gesture;
        this.gesture = null;
        if (this.target.hasPointerCapture(pointerId)) this.target.releasePointerCapture(pointerId);
      });
    }

    start(event) {
      if (event.button !== 0 || event.pointerType !== 'mouse' || !event.isPrimary) return;
      this.suppressClick = false;
      if (!event.shiftKey || this.gesture) return;
      this.suppressClick = true;
      event.preventDefault();
      this.gesture = { pointerId: event.pointerId, stroke: null };
      this.target.setPointerCapture(event.pointerId);
      if (!this.canDraw()) {
        this.onUnavailable();
        return;
      }
      const stroke = { points: [], expiresAt: Infinity };
      if (this.strokes.length === maxStrokes) this.strokes.shift();
      this.strokes.push(stroke);
      this.gesture.stroke = stroke;
      this.addPoint(event);
    }

    addPoint(event) {
      const stroke = this.gesture?.stroke;
      if (!stroke) return;
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const point = {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
      const previous = stroke.points.at(-1);
      if (previous && Math.hypot((point.x - previous.x) * rect.width, (point.y - previous.y) * rect.height) < pointSpacing) return;
      if (stroke.points.length >= maxPoints) {
        const last = stroke.points.at(-1);
        stroke.points = stroke.points.filter((_, index) => index % 2 === 0);
        stroke.points.push(last);
      }
      stroke.points.push(point);
    }

    move(event) {
      if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
      if (!event.shiftKey) this.finishStroke(performance.now());
      else this.addPoint(event);
    }

    finishStroke(now) {
      const stroke = this.gesture?.stroke;
      if (!stroke) return;
      if (stroke.points.length < 2) this.strokes = this.strokes.filter((item) => item !== stroke);
      else stroke.expiresAt = now + lifetimeMs;
      this.gesture.stroke = null;
    }

    finish(event) {
      if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
      if (event.type === 'pointerup' && event.shiftKey) this.addPoint(event);
      this.finishStroke(performance.now());
      this.gesture = null;
    }

    clear() {
      this.strokes = [];
      if (this.gesture) this.gesture.stroke = null;
    }

    draw(drawing, levels, now, ratio) {
      this.strokes = this.strokes.filter((stroke) => stroke.expiresAt > now);
      for (const stroke of this.strokes) {
        if (stroke.points.length < 2) continue;
        const points = stroke.points.map(({ x, y }) => ({
          x: x * this.canvas.width, y: y * this.canvas.height,
        }));
        const segments = [];
        let length = 0;
        for (let index = 1; index < points.length; index++) {
          const from = points[index - 1];
          const to = points[index];
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const size = Math.hypot(dx, dy);
          if (!size) continue;
          segments.push({ from, dx, dy, size, start: length });
          length += size;
        }
        if (!length) continue;

        drawing.save();
        drawing.globalAlpha = 0.9 * Math.min(1, (stroke.expiresAt - now) / fadeMs);
        drawing.strokeStyle = '#c9fcff';
        drawing.lineWidth = ratio;
        drawing.beginPath();
        drawing.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) drawing.lineTo(point.x, point.y);
        drawing.stroke();

        const bands = Math.min(levels.length, maxBands, Math.max(1, Math.floor(length / (pointSpacing * ratio))));
        const height = this.canvas.height * heightFraction;
        drawing.lineWidth = Math.max(ratio, Math.min(3 * ratio, length / bands * 0.7));
        let segmentIndex = 0;
        for (let band = 0; band < bands; band++) {
          const distance = (band + 0.5) * length / bands;
          while (segmentIndex < segments.length - 1
            && distance > segments[segmentIndex].start + segments[segmentIndex].size) segmentIndex++;
          const segment = segments[segmentIndex];
          const along = (distance - segment.start) / segment.size;
          const x = segment.from.x + segment.dx * along;
          const y = segment.from.y + segment.dy * along;
          const level = levels[Math.min(levels.length - 1, Math.floor(band * levels.length / bands))];
          if (!(level > 0)) continue;
          drawing.strokeStyle = `hsl(${Math.round(190 + 90 * level)} 100% 65%)`;
          drawing.beginPath();
          drawing.moveTo(x, y);
          drawing.lineTo(x + segment.dy / segment.size * height * level, y - segment.dx / segment.size * height * level);
          drawing.stroke();
        }
        drawing.restore();
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = DrawnSpectrum;
  else globalThis.ErAudioDrawnSpectrum = DrawnSpectrum;
})();
