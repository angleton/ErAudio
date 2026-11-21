# Audio visualizer

The player and the standalone preview use the same spectrum renderer. The player supplies real frequency levels from shared tab audio; the preview supplies simulated levels. The renderer draws them on a canvas and does not capture or record audio.

## Try it

Open [preview.html](./preview.html) directly in a browser. It works offline and needs no YouTube playback, sign-in, or audio sharing. Move **Frequency bands** to try 16–512 bands. Below 256 bands, gaps gradually appear and the display becomes a grid of larger LED-like blocks as the count decreases. At 16 bands, each block is either fully lit or off. Use **Pause** to hold the colored fill while the white peak dots fall; **Resume** restarts the simulation. The preview does not change the player's saved band setting.

Edit a file, save it, and reload the preview to see the change. Edits to the shared renderer affect both the preview and the player.

## Files and responsibilities

| File | Purpose |
| --- | --- |
| [spectrum.js](./spectrum.js) | Shared frequency-to-band mapping, peak timing, and canvas drawing. Start here to change the visualization. |
| [preview.html](./preview.html) | Standalone preview page and controls. |
| [preview.js](./preview.js) | Simulated frequency levels and preview controls. It does not affect the player's audio or BPM detection. |
| [../styles.css](../styles.css) | Shared `.vis-container` background and `#live-spectrum` canvas size and glow. Changes to these rules affect both displays. |
| [../app.js](../app.js) | Manages tab audio capture, the audio analyzers, player pause state, and the renderer's animation loop. BPM detection is separate in [../tempo.js](../tempo.js). |

## Change the display

In [spectrum.js](./spectrum.js):

- **Fill colors:** In `draw()`, change the `hue` calculation or the `hsl(...)` color passed to `colors.addColorStop()`. The current calculation goes from green for quiet levels toward red for loud levels.
- **Peak dots:** Change `peakColor` near the top of the file. Change `dotRadius` or the `drawing.arc()` call in `draw()` to adjust their size or shape.
- **Filled shape:** The `drawing.lineTo()` calls trace the top and bottom of the filled spectrum. Change those calls to draw a different outline.
- **LED-like blocks:** Change `ledTransitionBands`, `ledMaxGap`, or `ledMaxHeight` to adjust when the gaps appear and how large the blocks become. Gaps and whole-block levels gradually replace the continuous fill as the band count approaches `ledMinimumBands`.
- **Peak timing:** Increase `peakHoldMs` to keep dots at their peaks longer; increase `peakFallPerMs` to make them fall faster. For example, changing `peakHoldMs` from `200` to `400` doubles the hold time.
- **Height and frequency response:** `quietDb` and `loudDb` set the decibel range mapped to heights from zero to full. `lowHz` and `highHzLimit` set the displayed frequency range. Band edges are logarithmic, spreading bass and treble across the canvas.

The simulation in [preview.js](./preview.js) can also be edited to try different patterns; it is not the player's audio analyzer.

## How the renderer is called

`new ErAudioSpectrum(canvas, drawing, sampleRate, fftSize, now)` creates a renderer for a canvas and its 2D context. `sampleRate` and `fftSize` describe the frequency data, and `now` is the starting time in milliseconds.

On each animation frame, the caller invokes `draw(bins, bandCount, now, paused, ratio)`:

- `bins` is a `Float32Array` of frequency magnitudes in decibels, as returned by `AnalyserNode.getFloatFrequencyData()`; silence can be `-Infinity`.
- `bandCount` is the number of displayed bands. Changing it resets the held peaks.
- `now` is the animation timestamp in milliseconds, and `ratio` is the device pixel ratio.
- When `paused` is true, the caller must keep `bins` unchanged. The fill then stays fixed while existing peak dots fall instead of being refreshed.

The player handles capture and calls the renderer; the preview creates its own synthetic bins. Neither the renderer nor the preview needs a Google account.

## Tests

From the repository root, with Node.js 24+ and the existing Playwright Chromium setup:

```powershell
node --test tests\spectrum.test.cjs tests\spectrum-preview.test.mjs
node --test --test-name-pattern "live spectrum" tests\top-browser.test.mjs
```

The first command checks peak behavior, band changes, and the offline preview. The second checks that the player uses the renderer and stops sampling on pause. If Playwright or Chromium is missing, see the setup commands in the [main README](../README.md#private-listening-history-sync).
