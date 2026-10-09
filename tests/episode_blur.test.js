const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

test('Unwatched episode images keep blur across fallback, seasons, watch state, and settings changes', async () => {
    const bundlePath = process.env.STREMIO_BLUR_BUNDLE || '.build-cache/player-autoplay/patched.js';
    const bundle = fs.readFileSync(bundlePath, 'utf8');
    if (process.env.CI) assert.ok(bundle.includes('__stremioForkEpisodeBlurPatched=true'), 'Use the real C++-patched bundle');
    const response = await fetch('https://stremio.zarg.me/');
    assert.ok(response.ok);
    const html = await response.text();
    const cssResponse = await fetch(new URL(html.match(/href="([^"\s]+\/styles\/main\.css)"/)[1], 'https://stremio.zarg.me/'));
    assert.ok(cssResponse.ok);
    const css = await cssResponse.text();
    const anchor = '(()=>{var e;o.g.importScripts';
    assert.ok(bundle.includes(anchor));
    const instrumented = bundle.replace(anchor, 'window.testRequire=o;window.testModules=a;return;' + anchor);
    const executablePath = [process.env.STREMIO_TEST_BROWSER,
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
    const browser = await chromium.launch({executablePath, headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 1280, height: 900}});
        await page.route('https://stremio.zarg.me/**', route => route.fulfill({contentType: 'text/html', body: `<html><head><style>${css}</style><style>body{background:#191727;color:white}#app{padding:25px}.episode-fixture{width:35rem;margin-bottom:2rem}.next-fixture{position:relative!important;transform:none!important;animation:none!important}</style></head><body><div id="app"></div></body></html>`}));
        // Synthetic artwork avoids spoilers and makes network success/failure deterministic.
        const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="288"><rect width="512" height="288" fill="#7272c2"/><path d="M0 144h512M256 0v288" stroke="white" stroke-width="32"/><circle cx="256" cy="144" r="56" fill="#ffae32"/></svg>';
        await page.route('https://episode.test/**', route => route.fulfill(route.request().url().includes('/missing/') ?
            {status: 404, body: 'missing'} : {contentType: 'image/svg+xml', body: artwork}));
        await page.goto('https://stremio.zarg.me/#/detail/series/tt0290223');
        await page.addScriptTag({content: instrumented});
        await page.evaluate(() => {
            const req = window.testRequire, factories = Object.values(window.testModules);
            const find = predicate => factories.find(factory => predicate(factory.toString()));
            const videoFactory = find(source => source.includes('.blurred') && source.includes('seasonWatched') && source.includes('renderFallback'));
            const popupFactory = find(source => source.includes('.blurred') && source.includes('onDismiss') && source.includes('renderFallback'));
            const imageFactory = find(source => source.includes('fallbackSrc') && source.includes('onError:') && source.includes('renderFallback'));
            if (!videoFactory || !popupFactory || !imageFactory) throw Error('Missing live episode components');
            const React = req(30758), ReactDOM = req(99576);
            const profileContext = React.createContext(null);
            function load(factory, overrides = {}) {
                const module = {exports: {}};
                const custom = Object.assign(id => Object.hasOwn(overrides, id) ? overrides[id] : req(id), req);
                factory(module, module.exports, custom);
                return module.exports;
            }
            const Image = load(imageFactory).default;
            const Button = React.forwardRef(({children, className, title, onClick}, ref) => React.createElement('button', {className, title, onClick, ref}, children));
            const Popup = props => React.createElement(props.renderLabel, props);
            const Icon = () => React.createElement('svg', {'data-placeholder': true});
            const useProfile = () => React.useContext(profileContext);
            const common = {Button, Popup, Image};
            const Video = load(videoFactory, {
                84902: common, 52600: useProfile, 75394: {useRouteFocused: () => true},
                73582: {useTranslation: () => ({t: key => key})}, 4672: {default: Icon}, 54900: () => null
            });
            const NextVideoPopup = load(popupFactory, {
                84902: common, 60350: {useProfile, CONSTANTS: {ICON_FOR_TYPE: new Map()}},
                73582: {useTranslation: () => ({t: key => key})}, 4672: {default: Icon}
            });
            function Harness() {
                const [state, setState] = React.useState({hideSpoilers: true, watched: false, season: 3, episode: 1, source: 'missing', alternateSource: 'alternate'});
                window.changeEpisode = changes => setState(previous => ({...previous, ...changes}));
                const primary = `https://episode.test/${state.source}/${state.season}/${state.episode}.svg`;
                const alternate = `https://episode.test/${state.alternateSource}/1/${54 + state.episode}.svg`;
                const videoProps = {id: `tt0290223:${state.season}:${state.episode}`, title: 'Test episode',
                    season: state.season, episode: state.episode, thumbnail: primary, altThumbnail: alternate,
                    watched: state.watched, progress: 0, upcoming: false, scheduled: false,
                    deepLinks: {}, onMarkVideoAsWatched() {}, onMarkSeasonAsWatched() {}};
                return React.createElement(profileContext.Provider, {value: {settings: {hideSpoilers: state.hideSpoilers, interfaceLanguage: 'en-US'}}},
                    React.createElement('h2', null, 'Show episode list'),
                    React.createElement(Video, {...videoProps, className: 'episode-fixture show-list'}),
                    React.createElement('h2', null, 'Player episode panel'),
                    React.createElement(Video, {...videoProps, className: 'episode-fixture player-list'}),
                    React.createElement('h2', null, 'Next episode popup'),
                    React.createElement(NextVideoPopup, {className: 'next-fixture',
                        metaItem: {type: 'series', name: 'Inuyasha test fixture'}, nextVideo: {...videoProps}, altThumbnail: alternate}));
            }
            ReactDOM.createRoot(document.querySelector('#app')).render(React.createElement(Harness));
        });

        let hideSpoilers = true;
        async function check(changes, expectedBlur, expectedSource = 'alternate') {
            if (Object.hasOwn(changes, 'hideSpoilers')) hideSpoilers = changes.hideSpoilers;
            await page.evaluate(changes => window.changeEpisode(changes), changes);
            await page.waitForFunction(expectedSource => {
                const images = Array.from(document.querySelectorAll('.show-list img,.player-list img,.next-fixture img'));
                return images.length === 3 && images.every(image => image.complete && image.naturalWidth > 0 && image.src.includes('/' + expectedSource + '/'));
            }, expectedSource);
            // Verify real CSS blur on the displayed image after actual onError fallback.
            const actual = await page.locator('.show-list img,.player-list img').evaluateAll(images => images.map(image => getComputedStyle(image).filter));
            assert.equal(actual.length, 2);
            assert.ok(actual.every(filter => expectedBlur ? /blur\([1-9]/.test(filter) : filter === 'none'), JSON.stringify({changes, expectedBlur, actual}));
            // The existing next-episode popup hides series previews whenever enabled.
            assert.equal(await page.locator('.next-fixture img').evaluate(image => getComputedStyle(image).filter !== 'none'), hideSpoilers);
        }
        await check({}, true);
        for (const season of [1, 2, 3, 4, 5, 6, 7, 8]) await check({season, episode: 2}, true);
        await check({source: 'success'}, true, 'success');
        await check({source: 'missing', watched: true}, false);
        await check({watched: false}, true);
        await check({hideSpoilers: false}, false);
        await check({hideSpoilers: true}, true);
        await check({season: 0, episode: 0}, true);
        await check({season: null, episode: null}, false); // Non-episodic artwork stays clear.
        await check({season: 3, episode: 1}, true);
        await page.evaluate(() => window.changeEpisode({alternateSource: 'missing'}));
        await page.waitForFunction(() => document.querySelectorAll('.show-list img,.player-list img,.next-fixture img').length === 0 &&
            document.querySelectorAll('[data-placeholder]').length === 3);
        await check({alternateSource: 'alternate'}, true); // Recover after both image sources failed.
        const output = process.env.STREMIO_UI_TEST_OUTPUT || '.build-cache/ui-test-evidence';
        fs.mkdirSync(output, {recursive: true});
        await page.screenshot({path: path.join(output, 'episode-blur-fallback.png')});
    } finally { await browser.close(); }
});
