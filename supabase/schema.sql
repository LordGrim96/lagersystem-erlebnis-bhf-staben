-- Getränkelager Erlebnisbahnhof Staben – Datenbank-Schema für Supabase
-- Einmalig im Supabase-Dashboard unter "SQL Editor" komplett ausführen.

-- ---------- Tabellen ----------
create table if not exists public.artikel (
  id        uuid primary key default gen_random_uuid(),
  name      text not null check (length(trim(name)) > 0),
  sorte     text not null default '',
  ort       text not null default '',
  einheit   text not null default 'Flasche',   -- gezählt wird in Einzelstücken
  pro_kiste numeric not null default 0 check (pro_kiste >= 0),  -- nur Eingabehilfe für Lieferungen
  mindest   numeric not null default 0 check (mindest >= 0),
  bestand   numeric not null default 0 check (bestand >= 0),   -- im Lager
  mindest_waggon numeric not null default 0 check (mindest_waggon >= 0),
  waggon    numeric not null default 0 check (waggon >= 0),    -- im Waggon
  notiz     text not null default '',
  angelegt  timestamptz not null default now()
);

-- Falls die Tabelle schon aus einer älteren Version existiert
alter table public.artikel add column if not exists sorte text not null default '';
alter table public.artikel add column if not exists mindest_waggon numeric not null default 0 check (mindest_waggon >= 0);
alter table public.artikel add column if not exists waggon numeric not null default 0 check (waggon >= 0);
alter table public.artikel add column if not exists pro_kiste numeric not null default 0 check (pro_kiste >= 0);

-- Sicherheit: Textlängen begrenzen (verhindert, dass jemand riesige Texte einschleust)
alter table public.artikel drop constraint if exists artikel_laengen_check;
alter table public.artikel add constraint artikel_laengen_check check (
  length(name) <= 120 and length(sorte) <= 40 and length(ort) <= 60
  and length(einheit) <= 20 and length(notiz) <= 200) not valid;

create table if not exists public.buchungen (
  id              uuid primary key default gen_random_uuid(),
  artikel_id      uuid references public.artikel(id) on delete set null,
  artikel_name    text not null,           -- bleibt erhalten, falls der Artikel gelöscht wird
  typ             text not null,           -- ein = Lieferung, aus = Lager → Waggon, verkauf = im Waggon verkauft,
                                           -- korrektur = beim Zählen mehr im Waggon als gebucht
  menge           numeric not null check (menge > 0),
  bestand_danach  numeric not null,        -- Lager nach der Buchung
  waggon_danach   numeric,                 -- Waggon nach der Buchung
  person          text not null default '',
  notiz           text not null default '',
  datum           timestamptz not null default now(),
  benutzer        uuid default auth.uid()  -- wer angemeldet war
);
create index if not exists buchungen_datum_idx on public.buchungen (datum);

alter table public.buchungen add column if not exists waggon_danach numeric;
alter table public.buchungen drop constraint if exists buchungen_typ_check;
alter table public.buchungen add constraint buchungen_typ_check check (typ in ('ein', 'aus', 'verkauf', 'korrektur'));

-- ---------- Rollen: Admin und Mitarbeiter ----------
-- Admins dürfen alles. Mitarbeiter (alle ohne Eintrag hier) dürfen nur lesen und im Waggon
-- "verbraucht" buchen. Rollen werden nur über die Funktionen weiter unten gelesen/geändert.
create table if not exists public.rollen (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rolle   text not null default 'mitarbeiter' check (rolle in ('admin', 'mitarbeiter'))
);
create table if not exists public.aktivitaet (
  user_id uuid primary key references auth.users(id) on delete cascade,
  zuletzt timestamptz not null default now()
);
alter table public.rollen     enable row level security;
alter table public.aktivitaet enable row level security;
revoke all on public.rollen, public.aktivitaet from anon, authenticated;

create or replace function public.ist_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rollen where user_id = auth.uid() and rolle = 'admin');
$$;

-- Erster Admin: der zuerst angelegte Benutzer – nur solange es noch gar keinen Admin gibt.
-- (Weitere Admins legst du danach in der App unter Einstellungen → Benutzer fest.)
insert into public.rollen (user_id, rolle)
select id, 'admin' from auth.users
where not exists (select 1 from public.rollen where rolle = 'admin')
order by created_at
limit 1
on conflict (user_id) do update set rolle = 'admin';

-- ---------- Zugriffsregeln ----------
-- Nur angemeldete Benutzer dürfen lesen und schreiben.
-- Der Bestand lässt sich ausschließlich über die Funktion buchen() ändern,
-- und Buchungen können weder geändert noch gelöscht werden (lückenloser Verlauf).
alter table public.artikel   enable row level security;
alter table public.buchungen enable row level security;

revoke all on public.artikel, public.buchungen from anon, authenticated;
grant select, insert, delete on public.artikel to authenticated;
grant update (name, sorte, ort, einheit, pro_kiste, mindest, mindest_waggon, notiz) on public.artikel to authenticated;
grant select on public.buchungen to authenticated;

drop policy if exists "artikel lesen" on public.artikel;
drop policy if exists "artikel anlegen" on public.artikel;
drop policy if exists "artikel aendern" on public.artikel;
drop policy if exists "artikel loeschen" on public.artikel;
drop policy if exists "buchungen lesen" on public.buchungen;

