-- Vilarejo · Controle do Ônibus — proposta de schema para Supabase (PostgreSQL)
-- Ponto de partida para o desenvolvedor: revisar nomes, RLS e políticas antes de aplicar em produção.

create extension if not exists "pgcrypto";
create extension if not exists vector;          -- pgvector, para os descritores faciais (128 dimensões)

-- Ônibus / terminais ----------------------------------------------------------
create table buses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                    -- ex.: 'Ônibus 01'
  plate       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Pessoas (funcionários e motoristas) ------------------------------------------
create type person_role as enum ('func', 'motorista');

create table people (
  id          uuid primary key default gen_random_uuid(),
  role        person_role not null default 'func',
  name        text not null,
  registration text,                            -- matrícula
  sector      text,
  active      boolean not null default true,    -- false = bloqueado
  photo_path  text,                             -- caminho no Storage (bucket privado 'faces')
  consent_at  timestamptz,                      -- LGPD: data do consentimento para biometria
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table face_descriptors (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade,
  descriptor  vector(128) not null,             -- saída do face-api (faceRecognitionNet)
  created_at  timestamptz not null default now()
);
create index on face_descriptors (person_id);

-- Viagens / turnos ---------------------------------------------------------------
create table trips (
  id           uuid primary key default gen_random_uuid(),
  bus_id       uuid references buses(id),
  day_number   int not null,                    -- nº da viagem no dia
  route        text,
  driver_id    uuid references people(id),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  ended_by     text check (ended_by in ('motorista','gestao')),
  start_lat    double precision, start_lng double precision,
  end_lat      double precision, end_lng   double precision,
  distance_m   double precision not null default 0
);
create index on trips (started_at desc);
create index on trips (driver_id);
-- garante no máximo 1 viagem aberta por ônibus
create unique index one_open_trip_per_bus on trips (bus_id) where ended_at is null;

-- Pontos do trajeto (GPS)
create table trip_points (
  id          bigint generated always as identity primary key,
  trip_id     uuid not null references trips(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  real,
  recorded_at timestamptz not null default now()
);
create index on trip_points (trip_id, recorded_at);

-- Embarques / desembarques ----------------------------------------------------------
create table rides (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  person_id   uuid not null references people(id),
  in_at       timestamptz not null default now(),
  in_lat      double precision, in_lng  double precision,
  out_at      timestamptz,
  out_lat     double precision, out_lng double precision,
  out_mode    text check (out_mode in ('face','fim da viagem'))
);
create index on rides (trip_id);
create index on rides (person_id, in_at desc);
-- uma pessoa só pode estar "a bordo" uma vez por viagem ao mesmo tempo
create unique index one_open_ride on rides (trip_id, person_id) where out_at is null;

-- Acessos negados --------------------------------------------------------------------
create table denied_access (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid references trips(id),
  person_id   uuid references people(id),       -- null = rosto desconhecido
  reason      text not null,                    -- 'rosto não cadastrado' | 'cadastro bloqueado' | 'turno não iniciado'
  lat         double precision, lng double precision,
  at          timestamptz not null default now()
);
create index on denied_access (at desc);

-- Configurações (por ônibus) -------------------------------------------------------------
create table settings (
  bus_id         uuid primary key references buses(id),
  match_threshold real not null default 0.5,
  cooldown_s     int  not null default 10,
  voice          boolean not null default true,
  whatsapp_to    text,
  need_driver    boolean not null default true
);

-- Visão de relatório simplificado (por viagem) ---------------------------------------------
create or replace view trip_report as
select t.id, t.day_number, t.route, t.started_at, t.ended_at,
       d.name as driver_name,
       round((t.distance_m/1000.0)::numeric, 1) as km,
       count(distinct r.person_id) as passengers,
       string_agg(distinct p.name, ', ') as passenger_names
from trips t
left join people d on d.id = t.driver_id
left join rides  r on r.trip_id = t.id
left join people p on p.id = r.person_id
group by t.id, d.name;

-- RLS (habilitar e escrever as políticas conforme os perfis) -------------------------------
alter table people           enable row level security;
alter table face_descriptors enable row level security;
alter table trips            enable row level security;
alter table trip_points      enable row level security;
alter table rides            enable row level security;
alter table denied_access    enable row level security;
alter table settings         enable row level security;
alter table buses            enable row level security;
-- Sugestão de perfis:
--   gestor   (auth, claim role='gestor'): leitura total, escrita em people/settings.
--   terminal (auth de serviço por ônibus, claim bus_id): leitura de people ativos + descritores;
--            insert em trips/rides/trip_points/denied_access do próprio bus_id; update de ended_at/out_at.
-- Realtime: adicionar rides, trips e denied_access à publication 'supabase_realtime' para o painel ao vivo.
