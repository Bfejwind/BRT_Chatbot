const previous = require('./reminderRevision4');
const definitions = structuredClone(previous.definitions);
const icons = ['👕', '🥗', '👚', '🌸'];
for (let i = 0; i < 2; i++) {
    definitions[i].name = definitions[i].name.replace(/_v4$/, '_v5');
    let point = 0;
    definitions[i].components[0].text = definitions[i].components[0].text.replace(/^●/gm, () => icons[point++] + ' ');
}
function sequence(booking) {
    const payloads = previous.sequence(booking);
    for (let i = 0; i < 2; i++) payloads[i].template.name = definitions[i].name;
    return payloads;
}
function preview(booking) {
    const payloads = sequence(booking);
    return definitions.slice(0, 2).map((d, i) => d.components[0].text.replace(/\{\{(\d+)\}\}/g,
        (_, n) => payloads[i].template.components[0].parameters[Number(n) - 1].text));
}
module.exports = {definitions, sequence, preview, ADDRESS: previous.ADDRESS, DIRECTIONS_PDF: previous.DIRECTIONS_PDF};
