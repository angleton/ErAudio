(() => {
  const sampleMs = 20;
  const minLag = Math.ceil(60000 / (200 * sampleMs));
  const maxLag = Math.ceil(60000 / (55 * sampleMs));
  const weights = [0.65, 0.25, 0.1];
  const onsetFloor = 0.001;
  const confidenceHoldMs = 3000;
  const maxInterpolationMs = 120;
  const maxGapMs = 500;
  const tempoHintMs = 30000;
  const tempoHintFadeMs = 20000;
  const phaseConfidence = 0.45;
  const phaseWindowFraction = 0.25;
  const phaseCorrection = 0.15;
  const maxPhaseCorrectionMs = 15;
  const beatFlashMs = 100;

  function phaseDifference(time, reference, period) {
    return ((time - reference + period / 2) % period + period) % period - period / 2;
  }

  function estimateBeatPhase(onsets, lastSample, bpm, now, hint, strength) {
    const period = 60000 / bpm;
    let total = 0;
    let nearby = 0;
    let weighted = 0;
    let cosine = 0;
    let sine = 0;
    for (let index = 0; index < onsets.length; index++) {
      const onset = onsets[index];
      if (!(onset > 0)) continue;
      const time = lastSample - (onsets.length - 1 - index) * sampleMs;
      const distance = hint ? Math.abs(phaseDifference(time, hint.phase, period)) : 0;
      const proximity = hint ? Math.max(0, 1 - distance / (period * phaseWindowFraction)) : 0;
      total += onset;
      if (hint && distance <= period * phaseWindowFraction) nearby += onset;
      const weight = onset * (1 + 3 * strength * proximity);
      const angle = 2 * Math.PI * phaseDifference(time, now, period) / period;
      weighted += weight;
      cosine += weight * Math.cos(angle);
      sine += weight * Math.sin(angle);
    }
    if (!total || (hint && nearby / total < 0.2)
      || Math.hypot(cosine, sine) / weighted < phaseConfidence) return null;
    return now + Math.atan2(sine, cosine) * period / (2 * Math.PI);
  }

  function estimateTempo(onsets, hintBpm, hintStrength) {
    const observed = onsets.filter((value) => value !== null);
    const mean = observed.reduce((sum, value) => sum + value, 0) / observed.length;
    const signal = onsets.slice(1, -1).map((value, i) => {
      const before = onsets[i];
      const after = onsets[i + 2];
      return before === null || value === null || after === null ? null : (before + 2 * value + after) / 4 - mean;
    });
    const scores = [];
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let a2 = 0, b2 = 0, cross = 0;
      let pairs = 0;
      for (let i = lag; i < signal.length; i++) {
        const a = signal[i];
        const b = signal[i - lag];
        if (a === null || b === null) continue;
        a2 += a * a;
        b2 += b * b;
        cross += a * b;
        pairs++;
      }
      scores[lag] = pairs >= (signal.length - lag) * 0.75 ? cross / Math.sqrt(a2 * b2) || 0 : 0;
    }
    const peaks = [];
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (scores[lag] > scores[lag - 1] && scores[lag] >= scores[lag + 1]) peaks.push(lag);
    }
    const best = Math.max(0, ...peaks.map((lag) => scores[lag]));
    // Prefer the first strong repeat over an equally convincing multiple (half tempo).
    let peak = peaks.find((lag) => scores[lag] >= Math.max(0.38, best * 0.88));
    if (peak === undefined) return null;
    // Alternating accents favor the two-beat lag; use the shorter lag only if it has its own peak.
    const half = peaks.find((lag) => Math.abs(2 * lag - peak) <= 2
      && scores[lag] >= Math.max(0.34, scores[peak] * 0.45));
    if (half !== undefined) peak = half;
    if (hintBpm !== undefined && hintStrength > 0) {
      // Taps favor weaker audio-supported peaks, with the advantage fading over time.
      const minimumScore = Math.max(0.25, best * 0.35, scores[peak] - best * 0.65 * hintStrength);
      const hinted = peaks.filter((lag) => scores[lag] >= minimumScore
        && Math.abs(60000 / (lag * sampleMs) - hintBpm) <= hintBpm * 0.08)
        .sort((a, b) => scores[b] - scores[a])[0];
      if (hinted !== undefined) peak = hinted;
    }
    const left = scores[peak - 1];
    const center = scores[peak];
    const right = scores[peak + 1];
    const refined = peak + (left - right) / (2 * (left - 2 * center + right));
    const bpm = 60000 / (refined * sampleMs);
    return Math.max(55, Math.min(200, Math.round(bpm)));
  }

  class LiveTempo {
    constructor() {
      this.reset();
    }

    static bandLevel(bins, start, end) {
      let power = 0;
      for (let bin = start; bin < end; bin++) power += 10 ** (bins[bin] / 10);
      // Log compression preserves changes in loud bands without clipping their peaks.
      return Math.log10(1 + power * 1e8) / 6.5;
    }

    reset() {
      this.previous = null;
      this.onsets = [];
      this.lastOnset = -Infinity;
      this.lastConfidentAt = -Infinity;
      this.nextEstimate = 0;
      this.bpm = null;
      this.clearTempoHint();
      this.beatHint = null;
      this.audioBeat = null;
    }

    clearTempoHint() {
      this.tempoHint = null;
    }

    setTempoHint(bpm) {
      if (!this.previous || !Number.isFinite(bpm) || bpm < 55 || bpm > 200) return;
      this.tempoHint = { bpm, expiresAt: this.previous.now + tempoHintMs };
      this.nextEstimate = 0;
    }

    setBeatTapHint(bpm, now) {
      if (!Number.isFinite(now) || !Number.isFinite(bpm) || bpm < 55 || bpm > 200) return;
      this.beatHint = { bpm, phase: now, expiresAt: now + tempoHintMs, confirmedAt: -Infinity };
    }

    beatAt(now) {
      if (!Number.isFinite(now)) return null;
      const hint = this.beatHint && now < this.beatHint.expiresAt ? this.beatHint : null;
      const audio = this.audioBeat && this.audioBeat.bpm === this.bpm
        && now - this.audioBeat.confirmedAt < confidenceHoldMs ? this.audioBeat : null;
      const beat = hint || audio;
      if (!beat) return null;
      const period = 60000 / beat.bpm;
      const offset = phaseDifference(now, beat.phase, period);
      return {
        lit: Math.abs(offset) < beatFlashMs / 2,
        confidence: hint && now - hint.confirmedAt >= confidenceHoldMs ? 'uncertain' : 'estimated',
      };
    }

    update(now, bands) {
      const gap = this.previous ? now - this.previous.now : 0;
      if (gap < 0 || gap > maxGapMs) this.reset();
      if (!this.previous) {
        this.previous = { now, bands: bands.slice() };
        this.grid = bands.slice();
        this.nextSample = now + sampleMs;
        return null;
      }
      const { now: previousTime, bands: previousBands } = this.previous;
      // Skip missed frames rather than inventing beat energy across the gap.
      if (gap > maxInterpolationMs) this.grid.set(bands);
      while (this.nextSample <= now) {
        if (gap > maxInterpolationMs) {
          this.onsets.push(null);
        } else {
          const fraction = (this.nextSample - previousTime) / (now - previousTime);
          let flux = 0;
          for (let i = 0; i < weights.length; i++) {
            const value = previousBands[i] + fraction * (bands[i] - previousBands[i]);
            flux += weights[i] * Math.max(0, value - this.grid[i]);
            this.grid[i] = value;
          }
          this.onsets.push(Math.max(0, flux - onsetFloor));
          if (flux > onsetFloor) this.lastOnset = this.nextSample;
        }
        if (this.onsets.length > 500) this.onsets.shift();
        this.nextSample += sampleMs;
      }
      this.previous.now = now;
      this.previous.bands.set(bands);
      if (now - this.lastOnset <= 2000 && this.onsets.length >= 300 && now >= this.nextEstimate) {
        this.nextEstimate = now + 1000;
        const hint = this.tempoHint;
        const strength = hint ? Math.min(1, Math.max(0, (hint.expiresAt - now) / tempoHintFadeMs)) : 0;
        const estimate = estimateTempo(this.onsets, hint?.bpm, strength);
        if (estimate !== null) {
          this.bpm = estimate;
          this.lastConfidentAt = now;
          const lastSample = this.nextSample - sampleMs;
          const phase = estimateBeatPhase(this.onsets, lastSample, estimate, now, null, 0);
          if (phase !== null) this.audioBeat = { bpm: estimate, phase, confirmedAt: now };
          const beatHint = this.beatHint;
          if (beatHint && now < beatHint.expiresAt && Math.abs(estimate - beatHint.bpm) <= beatHint.bpm * 0.08) {
            const strength = Math.min(1, Math.max(0, (beatHint.expiresAt - now) / tempoHintFadeMs));
            const guided = estimateBeatPhase(this.onsets, lastSample, beatHint.bpm, now, beatHint, strength);
            if (guided !== null) {
              const difference = phaseDifference(guided, beatHint.phase, 60000 / beatHint.bpm);
              if (Math.abs(difference) <= 60000 / beatHint.bpm * phaseWindowFraction) {
                beatHint.phase += Math.max(-maxPhaseCorrectionMs, Math.min(maxPhaseCorrectionMs, difference * phaseCorrection));
                beatHint.confirmedAt = now;
              }
            }
          }
        }
      }
      if (now - this.lastOnset > 2000 || now - this.lastConfidentAt >= confidenceHoldMs) this.bpm = null;
      return this.bpm;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = LiveTempo;
  else globalThis.ErAudioLiveTempo = LiveTempo;
})();
