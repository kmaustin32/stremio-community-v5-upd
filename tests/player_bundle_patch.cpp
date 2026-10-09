#include "../src/webview/player_bundle_patch.h"
#include <fstream>
#include <iostream>
#include <iterator>

int main(int count, char** args)
{
    if (count != 3) return 2;
    std::ifstream input(args[1], std::ios::binary);
    if (!input) return 2;
    std::string script(std::istreambuf_iterator<char>(input), {}), error;
    if (!PatchPlayerAutoplay(script, error)) { std::cerr << error << '\n'; return 1; }
    std::ofstream output(args[2], std::ios::binary);
    output << script;
    return output ? 0 : 2;
}
