-- ================================================================
-- MedConnect — IoT/Wearable Extension Schema
-- Run this in Supabase SQL Editor AFTER supabase_schema.sql
-- ================================================================

-- 1. Update vitals table to track data source and GPS
alter table public.vitals
  add column if not exists source      text    default 'manual',   -- 'manual' | 'iot_watch' | 'iot_bp' | 'iot_oximeter'
  add column if not exists device_id   text,
  add column if not exists latitude    numeric,
  add column if not exists longitude   numeric,
  add column if not exists battery_pct int;

-- 2. IoT Devices registry
create table if not exists public.iot_devices (
  id            text primary key,          -- e.g. "watch_patient001_001"
  patient_id    text    not null,
  device_type   text    default 'smartwatch',   -- smartwatch | bp_monitor | oximeter | custom
  device_name   text    default 'Smart Watch',
  api_key       text    unique not null,    -- SHA256 token sent by device
  is_active     boolean default true,
  last_seen     timestamptz,
  battery_pct   int     default 100,
  firmware      text    default '1.0.0',
  registered_at timestamptz default now()
);
alter table public.iot_devices enable row level security;
create policy "Allow all iot_devices access" on public.iot_devices for all using (true);

-- 3. Enable Realtime for live caretaker updates
-- (Supabase: Database → Replication → enable for 'vitals' and 'iot_devices')
alter publication supabase_realtime add table public.vitals;
alter publication supabase_realtime add table public.iot_devices;

-- 4. Index for fast patient lookups
create index if not exists iot_devices_patient_idx on public.iot_devices(patient_id);
create index if not exists vitals_device_idx on public.vitals(device_id, recorded_at desc);
