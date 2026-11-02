-- Family tryouts: a family holding tryouts reviews a SAMPLE character before anyone joins.
-- The tryout is a brand-new character concept (no stats): a name, who they are, a backstory and an
-- RP sample. If the owner accepts it, the player makes the character for real, gets it approved in
-- the portal, and can then ask to join with it. The per-family Discord server link is removed.
--
-- Run once in the SQL Editor after 20261031100000_families.sql. Safe to run again, including over the
-- earlier version of this file (which put tryout text on family_members).
--
--   * recruiting = 'open'    → players ask to join with an approved character.
--   * recruiting = 'tryouts' → players send a tryout first; once one is accepted they can ask to join.
--   * recruiting = 'closed'  → no new tryouts or requests (an accepted tryout still lets you join).
-- Tryouts are private: only the player who sent it, the family's owner and admins can read them.

alter table public.families drop column if exists discord_url;
alter table public.family_members drop column if exists tryout, drop column if exists tryout_url;


-- ───────────────────────────── Table ─────────────────────────────

create table if not exists public.family_tryouts (
	id uuid primary key default gen_random_uuid(),
	family_id uuid not null references public.families (id) on delete cascade,
	player_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
	-- The division they'd like to join, if any.
	division_id uuid references public.family_divisions (id) on delete set null,
	character_name text not null check (char_length(btrim(character_name)) between 1 and 100),
	image_url text not null default '' check (image_url = '' or image_url ~ '^https://'),
	-- Who the character is: personality, look, what they bring to the family.
	about text not null check (char_length(btrim(about)) between 1 and 4000),
	-- How they're connected to the family. Optional.
	backstory text not null default '' check (char_length(backstory) <= 4000),
	-- A short piece of RP written as the character.
	sample text not null check (char_length(btrim(sample)) between 1 and 6000),
	status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
	owner_note text not null default '' check (char_length(owner_note) <= 1000),
	created_at timestamptz not null default now(),
	reviewed_at timestamptz
);
create index if not exists family_tryouts_family_idx on public.family_tryouts (family_id);
create index if not exists family_tryouts_player_idx on public.family_tryouts (player_id);
-- One tryout waiting at a time per player per family.
create unique index if not exists family_tryouts_one_pending on public.family_tryouts (family_id, player_id) where status = 'pending';


-- ───────────────────────────── Guards ─────────────────────────────

-- Players send tryouts (always pending, as themselves); owners and admins only decide them.
create or replace function public.guard_family_tryout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
	manager boolean := public.is_admin() or public.is_family_owner(new.family_id);
begin
	if tg_op = 'UPDATE' then
		if not manager then
			raise exception 'Only the family''s owner can decide a tryout.' using errcode = '42501';
		end if;
		-- The tryout itself can't be rewritten; only the decision and note change.
		new.family_id := old.family_id;
		new.player_id := old.player_id;
		new.division_id := old.division_id;
		new.character_name := old.character_name;
		new.image_url := old.image_url;
		new.about := old.about;
		new.backstory := old.backstory;
		new.sample := old.sample;
		new.created_at := old.created_at;
		if new.status is distinct from old.status then
			new.reviewed_at := now();
		end if;
		return new;
	end if;

	select * into fam from public.families where id = new.family_id;
	if fam.id is null or fam.status <> 'approved' or fam.recruiting <> 'tryouts' then
		raise exception 'This family isn''t holding tryouts right now.' using errcode = '42501';
	end if;
	new.player_id := auth.uid();
	new.status := 'pending';
	new.owner_note := '';
	new.reviewed_at := null;
	new.created_at := now();
	if new.division_id is not null and not exists (
		select 1 from public.family_divisions d where d.id = new.division_id and d.family_id = new.family_id
	) then
		new.division_id := null;
	end if;
	return new;
end;
$$;

drop trigger if exists guard_family_tryout on public.family_tryouts;
create trigger guard_family_tryout before insert or update on public.family_tryouts
	for each row execute function public.guard_family_tryout();

