-- Singularity character portal: evolution submissions.
--
-- A player evolves an APPROVED character by editing its sheet and sending the changes with an
-- evolution submission (what evolved, how it was earned, proof links). Admins review the
-- submission together with what changed:
--   * approved          → the changes become the approved sheet AND the entry is added to the
--                         character's evolution log
--   * needs correction  → sent back; the player fixes it and sends it again
--   * denied            → the changes are thrown away and the character stays as last approved
--                         (it is NOT locked, unlike denying a new character)
-- Players can't edit the evolution log themselves; only approved submissions add to it.
--
-- Run once in the SQL Editor after the earlier portal files.


-- ───────────────────────────── Table ─────────────────────────────

create type public.evolution_status as enum ('pending', 'approved', 'needs_correction', 'denied');

create table public.evolution_requests (
	id uuid primary key default gen_random_uuid(),
	character_id uuid not null references public.characters (id) on delete cascade,
	owner_id uuid not null references public.profiles (id) on delete cascade,
	summary text not null check (char_length(btrim(summary)) between 1 and 2000),
	earned text not null default '' check (char_length(earned) <= 2000),
	links text not null default '' check (char_length(links) <= 2000),
	status public.evolution_status not null default 'pending',
	review_note text not null default '',
	submitted_at timestamptz not null default now(),
	reviewed_at timestamptz,
	reviewed_by uuid references public.profiles (id) on delete set null,
	created_at timestamptz not null default now()
);

-- At most one open submission (waiting or sent back) per character.
create unique index evolution_requests_one_open on public.evolution_requests (character_id) where status in ('pending', 'needs_correction');
create index evolution_requests_owner_idx on public.evolution_requests (owner_id);

alter table public.evolution_requests enable row level security;
create policy "own or admin reads evolutions" on public.evolution_requests
	for select to authenticated using (owner_id = (select auth.uid()) or (select public.is_admin()));
revoke all on public.evolution_requests from anon;
revoke insert, update, delete, truncate on public.evolution_requests from authenticated;


-- ───────────────────────────── Character guard ─────────────────────────────

-- As before, plus: players can't edit the evolution log, and an approved character goes to
-- review only through submit_evolution().
create or replace function public.guard_character()
returns trigger
language plpgsql
security definer
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


-- ───────────────────────────── Player: submit ─────────────────────────────

