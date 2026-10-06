const HANDOVER_MS = 60 * 60 * 1000;

function createStaffHandover({ now = Date.now } = {}) {
    const quietUntil = new Map();
    const phone = value => String(value || '').replace(/[\s()+-]/g, '');
    function prune() {
        const time = now();
        for (const [customer, expiry] of quietUntil) {
            if (expiry <= time) quietUntil.delete(customer);
        }
    }
    function recordChange(change) {
        if (change.field !== 'smb_message_echoes') return [];
        prune();
        const business = phone(change.value?.metadata?.display_phone_number);
        const customers = [];
        for (const message of change.value?.message_echoes || []) {
            const customer = phone(message.to);
            const timestamp = Number(message.timestamp) * 1000;
            if (!message.id || !/^\d{7,15}$/.test(customer) || !business ||
                phone(message.from) !== business || customer === business ||
                !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now() + 60_000) continue;
            // Retries of an old echo must not extend the original handover.
            const expiry = timestamp + HANDOVER_MS;
            if (expiry <= now()) continue;
            quietUntil.set(customer, Math.max(quietUntil.get(customer) || 0, expiry));
            customers.push(customer);
        }
        return customers;
    }
    function isActive(customer) {
        prune();
        return (quietUntil.get(phone(customer)) || 0) > now();
    }
    return { recordChange, isActive };
}

module.exports = { createStaffHandover, HANDOVER_MS };
