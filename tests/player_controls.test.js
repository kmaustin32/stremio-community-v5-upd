const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const output = process.env.STREMIO_UI_TEST_OUTPUT || '.build-cache/ui-test-evidence';
const image = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
let script = fs.readFileSync('src/webview/fork-player.js', 'utf8');
script = script.replace('__FORK_SYMBOL__', image('images/web-symbol.png'))
    .replace('__FORK_WORDMARK__', image('images/web-logo.png'))
    .replace('__FORK_ICON__', image('images/stremio2.png'));

// Match the upstream ControlBar's CSS-module structure, including its narrow-screen menu.
const fixture = `<!doctype html><html><head><link rel="icon" href="/images/icon.png"><style>
*{box-sizing:border-box}body{margin:0;background:#11101b;color:white;font:16px 'Segoe UI',sans-serif}
header{height:70px;padding:20px}header img{width:160px}
.Player__player-container__fixture{position:relative;height:calc(100vh - 70px);background:linear-gradient(150deg,#222442,#171e2e 60%,#101424)}
.ControlBar__control-bar-container__fixture{position:absolute;left:0;right:0;bottom:15px;padding:0 24px}
.seek{height:4px;background:#7272c2;margin-bottom:12px}.ControlBar__control-bar-buttons-container__fixture{display:flex;align-items:center}
.ControlBar__control-bar-buttons-menu-container__fixture{display:flex;align-items:center;margin-left:auto}
.control{width:60px;height:80px;border:0;background:none;color:white;font-size:16px}.hide{visibility:hidden}
@media(max-width:600px){.ControlBar__control-bar-buttons-menu-container__fixture{position:absolute;right:12px;bottom:80px;flex-direction:column;background:#252335;border-radius:8px}.control{height:60px}}
</style></head><body><header><img id="brand" src="/images/logo.png"><img id="poster" src="https://posters.example/images/logo.png" style="display:none"></header>
<div class="Player__player-container__fixture"><div id="toolbar" class="ControlBar__control-bar-container__fixture"><div class="seek"></div>
<div class="ControlBar__control-bar-buttons-container__fixture"><button class="control" id="pause">Pause</button>
<div class="ControlBar__control-bar-buttons-menu-container__fixture"><button class="control" id="speed">Speed</button><button class="control" id="subtitles">Subs</button></div></div></div></div></body></html>`;

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
            document.addEventListener('click', () => window.parentClicks++);
        });
        await page.addInitScript({content: script});
        await page.goto('https://stremio.zarg.me/#/player/fixture');
        const button = page.locator('#stremio-fork-display-mode');
        assert.equal(await button.count(), 0, 'Hide control before native video is loaded');
        assert.equal(await page.evaluate(() => window.messages[0].args[0]), 'get-display-mode');
        await page.evaluate(() => window.nativeMode({mode: 'fit', active: true}));
        await button.waitFor();
        assert.equal(await button.innerText(), 'Fit');
        await button.click();
        assert.equal(await button.innerText(), 'Fit', 'Wait for native acknowledgment');
        assert.equal(await page.evaluate(() => window.messages.at(-1).args[0]), 'cycle-display-mode');
        assert.equal(await page.evaluate(() => window.parentClicks), 0, 'No accidental pause click');
        for (const mode of ['crop', 'stretch', 'fit']) {
            await page.evaluate(mode => window.nativeMode({mode, active: true}), mode);
            await page.waitForFunction(mode => document.querySelector('#stremio-fork-display-mode')?.dataset.mode === mode, mode);
            assert.equal(await button.innerText(), mode[0].toUpperCase() + mode.slice(1));
        }
        await button.focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Space');
        assert.equal(await page.evaluate(() => window.messages.filter(message => message.args[0] === 'cycle-display-mode').length), 3);
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
        assert.equal(await button.innerText(), 'Fit', 'Ignore invalid native state');
        await page.evaluate(() => window.nativeMode({mode: 'fit', active: false}));
        await page.waitForFunction(() => !document.querySelector('#stremio-fork-display-mode'));
        await page.evaluate(() => window.nativeMode({mode: 'fit', active: true}));
        await button.waitFor();
        assert.equal(await button.innerText(), 'Fit', 'New video starts in Fit');
    } finally {
        await browser.close();
    }
});
