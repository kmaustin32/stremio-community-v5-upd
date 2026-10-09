const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const shortcut = fs.readFileSync('src/webview/webview.cpp', 'utf8').match(/INJECTED_KEYDOWN_SCRIPT = LR"JS\(([\s\S]*?)\)JS";/)[1];

const output = process.env.STREMIO_UI_TEST_OUTPUT || '.build-cache/ui-test-evidence';
const image = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
let script = fs.readFileSync('src/webview/fork-player.js', 'utf8');
script = script.replace('__FORK_SYMBOL__', image('images/web-symbol.png'))
    .replace('__FORK_WORDMARK__', image('images/web-logo.png'))
    .replace('__FORK_ICON__', image('images/stremio2.png'));
for (const mode of ['fit', 'crop', 'stretch'])
    script = script.replace(`__FORK_${mode.toUpperCase()}_SVG__`, fs.readFileSync(`images/player/video-scale-${mode}.svg`, 'utf8').trim());

// Match the upstream ControlBar's CSS-module structure, including its narrow-screen menu.
const fixture = `<!doctype html><html><head><link rel="icon" href="/images/icon.png"><style>
*{box-sizing:border-box}body{margin:0;background:#11101b;color:white;font:16px 'Segoe UI',sans-serif}
header{height:70px;padding:20px}header img{width:160px}
.Player__player-container__fixture{position:relative;height:calc(100vh - 70px);background:linear-gradient(150deg,#222442,#171e2e 60%,#101424)}
.HorizontalNavBar__horizontal-nav-bar-container__fixture{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 24px}.HorizontalNavBar__buttons-container__fixture{display:flex}.HorizontalNavBar__button-container__fixture{width:64px;height:64px;border:0;background:none;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center}.HorizontalNavBar__button-container__fixture svg{width:2.5rem;height:2.5rem}
.ControlBar__control-bar-container__fixture{position:absolute;left:0;right:0;bottom:15px;padding:0 24px}
.seek{height:4px;background:#7272c2;margin-bottom:12px}.ControlBar__control-bar-buttons-container__fixture{display:flex;align-items:center}
.ControlBar__control-bar-buttons-menu-container__fixture{display:flex;align-items:center;margin-left:auto}
.control{width:64px;height:80px;border:0;background:none;color:white;font-size:16px;display:flex;align-items:center;justify-content:center}.control svg{width:2.5rem;height:2.5rem}.hide{visibility:hidden}
.volume-slider{position:relative;width:160px;height:64px;margin:0 16px}.Slider__track__fixture,.Slider__track-after__fixture{position:absolute;top:30px;width:100%;height:6px;background:white}.Slider__track__fixture{opacity:.3}.Slider__track-after__fixture{mask-image:linear-gradient(to right,black 0%,black var(--mask-width,77%),transparent var(--mask-width,77%))}.Slider__thumb__fixture{position:absolute;top:25px;width:16px;height:16px;border-radius:50%;background:white}
@media(max-width:600px){.ControlBar__control-bar-buttons-menu-container__fixture{position:absolute;right:12px;bottom:80px;flex-direction:column;background:#252335;border-radius:8px}.control{height:60px}}
</style></head><body><header><img id="brand" src="/images/logo.png"><img id="poster" src="https://posters.example/images/logo.png" style="display:none"></header>
<div class="Player__player-container__fixture"><nav class="HorizontalNavBar__horizontal-nav-bar-container__fixture"><span>Episode 1</span><div class="HorizontalNavBar__buttons-container__fixture"><button id="fullscreen" class="HorizontalNavBar__button-container__fixture" title="Enter fullscreen"><svg viewBox="0 0 512 512"><path d="M100 210V100h110M302 100h110v110M412 302v110H302M210 412H100V302" fill="none" stroke="currentColor" stroke-width="34"/></svg></button></div></nav><div id="toolbar" class="ControlBar__control-bar-container__fixture"><div class="seek"></div>
<div class="ControlBar__control-bar-buttons-container__fixture"><button class="control" id="pause">Pause</button>
<div class="ControlBar__volume-slider__fixture VolumeSlider__volume-slider__fixture volume-slider"><div class="Slider__track__fixture"></div><div class="Slider__track-after__fixture"></div><div class="Slider__thumb__fixture" style="margin-left:77%"></div></div>
<div class="ControlBar__control-bar-buttons-menu-container__fixture"><button class="ControlBar__control-bar-button__fixture control" id="speed"><svg viewBox="0 0 512 512"><circle cx="256" cy="256" r="180" fill="none" stroke="currentColor" stroke-width="36"/><path d="M256 256l120-110" stroke="currentColor" stroke-width="36"/></svg></button><button class="ControlBar__control-bar-button__fixture control" id="subtitles">Subs</button></div></div></div></div></body></html>`;

