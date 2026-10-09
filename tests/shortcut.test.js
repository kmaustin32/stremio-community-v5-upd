const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/webview/webview.cpp', 'utf8');
const script = source.match(/INJECTED_KEYDOWN_SCRIPT = LR"JS\(([\s\S]*?)\)JS";/)[1];

function run(overrides = {}) {
    let handler;
    const messages = [];
    vm.runInNewContext(script, {window: {
        addEventListener: (_name, callback, capture) => { handler = callback; assert.equal(capture, true); },
        chrome: {webview: {postMessage: msg => messages.push(JSON.parse(msg))}}
    }});
    const event = {code: 'KeyB', ctrlKey: true, target: {tagName: 'DIV'},
        preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...overrides};
    handler(event);
    return {messages, event};
}

test('Ctrl+B invokes one native toggle', () => {
    const result = run();
    assert.equal(result.messages[0].args[0], 'toggle-border-blur');
    assert.equal(result.messages.length, 1);
    assert.equal(result.event.prevented, true);
});
test('Typing, modifiers, and key repeat cannot accidentally toggle blur', () => {
    for (const overrides of [{ctrlKey: false}, {altKey: true}, {shiftKey: true}, {repeat: true},
        {target: {tagName: 'INPUT'}}, {target: {tagName: 'TEXTAREA'}},
        {target: {isContentEditable: true}}]) assert.equal(run(overrides).messages.length, 0);
});
test('Existing F5 refresh continues to work', () => {
    assert.equal(run({code: 'F5'}).messages[0].args[0], 'refresh');
});
test('Ctrl+Shift+F cycles display mode once, independently of blur', () => {
    const result = run({code: 'KeyF', shiftKey: true});
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].args[0], 'cycle-display-mode');
    assert.equal(result.event.prevented, true);
    for (const overrides of [{ctrlKey: false}, {shiftKey: false}, {altKey: true}, {metaKey: true},
        {repeat: true}, {target: {tagName: 'INPUT'}}, {target: {isContentEditable: true}}])
        assert.equal(run({code: 'KeyF', shiftKey: true, ...overrides}).messages.length, 0);
});
