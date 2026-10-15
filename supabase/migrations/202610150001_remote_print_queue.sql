create extension if not exists pgcrypto;
create table if not exists public.family_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null default 'member' check(role in ('admin','member')),
 created_at timestamptz not null default now()
);
alter table public.family_members enable row level security;
create or replace function public.is_family_member() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.family_members where user_id=auth.uid()); $$;
create or replace function public.is_family_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.family_members where user_id=auth.uid() and role='admin'); $$;
revoke all on function public.is_family_member() from public;
revoke all on function public.is_family_admin() from public;
grant execute on function public.is_family_member() to authenticated;
grant execute on function public.is_family_admin() to authenticated;
create table if not exists public.print_library (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 name text not null check(char_length(name) between 1 and 120),
 notes text not null default '' check(char_length(notes)<=1000),
 file_name text not null,
 file_path text not null unique,
 file_size bigint not null check(file_size>0 and file_size<=104857600),
 tested_printer text not null default 'not-tested',
 tested boolean not null default false,
 created_at timestamptz not null default now(),
 check(file_name ~* '\\.(3mf|gcode)$')
);
alter table public.print_library enable row level security;
create policy "family read library" on public.print_library for select to authenticated using(public.is_family_member());
create policy "family add library" on public.print_library for insert to authenticated with check(public.is_family_member() and owner_id=auth.uid());
create policy "family update library" on public.print_library for update to authenticated using(public.is_family_member() and (owner_id=auth.uid() or public.is_family_admin())) with check(public.is_family_member() and (owner_id=auth.uid() or public.is_family_admin()));
create policy "family delete library" on public.print_library for delete to authenticated using(public.is_family_member() and (owner_id=auth.uid() or public.is_family_admin()));
create table if not exists public.print_jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 print_id uuid not null references public.print_library(id) on delete restrict,
 target_printer text not null default 'any' check(target_printer in ('any','1','2')),
 status text not null default 'queued' check(status in ('queued','claimed','uploading','printing','completed','failed','cancelled','blocked')),
 priority integer not null default 0 check(priority between 0 and 10),
 idempotency_key uuid not null default gen_random_uuid() unique,
 claimed_by text, claimed_at timestamptz, started_at timestamptz, finished_at timestamptz, error_message text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists print_jobs_queue_idx on public.print_jobs(status,priority desc,created_at asc);
alter table public.print_jobs enable row level security;
create policy "family read jobs" on public.print_jobs for select to authenticated using(public.is_family_member());
create policy "family add tested jobs" on public.print_jobs for insert to authenticated with check(public.is_family_member() and owner_id=auth.uid() and status='queued' and exists(select 1 from public.print_library p where p.id=print_id and p.tested=true));
create policy "family cancel own queued jobs" on public.print_jobs for update to authenticated using(public.is_family_member() and status='queued' and owner_id=auth.uid()) with check(public.is_family_member() and owner_id=auth.uid() and status='cancelled');
create policy "family delete own queued jobs" on public.print_jobs for delete to authenticated using(public.is_family_member() and owner_id=auth.uid() and status='queued');
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists print_jobs_touch_updated_at on public.print_jobs;
create trigger print_jobs_touch_updated_at before update on public.print_jobs for each row execute function public.touch_updated_at();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('print-files','print-files',false,104857600,array['application/octet-stream','application/vnd.ms-package.3dmanufacturing-3dmodel+xml']) on conflict(id) do update set public=false,file_size_limit=104857600;
create policy "family read files" on storage.objects for select to authenticated using(bucket_id='print-files' and public.is_family_member());
create policy "family upload own folder" on storage.objects for insert to authenticated with check(bucket_id='print-files' and public.is_family_member() and (storage.foldername(name))[1]=auth.uid()::text);
create policy "family update own folder" on storage.objects for update to authenticated using(bucket_id='print-files' and public.is_family_member() and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='print-files' and public.is_family_member() and (storage.foldername(name))[1]=auth.uid()::text);
create policy "family delete files" on storage.objects for delete to authenticated using(bucket_id='print-files' and public.is_family_member() and ((storage.foldername(name))[1]=auth.uid()::text or public.is_family_admin()));
-- After inviting your account, make yourself admin:
-- insert into public.family_members(user_id,role) select id,'admin' from auth.users where email='YOUR_EMAIL';
