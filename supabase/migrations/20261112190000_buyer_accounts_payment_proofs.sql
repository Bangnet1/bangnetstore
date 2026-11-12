-- Buyer accounts and private payment-proof uploads.
-- Safe additive migration: existing sales_orders rows remain unchanged.
alter table public.sales_orders
  add column if not exists customer_user_id uuid references auth.users(id) on delete set null,
  add column if not exists customer_email text;

create index if not exists sales_orders_customer_user_id_created_at_idx
  on public.sales_orders (customer_user_id, created_at desc);

alter table public.sales_orders enable row level security;

drop policy if exists "Buyers can read own sales orders" on public.sales_orders;
create policy "Buyers can read own sales orders"
  on public.sales_orders
  for select
  to authenticated
  using ((select auth.uid()) = customer_user_id);

drop policy if exists "Buyers can submit own website orders" on public.sales_orders;
create policy "Buyers can submit own website orders"
  on public.sales_orders
  for insert
  to authenticated
  with check (
    (select auth.uid()) = customer_user_id
    and customer_email = (select auth.jwt() ->> 'email')
    and status = 'menunggu_pembayaran'
    and source = 'checkout_website'
    and jsonb_typeof(order_items) = 'array'
    and jsonb_array_length(order_items) between 1 and 100
    and total_amount >= 0
    and customer_contact is not null
    and length(trim(customer_contact)) between 8 and 20
    and payment_proof_path is not null
    and payment_proof_path like ('orders/' || (select auth.uid())::text || '/%')
  );

-- Buyers upload proof files only inside their own UID folder.
-- Keep existing admin read policy and legacy anon policy untouched.
drop policy if exists "Buyers upload own payment proofs" on storage.objects;
create policy "Buyers upload own payment proofs"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = 'orders'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  );

drop policy if exists "Buyers remove own orphaned payment proofs" on storage.objects;
create policy "Buyers remove own orphaned payment proofs"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = 'orders'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
