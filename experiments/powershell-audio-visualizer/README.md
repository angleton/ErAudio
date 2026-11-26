# PowerShell console audio visualizer

A standalone Windows toy that draws 16 colored frequency bars from the default
audio output in a PowerShell console. It is separate from the browser player's
visualizer and does not record or save audio.

## Run it

Open PowerShell in the repository root and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\experiments\powershell-audio-visualizer\ErAudio.ps1 -v https://www.youtube.com/watch?v=aXedWClewDU
```

The optional URL opens in your default browser. Start playback there if it
doesn't start automatically; the console shows 16 colored frequency bars from
the default Windows output device. Press `Ctrl+C` to stop. The script captures
system output through Windows WASAPI loopback; it does not use a microphone.

To visualize whatever audio is already playing, omit the URL:

```powershell
powershell -ExecutionPolicy Bypass -File .\experiments\powershell-audio-visualizer\ErAudio.ps1 -v
```

Try a generated tone sweep without capturing audio:

```powershell
powershell -ExecutionPolicy Bypass -File .\experiments\powershell-audio-visualizer\ErAudio.ps1 -Demo -DurationSeconds 8
```

Use `-BandCount 16` to select the original toy-sized display. The band count
can be adjusted from 4 to 32, and `-FramesPerSecond` from 5 to 30.

## How it works

PowerShell reads 2,048 recent mono samples, averages them down to a 512-sample
analysis window, applies a Hann window, runs an FFT, groups its bins into
logarithmically spaced bands, and redraws the console in color. The capture
bridge is a small C# interop type compiled inline with
PowerShell's built-in `Add-Type`, because Windows exposes system-output loopback
through COM. No NuGet package, executable, microphone permission, or network
access is required by the visualizer itself. Opening a YouTube URL uses the
default browser and its normal network access.

Change the console colors in `Get-BarColor`, the frequency range in
`Get-SpectrumLevels`, or the bar layout in the main loop. `-Demo` is useful for
testing those display changes without playing or capturing audio.
