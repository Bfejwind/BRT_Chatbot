// New names preserve approved v5 templates and in-flight reminder checkpoints.
const previous = require('./reminderRevision5');
const definitions = ['en', 'zh'].map(language => {
    const definition = structuredClone(require(`./templates/drafts/tea_session_reminder_full_${language}_v5.json`));
    definition.name = definition.name.replace(/_v5$/, '_v6');
    return definition;
});
definitions.push(structuredClone(previous.definitions[2]));
function sequence(booking) {
    const payloads = previous.sequence(booking);
    for (let i = 0; i < 2; i++) payloads[i].template.name = definitions[i].name;
    return payloads;
}
function preview(booking) {
    const payloads = sequence(booking);
    return definitions.slice(0, 2).map((definition, i) => definition.components[0].text.replace(/\{\{(\d+)\}\}/g,
        (_, n) => payloads[i].template.components[0].parameters[Number(n) - 1].text));
}
module.exports = { definitions, sequence, preview, ADDRESS: previous.ADDRESS, DIRECTIONS_PDF: previous.DIRECTIONS_PDF };
