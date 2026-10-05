# Package verification and booking routes

Run [migrations/002_customer_packages.sql](migrations/002_customer_packages.sql)
in the Supabase SQL editor before deploying. Existing service-role credentials
are used. Customer messages cannot create or activate packages; staff must verify
payment and maintain the records using Supabase's Table Editor or SQL editor.

Phone numbers must match incoming WhatsApp numbers (e.g. `6591234567`, no plus).
Add a package after staff verifies purchase:

```sql
insert into public.customer_packages
    (customer_phone, package_name, allowed_routes, expires_on)
values ('6591234567', 'Weekday package', array['weekday'], '2027-12-31');
```

Use `array['weekend']` for Friday–Sunday, `array['premium']` for Monday–Sunday,
or `array['weekday','weekend','premium']` if the purchased package allows all
three categories. Set `expires_on` to null for no expiry. Multiple active
packages combine their allowed categories. Expiry is inclusive in Singapore time.

Renew or disable a particular record using its UUID from the Table Editor:

```sql
update public.customer_packages
set expires_on = '2028-12-31', active = true
where id = 'REPLACE_WITH_PACKAGE_UUID';

update public.customer_packages set active = false
where id = 'REPLACE_WITH_PACKAGE_UUID';
```

The bot asks whether this is the first visit. First visits can choose public
(Monday–Thursday) or private (staff contact). Returning visitors are asked
whether they purchased a package. A Yes is verified against Supabase; valid
holders choose public/private, and public holders choose an allowed category.
Missing/expired packages lead to the purchase question. Purchasing goes to staff
and back to the main menu; declining allows Monday–Sunday public booking.
A database error routes verification to staff rather than treating it as No.

All new automatic sessions are **16:00–17:30 Singapore time**. Holidays and days
with no availability remain excluded, and the window remains three months.
Package entitlement is checked again at final reservation. Private sessions are
arranged by staff. Existing bookings and their reminders are left intact.

The flow diagram does not specify package credit deduction, prices, or private
session capacity. This implementation verifies access, not payment processing
or per-session package credits. First-visit status is customer supplied.
