// Family Directory: every approved family as a card, plus the viewer's own family and admin links.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { familiesBase, familyHref, loadFamilies, RECRUITING, type FamilyCard } from '../../lib/families/api.ts';
import { portalConfigured, watchPlayer, type Player } from '../../lib/supabase.ts';
import { messageOf, STATUS_TEXT, useFamilyTheme } from './shared.tsx';

const FILTERS = [
	{ id: 'all', label: 'All', match: () => true },
	{ id: 'recruiting', label: 'Recruiting', match: (f: FamilyCard) => f.recruiting !== 'closed' },
] as const;

function Card({ f }: { f: FamilyCard }) {
	const banner = /^https:\/\//.test(f.banner_url) ? f.banner_url : null;
	return (
		<article class="fm-card" style={{ '--fam': f.colour }}>
			<a class="fm-card-art" href={familyHref(f.slug)} tabIndex={-1} aria-hidden="true">
				{banner ? <img src={banner} alt="" loading="lazy" /> : <span>{f.name.slice(0, 1)}</span>}
			</a>
			<div class="fm-card-body">
				<h2 class="fm-card-title">
					<a href={familyHref(f.slug)}>{f.name}</a>
				</h2>
				<p class="fm-chips">
					{f.status !== 'approved' && <span class="fm-chip warn">{STATUS_TEXT[f.status].label}</span>}
					{f.special_statuses.map((s) => (
						<span class="fm-chip special" key={s}>
							{s}
						</span>
					))}
					<span class={`fm-chip ${f.recruiting === 'closed' ? 'muted' : 'good'}`}>{RECRUITING[f.recruiting]}</span>
				</p>
				{f.description && <p class="fm-card-text">{f.description}</p>}
				<p class="fm-card-meta">
					{[f.race, f.specialty, `${f.memberCount} member${f.memberCount === 1 ? '' : 's'}`, f.ownerName && `Run by ${f.ownerName}`]
						.filter(Boolean)
						.join(' · ')}
				</p>
			</div>
		</article>
	);
}

export default function FamilyDirectory() {
	const [player, setPlayer] = useState<Player | null | undefined>(undefined);
	const [families, setFamilies] = useState<FamilyCard[] | null>(null);
	const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
	const [search, setSearch] = useState('');
	const [error, setError] = useState('');

	useFamilyTheme(null);
	useEffect(() => {
		if (!portalConfigured) return setError('The portal is not connected to its database yet.');
		watchPlayer((p) => setPlayer(p));
	}, []);
	useEffect(() => {
		if (!portalConfigured || player === undefined) return;
		loadFamilies().then(setFamilies, (e) => setError(messageOf(e)));
	}, [player?.id ?? null, player === undefined]);

	const mine = player ? families?.find((f) => f.owner_id === player.id && f.status !== 'denied') : undefined;
	const approved = useMemo(() => families?.filter((f) => f.status === 'approved') ?? [], [families]);
	const shown = approved
		.filter(FILTERS.find((f) => f.id === filter)!.match)
		.filter((f) => !search.trim() || `${f.name} ${f.race} ${f.specialty}`.toLowerCase().includes(search.trim().toLowerCase()));
	const waiting = player?.isAdmin ? (families?.filter((f) => f.status === 'pending').length ?? 0) : 0;

	if (error) return <p class="portal-error">Couldn’t load the families: {error}</p>;
	if (!families) return <p class="portal-status">Loading families…</p>;

	return (
		<div class="pf fm">
			<div class="fm-top">
				<nav class="pf-nav" aria-label="Filter families">
					{FILTERS.map((f) => (
						<a
							key={f.id}
							href={`#${f.id}`}
							class={filter === f.id ? 'active' : undefined}
							aria-current={filter === f.id ? 'true' : undefined}
							onClick={(e) => {
								e.preventDefault();
								setFilter(f.id);
							}}
						>
							{f.label} <span class="mc-count">{approved.filter(f.match).length}</span>
						</a>
					))}
				</nav>
				<div class="pf-field fm-search">
					<label class="sr-only" for="fm-search">
						Search families
					</label>
					<input id="fm-search" type="search" placeholder="Search families…" value={search} onInput={(e) => setSearch(e.currentTarget.value)} />
				</div>
				<div class="fm-top-actions">
					{player?.isAdmin && (
						<a class="pf-button" href={`${familiesBase}admin/`}>
							Admin{waiting ? ` · ${waiting} waiting` : ''}
						</a>
					)}
					{mine ? (
						<a class="pf-button primary" href={familyHref(mine.slug)}>
							Your family{mine.status !== 'approved' ? ` · ${STATUS_TEXT[mine.status].label}` : ''}
						</a>
					) : (
						<a class="pf-button primary" href={`${familiesBase}new/`}>
							+ Found a family
						</a>
					)}
				</div>
			</div>

			{shown.length === 0 ? (
				<p class="pf-empty">{approved.length ? 'No families match.' : 'No families yet.'}</p>
			) : (
				<div class="fm-grid">
					{shown.map((f) => (
						<Card key={f.id} f={f} />
					))}
				</div>
			)}
		</div>
	);
}
