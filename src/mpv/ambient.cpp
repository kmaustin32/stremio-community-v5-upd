#include "ambient.h"
#include <windows.h>

int ReadBorderBlurPreference(const std::wstring& iniPath)
{
    wchar_t value[16];
    GetPrivateProfileStringW(L"MPV", L"BorderBlurEnabled", L"-1",
                            value, 16, iniPath.c_str());
    if (wcscmp(value, L"0") == 0) return 0;
    if (wcscmp(value, L"1") == 0) return 1;
    return -1;
}

bool IsBorderBlurEnabled(mpv_handle* player)
{
    if (!player) return false;
    char* value = mpv_get_property_string(player, "border-background");
    const bool enabled = value && std::string(value) == "blur";
    mpv_free(value);
    return enabled;
}

bool ApplyBorderBlurPreference(mpv_handle* player, int preference)
{
    if (!player) return false;
    if (preference != 0 && preference != 1) return true;
    // Ambient borders are implemented by gpu-next, including in embedded mode.
    if (preference == 1 && mpv_set_property_string(player, "vo", "gpu-next") < 0)
        return false;
    return mpv_set_property_string(player, "border-background",
                                   preference == 1 ? "blur" : "color") >= 0;
}

bool ToggleBorderBlur(mpv_handle* player, const std::wstring& iniPath)
{
    const bool enabled = !IsBorderBlurEnabled(player);
    if (!ApplyBorderBlurPreference(player, enabled ? 1 : 0)) return false;
    if (!WritePrivateProfileStringW(L"MPV", L"BorderBlurEnabled",
                                    enabled ? L"1" : L"0", iniPath.c_str()))
        return false;
    const char* args[] = {"show-text", enabled ? "Ambient border blur: On" :
                                               "Ambient border blur: Off", nullptr};
    mpv_command_async(player, 0, args);
    return true;
}
