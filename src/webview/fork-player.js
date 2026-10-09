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
    let maximum = 130;
    let pipEnabled = false;
    let scheduled = false;
    let button;
    let pipButton;
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

    function send(event, args = []) {
        window.chrome.webview.postMessage(JSON.stringify({
            type: 6, object: 'transport', method: 'handleInboundJSON', id: 1001,
            args: [event, args]
        }));
    }

    function applyVolumeLimit(value) {
        const setting = Number(value);
        if (!Number.isFinite(setting) || setting < 1 || setting > 1000) return;
        maximum = setting;
        send('set-volume-limit', [String(maximum)]);
        schedule();
    }

    function updatePip(player) {
        // The top navbar's titled button is fullscreen in every UI language.
        const fullscreen = player?.querySelector('[class*="horizontal-nav-bar-container"] [class*="buttons-container"] > [class*="button-container"][title]:not([class*="menu-button-container"]):not(#stremio-fork-pip)');
        if (!fullscreen || !state.active) {
            pipButton?.remove();
            return;
        }
        if (!pipButton) {
            pipButton = fullscreen.cloneNode(true);
            pipButton.id = 'stremio-fork-pip';
            pipButton.removeAttribute('onclick');
            pipButton.tabIndex = 0;
            pipButton.setAttribute('role', 'button');
            const svg = pipButton.querySelector('svg');
            if (svg) {
                svg.setAttribute('viewBox', '0 0 512 512');
                svg.setAttribute('aria-hidden', 'true');
                svg.innerHTML = '<rect x="100" y="126" width="312" height="260" rx="40" fill="none" stroke="currentColor" stroke-width="34"/><rect x="238" y="240" width="150" height="104" rx="16" fill="currentColor" stroke="none"/>';
            }
            for (const type of ['mousedown', 'dblclick'])
                pipButton.addEventListener(type, event => event.stopPropagation());
            pipButton.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                send('toggle-picture-in-picture');
            });
            pipButton.addEventListener('keydown', event => {
                if (event.code !== 'Enter' && event.code !== 'Space') return;
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) pipButton.click();
            });
        }
        if (pipButton.className !== fullscreen.className) pipButton.className = fullscreen.className;
        const title = pipEnabled ? 'Exit Picture-in-Picture' : 'Picture-in-Picture';
        if (pipButton.title !== title) {
            pipButton.title = title;
            pipButton.setAttribute('aria-label', title);
        }
        const pressed = String(pipEnabled);
        if (pipButton.getAttribute('aria-pressed') !== pressed) pipButton.setAttribute('aria-pressed', pressed);
        if (pipButton.parentElement !== fullscreen.parentElement || pipButton.nextElementSibling !== fullscreen)
            fullscreen.before(pipButton);
    }

    function adjustSettingsLayout() {
        if (document.getElementById('stremio-fork-settings-layout')) return;
        const style = document.createElement('style');
        style.id = 'stremio-fork-settings-layout';
        style.textContent = `
            [class*="settings-container"] [class*="option-container"]:has(> [class*="option-name-container"]) {
                max-width: 46rem !important;
            }
            [class*="settings-container"] [class*="option-container"] > [class*="option-name-container"] {
                flex: 0 1 25rem !important; min-width: 0; margin-right: 3rem !important;
            }
            [class*="settings-container"] [class*="option-name-container"] [class*="label"] {
                white-space: normal !important; overflow: visible !important; text-overflow: clip !important;
                overflow-wrap: anywhere; max-height: none !important;
            }
            [class*="settings-container"] [class*="option-container"] > [class*="option-input-container"] {
                flex: 1 1 18rem !important; min-width: 0;
            }
            @media (max-width: 900px) {
                [class*="settings-container"] [class*="option-container"] > [class*="option-name-container"] {
                    flex-basis: 55% !important; margin-right: 2rem !important;
                }
            }
            @media (max-width: 650px) {
                [class*="settings-container"] [class*="option-container"]:has(> [class*="option-name-container"]) {
                    flex-direction: column !important; align-items: stretch !important;
                }
                [class*="settings-container"] [class*="option-container"] > [class*="option-name-container"],
                [class*="settings-container"] [class*="option-container"] > [class*="option-input-container"] {
                    flex: none !important; width: 100%; margin-right: 0 !important;
                }
            }`;
        document.head.append(style);
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
        updatePip(player);
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
        if (payload?.args?.[0] === 'picture-in-picture-changed') {
            if (typeof payload.args[1]?.enabled !== 'boolean') return;
            pipEnabled = payload.args[1].enabled;
            schedule();
            return;
        }
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
        adjustSettingsLayout();
        try { applyVolumeLimit(JSON.parse(localStorage.getItem('localProfile') || '{}').maxVolume ?? 130); }
        catch { applyVolumeLimit(130); }
        const observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true,
            attributeFilter: ['class', 'src', 'href', 'style']});
        schedule();
        send('get-display-mode');
        send('get-picture-in-picture');
    }
    window.addEventListener('stremio-fork-volume-limit', event => applyVolumeLimit(event.detail));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
})();
