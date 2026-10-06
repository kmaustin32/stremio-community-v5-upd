const test = require('node:test');
const assert = require('node:assert/strict');
const {patchServer} = require('../build/patch-server');
const fixture = 'before; ["-vsync", "cfr"]; ["-filter:a", "apad", "-async", 1]; after';
test('Migrate removed FFmpeg sync flags without changing unrelated server code', () => {
    const patched = patchServer(fixture);
    assert.equal(patched, 'before; ["-fps_mode:v", "cfr"]; ["-filter:a", "apad,aresample=async=1"]; after');
    assert.equal(patchServer(patched), patched);
});
test('Stop when an upstream update changes the expected server layout', () => {
    assert.throws(() => patchServer('unrecognized bundle'), /Unknown streaming server layout/);
    assert.throws(() => patchServer(fixture + fixture), /Unknown streaming server layout/);
});
