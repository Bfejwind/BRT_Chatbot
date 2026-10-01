-- Run once in the Supabase SQL editor before enabling the reminder worker.
-- IDs are stored as text to work with the existing booking/session ID types.
create table if not exists public.booking_reminders (
    booking_id text not null,
    session_id text not null,
    booking_date date not null,
    booking_time time not null,
    status text not null check (status in ('sending', 'accepted', 'failed', 'unknown', 'skipped')),
    claim_token uuid not null default gen_random_uuid(),
    attempts integer not null default 1,
    whatsapp_message_id text,
    last_error text,
    next_attempt_at timestamptz,
    updated_at timestamptz not null default now(),
    primary key (booking_id, session_id, booking_date, booking_time)
);

alter table public.booking_reminders enable row level security;
revoke all on public.booking_reminders from anon, authenticated;
grant all on public.booking_reminders to service_role;

-- A persistent atomic claim protects against concurrent server instances.
-- Never automatically reclaim 'sending' or 'unknown': Meta may have accepted it.
create or replace function public.claim_booking_reminder()
returns table (
    booking_id text, session_id text, booking_date date,
    booking_time time, claim_token uuid
)
language sql
security definer
set search_path = public
as $$
    insert into public.booking_reminders as r
        (booking_id, session_id, booking_date, booking_time, status)
    select b.id::text, s.id::text, s.booking_date, s.booking_time, 'sending'
    from public.booking_requests b
    join public.booking_sessions s on s.id = b.session_id
    where b.status = 'approved'
      and s.calendar_sync_status = 'synced'
      and s.calendar_event_id is not null
      and s.booking_date = (now() at time zone 'Asia/Singapore')::date + 1
      and ((s.booking_date + s.booking_time) at time zone 'Asia/Singapore')
          <= now() + interval '24 hours'
      and not exists (
          select 1 from public.booking_reminders existing
          where existing.booking_id = b.id::text
            and existing.session_id = s.id::text
            and existing.booking_date = s.booking_date
            and existing.booking_time = s.booking_time
            and not (existing.status = 'failed' and existing.attempts < 3
                and existing.next_attempt_at <= now())
      )
    order by s.booking_date, s.booking_time, b.id
    limit 1
    on conflict (booking_id, session_id, booking_date, booking_time)
    do update set status = 'sending', claim_token = gen_random_uuid(),
        attempts = r.attempts + 1, updated_at = now(), next_attempt_at = null
    where r.status = 'failed' and r.attempts < 3 and r.next_attempt_at <= now()
    returning r.booking_id, r.session_id, r.booking_date, r.booking_time, r.claim_token;
$$;

revoke all on function public.claim_booking_reminder() from public, anon, authenticated;
grant execute on function public.claim_booking_reminder() to service_role;
