const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('durable inbox migration: deduplication, FIFO claims, checkpoints, restart recovery and access control', async () => {
    const db = new PGlite();
    try {
        await db.exec('create role anon; create role authenticated; create role service_role;');
        await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/009_serverless_messages.sql'), 'utf8'));
        const enqueue = async events => (await db.query('select enqueue_bot_events($1::jsonb) as amount', [JSON.stringify(events)])).rows[0].amount;
        const event = (id, phone = '6591234567') => ({ id, customer_phone: phone, kind: 'message', payload: { id, type: 'text', text: { body: 'hello' } } });
        const claim = async () => (await db.query('select * from claim_bot_event()')).rows[0];
        const finish = async (job, state = { language: 'zh' }) => db.query(
            "select finish_bot_event($1,$2,'done',$3::jsonb,null)", [job.id, job.claim_token, JSON.stringify(state)]);
        const beginSend = async (job, ordinal, payload) => (await db.query('select begin_bot_send($1,$2,$3,$4::jsonb) as result',
            [job.id, job.claim_token, ordinal, JSON.stringify(payload)])).rows[0].result;

        assert.equal(await enqueue([event('one'), event('two'), event('other', '6581234567')]), 3);
        assert.equal(await enqueue([event('one')]), 0);
        const first = await claim(); assert.equal(first.id, 'one');
        const other = await claim(); assert.equal(other.id, 'other');
        assert.equal(await claim(), undefined, 'same customer cannot run concurrently');
        await finish(other);
        const reply = { to: first.customer_phone, type: 'text', text: { body: 'reply' } };
        assert.equal((await beginSend(first, 0, reply)).status, 'ready');
        assert.equal((await beginSend(first, 0, reply)).status, 'unknown');
        await db.query("select finish_bot_send($1,$2,0,'accepted',$3::jsonb)", [first.id, first.claim_token, JSON.stringify({ data: { messages: [{ id: 'accepted' }] } })]);
        assert.equal((await beginSend(first, 0, reply)).response.data.messages[0].id, 'accepted');
        assert.equal((await beginSend(first, 0, { ...reply, type: 'image' })).status, 'mismatch');
        await assert.rejects(db.query("select finish_bot_send($1,gen_random_uuid(),0,'accepted','{}')", [first.id]), /CLAIM_LOST/);
        await finish(first);
        assert.equal((await db.query("select state from bot_conversations where customer_phone='6591234567'")).rows[0].state.language, 'zh');
        const second = await claim(); assert.equal(second.id, 'two');
        await db.query("update bot_inbox set claimed_at=now()-interval '150 seconds' where id=$1", [second.id]);
        const recovered = await claim(); assert.equal(recovered.id, 'two');
        assert.notEqual(recovered.claim_token, second.claim_token);
        await assert.rejects(finish(second), /CLAIM_LOST/);
        await beginSend(recovered, 0, reply);
        await db.query("update bot_inbox set claimed_at=now()-interval '150 seconds' where id=$1", [recovered.id]);
        assert.equal(await claim(), undefined, 'uncertain send must not be replayed');
        assert.equal((await db.query("select status from bot_inbox where id='two'")).rows[0].status, 'unknown');

        assert.equal((await db.query("select reserve_bot_send('6591234567') as wait")).rows[0].wait, 0);
        assert.ok((await db.query("select reserve_bot_send('6591234567') as wait")).rows[0].wait > 0);
        const clock = (await db.query("select ready_at from bot_send_clock where key='channel'")).rows[0].ready_at;
        await db.query("select reserve_bot_send('6591234567')");
        assert.equal((await db.query("select ready_at from bot_send_clock where key='channel'")).rows[0].ready_at.toISOString(), clock.toISOString(), 'recipient wait does not block the channel');
        await db.exec('set role anon');
        await assert.rejects(db.query('select * from bot_inbox'), /permission denied/);
        await assert.rejects(db.query('select * from claim_bot_event()'), /permission denied/);
        await db.exec('reset role');
        // Supabase-specific extensions are represented by isolated SQL facades.
        // Execute the generated cron SQL too, rather than only parsing its body.
        await db.exec(`
            create schema vault; create schema cron; create schema net;
            create table vault.secrets(id uuid default gen_random_uuid(),name text,secret text);
            create view vault.decrypted_secrets as select name,secret as decrypted_secret from vault.secrets;
            create function vault.create_secret(value text,label text) returns uuid language sql as
                'insert into vault.secrets(name,secret) values(label,value) returning id';
            create function vault.update_secret(key uuid,value text) returns void language sql as
                'update vault.secrets set secret=value where id=key';
            create table cron.job(jobid bigint generated always as identity,jobname text,command text);
            create function cron.schedule(label text,schedule text,statement text) returns bigint language sql as
                'insert into cron.job(jobname,command) values(label,statement) returning jobid';
            create function cron.unschedule(key bigint) returns boolean language sql as
                'delete from cron.job where jobid=key returning true';
            create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint
                language sql as 'select 1::bigint';
        `);
        const recoverySql = fs.readFileSync(path.join(__dirname, '../migrations/010_serverless_recovery.sql'), 'utf8')
            .replace(/create extension[^;]+;/g, '');
        await db.exec(recoverySql);
        const workerUrl = 'https://ixjmzksmazysazlyoxne.supabase.co/functions/v1/whatsapp-bot/work';
        await db.query('select configure_bot_worker($1,$2)', [workerUrl, 'isolated-worker-secret-for-test']);
        await db.query('select configure_bot_worker($1,$2)', [workerUrl, 'isolated-worker-secret-for-test']);
        const schedules = (await db.query('select command from cron.job')).rows;
        assert.equal(schedules.length, 1, 'preparation is idempotent');
        await enqueue([event('cron')]);
        assert.equal((await db.query(schedules[0].command)).rows.length, 1, 'generated cron SQL executes');
        await assert.rejects(db.query('select configure_bot_worker($1,$2)', ['https://attacker.test/work', 'isolated-worker-secret-for-test']), /INVALID_WORKER_CONFIG/);
    } finally { await db.close(); }
});
