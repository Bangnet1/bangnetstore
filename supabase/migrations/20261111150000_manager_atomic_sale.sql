-- Atomic Manager sale creation.
-- This migration is intentionally staged in Git only; do not apply to production
-- until reviewed and tested against a non-production environment.

create or replace function public.manager_create_sale_atomic(
  p_sale jsonb,
  p_item jsonb,
  p_payment jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_sale_id uuid;
  v_customer_id uuid;
  v_product_template_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_unit_cost numeric;
  v_discount numeric;
  v_subtotal numeric;
  v_total numeric;
  v_paid numeric := 0;
  v_payment_method text;
  v_invoice_number text;
  v_sale_status text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_sale is null or p_item is null then
    raise exception 'Sale and item payloads are required' using errcode = '22023';
  end if;

  v_customer_id := nullif(p_sale->>'customer_id', '')::uuid;
  v_product_template_id := nullif(p_item->>'product_template_id', '')::uuid;
  v_invoice_number := nullif(btrim(p_sale->>'invoice_number'), '');
  v_quantity := (p_item->>'quantity')::numeric;
  v_unit_price := (p_item->>'unit_price')::numeric;
  v_unit_cost := (p_item->>'unit_cost')::numeric;
  v_discount := coalesce((p_item->>'line_discount')::numeric, 0);
  v_subtotal := v_quantity * v_unit_price;
  v_total := v_subtotal - v_discount;

  if v_customer_id is null or v_product_template_id is null then
    raise exception 'Customer and catalog product are required' using errcode = '22023';
  end if;
  if v_invoice_number is null or length(v_invoice_number) > 80 then
    raise exception 'Invalid invoice number' using errcode = '22023';
  end if;
  if v_quantity is null or v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
    raise exception 'Quantity must be a positive whole number' using errcode = '22023';
  end if;
  if v_unit_price is null or v_unit_price < 0 or v_unit_cost is null or v_unit_cost < 0 then
    raise exception 'Invalid unit price or cost' using errcode = '22023';
  end if;
  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'Invalid discount' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.manager_customers c
    where c.id = v_customer_id and c.user_id = v_user_id
  ) then
    raise exception 'Customer not found or access denied' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.manager_product_templates p
    where p.id = v_product_template_id
      and p.user_id = v_user_id
      and p.is_active = true
      and p.stock_status <> 'out_of_stock'
  ) then
    raise exception 'Catalog product unavailable or access denied' using errcode = '22023';
  end if;

  if p_payment is not null then
    v_paid := (p_payment->>'amount')::numeric;
    v_payment_method := coalesce(nullif(p_payment->>'method', ''), 'cash');
    if v_paid is null or v_paid <= 0 or v_paid > v_total then
      raise exception 'Invalid payment amount' using errcode = '22023';
    end if;
  end if;

  v_sale_status := case
    when v_paid >= v_total and v_total > 0 then 'paid'
    when v_paid > 0 then 'partially_paid'
    else 'confirmed'
  end;

  insert into public.manager_sales (
    user_id, customer_id, invoice_number, status,
    subtotal, discount, total, notes
  ) values (
    v_user_id, v_customer_id, v_invoice_number, v_sale_status,
    v_subtotal, v_discount, v_total, nullif(p_sale->>'notes', '')
  )
  returning id into v_sale_id;

  insert into public.manager_sale_items (
    user_id, sale_id, product_template_id, product_name, variant,
    quantity, unit_cost, unit_price, line_discount
  ) values (
    v_user_id, v_sale_id, v_product_template_id,
    coalesce(nullif(btrim(p_item->>'product_name'), ''), 'Produk'),
    nullif(p_item->>'variant', ''),
    v_quantity, v_unit_cost, v_unit_price, v_discount
  );

  if p_payment is not null then
    insert into public.manager_payments (
      user_id, sale_id, amount, method, status
    ) values (
      v_user_id, v_sale_id, v_paid, v_payment_method, 'completed'
    );
  end if;

  return v_sale_id;
end;
$$;

revoke all on function public.manager_create_sale_atomic(jsonb, jsonb, jsonb) from public;
revoke all on function public.manager_create_sale_atomic(jsonb, jsonb, jsonb) from anon;
grant execute on function public.manager_create_sale_atomic(jsonb, jsonb, jsonb) to authenticated;
