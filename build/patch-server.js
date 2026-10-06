// Migrate the pinned server's removed video flag and legacy audio sync flag.
const fs = require('node:fs');

function patchServer(source) {
    for (const [before, after] of [
        ['"-vsync", "cfr"', '"-fps_mode:v", "cfr"'],
        ['"-filter:a", "apad", "-async", 1', '"-filter:a", "apad,aresample=async=1"']
    ]) {
        const oldCount = source.split(before).length - 1;
        const newCount = source.split(after).length - 1;
        if (oldCount === 1 && newCount === 0) source = source.replace(before, after);
        else if (oldCount !== 0 || newCount !== 1)
            throw new Error(`Unknown streaming server layout for ${before}; review FFmpeg compatibility before building`);
    }
    return source;
}

if (require.main === module) {
    const file = process.argv[2];
    if (!file) throw new Error('Usage: node build/patch-server.js <server.js>');
    fs.writeFileSync(file, patchServer(fs.readFileSync(file, 'utf8')));
}
module.exports = {patchServer};
