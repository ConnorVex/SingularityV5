-- Singularity character portal: tables, review flow and security rules.
--
-- Run once in the Supabase dashboard: SQL Editor → New query → paste this whole file → Run.
-- Then run 20261026120100_portal_seed.sql the same way.
--
-- How access works:
--   * Everyone (even logged out) can read the gallery, the universes and the canon claim board.
--   * A logged-in player can read and edit only their own characters and the review notes on them.
--   * Admins (Discord IDs listed in public.admins) can read everything, review characters
--     and edit the canon claim board.
-- Admin status is checked against the Discord identity Supabase stores at login
-- (auth.identities), which players cannot edit themselves.


-- ───────────────────────────── Types ─────────────────────────────

create type public.character_kind as enum ('oc', 'canon');

-- draft            : saved but not sent for review
-- pending          : waiting for an admin
-- approved         : accepted; shown in the gallery
-- needs_correction : sent back; the player edits and resubmits
-- denied           : final; the character is locked
create type public.character_status as enum ('draft', 'pending', 'approved', 'needs_correction', 'denied');

-- character : a canon character (one holder)
-- ability   : a canon Stand, Cursed Technique, Quirk, Ignition, Conduit, ...
create type public.claim_type as enum ('character', 'ability');


-- ───────────────────────────── Admins and profiles ─────────────────────────────

create table public.admins (
	discord_id text primary key check (discord_id ~ '^[0-9]{15,21}$'),
	label text not null default '',
	added_at timestamptz not null default now()
);

-- One row per player, filled from their Discord login by ensure_profile().
create table public.profiles (
	id uuid primary key references auth.users (id) on delete cascade,
	discord_id text not null unique,
	display_name text not null,
	avatar_url text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- True when the logged-in user's Discord account is listed in public.admins.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from auth.identities i
		join public.admins a on a.discord_id = i.provider_id
		where i.user_id = auth.uid()
			and i.provider = 'discord'
	);
$$;

-- Creates or refreshes the caller's profile from their Discord identity.
-- The site calls this after login; inserting a character also calls it.
create function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
	ident auth.identities;
	result public.profiles;
begin
	select * into ident
	from auth.identities
	where user_id = auth.uid() and provider = 'discord'
	order by created_at
	limit 1;

	if ident.user_id is null then
		raise exception 'Log in with Discord first.' using errcode = '42501';
	end if;

	insert into public.profiles (id, discord_id, display_name, avatar_url)
	values (
		ident.user_id,
		ident.provider_id,
		coalesce(
			nullif(ident.identity_data -> 'custom_claims' ->> 'global_name', ''),
			nullif(ident.identity_data ->> 'full_name', ''),
			nullif(ident.identity_data ->> 'name', ''),
			'Unknown player'
		),
		ident.identity_data ->> 'avatar_url'
	)
	on conflict (id) do update
		set discord_id = excluded.discord_id,
			display_name = excluded.display_name,
			avatar_url = excluded.avatar_url,
			updated_at = now()
	returning * into result;

	return result;
end;
$$;


-- ───────────────────────────── Universes ─────────────────────────────

-- The series with canon areas. slug matches the wiki, e.g. 'jujutsu-kaisen'.
create table public.universes (
	slug text primary key check (slug ~ '^[a-z0-9-]+$'),
	name text not null,
	ability_label text, -- what a claimable ability is called here, e.g. 'Stand'
	sort_order int not null default 0
);


-- ───────────────────────────── Characters ─────────────────────────────

create table public.characters (
	id uuid primary key default gen_random_uuid(),
	owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
	kind public.character_kind not null default 'oc',
	name text not null check (char_length(btrim(name)) between 1 and 100),
	-- For canon tryouts: which series. The canon character is `name`.
	canon_universe text references public.universes (slug) on update cascade,
	-- The whole character sheet (appearance, lore, aptitude, traits, systems, evolution log).
	sheet jsonb not null default '{}'::jsonb
		check (jsonb_typeof(sheet) = 'object' and octet_length(sheet::text) <= 200000),
	-- Canon abilities this character asks for (ids from public.claimables).
	requested_claims uuid[] not null default '{}' check (cardinality(requested_claims) <= 20),
	status public.character_status not null default 'draft',
	hidden boolean not null default false, -- admins can hide an approved character from the gallery
	submitted_at timestamptz,
	reviewed_at timestamptz,
	reviewed_by uuid references public.profiles (id) on delete set null,
	-- Copy of the sheet as it was last approved. The gallery shows this, so a pending
	-- evolution never replaces the public version until it is approved.
	approved_name text,
	approved_sheet jsonb,
	approved_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint canon_needs_universe check (kind = 'oc' or canon_universe is not null)
);

create index characters_owner_idx on public.characters (owner_id);
create index characters_status_idx on public.characters (status);

-- Keeps players inside the rules no matter what the browser sends, and records review details.
create function public.guard_character()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	-- SQL Editor / service code has no logged-in user role; admins are trusted too.
	trusted boolean := coalesce(auth.role(), '') not in ('anon', 'authenticated') or public.is_admin();
