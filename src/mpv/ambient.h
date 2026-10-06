#pragma once

#include <string>
#include <mpv/client.h>

// -1 follows mpv.conf; 0/1 are an explicit, persistent user preference.
int ReadBorderBlurPreference(const std::wstring& iniPath);
bool IsBorderBlurEnabled(mpv_handle* player);
bool ApplyBorderBlurPreference(mpv_handle* player, int preference);
bool ToggleBorderBlur(mpv_handle* player, const std::wstring& iniPath);
