#pragma once
#include <mpv/client.h>
bool ApplyVideoStartDefaults(mpv_handle* player);
bool ApplyMaximumVolume(mpv_handle* player, double maximum);
bool ApplyPlayerVolume(mpv_handle* player, double volume);
double MaximumPlayerVolume();
