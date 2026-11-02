// Divine Database home: what you can submit, what's waiting on you, and your stuff at a glance.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { CharacterSummary } from '../../lib/portal/api.ts';
import { loadHome, type HomeData } from '../../lib/portal/home.ts';
import { startPortalTheme } from '../../lib/portal/theme.ts';
import { logIn, loginErrorFromUrl, portalConfigured, watchPlayer, type Player } from '../../lib/supabase.ts';

const root = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const portal = `${root}portal/`;
const families = `${root}families/`;
const familyHref = (slug: string) => `${families}view/?f=${encodeURIComponent(slug)}`;
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Small line icons, drawn in the accent colour.
const ICONS = {
	character: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
	evolution: 'M12 20V5m0 0-6 6m6-6 6 6M5 3h14',
	equipment: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5 2.5-2.5Z',
	family: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20a6 6 0 0 1 12 0m-1.5-4.5A6 6 0 0 1 22 20',
};
const Icon = ({ name }: { name: keyof typeof ICONS }) => (
	<svg class="dd-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
		<path d={ICONS[name]} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
);

function Tile(props: { icon: keyof typeof ICONS; title: string; text: string; href?: string; badge?: string; dim?: boolean; children?: ComponentChildren }) {
	return (
		<article class={`dd-tile${props.href ? ' linked' : ''}${props.dim ? ' dim' : ''}`}>
			<Icon name={props.icon} />
			<h3>{props.href ? <a href={props.href}>{props.title}</a> : props.title}</h3>
			{props.badge && <span class="dd-badge">{props.badge}</span>}
			<p>{props.text}</p>
			{props.children}
		</article>
	);
}

/** The character's state in plain words, plus where its button goes. */
function describe(c: CharacterSummary): { label: string; tone: string } {
	const evolving = Boolean(c.approved_at) && c.status !== 'approved' && c.status !== 'denied';
	if (evolving) {
		if (c.status === 'pending') return { label: 'Evolution in review', tone: 'info' };
		if (c.status === 'needs_correction') return { label: 'Evolution needs correction', tone: 'warn' };
		return { label: 'Evolution not sent', tone: 'muted' };
	}
	return {
		draft: { label: 'Draft', tone: 'muted' },
		pending: { label: 'In review', tone: 'info' },
		approved: { label: 'Approved', tone: 'good' },
		needs_correction: { label: 'Needs correction', tone: 'warn' },
		denied: { label: 'Denied', tone: 'bad' },
	}[c.status];
}
const editHref = (c: CharacterSummary) => (c.approved_at && c.status !== 'denied' ? `${portal}evolve/?id=${c.id}` : `${portal}submit/?id=${c.id}`);

interface Todo {
	tone: 'warn' | 'info' | 'muted';
	text: string;
	href: string;
	action: string;
}

function todos(data: HomeData): Todo[] {
	const list: Todo[] = [];
	for (const c of data.characters) {
		const evolving = Boolean(c.approved_at);
		if (c.status === 'needs_correction')
			list.push({ tone: 'warn', text: `${c.name}: ${evolving ? 'the evolution' : 'the character'} was sent back for correction.`, href: editHref(c), action: 'Fix it' });
		else if (c.status === 'draft')
			list.push({ tone: 'muted', text: `${c.name}: ${evolving ? 'evolution changes' : 'a draft'} not sent for review yet.`, href: editHref(c), action: 'Continue' });
	}
	const f = data.family;
	if (f?.status === 'needs_correction') list.push({ tone: 'warn', text: `${f.name} was sent back for correction.`, href: familyHref(f.slug), action: 'Open family' });
	if (f?.joinRequests) list.push({ tone: 'info', text: `${f.name} has ${plural(f.joinRequests, 'join request')}.`, href: familyHref(f.slug), action: 'Review' });
	if (f?.tryouts) list.push({ tone: 'info', text: `${f.name} has ${plural(f.tryouts, 'tryout')} waiting.`, href: familyHref(f.slug), action: 'Review' });
	if (f?.reviews)
		list.push({ tone: 'info', text: `${plural(f.reviews, 'new character')} picked ${f.name} and ${f.reviews === 1 ? 'waits' : 'wait'} for your review.`, href: `${portal}admin/review/`, action: 'Review' });
	const a = data.admin;
	if (data.equipmentToFix)
		list.push({ tone: 'warn', text: `${plural(data.equipmentToFix, 'equipment request')} sent back for correction.`, href: `${portal}characters/?tab=equipment`, action: 'Open' });
	if (a?.characters) list.push({ tone: 'info', text: `${plural(a.characters, 'character')} waiting for review.`, href: `${portal}admin/review/`, action: 'Review' });
	if (a?.families) list.push({ tone: 'info', text: `${plural(a.families, 'new family')} waiting for review.`, href: `${portal}admin/review/?type=families`, action: 'Review' });
	if (a?.perkRequests) list.push({ tone: 'info', text: `${plural(a.perkRequests, 'family perk request')} waiting for review.`, href: `${portal}admin/review/?type=perks`, action: 'Review' });
	if (a?.equipment) list.push({ tone: 'info', text: `${plural(a.equipment, 'equipment request')} waiting for review.`, href: `${portal}admin/review/?type=equipment`, action: 'Review' });
	return list;
}

