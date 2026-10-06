# mpv ambient blur fork

This fork bundles mpv **0.41.0-1101-g5d85ba5fb**, libplacebo **7.374.0** and
FFmpeg **N-127213-g2da55bf59** from zhongfly's 2026-10-05 build. The standard
x86_64 build works without the newer CPU requirements of x86_64-v3.

## Install and use

Download `Stremio-5.0.22-mpv.1-x64.exe` from this fork's release. The installer
installs WebView2 when needed. The `.zip` is portable but requires the system
WebView2 runtime. Extract the ZIP into its own directory and run `stremio.exe`.

Toggle **Ambient Border Blur** from the Stremio tray menu, or press **Ctrl+B**
in the player. The preference survives restart. The menu checkmark reflects
mpv's current state, including settings supplied by mpv.conf.

Edit `portable_config/mpv.conf` beside the application:

```ini
vo=gpu-next
border-background=blur
background-blur-radius=16
```

The mpv option names are `border-background` and `background-blur-radius`;
`border-blur` and `border-radius` are not valid mpv options. These settings
fill letterbox/pillarbox space with a blurred copy of the video. Black bars
encoded inside the video itself are part of the picture and are unaffected.
The radius controls blur strength, rather than rounded window corners.

In `portable_config/stremio-settings.ini`, `[MPV] BorderBlurEnabled=-1`
follows mpv.conf. `0` overrides it with solid borders and `1` enables blur.
The toggle writes only this preference and preserves the configured radius.
Set it back to `-1` to resume following mpv.conf. Enabling blur selects gpu-next.

## Keep upstream updates and fork changes

The original repository remains the upstream source. Fork features and build
policy live in separate files where practical. Merge upstream history into
the fork branch; Git preserves both sides and reports overlapping edits as
conflicts for review. Never replace the fork branch with upstream via a hard
reset, force push, or GitHub's discard-changes synchronization option.

```powershell
git remote add upstream https://github.com/Zaarrg/stremio-community-v5.git
git fetch upstream
git switch codex/mpv-ambient-blur
git merge upstream/webview-windows
```

Resolve any conflicts while retaining `src/mpv/ambient.*`, the integration
calls, `cmake/ForkDefaults.cmake`, and the fork's workflow. Run the release
checks before publishing. Source updates cannot be guaranteed conflict-free.

Automatic application updates are disabled by default because the original
project's signed installers would replace this fork. Update using this fork's
releases until it has its own signing key and signed feed. A trusted signed
feed can be provided through `STREMIO_UPDATE_URL` at build time or the existing
`--autoupdater-endpoint` argument; signatures are still verified.

## Build and verify

GitHub Actions compiles x64 with MSVC and static vcpkg dependencies pinned in
`vcpkg.json` and `build/dependencies.lock.json`. It generates the MSVC import
library from the matching DLL and uses matching headers. FFmpeg and libplacebo
are updated with mpv. The FFmpeg/FFprobe tools use BtbN's dated 2026-10-05
build, N-127203-ga35c879992, with both utilities updated together. The
original project's tested streaming runtime and server are retained.

For a local build, use an x64 Visual Studio Developer PowerShell with CMake,
Ninja, 7-Zip, Python, Node, vcpkg, and NSIS available. Run `build/prepare-fork.ps1`,
configure with `-DSTREMIO_MPV_DIR=<repo>/.build-cache/libmpv` and a vcpkg
toolchain, then build. Run CTest, `node --test tests/shortcut.test.js`, and
`python tests/mpv_smoke.py --dll .build-cache/libmpv/libmpv-2.dll --output .build-cache/render-test`.

Tests cover native mpv.conf parsing, live toggling, persisted state, restart,
unrelated configuration preservation, keyboard handling, and actual embedded
gpu-next rendering with blur on/off using D3D11's software renderer. A release
tag matching `v*-mpv.*` publishes only after all build and test steps succeed.
Check hardware playback, HDR and streaming on the target machine as well.

The mpv publisher retains only 30 days of build archives. The release includes
the original checksum-verified dependency archives and the build script falls
back to those mirrors, keeping this commit buildable after upstream cleanup.
