-- Singularity character portal: override codes for one specific roll, and a trait rename.
--
-- An admin now makes a code for ONE roll (e.g. "Kaito's Potential"). The code only works on
-- that roll, each roll has at most one active code, and admins can see and cancel an active
-- code. Players can see that a code is waiting for one of their rolls (not the code), so the
-- portal shows a code box next to exactly that roll while the code is active.
--
-- Run once in the SQL Editor after the earlier portal files.


-- ───────────────────────────── Trait rename ─────────────────────────────

-- "Attention Deficit Hyperactive Disorder (ADHD)" is now just "ADHD" on saved sheets.
update public.characters
set sheet = jsonb_set(sheet, '{traits}', (
	select jsonb_agg(case when t ->> 'name' = 'Attention Deficit Hyperactive Disorder (ADHD)' then jsonb_set(t, '{name}', '"ADHD"') else t end order by ord)
	from jsonb_array_elements(sheet -> 'traits') with ordinality as x (t, ord)
))
where jsonb_typeof(sheet -> 'traits') = 'array'
	and sheet -> 'traits' @> '[{"name": "Attention Deficit Hyperactive Disorder (ADHD)"}]';


-- ───────────────────────────── Codes for one roll ─────────────────────────────

alter table public.roll_override_codes
	add column roll_id uuid references public.player_rolls (id) on delete cascade,
	add column kind public.roll_kind,
	add column character_id uuid references public.characters (id) on delete set null,
	-- Kept only while the code is active, so admins can read it out again; cleared once used,
	-- cancelled or expired. Players can never read this table.
	add column code_plain text,
	add column cancelled_at timestamptz;

create index roll_override_codes_roll_idx on public.roll_override_codes (roll_id);

-- Forget the readable copy of codes that can no longer be used.
create function public.tidy_override_codes()
returns void
language sql
security definer
set search_path = ''
as $$
	update public.roll_override_codes set code_plain = null
	where code_plain is not null and (used_at is not null or cancelled_at is not null or expires_at <= now());
$$;

-- Makes a single-use 8-digit code that lets the player re-roll ONE roll. Any earlier active
-- code for the same roll is cancelled. Valid for p_hours (at least 2).
create function public.create_roll_override_for(p_roll uuid, p_hours numeric default 2)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	r public.player_rolls;
	code text;
	expires timestamptz := now() + make_interval(secs => (greatest(coalesce(p_hours, 2), 2) * 3600)::double precision);
	new_id uuid;
begin
	perform public.require_admin();
	perform public.tidy_override_codes();
	select * into r from public.player_rolls where id = p_roll;
	if r.id is null then
		raise exception 'Roll not found.';
	end if;
	if r.status = 'void' then
		raise exception 'That roll was already cleared; the player can roll again without a code.';
	end if;

	update public.roll_override_codes set cancelled_at = now(), code_plain = null
	where roll_id = r.id and used_at is null and cancelled_at is null;

	code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 100000000))::text, 8, '0');
	insert into public.roll_override_codes (owner_id, code_hash, created_by, expires_at, roll_id, kind, character_id, code_plain)
	values (r.owner_id, encode(sha256(convert_to(code, 'UTF8')), 'hex'), auth.uid(), expires, r.id, r.kind, r.character_id, code)
	returning id into new_id;
	perform public.log_roll_event(r.owner_id, 'override_created', jsonb_build_object('kind', r.kind, 'roll', r.id, 'character', r.character_id, 'expires', expires));
	return jsonb_build_object('id', new_id, 'code', code, 'expires', expires);
end;
$$;

create function public.cancel_roll_override(p_code_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.roll_override_codes;
begin
	perform public.require_admin();
	update public.roll_override_codes set cancelled_at = now(), code_plain = null
	where id = p_code_id and used_at is null and cancelled_at is null
	returning * into c;
	if c.id is not null then
		perform public.log_roll_event(c.owner_id, 'override_cancelled', jsonb_build_object('kind', c.kind, 'roll', c.roll_id));
	end if;
end;
$$;

-- Codes waiting for the logged-in player: which roll each is for (never the code itself).
create function public.my_pending_overrides()
returns table (roll_id uuid, kind public.roll_kind, character_id uuid, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
	select c.roll_id, c.kind, c.character_id, c.expires_at
	from public.roll_override_codes c
	join public.player_rolls r on r.id = c.roll_id and r.status <> 'void'
	where c.owner_id = auth.uid() and c.used_at is null and c.cancelled_at is null and c.expires_at > now();
$$;

-- Uses a code. With p_roll, the code must be the one made for that roll. A code made for a
-- roll clears only that roll; an older account-wide code clears all unsettled rolls.
-- Returns {ok, message}; 5 wrong codes in an hour pauses code entry.
drop function public.redeem_roll_override(text);

create function public.redeem_roll_override(p_code text, p_roll uuid default null)
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
	where owner_id = uid and used_at is null and cancelled_at is null and expires_at > now()
		and code_hash = encode(sha256(convert_to(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'UTF8')), 'hex')
		and (p_roll is null or roll_id = p_roll)
	for update;

	if code_row.id is null then
		insert into public.roll_events (owner_id, actor_id, action, detail) values (uid, uid, 'override_failed', jsonb_build_object('roll', p_roll));
		return jsonb_build_object('ok', false, 'message', 'That code is wrong, already used, expired, or meant for a different roll.');
	end if;

	update public.roll_override_codes set used_at = now(), code_plain = null where id = code_row.id;
	if code_row.roll_id is not null then
		update public.player_rolls set status = 'void', settled_at = now() where id = code_row.roll_id and status <> 'void';
	else
		update public.player_rolls set status = 'void', settled_at = now() where owner_id = uid and status = 'active';
	end if;
	get diagnostics freed = row_count;
	insert into public.roll_events (owner_id, actor_id, action, detail)
	values (uid, uid, 'override_used', jsonb_build_object('code', code_row.id, 'kind', code_row.kind, 'roll', code_row.roll_id, 'rollsFreed', freed));
	return jsonb_build_object('ok', true, 'message', 'Override accepted. You can roll again.', 'kind', code_row.kind);
end;
$$;

revoke execute on function public.tidy_override_codes() from public, anon, authenticated;
revoke execute on function public.create_roll_override_for(uuid, numeric) from public, anon;
revoke execute on function public.cancel_roll_override(uuid) from public, anon;
revoke execute on function public.my_pending_overrides() from public, anon;
revoke execute on function public.redeem_roll_override(text, uuid) from public, anon;
grant execute on function public.create_roll_override_for(uuid, numeric) to authenticated;
grant execute on function public.cancel_roll_override(uuid) to authenticated;
grant execute on function public.my_pending_overrides() to authenticated;
grant execute on function public.redeem_roll_override(text, uuid) to authenticated;