-- Join requests: a player may only ask for their own approved character, and only as 'requested'.
-- A family holding tryouts needs an accepted tryout from that player first. Owners and admins
-- manage everything else.
create or replace function public.guard_family_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	ch public.characters;
	fam public.families;
	manager boolean := public.is_admin() or public.is_family_owner(new.family_id);
	passed boolean;
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
			select * into fam from public.families where id = new.family_id;
			passed := exists (
				select 1 from public.family_tryouts t
				where t.family_id = new.family_id and t.player_id = auth.uid() and t.status = 'accepted'
			);
			if fam.status <> 'approved' or (fam.recruiting = 'closed' and not passed) then
				raise exception 'This family isn''t taking new members right now.' using errcode = '42501';
			end if;
			if fam.recruiting = 'tryouts' and not passed then
				raise exception 'This family holds tryouts: send a tryout first.' using errcode = '42501';
			end if;
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

-- Back to the original join-request message (the earlier version of this file changed it).
create or replace function public.notify_family_member()
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


-- ───────────────────────────── Notifications ─────────────────────────────

-- New tryout → ping the owner. Decision → ping the player. Tryout text stays off Discord.
create or replace function public.notify_family_tryout()
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
	if tg_op = 'INSERT' then
		select p.discord_id into ping from public.profiles p where p.id = fam.owner_id;
		text_out := coalesce('<@' || ping || '>', 'The owner') || ', a new tryout (**'
			|| public.discord_escape(new.character_name) || '**) was sent to **' || public.discord_escape(fam.name) || '**.';
	elsif old.status = 'pending' and new.status in ('accepted', 'declined') then
		select p.discord_id into ping from public.profiles p where p.id = new.player_id;
		text_out := coalesce('<@' || ping || '>', 'A player') || ', your tryout for **' || public.discord_escape(fam.name) || '** was '
			|| case when new.status = 'accepted'
				then '**accepted**! Make the character, get it approved, then join from the family''s page.'
				else 'declined.' end;
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

drop trigger if exists notify_family_tryout on public.family_tryouts;
create trigger notify_family_tryout
	after insert or update of status on public.family_tryouts
	for each row execute function public.notify_family_tryout();


-- ───────────────────────────── Row-level security ─────────────────────────────

alter table public.family_tryouts enable row level security;

drop policy if exists "read own or managed tryouts" on public.family_tryouts;
create policy "read own or managed tryouts" on public.family_tryouts
	for select to authenticated
	using (player_id = (select auth.uid()) or public.is_family_owner(family_id) or (select public.is_admin()));

drop policy if exists "send a tryout" on public.family_tryouts;
create policy "send a tryout" on public.family_tryouts
	for insert to authenticated
	with check (player_id = (select auth.uid()));

drop policy if exists "owner decides tryouts" on public.family_tryouts;
create policy "owner decides tryouts" on public.family_tryouts
	for update to authenticated
	using (public.is_family_owner(family_id) or (select public.is_admin()))
	with check (public.is_family_owner(family_id) or (select public.is_admin()));

-- Players withdraw a waiting tryout; owners and admins clear any.
drop policy if exists "withdraw or clear tryouts" on public.family_tryouts;
create policy "withdraw or clear tryouts" on public.family_tryouts
	for delete to authenticated
	using (
		(player_id = (select auth.uid()) and status = 'pending')
		or public.is_family_owner(family_id)
		or (select public.is_admin())
	);

revoke all on public.family_tryouts from anon;
grant select, insert, update, delete on public.family_tryouts to authenticated;

revoke execute on function public.guard_family_tryout() from public, anon, authenticated;
revoke execute on function public.notify_family_tryout() from public, anon, authenticated;
revoke execute on function public.guard_family_member() from public, anon, authenticated;
revoke execute on function public.notify_family_member() from public, anon, authenticated;
