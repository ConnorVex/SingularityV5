-- Family perk requests: an owner sends any number of new or changed perks in one request, and an
-- admin approves or denies each perk on its own (e.g. 4 of 5 approved).
--
-- Run once in the SQL Editor after 20261101100000_family_tryouts.sql. Safe to run again.
--
--   * Owners no longer write family_perks directly: submit_perk_request() adds or changes perks,
--     always as pending, and posts one staff message for the whole request.
--   * review_perk_request() saves an admin's decisions. Once no perk in the request is still
--     waiting, the owner is pinged with the counts (never the perk text: some perks are secret).
--   * Owners can still remove their perks directly; that needs no review.

create table if not exists public.family_perk_requests (
	id uuid primary key default gen_random_uuid(),
	family_id uuid not null references public.families (id) on delete cascade,
	sent_by uuid references public.profiles (id) on delete set null,
	-- Optional message to the admins.
	note text not null default '' check (char_length(note) <= 2000),
	created_at timestamptz not null default now(),
	-- Set once no perk in the request is still pending.
	decided_at timestamptz
);
create index if not exists family_perk_requests_family_idx on public.family_perk_requests (family_id);

alter table public.family_perks
	add column if not exists request_id uuid references public.family_perk_requests (id) on delete set null;
create index if not exists family_perks_request_idx on public.family_perks (request_id);

-- Perks already waiting from before this file: one request per family.
with fams as (
	select distinct p.family_id from public.family_perks p where p.status = 'pending' and p.request_id is null
), made as (
	insert into public.family_perk_requests (family_id, sent_by)
	select fams.family_id, f.owner_id from fams join public.families f on f.id = fams.family_id
	returning id, family_id
)
update public.family_perks p set request_id = made.id
from made
where p.family_id = made.family_id and p.status = 'pending' and p.request_id is null;

-- One message per request replaces the per-perk one.
drop trigger if exists notify_family_perk on public.family_perks;
drop function if exists public.notify_family_perk();


-- ───────────────────────────── Sending ─────────────────────────────

