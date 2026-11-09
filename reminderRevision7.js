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
const chinese = definitions[1];
chinese.name = 'tea_session_reminder_full_zh_v7';
chinese.components[0].text = chinese.components[0].text
    .replace(/🕰️[^]*?(?=注意：)/, '🕰️ 请于茶荟开始前10–20分钟抵达，以便签到及使用洗手间。\n\n')
    .replace('请提前20分钟抵达。\n\n', '')
    .replace('{{6}}', '{{1}}');
chinese.components[0].example.body_text = [['下午']];

function sequence(booking) {
    const payloads = previous.sequence(booking);
    for (let i = 0; i < 2; i++) {
        const period = payloads[i].template.components[0].parameters.at(-1);
        payloads[i].template.name = definitions[i].name;
        payloads[i].template.components[0].parameters = [period];
    }
    return payloads;
}
function preview(booking) {
    const payloads = sequence(booking);
    return definitions.slice(0, 2).map((definition, i) => definition.components[0].text.replace(/\{\{(\d+)\}\}/g,
        (_, n) => payloads[i].template.components[0].parameters[Number(n) - 1].text));
}
module.exports = { definitions, sequence, preview, ADDRESS: previous.ADDRESS, DIRECTIONS_PDF: previous.DIRECTIONS_PDF };
