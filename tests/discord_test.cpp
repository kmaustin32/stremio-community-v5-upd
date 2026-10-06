#include <discord_rpc.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <stdexcept>

// Internal serializer from the pinned SDK; test the actual static library.
size_t JsonWriteRichPresenceObj(char*, size_t, int, int, const DiscordRichPresence*);

int main()
{
    try {
        DiscordRichPresence presence{};
        presence.type = DISCORD_ACTIVITY_TYPE_WATCHING;
        presence.details = "Example movie";
        presence.button1Label = "More Details";
        presence.button1Url = "https://example.com/details";
        presence.button2Label = "Watch on Stremio";
        presence.button2Url = "https://example.com/watch";
        char buffer[4096];
        const auto size = JsonWriteRichPresenceObj(buffer, sizeof(buffer), 1, 1, &presence);
        const auto activity = nlohmann::json::parse(buffer, buffer + size)["args"]["activity"];
        if (activity["type"] != 3 || activity["details"] != "Example movie" ||
            activity["buttons"].size() != 2 ||
            activity["buttons"][0]["label"] != "More Details" ||
            activity["buttons"][1]["url"] != "https://example.com/watch")
            throw std::runtime_error("Existing Discord watching status and buttons must be preserved");
        std::cout << "Discord watching status and button serialization passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
