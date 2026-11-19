-- ชุดรายชื่อที่ใช้บ่อย (เช่น "แก๊งคาเฟ่", "ทีมเที่ยวเชียงใหม่")
-- สำหรับฐานข้อมูลที่รัน schema.sql เวอร์ชันแรกไปแล้ว: รันไฟล์นี้เพิ่มใน SQL Editor
create table if not exists member_presets (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id) on delete cascade,
  name        text not null,
  member_ids  uuid[] not null,
  created_by  uuid references members(id),
  created_at  timestamptz not null default now(),
  unique (group_id, name)
);
alter table member_presets enable row level security;