-- p_perks: [{ id?, kind, access, title, description, hidden }]. With an id it changes that perk.
create or replace function public.submit_perk_request(p_family uuid, p_note text, p_perks jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	fam public.families;
	req uuid;
	e jsonb;
	lines text := '';
	n int;
begin
	if not (public.is_admin() or public.is_family_owner(p_family)) then
		raise exception 'Only the family''s owner can send perks.' using errcode = '42501';
	end if;
	select * into fam from public.families where id = p_family;
	if fam.id is null then
		raise exception 'Family not found.';
	end if;
	n := coalesce(jsonb_array_length(p_perks), 0);
	if n = 0 then
		raise exception 'Add at least one perk.';
	elsif n > 25 then
		raise exception 'Send at most 25 perks at a time.';
	end if;

	insert into public.family_perk_requests (family_id, sent_by, note)
	values (p_family, auth.uid(), left(btrim(coalesce(p_note, '')), 2000))
	returning id into req;

	for e in select * from jsonb_array_elements(p_perks) loop
		if coalesce(e->>'id', '') <> '' then
			update public.family_perks set
				kind = e->>'kind',
				access = coalesce(e->>'access', 'automatic'),
				title = btrim(e->>'title'),
				description = coalesce(e->>'description', ''),
				hidden = coalesce((e->>'hidden')::boolean, false),
				status = 'pending',
				request_id = req
			where id = (e->>'id')::uuid and family_id = p_family;
			if not found then
				raise exception 'One of these perks isn''t part of this family.';
			end if;
		else
			insert into public.family_perks (family_id, kind, access, title, description, hidden, status, request_id)
			values (p_family, e->>'kind', coalesce(e->>'access', 'automatic'), btrim(e->>'title'),
				coalesce(e->>'description', ''), coalesce((e->>'hidden')::boolean, false), 'pending', req);
		end if;
		lines := lines || '• **' || public.discord_escape(btrim(e->>'title')) || '** · ' || replace(e->>'kind', '_', ' ')
			|| case when coalesce((e->>'hidden')::boolean, false) then ' · 🔒 members only' else '' end || E'\n';
	end loop;

	-- Older requests whose perks were all moved into this one are finished.
	update public.family_perk_requests r set decided_at = now()
	where r.family_id = p_family and r.id <> req and r.decided_at is null
		and not exists (select 1 from public.family_perks p where p.request_id = r.id and p.status = 'pending');

	perform public.discord_post('discord_staff_webhook', jsonb_build_object(
		'content', '✨ ' || n || case when n = 1 then ' family perk' else ' family perks' end || ' sent for review',
		'embeds', jsonb_build_array(jsonb_build_object(
			'title', left(fam.name, 250),
			'url', public.portal_site_url() || '/families/admin/',
			'description', left(lines || case when btrim(coalesce(p_note, '')) <> '' then E'\n' || public.discord_escape(btrim(p_note)) else '' end, 4000)
		)),
		'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
	));
	return req;
end;
$$;


-- ───────────────────────────── Reviewing ─────────────────────────────

-- p_decisions: [{ id, status: 'approved' | 'denied', note? }]. Perks left out stay pending.
create or replace function public.review_perk_request(p_request uuid, p_decisions jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	r public.family_perk_requests;
	fam public.families;
	e jsonb;
	ok int;
	no int;
	ping text;
begin
	if not public.is_admin() then
		raise exception 'Only admins can review perks.' using errcode = '42501';
	end if;
	select * into r from public.family_perk_requests where id = p_request;
	if r.id is null then
		raise exception 'Request not found.';
	end if;

	for e in select * from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) loop
		if e->>'status' not in ('approved', 'denied') then
			raise exception 'Choose approve or deny.';
		end if;
		update public.family_perks
		set status = e->>'status', review_note = left(coalesce(e->>'note', ''), 1000)
		where id = (e->>'id')::uuid and request_id = p_request and status = 'pending';
	end loop;

	if r.decided_at is not null
		or exists (select 1 from public.family_perks p where p.request_id = p_request and p.status = 'pending') then
		return;
	end if;
	update public.family_perk_requests set decided_at = now() where id = p_request;

	select count(*) filter (where status = 'approved'), count(*) filter (where status = 'denied') into ok, no
	from public.family_perks where request_id = p_request;
	select * into fam from public.families where id = r.family_id;
	select p.discord_id into ping from public.profiles p where p.id = fam.owner_id;
	perform public.discord_post('discord_public_webhook', jsonb_build_object(
		'content', coalesce('<@' || ping || '>', 'The owner') || ', the admins reviewed the perks sent for **'
			|| public.discord_escape(fam.name) || '**: ' || ok || ' approved, ' || no || ' denied.',
		'embeds', jsonb_build_array(jsonb_build_object(
			'title', left(fam.name, 250),
			'url', public.portal_site_url() || '/families/view/?f=' || fam.slug
		)),
		'allowed_mentions', case when ping is not null
			then jsonb_build_object('users', jsonb_build_array(ping))
			else jsonb_build_object('parse', '[]'::jsonb) end
	));
end;
$$;


-- ───────────────────────────── Row-level security ─────────────────────────────

alter table public.family_perk_requests enable row level security;

drop policy if exists "owner or admin reads perk requests" on public.family_perk_requests;
create policy "owner or admin reads perk requests" on public.family_perk_requests
	for select to authenticated using (public.is_family_owner(family_id) or (select public.is_admin()));

-- Owners now go through submit_perk_request(); only admins write perks directly.
drop policy if exists "owner proposes perks" on public.family_perks;
drop policy if exists "admin adds perks" on public.family_perks;
create policy "admin adds perks" on public.family_perks
	for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "owner or admin edits perks" on public.family_perks;
drop policy if exists "admin edits perks" on public.family_perks;
create policy "admin edits perks" on public.family_perks
	for update to authenticated
	using ((select public.is_admin()))
	with check ((select public.is_admin()));

revoke all on public.family_perk_requests from anon, authenticated;
grant select on public.family_perk_requests to authenticated;

revoke execute on function public.submit_perk_request(uuid, text, jsonb) from public, anon;
revoke execute on function public.review_perk_request(uuid, jsonb) from public, anon;
grant execute on function public.submit_perk_request(uuid, text, jsonb) to authenticated;
grant execute on function public.review_perk_request(uuid, jsonb) to authenticated;
