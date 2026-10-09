const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');

test('Live community player respects autoplay without losing completion or manual Next', async () => {
    const folder = '.build-cache/player-autoplay';
    fs.mkdirSync(folder, {recursive: true});
    const executable = process.env.STREMIO_BUNDLE_PATCH || 'cmake-build-release-x64/player-bundle-patch.exe';
    const indexResponse = await fetch('https://stremio.zarg.me/');
    assert.ok(indexResponse.ok);
    const html = await indexResponse.text();
    const url = new URL(html.match(/src="([^"\s]+\/scripts\/main\.js)"/)[1], 'https://stremio.zarg.me/').href;
    const response = await fetch(url);
    assert.ok(response.ok);
    const original = await response.text();
    const input = path.join(folder, 'original.js'), output = path.join(folder, 'patched.js');
    fs.writeFileSync(input, original);
    execFileSync(executable, [input, output], {stdio: 'pipe'});
    const script = fs.readFileSync(output, 'utf8');
    new vm.Script(script); // Validate the entire resulting bootstrap, not only the replaced text.
    const target = script.match(/\.useCallback\((function\(\)\{[^{}]*window\.history\.back\(\)[^{}]*\}),\[([^\]]+)\]\)/);
    assert.ok(target, 'Locate the actual patched episode-completion callback');
    const functionSource = target[1];
    const core = functionSource.match(/(\w+)\.nextVideo=/)[1];
    const ref = functionSource.match(/=(\w+)\.current/)[1];
    const navigating = functionSource.match(/,(\w+)\.current/)[1];
    const setting = functionSource.match(/(\w+)\.bingeWatching/)[1];
    const ended = functionSource.match(/\|\|\((\w+)\(\)/)[1];
    const next = functionSource.match(/\.nextVideo\?(\w+)\(\)/)[1];
    assert.ok(target[2].includes(`${setting}.bingeWatching`), 'Setting changes must refresh the callback');
    for (const autoplay of [false, true]) for (const hasNext of [false, true]) {
        const calls = [];
        const settings = {bingeWatching: autoplay};
        const data = hasNext ? {episode: 2} : null;
        const context = {
            [core]: {nextVideo: null}, [ref]: {current: data}, [navigating]: {current: false},
            [setting]: settings, [ended]: () => calls.push('ended'), [next]: () => calls.push('next'),
            window: {history: {back: () => calls.push('back')}}
        };
        const onEnded = vm.runInNewContext(`(${functionSource})`, context);
        onEnded();
        assert.deepEqual(calls, ['ended', autoplay && hasNext ? 'next' : 'back']);
        // The live closure reads the current setting, including an in-session change.
        calls.length = 0;
        settings.bingeWatching = !autoplay;
        onEnded();
        assert.deepEqual(calls, ['ended', !autoplay && hasNext ? 'next' : 'back']);
        calls.length = 0;
        context[navigating].current = true;
        onEnded();
        assert.deepEqual(calls, [], 'Do not navigate twice during an existing navigation');
    }
    const popup = script.match(/\.useEffect\((function\(\)\{[^{}]*\.bingeWatching[^{}]*\}),\[([^\]]+)\]\)/);
    assert.ok(popup, 'Locate the actual countdown effect');
    assert.ok(popup[2].includes(`${setting}.bingeWatching`));
    const videoName = popup[1].match(/(\w+)\.state\.time/)[1];
    const dismissedName = popup[1].match(/!(\w+)\.current/)[1];
    const openName = popup[1].match(/NotificationDuration\?(\w+)\(\)/)[1];
    const closeName = popup[1].match(/:(\w+)\(\)\)\:/)[1];
    for (const autoplay of [true, false]) for (const dismissed of [true, false]) {
        const calls = [];
        const context = {
            [setting]: {bingeWatching: autoplay, nextVideoNotificationDuration: 30000},
            [core]: {nextVideo: {episode: 2}}, [dismissedName]: {current: dismissed},
            [videoName]: {state: {time: 90000, duration: 100000}},
            [openName]: () => calls.push('open'), [closeName]: () => calls.push('close')
        };
        vm.runInNewContext(`(${popup[1]})`, context)();
        assert.deepEqual(calls, [autoplay && !dismissed ? 'open' : 'close']);
    }
    const volume = script.match(/\.useCallback\((function\(([\w$]+)\)\{([\w$]+)\.setProp\("volume",Math\.min\(\2,Number\(([\w$]+)\.maxVolume\)\)\)\}),\[([^\]]*)\]\)/);
    assert.ok(volume, 'Locate actual patched volume callback');
    assert.equal(volume[5], `${volume[4]}.maxVolume`, 'Changing the setting must refresh the closure');
    // Model React useCallback reuse across distinct immutable storage objects.
    let savedDependency, callback;
    for (const maximum of [130, 225, 200, 100, 75, 175]) {
        const calls = [];
        const storage = {maxVolume: String(maximum)};
        if (savedDependency !== storage.maxVolume) {
            callback = vm.runInNewContext(`(${volume[1]})`, {
                [volume[3]]: {setProp: (name, value) => calls.push([name, value])}, [volume[4]]: storage
            });
            savedDependency = storage.maxVolume;
        }
        callback(225);
        assert.deepEqual(calls, [['volume', maximum]]);
    }
    const storageOriginal = original.match(/localStorage\.setItem\("localProfile",JSON\.stringify\(([\w$]+)\)\)/);
    const storagePatched = storageOriginal[0] + `,window.dispatchEvent(new CustomEvent("stremio-fork-volume-limit",{detail:Number(${storageOriginal[1]}.maxVolume)}))`;
    assert.ok(script.includes(storagePatched));
    for (const maximum of [75, 130, 225]) {
        const events = [], saved = [];
        vm.runInNewContext(storagePatched, {[storageOriginal[1]]: {maxVolume: String(maximum)},
            localStorage: {setItem: (...args) => saved.push(args)},
            CustomEvent: function(type, data) { this.type = type; this.detail = data.detail; },
            window: {dispatchEvent: event => events.push(event)}});
        assert.equal(JSON.parse(saved[0][1]).maxVolume, String(maximum));
        assert.equal(events[0].detail, maximum);
    }
    const binding = script.slice(Math.max(0, volume.index - 40), volume.index).match(/([\w$]+)=[\w$]+$/)[1];
    const keyboardPattern = /window\.removeEventListener\("wheel",[\w$]+\)\}\},\[([^\]]+)\]\)/;
    const patchedKeyboard = script.match(keyboardPattern);
    assert.ok(patchedKeyboard[1].endsWith(',' + binding), 'Keyboard and wheel refresh with the new volume callback');
    // Only five targeted replacements and the marker change the upstream bundle.
    const originalTarget = original.match(/\.useCallback\((function\(\)\{[^{}]*window\.history\.back\(\)[^{}]*\}),\[([^\]]+)\]\)/);
    const originalPopup = original.match(/\.useEffect\((function\(\)\{[^{}]*\.bingeWatching[^{}]*\}),\[([^\]]+)\]\)/);
    const originalVolume = original.match(/\.useCallback\(function\([\w$]+\)\{[\w$]+\.setProp\("volume",Math\.min\([\w$]+,Number\([\w$]+\.maxVolume\)\)\)\},\[\]\)/);
    assert.equal(script.replace(target[0], originalTarget[0]).replace(popup[0], originalPopup[0])
        .replace(volume[0], originalVolume[0]).replace(storagePatched, storageOriginal[0])
        .replace(patchedKeyboard[0], original.match(keyboardPattern)[0])
        .replace('\n;window.__stremioForkAutoplayPatched=true;window.__stremioForkVolumePatched=true;/* StremioForkPlayerCompatibility */', ''), original);
});
