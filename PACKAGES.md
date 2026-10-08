# Package verification and booking routes

## Staff website and package credits

Unlimited packages are assigned through the staff website. They have no expiry
or credit limit. Verified holders can select Unlimited in the chatbot to book
Monday–Sunday, 16:00–17:30 Singapore time. Run migrations
`005_unlimited_packages.sql` and `006_unlimited_booking_route.sql` after
migration 004 and deploy the updated bot before using these packages.
An Unlimited package stores `total_uses = null` and `used_uses = 0`; bookings keep
redemption receipts without deducting credits. Staff can remove it, but its
unlimited balance cannot be edited. Existing booking windows and capacity apply.

Use [Tea Space Package Desk](https://tea-space-package-desk.officiallyrichard.chatgpt.site)
to search a WhatsApp number, add a package,
view remaining uses, or remove a package from future bookings. Website source
is in `staff-packages/`. It is a private Site; share it only with authorized
staff using the Site's access controls.

Before using this version:

1. If not already done, run `migrations/002_customer_packages.sql` in Supabase.
2. Run `migrations/003_package_uses.sql` in the same project's SQL editor.
3. Open the website as its owner and click **Database connection**. Paste the
   values of `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the bot's `.env`, then
   click **Test & save**. The key is stored in the Site's server-only database,
   never returned by the website's API or stored in browser storage. Only the
   owner email configured in `CONFIG_ADMIN_EMAIL` can edit the connection.
   Other authorized staff can manage packages but cannot view or change the key.
   Keep the Site private. Saving takes effect immediately; no redeploy is needed.
4. Review existing package records. The migration gives weekday/weekend records
   5 uses and maps other legacy records to premium with 30 uses. If a record is
   actually exclusive, change `package_type` to `exclusive`, `allowed_routes`
   to `array['exclusive']`, and `total_uses` to 10 in one update. Enter historical
   uses in `used_uses` before going live; the migration cannot reconstruct them.
5. Deploy the updated chatbot and test a package booking. The website must show
   one fewer use after confirmation. Refresh to see the latest balance.

| Package | Starting uses | Days |
|---|---:|---|
| Weekday | 5 | Monday–Thursday |
| Weekend | 5 | Friday–Sunday |
| Exclusive | 10 | Monday–Sunday |
| Premium | 30 | Monday–Sunday |

Each confirmed booking consumes **one use**, regardless of party size. The bot
reserves places and records the debit in the same Supabase transaction through
`reserve_package_booking`. Failures in reservation roll back the debit. Repeated
requests for the same confirmation use a receipt key to avoid a second debit.
The package with the earliest expiry is used first. Removed, expired, and empty
packages cannot fund a booking. Ordinary bookings and reminder tests do not
spend package uses. A later Calendar or WhatsApp failure does not undo an already
approved reservation or refund its use; staff should reconcile that booking.
Cancellation does not automatically refund a use in this version.

Removing a package deactivates it and preserves its usage records. Staff can
view redemption history in `package_booking_redemptions` in Supabase.

Run [migrations/002_customer_packages.sql](migrations/002_customer_packages.sql)
in the Supabase SQL editor before deploying. Existing service-role credentials
are used. Customer messages cannot create or activate packages; staff must verify
payment and maintain the records using Supabase's Table Editor or SQL editor.

Phone numbers must match incoming WhatsApp numbers (e.g. `6591234567`, no plus).
Add a package after staff verifies purchase:

```sql
insert into public.customer_packages
    (customer_phone, package_name, package_type, allowed_routes, total_uses, expires_on)
values ('6591234567', 'Weekday package', 'weekday', array['weekday'], 5, null);
```

Use `array['weekend']` for Friday–Sunday, `array['premium']` for Monday–Sunday,
or `array['exclusive']` for an exclusive package. Set `package_type` and
`total_uses` according to the table above. Migration 004 calculates expiry automatically: Weekday/Weekend have no expiry; Exclusive expires three calendar months after creation, and Premium six calendar months. Multiple active
packages combine their allowed categories. Expiry is inclusive in Singapore time.

When a customer buys another package, add a new package through the website.
Do not extend an existing package by editing its expiry: validity is enforced from
`created_at`. For historical purchases, correct `created_at` to the purchase date.
Booking dates must be on or before the inclusive expiry date in Singapore time.

To disable a package:
```sql
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

This implementation tracks booking uses, but does not process payment or
automatically manage private-session capacity. First-visit status is customer supplied.

## Booking reliability and validity upgrade

Before deploying this version, run `migrations/004_booking_reliability.sql` in
Supabase after migrations 001?003. It creates persistent drafts and completion
jobs, and applies package validity rules to existing records using `created_at`.
Review historical purchase dates first. No expiry applies to Weekday/Weekend;
Exclusive uses 3 calendar months and Premium 6 calendar months. The global
booking window remains three months ahead.

Confirmed reservations and package deductions happen atomically with a recovery
job. The server resumes Calendar synchronization, customer confirmation and staff
notification every minute and on startup, without reserving again. Explicit API
rejections retry every minute. Ambiguous sends (`unknown`) require checking delivery
before resetting the job to `pending`; interrupted message sends also require
review. Calendar recovery is safe to retry because event IDs are deterministic.

Inspect `booking_completion_jobs` in Supabase for `last_error`, `stage` and
`status`. A `done` job means API acceptance, not proof of delivery. Ordinary staff
messages still require an active WhatsApp messaging window.
