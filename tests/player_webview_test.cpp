#include "../src/webview/player_resources.h"
#include <wil/com.h>
#include <wrl.h>
#include <filesystem>
#include <iostream>
#include <string>

// Test-only support: this host does not start Stremio, write file associations,
// or read the user's application profile. It exercises the real resource handler.
std::string WStringToUtf8(const std::wstring& text)
{
    const int size = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
    std::string out(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), size, nullptr, nullptr);
    return out;
}
void AppendToCrashLog(const std::string& text) { std::cerr << text << '\n'; }

namespace {
wil::com_ptr<ICoreWebView2> webview;
wil::com_ptr<ICoreWebView2Controller> controller;
wil::com_ptr<ICoreWebView2Environment> savedEnvironment;
int pass = 0;
bool checking = false;
ULONGLONG navigationTime = 0;
std::wstring profile;

void Fail(const char* message)
{
    std::cerr << message << '\n';
    PostQuitMessage(1);
}

void CheckPage(HWND window)
{
    if (!webview || checking) return;
    checking = true;
    webview->ExecuteScript(L"JSON.stringify({patched:window.__stremioForkAutoplayPatched===true&&window.__stremioForkVolumePatched===true,ready:window.__forkSwReady===true})",
        Microsoft::WRL::Callback<ICoreWebView2ExecuteScriptCompletedHandler>([window](HRESULT result, LPCWSTR value) -> HRESULT {
            checking = false;
            const std::wstring json = value ? value : L"";
            if (FAILED(result) || (pass > 0 && json.find(L"patched\\\":true") == std::wstring::npos)) {
                Fail("Actual WebView2 bootstrap did not execute the autoplay patch");
                return S_OK;
            }
            if (pass == 2) {
                std::cout << "PASS: actual WebView2 patches an existing community cache and survives reload\n";
                PostQuitMessage(0);
            } else if (json.find(L"ready\\\":true") != std::wstring::npos) {
                if (pass == 0) {
                    SetupPlayerResources(savedEnvironment.get(), webview.get(), window);
                    wil::com_ptr<ICoreWebView2Profile> baseProfile;
                    webview.try_query<ICoreWebView2_13>()->get_Profile(&baseProfile);
                    const auto testProfile = baseProfile.try_query<ICoreWebView2Profile2>();
                    KillTimer(window, 2);
                    PreparePlayerScriptCache(testProfile.get(), profile + L"\\fork-player-test.ini", [] {
                        ++pass;
                        webview->Reload();
                    });
                    return S_OK;
                }
                ++pass;
                KillTimer(window, 2);
                webview->Reload();
            } else if (GetTickCount64() - navigationTime > 30000) {
                Fail("Community cache did not become ready for upgrade test");
            }
            return S_OK;
        }).Get());
}

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wp, LPARAM lp)
{
    if (message == WM_FORK_PLAYER_RESOURCE) { CompletePlayerResource(lp); return 0; }
    if (message == WM_TIMER && wp == 1) { Fail("WebView2 integration test timed out"); return 0; }
    if (message == WM_TIMER && wp == 2) { CheckPage(window); return 0; }
    return DefWindowProcW(window, message, wp, lp);
}
}

int main()
{
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;
    wchar_t executable[MAX_PATH];
    GetModuleFileNameW(nullptr, executable, MAX_PATH);
    profile = (std::filesystem::path(executable).parent_path() /
        (L"webview-test-profile-" + std::to_wstring(GetCurrentProcessId()))).wstring();
    const auto instance = GetModuleHandleW(nullptr);
    WNDCLASSW wc{};
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.lpszClassName = L"ForkPlayerResourceTest";
    RegisterClassW(&wc);
    const auto window = CreateWindowW(wc.lpszClassName, L"Player resource integration test", WS_POPUP,
        -32000, -32000, 1280, 720, nullptr, nullptr, instance, nullptr);
    // Keep the WebView active without taking focus or appearing on the desktop.
    ShowWindow(window, SW_SHOWNOACTIVATE);
    SetTimer(window, 1, 90000, nullptr);
    const auto created = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), nullptr,
        Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
        [window](HRESULT status, ICoreWebView2Environment* env) -> HRESULT {
            if (FAILED(status) || !env) { Fail("WebView2 runtime unavailable"); return S_OK; }
            return env->CreateCoreWebView2Controller(window,
                Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [window, environment = wil::com_ptr<ICoreWebView2Environment>(env)](HRESULT status, ICoreWebView2Controller* control) -> HRESULT {
                    if (FAILED(status) || !control) { Fail("Could not create WebView2 test controller"); return S_OK; }
                    controller = control;
                    controller->get_CoreWebView2(&webview);
                    controller->put_Bounds({0, 0, 1280, 720});
                    savedEnvironment = environment;
                    EventRegistrationToken token;
                    webview->add_NavigationCompleted(Microsoft::WRL::Callback<ICoreWebView2NavigationCompletedEventHandler>(
                        [window](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                            BOOL success;
                            args->get_IsSuccess(&success);
                            if (!success) { Fail("Could not navigate to live community player"); return S_OK; }
                            navigationTime = GetTickCount64();
                            webview->ExecuteScript(L"navigator.serviceWorker.ready.then(()=>window.__forkSwReady=true)", nullptr);
                            SetTimer(window, 2, 500, nullptr);
                            return S_OK;
                        }).Get(), &token);
                    webview->Navigate(L"https://stremio.zarg.me/");
                    return S_OK;
                }).Get());
        }).Get());
    if (FAILED(created)) Fail("Could not initialize WebView2 test environment");
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    KillTimer(window, 1);
    KillTimer(window, 2);
    ShutdownPlayerResources();
    if (controller) controller->Close();
    webview.reset();
    controller.reset();
    savedEnvironment.reset();
    DestroyWindow(window);
    CoUninitialize();
    return static_cast<int>(message.wParam);
}
