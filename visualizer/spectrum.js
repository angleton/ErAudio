(() => {
  const lowHz = 30;
  const highHzLimit = 16000;
  const quietDb = -90;
  const loudDb = -25;
  const peakHoldMs = 200;
  const peakFallPerMs = 0.0008;
  const peakColor = '#fff';

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
      }
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      drawing.clearRect(0, 0, width, height);
      const step = width / bandCount;
      const dotRadius = Math.min(0.75 * ratio, step / 4, height / 2);
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
        spectrumTop = height * (1 - level);
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
      drawing.fillStyle = colors;
      drawing.fill();
      drawing.fillStyle = peakColor;
      for (let band = 0; band < bandCount; band++) {
        if (this.heldPeaks[band] > 0) {
          const y = Math.max(dotRadius, height * (1 - this.heldPeaks[band]) - dotRadius);
          drawing.beginPath();
          drawing.arc((band + 0.5) * step, y, dotRadius, 0, 2 * Math.PI);
          drawing.fill();
        }
      }
      this.lastFrameTime = now;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = SpectrumVisualizer;
  else globalThis.ErAudioSpectrum = SpectrumVisualizer;
})();
