-- Extend public bookings to all three requested start times.
-- Preserve each installed function's remaining validation, locking and grants.
begin;
do $migration$
declare
    target record;
    definition text;
    old_guard text := 'p_booking_time <> time ''16:00''';
    new_guard text := 'p_booking_time not in (time ''12:00'', time ''14:00'', time ''16:00'')';
    inspected integer := 0;
begin
    for target in
        select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('reserve_booking_with_completion', 'reserve_package_booking')
    loop
        definition := pg_get_functiondef(target.oid);
        if position(old_guard in definition) > 0 then
            execute replace(definition, old_guard, new_guard);
        elsif position(new_guard in definition) = 0 then
            raise exception 'Unrecognized public booking time guard for %', target.oid::regprocedure;
        end if;
        inspected := inspected + 1;
    end loop;
    if inspected <> 2 then
        raise exception 'Expected exactly two public booking reservation functions, found %', inspected;
    end if;
end;
$migration$;
commit;
