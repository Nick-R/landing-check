-- Проверки, правки и решения по ним.
create table checks (
  id            text primary key,
  url           text not null,
  final_url     text not null,
  ad_headline   text not null,
  ad_description text not null,
  page_title    text not null default '',
  score         integer not null check (score between 0 and 100),
  verdict       text not null,
  summary       text not null,
  ad_promise    text not null default '',
  model         text not null,
  tokens_in     integer not null default 0,
  tokens_out    integer not null default 0,
  cost_rub      numeric(10,4) not null default 0,
  ip_hash       text not null,
  created_at    timestamptz not null default now()
);
create index checks_ip_created_idx on checks (ip_hash, created_at desc);

create table fixes (
  id            bigserial primary key,
  check_id      text not null references checks(id) on delete cascade,
  position      integer not null,
  severity      text not null check (severity in ('critical','important','minor')),
  place         text not null,
  problem       text not null,
  why           text not null,
  current_text  text not null default '',
  quote_verified boolean not null default false,
  replacement   text not null,
  unique (check_id, position)
);

create table decisions (
  fix_id      bigint primary key references fixes(id) on delete cascade,
  decision    text not null check (decision in ('accepted','rejected')),
  decided_at  timestamptz not null default now()
);

-- Попытки запуска: по ним считается ограничение на адрес (учитываются и неудачные).
create table attempts (
  id          bigserial primary key,
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);
create index attempts_ip_created_idx on attempts (ip_hash, created_at desc);

-- Дневной расход на модель. reserved_rub - бронь под идущие запросы.
create table usage_daily (
  day          date primary key,
  spent_rub    numeric(10,4) not null default 0,
  reserved_rub numeric(10,4) not null default 0,
  calls        integer not null default 0
);
