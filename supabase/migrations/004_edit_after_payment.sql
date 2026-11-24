-- แก้ไขบิลหลังมีคนจ่ายแล้วได้ (เพิ่มคน เพิ่มรายการ) โดยยอดของคนที่จ่ายแล้วต้องเท่าเดิม
-- รันไฟล์นี้ใน Supabase SQL Editor หนึ่งครั้ง (หลังจาก 003)
create or replace function update_bill(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_bill uuid := (p->>'bill_id')::uuid;
  v_payer uuid;
  v_item uuid;
  it jsonb;
  sh jsonb;
  mid text;
  pos int := 0;
  has_paid boolean;
begin
  update bills set
    title        = p->>'title',
    bill_date    = (p->>'bill_date')::date,
    receipt_path = case when coalesce((p->>'set_receipt')::boolean, false) then nullif(p->>'receipt_path', '') else receipt_path end,
    qr_path      = case when coalesce((p->>'set_qr')::boolean, false) then nullif(p->>'qr_path', '') else qr_path end,
    updated_at   = now()
  where id = v_bill and status <> 'cancelled'
  returning payer_member_id into v_payer;
  if not found then raise exception 'bill_not_editable'; end if;

  if coalesce((p->>'financial')::boolean, false) then
    has_paid := exists (select 1 from bill_shares where bill_id = v_bill and paid_at is not null and member_id <> v_payer);
    if has_paid then
      -- มีคนจ่ายแล้ว: ห้ามเปลี่ยนผู้รับเงิน และยอดของคนที่จ่ายแล้วต้องเท่าเดิม
      if (p->>'payer_member_id')::uuid <> v_payer then raise exception 'bill_has_payments'; end if;
      if exists (
        select 1 from bill_shares s
         where s.bill_id = v_bill and s.paid_at is not null and s.member_id <> v_payer
           and not exists (
             select 1 from jsonb_array_elements(p->'shares') x
              where (x->>'member_id')::uuid = s.member_id and abs((x->>'amount')::numeric - s.amount) < 0.01)
      ) then raise exception 'bill_paid_share_changed'; end if;
    end if;

    update bills set
      payer_member_id = (p->>'payer_member_id')::uuid,
      promptpay_id    = nullif(p->>'promptpay_id', ''),
      service_pct     = coalesce((p->>'service_pct')::numeric, 0),
      discount        = coalesce((p->>'discount')::numeric, 0),
      total           = (p->>'total')::numeric
    where id = v_bill;

    delete from bill_items where bill_id = v_bill;   -- ลบ bill_item_shares ตาม cascade
    -- เก็บแถวของคนที่จ่ายแล้วไว้ (paid_at, payment_id เดิม) ลบเฉพาะคนที่ยังไม่จ่ายและแถวของผู้รับเงิน
    delete from bill_shares where bill_id = v_bill and (paid_at is null or member_id = v_payer);

    for it in select * from jsonb_array_elements(p->'items') loop
      insert into bill_items (bill_id, position, name, price)
      values (v_bill, pos, it->>'name', (it->>'price')::numeric) returning id into v_item;
      pos := pos + 1;
      for mid in select * from jsonb_array_elements_text(it->'member_ids') loop
        insert into bill_item_shares (item_id, member_id) values (v_item, mid::uuid);
      end loop;
    end loop;

    for sh in select * from jsonb_array_elements(p->'shares') loop
      if not exists (select 1 from bill_shares where bill_id = v_bill and member_id = (sh->>'member_id')::uuid) then
        insert into bill_shares (bill_id, member_id, amount, paid_at)
        values (v_bill, (sh->>'member_id')::uuid, (sh->>'amount')::numeric,
                case when coalesce((sh->>'paid')::boolean, false) then now() else null end);
      end if;
    end loop;

    update bills set status = case
      when exists (select 1 from bill_shares where bill_id = v_bill and paid_at is null) then 'open' else 'settled' end
    where id = v_bill;
  end if;
  return v_bill;
end $$;
