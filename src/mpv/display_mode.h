#pragma once
#include <mpv/client.h>

enum class DisplayMode { Fit, Crop, Stretch };
DisplayMode CurrentDisplayMode();
const char* DisplayModeName(DisplayMode mode);
bool ApplyDisplayMode(mpv_handle* player, DisplayMode mode);
bool CycleDisplayMode(mpv_handle* player);
