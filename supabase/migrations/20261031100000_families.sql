-- Singularity Family System: player-run families, their rosters, relations and perks.
--
-- Run once in the SQL Editor after the earlier portal files.
--
-- How access works:
--   * Everyone (even logged out) can read approved families, their divisions, active members,
--     relations, and approved perks (members-only perks show as locked to everyone else).
--   * A logged-in player can found ONE family. It starts 'pending' until an admin approves it.
--   * The family's owner edits its page, divisions, roster and relations without review.
--     Name, owner, special statuses (e.g. Monarch Family) and perk approval are admin-only.
--   * Any player can ask to join a family with one of their approved characters; the owner
--     accepts (status 'active') or declines (row deleted). Leaving or being kicked deletes the row.
--   * Perks are proposed by the owner and approved by an admin, including whether a perk is
--     hidden from everyone but the family's members.


-- ───────────────────────────── Types ─────────────────────────────

-- pending          : waiting for an admin
-- approved         : listed in the directory
-- needs_correction : sent back; the owner edits and resubmits
-- denied           : final
create type public.family_status as enum ('pending', 'approved', 'needs_correction', 'denied');

create type public.family_standing as enum ('sister', 'allies', 'friendly', 'neutral', 'uneasy', 'hostile', 'mortal_enemies');


-- ───────────────────────────── Tables ─────────────────────────────

