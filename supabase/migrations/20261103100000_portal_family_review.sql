-- Family owners review the characters that pick their family.
--
-- A new character can pick families in the Families step of the form (sheet.families, a list of
-- family ids). While it waits for review, the owner of any approved family it picked can read it
-- and approve, send back or deny the whole character, just like an admin. On approval the
-- character joins the families it picked: straight away for the approving owner's family (or
-- every family when an admin approves), as a join request for the others.
-- Evolutions of approved characters stay with the admins.

-- ───────────────────────────── Who may review ─────────────────────────────

-- True when the logged-in player owns an approved family this unapproved character picked,
-- and the character isn't their own.
create or replace function public.is_family_reviewer(p_sheet jsonb, p_owner uuid, p_approved_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select p_approved_at is null
		and p_owner is distinct from auth.uid()
		and jsonb_typeof(p_sheet -> 'families') = 'array'
		and exists (
			select 1 from public.families f
			where f.owner_id = auth.uid()
				and f.status = 'approved'
				and f.id::text in (select jsonb_array_elements_text(p_sheet -> 'families'))
		);
$$;

-- The families a character picked that the logged-in player owns (empty for everyone else).
create or replace function public.reviewing_family_ids(p_sheet jsonb)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(array_agg(f.id), '{}')
	from public.families f
	where f.owner_id = auth.uid()
		and f.status = 'approved'
		and jsonb_typeof(p_sheet -> 'families') = 'array'
		and f.id::text in (select jsonb_array_elements_text(p_sheet -> 'families'));
$$;

-- ───────────────────────────── Reading submissions ─────────────────────────────

drop policy if exists "family owners read submissions" on public.characters;
create policy "family owners read submissions" on public.characters
	for select to authenticated using (
		status in ('pending', 'needs_correction') and public.is_family_reviewer(sheet, owner_id, approved_at)
	);

drop policy if exists "family owners read submission notes" on public.review_notes;
create policy "family owners read submission notes" on public.review_notes
	for select to authenticated using (
		exists (
			select 1 from public.characters c
			where c.id = review_notes.character_id
				and c.status in ('pending', 'needs_correction')
				and public.is_family_reviewer(c.sheet, c.owner_id, c.approved_at)
		)
	);

-- The reviewer sees who sent the character.
drop policy if exists "family owners see submitters" on public.profiles;
create policy "family owners see submitters" on public.profiles
	for select to authenticated using (
		exists (
			select 1 from public.characters c
			where c.owner_id = profiles.id
				and c.status in ('pending', 'needs_correction')
				and public.is_family_reviewer(c.sheet, c.owner_id, c.approved_at)
		)
	);

-- The reviewer gets the same rule checks as an admin, combos included.
create or replace function public.discover_combos(p_character_id uuid)
returns table (name text, requires jsonb, perks text, system_limits jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	c public.characters;
	picked text[];
begin
	select * into c from public.characters where id = p_character_id;
	if c.id is null or (
		c.owner_id is distinct from auth.uid()
		and not public.is_admin()
		and not (c.status in ('pending', 'needs_correction') and public.is_family_reviewer(c.sheet, c.owner_id, c.approved_at))
	) then
		raise exception 'Character not found.' using errcode = '42501';
	end if;

	select coalesce(array_agg(t ->> 'name'), '{}') into picked
	from jsonb_array_elements(case when jsonb_typeof(c.sheet -> 'traits') = 'array' then c.sheet -> 'traits' else '[]'::jsonb end) t;

	if cardinality(picked) > 4 + c.extra_trait_slots then
		return;
	end if;

	return query
	select k.name, k.requires, k.perks, k.system_limits
	from public.trait_combos k
	where not exists (
		select 1 from jsonb_array_elements(k.requires) need
		where not exists (
			select 1 from jsonb_array_elements_text(need) option where option = any (picked)
		)
	)
	order by k.name;
end;
$$;

-- ───────────────────────────── Guards ─────────────────────────────

create or replace function public.guard_character()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	-- SQL Editor / service code has no logged-in user role; admins are trusted too, and so is
	-- review_character while a family owner reviews a character that picked their family.
	trusted boolean := coalesce(auth.role(), '') not in ('anon', 'authenticated') or public.is_admin()
		or coalesce(current_setting('portal.family_review', true), '') = 'on';
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
			new.extra_trait_slots := 0;
			new.reviewed_at := null;
			new.reviewed_by := null;
			new.approved_name := null;
			new.approved_sheet := null;
			new.approved_at := null;
			-- A new character has no evolutions yet.
			if jsonb_typeof(new.sheet) = 'object' then
				new.sheet := jsonb_set(new.sheet, '{evolutions}', '[]'::jsonb);
			end if;
		end if;
		new.sheet := public.apply_rolls(new.sheet, new.id, not trusted);
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
		if old.approved_at is not null and new.status = 'pending' and old.status is distinct from 'pending'
			and current_setting('portal.evolution_submit', true) is distinct from 'on' then
			raise exception 'Send changes to an approved character with "Submit evolution".' using errcode = '42501';
		end if;
		-- Fields only admins (or the system) may change.
		new.owner_id := old.owner_id;
		new.hidden := old.hidden;
		new.extra_trait_slots := old.extra_trait_slots;
		new.submitted_at := old.submitted_at;
		new.reviewed_at := old.reviewed_at;
		new.reviewed_by := old.reviewed_by;
		new.approved_name := old.approved_name;
		new.approved_sheet := old.approved_sheet;
		new.approved_at := old.approved_at;
		-- Only approved evolution submissions add to the evolution log.
		if jsonb_typeof(new.sheet) = 'object' then
			new.sheet := jsonb_set(new.sheet, '{evolutions}', coalesce(old.sheet -> 'evolutions', '[]'::jsonb));
		end if;
		-- Once approved, a character can't switch between OC and canon or change series.
		if old.approved_at is not null then
			new.kind := old.kind;
			new.canon_universe := old.canon_universe;
		end if;
	end if;
	new.sheet := public.apply_rolls(new.sheet, new.id, not trusted);

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
		-- review_character adds the families a character picked in the form when it's approved.
		if coalesce(current_setting('portal.family_join', true), '') = 'on' then
			return new;
		end if;
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

-- ───────────────────────────── Deciding ─────────────────────────────

create or replace function public.review_character(
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
	admin boolean := public.is_admin();
	mine uuid[] := '{}';
begin
	if not admin then
		select * into c from public.characters where id = p_character_id;
		if c.id is null or c.status not in ('pending', 'needs_correction') or not public.is_family_reviewer(c.sheet, c.owner_id, c.approved_at) then
			raise exception 'Only admins, or the owner of a family this character picked, can review it.' using errcode = '42501';
		end if;
		mine := public.reviewing_family_ids(c.sheet);
	end if;
	if p_outcome is null or p_outcome not in ('approved', 'needs_correction', 'denied') then
		raise exception 'The decision must be approved, needs_correction or denied.';
	end if;
	if p_outcome = 'denied' and exists (select 1 from public.characters where id = p_character_id and approved_at is not null) then
		raise exception 'This character is already approved. Deny its evolution instead; the character stays as last approved.';
	end if;
	perform public.ensure_profile(); -- the reviewer is recorded on the character and note

	if not admin then
		perform set_config('portal.family_review', 'on', true);
	end if;
	update public.characters set status = p_outcome where id = p_character_id
	returning * into c;
	perform set_config('portal.family_review', 'off', true);
	if c.id is null then
		raise exception 'Character not found.';
	end if;

	insert into public.review_notes (character_id, author_id, outcome, body)
	values (c.id, auth.uid(), p_outcome, coalesce(p_note, ''));

	if p_outcome = 'approved' then
		perform public.grant_claims(c);
		-- The rolls this character carried are settled; the player may roll for a new character.
		with settled as (
			update public.player_rolls set status = 'consumed', settled_at = now()
			where character_id = c.id and status = 'active'
			returning id, kind
		)
		insert into public.roll_events (owner_id, actor_id, action, detail)
		select c.owner_id, auth.uid(), 'consumed', jsonb_build_object('kind', kind, 'roll', id, 'character', c.id) from settled;

		-- Join the families picked in the form. The approver's say counts for the families they
		-- speak for (all of them for an admin); the other owners get a join request.
		if jsonb_typeof(c.sheet -> 'families') = 'array' then
			perform set_config('portal.family_join', 'on', true);
			insert into public.family_members (family_id, character_id, requested_by, status, name)
			select f.id, c.id, c.owner_id,
				case when admin or f.id = any (mine) then 'active' else 'requested' end,
				coalesce(nullif(c.approved_name, ''), c.name)
			from public.families f
			where f.status = 'approved' and f.id::text in (select jsonb_array_elements_text(c.sheet -> 'families'))
			on conflict (family_id, character_id) do update
				set status = case when excluded.status = 'active' then 'active' else public.family_members.status end;
			perform set_config('portal.family_join', 'off', true);
		end if;
	end if;

	return c;
end;
$$;

-- ───────────────────────────── Pinging the family owner ─────────────────────────────

-- When a new character that picked families is sent for review, each family's owner is pinged.
create or replace function public.notify_family_pick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam record;
begin
	if new.approved_at is not null or new.status <> 'pending' or (tg_op = 'UPDATE' and old.status = 'pending')
		or jsonb_typeof(new.sheet -> 'families') is distinct from 'array' then
		return null;
	end if;
	for fam in
		select f.name, p.discord_id
		from public.families f
		join public.profiles p on p.id = f.owner_id
		where f.status = 'approved' and f.owner_id is distinct from new.owner_id and p.discord_id is not null
			and f.id::text in (select jsonb_array_elements_text(new.sheet -> 'families'))
	loop
		perform public.discord_post('discord_public_webhook', jsonb_build_object(
			'content', '<@' || fam.discord_id || '>, **' || public.discord_escape(new.name) || '** wants to join **'
				|| public.discord_escape(fam.name) || '**. You can review the character in the Divine Database.',
			'embeds', jsonb_build_array(jsonb_build_object(
				'title', left(new.name, 250),
				'url', public.portal_site_url() || '/portal/admin/review/'
			)),
			'allowed_mentions', jsonb_build_object('users', jsonb_build_array(fam.discord_id))
		));
	end loop;
	return null;
end;
$$;

drop trigger if exists notify_family_pick on public.characters;
create trigger notify_family_pick
	after insert or update of status on public.characters
	for each row execute function public.notify_family_pick();

-- ───────────────────────────── Permissions ─────────────────────────────

revoke execute on function public.is_family_reviewer(jsonb, uuid, timestamptz) from public, anon;
revoke execute on function public.reviewing_family_ids(jsonb) from public, anon;
revoke execute on function public.notify_family_pick() from public, anon, authenticated;
grant execute on function public.is_family_reviewer(jsonb, uuid, timestamptz) to authenticated;
grant execute on function public.reviewing_family_ids(jsonb) to authenticated;
