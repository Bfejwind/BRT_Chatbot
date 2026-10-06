-- Run after migrations 001, 002 and 003. Existing validity is measured from created_at.
begin;
create or replace function public.set_package_validity() returns trigger
language plpgsql set search_path=public as $$
begin
    new.expires_on := case new.package_type
        when 'exclusive' then ((new.created_at at time zone 'Asia/Singapore')::date + interval '3 months')::date
        when 'premium' then ((new.created_at at time zone 'Asia/Singapore')::date + interval '6 months')::date
        else null end;
    return new;
end; $$;
drop trigger if exists customer_package_validity on public.customer_packages;
create trigger customer_package_validity before insert or update on public.customer_packages
for each row execute function public.set_package_validity();
update public.customer_packages set expires_on=expires_on;
create table if not exists public.booking_drafts (
    customer_phone text primary key, draft jsonb not null,
    updated_at timestamptz not null default now()
);
create table if not exists public.booking_completion_jobs (
    request_id uuid primary key, booking_id text not null unique,
    customer_phone text not null, route text not null, language text not null,
    details jsonb not null, stage text not null default 'calendar'
        check(stage in ('calendar','customer','staff','done')),
    customer_status text not null default 'pending' check(customer_status in ('pending','done','unknown')),
    staff_status text not null default 'pending' check(staff_status in ('pending','done','unknown')),
    status text not null default 'pending' check(status in ('pending','sending','unknown','done')),
    claim_token uuid, claimed_at timestamptz, attempts integer not null default 0,
    next_attempt_at timestamptz not null default now(), last_error text,
    updated_at timestamptz not null default now()
);
alter table public.booking_drafts enable row level security;
alter table public.booking_completion_jobs enable row level security;
revoke all on public.booking_drafts, public.booking_completion_jobs from anon, authenticated;
grant all on public.booking_drafts, public.booking_completion_jobs to service_role;
create or replace function public.reserve_package_booking(
    p_customer_phone text, p_booking_date date, p_booking_time time,
    p_party_size integer, p_booking_route text, p_request_id uuid
) returns text language plpgsql security definer set search_path = public as $$
declare
    selected_package public.customer_packages%rowtype;
    previous public.package_booking_redemptions%rowtype;
    reserved_id text;
    singapore_today date := (now() at time zone 'Asia/Singapore')::date;
begin
    -- Serialize retries of the same confirmation before checking its receipt.
    perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
    select * into previous from public.package_booking_redemptions where request_id = p_request_id;
    if found then
        if previous.customer_phone <> p_customer_phone or previous.booking_date <> p_booking_date
            or previous.booking_time <> p_booking_time or previous.party_size <> p_party_size
            or previous.booking_route <> p_booking_route then
            raise exception 'PACKAGE_REQUEST_MISMATCH';
        end if;
        return previous.booking_id;
    end if;
    if p_booking_time <> time '16:00' or p_booking_date <= singapore_today
        or p_booking_route not in ('weekday','weekend','exclusive','premium') then
        raise exception 'INVALID_PACKAGE_SESSION';
    end if;
    if (p_booking_route = 'weekday' and extract(isodow from p_booking_date) not between 1 and 4)
        or (p_booking_route = 'weekend' and extract(isodow from p_booking_date) not between 5 and 7) then
        raise exception 'INVALID_PACKAGE_DAY';
    end if;
    -- First-expiring valid package is consumed first. Locking prevents two
    -- confirmations from spending the same last use.
    select * into selected_package from public.customer_packages
        where customer_phone = p_customer_phone and active
        and (expires_on is null or expires_on >= p_booking_date)
        and p_booking_route = any(allowed_routes) and used_uses < total_uses
        order by expires_on asc nulls last, created_at, id
        limit 1 for update;
    if not found then raise exception 'PACKAGE_NO_USES'; end if;
    reserved_id := public.reserve_booking(p_customer_phone, p_booking_date, p_booking_time, p_party_size)::text;
    if reserved_id is null then raise exception 'PACKAGE_RESERVATION_FAILED'; end if;
    update public.customer_packages set used_uses = used_uses + 1 where id = selected_package.id;
    insert into public.package_booking_redemptions
        (request_id, customer_phone, package_id, booking_id, booking_date, booking_time, party_size, booking_route)
        values (p_request_id, p_customer_phone, selected_package.id, reserved_id,
            p_booking_date, p_booking_time, p_party_size, p_booking_route);
    return reserved_id;
