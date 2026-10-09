#pragma once
#include <string>

// Only public, versioned community bootstrap scripts are eligible for the patch.
bool IsCommunityPlayerScript(const std::string& url);
bool PatchPlayerAutoplay(std::string& script, std::string& error);