test('Player control uses native acknowledgments, survives UI updates, and preserves branding scope', async () => {
    fs.mkdirSync(output, {recursive: true});
    const executablePath = [process.env.STREMIO_TEST_BROWSER,
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
    assert.ok(executablePath, 'Install Edge or set STREMIO_TEST_BROWSER');
    const browser = await chromium.launch({executablePath, headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 1280, height: 720}});
        await page.route('https://stremio.zarg.me/**', route => route.fulfill({body: fixture, contentType: 'text/html'}));
        await page.route('https://posters.example/**', route => route.abort());
        await page.addInitScript(() => {
            window.messages = [];
            window.messageHandlers = [];
            window.parentClicks = 0;
            window.chrome = {webview: {
                postMessage: text => window.messages.push(JSON.parse(text)),
                addEventListener: (_, callback) => window.messageHandlers.push(callback)
            }};
            window.nativeMode = data => window.messageHandlers.forEach(callback => callback({data: JSON.stringify({args: ['display-mode-changed', data]})}));
            window.nativePip = enabled => window.messageHandlers.forEach(callback => callback({data: JSON.stringify({args: ['picture-in-picture-changed', {enabled}]})}));
            window.settingMaximum = maximum => {
                localStorage.setItem('localProfile', JSON.stringify({maxVolume: String(maximum)}));
                window.dispatchEvent(new CustomEvent('stremio-fork-volume-limit', {detail: maximum}));
            };
            window.fixtureVolume = 100;
            window.fixtureMute = false;
            window.nativeProp = (name, data) => {
                if (name === 'volume') window.fixtureVolume = data;
                if (name === 'mute') window.fixtureMute = data;
                const maximum = Number(JSON.parse(localStorage.getItem('localProfile') || '{}').maxVolume) || 130;
                const fraction = window.fixtureMute ? 0 : window.fixtureVolume / maximum * 100;
                document.querySelector('[class*="track-after"]').style.setProperty('--mask-width', `${fraction}%`);
                document.querySelector('[class*="Slider__thumb"]').style.marginLeft = `${fraction}%`;
                window.messageHandlers.forEach(callback => callback({data: JSON.stringify({args: ['mpv-prop-change', {name, data}]})}));
            };
            document.addEventListener('click', () => window.parentClicks++);
        });
        await page.addInitScript({content: script});
        await page.addInitScript({content: shortcut});
        await page.goto('https://stremio.zarg.me/#/player/fixture');
        const button = page.locator('#stremio-fork-display-mode');
        assert.equal(await button.count(), 0, 'Hide control before native video is loaded');
        assert.ok(await page.evaluate(() => window.messages.some(message => message.args[0] === 'get-display-mode')));
        assert.deepEqual(await page.evaluate(() => window.messages.find(message => message.args[0] === 'set-volume-limit').args[1]), ['130']);
        await page.evaluate(() => window.nativeMode({mode: 'fit', active: true}));
        await button.waitFor();
        assert.equal(await button.getAttribute('data-mode'), 'fit');
        const pip = page.locator('#stremio-fork-pip');
        await pip.waitFor();
        assert.equal(await pip.evaluate(element => element.nextElementSibling.id), 'fullscreen');
        const pipBounds = await pip.boundingBox(), fullBounds = await page.locator('#fullscreen').boundingBox();
        assert.equal(pipBounds.y, fullBounds.y);
        assert.equal(pipBounds.width, fullBounds.width);
        assert.equal(await pip.getAttribute('aria-pressed'), 'false');
        await pip.click();
        assert.equal(await page.evaluate(() => window.messages.at(-1).args[0]), 'toggle-picture-in-picture');
        assert.equal(await pip.getAttribute('aria-pressed'), 'false', 'Wait for native PiP acknowledgment');
        await page.evaluate(() => window.nativePip(true));
        await page.waitForFunction(() => document.querySelector('#stremio-fork-pip')?.getAttribute('aria-pressed') === 'true');
        assert.equal(await pip.getAttribute('title'), 'Exit Picture-in-Picture');
        await pip.focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => window.messages.filter(message => message.args[0] === 'toggle-picture-in-picture').length), 2);
        await page.evaluate(() => window.nativePip(false));
        assert.equal(await button.innerText(), '', 'Mode label belongs in tooltip, not below the icon');
        await button.click();
        assert.equal(await button.getAttribute('data-mode'), 'fit', 'Wait for native acknowledgment');
        assert.equal(await page.evaluate(() => window.messages.at(-1).args[0]), 'cycle-display-mode');
        assert.equal(await page.evaluate(() => window.parentClicks), 0, 'No accidental pause click');
        for (const mode of ['crop', 'stretch', 'fit']) {
            await page.evaluate(mode => window.nativeMode({mode, active: true}), mode);
            await page.waitForFunction(mode => document.querySelector('#stremio-fork-display-mode')?.dataset.mode === mode, mode);
            assert.match(await button.getAttribute('title'), new RegExp(mode[0].toUpperCase() + mode.slice(1)));
        }
        await button.focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Space');
        await page.keyboard.press('Control+Shift+F');
        assert.equal(await page.evaluate(() => window.messages.filter(message => message.args[0] === 'cycle-display-mode').length), 4);
        await page.addScriptTag({content: script});
        assert.equal(await button.count(), 1, 'Repeated injection must not duplicate controls');
        await page.evaluate(() => {
            const toolbar = document.querySelector('#toolbar');
            const replacement = toolbar.cloneNode(true);
            replacement.querySelector('#stremio-fork-display-mode').remove();
            toolbar.replaceWith(replacement);
        });
        await button.waitFor();
        assert.equal(await button.count(), 1, 'Restore control after upstream rerender');
        const alignment = await page.evaluate(() => {
            const button = document.querySelector('#stremio-fork-display-mode').getBoundingClientRect();
            const neighbor = document.querySelector('#speed').getBoundingClientRect();
            return {center: button.y + button.height / 2, neighborCenter: neighbor.y + neighbor.height / 2, width: button.width, neighborWidth: neighbor.width};
        });
        assert.equal(alignment.center, alignment.neighborCenter);
        assert.equal(alignment.width, alignment.neighborWidth);
        await page.evaluate(() => { window.settingMaximum(200); window.nativeProp('volume', 150); });
        assert.deepEqual(await page.evaluate(() => window.messages.filter(message => message.args[0] === 'set-volume-limit').at(-1).args[1]), ['200']);
        await page.waitForFunction(() => document.querySelector('[class*="Slider__thumb"]').style.backgroundColor === 'rgb(255, 83, 0)');
        const gradient = await page.locator('[class*="track-after"]').evaluate(element => element.style.backgroundImage);
        assert.match(gradient, /50%/);
        assert.match(gradient, /rgb\(255, 165, 0\)|#ffa500/);
        await page.evaluate(() => window.nativeProp('volume', 200));
        await page.waitForFunction(() => document.querySelector('[class*="Slider__thumb"]').style.backgroundColor === 'rgb(255, 0, 0)');
        await page.evaluate(() => window.nativeProp('volume', 100));
        await page.waitForFunction(() => document.querySelector('[class*="Slider__thumb"]').style.backgroundColor.includes('--primary-foreground-color'));
        await page.evaluate(() => window.nativeProp('mute', true));
        await page.waitForFunction(() => document.querySelector('[class*="volume-slider"]').getAttribute('aria-label') === 'Volume muted');
        await page.evaluate(() => window.nativeProp('mute', false));
        await page.evaluate(() => { window.settingMaximum(150); window.nativeProp('volume', 100); });
        await page.waitForFunction(() => document.querySelector('[class*="track-after"]').style.backgroundImage.includes('66.666'));
        await page.screenshot({path: path.join(output, 'player-controls-wide.png')});
        await page.setViewportSize({width: 480, height: 720});
        const bounds = await button.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 480);
        await page.screenshot({path: path.join(output, 'player-controls-narrow.png')});
        await page.locator('#toolbar').evaluate(element => element.classList.add('hide'));
        assert.equal(await button.isVisible(), false, 'Hide with existing player controls');
        await page.locator('#toolbar').evaluate(element => element.classList.remove('hide'));
        const logo = await page.locator('#brand').getAttribute('src');
        assert.equal(logo, image('images/web-logo.png'));
        assert.equal(await page.locator('#poster').getAttribute('src'), 'https://posters.example/images/logo.png');
        await page.evaluate(() => window.nativeMode({mode: 'bad', active: true}));
        assert.equal(await button.getAttribute('data-mode'), 'fit', 'Ignore invalid native state');
        await page.evaluate(() => window.nativeMode({mode: 'fit', active: false}));
        await page.waitForFunction(() => !document.querySelector('#stremio-fork-display-mode'));
        assert.equal(await pip.count(), 0, 'Remove PiP when native video ends');
        await page.evaluate(() => window.nativeMode({mode: 'fit', active: true}));
        await button.waitFor();
        assert.equal(await button.getAttribute('data-mode'), 'fit', 'New video starts in Fit');
    } finally {
        await browser.close();
    }
});
