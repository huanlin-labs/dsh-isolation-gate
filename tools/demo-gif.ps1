# 录制 / 合成 README 演示 GIF（Windows，自带 ffmpeg 即可）
#
# 用法 A：录制——你先打开 DSH 的「门禁」页，然后运行：
#   pwsh -File tools/demo-gif.ps1 -Mode record -Seconds 20 -Fps 2
#   录完按提示操作界面（脚本只负责定时截图，不注入任何点击）
#
# 用法 B：合成——已有 01.png..NN.png（任意截图序列）：
#   pwsh -File tools/demo-gif.ps1 -Mode assemble -FramesDir D:\临时\demo-frames
#
# 产物：docs/screenshots/demo.gif（宽度 960，循环播放）

param(
  [ValidateSet('record', 'assemble')]
  [string]$Mode = 'assemble',
  [int]$Seconds = 20,
  [double]$Fps = 2,
  [string]$FramesDir = 'D:\临时\demo-frames',
  [string]$OutFile = 'docs\screenshots\demo.gif',
  [int]$Width = 960
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not [System.IO.Path]::IsPathRooted($OutFile)) { $OutFile = Join-Path $repo $OutFile }

Add-Type -AssemblyName System.Drawing, System.Windows.Forms

function Get-ForegroundWindowRect {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@ -ErrorAction SilentlyContinue
  $h = [W]::GetForegroundWindow()
  $r = New-Object W+RECT
  [void][W]::GetWindowRect($h, [ref]$r)
  return @{ X = $r.Left; Y = $r.Top; W = $r.Right - $r.Left; H = $r.Bottom - $r.Top }
}

if ($Mode -eq 'record') {
  New-Item -ItemType Directory -Force -Path $FramesDir | Out-Null
  Get-ChildItem $FramesDir -Filter '*.png' | Remove-Item -Force -ErrorAction SilentlyContinue
  $interval = [int](1000 / $Fps)
  $count = [int]($Seconds * $Fps)
  Write-Host "3 秒后开始，共 $count 帧（每 $interval ms 一帧）。请把 DSH 窗口切到前台。" -ForegroundColor Cyan
  Start-Sleep -Seconds 3
  for ($i = 1; $i -le $count; $i++) {
    $rect = Get-ForegroundWindowRect
    if ($rect.W -le 0 -or $rect.H -le 0) { Start-Sleep -Milliseconds $interval; continue }
    $bmp = New-Object System.Drawing.Bitmap $rect.W, $rect.H
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.X, $rect.Y, 0, 0, $bmp.Size)
    $g.Dispose()
    $name = Join-Path $FramesDir ('{0:D3}.png' -f $i)
    $bmp.Save($name, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Start-Sleep -Milliseconds $interval
  }
  Write-Host "录完：$FramesDir（共 $count 帧）" -ForegroundColor Green
}

# 合成
$frames = Get-ChildItem $FramesDir -Filter '*.png' | Sort-Object Name
if ($frames.Count -lt 2) { throw "帧不足：$FramesDir 里需要至少 2 张 png" }

$ff = (Get-Command ffmpeg -ErrorAction SilentlyContinue)
if (-not $ff) { throw '找不到 ffmpeg（winget install Gyan.FFmpeg）' }

$palette = Join-Path $env:TEMP 'gate-demo-palette.png'
$fpsArg = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, '{0}', $Fps)

# 两遍法：先生成调色板，再按调色板量化，颜色不脏
& $ff.Source -y -framerate $fpsArg -i (Join-Path $FramesDir '%03d.png') `
  -vf "scale=$Width:-1:flags=lanczos,palettegen=stats_mode=diff" $palette 2>$null
& $ff.Source -y -framerate $fpsArg -i (Join-Path $FramesDir '%03d.png') -i $palette `
  -lavfi "scale=$Width:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" `
  -loop 0 $OutFile 2>$null

if (Test-Path $OutFile) {
  $kb = [math]::Round((Get-Item $OutFile).Length / 1KB, 1)
  Write-Host "OK -> $OutFile ($kb KB)" -ForegroundColor Green
  Write-Host '别忘了把 README 顶部截图换成这张 GIF。'
} else {
  throw 'ffmpeg 未产出文件，检查上面的报错'
}
