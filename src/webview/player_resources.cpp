#include "player_resources.h"
#include "player_bundle_patch.h"
#include "../utils/helpers.h"
#include "../utils/crashlog.h"
#include <curl/curl.h>
#include <Shlwapi.h>
#include <wil/com.h>
#include <wrl.h>
#include <memory>
#include <thread>
#include <unordered_map>

namespace {
struct Pending {
    wil::com_ptr<ICoreWebView2WebResourceRequestedEventArgs> args;
    wil::com_ptr<ICoreWebView2Deferral> deferral;
};
struct Result { size_t id; std::string uri, body, error; };
// All COM objects and these maps stay on the UI thread. Workers only download
// anonymous public JS and return plain data through the window's message queue.
wil::com_ptr<ICoreWebView2Environment> environment;
std::unordered_map<size_t, Pending> pending;
std::unordered_map<std::string, std::string> cache;
size_t nextId = 0;

size_t WriteBody(char* data, size_t size, size_t count, void* context)
{
    auto& body = *static_cast<std::string*>(context);
    const auto bytes = size * count;
    if (bytes > 32 * 1024 * 1024 || body.size() > 32 * 1024 * 1024 - bytes) return 0;
    body.append(data, bytes);
    return bytes;
}

bool Download(const std::string& uri, std::string& body)
{
    CURL* curl = curl_easy_init();
    if (!curl) return false;
    curl_easy_setopt(curl, CURLOPT_URL, uri.c_str());
    curl_easy_setopt(curl, CURLOPT_ACCEPT_ENCODING, "");
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 5L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 20L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteBody);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
    const auto status = curl_easy_perform(curl);
    long http = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http);
    curl_easy_cleanup(curl);
    return status == CURLE_OK && http == 200;
}

void Respond(ICoreWebView2WebResourceRequestedEventArgs* args, const std::string& body)
{
    wil::com_ptr<IStream> stream;
    stream.attach(SHCreateMemStream(reinterpret_cast<const BYTE*>(body.data()),
        static_cast<UINT>(body.size())));
    if (!stream) return;
    wil::com_ptr<ICoreWebView2WebResourceResponse> response;
    if (SUCCEEDED(environment->CreateWebResourceResponse(stream.get(), 200, L"OK",
            L"Content-Type: application/javascript; charset=utf-8\r\nCache-Control: no-store", &response)))
        args->put_Response(response.get());
}
}

void SetupPlayerResources(ICoreWebView2Environment* env, ICoreWebView2* webview, HWND window)
{
    environment = env;
    wil::com_ptr<ICoreWebView2> base = webview;
    const auto resources = base.try_query<ICoreWebView2_22>();
    for (const auto* filter : {L"https://stremio.zarg.me/*/scripts/main.js*",
            L"https://zaarrg.github.io/stremio-web-shell-fixes/*/scripts/main.js*"}) {
        if (resources) {
            resources->AddWebResourceRequestedFilterWithRequestSourceKinds(filter,
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL);
        } else {
            webview->AddWebResourceRequestedFilter(filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT);
        }
    }
    EventRegistrationToken token;
    webview->add_WebResourceRequested(Microsoft::WRL::Callback<ICoreWebView2WebResourceRequestedEventHandler>(
        [window](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            wil::com_ptr<ICoreWebView2WebResourceRequest> request;
            args->get_Request(&request);
            wil::unique_cotaskmem_string uri;
            if (!request || FAILED(request->get_Uri(&uri)) || !uri) return S_OK;
            const std::string rawUrl = WStringToUtf8(uri.get());
            if (!IsCommunityPlayerScript(rawUrl)) return S_OK;
            // Workbox precaching appends a revision query to the same public asset.
            const std::string url = rawUrl.substr(0, rawUrl.find('?'));
            if (const auto cached = cache.find(url); cached != cache.end()) {
                Respond(args, cached->second);
                return S_OK;
            }
            Pending item;
            item.args = args;
            if (FAILED(args->GetDeferral(&item.deferral))) return S_OK;
            const auto id = ++nextId;
            pending.emplace(id, std::move(item));
            std::thread([window, id, url] {
                auto result = std::make_unique<Result>();
                result->id = id;
                result->uri = url;
                try {
                    if (!Download(url, result->body)) {
                        result->body.clear();
                        result->error = "Could not download community player script";
                    } else if (!PatchPlayerAutoplay(result->body, result->error)) {
                        // Never guess at an unknown upstream shape or damage its bundle.
                        result->body.clear();
                    }
                } catch (...) { result->body.clear(); result->error = "Player compatibility patch failed"; }
                if (PostMessage(window, WM_FORK_PLAYER_RESOURCE, 0, reinterpret_cast<LPARAM>(result.get())))
                    result.release();
            }).detach();
            return S_OK;
        }).Get(), &token);
}

void CompletePlayerResource(LPARAM data)
{
    const std::unique_ptr<Result> result(reinterpret_cast<Result*>(data));
    const auto found = pending.find(result->id);
    if (found == pending.end()) return;
    if (!result->body.empty() && environment) {
        Respond(found->second.args.get(), result->body);
        cache[result->uri] = result->body;
    } else {
        AppendToCrashLog("[WEBVIEW]: " + result->error);
    }
    found->second.deferral->Complete();
    pending.erase(found);
}

void ShutdownPlayerResources()
{
    for (auto& [id, item] : pending) item.deferral->Complete();
    pending.clear();
    cache.clear();
    environment.reset();
}
