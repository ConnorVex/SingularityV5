-- Equipment submissions in the Divine Database.
--
-- A player asks for a custom piece of equipment for one of their approved characters: what it is,
-- what it should do and which crafting items it might take. An admin reviews it; approving creates
-- a crafting recipe that only that character can use (the item it makes can be traded like any
-- other). The player still has to gather the ingredients and craft it.
--
-- Run AFTER the bot's crafting migrations (SingularityBot 20261031120000_bot_crafting.sql and
-- 20261031120100_bot_crafting_catalog.sql): this uses craft_recipes, econ_items and craft_create_custom.

-- ───────────────────────────── Table ─────────────────────────────

create table if not exists public.equipment_requests (
	id uuid primary key default gen_random_uuid(),
	character_id uuid not null references public.characters (id) on delete cascade,
	owner_id uuid not null references public.profiles (id) on delete cascade,
	name text not null check (char_length(btrim(name)) between 1 and 80),
	type text not null default 'other' check (type in ('weapon', 'suit', 'gadget', 'other')),
	description text not null default '' check (char_length(description) <= 1000),
	-- What the player wants it to do.
	effects text not null default '' check (char_length(effects) <= 4000),
	-- Reference pictures, one https link per line.
	images text not null default '' check (char_length(images) <= 2000),
	-- The ingredients the player suggests: [{item: econ_items id, qty}]. The admin sets the real ones.
	ingredients jsonb not null default '[]' check (jsonb_typeof(ingredients) = 'array'),
	status text not null default 'pending' check (status in ('pending', 'needs_correction', 'approved', 'denied')),
	review_note text not null default '' check (char_length(review_note) <= 2000),
	recipe_id uuid references public.craft_recipes (id) on delete set null,
	reviewed_by uuid references public.profiles (id) on delete set null,
	submitted_at timestamptz not null default now(),
	reviewed_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists equipment_requests_character on public.equipment_requests (character_id);
create index if not exists equipment_requests_open on public.equipment_requests (status) where status in ('pending', 'needs_correction');

-- Where a character-only recipe came from (the bot migration left this column without a key).
do $$
begin
	if not exists (select 1 from pg_constraint where conname = 'craft_recipes_equipment_request_fkey') then
		alter table public.craft_recipes
			add constraint craft_recipes_equipment_request_fkey
			foreign key (equipment_request) references public.equipment_requests (id) on delete set null;
	end if;
end;
$$;

alter table public.equipment_requests enable row level security;

-- Players read their own requests, admins read all. Writes go through the functions below.
drop policy if exists "own or admin reads equipment" on public.equipment_requests;
create policy "own or admin reads equipment" on public.equipment_requests
	for select to authenticated using (owner_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "withdraw own open equipment or admin" on public.equipment_requests;
create policy "withdraw own open equipment or admin" on public.equipment_requests
	for delete to authenticated using (
		(select public.is_admin())
		or (owner_id = (select auth.uid()) and status in ('pending', 'needs_correction'))
	);

-- ───────────────────────────── Ingredients players can pick ─────────────────────────────

-- The crafting catalog: components, crafted components and special items (no shop items, and no
-- other characters' custom items).
create or replace function public.portal_crafting_items()
returns table (id uuid, name text, kind text, rarity text, description text)
language sql
stable
security definer
set search_path = ''
as $$
	select i.id, i.name, i.kind, i.rarity, i.description
	from public.econ_items i
	where i.kind in ('component', 'crafted_component', 'special') and i.owner_character is null and i.active
	order by i.kind, i.name;
$$;

-- Keeps only real catalog items with a sensible amount; anything else is dropped.
create or replace function public.equipment_clean_ingredients(p_ingredients jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(jsonb_agg(jsonb_build_object('item', i.id, 'qty', least(greatest(x.qty, 1), 999)) order by i.name), '[]'::jsonb)
	from (
		select (e ->> 'item') as item, max(coalesce((e ->> 'qty')::int, 1)) as qty
		from jsonb_array_elements(case when jsonb_typeof(p_ingredients) = 'array' then p_ingredients else '[]'::jsonb end) e
		where (e ->> 'item') ~ '^[0-9a-f-]{36}$'
		group by 1
	) x
	join public.econ_items i on i.id = x.item::uuid
	where i.kind in ('component', 'crafted_component', 'special') and i.owner_character is null;
$$;

-- ───────────────────────────── Sending ─────────────────────────────

-- Sends a new request (p_id null) or updates one that is still open; a sent-back one goes back to review.
create or replace function public.submit_equipment(
	p_id uuid,
	p_character uuid,
	p_name text,
	p_type text,
	p_description text,
	p_effects text,
	p_images text,
	p_ingredients jsonb
)
returns public.equipment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.characters;
	r public.equipment_requests;
begin
	perform public.ensure_profile();
	select * into c from public.characters where id = p_character;
	if c.id is null or c.owner_id is distinct from auth.uid() then
		raise exception 'Pick one of your own characters.' using errcode = '42501';
	end if;
	if c.approved_at is null or c.status = 'denied' then
		raise exception 'Only approved characters can ask for equipment.' using errcode = '42501';
	end if;
	if char_length(btrim(coalesce(p_effects, ''))) = 0 then
		raise exception 'Describe what the equipment should do.';
	end if;

	if p_id is null then
		if (select count(*) from public.equipment_requests where character_id = c.id and status in ('pending', 'needs_correction')) >= 3 then
			raise exception '% already has 3 equipment requests waiting. Wait for a decision first.', c.name;
		end if;
		insert into public.equipment_requests (character_id, owner_id, name, type, description, effects, images, ingredients)
		values (c.id, auth.uid(), btrim(p_name), coalesce(p_type, 'other'), coalesce(p_description, ''), btrim(p_effects),
			coalesce(p_images, ''), public.equipment_clean_ingredients(p_ingredients))
		returning * into r;
		return r;
	end if;

	update public.equipment_requests set
		character_id = c.id,
		name = btrim(p_name),
		type = coalesce(p_type, 'other'),
		description = coalesce(p_description, ''),
		effects = btrim(p_effects),
		images = coalesce(p_images, ''),
		ingredients = public.equipment_clean_ingredients(p_ingredients),
		status = 'pending',
		submitted_at = case when status = 'needs_correction' then now() else submitted_at end,
		updated_at = now()
	where id = p_id and owner_id = auth.uid() and status in ('pending', 'needs_correction')
	returning * into r;
	if r.id is null then
		raise exception 'This request can''t be changed any more.' using errcode = '42501';
	end if;
	return r;
end;
$$;

-- ───────────────────────────── Deciding ─────────────────────────────

-- Admins approve (with the recipe), send back or deny. p_recipe on approval:
-- {name, description, rarity?, requirement? ('gifted'|'genius'|'super_genius'|''), craft_minutes, effects,
--  ingredients: [{item, qty}]}
create or replace function public.review_equipment(p_request uuid, p_outcome text, p_note text default '', p_recipe jsonb default null)
returns public.equipment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
	r public.equipment_requests;
	recipe public.craft_recipes;
begin
	if not public.is_admin() then
		raise exception 'Only admins can review equipment.' using errcode = '42501';
	end if;
	if p_outcome is null or p_outcome not in ('approved', 'needs_correction', 'denied') then
		raise exception 'The decision must be approved, needs_correction or denied.';
	end if;
	perform public.ensure_profile();
	select * into r from public.equipment_requests where id = p_request for update;
	if r.id is null then
		raise exception 'Request not found.';
	end if;
	if r.status not in ('pending', 'needs_correction') then
		raise exception 'This request has already been decided.';
	end if;

	if p_outcome = 'approved' then
		if p_recipe is null or char_length(btrim(coalesce(p_recipe ->> 'name', ''))) = 0 then
			raise exception 'Fill in the recipe before approving.';
		end if;
		recipe := public.craft_create_custom(r.character_id, r.id, p_recipe, public.portal_discord_id());
	end if;

	update public.equipment_requests set
		status = p_outcome,
		review_note = coalesce(p_note, ''),
		recipe_id = coalesce(recipe.id, recipe_id),
		reviewed_by = auth.uid(),
		reviewed_at = now(),
		updated_at = now()
	where id = r.id
	returning * into r;
	return r;
end;
$$;

-- ───────────────────────────── Discord ─────────────────────────────

create or replace function public.notify_equipment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	player_id text;
	who text;
	char_name text;
	name text := public.discord_escape(new.name);
begin
	select p.discord_id into player_id from public.profiles p where p.id = new.owner_id;
	who := case when player_id is not null then '<@' || player_id || '>' else 'A player' end;
	select coalesce(nullif(c.approved_name, ''), c.name) into char_name from public.characters c where c.id = new.character_id;

	-- Sent (or resent) for review → staff channel, mentions shown but never pinged.
	if new.status = 'pending' and (tg_op = 'INSERT' or old.status = 'needs_correction') then
		perform public.discord_post('discord_staff_webhook', jsonb_build_object(
			'content', case when tg_op = 'INSERT' then '🛠️ New equipment sent for review' else '🔁 Equipment resubmitted after correction' end,
			'embeds', jsonb_build_array(jsonb_build_object(
				'title', left(new.name, 250),
				'url', public.portal_site_url() || '/portal/admin/review/?type=equipment',
				'description', 'by ' || who || ' for **' || public.discord_escape(coalesce(char_name, 'a character')) || '**' || E'\n\n' || left(new.effects, 300)
			)),
			'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
		));
	end if;

	-- A decision → public channel, pinging only the player.
	if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'needs_correction', 'denied') then
		perform public.discord_post('discord_public_webhook', jsonb_build_object(
			'content', case new.status
				when 'approved' then who || ', your equipment **' || name || '** has been approved! The recipe is now on **'
					|| public.discord_escape(coalesce(char_name, 'your character')) || '**.'
				when 'needs_correction' then who || ', your equipment **' || name || '** is in need of correction. Check the note in the Divine Database.'
				else who || ', your equipment **' || name || '** has been DENIED.'
			end,
			'allowed_mentions', case when player_id is not null
				then jsonb_build_object('users', jsonb_build_array(player_id))
				else jsonb_build_object('parse', '[]'::jsonb) end
		));
	end if;
	return null;
end;
$$;

drop trigger if exists notify_equipment on public.equipment_requests;
create trigger notify_equipment
	after insert or update of status on public.equipment_requests
	for each row execute function public.notify_equipment();

-- ───────────────────────────── Permissions ─────────────────────────────

revoke all on public.equipment_requests from anon;
revoke insert, update on public.equipment_requests from authenticated;

revoke execute on function public.portal_crafting_items() from public, anon;
revoke execute on function public.equipment_clean_ingredients(jsonb) from public, anon, authenticated;
revoke execute on function public.submit_equipment(uuid, uuid, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.review_equipment(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.notify_equipment() from public, anon, authenticated;
grant execute on function public.portal_crafting_items() to authenticated;
grant execute on function public.submit_equipment(uuid, uuid, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.review_equipment(uuid, text, text, jsonb) to authenticated;
