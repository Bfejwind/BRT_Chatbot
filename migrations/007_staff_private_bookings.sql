-- Run after 006. Private sessions do not change public booking availability rules.
begin;
create table if not exists public.staff_private_bookings (
    id uuid primary key,
    customer_phone text not null check (customer_phone ~ '^[0-9]{7,15}$'),
    booking_date date not null,
    booking_time time not null,
    party_size integer not null check (party_size between 1 and 10),
    status text not null default 'approved' check (status in ('approved','cancelled')),
    reminder_consent boolean not null check (reminder_consent),
    package_id uuid references public.customer_packages(id),
    package_debited boolean not null default false,
    created_by text not null,
    calendar_event_id text,
    calendar_sync_status text not null default 'pending' check (calendar_sync_status in ('pending','synced')),
    calendar_error text,
    created_at timestamptz not null default now()
);
alter table public.staff_private_bookings enable row level security;
revoke all on public.staff_private_bookings from anon, authenticated;
grant all on public.staff_private_bookings to service_role;

create or replace function public.create_staff_private_booking(
    p_id uuid, p_customer_phone text, p_booking_date date, p_booking_time time,
    p_party_size integer, p_package_id uuid, p_created_by text, p_reminder_consent boolean
) returns setof public.staff_private_bookings
language plpgsql security definer set search_path=public as $$
declare previous public.staff_private_bookings%rowtype; selected public.customer_packages%rowtype;
begin
    perform pg_advisory_xact_lock(hashtextextended('private:' || p_id::text,0));
    select * into previous from public.staff_private_bookings where id=p_id;
    if found then
        if previous.customer_phone is distinct from p_customer_phone
            or previous.booking_date is distinct from p_booking_date
            or previous.booking_time is distinct from p_booking_time
            or previous.party_size is distinct from p_party_size
            or previous.package_id is distinct from p_package_id
            or previous.reminder_consent is distinct from p_reminder_consent then
            raise exception 'PRIVATE_REQUEST_MISMATCH';
        end if;
        return next previous; return;
    end if;
    if p_id is null or p_customer_phone is null or p_customer_phone !~ '^[0-9]{7,15}$'
        or p_reminder_consent is distinct from true or nullif(p_created_by,'') is null
        or p_booking_date is null or p_booking_time is null
        or p_booking_time >= time '22:30' or extract(second from p_booking_time) <> 0
        or p_party_size is null or p_party_size not between 1 and 10
        or ((p_booking_date+p_booking_time) at time zone 'Asia/Singapore') <= now() then
        raise exception 'INVALID_PRIVATE_BOOKING';
    end if;
    -- Serialize private reservations so staff cannot double-book overlapping slots.
    perform pg_advisory_xact_lock(hashtextextended('private-booking-calendar',0));
    if exists(select 1 from public.staff_private_bookings b where b.status='approved'
        and (b.booking_date+b.booking_time) < (p_booking_date+p_booking_time)+interval '90 minutes'
        and (b.booking_date+b.booking_time)+interval '90 minutes' > (p_booking_date+p_booking_time))
        or exists(select 1 from public.booking_sessions s where s.reserved_places>0
        and (s.booking_date+s.booking_time) < (p_booking_date+p_booking_time)+interval '90 minutes'
        and (s.booking_date+s.booking_time)+interval '90 minutes' > (p_booking_date+p_booking_time)) then
        raise exception 'PRIVATE_SESSION_CONFLICT';
    end if;
    if p_package_id is not null then
        select * into selected from public.customer_packages where id=p_package_id for update;
        if not found or selected.customer_phone<>p_customer_phone or not selected.active
            or (selected.expires_on is not null and selected.expires_on<p_booking_date)
            or (selected.total_uses is not null and selected.used_uses>=selected.total_uses)
            or selected.package_type not in ('exclusive','premium','unlimited') then
            raise exception 'PRIVATE_PACKAGE_UNAVAILABLE';
        end if;
        update public.customer_packages set used_uses=used_uses+1
            where id=p_package_id and total_uses is not null;
    end if;
    insert into public.staff_private_bookings(id,customer_phone,booking_date,booking_time,
        party_size,package_id,package_debited,created_by,reminder_consent)
    values(p_id,p_customer_phone,p_booking_date,p_booking_time,p_party_size,p_package_id,
        coalesce(selected.total_uses is not null,false),p_created_by,p_reminder_consent);
    return query select * from public.staff_private_bookings where id=p_id;
end; $$;

create or replace function public.cancel_staff_private_booking(p_id uuid)
returns setof public.staff_private_bookings language plpgsql security definer set search_path=public as $$
declare b public.staff_private_bookings%rowtype;
begin
    select * into b from public.staff_private_bookings where id=p_id for update;
    if not found then raise exception 'PRIVATE_NOT_FOUND'; end if;
    if b.status='approved' then
        if b.package_debited then
            update public.customer_packages set used_uses=greatest(0,used_uses-1) where id=b.package_id;
        end if;
        update public.staff_private_bookings set status='cancelled', package_debited=false,
            calendar_sync_status='pending',calendar_error=null where id=p_id;
    end if;
    return query select * from public.staff_private_bookings where id=p_id;
end; $$;

-- Same durable, at-most-once claim model as public booking reminders.
alter table public.booking_reminders add column if not exists delivery_parts jsonb not null default '{}'::jsonb;
create table if not exists public.staff_private_reminders (
    like public.booking_reminders including all
);
alter table public.staff_private_reminders enable row level security;
revoke all on public.staff_private_reminders from anon,authenticated;
grant all on public.staff_private_reminders to service_role;
create or replace function public.claim_staff_private_reminder()
returns table (booking_id text,session_id text,booking_date date,booking_time time,claim_token uuid,delivery_parts jsonb)
language sql security definer set search_path=public as $$
    insert into public.staff_private_reminders as r
        (booking_id,session_id,booking_date,booking_time,status)
    select b.id::text,b.id::text,b.booking_date,b.booking_time,'sending'
    from public.staff_private_bookings b
    where b.status='approved' and b.reminder_consent and b.calendar_sync_status='synced'
        and b.calendar_event_id is not null
        and b.booking_date=(now() at time zone 'Asia/Singapore')::date+1
        and ((b.booking_date+b.booking_time) at time zone 'Asia/Singapore')<=now()+interval '24 hours'
        and not exists(select 1 from public.staff_private_reminders e where e.booking_id=b.id::text
            and e.booking_date=b.booking_date and e.booking_time=b.booking_time
            and not(e.status='failed' and e.attempts<3 and e.next_attempt_at<=now()))
    order by b.booking_date,b.booking_time,b.id limit 1
    on conflict(booking_id,session_id,booking_date,booking_time) do update
        set status='sending',claim_token=gen_random_uuid(),attempts=r.attempts+1,
            updated_at=now(),next_attempt_at=null
        where r.status='failed' and r.attempts<3 and r.next_attempt_at<=now()
    returning r.booking_id,r.session_id,r.booking_date,r.booking_time,r.claim_token,r.delivery_parts;
$$;
revoke all on function public.create_staff_private_booking(uuid,text,date,time,integer,uuid,text,boolean),
    public.cancel_staff_private_booking(uuid),public.claim_staff_private_reminder() from public,anon,authenticated;
grant execute on function public.create_staff_private_booking(uuid,text,date,time,integer,uuid,text,boolean),
    public.cancel_staff_private_booking(uuid),public.claim_staff_private_reminder() to service_role;
commit;
