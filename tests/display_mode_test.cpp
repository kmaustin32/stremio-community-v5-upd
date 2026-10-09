#include "mpv/display_mode.h"
#include "mpv/playback_defaults.h"
#include <iostream>
#include <stdexcept>
#include <string>

static void require(bool condition, const char* message)
{
    if (!condition) throw std::runtime_error(message);
}

static std::string property(mpv_handle* player, const char* name)
{
    char* text = mpv_get_property_string(player, name);
    std::string value = text ? text : "";
    mpv_free(text);
    return value;
}

int main()
{
    mpv_handle* player = mpv_create();
    try {
        require(player != nullptr, "Create player");
        mpv_set_option_string(player, "config", "no");
        mpv_set_option_string(player, "load-scripts", "no");
        mpv_set_option_string(player, "vo", "null");
        mpv_set_option_string(player, "border-background", "blur");
        mpv_set_option_string(player, "background-blur-radius", "25");
        mpv_set_option_string(player, "sub-ass-override", "force");
        require(mpv_initialize(player) >= 0, "Initialize player");
        mpv_set_property_string(player, "volume", "33");
        require(ApplyVideoStartDefaults(player), "Start video with Fit and full normal volume");
        require(property(player, "volume") == "100.000000", "Previous volume does not carry over");
        mpv_set_property_string(player, "volume", "115");
        require(CycleDisplayMode(player) && CurrentDisplayMode() == DisplayMode::Crop, "Fit to crop");
        require(property(player, "volume") == "115.000000", "Mode cycle preserves the current volume");
        require(property(player, "panscan") == "1.000000", "Crop fills window");
        require(property(player, "keepaspect") == "yes", "Crop keeps proportions");
        require(CycleDisplayMode(player) && CurrentDisplayMode() == DisplayMode::Stretch, "Crop to stretch");
        require(property(player, "keepaspect") == "no", "Stretch permits distortion");
        mpv_set_property_string(player, "video-zoom", "2");
        require(CycleDisplayMode(player) && CurrentDisplayMode() == DisplayMode::Fit, "Stretch to fit");
        require(property(player, "keepaspect") == "yes" && property(player, "panscan") == "0.000000", "Fit keeps whole frame");
        require(property(player, "video-zoom") == "0.000000", "Reset leftover zoom");
        require(property(player, "border-background") == "blur", "Keep blur enabled");
        require(property(player, "background-blur-radius") == "25.000000", "Keep blur radius");
        require(property(player, "sub-ass-override") == "force", "Keep subtitle styling");
        require(ApplyDisplayMode(player, DisplayMode::Stretch), "Change before next video");
        require(ApplyVideoStartDefaults(player) && CurrentDisplayMode() == DisplayMode::Fit, "Reset for next video");
        require(property(player, "volume") == "100.000000", "Next video resets boosted volume");
        require(!CycleDisplayMode(nullptr), "Missing player cannot cycle");
        require(!ApplyDisplayMode(player, static_cast<DisplayMode>(99)), "Invalid mode cannot change settings");
        mpv_terminate_destroy(player);
        std::cout << "PASS: mode cycling, geometry, reset, blur and subtitle preservation\n";
        return 0;
    } catch (const std::exception& error) {
        if (player) mpv_terminate_destroy(player);
        std::cerr << error.what() << '\n';
        return 1;
    }
}
