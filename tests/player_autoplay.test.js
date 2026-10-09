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
    // Everything except this callback and its dependency list stays byte-for-byte identical.
    const originalTarget = original.match(/\.useCallback\((function\(\)\{[^{}]*window\.history\.back\(\)[^{}]*\}),\[([^\]]+)\]\)/);
    assert.equal(script.replace(target[0], originalTarget[0]).replace('/* StremioForkAutoplayGuard */', ''), original);
});
