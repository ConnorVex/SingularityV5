-- Singularity character portal: let trait combinations raise power-set limits.
--
-- Most power systems allow one power set per character (one Cursed Technique, one Stand…).
-- Some combinations allow more. Which ones is secret, so the limits live with the
-- combinations and reach the site only through discover_combos().
-- Run once in the SQL Editor, then re-run supabase/private/trait_combos_seed.sql.

-- e.g. {"some-system": 3} lets a character with this combination have 3 of that system.
alter table public.trait_combos
	add column system_limits jsonb not null default '{}'::jsonb check (jsonb_typeof(system_limits) = 'object');

-- The return type changes, so the function is recreated.
drop function public.discover_combos(uuid);

create function public.discover_combos(p_character_id uuid)
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
	if c.id is null or (c.owner_id is distinct from auth.uid() and not public.is_admin()) then
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

revoke execute on function public.discover_combos(uuid) from public, anon, authenticated;
grant execute on function public.discover_combos(uuid) to authenticated;
