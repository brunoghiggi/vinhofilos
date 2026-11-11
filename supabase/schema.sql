-- =====================================================================
-- Vinhófilos — schema do banco (Supabase / PostgreSQL)
--
-- Como usar: Supabase → SQL Editor → cole este arquivo inteiro → Run.
-- Pode ser executado novamente para atualizar funções e políticas.
--
-- Modelo de segurança (sem login):
--   * participants: leitura, cadastro e edição públicos (sem exclusão).
--   * tastings: apenas colunas públicas são legíveis; o hash do token
--     de controle nunca é exposto.
--   * tasting_wines, tasting_participants, wine_guesses: SEM acesso
--     direto pela chave anon. Tudo passa por funções RPC
--     SECURITY DEFINER que validam o token de controle do criador ou
--     liberam os dados somente quando a degustação está finalizada.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table if not exists public.participants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  nickname    text check (nickname is null or char_length(nickname) <= 40),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.tastings (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(btrim(name)) between 1 and 120),
  tasting_date        date,
  description         text check (description is null or char_length(description) <= 2000),
  status              text not null default 'rascunho'
                        check (status in ('rascunho', 'em_andamento', 'finalizada')),
  -- Escala de pontuação da confraria: 50 a 100, somente inteiros (fixa;
  -- as colunas ficam registradas em cada degustação para histórico).
  score_min           numeric(7,2) not null default 50,
  score_max           numeric(7,2) not null default 100,
  creator_token_hash  text not null,
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  constraint tastings_score_range check (score_max > score_min)
);
create index if not exists tastings_status_created_idx on public.tastings (status, created_at desc);

create table if not exists public.tasting_wines (
  id                uuid primary key default gen_random_uuid(),
  tasting_id        uuid not null references public.tastings(id) on delete cascade,
  position          integer not null check (position >= 1),
  name              text not null check (char_length(btrim(name)) between 1 and 200),
  country           text check (country is null or char_length(country) <= 100),
  region            text check (region is null or char_length(region) <= 150),
  price             numeric(12,2) check (price is null or price >= 0),
  discounted_price  numeric(12,2) check (discounted_price is null or discounted_price >= 0),
  grape             text check (grape is null or char_length(grape) <= 200),
  vintage           smallint check (vintage is null or vintage between 1800 and 2100),
  notes             text check (notes is null or char_length(notes) <= 2000),
  constraint tasting_wines_id_tasting_key unique (id, tasting_id)
);
create index if not exists tasting_wines_tasting_idx on public.tasting_wines (tasting_id, position);

create table if not exists public.tasting_participants (
  id              uuid primary key default gen_random_uuid(),
  tasting_id      uuid not null references public.tastings(id) on delete cascade,
  participant_id  uuid not null references public.participants(id) on delete restrict,
  position        integer not null check (position >= 1),
  constraint tasting_participants_unique unique (tasting_id, participant_id)
);

