<#
    fetch-pdfjs.ps1 —— 取 pdf.js 运行时（后台「PDF 封面生成」依赖它）

    为什么需要这个脚本：
      · 本项目的部署方式是**文件同步**，服务器上不跑 npm install，所以依赖必须 vendor 进仓库；
      · 但 pdf.js 的分发文件（pdf.min.mjs 约 400 KB、pdf.worker.min.mjs 约 1.1 MB）不适合手工复制，
        用这个脚本一次取好，放进 core/admin/static/vendors/pdfjs/ 即可（这两个文件已在同步清单里）。

    只取两个文件，且取 **legacy** 构建：
      后台使用者是普通教师，浏览器版本参差，legacy 构建对旧浏览器更宽容（体积略大，可接受）。

    用法（在项目根目录或任意位置）：
        .\tools\fetch-pdfjs.ps1
        .\tools\fetch-pdfjs.ps1 -Version 4.10.38 -RepoPath D:\teacherGeng\AetherCMS\aether-cms-xl

    取件顺序：先试 npm（版本最可靠）→ 再试 unpkg 的 legacy 路径 → 再试 cdnjs 的常规路径。
    取完会校验大小与内容（避免把 404/HTML 错误页当成 js 存进去）。
#>
[CmdletBinding()]
param(
    [string]$Version = '4.10.38',
    [string]$RepoPath
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $RepoPath) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $RepoPath = Split-Path -Parent $scriptDir
}
$RepoPath = (Resolve-Path $RepoPath).Path
$dest = Join-Path $RepoPath 'core\admin\static\vendors\pdfjs'
New-Item -ItemType Directory -Path $dest -Force | Out-Null

Write-Host "pdf.js 目标目录 : $dest"
Write-Host "版本           : $Version"
Write-Host ""

$files = @('pdf.min.mjs', 'pdf.worker.min.mjs')

function Test-PdfjsFile {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path $Path)) { return $false }
    $item = Get-Item $Path
    # 体量太小基本是错误页；再抽头 200 字节确认不是 HTML
    if ($item.Length -lt 50000) { return $false }
    $head = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    if ($head.Length -gt 200) { $head = $head.Substring(0, 200) }
    if ($head -match '<html|<!DOCTYPE html') { return $false }
    Write-Host ("  ok  {0}  ({1:N0} KB)" -f $Name, ($item.Length / 1KB))
    return $true
}

# ---------------------------------------------------------------- 方案 1：npm
function Get-FromNpm {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) { return $false }

    $tmp = Join-Path $env:TEMP ("pdfjs-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $ok = $false
    try {
        Write-Host "尝试 npm pack pdfjs-dist@$Version …"
        Push-Location $tmp
        npm pack "pdfjs-dist@$Version" --silent 2>&1 | Out-Null
        $tgz = Get-ChildItem $tmp -Filter 'pdfjs-dist-*.tgz' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $tgz) { throw 'npm pack 没有产出 tgz' }

        tar -xzf $tgz.FullName
        foreach ($name in $files) {
            $from = Join-Path $tmp ("package\legacy\build\" + $name)
            if (-not (Test-Path $from)) { $from = Join-Path $tmp ("package\build\" + $name) }
            if (-not (Test-Path $from)) { throw ("包内找不到 " + $name) }
            Copy-Item $from (Join-Path $dest $name) -Force
        }
        $ok = $true
    } catch {
        Write-Host ("  npm 方式失败：" + $_.Exception.Message) -ForegroundColor Yellow
    } finally {
        Pop-Location -ErrorAction SilentlyContinue
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    return $ok
}

# ------------------------------------------------- 方案 2/3：直接下载（多镜像）
function Get-FromUrls {
    param([string]$Name, [string[]]$Urls)
    foreach ($url in $Urls) {
        try {
            Write-Host "  下载 $Name ← $url"
            $tmpFile = Join-Path $env:TEMP ("pdfjs-" + $Name)
            Invoke-WebRequest -Uri $url -OutFile $tmpFile -UseBasicParsing -TimeoutSec 120
            Copy-Item $tmpFile (Join-Path $dest $Name) -Force
            Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
            return $true
        } catch {
            Write-Host ("    失败：" + $_.Exception.Message) -ForegroundColor Yellow
        }
    }
    return $false
}

$cdnUrls = @{
    'pdf.min.mjs' = @(
        "https://unpkg.com/pdfjs-dist@$Version/legacy/build/pdf.min.mjs",
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@$Version/legacy/build/pdf.min.mjs",
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/$Version/pdf.min.mjs"
    )
    'pdf.worker.min.mjs' = @(
        "https://unpkg.com/pdfjs-dist@$Version/legacy/build/pdf.worker.min.mjs",
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@$Version/legacy/build/pdf.worker.min.mjs",
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/$Version/pdf.worker.min.mjs"
    )
}

$done = $true

if (Get-FromNpm) {
    foreach ($name in $files) {
        if (-not (Test-PdfjsFile (Join-Path $dest $name) $name)) { $done = $false }
    }
} else {
    foreach ($name in $files) {
        $fromCdn = Get-FromUrls -Name $name -Urls $cdnUrls[$name]
        if (-not $fromCdn -or -not (Test-PdfjsFile (Join-Path $dest $name) $name)) { $done = $false }
    }
}

Write-Host ""
if ($done) {
    Write-Host "✅ pdf.js 就绪。下一步：" -ForegroundColor Green
    Write-Host "   1) .\tools\sync-today-to-server.ps1      # 两个文件已在同步清单里，普通同步即可"
    Write-Host "   2) 后台编辑器里选中带 PDF 附件的文章 → 侧栏「PDF 封面」→ 从 PDF 生成封面"
} else {
    Write-Host "❌ 取件失败。可手工处理：" -ForegroundColor Red
    Write-Host "   到 https://www.npmjs.com/package/pdfjs-dist 下载对应版本 tarball，解压后把"
    Write-Host "   package/legacy/build/pdf.min.mjs 与 pdf.worker.min.mjs 复制到："
    Write-Host "   $dest"
    exit 1
}
