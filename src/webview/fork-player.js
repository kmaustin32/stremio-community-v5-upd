(() => {
    'use strict';
    if (window.top !== window.self || !window.chrome?.webview || window.__stremioForkControls) return;
    const hosts = new Set(['stremio.zarg.me', 'zaarrg.github.io', 'web.stremio.com']);
    if (!hosts.has(location.hostname)) return;
    window.__stremioForkControls = true;

    const logos = {symbol: '__FORK_SYMBOL__', logo: '__FORK_WORDMARK__', icon: '__FORK_ICON__'};
    const labels = {fit: 'Fit', crop: 'Crop', stretch: 'Stretch'};
    const next = {fit: 'Crop', crop: 'Stretch', stretch: 'Fit'};
    const icons = {fit: '__FORK_FIT_SVG__', crop: '__FORK_CROP_SVG__', stretch: '__FORK_STRETCH_SVG__'};
    let state = {mode: 'fit', active: false};
    let volume = 100;
    let muted = false;
    let scheduled = false;
    let button;
    const appliedStyles = new WeakMap();

    function setStyle(element, name, value) {
        if (!element) return;
        const saved = appliedStyles.get(element) || {};
        if (saved[name]?.value === value && saved[name].actual === element.style.getPropertyValue(name)) return;
        element.style.setProperty(name, value);
        saved[name] = {value, actual: element.style.getPropertyValue(name)};
        appliedStyles.set(element, saved);
    }

    function updateVolume(player) {
        const slider = player?.querySelector('[class*="volume-slider"]');
        if (!slider) return;
        let maximum = 130;
        try {
            const setting = Number(JSON.parse(localStorage.getItem('localProfile') || '{}').maxVolume);
            if (Number.isFinite(setting) && setting > 0) maximum = setting;
        } catch { /* Keep the hosted community player's default maximum. */ }
        const threshold = Math.min(100 / maximum * 100, 100);
        const gradient = maximum > 100 ? `linear-gradient(to right, var(--primary-foreground-color,#fff) 0%, var(--primary-foreground-color,#fff) ${threshold}%, #ffa500 ${threshold}%, #ff0000 100%)` : '';
        for (const track of slider.querySelectorAll('[class*="track-after"], [class*="Slider__track__"]')) {
            setStyle(track, 'background-image', gradient);
        }
        const fraction = maximum > 100 && !muted ? Math.max(0, Math.min((volume - 100) / (maximum - 100), 1)) : 0;
        const color = !muted && volume > 100 && maximum > 100 ?
            `rgb(255, ${Math.round(165 * (1 - fraction))}, 0)` : 'var(--primary-foreground-color,#fff)';
        setStyle(slider.querySelector('[class*="thumb"]'), 'background-color', color);
        slider.setAttribute('aria-label', muted ? 'Volume muted' : `Volume ${Math.round(volume)}%`);
    }

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
        updateVolume(player);
        const controls = player?.querySelector('[class*="control-bar-buttons-menu-container"]');
        if (!controls || !state.active) {
            button?.remove();
            return;
        }
        if (!button) {
            button = document.createElement('button');
            button.id = 'stremio-fork-display-mode';
            button.type = 'button';
            button.style.cssText = 'flex:none;width:4rem;height:5rem;padding:0;border:0;background:transparent;color:var(--primary-foreground-color,#fff);font:inherit;display:flex;align-items:center;justify-content:center;cursor:pointer;';
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
        }
        const label = labels[state.mode];
        const title = `Display: ${label}. Click for ${next[state.mode]}. Ctrl+Shift+F`;
        if (button.title !== title) {
            button.title = title;
            button.setAttribute('aria-label', title);
            button.dataset.mode = state.mode;
            button.innerHTML = icons[state.mode];
            const icon = button.querySelector('svg');
            icon.setAttribute('aria-hidden', 'true');
            icon.style.cssText = 'flex:none;width:2.5rem;height:2.5rem;';
        }
        const neighbor = Array.from(controls.querySelectorAll('[class*="control-bar-button"]')).find(element => element !== button);
        const classes = neighbor?.className.split(/\s+/).filter(name => name !== 'disabled').join(' ');
        if (classes && button.className !== classes) button.className = classes;
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
        if (payload?.args?.[0] === 'mpv-prop-change') {
            const property = payload.args[1];
            if (property?.name === 'volume' && typeof property.data === 'number' && Number.isFinite(property.data))
                volume = property.data;
            else if (property?.name === 'mute' && typeof property.data === 'boolean') muted = property.data;
            else return;
            schedule();
            return;
        }
        if (payload?.args?.[0] !== 'display-mode-changed') return;
        const data = payload.args[1];
        if (!data || !Object.hasOwn(labels, data.mode) || typeof data.active !== 'boolean') return;
        state = {mode: data.mode, active: data.active};
        schedule();
    });

    function start() {
        const observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true,
            attributeFilter: ['class', 'src', 'href', 'style']});
        schedule();
        send('get-display-mode');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
})();