-- Sends an approved character's changes for review with what evolved and how it was earned.
-- Updates the open submission if there is one (e.g. after it was sent back).
create function public.submit_evolution(p_character_id uuid, p_summary text, p_earned text default '', p_links text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.characters;
	r public.evolution_requests;
begin
	select * into c from public.characters where id = p_character_id for update;
	if c.id is null or c.owner_id is distinct from auth.uid() then
		raise exception 'Character not found.' using errcode = '42501';
	end if;
	if c.approved_at is null then
		raise exception 'Only approved characters can evolve. Send this one for review instead.';
	end if;
	if c.status = 'denied' then
		raise exception 'This character is locked.';
	end if;
	if char_length(btrim(coalesce(p_summary, ''))) = 0 then
		raise exception 'Describe what evolved.';
	end if;

	select * into r from public.evolution_requests where character_id = c.id and status in ('pending', 'needs_correction') for update;
	if r.id is null then
		insert into public.evolution_requests (character_id, owner_id, summary, earned, links)
		values (c.id, c.owner_id, btrim(p_summary), coalesce(p_earned, ''), coalesce(p_links, ''))
		returning * into r;
	else
		update public.evolution_requests
		set summary = btrim(p_summary), earned = coalesce(p_earned, ''), links = coalesce(p_links, ''),
			status = 'pending', submitted_at = case when status = 'pending' then submitted_at else now() end
		where id = r.id
		returning * into r;
	end if;

	if c.status is distinct from 'pending' then
		perform set_config('portal.evolution_submit', 'on', true);
		update public.characters set status = 'pending' where id = c.id;
		perform set_config('portal.evolution_submit', 'off', true);
	end if;
	return r.id;
end;
$$;


-- ───────────────────────────── Admin: review ─────────────────────────────

-- An approved character can't be denied outright here (that would lock it); evolutions are
-- denied with review_evolution(), which keeps the last approved version.
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
begin
	if not public.is_admin() then
		raise exception 'Only admins can review characters.' using errcode = '42501';
	end if;
	if p_outcome is null or p_outcome not in ('approved', 'needs_correction', 'denied') then
		raise exception 'The decision must be approved, needs_correction or denied.';
	end if;
	if p_outcome = 'denied' and exists (select 1 from public.characters where id = p_character_id and approved_at is not null) then
		raise exception 'This character is already approved. Deny its evolution instead; the character stays as last approved.';
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
		-- The rolls this character carried are settled; the player may roll for a new character.
		with settled as (
			update public.player_rolls set status = 'consumed', settled_at = now()
			where character_id = c.id and status = 'active'
			returning id, kind
		)
		insert into public.roll_events (owner_id, actor_id, action, detail)
		select c.owner_id, auth.uid(), 'consumed', jsonb_build_object('kind', kind, 'roll', id, 'character', c.id) from settled;
	end if;

	return c;
end;
$$;

-- Approve, send back or deny an evolution submission.
create function public.review_evolution(p_request uuid, p_outcome public.evolution_status, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	r public.evolution_requests;
	c public.characters;
	entry jsonb;
begin
	perform public.require_admin();
	if p_outcome is null or p_outcome = 'pending' then
		raise exception 'The decision must be approved, needs_correction or denied.';
	end if;
	perform public.ensure_profile();

	select * into r from public.evolution_requests where id = p_request for update;
	if r.id is null or r.status not in ('pending', 'needs_correction') then
		raise exception 'That evolution isn’t waiting for a decision.';
	end if;
	select * into c from public.characters where id = r.character_id for update;

	if p_outcome = 'approved' then
		-- Add the entry to the evolution log, then approve: the changes become the approved sheet.
		entry := jsonb_build_object(
			'date', to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
			'summary', r.summary,
			'earned', r.earned,
			'link', r.links,
			'request', r.id
		);
		update public.characters
		set sheet = jsonb_set(sheet, '{evolutions}', coalesce(sheet -> 'evolutions', '[]'::jsonb) || jsonb_build_array(entry))
		where id = c.id;
		perform public.review_character(c.id, 'approved', p_note);
	elsif p_outcome = 'needs_correction' then
		perform public.review_character(c.id, 'needs_correction', p_note);
	else
		-- Throw the changes away: back to the last approved version, still approved.
		perform set_config('portal.evolution_denied', 'on', true);
		update public.characters set sheet = approved_sheet, name = coalesce(approved_name, name), status = 'approved' where id = c.id;
		perform set_config('portal.evolution_denied', 'off', true);
		insert into public.review_notes (character_id, author_id, outcome, body)
		values (c.id, auth.uid(), null, 'Evolution denied' || case when coalesce(p_note, '') <> '' then ': ' || p_note else '.' end);
	end if;

	update public.evolution_requests
	set status = p_outcome, review_note = coalesce(p_note, ''), reviewed_at = now(), reviewed_by = auth.uid()
	where id = r.id;
end;
$$;


-- ───────────────────────────── Discord wording for evolutions ─────────────────────────────

create or replace function public.notify_character_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	who text;
	player_id text;
	name text := public.discord_escape(new.name);
	was_approved boolean := tg_op = 'UPDATE' and old.approved_at is not null;
	evolution_denied boolean := current_setting('portal.evolution_denied', true) = 'on';
	kind_text text;
	role_color int;
	series text;
	evolution text;
begin
	select p.discord_id into player_id from public.profiles p where p.id = new.owner_id;
	who := case when player_id is not null then '<@' || player_id || '>' else 'A player' end;

	-- Sent for review → staff channel (mentions shown but never pinged).
	if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
		select u.name into series from public.universes u where u.slug = new.canon_universe;
		kind_text := case
			when new.kind = 'canon' then 'Canon tryout · ' || coalesce(series, 'unknown series')
			else 'OC' || coalesce(' · ' || initcap(replace(nullif(new.sheet ->> 'role', ''), '-', ' ')), '')
		end;
		if was_approved then
			select left(summary, 300) into evolution from public.evolution_requests
			where character_id = new.id and status = 'pending' order by submitted_at desc limit 1;
		end if;
		role_color := case new.sheet ->> 'role'
			when 'hero' then 16106818 when 'vigilante' then 10181093 when 'villain' then 15087942
			when 'jujutsu-sorcerer' then 3835647 when 'curse-user' then 12592851 when 'student' then 4122280
			when 'civilian' then 9418936 else 2154656 end;
		perform public.discord_post('discord_staff_webhook', jsonb_build_object(
			'content', case
				when was_approved then '🧬 Evolution sent for review'
				when tg_op = 'UPDATE' and old.status = 'needs_correction' then '🔁 Resubmitted after correction'
				else '📝 New character sent for review'
			end,
			'embeds', jsonb_build_array(jsonb_build_object(
				'title', left(new.name, 250),
				'url', public.portal_site_url() || '/portal/admin/review/',
				'description', 'by ' || who || E'\n' || kind_text || coalesce(E'\n\n' || evolution, ''),
				'color', role_color
			)),
			'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
		));
	end if;

	-- A review decision → public channel, pinging only the player.
	if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'needs_correction', 'denied') then
		perform public.discord_post('discord_public_webhook', jsonb_build_object(
			'content', case
				when evolution_denied then who || ', the evolution of your character **' || name || '** has been DENIED.'
				when new.status = 'approved' and was_approved then who || ', the evolution of your character **' || name || '** has been approved!'
				when new.status = 'approved' then who || ', your character **' || name || '** has been approved!'
				when new.status = 'needs_correction' and was_approved then who || ', the evolution of your character **' || name || '** is in need of correction, please open a ticket to get started!'
				when new.status = 'needs_correction' then who || ', your character **' || name || '** is in need of correction, please open a ticket to get started!'
				else who || ', your character **' || name || '** has been DENIED. You must create a new character.'
			end,
			'allowed_mentions', case when player_id is not null
				then jsonb_build_object('users', jsonb_build_array(player_id))
				else jsonb_build_object('parse', '[]'::jsonb) end
		));
	end if;

	return null;
end;
$$;


revoke execute on function public.submit_evolution(uuid, text, text, text) from public, anon;
revoke execute on function public.review_evolution(uuid, public.evolution_status, text) from public, anon;
grant execute on function public.submit_evolution(uuid, text, text, text) to authenticated;
grant execute on function public.review_evolution(uuid, public.evolution_status, text) to authenticated;
