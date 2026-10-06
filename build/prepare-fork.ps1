param([switch]$SkipImportLibrary)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cache = Join-Path $root '.build-cache'
$lock = Get-Content (Join-Path $PSScriptRoot 'dependencies.lock.json') -Raw | ConvertFrom-Json
$sevenZip = (Get-Command 7z.exe -ErrorAction SilentlyContinue).Source
if (!$sevenZip) { $sevenZip = 'C:\Program Files\7-Zip\7z.exe' }
New-Item -ItemType Directory -Force $cache | Out-Null

function Invoke-Checked($program, [string[]]$arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { throw "$program failed with exit code $LASTEXITCODE" }
}

foreach ($entry in $lock.assets.PSObject.Properties) {
    $asset = $entry.Value
    $archive = Join-Path $cache $asset.name
    if (!(Test-Path $archive)) {
        try { Invoke-WebRequest $asset.url -OutFile $archive }
        catch {
            # mpv-winbuild only keeps 30 days of builds. Releases mirror these
            # exact archives so old commits remain reproducible.
            $mirror = "https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/$($lock.mirrorRelease)/$($asset.name)"
            Invoke-WebRequest $mirror -OutFile $archive
        }
    }
    if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256) {
        throw "Checksum mismatch for $($asset.name)"
    }
    Invoke-Checked $sevenZip @('x', $archive, "-o$(Join-Path $cache $entry.Name)", '-y')
}

$sdk = Join-Path $cache 'libmpv'
if (!$SkipImportLibrary) {
    $exports = & dumpbin.exe /nologo /exports (Join-Path $sdk 'libmpv-2.dll')
    if ($LASTEXITCODE -ne 0) { throw 'dumpbin failed' }
    $symbols = @($exports | ForEach-Object {
        if ($_ -match '^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(mpv_\w+)\s*$') { $Matches[1] }
    })
    if ($symbols -notcontains 'mpv_initialize') { throw 'Missing libmpv exports' }
    @('LIBRARY libmpv-2.dll', 'EXPORTS') + $symbols | Set-Content (Join-Path $sdk 'mpv.def') -Encoding ascii
    Invoke-Checked 'lib.exe' @('/nologo', '/machine:x64', "/def:$(Join-Path $sdk 'mpv.def')", "/out:$(Join-Path $sdk 'mpv.lib')")
}

# Reuse the original project's tested streaming runtime, not an incompatible
# replacement Node build. Media libraries come from the new matched FFmpeg SDK.
$windows = Join-Path $root 'utils/windows'
foreach ($name in @('stremio-runtime.exe', 'server.js')) {
    Copy-Item (Join-Path $cache "upstream/$name") $windows -Force
}
Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'patch-server.js'), (Join-Path $windows 'server.js'))
foreach ($name in @('StremioServiceSetup.exe', 'MicrosoftEdgeWebview2Setup.exe')) {
    Copy-Item (Join-Path $cache "upstream/`$PLUGINSDIR/$name") $windows -Force
}
$mediaTools = Join-Path $cache 'media-tools'
New-Item -ItemType Directory -Force $mediaTools | Out-Null
Get-ChildItem (Join-Path $cache 'ffmpeg') -Recurse -File |
    Where-Object { $_.Name -in @('ffmpeg.exe', 'ffprobe.exe') } |
    Copy-Item -Destination $mediaTools -Force
foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
    if (!(Test-Path (Join-Path $mediaTools $name))) { throw "Missing updated media tool: $name" }
}
Get-ChildItem (Join-Path $cache 'ffmpeg') -Recurse -Filter 'LICENSE*' -File |
    Select-Object -First 1 | Copy-Item -Destination (Join-Path $mediaTools 'LICENSE-ffmpeg.txt') -Force
Invoke-Checked $sevenZip @('x', (Join-Path $root 'utils/mpv/anime4k/anime4k-High-end.zip'),
    "-o$(Join-Path $root 'utils/mpv/anime4k/portable_config')", 'shaders/*', '-y')

if (!$SkipImportLibrary) {
    $discordArchive = Join-Path $cache 'discord.zip'
    if (!(Test-Path $discordArchive)) {
        Invoke-WebRequest "https://github.com/discord/discord-rpc/archive/$($lock.discordCommit).zip" -OutFile $discordArchive
    }
    Expand-Archive $discordArchive -DestinationPath $cache -Force
    $discordSource = Join-Path $cache "discord-rpc-$($lock.discordCommit)"
    Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'patch-discord.js'), $discordSource)
    Invoke-Checked 'cmake' @('-S', $discordSource, '-B', (Join-Path $cache 'discord-build'), '-G', 'Ninja',
        '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_EXAMPLES=OFF', '-DBUILD_SHARED_LIBS=OFF',
        '-DCMAKE_POLICY_VERSION_MINIMUM=3.5', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded',
        '-DUSE_STATIC_CRT=ON', '-DCLANG_FORMAT_CMD:FILEPATH=OFF')
    Invoke-Checked 'cmake' @('--build', (Join-Path $cache 'discord-build'))
    $discordDest = Join-Path $root 'deps/discord-rpc/win64-static'
    New-Item -ItemType Directory -Force "$discordDest/lib", "$discordDest/include" | Out-Null
    Copy-Item (Join-Path $cache 'discord-build/src/discord-rpc.lib') "$discordDest/lib/discord-rpc.lib" -Force
    Copy-Item "$discordSource/include/*" "$discordDest/include" -Force
}
