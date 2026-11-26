[CmdletBinding()]
param(
  [ValidateRange(4, 32)]
  [int]$BandCount = 16,

  [ValidateRange(5, 30)]
  [int]$FramesPerSecond = 15,

  [switch]$Demo,

  [ValidateRange(0, 600)]
  [int]$DurationSeconds = 0
)

$ErrorActionPreference = 'Stop'

if (-not ('ErAudioLoopbackCapture' -as [type])) {
  Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject
{
}

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out object devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice
{
    [PreserveSig] int Activate(ref Guid iid, int classContext, IntPtr activationParameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    [PreserveSig] int OpenPropertyStore(int access, out object properties);
    [PreserveSig] int GetId(out IntPtr id);
    [PreserveSig] int GetState(out int state);
}

[ComImport]
[Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient
{
    [PreserveSig] int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
    [PreserveSig] int GetBufferSize(out uint bufferSize);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint padding);
    [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr eventHandle);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}

[ComImport]
[Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient
{
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint packetSize);
}

[StructLayout(LayoutKind.Sequential, Pack = 2)]
struct WaveFormatEx
{
    public ushort FormatTag;
    public ushort Channels;
    public uint SamplesPerSecond;
    public uint AverageBytesPerSecond;
    public ushort BlockAlign;
    public ushort BitsPerSample;
    public ushort ExtraSize;
}

public sealed class ErAudioLoopbackCapture : IDisposable
{
    private const int SharedMode = 0;
    private const int LoopbackFlag = 0x00020000;
    private const int ClassContextAll = 23;
    private const uint SilentBufferFlag = 0x00000002;
    private readonly object _sampleLock = new object();
    private readonly double[] _samples = new double[2048];
    private int _writeIndex;
    private int _sampleRate;
    private int _channels;
    private int _blockAlign;
    private int _bitsPerSample;
    private bool _isFloat;
    private bool _started;
    private IntPtr _formatPointer = IntPtr.Zero;
    private IMMDeviceEnumerator _enumerator;
    private IMMDevice _device;
    private IAudioClient _audioClient;
    private IAudioCaptureClient _captureClient;

    public int SampleRate { get { return _sampleRate; } }

    public ErAudioLoopbackCapture()
    {
        _enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        Check(_enumerator.GetDefaultAudioEndpoint(0, 1, out _device));

        Guid audioClientId = typeof(IAudioClient).GUID;
        object audioClientObject;
        Check(_device.Activate(ref audioClientId, ClassContextAll, IntPtr.Zero, out audioClientObject));
        _audioClient = (IAudioClient)audioClientObject;
        Check(_audioClient.GetMixFormat(out _formatPointer));

        WaveFormatEx format = (WaveFormatEx)Marshal.PtrToStructure(_formatPointer, typeof(WaveFormatEx));
        _sampleRate = (int)format.SamplesPerSecond;
        _channels = format.Channels;
        _blockAlign = format.BlockAlign;
        _bitsPerSample = format.BitsPerSample;
        _isFloat = format.FormatTag == 3;
        if (format.FormatTag != 1 && format.FormatTag != 3 && format.FormatTag != 0xFFFE)
        {
            throw new NotSupportedException("The default audio device uses an unsupported sample format.");
        }
        if (format.FormatTag == 0xFFFE)
        {
            Guid subFormat = (Guid)Marshal.PtrToStructure(IntPtr.Add(_formatPointer, 24), typeof(Guid));
            _isFloat = subFormat == new Guid("00000003-0000-0010-8000-00aa00389b71");
            if (!_isFloat && subFormat != new Guid("00000001-0000-0010-8000-00aa00389b71"))
            {
                throw new NotSupportedException("The default audio device uses an unsupported sample format.");
            }
        }
        if (_channels < 1 || _sampleRate < 1 || _blockAlign < 1
            || (_bitsPerSample != 8 && _bitsPerSample != 16 && _bitsPerSample != 24 && _bitsPerSample != 32)
            || (_isFloat && _bitsPerSample != 32))
        {
            throw new NotSupportedException("The default audio device uses an unsupported sample format.");
        }

        Check(_audioClient.Initialize(SharedMode, LoopbackFlag, 2000000, 0, _formatPointer, IntPtr.Zero));
        Guid captureClientId = typeof(IAudioCaptureClient).GUID;
        object captureClientObject;
        Check(_audioClient.GetService(ref captureClientId, out captureClientObject));
        _captureClient = (IAudioCaptureClient)captureClientObject;
        Check(_audioClient.Start());
        _started = true;
    }

    public double[] ReadSamples()
    {
        uint packetSize;
        Check(_captureClient.GetNextPacketSize(out packetSize));
        while (packetSize > 0)
        {
            IntPtr data;
            uint frames;
            uint flags;
            ulong devicePosition;
            ulong qpcPosition;
            Check(_captureClient.GetBuffer(out data, out frames, out flags, out devicePosition, out qpcPosition));
            try
            {
                byte[] bytes = new byte[frames * _blockAlign];
                if ((flags & SilentBufferFlag) == 0 && bytes.Length > 0)
                {
                    Marshal.Copy(data, bytes, 0, bytes.Length);
                }

                int bytesPerSample = _bitsPerSample / 8;
                for (int frame = 0; frame < frames; frame++)
                {
                    double mono = 0;
                    if ((flags & SilentBufferFlag) == 0)
                    {
                        for (int channel = 0; channel < _channels; channel++)
                        {
                            mono += DecodeSample(bytes, frame * _blockAlign + channel * bytesPerSample);
                        }
                        mono /= _channels;
                    }

                    lock (_sampleLock)
                    {
                        _samples[_writeIndex] = mono;
                        _writeIndex = (_writeIndex + 1) % _samples.Length;
                    }
                }
            }
            finally
            {
                Check(_captureClient.ReleaseBuffer(frames));
            }

            Check(_captureClient.GetNextPacketSize(out packetSize));
        }

        double[] result = new double[_samples.Length];
        lock (_sampleLock)
        {
            for (int i = 0; i < _samples.Length; i++)
            {
                result[i] = _samples[(_writeIndex + i) % _samples.Length];
            }
        }
        return result;
    }

    private double DecodeSample(byte[] bytes, int offset)
    {
        if (_isFloat)
        {
            float value = BitConverter.ToSingle(bytes, offset);
            return Single.IsNaN(value) || Single.IsInfinity(value) ? 0 : value;
        }

        if (_bitsPerSample == 8) return (bytes[offset] - 128) / 128.0;
        if (_bitsPerSample == 16) return BitConverter.ToInt16(bytes, offset) / 32768.0;
        if (_bitsPerSample == 24)
        {
            int value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
            if ((value & 0x800000) != 0) value |= unchecked((int)0xFF000000);
            return value / 8388608.0;
        }
        return BitConverter.ToInt32(bytes, offset) / 2147483648.0;
    }

    private static void Check(int result)
    {
        Marshal.ThrowExceptionForHR(result);
    }

    public void Dispose()
    {
        Exception stopError = null;
        if (_started && _audioClient != null)
        {
            int result = _audioClient.Stop();
            _started = false;
            if (result < 0) stopError = Marshal.GetExceptionForHR(result);
        }

        if (_formatPointer != IntPtr.Zero)
        {
            Marshal.FreeCoTaskMem(_formatPointer);
            _formatPointer = IntPtr.Zero;
        }
        if (_captureClient != null) Marshal.ReleaseComObject(_captureClient);
        if (_audioClient != null) Marshal.ReleaseComObject(_audioClient);
        if (_device != null) Marshal.ReleaseComObject(_device);
        if (_enumerator != null) Marshal.ReleaseComObject(_enumerator);
        if (stopError != null) throw stopError;
    }
}
'@
}

function Get-SpectrumLevels {
  param(
    [double[]]$Samples,
    [int]$SampleRate,
    [int]$Bands
  )

  $count = $Samples.Length
  $real = [double[]]::new($count)
  $imaginary = [double[]]::new($count)
  $windowTotal = 0.0
  for ($i = 0; $i -lt $count; $i++) {
    $window = 0.5 - (0.5 * [Math]::Cos((2 * [Math]::PI * $i) / ($count - 1)))
    $real[$i] = $Samples[$i] * $window
    $windowTotal += $window
  }

  $reversed = 0
  for ($i = 1; $i -lt $count; $i++) {
    $bit = $count -shr 1
    while (($reversed -band $bit) -ne 0) {
      $reversed = $reversed -bxor $bit
      $bit = $bit -shr 1
    }
    $reversed = $reversed -bxor $bit
    if ($i -lt $reversed) {
      $swap = $real[$i]
      $real[$i] = $real[$reversed]
      $real[$reversed] = $swap
      $swap = $imaginary[$i]
      $imaginary[$i] = $imaginary[$reversed]
      $imaginary[$reversed] = $swap
    }
  }

  for ($size = 2; $size -le $count; $size *= 2) {
    $half = $size -shr 1
    $angle = -2 * [Math]::PI / $size
    $stepReal = [Math]::Cos($angle)
    $stepImaginary = [Math]::Sin($angle)
    for ($start = 0; $start -lt $count; $start += $size) {
      $weightReal = 1.0
      $weightImaginary = 0.0
      for ($offset = 0; $offset -lt $half; $offset++) {
        $even = $start + $offset
        $odd = $even + $half
        $termReal = ($real[$odd] * $weightReal) - ($imaginary[$odd] * $weightImaginary)
        $termImaginary = ($real[$odd] * $weightImaginary) + ($imaginary[$odd] * $weightReal)
        $real[$odd] = $real[$even] - $termReal
        $imaginary[$odd] = $imaginary[$even] - $termImaginary
        $real[$even] += $termReal
        $imaginary[$even] += $termImaginary
        $nextWeightReal = ($weightReal * $stepReal) - ($weightImaginary * $stepImaginary)
        $weightImaginary = ($weightReal * $stepImaginary) + ($weightImaginary * $stepReal)
        $weightReal = $nextWeightReal
      }
    }
  }

  $levels = [double[]]::new($Bands)
  $maximumFrequency = [Math]::Min(16000, $SampleRate / 2)
  $minimumFrequency = 40.0
  for ($band = 0; $band -lt $Bands; $band++) {
    $lowerFrequency = $minimumFrequency * [Math]::Pow($maximumFrequency / $minimumFrequency, $band / $Bands)
    $upperFrequency = $minimumFrequency * [Math]::Pow($maximumFrequency / $minimumFrequency, ($band + 1) / $Bands)
    $firstBin = [Math]::Max(1, [int][Math]::Floor($lowerFrequency * $count / $SampleRate))
    $lastBin = [Math]::Min(($count - 1) -shr 1, [int][Math]::Ceiling($upperFrequency * $count / $SampleRate))
    $maximumMagnitude = 0.0
    for ($bin = $firstBin; $bin -le $lastBin; $bin++) {
      $magnitude = 2 * [Math]::Sqrt(($real[$bin] * $real[$bin]) + ($imaginary[$bin] * $imaginary[$bin])) / $windowTotal
      if ($magnitude -gt $maximumMagnitude) {
        $maximumMagnitude = $magnitude
      }
    }

    $decibels = 20 * [Math]::Log10($maximumMagnitude + 0.000000001)
    $levels[$band] = [Math]::Max(0, [Math]::Min(1, ($decibels + 65) / 55))
  }
  return ,$levels
}

function New-DemoSamples {
  param(
    [int]$Count,
    [int]$SampleRate,
    [int]$Frame,
    [int]$FramesPerSecond
  )

  $samples = [double[]]::new($Count)
  $sweepLength = 8 * $FramesPerSecond
  $position = ($Frame % $sweepLength) / [double]$sweepLength
  $maximumFrequency = [Math]::Min(5000, ($SampleRate / 2) - 1)
  $frequency = 40 * [Math]::Pow($maximumFrequency / 40, $position)
  for ($i = 0; $i -lt $Count; $i++) {
    $time = (($Frame * $Count) + $i) / [double]$SampleRate
    $samples[$i] = (0.42 * [Math]::Sin(2 * [Math]::PI * $frequency * $time)) +
      (0.18 * [Math]::Sin(2 * [Math]::PI * $frequency * 2 * $time))
  }
  return ,$samples
}

function Get-BarColor {
  param([double]$Level)

  if ($Level -ge 0.8) { return [ConsoleColor]::Red }
  if ($Level -ge 0.55) { return [ConsoleColor]::Yellow }
  if ($Level -ge 0.3) { return [ConsoleColor]::Green }
  return [ConsoleColor]::Cyan
}

if ([Console]::IsOutputRedirected) {
  throw 'Run this visualizer in an interactive console window.'
}

$capture = $null
$originalColor = [Console]::ForegroundColor
$originalCursorVisible = [Console]::CursorVisible
$fftSize = 512
$decimationFactor = 4
$sampleRate = 48000
$analysisSampleRate = [int]($sampleRate / $decimationFactor)
$frameDuration = [Math]::Max(1, [int](1000 / $FramesPerSecond))
$levels = [double[]]::new($BandCount)
$frame = 0
$stopwatch = [Diagnostics.Stopwatch]::StartNew()

try {
  if (-not $Demo) {
    $capture = [ErAudioLoopbackCapture]::new()
    $sampleRate = $capture.SampleRate
    $analysisSampleRate = [int]($sampleRate / $decimationFactor)
  }

  [Console]::Clear()
  [Console]::CursorVisible = $false
  while ($DurationSeconds -eq 0 -or $stopwatch.Elapsed.TotalSeconds -lt $DurationSeconds) {
    $frameTimer = [Diagnostics.Stopwatch]::StartNew()
    if ($Demo) {
      $samples = New-DemoSamples -Count $fftSize -SampleRate $analysisSampleRate -Frame $frame -FramesPerSecond $FramesPerSecond
    } else {
      $sourceSamples = $capture.ReadSamples()
      $samples = [double[]]::new($fftSize)
      for ($i = 0; $i -lt $fftSize; $i++) {
        $sum = 0.0
        for ($offset = 0; $offset -lt $decimationFactor; $offset++) {
          $sum += $sourceSamples[($i * $decimationFactor) + $offset]
        }
        $samples[$i] = $sum / $decimationFactor
      }
    }

    $measured = Get-SpectrumLevels -Samples $samples -SampleRate $analysisSampleRate -Bands $BandCount
    for ($band = 0; $band -lt $BandCount; $band++) {
      $levels[$band] = [Math]::Max($measured[$band], $levels[$band] * 0.78)
    }

    [Console]::SetCursorPosition(0, 0)
    for ($row = 10; $row -ge 1; $row--) {
      $threshold = $row / 10.0
      for ($band = 0; $band -lt $BandCount; $band++) {
        if ($levels[$band] -ge $threshold) {
          [Console]::ForegroundColor = Get-BarColor -Level $levels[$band]
          [Console]::Write('##')
        } else {
          [Console]::ForegroundColor = [ConsoleColor]::DarkGray
          [Console]::Write('  ')
        }
      }
      [Console]::WriteLine()
    }

    [Console]::ForegroundColor = [ConsoleColor]::Gray
    [Console]::WriteLine('LOW  ------------------------  HIGH')
    $mode = if ($Demo) { 'generated demo' } else { 'Windows output loopback' }
    [Console]::WriteLine(('{0} | {1} bands | {2} Hz | Ctrl+C to stop' -f $mode, $BandCount, $sampleRate))

    $frame++
    $remaining = $frameDuration - [int]$frameTimer.ElapsedMilliseconds
    if ($remaining -gt 0) {
      Start-Sleep -Milliseconds $remaining
    }
  }
} catch {
  [Console]::SetCursorPosition(0, 12)
  [Console]::ForegroundColor = [ConsoleColor]::Gray
  Write-Error $_
} finally {
  try {
    if ($capture) {
      $capture.Dispose()
    }
  } finally {
    [Console]::ForegroundColor = $originalColor
    [Console]::CursorVisible = $originalCursorVisible
    [Console]::WriteLine()
  }
}
