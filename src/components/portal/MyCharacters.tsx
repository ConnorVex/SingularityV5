// "My Characters": the player's submissions, their status, admin review notes and roll locks.
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
	deleteCharacter,
	loadMyCharacters,
	loadMyRolls,
	loadReviewNotes,
	loadUniverses,
	type CharacterSummary,
	type MyRolls,
	type ReviewNote,
	type Status,
	type Universe,
} from '../../lib/portal/api.ts';
import { rules } from '../../lib/portal/rules.ts';
import { startPortalTheme, themeForRole } from '../../lib/portal/theme.ts';
import { logIn, watchPlayer, type Player } from '../../lib/supabase.ts';

const base = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}portal/`;
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

const STATUS: Record<Status, { label: string; tone: string; help: string }> = {
	draft: { label: 'Draft', tone: 'muted', help: 'Not sent for review yet.' },
	pending: { label: 'In review', tone: 'info', help: 'Waiting for an admin. You can still edit it.' },
	approved: { label: 'Approved', tone: 'good', help: 'Approved and in the gallery.' },
	needs_correction: { label: 'Needs correction', tone: 'warn', help: 'An admin sent it back. Fix it and send it again.' },
	denied: { label: 'Denied', tone: 'bad', help: 'Denied and locked. Create a new character.' },
};

const FILTERS: { id: string; label: string; match: (c: CharacterSummary) => boolean }[] = [
	{ id: 'all', label: 'All', match: () => true },
	{ id: 'draft', label: 'Drafts', match: (c) => c.status === 'draft' && !c.approved_at },
	{ id: 'review', label: 'In review', match: (c) => c.status === 'pending' },
	{ id: 'fix', label: 'Needs correction', match: (c) => c.status === 'needs_correction' },
	{ id: 'approved', label: 'Approved', match: (c) => Boolean(c.approved_at) && c.status !== 'denied' },
	{ id: 'denied', label: 'Denied', match: (c) => c.status === 'denied' },
];

const OUTCOME: Record<string, string> = { approved: 'Approved', needs_correction: 'Sent back for correction', denied: 'Denied' };

function CharacterCard({ c, notes, universes, onDeleted }: { c: CharacterSummary; notes: ReviewNote[]; universes: Universe[]; onDeleted: () => void }) {
	const [showAll, setShowAll] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState('');
	const status = STATUS[c.status];
	// An approved character with unsent or pending changes is an evolution in progress.
	const evolving = Boolean(c.approved_at) && (c.status === 'draft' || c.status === 'pending');
	const theme = c.kind === 'oc' ? themeForRole(c.role) : null;
	const roleLabel = rules.roles.find((r) => r.id === c.role)?.label;
	const series = universes.find((u) => u.slug === c.canon_universe)?.name;
	const potential = rules.potentials.find((p) => p.id === c.potential)?.label;
	const canDelete = !c.approved_at && c.status !== 'denied';
	const latest = notes[0];
	const editHref = `${base}submit/?id=${c.id}`;

	return (
		<article class={`mc-card tone-${evolving ? 'info' : status.tone}`} style={theme ? { '--card-accent': theme.color } : undefined}>
			<a class="mc-art" href={editHref} tabIndex={-1} aria-hidden="true">
				{c.image && /^https:\/\//.test(c.image) ? <img src={c.image} alt="" loading="lazy" /> : <span>{c.name.slice(0, 1).toUpperCase()}</span>}
			</a>
			<div class="mc-body">
				<header class="mc-head">
					<h3>
						<a href={editHref}>{c.name}</a>
					</h3>
					<span class="mc-status">{evolving ? (c.status === 'pending' ? 'Evolution in review' : 'Approved · edits not sent') : status.label}</span>
				</header>
				<p class="mc-meta">
					{c.kind === 'canon' ? `Canon tryout · ${series ?? 'unknown series'}` : `OC${roleLabel ? ` · ${roleLabel}` : ''}`}
					{potential ? ` · ${potential} Potential` : ''}
					{` · updated ${when(c.updated_at)}`}
				</p>
				<p class="mc-help">{evolving ? 'The approved version stays public until these changes are approved.' : status.help}</p>

				{latest && (
					<div class={`mc-note ${latest.outcome ?? ''}`}>
						<p class="mc-note-head">
							<strong>{latest.outcome ? OUTCOME[latest.outcome] : 'Admin note'}</strong> · {when(latest.created_at)}
						</p>
						{latest.body ? <p class="mc-note-body">{latest.body}</p> : <p class="mc-note-body empty">No note left.</p>}
						{notes.length > 1 && (
							<button type="button" class="mc-link" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
								{showAll ? 'Hide earlier notes' : `Show ${notes.length - 1} earlier note${notes.length === 2 ? '' : 's'}`}
							</button>
						)}
						{showAll && (
							<ul class="mc-history">
								{notes.slice(1).map((n) => (
									<li key={n.id}>
										<strong>{n.outcome ? OUTCOME[n.outcome] : 'Note'}</strong> · {when(n.created_at)}
										{n.body && <p>{n.body}</p>}
									</li>
								))}
							</ul>
						)}
					</div>
				)}

				<div class="mc-actions">
					<a class="pf-button primary" href={editHref}>
						{c.status === 'denied' ? 'View' : c.status === 'needs_correction' ? 'Fix and resend' : 'Edit'}
					</a>
					{canDelete &&
						(confirming ? (
							<span class="pf-confirm" role="group" aria-label={`Delete ${c.name}?`}>
								<span>Delete {c.name}?</span>
								<button
									type="button"
									class="pf-button danger"
									autoFocus
									onClick={() =>
										deleteCharacter(c.id).then(onDeleted, (e) => {
											setError(messageOf(e));
											setConfirming(false);
										})
									}
								>
									Yes, delete
								</button>
								<button type="button" class="pf-button subtle" onClick={() => setConfirming(false)}>
									Cancel
								</button>
							</span>
						) : (
							<button type="button" class="pf-button subtle" onClick={() => setConfirming(true)}>
								Delete
							</button>
						))}
				</div>
				{error && <p class="portal-error">{error}</p>}
			</div>
		</article>
	);
}

function RollBanner({ rolls, characters }: { rolls: MyRolls | null; characters: CharacterSummary[] }) {
	if (!rolls) return null;
	const lines: string[] = [];
	for (const [kind, label] of [
		['potential', 'Potential'],
		['cursed_energy', 'Cursed Energy'],
	] as const) {
		const a = rolls.active[kind];
		if (!a) continue;
		const name = a.heldBy?.name ?? characters.find((c) => c.id === a.row.character_id)?.name;
		lines.push(
			a.heldBy
				? `Your ${label} roll is locked to ${name}. Get it approved to roll again for a new character.`
				: `You have an unused ${label} roll. It will carry over to your next character.`,
		);
	}
	if (rolls.lock) lines.push(`Rolling is locked on your account by an admin${rolls.lock.reason ? `: ${rolls.lock.reason}` : '.'}`);
	if (lines.length === 0) return null;
	return (
		<div class="mc-banner" role="status">
			<span aria-hidden="true">🔒</span>
			<div>
				{lines.map((l) => (
					<p key={l}>{l}</p>
				))}
			</div>
		</div>
	);
}

export default function MyCharacters() {
	const [player, setPlayer] = useState<Player | null | undefined>(undefined);
	const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
	const [notes, setNotes] = useState<ReviewNote[]>([]);
	const [universes, setUniverses] = useState<Universe[]>([]);
	const [rolls, setRolls] = useState<MyRolls | null>(null);
	const [filter, setFilter] = useState('all');
	const [error, setError] = useState('');

	useEffect(() => startPortalTheme(), []);
	useEffect(() => watchPlayer((p, e) => (e ? setError(messageOf(e)) : setPlayer(p))), []);

	async function load() {
		try {
			const [list, u] = await Promise.all([loadMyCharacters(), loadUniverses()]);
			setCharacters(list);
			setUniverses(u);
			setNotes(await loadReviewNotes(list.map((c) => c.id)));
			loadMyRolls().then(setRolls, () => setRolls(null));
		} catch (e) {
			setError(messageOf(e));
		}
	}
	useEffect(() => {
		if (player) load();
	}, [player?.id]);

	const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, characters?.filter(f.match).length ?? 0])), [characters]);
	const shown = characters?.filter(FILTERS.find((f) => f.id === filter)!.match) ?? [];

	if (error) return <p class="portal-error">Couldn’t load your characters: {error}</p>;
	if (player === undefined) return <p class="portal-status">Checking your login…</p>;
	if (player === null)
		return (
			<div class="portal-card">
				<p>Log in with Discord to see your characters.</p>
				<button type="button" class="portal-button discord" onClick={() => logIn().catch((e) => setError(messageOf(e)))}>
					Log in with Discord
				</button>
			</div>
		);
	if (!characters) return <p class="portal-status">Loading your characters…</p>;

	return (
		<div class="pf mc">
			<div class="mc-top">
				<nav class="pf-nav" aria-label="Filter characters">
					{FILTERS.filter((f) => f.id === 'all' || counts[f.id] > 0).map((f) => (
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
							{f.label} <span class="mc-count">{counts[f.id]}</span>
						</a>
					))}
				</nav>
				<a class="pf-button primary" href={`${base}submit/`}>
					+ New character
				</a>
			</div>

			<RollBanner rolls={rolls} characters={characters} />

			{characters.length === 0 ? (
				<div class="portal-card mc-empty">
					<h2>No characters yet</h2>
					<p>Create an original character or try out for a canon one. Your progress saves as you go.</p>
					<a class="pf-button primary" href={`${base}submit/`}>
						Create your first character
					</a>
				</div>
			) : shown.length === 0 ? (
				<p class="pf-empty">Nothing here.</p>
			) : (
				<div class="mc-grid">
					{shown.map((c) => (
						<CharacterCard key={c.id} c={c} notes={notes.filter((n) => n.character_id === c.id)} universes={universes} onDeleted={load} />
					))}
				</div>
			)}
		</div>
	);
}
