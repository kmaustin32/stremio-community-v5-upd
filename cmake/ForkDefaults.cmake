# Keep fork-specific build policy separate from upstream's dependency layout.
set(STREMIO_UPDATE_URL "" CACHE STRING "Signed update endpoint; empty disables automatic updates")
set(STREMIO_MPV_DIR "" CACHE PATH "Prepared libmpv SDK (headers, mpv.lib, libmpv-2.dll)")
