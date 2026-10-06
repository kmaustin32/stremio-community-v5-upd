#include "display_mode.h"
#include <utility>

static DisplayMode currentMode = DisplayMode::Fit;
DisplayMode CurrentDisplayMode() { return currentMode; }

const char* DisplayModeName(DisplayMode mode)
{
    switch (mode) {
    case DisplayMode::Crop: return "crop";
    case DisplayMode::Stretch: return "stretch";
    default: return "fit";
    }
}

bool ApplyDisplayMode(mpv_handle* player, DisplayMode mode)
{
    if (!player) return false;
    if (mode != DisplayMode::Fit && mode != DisplayMode::Crop && mode != DisplayMode::Stretch)
        return false;
    // Normalize display geometry without changing shaders, subtitles or ambient borders.
    const std::pair<const char*, const char*> properties[] = {
        {"keepaspect", mode == DisplayMode::Stretch ? "no" : "yes"},
        {"panscan", mode == DisplayMode::Crop ? "1" : "0"},
        {"video-unscaled", "no"}, {"video-zoom", "0"},
        {"video-pan-x", "0"}, {"video-pan-y", "0"},
        {"video-scale-x", "1"}, {"video-scale-y", "1"}
    };
    for (const auto& [name, value] : properties) {
        if (mpv_set_property_string(player, name, value) < 0) return false;
    }
    currentMode = mode;
    return true;
}

bool CycleDisplayMode(mpv_handle* player)
{
    const auto next = currentMode == DisplayMode::Fit ? DisplayMode::Crop :
                      currentMode == DisplayMode::Crop ? DisplayMode::Stretch : DisplayMode::Fit;
    if (!ApplyDisplayMode(player, next)) return false;
    const char* label = next == DisplayMode::Crop ? "Display: Crop" :
                        next == DisplayMode::Stretch ? "Display: Stretch" : "Display: Fit";
    const char* command[] = {"show-text", label, nullptr};
    mpv_command_async(player, 0, command);
    return true;
}
