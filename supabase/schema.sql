-- Getränkelager Erlebnisbahnhof Staben – Datenbank-Schema für Supabase
-- Einmalig im Supabase-Dashboard unter "SQL Editor" komplett ausführen.

-- ---------- Tabellen ----------
create table if not exists public.artikel (
  id        uuid primary key default gen_random_uuid(),
  name      text not null check (length(trim(name)) > 0),
  sorte     text not null default '',
  ort       text not null default '',
  einheit   text not null default 'Stück',
  mindest   numeric not null default 0 check (mindest >= 0),
  bestand   numeric not null default 0 check (bestand >= 0),
  notiz     text not null default '',
  angelegt  timestamptz not null default now()
);

-- Falls die Tabelle schon aus einer älteren Version existiert
alter table public.artikel add column if not exists sorte text not null default '';

create table if not exists public.buchungen (
  id              uuid primary key default gen_random_uuid(),
  artikel_id      uuid references public.artikel(id) on delete set null,
  artikel_name    text not null,           -- bleibt erhalten, falls der Artikel gelöscht wird
  typ             text not null check (typ in ('ein', 'aus')),
  menge           numeric not null check (menge > 0),
  bestand_danach  numeric not null,
  person          text not null default '',
  notiz           text not null default '',
  datum           timestamptz not null default now(),
  benutzer        uuid default auth.uid()  -- wer angemeldet war
);
create index if not exists buchungen_datum_idx on public.buchungen (datum);

-- ---------- Zugriffsregeln ----------
-- Nur angemeldete Benutzer dürfen lesen und schreiben.
-- Der Bestand lässt sich ausschließlich über die Funktion buchen() ändern,
-- und Buchungen können weder geändert noch gelöscht werden (lückenloser Verlauf).
alter table public.artikel   enable row level security;
alter table public.buchungen enable row level security;

revoke all on public.artikel, public.buchungen from anon, authenticated;
grant select, insert, delete on public.artikel to authenticated;
grant update (name, sorte, ort, einheit, mindest, notiz) on public.artikel to authenticated;
grant select on public.buchungen to authenticated;

drop policy if exists "artikel lesen" on public.artikel;
drop policy if exists "artikel anlegen" on public.artikel;
drop policy if exists "artikel aendern" on public.artikel;
drop policy if exists "artikel loeschen" on public.artikel;
drop policy if exists "buchungen lesen" on public.buchungen;

create policy "artikel lesen"    on public.artikel for select to authenticated using (true);
create policy "artikel anlegen"  on public.artikel for insert to authenticated with check (bestand = 0);
create policy "artikel aendern"  on public.artikel for update to authenticated using (true) with check (true);
create policy "artikel loeschen" on public.artikel for delete to authenticated using (true);
create policy "buchungen lesen"  on public.buchungen for select to authenticated using (true);

-- ---------- Buchen (atomar, verhindert negativen Bestand) ----------
create or replace function public.buchen(
  p_artikel uuid,
  p_typ     text,
  p_menge   numeric,
  p_person  text default '',
  p_notiz   text default ''
) returns public.buchungen
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.artikel;
  b public.buchungen;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if p_typ not in ('ein', 'aus') then
    raise exception 'Ungültige Buchungsart.';
  end if;
  if p_menge is null or p_menge <= 0 then
    raise exception 'Bitte eine Menge größer 0 eingeben.';
  end if;

  select * into a from public.artikel where id = p_artikel for update;
  if not found then
    raise exception 'Artikel nicht gefunden.';
  end if;
  if p_typ = 'aus' and p_menge > a.bestand then
    raise exception 'Nicht genug auf Lager – verfügbar: % %.', trim_scale(a.bestand), a.einheit;
  end if;

  update public.artikel
     set bestand = bestand + case when p_typ = 'ein' then p_menge else -p_menge end
   where id = p_artikel
  returning * into a;

  insert into public.buchungen (artikel_id, artikel_name, typ, menge, bestand_danach, person, notiz, benutzer)
  values (a.id, a.name, p_typ, p_menge, a.bestand,
          coalesce(trim(p_person), ''), coalesce(trim(p_notiz), ''), auth.uid())
  returning * into b;

  return b;
end;
$$;

revoke all on function public.buchen(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.buchen(uuid, text, numeric, text, text) to authenticated;

-- ---------- Live-Abgleich zwischen Geräten ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'artikel') then
    alter publication supabase_realtime add table public.artikel;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'buchungen') then
    alter publication supabase_realtime add table public.buchungen;
  end if;
end $$;
