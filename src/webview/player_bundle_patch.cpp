#include "player_bundle_patch.h"
#include <algorithm>
#include <cctype>
#include <regex>
#include <utility>
#include <vector>

bool IsCommunityPlayerScript(const std::string& url)
{
    for (const char* prefix : {"https://stremio.zarg.me/",
            "https://zaarrg.github.io/stremio-web-shell-fixes/"}) {
        if (!url.starts_with(prefix)) continue;
        const auto path = url.substr(std::char_traits<char>::length(prefix),
            url.find('?') == std::string::npos ? std::string::npos : url.find('?') - std::char_traits<char>::length(prefix));
        return path.size() == 56 && path.substr(40) == "/scripts/main.js" &&
            std::all_of(path.begin(), path.begin() + 40,
                [](unsigned char c) { return std::isxdigit(c) != 0; });
    }
    return false;
}

bool PatchEpisodeSpoilerBlur(std::string& script, std::string& error)
{
    struct Edit { size_t pos, length; std::string text; };
    std::vector<Edit> edits;
    // Copy the primary image's conditional class expression to its alternate.
    // Both episode lists share Video; NextVideoPopup has the same fallback bug.
    const std::regex image(R"(className:(([\w$]+)\(([\w$]+)(\.thumbnail|\["poster-image"\]),([\w$]+)\(\{\},\3\.blurred,([\w$]+)\)\)),src:([^{};]+),renderFallback:function\(\)\{return ([\w$]+)\.createElement\(([\w$]+),\{className:\3\4,)");
    const std::regex condition(R"(([\w$]+)\.settings\.hideSpoilers&&([\w$]+)&&([\w$]+)&&!([\w$]+))");
    const std::regex labelEnd(R"(\}\},\[\]\),[\w$]+=[\w$]+\.useMemo\(function\(\)\{return function\(\)\{)");
    size_t cursor = 0, thumbnails = 0, posters = 0;
    while ((cursor = script.find(".blurred,", cursor)) != std::string::npos) {
        const auto start = script.rfind("className:", cursor);
        if (start != std::string::npos && cursor - start < 256) {
            const auto candidate = script.substr(start, 1024);
            std::smatch match;
            if (std::regex_search(candidate, match, image)) {
                const auto originalClass = "className:" + match[3].str() + match[4].str() + ",";
                const auto classPos = match.str().rfind(originalClass);
                if (classPos == std::string::npos) { error = "Missing alternate image class"; return false; }
                edits.push_back({start + static_cast<size_t>(match.position()) + classPos + 10,
                    static_cast<size_t>(match[3].length() + match[4].length()), match[1].str()});
                if (match[4].str() == ".thumbnail") {
                    ++thumbnails;
                    const auto setting = script.rfind(".settings.hideSpoilers&&", start);
                    if (setting == std::string::npos || start - setting > 1024) {
                        error = "Missing episode spoiler setting"; return false;
                    }
                    auto settingStart = setting;
                    while (settingStart && (std::isalnum(static_cast<unsigned char>(script[settingStart - 1])) ||
                            script[settingStart - 1] == '_' || script[settingStart - 1] == '$')) --settingStart;
                    const auto conditionCandidate = script.substr(settingStart, 256);
                    std::smatch blur;
                    if (!std::regex_search(conditionCandidate, blur, condition) || blur.position() != 0) {
                        error = "Unsupported episode spoiler condition"; return false;
                    }
                    edits.push_back({settingStart, static_cast<size_t>(blur.length()),
                        blur[1].str() + ".settings.hideSpoilers&&Number.isFinite(" + blur[2].str() +
                        ")&&Number.isFinite(" + blur[3].str() + ")&&!" + blur[4].str()});
                    // A frozen renderLabel otherwise keeps an old setting/season.
                    const auto end = script.find("}},[])", start);
                    const auto endCandidate = end == std::string::npos ? std::string{} : script.substr(end, 256);
                    std::smatch label;
                    if (end == std::string::npos || end - start > 8192 || !std::regex_search(endCandidate, label, labelEnd) || label.position() != 0) {
                        error = "Unsupported episode label dependencies"; return false;
                    }
                    edits.push_back({end + 3, 2, "[" + blur[1].str() + ".settings.hideSpoilers," + blur[2].str() + "]"});
                } else ++posters;
            }
        }
        ++cursor;
    }
    if (thumbnails != 1 || posters != 1) {
        error = "Unsupported episode image fallback handlers"; return false;
    }
    std::sort(edits.begin(), edits.end(), [](const Edit& a, const Edit& b) { return a.pos > b.pos; });
    for (const auto& edit : edits) script.replace(edit.pos, edit.length, edit.text);
    return true;
}

