# mpv ambient blur fork

This fork bundles mpv **0.41.0-1101-g5d85ba5fb**, libplacebo **7.374.0** and
FFmpeg **N-127213-g2da55bf59** from zhongfly's 2026-10-05 build. The standard
x86_64 build works without the newer CPU requirements of x86_64-v3.
The required Vulkan loader **1.4.363.0** is bundled beside mpv, including for
D3D11 playback. Use Windows 10/11 x64.

## Install and use

Download `Stremio-5.0.22-mpv.4-x64.exe` from this fork's release. The installer
installs WebView2 when needed. The `.zip` is portable but requires the system
WebView2 runtime. Extract the ZIP into its own directory and run `stremio.exe`.
Use the installer whose filename contains `mpv.4`; **BUILD-ONLY** downloads are
archived build dependencies. The original upstream installer is one such dependency
and installs the original green-icon application, not this fork.

Toggle **Ambient Border Blur** from the Stremio tray menu, or press **Ctrl+B**
in the player. The preference survives restart. The menu checkmark reflects
mpv's current state, including settings supplied by mpv.conf.

Edit `portable_config/mpv.conf` beside the application:

```ini
vo=gpu-next
border-background=blur
background-blur-radius=25
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

New installations enable blur with radius 25, use `ewa_lanczos` scaling, and
force white subtitles. Existing saved blur preferences continue to take priority.
The bundled `input.conf` provides Ctrl+1 through Ctrl+6 for Anime4K modes,
Ctrl+7 for FSR, Ctrl+8 to clear shaders, F1 for audio normalization, and F2
to cycle subtitle overrides. It also includes k/left-click for pause, j/l
for ten-second seeks, and [/] for speed changes of 0.25. The default shader
chain remains commented out, so shaders activate only when selected.

## Fit, Crop, and Stretch

The player toolbar includes a display button that cycles **Fit → Crop → Stretch**,
using the official Stremio scaling icons and matching the other controls.
**Ctrl+Shift+F** performs the same cycle and updates the button and tray state.
Fit preserves the complete picture and its proportions. Crop fills the player
while keeping proportions, cutting off the edges as needed. Stretch fills the
player by changing the picture's proportions. New videos reset to Fit; changing
window size or entering fullscreen keeps the mode for the current video.
The control preserves ambient blur, shaders, and subtitle styling. The tray's
**Display** item provides the same cycle if the web toolbar is unavailable.
Crop fills the player with the encoded frame; it does not detect black bars
encoded inside the video.

Every new video starts at **100% volume** (or a lower selected maximum), including when upgrading with an
older saved InitialVolume value. Adjustments apply to the current video;
the next video resets to 100%. Muting remains independent. The volume slider
keeps its configured maximum, with the range above 100% shaded orange to red.
Changing **Maximum Volume** updates both the slider and mpv's amplification
limit immediately, including values above the original 130% cap. Lowering the
maximum clamps any currently boosted volume. Keyboard and wheel controls follow
the same setting, and changing videos keeps the maximum while resetting volume.

The top player navbar includes a **Picture-in-Picture** toggle beside fullscreen,
matching Loukious's icon and placement. It uses the community shell's existing
borderless, always-on-top mode, synchronized with the tray toggle. Exiting restores
the previous always-on-top preference. Fullscreen and picture-in-picture are
mutually exclusive. Long settings labels wrap, with more room before the options
column and stacked controls in narrow windows.

Turning off **Auto play next episode** now also disables advancement when the
video ends and cancels an open next-episode countdown. Manual Next still works, and completion/watch-progress handling
remains intact. A scoped compatibility patch applies this setting check to the
hosted community player's end handler and refreshes it when the setting changes.
The original community UI and its other features remain hosted upstream. The
patch validates autoplay, live maximum-volume storage, and keyboard handler shapes; unknown upstream changes are left untouched
and logged. CI tests the live upstream bundle before publishing, so source
updates that change this integration require review.
On the first launch of a changed compatibility patch, the app refreshes the
web player's CacheStorage before loading the UI. A patch fingerprint records
the migration; later launches reuse the refreshed cache. Local settings,
cookies, login storage and player configuration are preserved.

The native app, splash, installer/uninstaller, web UI branding, return button,
and default Discord logo use **#7272c2**. The original logo silhouettes, white
play symbols, transparency and wordmark lettering are retained. Movie artwork,
add-on logos and unrelated interface icons retain their own colors. Web branding
and the display button are embedded in the executable and work with the existing
hosted community UI without replacing that upstream project.

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

Resolve any conflicts while retaining `src/mpv/ambient.*`, `src/mpv/display_mode.*`,
`src/webview/fork-player.js`, `cmake/ForkWebAssets.h.in`, the branded assets and
resource mappings, `src/mpv/playback_defaults.*`, `src/webview/player_bundle_patch.*`,
`src/webview/player_resources.*`, the integration calls, `cmake/ForkDefaults.cmake`, and the fork's workflow. Run the release
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
original project's tested streaming runtime is retained. A guarded build patch
updates the server's removed `-vsync` and legacy `-async` flags to `-fps_mode:v` and
the `aresample` filter. If a future server update changes that code, the build
stops for review rather than silently applying an incompatible patch.

For a local build, use an x64 Visual Studio Developer PowerShell with CMake,
Ninja, 7-Zip, Python, Node, vcpkg, and NSIS available. Run `build/prepare-fork.ps1`,
configure with `-DSTREMIO_MPV_DIR=<repo>/.build-cache/libmpv` and a vcpkg
toolchain, then build. Run CTest, `node --test tests/shortcut.test.js`, and
`python tests/mpv_smoke.py --dll .build-cache/libmpv/libmpv-2.dll --output .build-cache/render-test`.

Tests cover native mpv.conf parsing, live toggling, persisted state, restart,
unrelated configuration preservation, keyboard handling, and actual embedded
gpu-next rendering with blur on/off using D3D11's software renderer. Tests also
verify FFmpeg encoding, FFprobe metadata and streaming server startup. A release
tag matching `v*-mpv.*` publishes only after all build and test steps succeed.
Check hardware playback, HDR and streaming on the target machine as well.

Display tests also check native geometry changes, Fit/Crop/Stretch rendering at
two embedded host sizes, blur preservation, and the button in Edge. Browser tests
check acknowledgment, keyboard use, hiding with the toolbar, narrow-screen layout,
upstream toolbar recreation, new-video reset, and branding scope. The current UI
uses named CSS-module selectors; future toolbar changes may need a small adjustment
to the isolated script. The tray control continues to work independently.

The original app's Discord watching status and buttons are preserved through
a small SDK extension, tested against the actual compiled serializer.

The mpv publisher retains only 30 days of build archives. The release includes
the original checksum-verified dependency archives. The build script falls
back to those mirrors, keeping this commit buildable after upstream cleanup.
