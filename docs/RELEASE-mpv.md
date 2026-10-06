Updated the embedded player to mpv 0.41.0-1101-g5d85ba5fb (zhongfly, 2026-10-05),
with matching libplacebo 7.374.0, FFmpeg N-127213-g2da55bf59, headers and import library.
The FFmpeg/FFprobe command-line tools use BtbN's 2026-10-05 build, N-127203-ga35c879992.
The streaming server's sync options are adapted for the new FFmpeg version.

- Toggle Ambient Border Blur in the tray menu or with Ctrl+B in the player.
- The preference survives restart; `BorderBlurEnabled=-1` follows mpv.conf.
- Use `vo=gpu-next`, `border-background=blur`, and `background-blur-radius=16` in mpv.conf.
- Automatic upstream binary updates are disabled to preserve fork features.
- Upstream source updates can be merged into the fork; see the included README-fork.md.

Download **Stremio-5.0.22-mpv.1-x64.exe** for installation, or the **.zip** for
portable use with an installed WebView2 runtime. SHA256SUMS.txt verifies these
downloads. The remaining archives preserve build dependencies and are not
needed to run the application.

GitHub Actions builds the application and runs configuration, toggle,
persistence, restart, keyboard, streaming, transcoding, and embedded D3D11 rendering tests before publishing.
The build is unsigned. Hardware-specific playback and HDR require testing on
the target machine.
