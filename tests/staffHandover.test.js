const test = require('node:test');
const assert = require('node:assert/strict');
const { createStaffHandover, HANDOVER_MS } = require('../staffHandover');
function echo(timestamp, customer = '6591234567') {
    return { field: 'smb_message_echoes', value: {
        metadata: { display_phone_number: '6580000000' },
        message_echoes: [{ id: 'reply', from: '6580000000', to: customer, timestamp: String(timestamp / 1000), type: 'text' }]
    } };
}
test('staff app reply pauses only its recipient for exactly an hour', () => {
    let time = 1_800_000_000_000;
    const handover = createStaffHandover({ now: () => time });
    handover.recordChange(echo(time));
    assert.equal(handover.isActive('6591234567'), true);
    assert.equal(handover.isActive('6597654321'), false);
    time += HANDOVER_MS;
    assert.equal(handover.isActive('6591234567'), false);
});
test('new staff replies extend the pause, duplicate and stale events do not', () => {
    let time = 1_800_000_000_000;
    const handover = createStaffHandover({ now: () => time });
    const first = echo(time);
    handover.recordChange(first);
    time += HANDOVER_MS / 2;
    handover.recordChange(echo(time));
    handover.recordChange(first);
    time += HANDOVER_MS / 2;
    assert.equal(handover.isActive('6591234567'), true);
    time += HANDOVER_MS / 2;
    handover.recordChange(first);
    assert.equal(handover.isActive('6591234567'), false);
});
test('customer messages, API delivery receipts and invalid echoes do not pause the bot', () => {
    const time = 1_800_000_000_000;
    const handover = createStaffHandover({ now: () => time });
    handover.recordChange({ field: 'messages', value: { messages: [{ from: '6591234567' }] } });
    const invalid = echo(time); invalid.value.message_echoes[0].from = '6591234567';
    handover.recordChange(invalid);
    handover.recordChange(echo(time + HANDOVER_MS));
    assert.equal(handover.isActive('6591234567'), false);
});