create table public.families (
	id uuid primary key default gen_random_uuid(),
	slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	name text not null check (char_length(btrim(name)) between 1 and 80),
	-- The player who runs the family. Admins can hand a family to another player.
	owner_id uuid default auth.uid() references public.profiles (id) on delete set null,
	status public.family_status not null default 'pending',
	head_name text not null default '' check (char_length(head_name) <= 100),
	description text not null default '' check (char_length(description) <= 600),
	lore text not null default '' check (char_length(lore) <= 12000),
	race text not null default '' check (char_length(race) <= 80),
	specialty text not null default '' check (char_length(specialty) <= 160),
	found_in text not null default 'mainland' check (found_in in ('mainland', 'outworld', 'both')),
	banner_url text not null default '' check (banner_url = '' or banner_url ~ '^https://'),
	colour text not null default '#20e0a0' check (colour ~ '^#[0-9a-fA-F]{6}$'),
	recruiting text not null default 'closed' check (recruiting in ('open', 'tryouts', 'closed')),
	discord_url text not null default '' check (discord_url = '' or discord_url ~ '^https://(www\.)?(discord\.gg|discord\.com)/'),
	home text not null default '' check (char_length(home) <= 6000),
	-- Set by admins only, e.g. 'Monarch Family', 'Exclusive Access'.
	special_statuses text[] not null default '{}' check (cardinality(special_statuses) <= 6),
	review_note text not null default '',
	submitted_at timestamptz default now(),
	reviewed_at timestamptz,
	reviewed_by uuid references public.profiles (id) on delete set null,
	approved_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- One family per player (denied ones don't count).
create unique index families_one_per_owner on public.families (owner_id) where status <> 'denied';

create table public.family_divisions (
	id uuid primary key default gen_random_uuid(),
	family_id uuid not null references public.families (id) on delete cascade,
	name text not null check (char_length(btrim(name)) between 1 and 80),
	description text not null default '' check (char_length(description) <= 2000),
	-- Open spots are shown as "Open spot · Tryouts". head_open: the division's head is an open spot.
	open_spots int not null default 0 check (open_spots between 0 and 50),
	head_open boolean not null default false,
	sort int not null default 0
);
create index family_divisions_family_idx on public.family_divisions (family_id);

-- A roster entry. character_id links a portal character; rows without one are roster names the
-- owner typed in (e.g. members from before the portal).
create table public.family_members (
	id uuid primary key default gen_random_uuid(),
	family_id uuid not null references public.families (id) on delete cascade,
	character_id uuid references public.characters (id) on delete cascade,
	requested_by uuid references public.profiles (id) on delete set null,
	status text not null default 'requested' check (status in ('requested', 'active')),
	name text not null check (char_length(btrim(name)) between 1 and 100),
	division_id uuid references public.family_divisions (id) on delete set null,
	-- e.g. 'Head of Family', 'Head' (of a division)
	title text not null default '' check (char_length(title) <= 60),
	-- Relationship to the Head of Family, e.g. 'Spouse', 'Daughter', "'Brother'"
	relationship text not null default '' check (char_length(relationship) <= 60),
	image_url text not null default '' check (image_url = '' or image_url ~ '^https://'),
	message text not null default '' check (char_length(message) <= 500),
	sort int not null default 0,
	created_at timestamptz not null default now(),
	unique (family_id, character_id)
);
create index family_members_family_idx on public.family_members (family_id);
create index family_members_character_idx on public.family_members (character_id);

-- This family's standing towards another family. other_name is always set, so families that
-- aren't on the site yet can be listed; other_family_id links one that is.
create table public.family_relations (
	id uuid primary key default gen_random_uuid(),
	family_id uuid not null references public.families (id) on delete cascade,
	other_family_id uuid references public.families (id) on delete set null,
	other_name text not null check (char_length(btrim(other_name)) between 1 and 80),
	standing public.family_standing not null,
	note text not null default '' check (char_length(note) <= 300),
	sort int not null default 0
);
create index family_relations_family_idx on public.family_relations (family_id);

-- What standings mean for this family, e.g. Allies → "may enter the High-rise lobby".
create table public.family_standing_notes (
	family_id uuid not null references public.families (id) on delete cascade,
	standing public.family_standing not null,
	note text not null check (char_length(note) <= 400),
	primary key (family_id, standing)
);

create table public.family_perks (
	id uuid primary key default gen_random_uuid(),
	family_id uuid not null references public.families (id) on delete cascade,
	-- What the perk gives. See PERK_KINDS in src/lib/families/api.ts for the labels.
	kind text not null check (kind in ('starting_stats', 'trait', 'trait_slots', 'system_start', 'locked_power',
		'technique', 'fighting_style', 'item', 'rolls', 'progression', 'economy', 'social', 'other')),
	-- How a member gets it: every member, members pick it, rolled for, earned in RP, or taught by a member.
	access text not null default 'automatic' check (access in ('automatic', 'choice', 'rolled', 'earned', 'taught')),
	title text not null check (char_length(btrim(title)) between 1 and 100),
	description text not null default '' check (char_length(description) <= 8000),
	-- Members only: everyone else sees a locked card. Approved by an admin like the rest of the perk.
	hidden boolean not null default false,
	status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
	review_note text not null default '',
	created_at timestamptz not null default now(),
	reviewed_at timestamptz,
	reviewed_by uuid references public.profiles (id) on delete set null
);
create index family_perks_family_idx on public.family_perks (family_id);


-- ───────────────────────────── Helpers ─────────────────────────────

-- True when the logged-in player owns this family.
create function public.is_family_owner(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (select 1 from public.families f where f.id = fid and f.owner_id = auth.uid());
$$;

-- Approved families are public; owners and admins also see their own pending ones.
create function public.can_see_family(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.families f
		where f.id = fid
			and (f.status = 'approved' or f.owner_id = auth.uid() or public.is_admin())
	);
$$;

-- True when one of the logged-in player's characters is an active member.
create function public.is_family_member(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.family_members m
		join public.characters c on c.id = m.character_id
		where m.family_id = fid and m.status = 'active' and c.owner_id = auth.uid()
	);
$$;

-- 'Brando Clan' → 'brando-clan', made unique with a number if needed.
create function public.family_slug(p_name text, p_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
	base text := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
	candidate text;
	n int := 1;
begin
	if base = '' then base := 'family'; end if;
	candidate := base;
	while exists (select 1 from public.families where slug = candidate and id <> p_id) loop
		n := n + 1;
		candidate := base || '-' || n;
	end loop;
	return candidate;
end;
$$;


-- ───────────────────────────── Guards ─────────────────────────────

-- Keeps owners inside the rules no matter what the browser sends.
create function public.guard_family()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	admin boolean := public.is_admin();
begin
	new.updated_at := now();
	if tg_op = 'INSERT' then
		if not admin then
			perform public.ensure_profile();
			new.owner_id := auth.uid();
			new.status := 'pending';
			new.special_statuses := '{}';
			new.review_note := '';
			new.reviewed_at := null;
			new.reviewed_by := null;
			new.approved_at := null;
		end if;
		new.submitted_at := now();
		new.slug := public.family_slug(new.name, new.id);
		return new;
	end if;

	if admin then
		if new.name is distinct from old.name then
			new.slug := public.family_slug(new.name, new.id);
		end if;
		return new;
	end if;

	-- Owners: these stay as they are.
	new.id := old.id;
	new.slug := old.slug;
	new.owner_id := old.owner_id;
	new.special_statuses := old.special_statuses;
	new.review_note := old.review_note;
	new.reviewed_at := old.reviewed_at;
	new.reviewed_by := old.reviewed_by;
	new.approved_at := old.approved_at;
	new.created_at := old.created_at;

	-- The name only changes while the family is still being reviewed.
	if old.status = 'approved' then
		new.name := old.name;
	elsif new.name is distinct from old.name then
		new.slug := public.family_slug(new.name, new.id);
	end if;

	-- Status: an owner can only resend a family that was sent back.
	if new.status is distinct from old.status then
		if old.status = 'needs_correction' and new.status = 'pending' then
			new.submitted_at := now();
		else
			raise exception 'Only an admin can change a family''s status.' using errcode = '42501';
		end if;
	end if;
	if old.status = 'denied' then
		raise exception 'This family was denied and is locked.' using errcode = '42501';
	end if;
	return new;
end;
$$;

create trigger guard_family before insert or update on public.families
	for each row execute function public.guard_family();

-- Join requests: a player may only ask for their own approved character, and only as 'requested'.
-- Owners and admins manage everything else.
create function public.guard_family_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	ch public.characters;
	manager boolean := public.is_admin() or public.is_family_owner(new.family_id);
begin
	if tg_op = 'UPDATE' then
		new.family_id := old.family_id;
		new.character_id := old.character_id;
		new.requested_by := old.requested_by;
		new.created_at := old.created_at;
		return new;
	end if;

	if new.character_id is not null then
		select * into ch from public.characters where id = new.character_id;
		if ch.id is null or ch.approved_at is null or ch.status = 'denied' then
			raise exception 'Only approved characters can join a family.' using errcode = '42501';
		end if;
		new.name := coalesce(nullif(ch.approved_name, ''), ch.name);
		if ch.owner_id = auth.uid() and not manager then
			-- A player's own request.
			new.status := 'requested';
			new.requested_by := auth.uid();
			new.division_id := null;
			new.title := '';
			new.relationship := '';
			new.sort := 0;
			return new;
		elsif ch.owner_id = auth.uid() and public.is_family_owner(new.family_id) then
			-- The owner adding their own character joins straight away.
			new.status := 'active';
			new.requested_by := auth.uid();
			return new;
		elsif not public.is_admin() then
			raise exception 'You can only ask to join with your own characters.' using errcode = '42501';
		end if;
		new.requested_by := coalesce(new.requested_by, ch.owner_id);
		return new;
	end if;

	-- A typed-in roster name: owners and admins only, always active.
	if not manager then
		raise exception 'Only the family''s owner can add roster names.' using errcode = '42501';
	end if;
	new.status := 'active';
	return new;
end;
$$;

create trigger guard_family_member before insert or update on public.family_members
	for each row execute function public.guard_family_member();

-- Perks: owners propose (always pending, re-pending on edit); admins decide.
create function public.guard_family_perk()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if public.is_admin() then
		if tg_op = 'UPDATE' and new.status is distinct from old.status then
			new.reviewed_at := now();
			new.reviewed_by := auth.uid();
		end if;
		return new;
	end if;
	new.status := 'pending';
	new.review_note := case when tg_op = 'UPDATE' then old.review_note else '' end;
	new.reviewed_at := case when tg_op = 'UPDATE' then old.reviewed_at else null end;
	new.reviewed_by := case when tg_op = 'UPDATE' then old.reviewed_by else null end;
	if tg_op = 'UPDATE' then
		new.family_id := old.family_id;
		new.created_at := old.created_at;
	end if;
	return new;
end;
$$;

create trigger guard_family_perk before insert or update on public.family_perks
	for each row execute function public.guard_family_perk();

-- Admin decision on a family.
create function public.review_family(p_family uuid, p_outcome public.family_status, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can review families.' using errcode = '42501';
	end if;
	if p_outcome = 'pending' then
		raise exception 'Choose approved, needs_correction or denied.';
	end if;
	update public.families
	set status = p_outcome,
		review_note = coalesce(p_note, ''),
		reviewed_at = now(),
		reviewed_by = auth.uid(),
		approved_at = case when p_outcome = 'approved' then coalesce(approved_at, now()) else approved_at end
	where id = p_family;
	if not found then
		raise exception 'Family not found.';
	end if;
end;
$$;


-- ───────────────────────────── Public view of perks ─────────────────────────────

-- Approved perks of approved families. A hidden perk is only readable by the family's members,
-- its owner and admins; everyone else gets the row with its details blanked (shown as locked).
create view public.family_perk_board
with (security_invoker = false) as
select p.id, p.family_id, p.hidden, p.created_at,
	(not p.hidden or v.ok) as unlocked,
	case when not p.hidden or v.ok then p.kind end as kind,
	case when not p.hidden or v.ok then p.access end as access,
	case when not p.hidden or v.ok then p.title else '' end as title,
	case when not p.hidden or v.ok then p.description else '' end as description
from public.family_perks p
join public.families f on f.id = p.family_id
cross join lateral (
	select (public.is_family_member(f.id) or f.owner_id = auth.uid() or public.is_admin()) as ok
) v
where p.status = 'approved'
	and f.status = 'approved';


-- Owner names for approved families (profiles themselves stay private).
create view public.family_owners
with (security_invoker = false) as
select f.id as family_id, p.display_name, p.avatar_url
from public.families f
join public.profiles p on p.id = f.owner_id
where f.status = 'approved';


-- ───────────────────────────── Notifications ─────────────────────────────

create function public.notify_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	player_id text;
	who text;
	fname text := public.discord_escape(new.name);
begin
	select p.discord_id into player_id from public.profiles p where p.id = new.owner_id;
	who := case when player_id is not null then '<@' || player_id || '>' else 'A player' end;

	if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
		perform public.discord_post('discord_staff_webhook', jsonb_build_object(
			'content', case when tg_op = 'UPDATE' then '🔁 Family resubmitted after correction' else '🏯 New family sent for review' end,
			'embeds', jsonb_build_array(jsonb_build_object(
				'title', left(new.name, 250),
				'url', public.portal_site_url() || '/families/admin/',
				'description', 'by ' || who,
				'color', ('x' || substr(new.colour, 2))::bit(24)::int
			)),
			'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
		));
	end if;

	if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'needs_correction', 'denied') then
		perform public.discord_post('discord_public_webhook', jsonb_build_object(
			'content', case new.status
				when 'approved' then who || ', your family **' || fname || '** has been approved!'
				when 'needs_correction' then who || ', your family **' || fname || '** needs some changes. Check the admin note on its page.'
				else who || ', your family **' || fname || '** has been denied.'
			end,
			'allowed_mentions', case when player_id is not null
				then jsonb_build_object('users', jsonb_build_array(player_id))
				else jsonb_build_object('parse', '[]'::jsonb) end
		));
	end if;
	return null;
end;
$$;

create trigger notify_family
	after insert or update of status on public.families
	for each row execute function public.notify_family();

create function public.notify_family_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
	ping text;
	text_out text;
begin
	select * into fam from public.families where id = new.family_id;
	if tg_op = 'INSERT' and new.status = 'requested' then
		select p.discord_id into ping from public.profiles p where p.id = fam.owner_id;
		text_out := coalesce('<@' || ping || '>', 'The owner') || ', **' || public.discord_escape(new.name)
			|| '** asked to join **' || public.discord_escape(fam.name) || '**.';
	elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'active' then
		select p.discord_id into ping from public.profiles p where p.id = new.requested_by;
		text_out := coalesce('<@' || ping || '>', 'A player') || ', **' || public.discord_escape(new.name)
			|| '** has been accepted into **' || public.discord_escape(fam.name) || '**!';
	else
		return null;
	end if;
	perform public.discord_post('discord_public_webhook', jsonb_build_object(
		'content', text_out,
		'embeds', jsonb_build_array(jsonb_build_object(
			'title', left(fam.name, 250),
			'url', public.portal_site_url() || '/families/view/?f=' || fam.slug
		)),
		'allowed_mentions', case when ping is not null
			then jsonb_build_object('users', jsonb_build_array(ping))
			else jsonb_build_object('parse', '[]'::jsonb) end
	));
	return null;
end;
$$;

create trigger notify_family_member
	after insert or update of status on public.family_members
	for each row execute function public.notify_family_member();

create function public.notify_family_perk()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
begin
	if new.status <> 'pending' or (tg_op = 'UPDATE' and old.status = 'pending'
		and (old.title, old.description, old.kind, old.access, old.hidden) = (new.title, new.description, new.kind, new.access, new.hidden)) then
		return null;
	end if;
	select * into fam from public.families where id = new.family_id;
	perform public.discord_post('discord_staff_webhook', jsonb_build_object(
		'content', '✨ Family perk sent for review',
		'embeds', jsonb_build_array(jsonb_build_object(
			'title', left(new.title, 250),
			'url', public.portal_site_url() || '/families/admin/',
			'description', public.discord_escape(fam.name) || ' · ' || replace(new.kind, '_', ' ')
				|| case when new.hidden then ' · 🔒 members only' else '' end
		)),
		'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
	));
	return null;
end;
$$;

create trigger notify_family_perk
	after insert or update on public.family_perks
	for each row execute function public.notify_family_perk();


-- ───────────────────────────── Row-level security ─────────────────────────────

alter table public.families enable row level security;
alter table public.family_divisions enable row level security;
alter table public.family_members enable row level security;
alter table public.family_relations enable row level security;
alter table public.family_standing_notes enable row level security;
alter table public.family_perks enable row level security;

-- Families
create policy "read approved, own or admin" on public.families
	for select to anon, authenticated
	using (status = 'approved' or owner_id = (select auth.uid()) or (select public.is_admin()));
create policy "found a family" on public.families
	for insert to authenticated
	with check (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy "owner or admin edits" on public.families
	for update to authenticated
	using (owner_id = (select auth.uid()) or (select public.is_admin()))
	with check (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy "admin or owner of an unapproved family deletes" on public.families
	for delete to authenticated
	using ((select public.is_admin()) or (owner_id = (select auth.uid()) and approved_at is null));

-- Divisions, relations and standing notes: readable with the family, edited by its owner.
create policy "read with family" on public.family_divisions
	for select to anon, authenticated using (public.can_see_family(family_id));
create policy "owner or admin manages" on public.family_divisions
	for all to authenticated
	using (public.is_family_owner(family_id) or (select public.is_admin()))
	with check (public.is_family_owner(family_id) or (select public.is_admin()));

create policy "read with family" on public.family_relations
	for select to anon, authenticated using (public.can_see_family(family_id));
create policy "owner or admin manages" on public.family_relations
	for all to authenticated
	using (public.is_family_owner(family_id) or (select public.is_admin()))
	with check (public.is_family_owner(family_id) or (select public.is_admin()));

create policy "read with family" on public.family_standing_notes
	for select to anon, authenticated using (public.can_see_family(family_id));
create policy "owner or admin manages" on public.family_standing_notes
	for all to authenticated
	using (public.is_family_owner(family_id) or (select public.is_admin()))
	with check (public.is_family_owner(family_id) or (select public.is_admin()));

-- Members: active ones are public; requests are seen by the owner, the requester and admins.
create policy "read roster" on public.family_members
	for select to anon, authenticated
	using (
		(status = 'active' and public.can_see_family(family_id))
		or requested_by = (select auth.uid())
		or public.is_family_owner(family_id)
		or (select public.is_admin())
	);
create policy "ask to join or owner adds" on public.family_members
	for insert to authenticated
	with check (
		public.is_family_owner(family_id)
		or (select public.is_admin())
		or (
			character_id is not null
			and exists (select 1 from public.families f where f.id = family_id and f.status = 'approved')
		)
	);
create policy "owner or admin edits roster" on public.family_members
	for update to authenticated
	using (public.is_family_owner(family_id) or (select public.is_admin()))
	with check (public.is_family_owner(family_id) or (select public.is_admin()));
-- Owners remove anyone; players withdraw a request or leave with their own character.
create policy "remove from roster" on public.family_members
	for delete to authenticated
	using (
		public.is_family_owner(family_id)
		or (select public.is_admin())
		or exists (select 1 from public.characters c where c.id = character_id and c.owner_id = (select auth.uid()))
	);

-- Perks: the owner and admins see them all (the public uses family_perk_board).
create policy "owner or admin reads perks" on public.family_perks
	for select to authenticated using (public.is_family_owner(family_id) or (select public.is_admin()));
create policy "owner proposes perks" on public.family_perks
	for insert to authenticated with check (public.is_family_owner(family_id) or (select public.is_admin()));
create policy "owner or admin edits perks" on public.family_perks
	for update to authenticated
	using (public.is_family_owner(family_id) or (select public.is_admin()))
	with check (public.is_family_owner(family_id) or (select public.is_admin()));
create policy "owner or admin deletes perks" on public.family_perks
	for delete to authenticated using (public.is_family_owner(family_id) or (select public.is_admin()));


-- ───────────────────────────── Grants ─────────────────────────────

revoke all on public.family_perk_board, public.family_owners from anon, authenticated;
grant select on public.family_perk_board, public.family_owners to anon, authenticated;

revoke all on public.family_perks from anon;
revoke insert, update, delete on public.families, public.family_divisions, public.family_members,
	public.family_relations, public.family_standing_notes from anon;

-- The helpers only answer about the caller, so policies and views may use them for anyone.
revoke execute on function public.is_family_owner(uuid) from public;
revoke execute on function public.can_see_family(uuid) from public;
revoke execute on function public.is_family_member(uuid) from public;
revoke execute on function public.family_slug(text, uuid) from public, anon;
revoke execute on function public.guard_family() from public, anon, authenticated;
revoke execute on function public.guard_family_member() from public, anon, authenticated;
revoke execute on function public.guard_family_perk() from public, anon, authenticated;
revoke execute on function public.review_family(uuid, public.family_status, text) from public, anon, authenticated;
revoke execute on function public.notify_family() from public, anon, authenticated;
revoke execute on function public.notify_family_member() from public, anon, authenticated;
revoke execute on function public.notify_family_perk() from public, anon, authenticated;

grant execute on function public.is_family_owner(uuid) to anon, authenticated;
grant execute on function public.can_see_family(uuid) to anon, authenticated;
grant execute on function public.is_family_member(uuid) to anon, authenticated;
-- Called by the guard trigger, which runs as the player.
grant execute on function public.family_slug(text, uuid) to authenticated;
grant execute on function public.review_family(uuid, public.family_status, text) to authenticated;


-- ───────────────────────────── Seed: the Brando Clan ─────────────────────────────
-- No owner yet: an admin assigns one from the Families admin page.

do $$
declare
	fid uuid;
	primary_d uuid;
	vigilante_d uuid;
	hero_d uuid;
	sorcerer_d uuid;
begin
	-- Seeding runs as the SQL Editor's superuser, so is_admin() is false: bypass the owner guard.
	alter table public.families disable trigger guard_family;
	alter table public.families disable trigger notify_family;
	alter table public.family_members disable trigger guard_family_member;
	alter table public.family_members disable trigger notify_family_member;

	insert into public.families (slug, name, owner_id, status, head_name, description, lore, race, specialty, found_in,
		colour, recruiting, discord_url, home, special_statuses, approved_at)
	values (
		'brando-clan', 'Brando Clan', null, 'approved', 'Brando O. Connor',
		'A Monarch Family that has existed since the beginning of the Mainland, and one of its most powerful clans. Its members can tear apart entire Zones with their bare hands.',
		E'Nobody knows where the Brando Clan came from, only that it has made itself the **best of the best**. Its past is shrouded in mystery, so it''s hard to tell when it grew so powerful.\n\nWhat everyone agrees on is that the Brando Clan is where **Legends** are born. From the **Silver Comet** to the **Terrible Tornado**, and even **The Symbol of Freedom**, the clan has cemented itself as the home of the **Strongest**.\n\nAs a **Monarch Family**, it is one of only three families that run things on the Mainland.',
		'Yokai', 'Sorcery, Heroism, Vigilantism', 'both',
		'#d4a017', 'tryouts', 'https://discord.gg/UFGRgkRQtX',
		E'The **Brando Clan High-rises** are two sprawling buildings in the **Japan Zone**, joined by a sky bridge. They''re the tallest buildings in the Zone, just a few feet taller than the **Monarch Solutions HQ**.\n\nThe office buildings once belonged to a huge company that went bankrupt, until the current Head bought them as the clan''s home and hub. They''re heavily guarded, with security that could gun down a **speedster**, or even a security officer.',
		array['Monarch Family', 'Exclusive Access'], now()
	)
	returning id into fid;

	insert into public.family_divisions (family_id, name, description, sort) values
		(fid, 'Primary Phalanx', 'Members who could become Head of the Family if something happened to the acting head. If the head is put out of commission, they hold executive power in family politics.', 1)
		returning id into primary_d;
	insert into public.family_divisions (family_id, name, description, sort) values
		(fid, 'Vigilante Phalanx', 'Specialists in vigilantism, each holding a top spot, with no care for the laws of the Mainland. The most dangerous Phalanx after the Primary.', 2)
		returning id into vigilante_d;
	insert into public.family_divisions (family_id, name, description, sort) values
		(fid, 'Hero Phalanx', 'Dedicated to heroism. They sit at the top of the Leaderboard and fight for a world where villainy can''t thrive. They follow the law, but will step outside it if they have to.', 3)
		returning id into hero_d;
	insert into public.family_divisions (family_id, name, description, open_spots, head_open, sort) values
		(fid, 'Sorcerer Phalanx', 'Specialists in Jujutsu Sorcery, and the Brandos you''ll see most, since they handle the more troublesome Cursed Spirits. They''ll still answer a villain attack. Be warned: this group is rather aggressive.', 3, true, 4)
		returning id into sorcerer_d;

	insert into public.family_members (family_id, status, name, division_id, title, relationship, sort) values
		(fid, 'active', 'Brando O. Connor', primary_d, 'Head of Family', '', 1),
		(fid, 'active', 'Kozuki-Brando Izuna', primary_d, '', 'Younger Sister', 2),
		(fid, 'active', 'Brando Echo', primary_d, '', 'Spouse', 3),
		(fid, 'active', 'Brando Ignis', primary_d, '', 'Spouse', 4),
		(fid, 'active', 'Brando Negaha', primary_d, '', 'Spouse', 5),
		(fid, 'active', 'Brando Nemuri', primary_d, '', 'Spouse', 6),
		(fid, 'active', 'Brando Ryuko', primary_d, '', 'Spouse', 7),
		(fid, 'active', 'Brando Kita', primary_d, '', 'Spouse', 8),
		(fid, 'active', 'Brando Ritsu', primary_d, '', 'Spouse', 9),
		(fid, 'active', 'Ozure A. Rukia', primary_d, '', '''Sister''', 10),
		(fid, 'active', 'Gojo Satoru', primary_d, '', '''Brother''', 11),
		(fid, 'active', 'Brando Senju', primary_d, '', 'Daughter', 12),
		(fid, 'active', 'Brando Kiiko', primary_d, '', 'Daughter', 13),
		(fid, 'active', 'Brando Asuka', primary_d, '', 'Daughter', 14),
		(fid, 'active', 'Brando Aelita', primary_d, '', 'Daughter', 15),
		(fid, 'active', 'Brando Intonja', primary_d, '', 'Daughter', 16),
		(fid, 'active', 'Brando Denia', primary_d, '', 'Daughter', 17),
		(fid, 'active', 'Brando Charlotte', vigilante_d, 'Head', '', 1),
		(fid, 'active', 'Brando Kin', vigilante_d, '', '', 2),
		(fid, 'active', 'Brando Hex', vigilante_d, '', '', 3),
		(fid, 'active', 'Brando Nevieta', vigilante_d, '', '', 4),
		(fid, 'active', 'Brando Fumiko', vigilante_d, '', '', 5),
		(fid, 'active', 'Brando Reagan', hero_d, 'Head', '', 1),
		(fid, 'active', 'Brando Fubuki', hero_d, '', '', 2),
		(fid, 'active', 'Brando Tatsumaki', hero_d, '', '', 3),
		(fid, 'active', 'Brando Jenos', hero_d, '', '', 4),
		(fid, 'active', 'Ozure-Brando Mephisto', hero_d, '', '', 5),
		(fid, 'active', 'Brando Kasumi', sorcerer_d, '', '', 1),
		(fid, 'active', 'Brando Toshi', sorcerer_d, '', '', 2);

	insert into public.family_relations (family_id, other_name, standing, note, sort) values
		(fid, 'Gojo Clan', 'sister', 'Distant cousins', 1),
		(fid, 'Medaka Bloodline', 'sister', '', 2),
		(fid, 'Hieko Clan', 'sister', '', 3),
		(fid, 'Ozure Clan', 'sister', 'Closely related. Work in progress', 4),
		(fid, 'Kinji Clan', 'allies', '', 5),
		(fid, 'Inumaki Clan', 'allies', '', 6),
		(fid, 'Kamo Clan', 'allies', '', 7),
		(fid, 'Hijōshikina Clan', 'friendly', '', 8),
		(fid, 'Kagekiyo Clan', 'neutral', '', 9),
		(fid, 'Reyes Clan', 'neutral', '', 10),
		(fid, 'Leviathan Clan', 'neutral', '', 11),
		(fid, 'Kennedy Clan', 'neutral', '', 12),
		(fid, 'Zen''in Clan', 'hostile', '', 13),
		(fid, 'Ryomen Clan', 'hostile', '', 14),
		(fid, 'Uni Clan', 'hostile', '', 15);

	insert into public.family_standing_notes (family_id, standing, note) values
		(fid, 'sister', 'Considered Family. All their members are under Brando protection: if you need help, expect a Brando to come.'),
		(fid, 'allies', 'You can enter the High-rise lobby without the security system shooting you on sight. You''ll still need a Brando to escort you anywhere else in the building.'),
		(fid, 'friendly', 'You''ll enjoy the Brando Clan''s protection and help.');

	alter table public.families enable trigger guard_family;
	alter table public.families enable trigger notify_family;
	alter table public.family_members enable trigger guard_family_member;
	alter table public.family_members enable trigger notify_family_member;
end;
$$;
