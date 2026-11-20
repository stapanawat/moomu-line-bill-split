-- แก้ไข / ยกเลิกบิล (สำหรับฐานข้อมูลที่รัน schema.sql เวอร์ชันก่อนหน้าแล้ว: รันไฟล์นี้ใน SQL Editor)
alter table bills add column if not exists updated_at    timestamptz;
alter table bills add column if not exists cancelled_at  timestamptz;
alter table bills add column if not exists cancelled_by  uuid references members(id);
alter table bills add column if not exists cancel_reason text;

-- -------------------------------------------------------------
-- แก้ไขบิลแบบ atomic
-- p = { bill_id, title, bill_date,
--       set_receipt, receipt_path, set_qr, qr_path,          (เปลี่ยนรูปเฉพาะเมื่อ set_* = true)
--       financial,                                           (true = แก้ยอด/รายการ/ผู้รับเงิน)
--       payer_member_id, promptpay_id, service_pct, discount, total,
--       items: [{ name, price, member_ids }], shares: [{ member_id, amount, paid }] }
-- error: bill_not_editable (ไม่พบ/ถูกยกเลิกแล้ว), bill_has_payments (มีคนจ่ายแล้ว แก้ยอดไม่ได้)
-- -------------------------------------------------------------
create or replace function update_bill(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_bill uuid := (p->>'bill_id')::uuid;
  v_item uuid;
  it jsonb;
  sh jsonb;
  mid text;
  pos int := 0;
begin
  update bills set
    title        = p->>'title',
    bill_date    = (p->>'bill_date')::date,
    receipt_path = case when coalesce((p->>'set_receipt')::boolean, false) then nullif(p->>'receipt_path', '') else receipt_path end,
    qr_path      = case when coalesce((p->>'set_qr')::boolean, false) then nullif(p->>'qr_path', '') else qr_path end,
    updated_at   = now()
  where id = v_bill and status <> 'cancelled';
  if not found then raise exception 'bill_not_editable'; end if;

  if coalesce((p->>'financial')::boolean, false) then
    if exists (
      select 1 from bill_shares s join bills b on b.id = s.bill_id
       where s.bill_id = v_bill and s.paid_at is not null and s.member_id <> b.payer_member_id
    ) then
      raise exception 'bill_has_payments';
    end if;

    update bills set
      payer_member_id = (p->>'payer_member_id')::uuid,
      promptpay_id    = nullif(p->>'promptpay_id', ''),
      service_pct     = coalesce((p->>'service_pct')::numeric, 0),
      discount        = coalesce((p->>'discount')::numeric, 0),
      total           = (p->>'total')::numeric
    where id = v_bill;

    delete from bill_items  where bill_id = v_bill;   -- ลบ bill_item_shares ตาม cascade
    delete from bill_shares where bill_id = v_bill;

    for it in select * from jsonb_array_elements(p->'items') loop
      insert into bill_items (bill_id, position, name, price)
      values (v_bill, pos, it->>'name', (it->>'price')::numeric) returning id into v_item;
      pos := pos + 1;
      for mid in select * from jsonb_array_elements_text(it->'member_ids') loop
        insert into bill_item_shares (item_id, member_id) values (v_item, mid::uuid);
      end loop;
    end loop;

    for sh in select * from jsonb_array_elements(p->'shares') loop
      insert into bill_shares (bill_id, member_id, amount, paid_at)
      values (v_bill, (sh->>'member_id')::uuid, (sh->>'amount')::numeric,
              case when coalesce((sh->>'paid')::boolean, false) then now() else null end);
    end loop;

    update bills set status = case
      when exists (select 1 from bill_shares where bill_id = v_bill and paid_at is null) then 'open' else 'settled' end
    where id = v_bill;
  end if;
  return v_bill;
end $$;

-- ยกเลิกบิล: ไม่ลบข้อมูล เปลี่ยนสถานะเป็น cancelled (ไม่ถูกทวง ไม่นับในสรุปยอด)
create or replace function cancel_bill(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_bill uuid := (p->>'bill_id')::uuid;
begin
  update bills set status = 'cancelled', cancelled_at = now(),
         cancelled_by = nullif(p->>'cancelled_by', '')::uuid, cancel_reason = nullif(p->>'reason', '')
   where id = v_bill and status <> 'cancelled';
  if not found then raise exception 'bill_not_editable'; end if;
  return v_bill;
end $$;
