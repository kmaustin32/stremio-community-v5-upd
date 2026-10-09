#include "playback_defaults.h"
#include "display_mode.h"
#include <algorithm>
#include <cmath>
#include <mutex>

namespace {
std::mutex volumeMutex;
double maximumVolume = 130;
}

double MaximumPlayerVolume()
{
    std::lock_guard lock(volumeMutex);
    return maximumVolume;
}

bool ApplyPlayerVolume(mpv_handle* player, double volume)
{
    if (!player || !std::isfinite(volume)) return false;
    std::lock_guard lock(volumeMutex);
    volume = std::clamp(volume, 0.0, maximumVolume);
    return mpv_set_property(player, "volume", MPV_FORMAT_DOUBLE, &volume) >= 0;
}

bool ApplyMaximumVolume(mpv_handle* player, double maximum)
{
    if (!player || !std::isfinite(maximum) || maximum < 1 || maximum > 1000) return false;
    std::lock_guard lock(volumeMutex);
    // mpv's amplification limit starts at 100; the UI also offers a 75% cap.
    double nativeMaximum = std::max(100.0, maximum);
    if (mpv_set_property(player, "volume-max", MPV_FORMAT_DOUBLE, &nativeMaximum) < 0) return false;
    maximumVolume = maximum;
    double current = 0;
    if (mpv_get_property(player, "volume", MPV_FORMAT_DOUBLE, &current) >= 0 && current > maximum)
        return mpv_set_property(player, "volume", MPV_FORMAT_DOUBLE, &maximum) >= 0;
    return true;
}

bool ApplyVideoStartDefaults(mpv_handle* player)
{
    if (!player) return false;
    const bool volume = ApplyPlayerVolume(player, 100);
    const bool fit = ApplyDisplayMode(player, DisplayMode::Fit);
    return volume && fit;
}
