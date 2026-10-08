const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function fixture(rows, error) {
    const filters = [];
    const query = {
        select() { return this; },
        eq(key, value) {
            filters.push([key, value]);
            return this;
        },
        then(resolve) { return Promise.resolve({ data: rows, error }).then(resolve); }
    };
    const context = { module: { exports: {} }, require: () => ({ from: () => query }) };
    vm.runInNewContext(fs.readFileSync(`${__dirname}/../packageService.js`, "utf8"), context);
    return { ...context.module.exports, filters };
}
test("combines valid entitlements and excludes expired packages in Singapore time", async () => {
    const f = fixture([
        { allowed_routes: ["premium"], total_uses: 30, used_uses: 0, expires_on: "2026-10-04" },
        { allowed_routes: ["weekday"], total_uses: 5, used_uses: 0, expires_on: "2026-10-05" },
        { allowed_routes: ["weekend", "weekday"], total_uses: 5, used_uses: 0, expires_on: null }
    ]);
    const p = await f.getActivePackage("6591234567", new Date("2026-10-04T17:00:00Z"));
    assert.deepEqual(Array.from(p.allowed_routes), ["weekday", "weekend"]);
    assert.deepEqual(f.filters, [["customer_phone", "6591234567"], ["active", true]]);
});
test("missing packages return null and database errors remain distinguishable", async () => {
    assert.equal(await fixture([]).getActivePackage("customer"), null);
    const error = new Error("missing table");
    await assert.rejects(fixture(null, error).getActivePackage("customer"), e => e === error);
});

test("unlimited packages grant their own route without a credit limit", async () => {
    const f = fixture([{ package_type: 'unlimited', total_uses: null, used_uses: 0,
        expires_on: null, allowed_routes: ['weekday','weekend','exclusive','premium'] }]);
    assert.deepEqual(Array.from((await f.getActivePackage('customer')).allowed_routes),
        ['unlimited']);
    assert.equal(await fixture([{ total_uses: null, used_uses: 0, allowed_routes: ['weekday'] }]).getActivePackage('customer'), null);
});

test("empty packages do not grant booking access", async () => {
    const f = fixture([
        { allowed_routes: ["premium"], total_uses: 30, used_uses: 30, expires_on: null },
        { allowed_routes: ["exclusive"], total_uses: 10, used_uses: 9, expires_on: null }
    ]);
    assert.deepEqual(Array.from((await f.getActivePackage("customer")).allowed_routes), ["exclusive"]);
    assert.equal(await fixture([{ allowed_routes: ["weekday"], total_uses: 5, used_uses: 5 }]).getActivePackage("customer"), null);
});

test("database reservation enforces package validity through the session date", () => {
    const migration = fs.readFileSync(`${__dirname}/../migrations/004_booking_reliability.sql`, 'utf8');
    assert.match(migration, /expires_on >= p_booking_date/);
    assert.match(migration, /public.reserve_package_booking\(p_customer_phone/);
});