create table if not exists public.wine_guesses (
  id               uuid primary key default gen_random_uuid(),
  tasting_id       uuid not null references public.tastings(id) on delete cascade,
  wine_id          uuid not null,
  participant_id   uuid not null references public.participants(id) on delete restrict,
  guessed_region   text check (guessed_region is null or char_length(guessed_region) <= 150),
  guessed_vintage  smallint check (guessed_vintage is null or guessed_vintage between 1800 and 2100),
  guessed_grape    text check (guessed_grape is null or char_length(guessed_grape) <= 200),
  guessed_price    numeric(12,2) check (guessed_price is null or guessed_price >= 0),
  -- Nota inteira de 50 a 100
  score            numeric(7,2) check (score is null or (score between 50 and 100 and score = trunc(score))),
  notes            text check (notes is null or char_length(notes) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Um palpite por vinho e participante
  constraint wine_guesses_unique unique (wine_id, participant_id),
  -- O vinho precisa pertencer à mesma degustação
  constraint wine_guesses_wine_fk foreign key (wine_id, tasting_id)
    references public.tasting_wines (id, tasting_id) on delete cascade,
  -- O participante precisa estar presente na degustação
  constraint wine_guesses_presence_fk foreign key (tasting_id, participant_id)
    references public.tasting_participants (tasting_id, participant_id) on delete cascade
);
create index if not exists wine_guesses_tasting_idx on public.wine_guesses (tasting_id);

-- Degustações mensais automáticas e organizadores (11/11/2026)
--   monthly_ref        1º dia do mês da degustação automática (uma por mês)
--   organizer_ids      organizadores (participantes do cadastro), editáveis por qualquer pessoa
--   creator_token_hash nulo = ainda sem organizador com chave; qualquer
--                      pessoa pode assumir (claim_tasting) e recebe a chave
alter table public.tastings alter column creator_token_hash drop not null;
alter table public.tastings add column if not exists monthly_ref date;
alter table public.tastings add column if not exists organizer_ids uuid[] not null default '{}';
alter table public.tastings add column if not exists claimed boolean
  generated always as (creator_token_hash is not null) stored;
create unique index if not exists tastings_monthly_ref_key
  on public.tastings (monthly_ref) where monthly_ref is not null;

-- Tema da confraria (11/11/2026): secreto até a finalização.
--   theme         preenchido pelo organizador (com a chave); NUNCA concedido ao anon
--   public_theme  cópia calculada que só existe quando status = 'finalizada';
--                 é a única coluna de tema legível pelo público
alter table public.tastings add column if not exists theme text
  check (theme is null or char_length(theme) <= 150);
alter table public.tastings add column if not exists public_theme text
  generated always as (case when status = 'finalizada' then theme end) stored;

-- Foto da garrafa (11/11/2026): link https:// ou arquivo do próprio site
-- (assets/images/...). Como os demais dados reais do vinho, só é revelada
-- ao público depois da finalização (tasting_wines não é legível pelo anon).
alter table public.tasting_wines add column if not exists photo_url text;
alter table public.tasting_wines drop constraint if exists tasting_wines_photo_url_check;
alter table public.tasting_wines add constraint tasting_wines_photo_url_check
  check (photo_url is null or (char_length(photo_url) <= 500 and photo_url ~ '^(https://|assets/images/)[^\s"<>]+$'));

-- Eventos especiais da agenda (11/11/2026), ex.: confraternização de fim de ano.
-- Aparecem como card de destaque. Com replaces_month preenchido (1º dia do
-- mês), a confraria daquele mês não é criada por ensure_monthly_tastings.
-- Leitura pública; criação/edição só pelo SQL Editor (sem grants de escrita).
create table if not exists public.agenda_events (
  id              uuid primary key default gen_random_uuid(),
  event_date      date not null,
  title           text not null check (char_length(btrim(title)) between 1 and 120),
  description     text check (description is null or char_length(description) <= 500),
  replaces_month  date unique check (replaces_month is null or extract(day from replaces_month) = 1),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------

alter table public.participants          enable row level security;
alter table public.tastings              enable row level security;
alter table public.tasting_wines         enable row level security;
alter table public.tasting_participants  enable row level security;
alter table public.wine_guesses          enable row level security;

revoke all on public.participants, public.tastings, public.tasting_wines,
              public.tasting_participants, public.wine_guesses
  from anon, authenticated;

-- participants: leitura/cadastro/edição públicos, sem exclusão (preserva histórico)
grant select (id, name, nickname, active, created_at) on public.participants to anon, authenticated;
grant insert (name, nickname)                         on public.participants to anon, authenticated;
grant update (name, nickname, active)                 on public.participants to anon, authenticated;

drop policy if exists participants_select on public.participants;
drop policy if exists participants_insert on public.participants;
drop policy if exists participants_update on public.participants;
create policy participants_select on public.participants for select to anon, authenticated using (true);
create policy participants_insert on public.participants for insert to anon, authenticated with check (true);
create policy participants_update on public.participants for update to anon, authenticated using (true) with check (true);

-- tastings: somente colunas públicas (o hash do token NÃO é concedido)
grant select (id, name, tasting_date, description, status, score_min, score_max,
              created_at, started_at, finished_at, monthly_ref, organizer_ids, claimed, public_theme)
  on public.tastings to anon, authenticated;

drop policy if exists tastings_select on public.tastings;
create policy tastings_select on public.tastings for select to anon, authenticated using (true);

-- agenda_events: somente leitura pública
alter table public.agenda_events enable row level security;
revoke all on public.agenda_events from anon, authenticated;
grant select on public.agenda_events to anon, authenticated;
drop policy if exists agenda_events_select on public.agenda_events;
create policy agenda_events_select on public.agenda_events for select to anon, authenticated using (true);

-- tasting_wines, tasting_participants, wine_guesses: sem grants e sem políticas
-- => nenhum acesso direto. Acesso apenas via funções abaixo.

-- ---------------------------------------------------------------------
-- Funções internas (não expostas)
-- ---------------------------------------------------------------------

create or replace function public._assert_creator(p_tasting uuid, p_token text)
returns public.tastings
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t public.tastings;
begin
  select * into t from public.tastings where id = p_tasting for update;
  if not found then
    raise exception 'Degustação não encontrada.';
  end if;
  -- Sem esta checagem, "hash nulo <> x" daria NULL e aceitaria qualquer chave.
  if t.creator_token_hash is null then
    raise exception 'Esta degustação ainda não tem organizador. Use "Assumir organização" na página dela.';
  end if;
  if p_token is null or length(p_token) < 32
     or t.creator_token_hash <> encode(digest(p_token, 'sha256'), 'hex') then
    raise exception 'Chave de controle inválida para esta degustação.';
  end if;
  return t;
end;
$$;

create or replace function public._tasting_details(p_tasting uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'wines', coalesce((
      select jsonb_agg(to_jsonb(w) order by w.position)
      from public.tasting_wines w where w.tasting_id = p_tasting), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'participant_id', p.id, 'name', p.name, 'nickname', p.nickname,
               'position', tp.position) order by tp.position)
      from public.tasting_participants tp
      join public.participants p on p.id = tp.participant_id
      where tp.tasting_id = p_tasting), '[]'::jsonb),
    'guesses', coalesce((
      select jsonb_agg(to_jsonb(g))
      from public.wine_guesses g where g.tasting_id = p_tasting), '[]'::jsonb)
  );
