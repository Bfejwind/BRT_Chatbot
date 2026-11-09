begin;
create table if not exists public.bot_conversations (
    customer_phone text primary key, state jsonb not null default '{}', updated_at timestamptz not null default now()
);
create table if not exists public.bot_inbox (
    id text primary key, customer_phone text not null, kind text not null check(kind in ('message','echo')),
    payload jsonb not null, status text not null default 'queued' check(status in ('queued','processing','done','unknown','failed')),
    attempts integer not null default 0, claim_token uuid, claimed_at timestamptz,
    available_at timestamptz not null default now(), received_at timestamptz not null default now(),
    sequence_id bigint generated always as identity unique, last_error text
);
create index if not exists bot_inbox_pending on public.bot_inbox(status,available_at,sequence_id);
create index if not exists bot_inbox_customer on public.bot_inbox(customer_phone,sequence_id);
create table if not exists public.bot_outbox (
    inbox_id text references public.bot_inbox(id) on delete cascade, ordinal integer,
    payload jsonb not null, status text not null check(status in ('sending','accepted','rejected')),
    response jsonb, updated_at timestamptz not null default now(), primary key(inbox_id,ordinal)
);
create table if not exists public.bot_send_clock (key text primary key, ready_at timestamptz not null);
alter table public.bot_conversations enable row level security;
alter table public.bot_inbox enable row level security;
alter table public.bot_outbox enable row level security;
alter table public.bot_send_clock enable row level security;
revoke all on public.bot_conversations,public.bot_inbox,public.bot_outbox,public.bot_send_clock from anon,authenticated;
grant all on public.bot_conversations,public.bot_inbox,public.bot_outbox,public.bot_send_clock to service_role;

