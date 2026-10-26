-- Singularity character portal: Potential and Cursed Energy rolls, locked to the account.
--
-- Run once in the SQL Editor after the earlier portal files.
--
-- How the lock works:
--   * Rolls are made by the database (perform_roll), never by the browser, and players
--     can read their rolls but never change them.
--   * A player has at most one ACTIVE roll of each kind. It is tied to the character it was
--     rolled for and is written into that character's sheet on every save.
--   * Deleting that character, or having it denied, doesn't free the roll: it moves to the
--     player's next character. Only an APPROVAL of the character carrying it settles it
--     ('consumed'); after that the player may roll again for a new character.
--   * An admin can give a single-use override code (lets the player roll again), lock an
--     account's rolling, or set a roll by hand. Everything is written to roll_events.
--   * Rolling itself goes through the 'roll' Edge Function, which first checks that the
--     player is in the Singularity Discord server.


-- ───────────────────────────── Tables ─────────────────────────────

create type public.roll_kind as enum ('potential', 'cursed_energy');
create type public.roll_status as enum ('active', 'consumed', 'void');

create table public.player_rolls (
	id uuid primary key default gen_random_uuid(),
	owner_id uuid not null references public.profiles (id) on delete cascade,
	kind public.roll_kind not null,
	-- potential:     {"roll": 423, "grade": "high"}
	-- cursed_energy: {"classRoll": 980, "class": "Rare", "amountRoll": 4, "level": "Extensive", "cep": 320}
	result jsonb not null,
	character_id uuid references public.characters (id) on delete set null,
	status public.roll_status not null default 'active',
	source text not null default 'rolled' check (source in ('rolled', 'admin')),
	created_at timestamptz not null default now(),
	settled_at timestamptz
);

create unique index player_rolls_one_active on public.player_rolls (owner_id, kind) where status = 'active';
create index player_rolls_character_idx on public.player_rolls (character_id);

-- Accounts an admin has stopped from rolling.
create table public.roll_locks (
	owner_id uuid primary key references public.profiles (id) on delete cascade,
	reason text not null default '',
	locked_by uuid references public.profiles (id) on delete set null,
	locked_at timestamptz not null default now()
);

-- Single-use override codes. Only a hash of the code is stored.
create table public.roll_override_codes (
	id uuid primary key default gen_random_uuid(),
	owner_id uuid not null references public.profiles (id) on delete cascade,
	code_hash text not null,
	created_by uuid references public.profiles (id) on delete set null,
	created_at timestamptz not null default now(),
	expires_at timestamptz not null,
	used_at timestamptz
);

create index roll_override_codes_owner_idx on public.roll_override_codes (owner_id);

-- Audit log of everything that happens to rolls.
create table public.roll_events (
	id bigint generated always as identity primary key,
	owner_id uuid references public.profiles (id) on delete cascade,
	actor_id uuid references public.profiles (id) on delete set null,
	action text not null,
	detail jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now()
);

create index roll_events_owner_idx on public.roll_events (owner_id, created_at desc);


-- ───────────────────────────── Dice and tables ─────────────────────────────

-- A fair die from the database's secure random generator (1..sides).
create function public.roll_die(sides int)
returns int
language sql
volatile
set search_path = ''
as $$
	select (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % sides)::int + 1;
$$;

-- Potential from a 1d500 roll (the Discord rolling rules).
create function public.potential_for(n int)
returns text
language sql
immutable
set search_path = ''
as $$
	select case
		when n <= 30 then 'limited'
		when n <= 49 then 'low'
		when n <= 390 then 'average'
		when n <= 420 then 'great'
		when n <= 431 then 'high'
		when n <= 441 then 'insane'
		when n <= 471 then 'immense'
		when n <= 495 then 'colossal'
		else 'tremendous'
	end;
$$;

