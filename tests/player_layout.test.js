const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const output = process.env.STREMIO_UI_TEST_OUTPUT || '.build-cache/ui-test-evidence';
const executablePath = [process.env.STREMIO_TEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));

async function communityAssets() {
    const response = await fetch('https://stremio.zarg.me/');
    assert.ok(response.ok);
    const html = await response.text();
    const urls = [html.match(/src="([^"\s]+\/scripts\/main\.js)"/)[1],
        html.match(/href="([^"\s]+\/styles\/main\.css)"/)[1]];
    return Promise.all(urls.map(async url => {
        const response = await fetch(new URL(url, 'https://stremio.zarg.me/'));
        assert.ok(response.ok);
        return response.text();
    }));
}

test('Real community slider rescales clicks and drags after changing maximum volume', async () => {
    const [bundle, css] = await communityAssets();
    // Expose webpack's existing modules before app startup. Components and their
    // slider hooks run unchanged; only services and the storage provider are fixtures.
    const anchor = '(()=>{var e;o.g.importScripts';
    assert.ok(bundle.includes(anchor), 'Locate webpack bootstrap');
    const instrumented = bundle.replace(anchor, 'window.testRequire=o;window.testModules=a;return;' + anchor);
    const patchedPath = '.build-cache/player-autoplay/patched.js';
    const patched = fs.existsSync(patchedPath) ? fs.readFileSync(patchedPath, 'utf8') : '';
    const verifiedPatch = patched.includes('__stremioForkVolumePatched=true');
    if (process.env.CI) assert.ok(verifiedPatch, 'CI must use the C++-patched live player callback');
    const callback = (verifiedPatch ? patched : bundle).match(/\.useCallback\((function\(([\w$]+)\)\{([\w$]+)\.setProp\("volume",Math\.min\(\2,Number\(([\w$]+)\.maxVolume\)\)\)\}),\[([^\]]*)\]\)/);
    assert.ok(callback);
    const callbackData = {source: callback[1], video: callback[3], storage: callback[4],
        // Without a local C++ compiler, exercise the intended dependency locally;
        // CI exercises the exact callback and dependency list produced by C++.
        dependencies: verifiedPatch ? callback[5] : `${callback[4]}.maxVolume`};
    const browser = await chromium.launch({executablePath, headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 1280, height: 720}});
        await page.setContent(`<html><head><style>${css}</style><style>body{background:#191727;color:white}.test-volume{width:320px!important;height:60px!important;margin:80px!important}</style></head><body><div id="app"></div></body></html>`);
        await page.addScriptTag({content: instrumented});
        await page.evaluate(callbackData => {
            const req = window.testRequire, modules = window.testModules;
            const find = predicate => Object.values(modules).find(factory => predicate(factory.toString()));
            const volumeFactory = find(source => source.includes('volume-slider') && source.includes('maximumValue') && source.includes('.useStorage'));
            const sliderFactory = find(source => source.includes('active-slider-within') && source.includes('getBoundingClientRect'));
            if (!volumeFactory || !sliderFactory) throw Error('Missing live slider components');
            const dependency = (source, property) => Number(source.match(new RegExp(`a\\((\\d+)\\)\\.${property}`))[1]);
            const React = req(30758), ReactDOM = req(99576);
            const storageContext = React.createContext(null);
            function load(factory, overrides) {
                const module = {exports: {}};
                const custom = Object.assign(id => Object.hasOwn(overrides, id) ? overrides[id] : req(id), req);
                factory(module, module.exports, custom);
                return module.exports;
            }
            const sliderSource = sliderFactory.toString();
            const Slider = load(sliderFactory, {
                [dependency(sliderSource, 'useRouteFocused')]: {useRouteFocused: () => true},
                [dependency(sliderSource, 'useServices')]: {useServices: () => ({shell: {active: false}})}
            });
            const volumeSource = volumeFactory.toString();
            const VolumeSlider = load(volumeFactory, {
                [dependency(volumeSource, 'useRouteFocused')]: {useRouteFocused: () => true},
                [dependency(volumeSource, 'Slider')]: {Slider},
                [dependency(volumeSource, 'useStorage')]: {useStorage: () => [React.useContext(storageContext)]}
            });
            window.sliderCalls = [];
            const makeCallback = new Function(callbackData.video, callbackData.storage,
                `return {handler: ${callbackData.source}, dependencies: [${callbackData.dependencies}]};`);
            function Harness() {
                const [storage, setStorage] = React.useState({maxVolume: '130'});
                const [volume, setVolume] = React.useState(100);
                window.setMaximum = maximum => setStorage({maxVolume: String(maximum)});
                const liveCallback = makeCallback({setProp: (name, value) => {
                    if (name !== 'volume') throw Error('Unexpected property');
                    window.sliderCalls.push(value);
                    setVolume(value);
                }}, storage);
                const onVolume = React.useCallback(liveCallback.handler, liveCallback.dependencies);
                return React.createElement(storageContext.Provider, {value: storage},
                    React.createElement(VolumeSlider, {className: 'test-volume', volume, muted: false, onVolumeChangeRequested: onVolume}));
            }
            ReactDOM.createRoot(document.querySelector('#app')).render(React.createElement(Harness));
        }, callbackData);
        const slider = page.locator('.test-volume');
        await slider.waitFor();
        for (const maximum of [130, 225, 175, 100, 75, 200]) {
            await page.evaluate(maximum => window.setMaximum(maximum), maximum);
            // Let the real useLiveRef layout hooks observe the new React props.
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const bounds = await slider.boundingBox();
            await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            assert.ok(Math.abs(await page.evaluate(() => window.sliderCalls.at(-1)) - maximum / 2) < 1);
            await page.mouse.move(bounds.x + 5, bounds.y + bounds.height / 2);
            await page.mouse.down();
            await page.mouse.move(bounds.x + bounds.width + 20, bounds.y + bounds.height / 2, {steps: 8});
            await page.mouse.up();
            assert.equal(await page.evaluate(() => window.sliderCalls.at(-1)), maximum, 'Dragging to the end reaches the selected cap');
        }
    } finally { await browser.close(); }
});

