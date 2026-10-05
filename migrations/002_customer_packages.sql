-- Run in the Supabase SQL editor. Customer phone numbers use WhatsApp format
-- (country code followed by digits, without +, spaces or punctuation).
create table if not exists public.customer_packages (
    id uuid primary key default gen_random_uuid(),
    customer_phone text not null check (customer_phone ~ '^[0-9]{7,15}$'),
    package_name text not null,
    allowed_routes text[] not null default array['weekday']::text[]
        check (cardinality(allowed_routes) > 0 and
            allowed_routes <@ array['weekday', 'weekend', 'premium']::text[]),
    active boolean not null default true,
    expires_on date,
    created_at timestamptz not null default now()
);
create index if not exists customer_packages_phone_idx
    on public.customer_packages(customer_phone) where active;
alter table public.customer_packages enable row level security;
revoke all on public.customer_packages from anon, authenticated;
grant select, insert, update, delete on public.customer_packages to service_role;
