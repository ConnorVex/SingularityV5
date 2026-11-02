// Admin tools for families: review new families and perks, assign owners, set special statuses.
import { useEffect, useState } from 'preact/hooks';
import {
	PERK_ACCESS,
	PERK_KINDS,
	familyHref,
	loadFamilies,
	loadPerkQueue,
	loadPlayers,
	reviewFamily,
	reviewPerks,
	richText,
	setFamilyAdminFields,
	type FamilyCard,
	type PerkDecision,
	type PerkRequest,
	type PlayerRow,
} from '../../lib/families/api.ts';
import { portalConfigured, watchPlayer, type Player } from '../../lib/supabase.ts';
import { LoginCard, STATUS_TEXT, messageOf, useFamilyTheme } from './shared.tsx';

const TABS = [
	{ id: 'families', label: 'New families' },
	{ id: 'perks', label: 'Perks' },
	{ id: 'all', label: 'All families' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const SPECIALS = ['Monarch Family', 'Exclusive Access'];

export function ReviewFamily({ f, owner, onDone }: { f: FamilyCard; owner: string; onDone: () => void }) {
	const [note, setNote] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const decide = async (outcome: 'approved' | 'needs_correction' | 'denied') => {
		setBusy(true);
		try {
			await reviewFamily(f.id, outcome, note);
			onDone();
		} catch (e) {
			setError(messageOf(e));
			setBusy(false);
		}
	};
	return (
		<article class="fm-admin-card" style={{ '--fam': f.colour }}>
			<header>
				<h3>
					<a href={familyHref(f.slug)}>{f.name}</a>
				</h3>
				<p class="fm-card-meta">
					by {owner} · sent {f.submitted_at ? new Date(f.submitted_at).toLocaleDateString() : '—'}
				</p>
			</header>
			<p>{f.description}</p>
			<p class="fm-card-meta">{[f.head_name && `Head: ${f.head_name}`, f.race, f.specialty].filter(Boolean).join(' · ')}</p>
			<div class="pf-field">
				<label class="pf-label" for={`note-${f.id}`}>
					Note to the owner
				</label>
				<textarea id={`note-${f.id}`} rows={2} value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="Shown on their family page" />
			</div>
			<div class="fm-edit-row-tools">
				<a class="pf-button subtle" href={familyHref(f.slug)}>
					Open page
				</a>
				<button type="button" class="pf-button" disabled={busy} onClick={() => decide('needs_correction')}>
					Send back
				</button>
				<button type="button" class="pf-button danger" disabled={busy} onClick={() => decide('denied')}>
					Deny
				</button>
				<button type="button" class="pf-button primary" disabled={busy} onClick={() => decide('approved')}>
					Approve
				</button>
			</div>
			{error && <p class="portal-error">{error}</p>}
		</article>
	);
}

type Choice = 'approved' | 'denied' | '';

export function ReviewRequest({ r, onDone }: { r: PerkRequest; onDone: () => void }) {
	const [choice, setChoice] = useState<Record<string, Choice>>({});
	const [notes, setNotes] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const decisions: PerkDecision[] = r.perks.filter((p) => choice[p.id]).map((p) => ({ id: p.id, status: choice[p.id] as PerkDecision['status'], note: notes[p.id] ?? '' }));
	const approved = decisions.filter((d) => d.status === 'approved').length;
	const left = r.perks.length - decisions.length;
	const save = async () => {
		setBusy(true);
		setError('');
		try {
			await reviewPerks(r.id, decisions);
			onDone();
		} catch (e) {
			setError(messageOf(e));
			setBusy(false);
		}
	};
	return (
		<article class="fm-admin-card">
			<header>
				<h3>{r.family ? <a href={familyHref(r.family.slug)}>{r.family.name}</a> : 'Unknown family'}</h3>
				<p class="fm-card-meta">
					{r.perks.length} {r.perks.length === 1 ? 'perk' : 'perks'} · sent by {r.sender?.display_name ?? 'an unknown player'} on {new Date(r.created_at).toLocaleDateString()}
				</p>
			</header>
			{r.note && <p class="fm-request-note">“{r.note}”</p>}
			<ol class="fm-review-perks">
				{r.perks.map((p) => (
					<li key={p.id} class={`fm-review-perk${choice[p.id] ? ` is-${choice[p.id]}` : ''}`}>
						<h4>{p.title}</h4>
						<p class="fm-card-meta">
							{PERK_KINDS.find((k) => k.id === p.kind)?.label} · {PERK_ACCESS.find((k) => k.id === p.access)?.label}
							{p.reviewed_at && ' · Change to a perk reviewed before'}
						</p>
						{p.hidden && (
							<p class="pf-status status-pending">
								<strong>Members only</strong> · Approving also hides this perk from everyone outside the family.
							</p>
						)}
						{p.description ? <div class="fm-prose" dangerouslySetInnerHTML={{ __html: richText(p.description) }} /> : <p class="pf-empty">No description.</p>}
						<div class="fm-review-choice" role="group" aria-label={`Decision for ${p.title}`}>
							{(['approved', 'denied'] as const).map((c) => (
								<button
									key={c}
									type="button"
									class={`pf-button${choice[p.id] === c ? (c === 'approved' ? ' primary' : ' danger') : ''}`}
									aria-pressed={choice[p.id] === c}
									onClick={() => setChoice({ ...choice, [p.id]: choice[p.id] === c ? '' : c })}
								>
									{choice[p.id] === c ? (c === 'approved' ? '✓ Approved' : '✕ Denied') : c === 'approved' ? 'Approve' : 'Deny'}
								</button>
							))}
							<div class="pf-field fm-review-note">
								<input
									aria-label={`Note for ${p.title}`}
									value={notes[p.id] ?? ''}
									maxLength={1000}
									onInput={(e) => setNotes({ ...notes, [p.id]: e.currentTarget.value })}
									placeholder="Note to the owner (optional)"
								/>
							</div>
						</div>
					</li>
				))}
			</ol>
			{decisions.length > 0 && left > 0 && (
				<p class="pf-help">
					{left} undecided {left === 1 ? 'perk stays' : 'perks stay'} waiting for later.
				</p>
			)}
			<div class="pf-actions">
				<span class="pf-save-state">
					{decisions.length ? `${approved} approved · ${decisions.length - approved} denied` : `0 of ${r.perks.length} decided`}
				</span>
				<button type="button" class="pf-button" disabled={busy || !left} onClick={() => setChoice(Object.fromEntries(r.perks.map((p) => [p.id, choice[p.id] || 'approved'])))}>
					Approve rest
				</button>
				<button type="button" class="pf-button primary" disabled={busy || !decisions.length} onClick={save}>
					Save
				</button>
			</div>
			{error && <p class="portal-error">{error}</p>}
		</article>
	);
}

function FamilyRow({ f, players, onDone }: { f: FamilyCard; players: PlayerRow[]; onDone: () => void }) {
	const [owner, setOwner] = useState(f.owner_id ?? '');
	const [specials, setSpecials] = useState(f.special_statuses);
	const [name, setName] = useState(f.name);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const dirty = owner !== (f.owner_id ?? '') || name !== f.name || JSON.stringify(specials) !== JSON.stringify(f.special_statuses);
	return (
		<article class="fm-admin-card" style={{ '--fam': f.colour }}>
			<header>
				<h3>
					<a href={familyHref(f.slug)}>{f.name}</a>
				</h3>
				<p class="fm-card-meta">
					{STATUS_TEXT[f.status].label} · {f.memberCount} members
				</p>
			</header>
			<div class="pf-grid">
				<div class="pf-field">
					<label class="pf-label" for={`name-${f.id}`}>
						Name
					</label>
					<input id={`name-${f.id}`} value={name} onInput={(e) => setName(e.currentTarget.value)} />
				</div>
				<div class="pf-field">
					<label class="pf-label" for={`owner-${f.id}`}>
						Owner
					</label>
					<select id={`owner-${f.id}`} value={owner} onChange={(e) => setOwner(e.currentTarget.value)}>
						<option value="">No owner</option>
						{players.map((p) => (
							<option key={p.id} value={p.id}>
								{p.display_name}
							</option>
						))}
					</select>
					<p class="pf-help">A player can own one family. They must have logged in to the portal once.</p>
				</div>
				<fieldset class="pf-field pf-checks">
					<legend class="pf-label">Special status</legend>
					{SPECIALS.map((s) => (
						<label class="pf-check" key={s}>
							<input type="checkbox" checked={specials.includes(s)} onChange={(e) => setSpecials(e.currentTarget.checked ? [...specials, s] : specials.filter((x) => x !== s))} />
							{s}
						</label>
					))}
				</fieldset>
			</div>
			<div class="fm-edit-row-tools">
				<a class="pf-button subtle" href={`${familyHref(f.slug)}#edit`}>
					Edit page
				</a>
				<button
					type="button"
					class="pf-button primary"
					disabled={!dirty || busy || !name.trim()}
					onClick={async () => {
						setBusy(true);
						setError('');
						try {
							await setFamilyAdminFields(f.id, { owner_id: owner || null, special_statuses: specials, name: name.trim() });
							onDone();
						} catch (e) {
							setError(messageOf(e).includes('families_one_per_owner') ? 'That player already owns a family.' : messageOf(e));
						} finally {
							setBusy(false);
						}
					}}
				>
					Save
				</button>
			</div>
			{error && <p class="portal-error">{error}</p>}
		</article>
	);
}

export default function FamilyAdmin() {
	const [player, setPlayer] = useState<Player | null | undefined>(undefined);
	const [families, setFamilies] = useState<FamilyCard[] | null>(null);
	const [perks, setPerks] = useState<PerkRequest[]>([]);
	const [players, setPlayers] = useState<PlayerRow[]>([]);
	// The review inbox links straight to a tab, e.g. #all for the family tools.
	const [tab, setTab] = useState<Tab>(() => TABS.find((t) => `#${t.id}` === location.hash)?.id ?? 'families');
	const [error, setError] = useState('');

	useFamilyTheme(null);
	useEffect(() => {
		if (!portalConfigured) return setError('The portal is not connected to its database yet.');
		watchPlayer((p, e) => (e ? setError(messageOf(e)) : setPlayer(p)));
	}, []);
	async function load() {
		try {
			const [f, p, pl] = await Promise.all([loadFamilies(), loadPerkQueue(), loadPlayers()]);
			setFamilies(f);
			setPerks(p);
			setPlayers(pl);
		} catch (e) {
			setError(messageOf(e));
		}
	}
	useEffect(() => {
		if (player?.isAdmin) load();
	}, [player?.id]);

	if (error) return <p class="portal-error">{error}</p>;
	if (player === undefined) return <p class="portal-status">Checking your login…</p>;
	if (player === null) return <LoginCard text="Log in with Discord to use the family admin tools." onError={setError} />;
	if (!player.isAdmin) return <p class="portal-error">Only admins can use this page.</p>;
	if (!families) return <p class="portal-status">Loading…</p>;

	const pending = families.filter((f) => f.status === 'pending');
	const ownerName = (id: string | null) => players.find((p) => p.id === id)?.display_name ?? 'Unknown player';
	const counts: Record<Tab, number> = { families: pending.length, perks: perks.reduce((n, r) => n + r.perks.length, 0), all: families.length };

	return (
		<div class="pf fm">
			<nav class="pf-nav" aria-label="Family admin">
				{TABS.map((t) => (
					<a
						key={t.id}
						href={`#${t.id}`}
						class={tab === t.id ? 'active' : undefined}
						aria-current={tab === t.id ? 'true' : undefined}
						onClick={(e) => {
							e.preventDefault();
							setTab(t.id);
						}}
					>
						{t.label} <span class="mc-count">{counts[t.id]}</span>
					</a>
				))}
			</nav>
			<div class="fm-admin-list">
				{tab === 'families' &&
					(pending.length ? pending.map((f) => <ReviewFamily key={f.id} f={f} owner={ownerName(f.owner_id)} onDone={load} />) : <p class="pf-empty">No families waiting.</p>)}
				{tab === 'perks' && (perks.length ? perks.map((r) => <ReviewRequest key={r.id} r={r} onDone={load} />) : <p class="pf-empty">No perks waiting.</p>)}
				{tab === 'all' && families.map((f) => <FamilyRow key={`${f.id}-${f.updated_at}`} f={f} players={players} onDone={load} />)}
			</div>
		</div>
	);
}
