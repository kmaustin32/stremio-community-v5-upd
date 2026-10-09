#include "playback_defaults.h"
#include "display_mode.h"

bool ApplyVideoStartDefaults(mpv_handle* player)
{
    if (!player) return false;
    const bool volume = mpv_set_property_string(player, "volume", "100") >= 0;
    const bool fit = ApplyDisplayMode(player, DisplayMode::Fit);
    return volume && fit;
}