test('Settings labels remain readable and controls have room at desktop and narrow sizes', async () => {
    const [, css] = await communityAssets();
    const settingsCss = css.slice(css.indexOf('.settings-container-'));
    const classFor = name => settingsCss.match(new RegExp(`\\.(${name}-[\\w-]+)`))[1];
    const labelClass = settingsCss.match(/\.option-name-container-[\w-]+ \.(label-[\w-]+)/)[1];
    const row = title => `<div class="${classFor('option-container')}"><div class="${classFor('option-name-container')}"><span class="${labelClass}">${title}</span></div><div class="${classFor('option-input-container')}"><button style="height:3rem;width:100%;color:var(--primary-foreground-color);background:var(--overlay-color);border:0;border-radius:3rem">130%</button></div></div>`;
    const body = `<div class="${classFor('settings-container')}"><div class="${classFor('settings-content')}"><div class="${classFor('side-menu-container')}">Player settings</div><div class="${classFor('sections-container')}"><div class="${classFor('section-container')}"><h2 class="${classFor('section-title')}">Player</h2>${row('Maximum Volume')}${row('Use MPV for external subtitles')}${row('Show subtitle track loaded notification')}${row('Remember audio and subtitle track selection')}</div></div></div></div>`;
    const browser = await chromium.launch({executablePath, headless: true});
    try {
        fs.mkdirSync(output, {recursive: true});
        const page = await browser.newPage({viewport: {width: 1280, height: 800}});
        await page.route('https://stremio.zarg.me/**', route => route.fulfill({body: `<html><head><style>${css}</style></head><body>${body}</body></html>`, contentType: 'text/html'}));
        await page.goto('https://stremio.zarg.me/#/settings');
        const controls = page.locator('[class*="option-input-container"]');
        const previous = await controls.first().boundingBox();
        await page.evaluate(() => {window.chrome = {webview: {postMessage() {}, addEventListener() {}}};});
        await page.addScriptTag({content: fs.readFileSync('src/webview/fork-player.js', 'utf8')});
        const current = await controls.first().boundingBox();
        assert.ok(current.x > previous.x + 15, 'Options column is farther from labels');
        const labels = page.locator('[class*="option-name-container"] [class*="label"]');
        assert.equal(await labels.count(), 4);
        for (const width of [1280, 800, 600]) {
            await page.setViewportSize({width, height: 800});
            const metrics = await labels.evaluateAll(elements => elements.map(element => ({
                clipped: element.scrollWidth > element.clientWidth + 1,
                wrap: getComputedStyle(element).whiteSpace,
                right: element.getBoundingClientRect().right
            })));
            assert.ok(metrics.every(item => !item.clipped && item.wrap === 'normal' && item.right <= width), `Readable labels at ${width}px`);
            await page.screenshot({path: path.join(output, `settings-${width}.png`)});
        }
    } finally { await browser.close(); }
});
