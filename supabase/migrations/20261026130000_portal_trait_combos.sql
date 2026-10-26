-- Singularity character portal: secret trait combinations and extra trait slots.
--
-- Run once in the SQL Editor, after the first two portal files.
-- The combinations themselves are NOT in this file (this repository is public).
-- They're loaded separately from supabase/private/, which is never committed.


-- ───────────────────────────── Extra trait slots ─────────────────────────────

-- Slots on top of the base 4, from Mythic families or gifted by an admin.
alter table public.characters
	add column extra_trait_slots int not null default 0 check (extra_trait_slots between 0 and 20);

-- Same rules as before, plus: only admins can change extra_trait_slots.
create or replace function public.guard_character()
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
			new.extra_trait_slots := 0;
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


-- ───────────────────────────── Trait combinations ─────────────────────────────

-- Secret: only admins can read this table. Players learn about a combination
-- only when their own character's traits form it (see discover_combos).
create table public.trait_combos (
	name text primary key check (char_length(btrim(name)) between 1 and 100),
	-- Each inner list is one required trait; several names in one list mean any of them works.
	-- e.g. [["Trait A"], ["Trait B", "Trait C"]] means Trait A plus either Trait B or Trait C.
	requires jsonb not null check (jsonb_typeof(requires) = 'array' and jsonb_array_length(requires) >= 2),
	perks text not null default '',
	updated_at timestamptz not null default now()
);

create trigger touch_trait_combos before update on public.trait_combos
	for each row execute function public.touch_updated_at();

alter table public.trait_combos enable row level security;
create policy "admins manage combos" on public.trait_combos
	for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.trait_combos from anon;

-- The combinations formed by a character's saved traits (sheet.traits[].name).
-- Only the owner or an admin may ask. A sheet with more traits than its slots allow
-- reveals nothing, so combinations can't be found by listing every trait at once.
create function public.discover_combos(p_character_id uuid)
returns table (name text, requires jsonb, perks text)
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
	if c.id is null or (c.owner_id is distinct from auth.uid() and not public.is_admin()) then
		raise exception 'Character not found.' using errcode = '42501';
	end if;

	select coalesce(array_agg(t ->> 'name'), '{}') into picked
	from jsonb_array_elements(case when jsonb_typeof(c.sheet -> 'traits') = 'array' then c.sheet -> 'traits' else '[]'::jsonb end) t;

	if cardinality(picked) > 4 + c.extra_trait_slots then
		return;
	end if;

	return query
	select k.name, k.requires, k.perks
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

revoke execute on function public.discover_combos(uuid) from public, anon, authenticated;
grant execute on function public.discover_combos(uuid) to authenticated;