end;
$$;
revoke all on function public.reserve_package_booking(text,date,time,integer,text,uuid) from public, anon, authenticated;
grant execute on function public.reserve_package_booking(text,date,time,integer,text,uuid) to service_role;

create or replace function public.reserve_booking_with_completion(
    p_customer_phone text, p_booking_date date, p_booking_time time,
    p_party_size integer, p_booking_route text, p_request_id uuid, p_language text
) returns text language plpgsql security definer set search_path=public as $$
declare previous public.booking_completion_jobs%rowtype; reserved text; details jsonb;
begin
    perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 1));
    details := jsonb_build_object('date',p_booking_date,'time',p_booking_time,'party_size',p_party_size);
    select * into previous from public.booking_completion_jobs where request_id=p_request_id;
    if found then
        if previous.customer_phone<>p_customer_phone or previous.route<>p_booking_route or previous.details<>details then
            raise exception 'BOOKING_REQUEST_MISMATCH';
        end if;
        return previous.booking_id;
    end if;
    if p_booking_time <> time '16:00' or p_party_size not between 1 and 10
        or p_booking_date <= (now() at time zone 'Asia/Singapore')::date
        or p_booking_date > ((now() at time zone 'Asia/Singapore')::date + interval '3 months')::date then
        raise exception 'INVALID_BOOKING_SESSION';
    end if;
    if p_booking_route in ('weekday','weekend','exclusive','premium') then
        reserved := public.reserve_package_booking(p_customer_phone,p_booking_date,p_booking_time,p_party_size,p_booking_route,p_request_id);
    elsif p_booking_route='first_public' and extract(isodow from p_booking_date) between 1 and 4 then
        reserved := public.reserve_booking(p_customer_phone,p_booking_date,p_booking_time,p_party_size)::text;
    else raise exception 'INVALID_BOOKING_ROUTE'; end if;
    if reserved is null then raise exception 'RESERVATION_FAILED'; end if;
    insert into public.booking_completion_jobs(request_id,booking_id,customer_phone,route,language,details)
        values(p_request_id,reserved,p_customer_phone,p_booking_route,p_language,details);
    update public.booking_drafts set draft=draft || jsonb_build_object('reserved_booking_id',reserved),updated_at=now()
        where customer_phone=p_customer_phone;
    return reserved;
end; $$;
revoke all on function public.reserve_booking_with_completion(text,date,time,integer,text,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_booking_with_completion(text,date,time,integer,text,uuid,text) to service_role;
create or replace function public.claim_booking_completion(p_request_id uuid default null)
returns setof public.booking_completion_jobs language plpgsql security definer set search_path=public as $$
declare selected uuid;
begin
    -- Calendar retries are safe; an interrupted message send needs manual review.
    update public.booking_completion_jobs set
        customer_status=case when stage='customer' then 'unknown' else customer_status end,
        staff_status=case when stage='staff' then 'unknown' else staff_status end,
        status=case when stage='calendar' or (stage='customer' and staff_status='pending')
            or (stage='staff' and customer_status='pending') then 'pending' else 'unknown' end,
        stage=case when stage='calendar' then 'calendar'
            when stage='customer' and staff_status='pending' then 'staff'
            when stage='staff' and customer_status='pending' then 'customer' else 'done' end,
        last_error='Worker interrupted; review ambiguous message delivery'
        where status='sending' and claimed_at<now()-interval '5 minutes';
    select request_id into selected from public.booking_completion_jobs
        where status='pending' and next_attempt_at<=now()
        and (p_request_id is null or request_id=p_request_id)
        order by next_attempt_at for update skip locked limit 1;
    if selected is null then return; end if;
    return query update public.booking_completion_jobs set status='sending',claim_token=gen_random_uuid(),
        claimed_at=now(),attempts=attempts+1,updated_at=now()
        where request_id=selected returning *;
end; $$;
revoke all on function public.claim_booking_completion(uuid) from public,anon,authenticated;
grant execute on function public.claim_booking_completion(uuid) to service_role;
commit;