bool PatchPlayerAutoplay(std::string& script, std::string& error)
{
    constexpr const char* marker = "/* StremioForkPlayerCompatibilityV2 */";
    if (script.ends_with(marker)) return true;
    // Limit regex matching to the callback: std::regex on a whole webpack bundle
    // can overflow its stack. Identifier captures support upstream minifier changes.
    const std::regex callback(R"(\.useCallback\(function\(\)\{([\w$]+)\.nextVideo=([\w$]+)\.current,([\w$]+)\.current\|\|\(([\w$]+)\(\),null!==\1\.nextVideo\?([\w$]+)\(\):window\.history\.back\(\)\)\},\[\1\.nextVideo,\5\]\))");
    std::string replacement;
    std::string settingsName, coreName;
    size_t position = 0, length = 0, matches = 0, cursor = 0;
    while ((cursor = script.find(".nextVideo=", cursor)) != std::string::npos) {
        const auto start = script.rfind(".useCallback(function(){", cursor);
        if (start != std::string::npos && cursor - start < 256) {
            const auto candidate = script.substr(start, 1024);
            std::smatch match;
            if (std::regex_search(candidate, match, callback)) {
                const std::string core = match[1], next = match[5];
                const auto settingAnchor = ".bingeWatching&&null!==" + core + ".nextVideo";
                const auto settingPos = script.find(settingAnchor);
                if (settingPos == std::string::npos ||
                    script.find(settingAnchor, settingPos + 1) != std::string::npos) {
                    error = "Cannot identify the player's current autoplay setting";
                    return false;
                }
                auto nameStart = settingPos;
                while (nameStart && (std::isalnum(static_cast<unsigned char>(script[nameStart - 1])) ||
                        script[nameStart - 1] == '_' || script[nameStart - 1] == '$')) --nameStart;
                const auto settings = script.substr(nameStart, settingPos - nameStart);
                if (settings.empty()) { error = "Missing autoplay settings reference"; return false; }
                settingsName = settings;
                coreName = core;
                replacement = match.str();
                const auto condition = "null!==" + core + ".nextVideo?";
                replacement.insert(replacement.find(condition), settings + ".bingeWatching&&");
                const auto deps = "[" + core + ".nextVideo," + next + "]";
                replacement.replace(replacement.find(deps), deps.size(),
                    "[" + core + ".nextVideo," + next + "," + settings + ".bingeWatching]");
                position = start + match.position();
                length = match.length();
                ++matches;
            }
        }
        ++cursor;
    }
    if (matches != 1) {
        error = "Unsupported community player end-of-video handler";
        return false;
    }
    // A popup opened earlier must also close immediately when autoplay is disabled.
    const auto settingPos = script.find(".bingeWatching&&null!==" + coreName + ".nextVideo");
    const auto effectStart = script.rfind(".useEffect(function(){", settingPos);
    const std::regex popup(R"(\.useEffect\(function\(\)\{([\w$]+)\.bingeWatching&&null!==([\w$]+)\.nextVideo&&!([\w$]+)\.current&&\(([^{};]+)\?([\w$]+)\(\):([\w$]+)\(\)\)\},\[([^\]]+)\]\))");
    std::smatch effect;
    const auto candidate = effectStart == std::string::npos ? std::string{} : script.substr(effectStart, 2048);
    if (!std::regex_search(candidate, effect, popup) || effect[1].str() != settingsName || effect[2].str() != coreName) {
        error = "Unsupported community player countdown handler";
        return false;
    }
    const auto effectReplacement = ".useEffect(function(){" + settingsName + ".bingeWatching&&null!==" +
        coreName + ".nextVideo&&!" + effect[3].str() + ".current?(" + effect[4].str() + "?" +
        effect[5].str() + "():" + effect[6].str() + "()):" + effect[6].str() + "()},[" +
        effect[7].str() + "," + settingsName + ".bingeWatching," + settingsName + ".nextVideoNotificationDuration])";
    struct Edit { size_t pos, length; std::string text; };
    std::vector<Edit> edits = {{position, length, replacement},
        {effectStart + static_cast<size_t>(effect.position()), static_cast<size_t>(effect.length()), effectReplacement}};
    // The upstream callback captures the first storage object forever. Recreate
    // it when maxVolume changes, so dragging and keyboard volume use the same cap.
    const std::regex volumeCallback(R"(\.useCallback\(function\(([\w$]+)\)\{([\w$]+)\.setProp\("volume",Math\.min\(\1,Number\(([\w$]+)\.maxVolume\)\)\)\},\[\]\))");
    size_t volumeMatches = 0;
    std::string volumeHandler;
    cursor = 0;
    while ((cursor = script.find(".maxVolume", cursor)) != std::string::npos) {
        const auto start = script.rfind(".useCallback(function(", cursor);
        if (start != std::string::npos && cursor - start < 256) {
            const auto candidate = script.substr(start, 512);
            std::smatch match;
            if (std::regex_search(candidate, match, volumeCallback)) {
                auto text = match.str();
                text.replace(text.size() - 3, 2, "[" + match[3].str() + ".maxVolume]");
                edits.push_back({start + static_cast<size_t>(match.position()), static_cast<size_t>(match.length()), text});
                const auto equals = script.rfind('=', start);
                if (equals == std::string::npos || start - equals > 64) {
                    error = "Missing volume callback reference";
                    return false;
                }
                auto nameStart = equals;
                while (nameStart && (std::isalnum(static_cast<unsigned char>(script[nameStart - 1])) ||
                        script[nameStart - 1] == '_' || script[nameStart - 1] == '$')) --nameStart;
                volumeHandler = script.substr(nameStart, equals - nameStart);
                ++volumeMatches;
            }
        }
        ++cursor;
    }
    // Keyboard and wheel listeners also capture the callback. Refresh these
    // while paused, even when no time/volume event would recreate the listeners.
    const auto wheelCleanup = script.find("window.removeEventListener(\"wheel\"");
    const std::regex keyboard(R"(window\.removeEventListener\("wheel",([\w$]+)\)\}\},\[([^\]]+)\]\))");
    std::smatch keyboardMatch;
    const auto keyboardCandidate = wheelCleanup == std::string::npos ? std::string{} : script.substr(wheelCleanup, 2048);
    if (volumeHandler.empty() || !std::regex_search(keyboardCandidate, keyboardMatch, keyboard)) {
        error = "Unsupported community player keyboard volume handler";
        return false;
    }
    auto keyboardReplacement = keyboardMatch.str();
    keyboardReplacement.insert(keyboardReplacement.size() - 2, "," + volumeHandler);
    edits.push_back({wheelCleanup + static_cast<size_t>(keyboardMatch.position()), static_cast<size_t>(keyboardMatch.length()), keyboardReplacement});
    // StorageProvider is the live source of settings, including same-tab changes.
    // Notify the injected controls on every update instead of polling localStorage.
    const std::regex storage(R"(localStorage\.setItem\("localProfile",JSON\.stringify\(([\w$]+)\)\))");
    size_t storageMatches = 0;
    cursor = 0;
    while ((cursor = script.find("localStorage.setItem(\"localProfile\"", cursor)) != std::string::npos) {
        const auto candidate = script.substr(cursor, 256);
        std::smatch match;
        if (std::regex_search(candidate, match, storage)) {
            edits.push_back({cursor + static_cast<size_t>(match.position()), static_cast<size_t>(match.length()),
                match.str() + ",window.dispatchEvent(new CustomEvent(\"stremio-fork-volume-limit\",{detail:Number(" + match[1].str() + ".maxVolume)}))"});
            ++storageMatches;
        }
        ++cursor;
    }
    if (volumeMatches != 1 || storageMatches != 1) {
        error = "Unsupported community player maximum-volume settings";
        return false;
    }
    std::sort(edits.begin(), edits.end(), [](const Edit& a, const Edit& b) { return a.pos > b.pos; });
    // Preserve ended() and history.back(), and leave manual Next unchanged.
    auto result = script;
    for (const auto& edit : edits) result.replace(edit.pos, edit.length, edit.text);
    if (!PatchEpisodeSpoilerBlur(result, error)) return false;
    result += "\n;window.__stremioForkAutoplayPatched=true;window.__stremioForkVolumePatched=true;window.__stremioForkEpisodeBlurPatched=true;";
    result += marker;
    script = std::move(result);
    return true;
}
