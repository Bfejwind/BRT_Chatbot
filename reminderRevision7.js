// Preserve approved v6 templates and any in-flight reminder checkpoints.
const previous = require('./reminderRevision6');
const definitions = structuredClone(previous.definitions);
const english = definitions[0];
english.name = 'tea_session_reminder_full_en_v7';
english.components[0].text = english.components[0].text
    .replace(/🕰️[^]*?(?=Please note:)/, '🕰️ Please arrive 10–20 minutes before your session to allow time for registration and use of the restroom.\n\n')
    .replace('Please arrive 20 minutes early.\n\n', '')
    .replace('{{6}}', '{{1}}');
english.components[0].example.body_text = [['afternoon']];

function sequence(booking) {
    const payloads = previous.sequence(booking);
    const period = payloads[0].template.components[0].parameters.at(-1);
    payloads[0].template.name = english.name;
    payloads[0].template.components[0].parameters = [period];
    return payloads;
}
function preview(booking) {
    const payloads = sequence(booking);
    return definitions.slice(0, 2).map((definition, i) => definition.components[0].text.replace(/\{\{(\d+)\}\}/g,
        (_, n) => payloads[i].template.components[0].parameters[Number(n) - 1].text));
}
module.exports = { definitions, sequence, preview, ADDRESS: previous.ADDRESS, DIRECTIONS_PDF: previous.DIRECTIONS_PDF };
