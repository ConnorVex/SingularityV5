-- Singularity character portal: admins delete a character and free its canon claims.
--
-- Deleting a character row directly leaves its canon claims on the claim board (the claim
-- keeps the holder's name). This deletes both at once. Review notes go with the character;
-- its rolls stay in the player's history, and an unsettled roll carries to their next
-- character as usual.
--
-- Run once in the SQL Editor after the earlier portal files.

create function public.admin_delete_character(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.characters;
	released text[];
begin
	perform public.require_admin();

	select * into c from public.characters where id = p_character_id for update;
	if c.id is null then
		raise exception 'Character not found.';
	end if;

	with gone as (
		delete from public.claims where character_id = c.id returning claimable_id
	)
	select coalesce(array_agg(k.name order by k.name), '{}') into released
	from gone join public.claimables k on k.id = gone.claimable_id;

	delete from public.characters where id = c.id;

	return jsonb_build_object('name', c.name, 'releasedClaims', to_jsonb(released));
end;
$$;

revoke execute on function public.admin_delete_character(uuid) from public, anon;
grant execute on function public.admin_delete_character(uuid) to authenticated;