function LoggedOut({ onError }: { onError: (m: string) => void }) {
	return (
		<>
			<section class="dd-hero">
				<p class="dd-lead">
					Everything you send in for Singularity lives here: your characters, how they grow, the gear they craft and the families they belong to.
				</p>
				<button type="button" class="portal-button discord" disabled={!portalConfigured} onClick={() => logIn().catch((e) => onError(messageOf(e)))}>
					Log in with Discord
				</button>
			</section>
			<h2 class="dd-heading">What you can submit</h2>
			<div class="dd-tiles">
				<Tile icon="character" title="Characters" text="Make an original character or try out for a canon one. Admins review every sheet." />
				<Tile icon="evolution" title="Evolutions" text="When an approved character grows, send in what changed and how they earned it." />
				<Tile icon="equipment" title="Equipment" text="Pitch a custom item and a Gamemaster writes the crafting recipe for it." />
				<Tile icon="family" title="Families" text="Found your own family, or ask to join one with an approved character." />
			</div>
		</>
	);
}

export default function PortalHome() {
	const [player, setPlayer] = useState<Player | null | undefined>(portalConfigured ? undefined : null);
	const [data, setData] = useState<HomeData | null>(null);
	const [error, setError] = useState(() => {
		const urlError = loginErrorFromUrl();
		if (urlError) return `Discord login didn't finish: ${urlError}`;
		return portalConfigured ? '' : 'The portal is not connected to its database yet (PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY are missing from this build).';
	});

	useEffect(() => startPortalTheme(), []);
	useEffect(() => (portalConfigured ? watchPlayer((p, e) => (e ? setError(`Couldn't load your account: ${messageOf(e)}`) : setPlayer(p))) : undefined), []);
	useEffect(() => {
		if (player) loadHome(player.isAdmin).then(setData, (e) => setError(messageOf(e)));
	}, [player?.id]);

	const errorBox = error ? <p class="portal-error">{error}</p> : null;
	if (player === undefined) return <p class="portal-status">Checking your login…</p>;
	if (player === null)
		return (
			<div class="dd-home">
				{errorBox}
				<LoggedOut onError={setError} />
			</div>
		);
	if (!data)
		return (
			<div class="dd-home">
				{errorBox ?? <p class="portal-status">Loading your stuff…</p>}
			</div>
		);

	const approved = data.characters.filter((c) => c.approved_at && c.status !== 'denied');
	const inReview = data.characters.filter((c) => c.status === 'pending').length;
	const list = todos(data);
	const nameOf = (id: string) => data.characters.find((c) => c.id === id)?.name ?? 'A character';

	return (
		<div class="dd-home">
			{errorBox}
			<section class="dd-hero">
				<h2 class="dd-welcome">Welcome back, {player.displayName}</h2>
				<dl class="dd-facts">
					<div>
						<dt>Characters</dt>
						<dd>{data.characters.length}</dd>
					</div>
					<div>
						<dt>Approved</dt>
						<dd>{approved.length}</dd>
					</div>
					<div>
						<dt>In review</dt>
						<dd>{inReview}</dd>
					</div>
					<div>
						<dt>Families</dt>
						<dd>{new Set(data.memberships.filter((m) => m.status === 'active').map((m) => m.familySlug)).size}</dd>
					</div>
				</dl>
			</section>

			{list.length > 0 && (
				<section>
					<h2 class="dd-heading">Needs your attention</h2>
					<ul class="dd-todos">
						{list.map((t) => (
							<li key={t.text} class={`tone-${t.tone}`}>
								<span>{t.text}</span>
								<a class="pf-button subtle" href={t.href}>
									{t.action}
								</a>
							</li>
						))}
					</ul>
				</section>
			)}

			<h2 class="dd-heading">Start a submission</h2>
			<div class="dd-tiles">
				<Tile icon="character" title="New character" href={`${portal}submit/`} text="An original character or a canon tryout. Your progress saves as you go." />
				<Tile
					icon="evolution"
					title="Evolution"
					dim={approved.length === 0}
					text={approved.length ? 'Pick the approved character that grew:' : 'You need an approved character before you can evolve one.'}
				>
					{approved.length > 0 && (
						<ul class="dd-chips">
							{approved.slice(0, 6).map((c) => (
								<li key={c.id}>
									<a href={`${portal}evolve/?id=${c.id}`}>{c.name}</a>
								</li>
							))}
						</ul>
					)}
				</Tile>
				<Tile
					icon="equipment"
					title="Equipment"
					href={approved.length ? `${portal}equipment/` : undefined}
					dim={!approved.length}
					text={approved.length ? 'Pitch a custom item and a Gamemaster writes the crafting recipe for it.' : 'Once a character is approved, pitch a custom item for it here.'}
				/>
				{data.family ? (
					<Tile icon="family" title={data.family.name} href={familyHref(data.family.slug)} text="Your family. Manage its page, roster, divisions and perks." />
				) : (
					<Tile icon="family" title="Found a family" href={`${families}new/`} text="Start your own family. An admin reviews it before it goes live." />
				)}
			</div>

			<h2 class="dd-heading">My Stuff</h2>
			<div class="dd-stuff">
				<section class="portal-card">
					<header class="dd-stuff-head">
						<h3>Characters</h3>
						<a href={`${portal}characters/`}>See all</a>
					</header>
					{data.characters.length === 0 ? (
						<p class="pf-empty">No characters yet.</p>
					) : (
						<ul class="dd-rows">
							{data.characters.slice(0, 5).map((c) => {
								const s = describe(c);
								return (
									<li key={c.id}>
										<a href={editHref(c)}>{c.name}</a>
										<span class={`dd-status tone-${s.tone}`}>{s.label}</span>
									</li>
								);
							})}
						</ul>
					)}
				</section>
				<section class="portal-card">
					<header class="dd-stuff-head">
						<h3>Families</h3>
						<a href={families}>Directory</a>
					</header>
					{data.memberships.length === 0 && !data.family ? (
						<p class="pf-empty">Not in a family yet. Open a family's page to ask to join.</p>
					) : (
						<ul class="dd-rows">
							{data.family && (
								<li>
									<a href={familyHref(data.family.slug)}>{data.family.name}</a>
									<span class={`dd-status tone-${data.family.status === 'approved' ? 'good' : data.family.status === 'needs_correction' ? 'warn' : 'info'}`}>
										{data.family.status === 'approved' ? 'Owner' : data.family.status === 'needs_correction' ? 'Needs correction' : 'In review'}
									</span>
								</li>
							)}
							{data.memberships.map((m) => (
								<li key={`${m.familySlug}-${m.characterId}`}>
									<a href={familyHref(m.familySlug)}>{m.familyName}</a>
									<span class={`dd-status tone-${m.status === 'active' ? 'good' : 'info'}`}>
										{nameOf(m.characterId)} · {m.status === 'active' ? 'Member' : 'Asked to join'}
									</span>
								</li>
							))}
						</ul>
					)}
				</section>
			</div>
		</div>
	);
}
