-- Dose Verde Pro v1.7 - archivio cloud personale
-- Eseguire nel SQL Editor del progetto Supabase.

create table if not exists public.dose_verde_products (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  payload jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create index if not exists dose_verde_products_user_id_idx
  on public.dose_verde_products (user_id);

alter table public.dose_verde_products enable row level security;

revoke all on table public.dose_verde_products from anon, authenticated;
grant select, insert, update, delete on table public.dose_verde_products to authenticated;

-- Re-runnable policies
drop policy if exists "dv_select_own_products" on public.dose_verde_products;
drop policy if exists "dv_insert_own_products" on public.dose_verde_products;
drop policy if exists "dv_update_own_products" on public.dose_verde_products;
drop policy if exists "dv_delete_own_products" on public.dose_verde_products;

create policy "dv_select_own_products"
on public.dose_verde_products for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "dv_insert_own_products"
on public.dose_verde_products for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "dv_update_own_products"
on public.dose_verde_products for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "dv_delete_own_products"
on public.dose_verde_products for delete
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

-- Bucket privato per PDF/allegati. Le foto compresse restano nel payload per mantenere l'uso offline semplice.
insert into storage.buckets (id, name, public)
values ('dose-verde-files', 'dose-verde-files', false)
on conflict (id) do update set public=false;

drop policy if exists "dv_storage_select" on storage.objects;
drop policy if exists "dv_storage_insert" on storage.objects;
drop policy if exists "dv_storage_update" on storage.objects;
drop policy if exists "dv_storage_delete" on storage.objects;

create policy "dv_storage_select"
on storage.objects for select
to authenticated
using (
  bucket_id='dose-verde-files'
  and (storage.foldername(name))[1]=(select auth.uid()::text)
);

create policy "dv_storage_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id='dose-verde-files'
  and (storage.foldername(name))[1]=(select auth.uid()::text)
);

create policy "dv_storage_update"
on storage.objects for update
to authenticated
using (
  bucket_id='dose-verde-files'
  and (storage.foldername(name))[1]=(select auth.uid()::text)
)
with check (
  bucket_id='dose-verde-files'
  and (storage.foldername(name))[1]=(select auth.uid()::text)
);

create policy "dv_storage_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id='dose-verde-files'
  and (storage.foldername(name))[1]=(select auth.uid()::text)
);