begin
	new.updated_at := now();

	if tg_op = 'INSERT' then
		if not trusted then
			perform public.ensure_profile();
			new.owner_id := auth.uid();
			if new.status not in ('draft', 'pending') then
				raise exception 'New characters can only be saved as a draft or sent for review.' using errcode = '42501';
			end if;
			new.hidden := false;
			new.reviewed_at := null;
			new.reviewed_by := null;
			new.approved_name := null;
			new.approved_sheet := null;
			new.approved_at := null;
		end if;
		new.submitted_at := case when new.status = 'pending' then now() end;
		return new;
	end if;

	-- UPDATE
	if not trusted then
		if old.status = 'denied' then
			raise exception 'This character was denied and is locked. Please create a new character.' using errcode = '42501';
		end if;
		if new.status not in ('draft', 'pending') then
			raise exception 'Only admins can approve, deny or send back a character.' using errcode = '42501';
		end if;
		-- Fields only admins (or the system) may change.
		new.owner_id := old.owner_id;
		new.hidden := old.hidden;
		new.submitted_at := old.submitted_at;
		new.reviewed_at := old.reviewed_at;
		new.reviewed_by := old.reviewed_by;
		new.approved_name := old.approved_name;
		new.approved_sheet := old.approved_sheet;
		new.approved_at := old.approved_at;
		-- Once approved, a character can't switch between OC and canon or change series.
		if old.approved_at is not null then
			new.kind := old.kind;
			new.canon_universe := old.canon_universe;
		end if;
	end if;

	if new.status = 'pending' and old.status is distinct from 'pending' then
		new.submitted_at := now();
	end if;

	if new.status is distinct from old.status and new.status in ('approved', 'needs_correction', 'denied') then
		new.reviewed_at := now();
		new.reviewed_by := auth.uid();
		if new.status = 'approved' then
			new.approved_name := new.name;
			new.approved_sheet := new.sheet;
			new.approved_at := now();
		end if;
	end if;

	return new;
end;
$$;

create trigger guard_character
	before insert or update on public.characters
	for each row execute function public.guard_character();


-- ───────────────────────────── Review notes ─────────────────────────────

create table public.review_notes (
	id uuid primary key default gen_random_uuid(),
	character_id uuid not null references public.characters (id) on delete cascade,
	author_id uuid default auth.uid() references public.profiles (id) on delete set null,
	-- The decision this note came with, or null for a plain comment.
	outcome public.character_status check (outcome in ('approved', 'needs_correction', 'denied')),
	body text not null default '' check (char_length(body) <= 10000),
	created_at timestamptz not null default now()
);

create index review_notes_character_idx on public.review_notes (character_id);


-- ───────────────────────────── Canon claim board ─────────────────────────────