create or replace function public.enqueue_bot_events(p_events jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare item jsonb; inserted integer:=0; amount integer;
begin
    if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>100 then raise exception 'INVALID_EVENTS'; end if;
    for item in select value from jsonb_array_elements(p_events) loop
        if length(item->>'id') not between 1 and 250 or (item->>'customer_phone') !~ '^[0-9]{7,15}$'
            or item->>'kind' not in ('message','echo') or jsonb_typeof(item->'payload')<>'object' then
            raise exception 'INVALID_EVENT';
        end if;
        insert into public.bot_inbox(id,customer_phone,kind,payload)
        values(item->>'id',item->>'customer_phone',item->>'kind',item->'payload') on conflict(id) do nothing;
        get diagnostics amount=row_count; inserted:=inserted+amount;
    end loop;
    return inserted;
end; $$;

create or replace function public.claim_bot_event() returns setof public.bot_inbox
language plpgsql security definer set search_path=public as $$
declare selected public.bot_inbox%rowtype;
begin
    -- Serialize short claims, not network work. Only one event per customer may run.
    perform pg_advisory_xact_lock(hashtextextended('bot-inbox-claim',0));
    update public.bot_inbox i set status=case when exists(
        select 1 from public.bot_outbox o where o.inbox_id=i.id and o.status in ('sending','accepted')
    ) then 'unknown' else 'queued' end, claim_token=null, last_error='EXPIRED_INVOCATION'
    where i.status='processing' and i.claimed_at<now()-interval '130 seconds';
    update public.bot_inbox set status='failed',last_error='ATTEMPT_LIMIT' where status='queued' and attempts>=5;
    select * into selected from public.bot_inbox i where i.status='queued' and i.available_at<=now()
        and not exists(select 1 from public.bot_inbox older where older.customer_phone=i.customer_phone
            and older.sequence_id<i.sequence_id and older.status in ('queued','processing'))
        and not exists(select 1 from public.bot_inbox busy where busy.customer_phone=i.customer_phone and busy.status='processing')
        order by sequence_id limit 1 for update skip locked;
    if not found then return; end if;
    return query update public.bot_inbox set status='processing',attempts=attempts+1,
        claim_token=gen_random_uuid(),claimed_at=now() where id=selected.id returning *;
end; $$;

create or replace function public.finish_bot_event(p_id text,p_token uuid,p_status text,p_state jsonb,p_error text)
returns boolean language plpgsql security definer set search_path=public as $$
declare phone text;
begin
    if p_status not in ('done','queued','unknown') then raise exception 'INVALID_STATUS'; end if;
    update public.bot_inbox set status=p_status,last_error=p_error,available_at=now()+interval '15 seconds',claim_token=null
        where id=p_id and claim_token=p_token and status='processing' returning customer_phone into phone;
    if not found then raise exception 'CLAIM_LOST'; end if;
    if p_state is not null then
        insert into public.bot_conversations(customer_phone,state) values(phone,p_state)
        on conflict(customer_phone) do update set state=excluded.state,updated_at=now();
    end if;
    return true;
end; $$;

create or replace function public.begin_bot_send(p_id text,p_token uuid,p_ordinal integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous public.bot_outbox%rowtype;
begin
    perform 1 from public.bot_inbox where id=p_id and claim_token=p_token and status='processing' for update;
    if not found then raise exception 'CLAIM_LOST'; end if;
    select * into previous from public.bot_outbox where inbox_id=p_id and ordinal=p_ordinal for update;
    if found then
        if previous.payload<>p_payload then return jsonb_build_object('status','mismatch'); end if;
        if previous.status='accepted' then return jsonb_build_object('status','accepted','response',previous.response); end if;
        if previous.status='sending' then return jsonb_build_object('status','unknown'); end if;
    end if;
    insert into public.bot_outbox(inbox_id,ordinal,payload,status) values(p_id,p_ordinal,p_payload,'sending')
        on conflict(inbox_id,ordinal) do update set status='sending',updated_at=now();
    return jsonb_build_object('status','ready');
end; $$;

create or replace function public.finish_bot_send(p_id text,p_token uuid,p_ordinal integer,p_status text,p_response jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
begin
    perform 1 from public.bot_inbox where id=p_id and claim_token=p_token and status='processing' for update;
    if not found then raise exception 'CLAIM_LOST'; end if;
    if p_status not in ('accepted','rejected') then raise exception 'INVALID_STATUS'; end if;
    update public.bot_outbox set status=p_status,response=p_response,updated_at=now()
        where inbox_id=p_id and ordinal=p_ordinal and status='sending';
    if not found then raise exception 'SEND_CLAIM_LOST'; end if;
    return true;
end; $$;

create or replace function public.reserve_bot_send(p_phone text) returns integer
language plpgsql security definer set search_path=public as $$
declare ready timestamptz;
begin
    perform pg_advisory_xact_lock(hashtextextended('bot-send-clock',0));
    select greatest(now(),max(ready_at)) into ready from public.bot_send_clock where key in ('channel',p_phone);
    -- A recipient waiting for its own limit must not reserve the whole channel.
    if ready>now() then return ceil(extract(epoch from ready-now())*1000)::integer; end if;
    insert into public.bot_send_clock(key,ready_at) values('channel',now()+interval '1.1 seconds'),(p_phone,now()+interval '6.5 seconds')
        on conflict(key) do update set ready_at=excluded.ready_at;
    delete from public.bot_send_clock where ready_at<now()-interval '1 hour';
    return 0;
end; $$;

revoke all on function public.enqueue_bot_events(jsonb),public.claim_bot_event(),public.finish_bot_event(text,uuid,text,jsonb,text),
    public.begin_bot_send(text,uuid,integer,jsonb),public.finish_bot_send(text,uuid,integer,text,jsonb),public.reserve_bot_send(text)
    from public,anon,authenticated;
grant execute on function public.enqueue_bot_events(jsonb),public.claim_bot_event(),public.finish_bot_event(text,uuid,text,jsonb,text),
    public.begin_bot_send(text,uuid,integer,jsonb),public.finish_bot_send(text,uuid,integer,text,jsonb),public.reserve_bot_send(text)
    to service_role;
commit;