create policy "artikel lesen"    on public.artikel for select to authenticated using (true);
create policy "artikel anlegen"  on public.artikel for insert to authenticated
  with check (public.ist_admin() and bestand = 0 and waggon = 0);
create policy "artikel aendern"  on public.artikel for update to authenticated
  using (public.ist_admin()) with check (public.ist_admin());
create policy "artikel loeschen" on public.artikel for delete to authenticated using (public.ist_admin());
create policy "buchungen lesen"  on public.buchungen for select to authenticated using (true);

-- ---------- Buchen (atomar, verhindert negativen Bestand in Lager und Waggon) ----------
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
  if p_typ not in ('ein', 'aus', 'verkauf', 'korrektur') then
    raise exception 'Ungültige Buchungsart.';
  end if;
  if p_menge is null or p_menge <= 0 then
    raise exception 'Bitte eine Menge größer 0 eingeben.';
  end if;
  if p_typ <> 'verkauf' and not public.ist_admin() then
    raise exception 'Nur Admins dürfen Lieferungen, Umbuchungen und Zählungen buchen.';
  end if;

  select * into a from public.artikel where id = p_artikel for update;
  if not found then
    raise exception 'Getränk nicht gefunden.';
  end if;
  if p_typ = 'aus' and p_menge > a.bestand then
    raise exception 'So viel ist nicht im Lager – vorhanden: % %.', trim_scale(a.bestand), a.einheit;
  end if;
  if p_typ = 'verkauf' and p_menge > a.waggon then
    raise exception 'So viel ist nicht im Waggon – vorhanden: % %.', trim_scale(a.waggon), a.einheit;
  end if;

  update public.artikel
     set bestand = bestand + case p_typ when 'ein' then p_menge when 'aus' then -p_menge else 0 end,
         waggon  = waggon  + case p_typ when 'aus' then p_menge when 'korrektur' then p_menge
                                         when 'verkauf' then -p_menge else 0 end
   where id = p_artikel
  returning * into a;

  insert into public.buchungen (artikel_id, artikel_name, typ, menge, bestand_danach, waggon_danach, person, notiz, benutzer)
  values (a.id, a.name, p_typ, p_menge, a.bestand, a.waggon,
          left(coalesce(trim(p_person), ''), 60), left(coalesce(trim(p_notiz), ''), 200), auth.uid())
  returning * into b;

  insert into public.aktivitaet (user_id, zuletzt) values (auth.uid(), now())
  on conflict (user_id) do update set zuletzt = excluded.zuletzt;

  return b;
end;
$$;

revoke all on function public.buchen(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.buchen(uuid, text, numeric, text, text) to authenticated;

-- ---------- Rollen & Aktivität: Funktionen für die App ----------
create or replace function public.meine_rolle() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select rolle from public.rollen where user_id = auth.uid()), 'mitarbeiter');
$$;

-- "Ich bin da": merkt sich, wann jemand die App zuletzt benutzt hat
create or replace function public.ich_bin_da() returns void
language sql security definer set search_path = public as $$
  insert into public.aktivitaet (user_id, zuletzt)
  select auth.uid(), now() where auth.uid() is not null
  on conflict (user_id) do update set zuletzt = excluded.zuletzt;
$$;

-- Benutzerliste für Admins: Rolle, letzte Anmeldung, zuletzt aktiv, letzte Buchung
create or replace function public.nutzer_liste()
returns table (id uuid, email text, rolle text, angelegt timestamptz,
               letzte_anmeldung timestamptz, zuletzt_aktiv timestamptz, letzte_buchung timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.ist_admin() then
    raise exception 'Nur für Admins.';
  end if;
  return query
    select u.id, u.email::text, coalesce(r.rolle, 'mitarbeiter'), u.created_at,
           u.last_sign_in_at, a.zuletzt,
           (select max(b.datum) from public.buchungen b where b.benutzer = u.id)
      from auth.users u
      left join public.rollen r on r.user_id = u.id
      left join public.aktivitaet a on a.user_id = u.id
     order by u.email;
end;
$$;

create or replace function public.rolle_setzen(p_user uuid, p_rolle text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ist_admin() then
    raise exception 'Nur für Admins.';
  end if;
  if p_rolle not in ('admin', 'mitarbeiter') then
    raise exception 'Ungültige Rolle.';
  end if;
  if p_rolle = 'mitarbeiter'
     and exists (select 1 from public.rollen where user_id = p_user and rolle = 'admin')
     and (select count(*) from public.rollen where rolle = 'admin') <= 1 then
    raise exception 'Es muss mindestens ein Admin bleiben.';
  end if;
  insert into public.rollen (user_id, rolle) values (p_user, p_rolle)
  on conflict (user_id) do update set rolle = excluded.rolle;
end;
$$;

revoke all on function public.ist_admin(), public.meine_rolle(), public.ich_bin_da(),
  public.nutzer_liste(), public.rolle_setzen(uuid, text) from public, anon;
grant execute on function public.ist_admin(), public.meine_rolle(), public.ich_bin_da(),
  public.nutzer_liste(), public.rolle_setzen(uuid, text) to authenticated;

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
