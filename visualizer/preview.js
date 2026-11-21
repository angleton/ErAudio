(() => {
  const canvas = document.querySelector('#live-spectrum');
  const drawing = canvas.getContext('2d');
  if (!drawing) {
    const error = document.querySelector('#preview-error');
    error.textContent = 'The spectrum preview needs a browser with Canvas 2D support.';
    error.hidden = false;
    return;
  }

  const bandInput = document.querySelector('#preview-bands');
  const bandValue = document.querySelector('#preview-band-value');
  const pauseButton = document.querySelector('#preview-pause');
  const sampleRate = 44100;
  const fftSize = 32768;
  const bins = new Float32Array(fftSize / 2).fill(-Infinity);
  const frequencies = Float32Array.from(bins, (_, index) =>
    Math.log2(Math.max(30, index * sampleRate / fftSize) / 30));
  const visualizer = new ErAudioSpectrum(canvas, drawing, sampleRate, fftSize, performance.now());
  let paused = false;

  bandInput.addEventListener('input', () => {
    bandValue.value = bandInput.value;
    canvas.setAttribute('aria-label', `Simulated audio spectrum with ${bandInput.value} frequency bands, bass on the left and treble on the right`);
  });
  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    pauseButton.setAttribute('aria-pressed', String(paused));
  });

  function draw(now) {
    if (!paused) {
      const time = now / 1000;
      const beat = Math.max(0, Math.sin(time * Math.PI * 4)) ** 3;
      for (let bin = 0; bin < bins.length; bin++) {
        const frequency = frequencies[bin];
        const bass = beat * Math.max(0, 1 - frequency / 4);
        const waves = (1 + Math.sin(frequency * 2.4 - time * 2)) / 2;
        const level = Math.min(1, 0.1 + bass * 0.5 + waves * 0.35);
        bins[bin] = -90 + 65 * level;
      }
    }
    visualizer.draw(bins, Number(bandInput.value), now, paused, window.devicePixelRatio || 1);
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