-- Cursed Energy levels per class, from the wiki's CE Levels page.
create function public.ce_levels()
returns jsonb
language sql
immutable
set search_path = ''
as $$
	select '{
		"Common": [["Miniscule",10],["Stunted",20],["Modest",30],["Trivial",40],["Compact",50],["Inconsequential",60],["Fun Size",70],["Measly",80],["Meager",90],["Limited",100]],
		"Uncommon": [["Average",120],["Above Average",140],["Sub-Par",160],["Basic",180],["Great",200]],
		"Rare": [["Large",230],["Huge",260],["Enormous",290],["Extensive",320],["Lofty",350],["Robust",380],["Gargantuan",410],["Capacious",440],["Ample",470],["Voluminous",500]],
		"Legendary": [["Vast",540],["Expansive",580],["Humongous",620],["Hefty",660],["Insane",700]],
		"Mythical": [["Mammoth",750],["Colossal",800],["Massive",850],["Giant",900],["Tremendous",950],["Monumental",1000]]
	}'::jsonb;
$$;

-- Class from a 1d1260 roll.
create function public.ce_class_for(n int)
returns text
language sql
immutable
set search_path = ''
as $$
	select case
		when n <= 510 then 'Common'
		when n <= 930 then 'Uncommon'
		when n <= 1190 then 'Rare'
		when n <= 1250 then 'Legendary'
		else 'Mythical'
	end;
$$;

-- A Cursed Energy result for a class and amount roll.
create function public.ce_result(class_roll int, amount_roll int)
returns jsonb
language sql
immutable
set search_path = ''
as $$
	select jsonb_build_object(
		'classRoll', class_roll,
		'class', public.ce_class_for(class_roll),
		'amountRoll', amount_roll,
		'level', public.ce_levels() -> public.ce_class_for(class_roll) -> (amount_roll - 1) ->> 0,
		'cep', (public.ce_levels() -> public.ce_class_for(class_roll) -> (amount_roll - 1) ->> 1)::int
	);
$$;

