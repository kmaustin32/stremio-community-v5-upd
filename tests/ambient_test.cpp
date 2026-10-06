#include "mpv/ambient.h"
#include <windows.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

static void require(bool condition, const char* message)
{
    if (!condition) throw std::runtime_error(message);
}

int main()
{
    mpv_handle* player = nullptr;
    const auto dir = std::filesystem::temp_directory_path() /
        ("stremio-ambient-test-" + std::to_string(GetCurrentProcessId()));
    try {
        std::filesystem::create_directory(dir);
        const auto ini = (dir / "settings.ini").wstring();
        require(ReadBorderBlurPreference(ini) == -1, "Missing preference must follow mpv.conf");
        WritePrivateProfileStringW(L"MPV", L"BorderBlurEnabled", L"invalid", ini.c_str());
        require(ReadBorderBlurPreference(ini) == -1, "Invalid preference must follow mpv.conf");
        WritePrivateProfileStringW(L"MPV", L"BorderBlurEnabled", L"99", ini.c_str());
        require(ReadBorderBlurPreference(ini) == -1, "Out of range preference must follow mpv.conf");
        WritePrivateProfileStringW(L"MPV", L"InitialVolume", L"73", ini.c_str());
        const auto conf = dir / "mpv.conf";
        std::ofstream(conf) << "vo=null\nborder-background=blur\nbackground-blur-radius=7\n";
        player = mpv_create();
        require(player != nullptr, "mpv_create");
        mpv_set_option_string(player, "config", "no");
        mpv_set_option_string(player, "load-scripts", "no");
        require(mpv_load_config_file(player, conf.string().c_str()) >= 0, "Read native blur configuration");
        require(mpv_initialize(player) >= 0, "Initialize new libmpv");
        require(ApplyBorderBlurPreference(player, -1), "Follow config");
        require(IsBorderBlurEnabled(player), "Following config must preserve blur");
        require(ToggleBorderBlur(player, ini), "Disable blur");
        require(!IsBorderBlurEnabled(player), "Blur disabled immediately");
        require(ReadBorderBlurPreference(ini) == 0, "Disabled state persisted");
        require(ToggleBorderBlur(player, ini), "Enable blur");
        require(IsBorderBlurEnabled(player), "Blur enabled immediately");
        require(ReadBorderBlurPreference(ini) == 1, "Enabled state persisted");
        require(GetPrivateProfileIntW(L"MPV", L"InitialVolume", 0, ini.c_str()) == 73,
                "Toggle must preserve unrelated settings");
        double radius = 0;
        require(mpv_get_property(player, "background-blur-radius", MPV_FORMAT_DOUBLE, &radius) >= 0 && radius == 7,
                "Toggle must preserve mpv.conf radius");
        mpv_terminate_destroy(player);
        player = mpv_create();
        mpv_set_option_string(player, "config", "no");
        mpv_load_config_file(player, conf.string().c_str());
        require(mpv_initialize(player) >= 0, "Restart player");
        require(ApplyBorderBlurPreference(player, ReadBorderBlurPreference(ini)), "Restore persisted preference");
        require(IsBorderBlurEnabled(player), "Enabled state survives restart");
        require(ApplyBorderBlurPreference(player, 0), "Apply disabled preference");
        require(!IsBorderBlurEnabled(player), "Disabled preference overrides config");
        require(!ToggleBorderBlur(nullptr, ini), "Missing player must fail without saving");
        mpv_terminate_destroy(player);
        player = nullptr;
        std::filesystem::remove_all(dir);
        std::cout << "Ambient configuration, toggling, persistence, and restart tests passed\n";
        return 0;
    } catch (const std::exception& error) {
        if (player) mpv_terminate_destroy(player);
        std::cerr << error.what() << '\n';
        std::filesystem::remove_all(dir);
        return 1;
    }
}