-- Everything that can be claimed: canon characters and canon abilities.
create table public.claimables (
	id uuid primary key default gen_random_uuid(),
	universe text not null references public.universes (slug) on update cascade,
	claim_type public.claim_type not null,
	category text not null default '', -- e.g. 'Standard', 'Permission Based', 'Stardust Crusaders'
	name text not null check (char_length(btrim(name)) between 1 and 100),
	max_users int check (max_users is null or max_users >= 0), -- null = no limit
	-- Holders tracked by hand (for example everyone who claimed before the portal existed).
	manual_users int not null default 0 check (manual_users >= 0),
	note text not null default '',
	sort_order int not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create unique index claimables_unique_name on public.claimables (universe, claim_type, lower(name));

-- One row per character holding a claimable, added when the character is approved.
create table public.claims (
	id uuid primary key default gen_random_uuid(),
	claimable_id uuid not null references public.claimables (id) on delete cascade,
	character_id uuid references public.characters (id) on delete set null,
	holder_name text not null default '', -- kept even if the character is later removed
	counts_toward_limit boolean not null default true, -- admins can untick, e.g. canon characters on JJK techniques
	created_at timestamptz not null default now(),
	unique (claimable_id, character_id)
);

-- What the wiki's canon pages show: each claimable with how many slots are used.
create view public.claim_board
with (security_invoker = true)
as
select
	k.id,
	k.universe,
	k.claim_type,
	k.category,
	k.name,
	k.max_users,
	k.manual_users + (
		select count(*)::int from public.claims c
		where c.claimable_id = k.id and c.counts_toward_limit
	) as used_slots,
	k.note,
	k.sort_order
from public.claimables k;

-- Adds the canon claims for a character that has just been approved.
create function public.grant_claims(c public.characters)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	holder text;
	canon_id uuid;
begin
	select c.name || ' (' || p.display_name || ')' into holder
	from public.profiles p where p.id = c.owner_id;
	holder := coalesce(holder, c.name);

	if c.kind = 'canon' then
		insert into public.claimables (universe, claim_type, name, max_users)
		values (c.canon_universe, 'character', btrim(c.name), 1)
		on conflict (universe, claim_type, lower(name)) do update set updated_at = now()
		returning id into canon_id;

		insert into public.claims (claimable_id, character_id, holder_name)
		values (canon_id, c.id, holder)
		on conflict (claimable_id, character_id) do nothing;
	end if;

	insert into public.claims (claimable_id, character_id, holder_name)
	select k.id, c.id, holder
	from public.claimables k
	where k.id = any (c.requested_claims)
	on conflict (claimable_id, character_id) do nothing;
end;
$$;

-- Admin decision: approve, send back for correction, or deny, with a note for the player.
create function public.review_character(
	p_character_id uuid,
	p_outcome public.character_status,
	p_note text default ''
)
returns public.characters
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.characters;
begin
	if not public.is_admin() then
		raise exception 'Only admins can review characters.' using errcode = '42501';
	end if;
	if p_outcome is null or p_outcome not in ('approved', 'needs_correction', 'denied') then
		raise exception 'The decision must be approved, needs_correction or denied.';
	end if;
	perform public.ensure_profile(); -- the reviewer is recorded on the character and note


	update public.characters set status = p_outcome where id = p_character_id
	returning * into c;
	if c.id is null then
		raise exception 'Character not found.';
	end if;

	insert into public.review_notes (character_id, author_id, outcome, body)
	values (c.id, auth.uid(), p_outcome, coalesce(p_note, ''));

	if p_outcome = 'approved' then
		perform public.grant_claims(c);
	end if;

	return c;
end;
$$;


-- ───────────────────────────── Public gallery ─────────────────────────────

-- Approved, visible characters, showing their last approved version only.
-- Runs with the view owner's rights on purpose, so visitors see these columns and nothing else.
create view public.gallery as
select
	c.id,
	c.kind,
	c.canon_universe,
	c.approved_name as name,
	c.approved_sheet as sheet,
	c.approved_at,
	p.display_name as player_name,
	p.avatar_url as player_avatar
from public.characters c
join public.profiles p on p.id = c.owner_id
where c.approved_at is not null
	and not c.hidden
	and c.status <> 'denied';


-- ───────────────────────────── updated_at bookkeeping ─────────────────────────────

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

create trigger touch_claimables before update on public.claimables
	for each row execute function public.touch_updated_at();


-- ───────────────────────────── Row-level security ─────────────────────────────

alter table public.admins enable row level security;
alter table public.profiles enable row level security;
alter table public.universes enable row level security;
alter table public.characters enable row level security;
alter table public.review_notes enable row level security;
alter table public.claimables enable row level security;
alter table public.claims enable row level security;

-- Admins: only admins can see the list. Changes are made in the SQL Editor.
create policy "admins see admin list" on public.admins
	for select to authenticated using ((select public.is_admin()));

-- Profiles: you see your own; admins see everyone's. Written only by ensure_profile().
create policy "see own profile or admin" on public.profiles
	for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));

-- Universes: public to read, admins edit.
create policy "anyone reads universes" on public.universes
	for select to anon, authenticated using (true);
create policy "admins manage universes" on public.universes
	for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Characters: owners and admins only (the public uses the gallery view).
create policy "see own characters or admin" on public.characters
	for select to authenticated using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy "create own characters" on public.characters
	for insert to authenticated with check (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy "edit own characters or admin" on public.characters
	for update to authenticated
	using (owner_id = (select auth.uid()) or (select public.is_admin()))
	with check (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy "delete unapproved own characters or admin" on public.characters
	for delete to authenticated using (
		(select public.is_admin())
		or (owner_id = (select auth.uid()) and approved_at is null and status <> 'denied')
	);

-- Review notes: the character's owner can read them; only admins write them.
create policy "owner or admin reads notes" on public.review_notes
	for select to authenticated using (
		(select public.is_admin())
		or exists (
			select 1 from public.characters c
			where c.id = review_notes.character_id and c.owner_id = (select auth.uid())
		)
	);
create policy "admins write notes" on public.review_notes
	for insert to authenticated with check ((select public.is_admin()) and author_id = (select auth.uid()));
create policy "admins edit notes" on public.review_notes
	for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete notes" on public.review_notes
	for delete to authenticated using ((select public.is_admin()));

-- Claim board: public to read, admins edit by hand.
create policy "anyone reads claimables" on public.claimables
	for select to anon, authenticated using (true);
create policy "admins manage claimables" on public.claimables
	for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "anyone reads claims" on public.claims
	for select to anon, authenticated using (true);
create policy "admins manage claims" on public.claims
	for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));


-- ───────────────────────────── Grants ─────────────────────────────

-- Views: read-only for everyone.
revoke all on public.gallery, public.claim_board from anon, authenticated;
grant select on public.gallery, public.claim_board to anon, authenticated;

-- Logged-out visitors never touch these tables directly.
revoke all on public.admins, public.profiles, public.characters, public.review_notes from anon;

-- Functions the site may call. Everything else stays internal.
revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.ensure_profile() from public, anon, authenticated;
revoke execute on function public.review_character(uuid, public.character_status, text) from public, anon, authenticated;
revoke execute on function public.grant_claims(public.characters) from public, anon, authenticated;
revoke execute on function public.guard_character() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.ensure_profile() to authenticated;
grant execute on function public.review_character(uuid, public.character_status, text) to authenticated;
