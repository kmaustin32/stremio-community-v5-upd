// Reproduce the original app's watching status and button extensions against
// the pinned official Discord SDK, keeping headers and the static library aligned.
const fs = require('node:fs');
const path = require('node:path');

function replaceOnce(source, before, after) {
    if (source.split(before).length !== 2) throw new Error('Unexpected Discord SDK layout; review the pinned dependency');
    return source.replace(before, after);
}

const root = process.argv[2];
if (!root) throw new Error('Usage: node build/patch-discord.js <discord source>');
const headerPath = path.join(root, 'include/discord_rpc.h');
const serializerPath = path.join(root, 'src/serialization.cpp');
let header = fs.readFileSync(headerPath, 'utf8');
header = replaceOnce(header, '    int8_t instance;', `    int8_t instance;
    int type;
    const char* button1Label;
    const char* button1Url;
    const char* button2Label;
    const char* button2Url;`);
header = replaceOnce(header, '#define DISCORD_REPLY_NO 0', '#define DISCORD_ACTIVITY_TYPE_WATCHING 3\n#define DISCORD_REPLY_NO 0');
let serializer = fs.readFileSync(serializerPath, 'utf8');
serializer = replaceOnce(serializer, '                WriteObject activity(writer, "activity");', `                WriteObject activity(writer, "activity");
                WriteKey(writer, "type");
                writer.Int(presence->type);
                if ((presence->button1Label && presence->button1Url) ||
                    (presence->button2Label && presence->button2Url)) {
                    WriteArray buttons(writer, "buttons");
                    if (presence->button1Label && presence->button1Url) {
                        WriteObject button(writer);
                        WriteOptionalString(writer, "label", presence->button1Label);
                        WriteOptionalString(writer, "url", presence->button1Url);
                    }
                    if (presence->button2Label && presence->button2Url) {
                        WriteObject button(writer);
                        WriteOptionalString(writer, "label", presence->button2Label);
                        WriteOptionalString(writer, "url", presence->button2Url);
                    }
                }`);
fs.writeFileSync(headerPath, header);
fs.writeFileSync(serializerPath, serializer);
