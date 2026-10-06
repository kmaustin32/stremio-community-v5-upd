#include "mpv/display_mode.h"

extern "C" __declspec(dllexport) int TestApplyDisplayMode(mpv_handle* player, int mode)
{
    return ApplyDisplayMode(player, static_cast<DisplayMode>(mode)) ? 1 : 0;
}

