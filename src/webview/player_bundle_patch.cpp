#include "player_bundle_patch.h"
#include <algorithm>
#include <cctype>
#include <regex>

bool IsCommunityPlayerScript(const std::string& url)
{
    for (const char* prefix : {"https://stremio.zarg.me/",
            "https://zaarrg.github.io/stremio-web-shell-fixes/"}) {
        if (!url.starts_with(prefix)) continue;
        const auto path = url.substr(std::char_traits<char>::length(prefix));
        return path.size() == 56 && path.substr(40) == "/scripts/main.js" &&
            std::all_of(path.begin(), path.begin() + 40,
                [](unsigned char c) { return std::isxdigit(c) != 0; });
    }
    return false;
}

bool PatchPlayerAutoplay(std::string& script, std::string& error)
{
    constexpr const char* marker = "/* StremioForkAutoplayGuard */";
    if (script.ends_with(marker)) return true;
    // Limit regex matching to the callback: std::regex on a whole webpack bundle
    // can overflow its stack. Identifier captures support upstream minifier changes.
    const std::regex callback(R"(\.useCallback\(function\(\)\{([\w$]+)\.nextVideo=([\w$]+)\.current,([\w$]+)\.current\|\|\(([\w$]+)\(\),null!==\1\.nextVideo\?([\w$]+)\(\):window\.history\.back\(\)\)\},\[\1\.nextVideo,\5\]\))");
    std::string replacement;
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
    // Preserve ended() and history.back(), and leave manual Next unchanged.
    script.replace(position, length, replacement);
    script += marker;
    return true;
}
