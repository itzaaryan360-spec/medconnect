-- ================================================================
-- MedConnect Supabase Schema
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard → your project → SQL Editor
-- ================================================================

-- 1. Users profile (extends Supabase auth.users)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role in ('PATIENT','CARETAKER','ADMIN')) default 'PATIENT',
  name        text,
  created_at  timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- 2. Vitals readings
create table if not exists public.vitals (
  id               bigserial primary key,
  patient_id       text not null,
  heart_rate       numeric,
  systolic_bp      numeric,
  diastolic_bp     numeric,
  spo2             numeric,
  temperature_f    numeric,
  respiratory_rate numeric,
  recorded_at      timestamptz default now()
);
alter table public.vitals enable row level security;
create policy "Allow all vitals access" on public.vitals for all using (true);
create index if not exists vitals_patient_idx on public.vitals(patient_id, recorded_at desc);

-- 3. Reports (analysis results — the actual files go to Storage)
create table if not exists public.reports (
  id                bigserial primary key,
  user_id           text not null,
  filename          text,
  storage_path      text,          -- Supabase Storage path
  summary           text,
  affected_anatomy  jsonb default '[]',
  entities          jsonb default '{}',
  uploaded_at       timestamptz default now()
);
alter table public.reports enable row level security;
create policy "Allow all report access" on public.reports for all using (true);

-- 4. Emergency events
create table if not exists public.emergencies (
  event_id          text primary key,
  idempotency_key   text unique,
  patient_id        text not null,
  patient_name      text,
  trigger_source    text,
  status            text default 'PENDING_CONFIRMATION',
  triggered_at      timestamptz default now(),
  resolved_at       timestamptz,
  resolved_by       text,
  vitals_snapshot   jsonb default '{}',
  location          jsonb,
  actions_taken     jsonb default '[]'
);
alter table public.emergencies enable row level security;
create policy "Allow all emergency access" on public.emergencies for all using (true);

-- 5. Audit log
create table if not exists public.audit_log (
  id          bigserial primary key,
  event_type  text not null,
  patient_id  text,
  details     jsonb default '{}',
  logged_at   timestamptz default now()
);
alter table public.audit_log enable row level security;
create policy "Allow all audit access" on public.audit_log for all using (true);

-- 6. Storage bucket for medical reports
-- Run this separately in Supabase dashboard → Storage → New bucket
-- Bucket name: "reports"  |  Public: false  |  File size: 50MB
