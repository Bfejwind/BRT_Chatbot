-- Run after 004_booking_reliability.sql before assigning Unlimited packages.
begin;
alter table public.customer_packages alter column total_uses drop not null;
alter table public.customer_packages drop constraint customer_packages_uses_check;
alter table public.customer_packages add constraint customer_packages_uses_check check (
    (package_type = 'unlimited' and total_uses is null and used_uses = 0 and expires_on is null)
    or (package_type in ('weekday','weekend','exclusive','premium') and total_uses is not null
        and used_uses >= 0 and used_uses <= total_uses and total_uses =
        case package_type when 'weekday' then 5 when 'weekend' then 5
        when 'exclusive' then 10 when 'premium' then 30 else -1 end)
);
-- Keep the existing public booking categories. Unlimited is staff-assigned only.
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
        and p_booking_route = any(allowed_routes) and (total_uses is null or used_uses < total_uses)
        order by expires_on asc nulls last, created_at, id
        limit 1 for update;
    if not found then raise exception 'PACKAGE_NO_USES'; end if;
    reserved_id := public.reserve_booking(p_customer_phone, p_booking_date, p_booking_time, p_party_size)::text;
    if reserved_id is null then raise exception 'PACKAGE_RESERVATION_FAILED'; end if;
    update public.customer_packages set used_uses = used_uses + 1 where id = selected_package.id and total_uses is not null;
    insert into public.package_booking_redemptions
        (request_id, customer_phone, package_id, booking_id, booking_date, booking_time, party_size, booking_route)
        values (p_request_id, p_customer_phone, selected_package.id, reserved_id,
            p_booking_date, p_booking_time, p_party_size, p_booking_route);
    return reserved_id;
end;
$$;
revoke all on function public.reserve_package_booking(text,date,time,integer,text,uuid) from public, anon, authenticated;
grant execute on function public.reserve_package_booking(text,date,time,integer,text,uuid) to service_role;


commit;