$$;

-- Organizadores na ordem gravada, com nome (participantes nunca são excluídos).
create or replace function public._organizers(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'nickname', p.nickname)
                            order by u.ord), '[]'::jsonb)
  from unnest(coalesce(p_ids, '{}')) with ordinality as u(id, ord)
  join public.participants p on p.id = u.id;
$$;

-- Último domingo do mês que contém p_month.
create or replace function public._last_sunday(p_month date)
returns date
language sql
immutable
as $$
  select d - extract(dow from d)::int
  from (select (date_trunc('month', p_month) + interval '1 month - 1 day')::date as d) x;
$$;

-- Substitui a lista de vinhos: atualiza os que têm id, cria os novos e
-- remove os ausentes (palpites dos removidos são apagados em cascata).
create or replace function public._replace_wines(p_tasting uuid, p_wines jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w      jsonb;
  i      integer := 0;
  v_id   uuid;
  v_ids  uuid[] := '{}';
  v_name text;
begin
  p_wines := coalesce(p_wines, '[]'::jsonb);
  if jsonb_typeof(p_wines) <> 'array' then
    raise exception 'Lista de vinhos inválida.';
  end if;
  if jsonb_array_length(p_wines) > 50 then
    raise exception 'Máximo de 50 vinhos por degustação.';
  end if;

  for w in select value from jsonb_array_elements(p_wines) loop
    i := i + 1;
    v_name := nullif(btrim(w->>'name'), '');
    if v_name is null then
      raise exception 'Vinho %: o nome é obrigatório.', i;
    end if;
    v_id := nullif(w->>'id', '')::uuid;

    if v_id is not null and exists (
      select 1 from public.tasting_wines where id = v_id and tasting_id = p_tasting
    ) then
      update public.tasting_wines set
        position         = i,
        name             = v_name,
        country          = nullif(btrim(w->>'country'), ''),
        region           = nullif(btrim(w->>'region'), ''),
        price            = nullif(btrim(w->>'price'), '')::numeric,
        discounted_price = nullif(btrim(w->>'discounted_price'), '')::numeric,
        grape            = nullif(btrim(w->>'grape'), ''),
        vintage          = nullif(btrim(w->>'vintage'), '')::smallint,
        notes            = nullif(btrim(w->>'notes'), ''),
        photo_url        = nullif(btrim(w->>'photo_url'), '')
      where id = v_id;
    else
      insert into public.tasting_wines
        (tasting_id, position, name, country, region, price, discounted_price, grape, vintage, notes, photo_url)
      values (
        p_tasting, i, v_name,
        nullif(btrim(w->>'country'), ''),
        nullif(btrim(w->>'region'), ''),
        nullif(btrim(w->>'price'), '')::numeric,
        nullif(btrim(w->>'discounted_price'), '')::numeric,
        nullif(btrim(w->>'grape'), ''),
        nullif(btrim(w->>'vintage'), '')::smallint,
        nullif(btrim(w->>'notes'), ''),
        nullif(btrim(w->>'photo_url'), '')
      )
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;

  delete from public.tasting_wines
  where tasting_id = p_tasting and not (id = any (v_ids));
end;
$$;

-- ---------------------------------------------------------------------
-- Funções públicas (RPC)
-- ---------------------------------------------------------------------

-- Visão pública: dados gerais sempre; vinhos, presentes e palpites só
-- quando finalizada.
create or replace function public.get_tasting_public(p_tasting uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t      public.tastings;
  result jsonb;
begin
  select * into t from public.tastings where id = p_tasting;
  if not found then
    raise exception 'Degustação não encontrada.';
  end if;
  result := jsonb_build_object(
    'tasting', to_jsonb(t) - 'creator_token_hash' - 'theme',  -- tema só via public_theme
    'organizers', public._organizers(t.organizer_ids),
    'wine_count', (select count(*) from public.tasting_wines where tasting_id = t.id),
    'revealed', t.status = 'finalizada'
  );
  if t.status = 'finalizada' then
    result := result || public._tasting_details(t.id);
  end if;
  return result;
end;
$$;

-- Visão completa para o criador (exige o token).
create or replace function public.get_tasting_admin(p_tasting uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tastings;
begin
  t := public._assert_creator(p_tasting, p_token);
  return jsonb_build_object('tasting', to_jsonb(t) - 'creator_token_hash', 'revealed', true,
                            'organizers', public._organizers(t.organizer_ids))
         || public._tasting_details(t.id);
end;
$$;

-- Cria a degustação e devolve { id, token }. O token é gerado no banco e
-- só o seu hash SHA-256 é armazenado.
create or replace function public.create_tasting(
  p_name text,
  p_date date,
  p_description text,
  p_score_min numeric,
  p_score_max numeric,
  p_wines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_id    uuid;
begin
  if nullif(btrim(p_name), '') is null then
    raise exception 'O nome da degustação é obrigatório.';
  end if;
  insert into public.tastings (name, tasting_date, description, score_min, score_max, creator_token_hash)
  values (btrim(p_name), p_date, nullif(btrim(p_description), ''),
          50, 100,  -- escala fixa; p_score_min/p_score_max são ignorados
          encode(digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;

  perform public._replace_wines(v_id, p_wines);
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

create or replace function public.save_tasting(
  p_tasting uuid,
  p_token text,
  p_name text,
  p_date date,
  p_description text,
  p_score_min numeric,
  p_score_max numeric,
  p_wines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tastings;
  -- Escala fixa da confraria; p_score_min/p_score_max são ignorados
  v_min numeric := 50;
  v_max numeric := 100;
begin
  t := public._assert_creator(p_tasting, p_token);
  if t.status = 'finalizada' then
    raise exception 'Degustação finalizada não pode ser alterada.';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'O nome da degustação é obrigatório.';
  end if;
  if t.status = 'em_andamento' and jsonb_array_length(coalesce(p_wines, '[]'::jsonb)) = 0 then
    raise exception 'Uma degustação em andamento precisa de pelo menos um vinho.';
  end if;
  if exists (select 1 from public.wine_guesses
             where tasting_id = p_tasting and score is not null
               and (score < v_min or score > v_max)) then
    raise exception 'Há pontuações já registradas fora da nova escala (% a %).', v_min, v_max;
  end if;

  update public.tastings set
    name = btrim(p_name),
    tasting_date = p_date,
    description = nullif(btrim(p_description), ''),
    score_min = v_min,
    score_max = v_max
  where id = p_tasting;

  perform public._replace_wines(p_tasting, p_wines);
  return public.get_tasting_admin(p_tasting, p_token);
end;
$$;

-- Exclusão controlada: somente rascunhos.
create or replace function public.delete_tasting(p_tasting uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tastings;
begin
  t := public._assert_creator(p_tasting, p_token);
  if t.status <> 'rascunho' then
    raise exception 'Somente degustações em rascunho podem ser excluídas.';
  end if;
  if t.monthly_ref is not null then
    raise exception 'A degustação mensal não pode ser excluída (seria recriada automaticamente).';
  end if;
  delete from public.tastings where id = p_tasting;
end;
$$;

-- Define os presentes; a ordem do array é a ordem da degustação.
create or replace function public.set_tasting_participants(p_tasting uuid, p_token text, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tastings;
begin
  t := public._assert_creator(p_tasting, p_token);
  if t.status = 'finalizada' then
    raise exception 'Degustação finalizada não pode ser alterada.';
  end if;
  p_ids := coalesce(p_ids, '{}');
  if cardinality(p_ids) > 200 then
    raise exception 'Participantes demais.';
  end if;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) as x) then
    raise exception 'Um participante não pode aparecer duas vezes na mesma degustação.';
  end if;
  if exists (select 1 from unnest(p_ids) as x
             where not exists (select 1 from public.participants p where p.id = x)) then
    raise exception 'Participante não encontrado.';
  end if;
  if t.status = 'em_andamento' and cardinality(p_ids) = 0 then
    raise exception 'Uma degustação em andamento precisa de pelo menos um participante.';
  end if;

  delete from public.tasting_participants
  where tasting_id = p_tasting and not (participant_id = any (p_ids));

  insert into public.tasting_participants (tasting_id, participant_id, position)
  select p_tasting, u.x, u.ord
  from unnest(p_ids) with ordinality as u(x, ord)
  on conflict (tasting_id, participant_id) do update set position = excluded.position;

  return public.get_tasting_admin(p_tasting, p_token);
end;
$$;

create or replace function public.start_tasting(p_tasting uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tastings;
begin
  t := public._assert_creator(p_tasting, p_token);
  if t.status <> 'rascunho' then
    raise exception 'A degustação já foi iniciada.';
  end if;
  if not exists (select 1 from public.tasting_wines where tasting_id = p_tasting) then
    raise exception 'Cadastre pelo menos um vinho antes de iniciar.';
  end if;
  if not exists (select 1 from public.tasting_participants where tasting_id = p_tasting) then
    raise exception 'Selecione pelo menos um participante antes de iniciar.';
  end if;
  update public.tastings set status = 'em_andamento', started_at = now() where id = p_tasting;
  return public.get_tasting_admin(p_tasting, p_token);
end;
$$;

create or replace function public.save_guess(
  p_tasting uuid,
  p_token text,
  p_wine uuid,
  p_participant uuid,
  p_region text,
  p_vintage integer,
  p_grape text,
  p_price numeric,
  p_score numeric,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tastings;
  g public.wine_guesses;
begin
  t := public._assert_creator(p_tasting, p_token);
  if t.status <> 'em_andamento' then
    raise exception 'Palpites só podem ser registrados com a degustação em andamento.';
  end if;
  if not exists (select 1 from public.tasting_wines where id = p_wine and tasting_id = p_tasting) then
    raise exception 'Este vinho não pertence à degustação.';
  end if;
  if not exists (select 1 from public.tasting_participants
                 where participant_id = p_participant and tasting_id = p_tasting) then
    raise exception 'Este participante não está presente na degustação.';
  end if;
  if p_score is not null and (p_score < t.score_min or p_score > t.score_max) then
    raise exception 'A pontuação deve estar entre % e %.', t.score_min, t.score_max;
  end if;
  if p_score is not null and p_score <> trunc(p_score) then
    raise exception 'A pontuação deve ser um número inteiro.';
  end if;

  insert into public.wine_guesses
    (tasting_id, wine_id, participant_id, guessed_region, guessed_vintage,
     guessed_grape, guessed_price, score, notes)
  values
    (p_tasting, p_wine, p_participant, nullif(btrim(p_region), ''), p_vintage,
     nullif(btrim(p_grape), ''), p_price, p_score, nullif(btrim(p_notes), ''))
  on conflict (wine_id, participant_id) do update set
    guessed_region  = excluded.guessed_region,
    guessed_vintage = excluded.guessed_vintage,
    guessed_grape   = excluded.guessed_grape,
    guessed_price   = excluded.guessed_price,
    score           = excluded.score,
    notes           = excluded.notes,
    updated_at      = now()
  returning * into g;

  return to_jsonb(g);
end;
$$;

-- Finalização irreversível: revela vinhos, presentes e palpites.
create or replace function public.finish_tasting(p_tasting uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tastings;
begin
  t := public._assert_creator(p_tasting, p_token);
  if t.status <> 'em_andamento' then
    raise exception 'Somente degustações em andamento podem ser finalizadas.';
  end if;
  update public.tastings set status = 'finalizada', finished_at = now() where id = p_tasting;
  return public.get_tasting_admin(p_tasting, p_token);
end;
$$;

-- ---------------------------------------------------------------------
-- Degustações mensais e organizadores
-- ---------------------------------------------------------------------

-- Garante uma degustação por mês, no último domingo, do mês atual até
-- 11 meses à frente (12 no total; nunca cria meses passados). Idempotente:
-- chamada pelo app ao abrir a tela inicial. Retorna quantas criou.
create or replace function public.ensure_monthly_tastings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first   date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_month   date;
  v_created int := 0;
  v_rows    int;
  v_names   text[] := array['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
                            'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
begin
  for v_month in
    select gs::date from generate_series(v_first, v_first + interval '11 months', interval '1 month') as gs
  loop
    -- Mês ocupado por um evento especial (ex.: confraternização): sem confraria
    continue when exists (select 1 from public.agenda_events e where e.replaces_month = v_month);
    insert into public.tastings (name, tasting_date, status, score_min, score_max, creator_token_hash, monthly_ref)
    values (format('Confraria de %s de %s', v_names[extract(month from v_month)::int], extract(year from v_month)::int),
            public._last_sunday(v_month), 'rascunho', 50, 100, null, v_month)
    on conflict (monthly_ref) where monthly_ref is not null do nothing;
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;
  return v_created;
end;
$$;

-- Assume uma degustação sem organizador com chave: o primeiro que chamar
-- recebe a chave (devolvida uma única vez); as chamadas seguintes falham.
create or replace function public.claim_tasting(p_tasting uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text := encode(gen_random_bytes(24), 'hex');
begin
  update public.tastings
     set creator_token_hash = encode(digest(v_token, 'sha256'), 'hex')
   where id = p_tasting and creator_token_hash is null and status <> 'finalizada';
  if not found then
    if not exists (select 1 from public.tastings where id = p_tasting) then
      raise exception 'Degustação não encontrada.';
    end if;
    raise exception 'Esta degustação já tem um organizador com a chave de controle.';
  end if;
  return jsonb_build_object('id', p_tasting, 'token', v_token);
end;
$$;

-- Tema da confraria: só quem tem a chave define; fica oculto até finalizar.
create or replace function public.set_tasting_theme(p_tasting uuid, p_token text, p_theme text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tastings;
begin
  t := public._assert_creator(p_tasting, p_token);
  if t.status = 'finalizada' then
    raise exception 'Degustação finalizada não pode ser alterada.';
  end if;
  if char_length(btrim(p_theme)) > 150 then
    raise exception 'O tema pode ter no máximo 150 caracteres.';
  end if;
  update public.tastings set theme = nullif(btrim(p_theme), '') where id = p_tasting;
end;
$$;

-- Organizadores: qualquer pessoa pode alterar até a degustação ser finalizada.
create or replace function public.set_tasting_organizers(p_tasting uuid, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tastings;
begin
  select * into t from public.tastings where id = p_tasting for update;
  if not found then
    raise exception 'Degustação não encontrada.';
  end if;
  if t.status = 'finalizada' then
    raise exception 'Degustação finalizada não pode ser alterada.';
  end if;
  p_ids := coalesce(p_ids, '{}');
  if cardinality(p_ids) > 10 then
    raise exception 'No máximo 10 organizadores.';
  end if;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) as x) then
    raise exception 'Um organizador não pode aparecer duas vezes.';
  end if;
  if exists (select 1 from unnest(p_ids) as x
             where not exists (select 1 from public.participants p where p.id = x)) then
    raise exception 'Participante não encontrado.';
  end if;
  update public.tastings set organizer_ids = p_ids where id = p_tasting;
  return public._organizers(p_ids);
end;
$$;

-- ---------------------------------------------------------------------
-- Execução das funções
-- ---------------------------------------------------------------------

revoke execute on function public._assert_creator(uuid, text)   from public, anon, authenticated;
revoke execute on function public._tasting_details(uuid)       from public, anon, authenticated;
revoke execute on function public._replace_wines(uuid, jsonb)  from public, anon, authenticated;

grant execute on function public.get_tasting_public(uuid)                                       to anon, authenticated;
grant execute on function public.get_tasting_admin(uuid, text)                                  to anon, authenticated;
grant execute on function public.create_tasting(text, date, text, numeric, numeric, jsonb)      to anon, authenticated;
grant execute on function public.save_tasting(uuid, text, text, date, text, numeric, numeric, jsonb) to anon, authenticated;
grant execute on function public.delete_tasting(uuid, text)                                     to anon, authenticated;
grant execute on function public.set_tasting_participants(uuid, text, uuid[])                   to anon, authenticated;
grant execute on function public.start_tasting(uuid, text)                                      to anon, authenticated;
grant execute on function public.save_guess(uuid, text, uuid, uuid, text, integer, text, numeric, numeric, text) to anon, authenticated;
grant execute on function public.finish_tasting(uuid, text)                                     to anon, authenticated;

revoke execute on function public._organizers(uuid[])          from public, anon, authenticated;
revoke execute on function public._last_sunday(date)           from public, anon, authenticated;
grant execute on function public.ensure_monthly_tastings()                 to anon, authenticated;
grant execute on function public.claim_tasting(uuid)                       to anon, authenticated;
grant execute on function public.set_tasting_organizers(uuid, uuid[])      to anon, authenticated;
grant execute on function public.set_tasting_theme(uuid, text, text)        to anon, authenticated;
