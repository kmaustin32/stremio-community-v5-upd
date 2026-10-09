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
        const std::string episodes =
            "Z=s.useMemo(function(){return function(e){var f=b.settings.hideSpoilers&&D&&l&&!d;"
            "return s.createElement(N,{className:A(p.thumbnail,E({},p.blurred,f)),src:primary,alt:\" \",renderFallback:function(){return s.createElement(N,{className:p.thumbnail,src:alternate,alt:\" \",renderFallback:icon})}})}},[]),ee=s.useMemo(function(){return function(){return null}},[]);"
            "s.createElement(N,{className:A(p[\"poster-image\"],E({},p.blurred,f)),src:next.thumbnail,alt:\" \",fallbackSrc:poster,renderFallback:function(){return s.createElement(N,{className:p[\"poster-image\"],src:alternate,alt:\" \",renderFallback:icon})}});";
        const std::string url = "https://stremio.zarg.me/6f6b0558dbb064bca18a8dcc22cb1f3f4c455b22/scripts/main.js";
        require(IsCommunityPlayerScript(url), "Accept community bootstrap");
        require(IsCommunityPlayerScript(url + "?__WB_REVISION__=abcd"), "Accept service-worker revision query");
        require(!IsCommunityPlayerScript("https://evil.example/" + url), "Reject external URLs");
        require(!IsCommunityPlayerScript(url + "/other.js"), "Reject non-bootstrap paths");
        require(!IsCommunityPlayerScript("https://stremio.zarg.me/../scripts/main.js"), "Reject unversioned paths");
        std::string script = "pt=l.useCallback(function(){te.nextVideo=Ot.current,Lt.current||(re(),null!==te.nextVideo?Qt():window.history.back())},[te.nextVideo,Qt]);"
            "l.useEffect(function(){Te.bingeWatching&&null!==te.nextVideo&&!ut.current&&(null!==Oe.state.time&&null!==Oe.state.duration&&Oe.state.time<Oe.state.duration&&Oe.state.duration-Oe.state.time<=Te.nextVideoNotificationDuration?it():ot())},[te.nextVideo,Oe.state.time,Oe.state.duration]);"
            "bt=l.useCallback(function(e){Oe.setProp(\"volume\",Math.min(e,Number(le.maxVolume)))},[]);"
            "localStorage.setItem(\"localProfile\",JSON.stringify(i));"
            "l.useLayoutEffect(function(){return function(){window.removeEventListener(\"wheel\",onWheel)}},[Oe.state.volume]);" + episodes;
        std::string error;
        require(PatchPlayerAutoplay(script, error), "Patch known end callback");
        require(script.find("re(),Te.bingeWatching&&null!==te.nextVideo?Qt():window.history.back()") != std::string::npos,
            "Keep completion and back navigation, gate autoplay");
        require(script.find("[te.nextVideo,Qt,Te.bingeWatching]") != std::string::npos,
            "Refresh callback when setting changes");
        require(script.find(":ot()},[te.nextVideo,Oe.state.time,Oe.state.duration,Te.bingeWatching,Te.nextVideoNotificationDuration]") != std::string::npos,
            "Close popup when autoplay is disabled, dismissed, or settings change");
        require(script.find("Number(le.maxVolume)))},[le.maxVolume])") != std::string::npos,
            "Refresh volume callback with live maximum");
        require(script.find("detail:Number(i.maxVolume)") != std::string::npos,
            "Send native limit updates from StorageProvider");
        require(script.find("[Oe.state.volume,bt]") != std::string::npos, "Refresh keyboard and wheel volume handlers");
        require(script.find("className:A(p.thumbnail,E({},p.blurred,f)),src:alternate") != std::string::npos,
            "Alternate episode thumbnails keep conditional blur");
        require(script.find("className:A(p[\"poster-image\"],E({},p.blurred,f)),src:alternate") != std::string::npos,
            "Next episode alternate thumbnails keep conditional blur");
        require(script.find("b.settings.hideSpoilers&&Number.isFinite(D)&&Number.isFinite(l)&&!d") != std::string::npos,
            "Special episodes with zero season or episode numbers are also protected");
        require(script.find("}},[b.settings.hideSpoilers,D]),ee=") != std::string::npos,
            "Changing setting or season refreshes the episode label");
        const auto patched = script;
        require(PatchPlayerAutoplay(script, error) && script == patched, "Patch is idempotent");
        std::string unknown = "new unknown upstream implementation";
        require(!PatchPlayerAutoplay(unknown, error) && unknown == "new unknown upstream implementation", "Unknown shape stays intact");
        std::string partial = "pt=l.useCallback(function(){te.nextVideo=Ot.current,Lt.current||(re(),null!==te.nextVideo?Qt():window.history.back())},[te.nextVideo,Qt]);"
            "l.useEffect(function(){Te.bingeWatching&&null!==te.nextVideo&&!ut.current&&(time?it():ot())},[te.nextVideo]);";
        const auto unchanged = partial;
        require(!PatchPlayerAutoplay(partial, error) && partial == unchanged,
            "Missing volume shape leaves the whole bundle intact");
        std::string missingFallback = episodes.substr(0, episodes.find("s.createElement(N,{className:A(p[\"poster-image\"]"));
        const auto before = missingFallback;
        require(!PatchEpisodeSpoilerBlur(missingFallback, error) && missingFallback == before,
            "Unknown image shapes leave all episode code intact");
        std::cout << "PASS: scoped autoplay guard preserves completion and upstream code\n";
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
