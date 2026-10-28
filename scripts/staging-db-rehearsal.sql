-- STAGING ONLY. No external sends. Everything below rolls back.
begin;
set local role service_role;
do $$
declare d date:=(now() at time zone 'Asia/Singapore')::date+1;
 req uuid:=gen_random_uuid(); b text; again text; pkg uuid; private_pkg uuid;
 private_id uuid:=gen_random_uuid(); uses integer;
begin
 if exists(select 1 from public.booking_requests) or exists(select 1 from public.customer_packages) then
  raise exception 'Refuse rehearsal: expected empty staging fixture';
 end if;
 while extract(isodow from d)>4 loop d:=d+1; end loop;
 if public.claim_whatsapp_message('TEST-isolated-message',req)<>'claimed' then raise exception 'Claim failed'; end if;
 perform public.complete_whatsapp_message('TEST-isolated-message',req);
 if public.claim_whatsapp_message('TEST-isolated-message',gen_random_uuid())<>'completed' then raise exception 'Dedup failed'; end if;
 b:=public.reserve_booking_with_completion('6582064900',d,time '16:00',1,'first_public',req,'en');
 again:=public.reserve_booking_with_completion('6582064900',d,time '16:00',1,'first_public',req,'en');
 if b is distinct from again or (select count(*) from public.booking_requests)<>1 then raise exception 'Duplicate public reservation'; end if;
 if public.reject_booking(b::uuid) then raise exception 'Approved public cancellation unexpectedly supported'; end if;
 insert into public.customer_packages(customer_phone,package_name,package_type,total_uses,allowed_routes)
 values('6582064900','TEST weekday package','weekday',5,array['weekday']) returning id into pkg;
 req:=gen_random_uuid();
 b:=public.reserve_booking_with_completion('6582064900',d+7,time '16:00',1,'weekday',req,'zh');
 again:=public.reserve_booking_with_completion('6582064900',d+7,time '16:00',1,'weekday',req,'zh');
 select used_uses into uses from public.customer_packages where id=pkg;
 if b is distinct from again or uses<>1 then raise exception 'Package debit not idempotent'; end if;
 perform public.reject_booking(b::uuid);
 select used_uses into uses from public.customer_packages where id=pkg;
 if uses<>1 then raise exception 'Approved public cancellation changed package balance'; end if;
 insert into public.customer_packages(customer_phone,package_name,package_type,total_uses,allowed_routes)
 values('6582064900','TEST private package','exclusive',10,array['exclusive']) returning id into private_pkg;
 perform public.create_staff_private_booking(private_id,'6582064900',d,time '10:00',1,private_pkg,'TEST rehearsal',true);
 perform public.create_staff_private_booking(private_id,'6582064900',d,time '10:00',1,private_pkg,'TEST rehearsal',true);
 select used_uses into uses from public.customer_packages where id=private_pkg;
 if uses<>1 then raise exception 'Private debit not idempotent'; end if;
 perform public.cancel_staff_private_booking(private_id);
 perform public.cancel_staff_private_booking(private_id);
 select used_uses into uses from public.customer_packages where id=private_pkg;
 if uses<>0 then raise exception 'Private refund not idempotent'; end if;
end $$;
select 'PASS: dedup, public booking, package debit and private cancellation/refund; public approved cancellation unsupported; all rolled back' as rehearsal_result;
rollback;
