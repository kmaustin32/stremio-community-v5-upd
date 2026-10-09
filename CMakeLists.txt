cmake_minimum_required(VERSION 3.16)

project(stremio VERSION "5.0.22")

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

option(DEBUG_LOG "Allow debug logs" ON)
include(cmake/ForkDefaults.cmake)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/src/webview/fork-player.js")
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/src/webview/fork-player.js" FORK_PLAYER_SCRIPT)
foreach(mode fit crop stretch)
    set(icon "${CMAKE_CURRENT_SOURCE_DIR}/images/player/video-scale-${mode}.svg")
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${icon}")
    file(READ "${icon}" svg)
    string(STRIP "${svg}" svg)
    string(TOUPPER "${mode}" marker)
    string(REPLACE "__FORK_${marker}_SVG__" "${svg}" FORK_PLAYER_SCRIPT "${FORK_PLAYER_SCRIPT}")
endforeach()
configure_file(cmake/ForkWebAssets.h.in generated/ForkWebAssets.h @ONLY)

# Locate MPV
if(CMAKE_SIZEOF_VOID_P EQUAL 8)
    # 64-bit architecture
    set(MPV_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/deps/libmpv/x86_64/include")
    set(MPV_LIBRARY "${CMAKE_CURRENT_SOURCE_DIR}/deps/libmpv/x86_64/mpv.lib")
    set(MPV_DLL "${CMAKE_CURRENT_SOURCE_DIR}/deps/libmpv/x86_64/libmpv-2.dll")

    set(DISCORD_LIB "${CMAKE_CURRENT_SOURCE_DIR}/deps/discord-rpc/win64-static/lib/discord-rpc.lib")
    set(DISCORD_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/deps/discord-rpc/win64-static/include")
else()
    # 32-bit architecture
    set(MPV_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/deps/libmpv/i686/include")
    set(MPV_LIBRARY "${CMAKE_CURRENT_SOURCE_DIR}/deps/libmpv/i686/mpv.lib")
    set(MPV_DLL "${CMAKE_CURRENT_SOURCE_DIR}/deps/libmpv/i686/libmpv-2.dll")

    set(DISCORD_LIB "${CMAKE_CURRENT_SOURCE_DIR}/deps/discord-rpc/win32-static/lib/discord-rpc.lib")
    set(DISCORD_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/deps/discord-rpc/win32-static/include")
endif()

if(STREMIO_MPV_DIR)
    set(MPV_INCLUDE_DIR "${STREMIO_MPV_DIR}/include")
    set(MPV_LIBRARY "${STREMIO_MPV_DIR}/mpv.lib")
    set(MPV_DLL "${STREMIO_MPV_DIR}/libmpv-2.dll")
endif()

include_directories(${DISCORD_INCLUDE_DIR})
set(MPV_RUNTIME_DLLS "${MPV_DLL}")
if(STREMIO_MPV_DIR)
    file(GLOB MPV_RUNTIME_DLLS "${STREMIO_MPV_DIR}/*.dll")
endif()
include_directories(${MPV_INCLUDE_DIR})

find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(unofficial-webview2 CONFIG REQUIRED)

set(SOURCES
        src/main.cpp
        stremio.rc
        src/core/globals.h
        src/core/globals.cpp
        src/utils/helpers.h
        src/utils/helpers.cpp
        src/utils/config.h
        src/utils/config.cpp
        src/utils/crashlog.h
        src/utils/crashlog.cpp
        src/mpv/player.h
        src/mpv/player.cpp
        src/mpv/ambient.cpp
        src/mpv/display_mode.cpp
        src/mpv/playback_defaults.cpp
        src/node/server.cpp
        src/node/server.h
        src/tray/tray.h
        src/tray/tray.cpp
        src/ui/splash.h
        src/ui/splash.cpp
        src/updater/updater.cpp
        src/updater/updater.h
        src/webview/webview.h
        src/webview/webview.cpp
        src/webview/player_bundle_patch.cpp
        src/webview/player_resources.cpp
        src/ui/mainwindow.h
        src/ui/mainwindow.cpp
        src/resource.h
        src/utils/extensions.cpp
        src/utils/extensions.h
        src/utils/discord.cpp
        src/utils/discord.h
)

add_executable(${PROJECT_NAME} WIN32 ${SOURCES})
target_include_directories(${PROJECT_NAME} PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated")


target_link_libraries(${PROJECT_NAME} PRIVATE
        gdiplus.lib
        dwmapi.lib
        Shcore.lib
        Msimg32.lib
        winhttp.lib
        shlwapi.lib
        nlohmann_json::nlohmann_json
        unofficial::webview2::webview2
        OpenSSL::SSL
        OpenSSL::Crypto
        CURL::libcurl
        ${MPV_LIBRARY}
        ${DISCORD_LIB}
)

target_compile_definitions(${PROJECT_NAME} PRIVATE DEBUG_LOG)
target_compile_definitions(${PROJECT_NAME} PRIVATE STREMIO_DEFAULT_UPDATE_URL="${STREMIO_UPDATE_URL}")

include(CTest)
if(BUILD_TESTING)
    add_executable(player-bundle-tests tests/player_bundle_test.cpp src/webview/player_bundle_patch.cpp)
    add_test(NAME player-autoplay-guard COMMAND player-bundle-tests)
    add_executable(player-bundle-patch tests/player_bundle_patch.cpp src/webview/player_bundle_patch.cpp)
    add_executable(ambient-tests tests/ambient_test.cpp src/mpv/ambient.cpp)
    # Keep test DLL copies separate from the application's parallel post-build copy.
    set_target_properties(ambient-tests PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/tests")
    target_include_directories(ambient-tests PRIVATE src)
    target_link_libraries(ambient-tests PRIVATE ${MPV_LIBRARY})
    add_test(NAME ambient-settings COMMAND ambient-tests)
    add_custom_command(TARGET ambient-tests POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different ${MPV_RUNTIME_DLLS} $<TARGET_FILE_DIR:ambient-tests>)
    add_executable(discord-tests tests/discord_test.cpp)
    target_link_libraries(discord-tests PRIVATE nlohmann_json::nlohmann_json ${DISCORD_LIB})
    add_test(NAME discord-presence COMMAND discord-tests)
    add_executable(display-tests tests/display_mode_test.cpp src/mpv/display_mode.cpp src/mpv/playback_defaults.cpp)
    set_target_properties(display-tests PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/display-tests")
    target_include_directories(display-tests PRIVATE src)
    target_link_libraries(display-tests PRIVATE ${MPV_LIBRARY})
    add_test(NAME display-modes COMMAND display-tests)
    # Python's embedded rendering test calls the same native implementation.
    add_library(display-test-bridge SHARED tests/display_bridge.cpp src/mpv/display_mode.cpp)
    set_target_properties(display-test-bridge PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/display-bridge")
    target_include_directories(display-test-bridge PRIVATE src)
    target_link_libraries(display-test-bridge PRIVATE ${MPV_LIBRARY})
    add_custom_command(TARGET display-tests POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different ${MPV_RUNTIME_DLLS} $<TARGET_FILE_DIR:display-tests>)
endif()

# Copy MPV DLL
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
        ${MPV_RUNTIME_DLLS}
        $<TARGET_FILE_DIR:${PROJECT_NAME}>
)
