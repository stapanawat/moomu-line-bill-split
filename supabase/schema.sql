-- =============================================================
-- ระบบหารบิลผ่าน LINE : โครงสร้างฐานข้อมูล (Supabase / Postgres)
-- วิธีใช้: เปิด Supabase > SQL Editor > วางทั้งไฟล์ > Run
-- =============================================================

create extension if not exists pgcrypto;

-- กลุ่ม LINE ที่บอทอยู่
create table if not exists groups (
  id            uuid primary key default gen_random_uuid(),
  line_group_id text unique not null,
  access_key    text unique not null,          -- รหัสสุ่มที่ใส่ในลิงก์เว็บ (?g=...) แทน groupId จริง
  name          text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- สมาชิกในกลุ่ม (ถูกบันทึกเมื่อพิมพ์/ส่งข้อความในกลุ่ม หรือเพิ่งเข้ากลุ่ม)
create table if not exists members (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references groups(id) on delete cascade,
  line_user_id  text not null,
  display_name  text not null,
  picture_url   text,
  promptpay_id  text,       -- เบอร์โทร 10 หลัก หรือเลขบัตร 13 หลัก ใช้สร้าง QR
  bank_account  text,       -- (ไม่บังคับ) เลขบัญชีที่ผูกพร้อมเพย์ ใช้เทียบผู้รับในสลิป
  account_name  text,       -- (ไม่บังคับ) ชื่อบัญชีตามที่ปรากฏในสลิป
  last_seen_at  timestamptz not null default now(),
  unique (group_id, line_user_id)
);

create table if not exists bills (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references groups(id) on delete cascade,
  title            text not null,
  bill_date        date not null,
  payer_member_id  uuid not null references members(id),
  promptpay_id     text,
  service_pct      numeric(5,2)  not null default 0,
  discount         numeric(12,2) not null default 0,
  total            numeric(12,2) not null,
  receipt_path     text,
  qr_path          text,
  status           text not null default 'open' check (status in ('open','settled','cancelled')),
  created_by       uuid references members(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  cancelled_at     timestamptz,
  cancelled_by     uuid references members(id),
  cancel_reason    text
);
create index if not exists bills_group_date on bills(group_id, bill_date desc);

create table if not exists bill_items (
  id        uuid primary key default gen_random_uuid(),
  bill_id   uuid not null references bills(id) on delete cascade,
  position  int  not null default 0,
  name      text not null,
  price     numeric(12,2) not null check (price >= 0)
);

create table if not exists bill_item_shares (
  item_id    uuid not null references bill_items(id) on delete cascade,
  member_id  uuid not null references members(id),
  primary key (item_id, member_id)
);

create table if not exists payments (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references groups(id) on delete cascade,
  member_id      uuid not null references members(id),
  trans_ref      text unique not null,           -- กันสลิปซ้ำ
  amount         numeric(12,2) not null,
  slip_path      text,
  provider       text,
  receiver_name  text,
  raw            jsonb,
  created_at     timestamptz not null default now()
);

-- ยอดที่แต่ละคนต้องจ่ายในแต่ละบิล
create table if not exists bill_shares (
  bill_id     uuid not null references bills(id) on delete cascade,
  member_id   uuid not null references members(id),
  amount      numeric(12,2) not null,
  paid_at     timestamptz,
  payment_id  uuid references payments(id),
  primary key (bill_id, member_id)
);

-- กันการทวงซ้ำในวันเดียวกัน
create table if not exists reminder_runs (
  group_id  uuid not null references groups(id) on delete cascade,
  run_date  date not null,
  sent_at   timestamptz not null default now(),
  primary key (group_id, run_date)
);

-- ชุดรายชื่อที่ใช้บ่อย
create table if not exists member_presets (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id) on delete cascade,
  name        text not null,
  member_ids  uuid[] not null,
  created_by  uuid references members(id),
  created_at  timestamptz not null default now(),
  unique (group_id, name)
);

-- ปิดการเข้าถึงตรงจากภายนอก: เซิร์ฟเวอร์ใช้ service_role key เท่านั้น
alter table groups           enable row level security;
alter table members          enable row level security;
alter table bills            enable row level security;
alter table bill_items       enable row level security;
alter table bill_item_shares enable row level security;
alter table payments         enable row level security;
alter table bill_shares      enable row level security;
alter table reminder_runs    enable row level security;
alter table member_presets   enable row level security;

-- -------------------------------------------------------------
-- สร้างบิลแบบ atomic (ทุกตารางสำเร็จพร้อมกัน หรือไม่บันทึกเลย)
-- p = { group_id, title, bill_date, payer_member_id, promptpay_id, service_pct, discount, total,
--       receipt_path, qr_path, created_by,
--       items: [{ name, price, member_ids: [uuid] }],
--       shares: [{ member_id, amount, paid }] }
-- -------------------------------------------------------------
create or replace function create_bill(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_bill uuid;
  v_item uuid;
  it jsonb;
  sh jsonb;
  mid text;
  pos int := 0;
begin
  insert into bills (group_id, title, bill_date, payer_member_id, promptpay_id, service_pct, discount, total,
                     receipt_path, qr_path, created_by)
  values ((p->>'group_id')::uuid, p->>'title', (p->>'bill_date')::date, (p->>'payer_member_id')::uuid,
          nullif(p->>'promptpay_id',''), coalesce((p->>'service_pct')::numeric,0), coalesce((p->>'discount')::numeric,0),
          (p->>'total')::numeric, nullif(p->>'receipt_path',''), nullif(p->>'qr_path',''), nullif(p->>'created_by','')::uuid)
  returning id into v_bill;

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
            case when coalesce((sh->>'paid')::boolean,false) then now() else null end);
  end loop;

  update bills set status = 'settled'
   where id = v_bill and not exists (select 1 from bill_shares where bill_id = v_bill and paid_at is null);
  return v_bill;
end $$;

-- -------------------------------------------------------------
-- บันทึกการชำระเงินจากสลิป แล้วติ๊กว่าจ่ายแล้วในบิลที่เกี่ยวข้อง
-- p = { group_id, member_id, trans_ref, amount, slip_path, provider, receiver_name, raw, bill_ids: [uuid] }
-- คืนค่า payment id หรือ error 'duplicate_slip'
-- -------------------------------------------------------------
create or replace function record_payment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pay uuid;
  bid text;
begin
  if exists (select 1 from payments where trans_ref = p->>'trans_ref') then
    raise exception 'duplicate_slip';
  end if;

  insert into payments (group_id, member_id, trans_ref, amount, slip_path, provider, receiver_name, raw)
  values ((p->>'group_id')::uuid, (p->>'member_id')::uuid, p->>'trans_ref', (p->>'amount')::numeric,
          p->>'slip_path', p->>'provider', p->>'receiver_name', p->'raw')
  returning id into v_pay;

  for bid in select * from jsonb_array_elements_text(p->'bill_ids') loop
    update bill_shares set paid_at = now(), payment_id = v_pay
     where bill_id = bid::uuid and member_id = (p->>'member_id')::uuid and paid_at is null;
    update bills set status = 'settled'
     where id = bid::uuid and not exists (select 1 from bill_shares where bill_id = bid::uuid and paid_at is null);
  end loop;
  return v_pay;
end $$;

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

-- ที่เก็บรูปใบเสร็จ / QR / สลิป (ส่วนตัว เปิดดูผ่านลิงก์ชั่วคราวจากเซิร์ฟเวอร์เท่านั้น)
insert into storage.buckets (id, name, public)
values ('bill-files', 'bill-files', false)
on conflict (id) do nothing;
