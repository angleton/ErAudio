(() => {
  const lowHz = 30;
  const highHzLimit = 16000;
  const quietDb = -90;
  const loudDb = -25;
  const peakHoldMs = 200;
  const peakFallPerMs = 0.0008;
  const peakColor = '#fff';
  const ledTransitionBands = 512;
  const ledMinimumBands = 16;
  const ledShapeRate = 8;
  const ledShapeCompletion = 0.5;
  const ledMaxGap = 3;
  const ledMaxHeight = 16;

  class SpectrumVisualizer {
    constructor(canvas, drawing, sampleRate, fftSize, now) {
      this.canvas = canvas;
      this.drawing = drawing;
      this.highHz = Math.min(highHzLimit, sampleRate / 2);
      this.hzPerBin = sampleRate / fftSize;
      this.bandEdges = [];
      this.lastFrameTime = now;
    }

    draw(bins, bandCount, now, paused, ratio) {
      const { canvas, drawing } = this;
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (this.bandEdges.length !== bandCount + 1) {
        this.bandEdges = Array.from({ length: bandCount + 1 }, (_, index) =>
          Math.min(bins.length, Math.ceil(lowHz * (this.highHz / lowHz) ** (index / bandCount) / this.hzPerBin)));
        this.heldPeaks = new Float32Array(bandCount);
        this.holdUntil = new Float64Array(bandCount);
        this.bandTops = new Float32Array(bandCount);
        this.bandLevels = new Float32Array(bandCount);
      }
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      drawing.clearRect(0, 0, width, height);
      const step = width / bandCount;
      const ledStrength = bandCount < ledTransitionBands
        ? Math.min(1, (ledTransitionBands - bandCount) / (ledTransitionBands - ledMinimumBands)) : 0;
      const shapeStrength = Math.min(1, (1 - Math.exp(-ledShapeRate * ledStrength))
        / (1 - Math.exp(-ledShapeRate * ledShapeCompletion)));
      const preferredRowHeight = Math.max(2 * ratio, Math.min(ledMaxHeight * ratio, step * 0.75));
      const rowCount = Math.max(1, Math.round(height / preferredRowHeight));
      const rowHeight = height / rowCount;
      const dotRadius = Math.min(0.75 * ratio, step / 4, height / 2);
      const columnGap = Math.min(ledMaxGap * ratio, step * 0.25);
      const rowGap = Math.min(ledMaxGap * ratio, rowHeight * 0.25);
      const colors = drawing.createLinearGradient(0, 0, width, 0);
      let spectrumTop = height;
      drawing.beginPath();
      drawing.moveTo(0, height);
      for (let band = 0; band < bandCount; band++) {
        let peak = -Infinity;
        for (let bin = this.bandEdges[band]; bin < this.bandEdges[band + 1]; bin++) {
          peak = Math.max(peak, bins[bin]);
        }
        if (peak === -Infinity && this.bandEdges[band] < bins.length) {
          peak = bins[this.bandEdges[band]];
        }
        const level = Math.min(1, Math.max(0, (peak - quietDb) / (loudDb - quietDb)));
        this.bandLevels[band] = level;
        spectrumTop = height * (1 - level);
        const ledTop = height - Math.round(level * rowCount) * rowHeight;
        this.bandTops[band] = spectrumTop + (ledTop - spectrumTop) * ledStrength;
        const center = (band + 0.5) / bandCount;
        if (band === 0) drawing.lineTo(0, spectrumTop);
        drawing.lineTo(center * width, spectrumTop);
        const hue = Math.round(120 * (1 - level));
        colors.addColorStop(center, `hsl(${hue} 100% 55%)`);
        const fallingMs = Math.max(0, now - Math.max(this.lastFrameTime, this.holdUntil[band]));
        const fallingPeak = Math.max(0, this.heldPeaks[band] - fallingMs * peakFallPerMs);
        if (!paused && level > 0 && level >= fallingPeak) {
          this.heldPeaks[band] = level;
          this.holdUntil[band] = now + peakHoldMs;
        } else {
          this.heldPeaks[band] = fallingPeak;
        }
      }
      drawing.lineTo(width, spectrumTop);
      drawing.lineTo(width, height);
      drawing.closePath();
      if (ledStrength) {
        drawing.beginPath();
        drawing.moveTo(0, height);
        for (let band = 0; band < bandCount; band++) {
          const top = this.bandTops[band];
          const previous = this.bandTops[Math.max(0, band - 1)];
          const next = this.bandTops[Math.min(bandCount - 1, band + 1)];
          const left = top + ((previous - top) / 2) * (1 - shapeStrength);
          const right = top + ((next - top) / 2) * (1 - shapeStrength);
          drawing.lineTo(band * step, left);
          drawing.lineTo((band + 0.5) * step, top);
          drawing.lineTo((band + 1) * step, right);
        }
        drawing.lineTo(width, height);
        drawing.closePath();
      }
      drawing.fillStyle = colors;
      drawing.fill();
      if (bandCount < ledTransitionBands) {
        drawing.save();
        drawing.globalCompositeOperation = 'destination-out';
        drawing.globalAlpha = ledStrength;
        drawing.beginPath();
        for (let band = 1; band < bandCount; band++) {
          drawing.rect(band * step - columnGap / 2, 0, columnGap, height);
        }
        for (let row = 1; row < rowCount; row++) {
          const y = height - row * rowHeight;
          drawing.rect(0, y - rowGap / 2, width, rowGap);
        }
        drawing.fill();
        drawing.restore();
      }
      drawing.fillStyle = peakColor;
      for (let band = 0; band < bandCount; band++) {
        if (this.heldPeaks[band] > 0) {
          const dotY = Math.max(dotRadius, height * (1 - this.heldPeaks[band]) - dotRadius);
          const peakRow = Math.max(0, Math.min(rowCount - 1, Math.ceil(this.heldPeaks[band] * rowCount) - 1));
          const rowY = height - (peakRow + 0.5) * rowHeight;
          const y = dotY + (rowY - dotY) * ledStrength;
          drawing.beginPath();
          if (ledStrength === 0) {
            drawing.arc((band + 0.5) * step, y, dotRadius, 0, 2 * Math.PI);
          } else {
            const peakWidth = 2 * dotRadius + (step - columnGap - 2 * dotRadius) * ledStrength;
            const peakHeight = 2 * dotRadius + (rowHeight - rowGap - 2 * dotRadius) * ledStrength;
            const radius = Math.min(dotRadius * (1 - ledStrength), peakWidth / 2, peakHeight / 2);
            drawing.roundRect((band + 0.5) * step - peakWidth / 2, y - peakHeight / 2, peakWidth, peakHeight, radius);
          }
          drawing.fill();
        }
      }
      this.lastFrameTime = now;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = SpectrumVisualizer;
  else globalThis.ErAudioSpectrum = SpectrumVisualizer;
})();
