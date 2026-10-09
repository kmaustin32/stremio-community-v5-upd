**Install this fork:** [Stremio-5.0.22-mpv.4-x64.exe](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v5.0.22-mpv.4/Stremio-5.0.22-mpv.4-x64.exe),
or use the [portable ZIP](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v5.0.22-mpv.4/Stremio-5.0.22-mpv.4-x64.zip).
Files beginning **BUILD-ONLY** are source build dependencies, not this fork's installer.
Installing the original community dependency gives the original green icon and omits the fork features.

- Auto play next episode now respects its setting when a video ends and cancels open countdowns when disabled; completion and manual Next remain available.
- Each new video starts at 100% volume. The slider shows an orange-to-red boost range above 100%.
- Ctrl+Shift+F cycles Fit, Crop, and Stretch, synchronized with the button and tray menu.
- Display controls use the official Stremio scaling icons, aligned with the other toolbar icons.

The embedded player uses mpv 0.41.0-1101-g5d85ba5fb (zhongfly, 2026-10-05),
with matching libplacebo 7.374.0, FFmpeg N-127213-g2da55bf59, headers and import library.
The FFmpeg/FFprobe command-line tools use BtbN's 2026-10-05 build, N-127203-ga35c879992.
The streaming server's sync options are adapted for the new FFmpeg version.
The required Vulkan loader 1.4.363.0 is bundled, so startup does not depend on
an existing system Vulkan runtime.

- Application branding now uses exact #7272c2 across Windows icons, splash, installer/uninstaller, hosted web UI logos, return button, and default Discord presence. Original shapes, white symbols, lettering and PNG transparency are preserved.
- The player toolbar's new display button cycles Fit → Crop → Stretch. Each new video resets to Fit; resizing keeps the current mode. Ambient blur and shaders are preserved. The tray menu provides the same control.

- Toggle Ambient Border Blur in the tray menu or with Ctrl+B in the player.
- The preference survives restart; `BorderBlurEnabled=-1` follows mpv.conf.
- New defaults enable blur at radius 25, use ewa_lanczos scaling, and force white subtitles.
- Updated input.conf: Ctrl+1–6 Anime4K, Ctrl+7 FSR, Ctrl+8 shader clearing, F1 audio normalization, F2 subtitle overrides, k/left-click pause, j/l seek, and [/] speed adjustment.
- FSR.glsl is now included from the verified original community package.
- Existing saved blur preferences continue to override mpv.conf; set BorderBlurEnabled=-1 to follow the new default.
- Automatic upstream binary updates are disabled to preserve fork features.
- Upstream source updates can be merged into the fork; see the included README-fork.md.

Download **Stremio-5.0.22-mpv.4-x64.exe** for installation, or the **.zip** for
portable use with an installed WebView2 runtime. SHA256SUMS.txt verifies these
downloads. The remaining archives preserve build dependencies and are not
needed to run the application. `stremio-icon.png` is the public Discord branding asset.

GitHub Actions builds the application and runs configuration, toggle,
persistence, restart, keyboard, streaming, transcoding, native display geometry,
embedded D3D11 rendering at two sizes, Edge player controls, live autoplay behavior,
and native WebView2 cached-upgrade and reload tests before publishing.
The build is unsigned. Hardware-specific playback and HDR require testing on
the target machine.
