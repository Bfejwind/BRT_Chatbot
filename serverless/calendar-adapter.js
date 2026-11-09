// Small Calendar v3 facade: retains the existing calendarService logic without
// importing the entire googleapis catalogue into an Edge Function.
const { GoogleAuth } = require('google-auth-library');
function calendar({ auth }) {
    async function request(method, args) {
        const client = await auth.getClient();
        const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events`;
        const url = new URL(base + (args.eventId ? '/' + encodeURIComponent(args.eventId) : ''));
        for (const key of ['timeMin','timeMax','singleEvents','orderBy','maxResults','pageToken']) {
            if (args[key] !== undefined) url.searchParams.set(key, String(args[key]));
        }
        return client.request({ url: url.toString(), method, data: args.resource || args.requestBody, timeout: 20_000 });
    }
    return { events: {
        list: args => request('GET', args), get: args => request('GET', args),
        insert: args => request('POST', args), patch: args => request('PATCH', args), delete: args => request('DELETE', args)
    } };
}
module.exports = { google: { auth: { GoogleAuth }, calendar } };
