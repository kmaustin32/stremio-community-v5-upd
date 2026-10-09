#pragma once
#include <windows.h>
#include <WebView2.h>
#include <functional>
#include <string>

#define WM_FORK_PLAYER_RESOURCE (WM_APP + 3)
void SetupPlayerResources(ICoreWebView2Environment* environment, ICoreWebView2* webview, HWND window);
void CompletePlayerResource(LPARAM result);
void ShutdownPlayerResources();
void PreparePlayerScriptCache(ICoreWebView2Profile2* profile, const std::wstring& settings,
    std::function<void()> ready);
