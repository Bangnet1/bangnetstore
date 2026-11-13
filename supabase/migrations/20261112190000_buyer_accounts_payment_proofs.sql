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

-- Do not allow direct client INSERT: clients must use the validated RPC below.
drop policy if exists "Buyers can submit own website orders" on public.sales_orders;

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


-- Server-side checkout: prices and totals are always taken from public.products.
-- SECURITY DEFINER is required because direct client INSERT is intentionally disabled.
-- The function performs explicit identity, input, product, stock and total validation.
create or replace function public.create_buyer_order(
  p_order_items jsonb,
  p_customer_contact text,
  p_payment_proof_path text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_item jsonb;
  v_product_id bigint;
  v_quantity integer;
  v_product_name text;
  v_price bigint;
  v_stock integer;
  v_items jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_subtotal bigint;
  v_order_id bigint;
begin
  if v_user_id is null or v_email is null then
    raise exception 'Silakan masuk menggunakan akun pembeli terlebih dahulu.';
  end if;
  if p_order_items is null
     or jsonb_typeof(p_order_items) is distinct from 'array'
     or jsonb_array_length(p_order_items) < 1
     or jsonb_array_length(p_order_items) > 100 then
    raise exception 'Rincian produk tidak valid.';
  end if;
  if p_customer_contact is null
     or length(trim(p_customer_contact)) < 8
     or length(trim(p_customer_contact)) > 20
     or p_customer_contact !~ '^62[0-9]{8,16}$' then
    raise exception 'Nomor WhatsApp tidak valid.';
  end if;
  if p_payment_proof_path is null
     or p_payment_proof_path !~ ('^orders/' || v_user_id::text || '/[A-Za-z0-9-]+[.]([jJ][pP][gG]|[jJ][pP][eE][gG]|[pP][nN][gG]|[wW][eE][bB][pP])$') then
    raise exception 'Lokasi bukti pembayaran tidak valid.';
  end if;

  for v_item in select value from jsonb_array_elements(p_order_items)
  loop
    if coalesce(v_item->>'product_id','') !~ '^[0-9]+$'
       or coalesce(v_item->>'quantity','') !~ '^[0-9]+$' then
      raise exception 'ID produk atau jumlah tidak valid.';
    end if;
    v_product_id := (v_item->>'product_id')::bigint;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity < 1 or v_quantity > 100 then
      raise exception 'Jumlah produk tidak valid.';
    end if;

    select name, price, stock
      into v_product_name, v_price, v_stock
      from public.products
      where id = v_product_id and archived = false
      for share;

    if not found then
      raise exception 'Produk tidak ditemukan atau sudah tidak aktif.';
    end if;
    if v_stock < v_quantity then
      raise exception 'Stok produk "%" tidak mencukupi.', v_product_name;
    end if;
    if v_price < 0 or v_price > 90000000000000 then
      raise exception 'Harga produk tidak valid atau melebihi batas transaksi.';
    end if;

    -- Bound the unit price before bigint multiplication to prevent overflow.
    v_subtotal := v_price * v_quantity;
    if v_total > 9000000000000000 - v_subtotal then
      raise exception 'Total pesanan terlalu besar.';
    end if;
    v_total := v_total + v_subtotal;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'product_name', v_product_name,
      'quantity', v_quantity,
      'unit_price', v_price,
      'subtotal', v_subtotal
    ));
  end loop;

  insert into public.sales_orders (
    customer_user_id, customer_email, customer_name, customer_contact,
    order_items, total_amount, status, source, payment_proof_path
  ) values (
    v_user_id, v_email, v_email, trim(p_customer_contact),
    v_items, v_total, 'menunggu_pembayaran', 'checkout_website', p_payment_proof_path
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.create_buyer_order(jsonb, text, text) from public, anon;
grant execute on function public.create_buyer_order(jsonb, text, text) to authenticated;
