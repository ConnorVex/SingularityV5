-- Singularity character portal: Discord notifications.
--
-- Whenever a character's status changes, the database posts to Discord:
--   * staff channel:  a character was sent for review (new, resubmitted, or an evolution)
--   * public channel: an admin's decision, @mentioning the player
--
-- The two webhook links live in Supabase Vault (encrypted), never in this repository:
--   select vault.create_secret('<staff webhook url>',  'discord_staff_webhook');
--   select vault.create_secret('<public webhook url>', 'discord_public_webhook');
-- Missing links just mean no message. A failed post never blocks saving a character.
--
-- Run once in the SQL Editor after the earlier portal files.

create extension if not exists pg_net;

create function public.portal_site_url()
returns text
language sql
immutable
set search_path = ''
as $$
	select 'https://connorvex.github.io/SingularityV5';
$$;

-- Discord formatting characters (* _ ~ ` | \) in a name would otherwise change how the message looks.
create function public.discord_escape(t text)
returns text
language sql
immutable
set search_path = ''
as $$
	select regexp_replace(coalesce(t, ''), '([\\*_~`|])', '\\\1', 'g');
$$;

create function public.discord_webhook(secret_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1;
$$;

-- Posts one message; never raises, so a Discord problem can't stop a save.
create function public.discord_post(secret_name text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	url text;
begin
	url := public.discord_webhook(secret_name);
	if url is null or url !~ '^https://(canary\.|ptb\.)?discord(app)?\.com/api/webhooks/' then
		return;
	end if;
	perform net.http_post(
		url := url,
		body := payload,
		headers := jsonb_build_object('Content-Type', 'application/json')
	);
exception when others then
	raise warning 'Discord notification failed: %', sqlerrm;
end;
$$;

create function public.notify_character_status()
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
	kind_text text;
	role_color int;
	series text;
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
				'description', 'by ' || who || E'\n' || kind_text,
				'color', role_color
			)),
			'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
		));
	end if;

	-- A review decision → public channel, pinging only the player.
	if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'needs_correction', 'denied') then
		perform public.discord_post('discord_public_webhook', jsonb_build_object(
			'content', case new.status
				when 'approved' then
					case when was_approved
						then who || ', the evolution of your character **' || name || '** has been approved!'
						else who || ', your character **' || name || '** has been approved!' end
				when 'needs_correction' then who || ', your character **' || name || '** is in need of correction, please open a ticket to get started!'
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

create trigger notify_character_status
	after insert or update of status on public.characters
	for each row execute function public.notify_character_status();

revoke execute on function public.discord_webhook(text) from public, anon, authenticated;
revoke execute on function public.discord_post(text, jsonb) from public, anon, authenticated;
revoke execute on function public.notify_character_status() from public, anon, authenticated;
