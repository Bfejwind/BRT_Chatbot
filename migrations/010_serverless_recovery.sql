-- Install recovery scheduling support; /prepare configures the canonical worker
-- URL and stores its existing authentication secret in Supabase Vault.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create or replace function public.configure_bot_worker(p_url text,p_secret text)
returns boolean language plpgsql security definer set search_path=public as $function$
declare secret_id uuid; job_id bigint; command text;
begin
    if p_url !~ '^https://[a-z]{20}\.supabase\.co/functions/v1/whatsapp-bot/work$'
        or length(p_secret)<20 then raise exception 'INVALID_WORKER_CONFIG'; end if;
    select id into secret_id from vault.secrets where name='bot_serverless_worker_auth';
    if secret_id is null then perform vault.create_secret(p_secret,'bot_serverless_worker_auth');
    else perform vault.update_secret(secret_id,p_secret); end if;
    command:=format($cron$
        select net.http_post(
            url:=%L,
            headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',
                (select decrypted_secret from vault.decrypted_secrets where name='bot_serverless_worker_auth')),
            body:='{}'::jsonb,timeout_milliseconds:=5000
        ) where exists(select 1 from public.bot_inbox where status='queued'
            or (status='processing' and claimed_at<now()-interval '130 seconds'))
    $cron$,p_url);
    select jobid into job_id from cron.job where jobname='bot-serverless-inbox-recovery';
    if job_id is not null then perform cron.unschedule(job_id); end if;
    perform cron.schedule('bot-serverless-inbox-recovery','* * * * *',command);
    return true;
end;
$function$;
revoke all on function public.configure_bot_worker(text,text) from public,anon,authenticated;
grant execute on function public.configure_bot_worker(text,text) to service_role;
commit;
