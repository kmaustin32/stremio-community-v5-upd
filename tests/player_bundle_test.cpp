#include "../src/webview/player_bundle_patch.h"
#include <iostream>
#include <stdexcept>

static void require(bool value, const char* message)
{
    if (!value) throw std::runtime_error(message);
}

int main()
{
    try {
        const std::string url = "https://stremio.zarg.me/6f6b0558dbb064bca18a8dcc22cb1f3f4c455b22/scripts/main.js";
        require(IsCommunityPlayerScript(url), "Accept community bootstrap");
        require(!IsCommunityPlayerScript("https://evil.example/" + url), "Reject external URLs");
        require(!IsCommunityPlayerScript(url + "/other.js"), "Reject non-bootstrap paths");
        require(!IsCommunityPlayerScript("https://stremio.zarg.me/../scripts/main.js"), "Reject unversioned paths");
        std::string script = "pt=l.useCallback(function(){te.nextVideo=Ot.current,Lt.current||(re(),null!==te.nextVideo?Qt():window.history.back())},[te.nextVideo,Qt]);"
            "l.useEffect(function(){Te.bingeWatching&&null!==te.nextVideo&&!ut.current},[te.nextVideo]);";
        std::string error;
        require(PatchPlayerAutoplay(script, error), "Patch known end callback");
        require(script.find("re(),Te.bingeWatching&&null!==te.nextVideo?Qt():window.history.back()") != std::string::npos,
            "Keep completion and back navigation, gate autoplay");
        require(script.find("[te.nextVideo,Qt,Te.bingeWatching]") != std::string::npos,
            "Refresh callback when setting changes");
        const auto patched = script;
        require(PatchPlayerAutoplay(script, error) && script == patched, "Patch is idempotent");
        std::string unknown = "new unknown upstream implementation";
        require(!PatchPlayerAutoplay(unknown, error) && unknown == "new unknown upstream implementation", "Unknown shape stays intact");
        std::cout << "PASS: scoped autoplay guard preserves completion and upstream code\n";
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
