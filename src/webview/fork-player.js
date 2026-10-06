(() => {
    'use strict';
    if (window.top !== window.self || !window.chrome?.webview || window.__stremioForkControls) return;
    const hosts = new Set(['stremio.zarg.me', 'zaarrg.github.io', 'web.stremio.com']);
    if (!hosts.has(location.hostname)) return;
    window.__stremioForkControls = true;

    const logos = {symbol: '__FORK_SYMBOL__', logo: '__FORK_WORDMARK__', icon: '__FORK_ICON__'};
    const labels = {fit: 'Fit', crop: 'Crop', stretch: 'Stretch'};
    const next = {fit: 'Crop', crop: 'Stretch', stretch: 'Fit'};
    let state = {mode: 'fit', active: false};
    let scheduled = false;
    let button;

    function send(event) {
        window.chrome.webview.postMessage(JSON.stringify({
            type: 6, object: 'transport', method: 'handleInboundJSON', id: 1001,
            args: [event, []]
        }));
    }

    function recolorLogos() {
        for (const image of document.querySelectorAll('img')) {
            let url;
            try { url = new URL(image.getAttribute('src') || '', location.href); } catch { continue; }
            if (!hosts.has(url.hostname) || !/\/images\//.test(url.pathname)) continue;
            const name = url.pathname.split('/').pop();
            const asset = name === 'logo.png' ? logos.logo : name === 'stremio_symbol.png' ? logos.symbol :
                          /^(icon|maskable_icon)\.png$/.test(name) ? logos.icon : null;
            if (asset) {
                image.removeAttribute('srcset');
                image.src = asset;
            }
        }
        for (const link of document.querySelectorAll('link[rel~="icon"]')) {
            if (link.getAttribute('href') !== logos.icon) link.href = logos.icon;
        }
    }

    function update() {
        scheduled = false;
        recolorLogos();
        const player = document.querySelector('[class*="player-container"]');
        const controls = player?.querySelector('[class*="control-bar-buttons-menu-container"]');
        if (!controls || !state.active) {
            button?.remove();
            return;
        }
        if (!button) {
            button = document.createElement('button');
            button.id = 'stremio-fork-display-mode';
            button.type = 'button';
            button.innerHTML = '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M8 8H5v3m11-3h3v3M8 16H5v-3m11 3h3v-3"/></svg><span></span>';
            button.style.cssText = 'flex:none;min-width:4rem;height:5rem;padding:0 .55rem;border:0;background:transparent;color:var(--primary-foreground-color,#fff);font:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;border-radius:8px;';
            button.querySelector('span').style.cssText = 'font-size:11px;line-height:1.2;';
            button.addEventListener('mousedown', event => event.stopPropagation());
            button.addEventListener('dblclick', event => event.stopPropagation());
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                send('cycle-display-mode');
            });
            button.addEventListener('keydown', event => {
                if (event.code !== 'Enter' && event.code !== 'Space') return;
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) button.click();
            });
            button.addEventListener('mouseenter', () => button.style.background = 'rgba(114,114,194,.25)');
            button.addEventListener('mouseleave', () => button.style.background = 'transparent');
        }
        const label = labels[state.mode];
        const title = `Display: ${label}. Click for ${next[state.mode]}.`;
        if (button.title !== title) {
            button.title = title;
            button.setAttribute('aria-label', title);
            button.dataset.mode = state.mode;
            button.querySelector('span').textContent = label;
        }
        if (button.parentElement !== controls) controls.prepend(button);
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(update);
    }

    window.chrome.webview.addEventListener('message', event => {
        let payload;
        try { payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
        if (payload?.args?.[0] !== 'display-mode-changed') return;
        const data = payload.args[1];
        if (!data || !Object.hasOwn(labels, data.mode) || typeof data.active !== 'boolean') return;
        state = {mode: data.mode, active: data.active};
        schedule();
    });

    function start() {
        const observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true,
            attributeFilter: ['class', 'src', 'href']});
        schedule();
        send('get-display-mode');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
})();