-- Writes a character's rolls into its sheet: Potential, and CE on every Jujutsu Kaisen card.
-- With blank_missing, a sheet without a roll gets an empty Potential / CE (players can't
-- type their own); otherwise what's there is kept (admin or SQL edits).
create function public.apply_rolls(sheet jsonb, char_id uuid, blank_missing boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	pot jsonb;
	ce jsonb;
	systems jsonb;
begin
	select result into pot from public.player_rolls
	where character_id = char_id and kind = 'potential' and status <> 'void'
	order by created_at desc limit 1;
	select result into ce from public.player_rolls
	where character_id = char_id and kind = 'cursed_energy' and status <> 'void'
	order by created_at desc limit 1;

	if jsonb_typeof(sheet) <> 'object' then sheet := '{}'::jsonb; end if;

	if pot is not null or blank_missing then
		sheet := jsonb_set(
			sheet, '{potential}',
			coalesce(case when jsonb_typeof(sheet -> 'potential') = 'object' then sheet -> 'potential' end, '{}'::jsonb)
				|| jsonb_build_object('grade', coalesce(pot ->> 'grade', ''), 'roll', pot -> 'roll')
		);
	end if;

	if jsonb_typeof(sheet -> 'systems') = 'array' and (ce is not null or blank_missing) then
		select coalesce(jsonb_agg(
			case when e ->> 'system' = 'jujutsu-kaisen' then
				e || jsonb_build_object('fields',
					coalesce(case when jsonb_typeof(e -> 'fields') = 'object' then e -> 'fields' end, '{}'::jsonb)
						|| jsonb_build_object('ceClass', coalesce(ce ->> 'class', ''), 'ceAmount', ce -> 'cep', 'ceLevel', ce -> 'level'))
			else e end
			order by ord), '[]'::jsonb)
		into systems
		from jsonb_array_elements(sheet -> 'systems') with ordinality as x (e, ord);
		sheet := jsonb_set(sheet, '{systems}', systems);
	end if;

	return sheet;
end;
$$;

create function public.log_roll_event(p_owner uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
	insert into public.roll_events (owner_id, actor_id, action, detail) values (p_owner, auth.uid(), p_action, p_detail);
$$;


-- ───────────────────────────── Character guard: rolls always win ─────────────────────────────

-- Same as before, plus: the sheet's Potential and Cursed Energy always come from the
-- character's rolls. Now security definer so it can read rolls for any character.
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


-- ───────────────────────────── Rolling ─────────────────────────────

-- Rolls (or re-attaches) a player's Potential / Cursed Energy for one of their characters.
-- Called only by the 'roll' Edge Function after it has checked Discord server membership.
create function public.perform_roll(p_user uuid, p_kind public.roll_kind, p_character uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.characters;
	r public.player_rolls;
	bound public.characters;
	label text := case when p_kind = 'potential' then 'Potential' else 'Cursed Energy' end;
	res jsonb;
begin
	select * into c from public.characters where id = p_character for update;
	if c.id is null or c.owner_id is distinct from p_user then
		raise exception 'Character not found.' using errcode = '42501';
	end if;
	if c.kind <> 'oc' then
		raise exception 'Canon tryouts don''t roll.';
	end if;
	if c.status = 'denied' then
		raise exception 'This character was denied and is locked.';
	end if;
	if p_kind = 'cursed_energy' and not exists (
		select 1 from jsonb_array_elements(case when jsonb_typeof(c.sheet -> 'systems') = 'array' then c.sheet -> 'systems' else '[]'::jsonb end) e
		where e ->> 'system' = 'jujutsu-kaisen'
	) then
		raise exception 'Add the Jujutsu Kaisen system to this character (and save) before rolling Cursed Energy.';
	end if;

	-- This character already has its roll: just return it.
	select * into r from public.player_rolls
	where character_id = c.id and kind = p_kind and status <> 'void'
	order by created_at desc limit 1;
	if r.id is not null then
		update public.characters set sheet = public.apply_rolls(sheet, id, false) where id = c.id;
		return r.result || jsonb_build_object('existing', true);
	end if;

	-- An unsettled roll from another character follows the player.
	select * into r from public.player_rolls where owner_id = p_user and kind = p_kind and status = 'active' for update;
	if r.id is not null then
		select * into bound from public.characters where id = r.character_id;
		if bound.id is not null and bound.status <> 'denied' then
			raise exception 'Your % roll is locked to "%". Get that character approved first, or ask an admin for an override code.', label, bound.name;
		end if;
		update public.player_rolls set character_id = c.id where id = r.id;
		insert into public.roll_events (owner_id, actor_id, action, detail)
		values (p_user, p_user, 'moved', jsonb_build_object('kind', p_kind, 'roll', r.id, 'to', c.id, 'from', r.character_id));
		update public.characters set sheet = public.apply_rolls(sheet, id, false) where id = c.id;
		return r.result || jsonb_build_object('existing', true, 'carried', true);
	end if;

	if exists (select 1 from public.roll_locks where owner_id = p_user) then
		raise exception 'An admin has locked rolling on your account. Ask an admin if you think this is a mistake.';
	end if;

	if p_kind = 'potential' then
		res := jsonb_build_object('roll', public.roll_die(500));
		res := res || jsonb_build_object('grade', public.potential_for((res ->> 'roll')::int));
	else
		res := public.ce_result(public.roll_die(1260), 1);
		res := public.ce_result(
			(res ->> 'classRoll')::int,
			public.roll_die(jsonb_array_length(public.ce_levels() -> (res ->> 'class')))
		);
	end if;

	insert into public.player_rolls (owner_id, kind, result, character_id) values (p_user, p_kind, res, c.id) returning * into r;
	insert into public.roll_events (owner_id, actor_id, action, detail)
	values (p_user, p_user, 'rolled', jsonb_build_object('kind', p_kind, 'roll', r.id, 'character', c.id, 'result', res));
	update public.characters set sheet = public.apply_rolls(sheet, id, false) where id = c.id;
	return res;
end;
$$;


-- ───────────────────────────── Override codes (players) ─────────────────────────────

-- Uses an admin's code: frees the player's unsettled rolls so they can roll again.
-- Returns {ok, message}; 5 wrong codes in an hour pauses code entry.
create function public.redeem_roll_override(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	uid uuid := auth.uid();
	code_row public.roll_override_codes;
	freed int;
begin
	if uid is null then
		return jsonb_build_object('ok', false, 'message', 'Log in first.');
	end if;
	if (select count(*) from public.roll_events where owner_id = uid and action = 'override_failed' and created_at > now() - interval '1 hour') >= 5 then
		return jsonb_build_object('ok', false, 'message', 'Too many wrong codes. Try again in an hour.');
	end if;

	select * into code_row from public.roll_override_codes
	where owner_id = uid and used_at is null and expires_at > now()
		and code_hash = encode(sha256(convert_to(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'UTF8')), 'hex')
	for update;

	if code_row.id is null then
		insert into public.roll_events (owner_id, actor_id, action) values (uid, uid, 'override_failed');
		return jsonb_build_object('ok', false, 'message', 'That code is wrong, already used, or expired.');
	end if;

	update public.roll_override_codes set used_at = now() where id = code_row.id;
	update public.player_rolls set status = 'void', settled_at = now() where owner_id = uid and status = 'active';
	get diagnostics freed = row_count;
	insert into public.roll_events (owner_id, actor_id, action, detail)
	values (uid, uid, 'override_used', jsonb_build_object('code', code_row.id, 'rollsFreed', freed));
	return jsonb_build_object('ok', true, 'message', 'Override accepted. You can roll again.');
end;
$$;


-- ───────────────────────────── Admin tools ─────────────────────────────

create function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only admins can do that.' using errcode = '42501';
	end if;
end;
$$;

-- Makes a single-use 8-digit override code for one player. Valid for p_hours (at least 2).
-- The code is shown once; only its hash is kept.
create function public.create_roll_override(p_owner uuid, p_hours numeric default 2)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	code text;
	expires timestamptz := now() + make_interval(secs => (greatest(coalesce(p_hours, 2), 2) * 3600)::double precision);
begin
	perform public.require_admin();
	if not exists (select 1 from public.profiles where id = p_owner) then
		raise exception 'Player not found.';
	end if;
	code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 100000000))::text, 8, '0');
	insert into public.roll_override_codes (owner_id, code_hash, created_by, expires_at)
	values (p_owner, encode(sha256(convert_to(code, 'UTF8')), 'hex'), auth.uid(), expires);
	perform public.log_roll_event(p_owner, 'override_created', jsonb_build_object('expires', expires));
	return jsonb_build_object('code', code, 'expires', expires);
end;
$$;

-- Locks (or unlocks) an account's rolling.
create function public.set_roll_lock(p_owner uuid, p_locked boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	perform public.require_admin();
	if p_locked then
		insert into public.roll_locks (owner_id, reason, locked_by) values (p_owner, coalesce(p_reason, ''), auth.uid())
		on conflict (owner_id) do update set reason = excluded.reason, locked_by = excluded.locked_by, locked_at = now();
		perform public.log_roll_event(p_owner, 'locked', jsonb_build_object('reason', p_reason));
	else
		delete from public.roll_locks where owner_id = p_owner;
		perform public.log_roll_event(p_owner, 'unlocked');
	end if;
end;
$$;

-- Sets a roll by hand: a Potential grade (including staff-rolled Peak / Ultimate / Apex) or a
-- Cursed Energy level. Replaces the player's unsettled roll of that kind; with a character, it
-- also replaces that character's roll. On an approved character it counts as already settled.
create function public.admin_set_roll(p_owner uuid, p_kind public.roll_kind, p_value text, p_character uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	res jsonb;
	cls text;
	idx int;
	c public.characters;
begin
	perform public.require_admin();
	if p_kind = 'potential' then
		if p_value not in ('limited', 'low', 'average', 'great', 'high', 'insane', 'immense', 'colossal', 'tremendous', 'peak', 'ultimate', 'apex') then
			raise exception 'Unknown Potential "%".', p_value;
		end if;
		res := jsonb_build_object('roll', null, 'grade', p_value);
	else
		select key, ord::int into cls, idx
		from jsonb_each(public.ce_levels()) as l (key, value),
			jsonb_array_elements(l.value) with ordinality as x (lvl, ord)
		where lvl ->> 0 = p_value
		limit 1;
		if cls is null then
			raise exception 'Unknown Cursed Energy level "%".', p_value;
		end if;
		res := jsonb_build_object('classRoll', null, 'class', cls, 'amountRoll', idx, 'level', p_value,
			'cep', (public.ce_levels() -> cls -> (idx - 1) ->> 1)::int);
	end if;

	if p_character is not null then
		select * into c from public.characters where id = p_character;
		if c.id is null or c.owner_id <> p_owner then
			raise exception 'That character doesn''t belong to this player.';
		end if;
		update public.player_rolls set status = 'void', settled_at = now()
		where character_id = c.id and kind = p_kind and status <> 'void';
	end if;
	-- The new roll becomes the player's unsettled one unless it goes on an approved character,
	-- so only then does it replace whatever they're carrying.
	if c.approved_at is null then
		update public.player_rolls set status = 'void', settled_at = now() where owner_id = p_owner and kind = p_kind and status = 'active';
	end if;

	insert into public.player_rolls (owner_id, kind, result, character_id, status, source, settled_at)
	values (p_owner, p_kind, res, c.id,
		case when c.approved_at is not null then 'consumed'::public.roll_status else 'active'::public.roll_status end,
		'admin', case when c.approved_at is not null then now() end);
	perform public.log_roll_event(p_owner, 'admin_set', jsonb_build_object('kind', p_kind, 'result', res, 'character', c.id));

	if c.id is not null then
		update public.characters set sheet = public.apply_rolls(sheet, id, false) where id = c.id;
	end if;
	return res;
end;
$$;

-- Throws away a player's unsettled roll of one kind (they can roll again), without a code.
create function public.admin_void_roll(p_owner uuid, p_kind public.roll_kind)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	perform public.require_admin();
	update public.player_rolls set status = 'void', settled_at = now() where owner_id = p_owner and kind = p_kind and status = 'active';
	perform public.log_roll_event(p_owner, 'admin_voided', jsonb_build_object('kind', p_kind));
end;
$$;


-- ───────────────────────────── Approval settles rolls ─────────────────────────────

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


-- ───────────────────────────── Security ─────────────────────────────

alter table public.player_rolls enable row level security;
alter table public.roll_locks enable row level security;
alter table public.roll_override_codes enable row level security;
alter table public.roll_events enable row level security;

-- Players see their own rolls, lock and history; admins see everyone's. Nobody writes
-- directly: only the functions above change these tables.
create policy "own or admin reads rolls" on public.player_rolls
	for select to authenticated using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy "own or admin reads lock" on public.roll_locks
	for select to authenticated using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy "admins read codes" on public.roll_override_codes
	for select to authenticated using ((select public.is_admin()));
create policy "own or admin reads roll events" on public.roll_events
	for select to authenticated using (owner_id = (select auth.uid()) or (select public.is_admin()));

revoke all on public.player_rolls, public.roll_locks, public.roll_override_codes, public.roll_events from anon;
revoke insert, update, delete, truncate on public.player_rolls, public.roll_locks, public.roll_override_codes, public.roll_events from authenticated;

revoke execute on function public.roll_die(int) from public, anon, authenticated;
revoke execute on function public.apply_rolls(jsonb, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.log_roll_event(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.perform_roll(uuid, public.roll_kind, uuid) from public, anon, authenticated;
revoke execute on function public.redeem_roll_override(text) from public, anon;
revoke execute on function public.require_admin() from public, anon, authenticated;
revoke execute on function public.create_roll_override(uuid, numeric) from public, anon;
revoke execute on function public.set_roll_lock(uuid, boolean, text) from public, anon;
revoke execute on function public.admin_set_roll(uuid, public.roll_kind, text, uuid) from public, anon;
revoke execute on function public.admin_void_roll(uuid, public.roll_kind) from public, anon;

grant execute on function public.perform_roll(uuid, public.roll_kind, uuid) to service_role;
grant execute on function public.redeem_roll_override(text) to authenticated;
grant execute on function public.create_roll_override(uuid, numeric) to authenticated;
grant execute on function public.set_roll_lock(uuid, boolean, text) to authenticated;
grant execute on function public.admin_set_roll(uuid, public.roll_kind, text, uuid) to authenticated;
grant execute on function public.admin_void_roll(uuid, public.roll_kind) to authenticated;
