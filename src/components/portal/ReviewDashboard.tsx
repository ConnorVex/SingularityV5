// Admin review dashboard: the submission queue, a read-only view of each sheet with the same
// checks players see, what changed for evolutions, and approve / send back / deny with a note.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
	discoverCombos,
	listPlayers,
	loadAllCharacters,
	loadClaimBoard,
	loadHeldClaims,
	loadReviewNotes,
	loadUniverses,
	reviewCharacter,
	setCharacterHidden,
	setExtraTraitSlots,
	type AdminCharacter,
	type ClaimRow,
	type Combo,
	type PlayerSummary,
	type ReviewNote,
	type Status,
	type Universe,
} from '../../lib/portal/api.ts';
import { sheetChanges } from '../../lib/portal/diff.ts';
import { checkSheet, power, ptp, rankInfo, recoil, rules, traits, traitSlots, type Issue } from '../../lib/portal/rules.ts';
import { systemById, visibleFields } from '../../lib/portal/systems.ts';
import { startPortalTheme, themeForRole } from '../../lib/portal/theme.ts';
import { logIn, watchPlayer, type Player } from '../../lib/supabase.ts';
import { richText } from './TraitsSection.tsx';

const base = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}portal/`;
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const ago = (iso: string | null) => {
	if (!iso) return '';
	const h = (Date.now() - new Date(iso).getTime()) / 36e5;
	return h < 1 ? 'just now' : h < 48 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)} days ago`;
};
const traitByName = new Map(traits.map((t) => [t.name, t]));

const TABS: { id: string; label: string; match: (c: AdminCharacter) => boolean }[] = [
	{ id: 'pending', label: 'In review', match: (c) => c.status === 'pending' },
	{ id: 'needs_correction', label: 'Sent back', match: (c) => c.status === 'needs_correction' },
	{ id: 'approved', label: 'Approved', match: (c) => c.status === 'approved' || (Boolean(c.approved_at) && c.status === 'draft') },
	{ id: 'denied', label: 'Denied', match: (c) => c.status === 'denied' },
	{ id: 'draft', label: 'Drafts', match: (c) => c.status === 'draft' && !c.approved_at },
];

const STATUS_LABEL: Record<Status, string> = {
	draft: 'Draft',
	pending: 'In review',
	approved: 'Approved',
	needs_correction: 'Sent back',
	denied: 'Denied',
};

const Block = ({ title, children }: { title: string; children: ComponentChildren }) => (
	<div class="hud-panel rv-block">
		<h3 class="hud-panel-title">{title}</h3>
		{children}
	</div>
);

const Row = ({ label, value }: { label: string; value: ComponentChildren }) =>
	value === '' || value === null || value === undefined ? null : (
		<div class="rv-row">
			<span class="pf-label">{label}</span>
			<span class="rv-value">{value}</span>
		</div>
	);

const Text = ({ value }: { value: string }) => (value?.trim() ? <p class="rv-text">{value}</p> : <p class="pf-empty">Empty.</p>);

function IssueList({ issues }: { issues: Issue[] }) {
	if (issues.length === 0) return <p class="pf-ok">✅ No problems found.</p>;
	const groups = [
		['error', '⛔ Breaks the rules'],
		['warning', '⚠️ Warnings'],
		['permission', '🔑 Needs permission'],
	] as const;
	return (
		<>
			{groups.map(([level, title]) => {
				const list = issues.filter((i) => i.level === level);
				return list.length ? (
					<div key={level} class={`pf-issue-group ${level}`}>
						<h3>
							{title} ({list.length})
						</h3>
						<ul>
							{list.map((i, n) => (
								<li key={n}>
									<span class="pf-issue-section">{i.section}</span> {i.message}
								</li>
							))}
						</ul>
					</div>
				) : null;
			})}
		</>
	);
}

function SheetView({ c, combos, board, universes }: { c: AdminCharacter; combos: Combo[]; board: ClaimRow[]; universes: Universe[] }) {
	const s = c.sheet;
	const oc = c.kind === 'oc';
	const budget = ptp(s);
	const r = recoil(s);
	const slots = traitSlots(s, c.extra_trait_slots);
	const claims = board.filter((b) => c.requested_claims.includes(b.id));
	return (
		<div class="rv-sheet">
			<Block title="Basics">
				<Row label="Type" value={oc ? 'Original character' : `Canon tryout · ${universes.find((u) => u.slug === c.canon_universe)?.name ?? c.canon_universe}`} />
				{oc && <Row label="Role" value={rules.roles.find((x) => x.id === s.role)?.label ?? '—'} />}
				<Row label="Race" value={s.race} />
				<Row label="Age" value={s.age} />
				<Row label="Pronouns" value={s.pronouns} />
			</Block>

			<Block title="Appearance">
				{/^https:\/\//.test(s.appearance.image) && <img class="pf-preview" src={s.appearance.image} alt={`Picture of ${c.name}`} />}
				{oc && <Text value={s.appearance.description} />}
				{s.appearance.extraImages.trim() && (
					<ul class="rv-links">
						{s.appearance.extraImages
							.split('\n')
							.filter((l) => /^https?:\/\//.test(l.trim()))
							.map((l) => (
								<li key={l}>
									<a href={l.trim()} target="_blank" rel="noreferrer noopener">
										{l.trim()}
									</a>
								</li>
							))}
					</ul>
				)}
			</Block>

			{oc ? (
				<Block title="Lore">
					{(['backstory', 'personality', 'likes', 'dislikes', 'relations'] as const).map((k) => (
						<div key={k} class="rv-field">
							<span class="pf-label">{k}</span>
							<Text value={s.lore[k]} />
						</div>
					))}
				</Block>
			) : (
				<Block title="Tryout">
					<div class="rv-field">
						<span class="pf-label">How they’ll portray them</span>
						<Text value={s.canon.portrayal} />
					</div>
					<div class="rv-field">
						<span class="pf-label">Roleplay sample</span>
						<Text value={s.canon.sample} />
					</div>
				</Block>
			)}

			{oc && (
				<>
					<Block title="S.T.S stats">
						<div class="rv-stats">
							{(['strength', 'speed', 'defense', 'stamina'] as const).map((k) => {
								const info = rankInfo(s.stats[k]);
								return <Row key={k} label={k} value={info ? `${info.rank} (${info.value})` : '—'} />;
							})}
							<Row label="Intelligence" value={s.stats.intelligence} />
							<Row label="Phase" value={rules.stats.phases.find((p) => p.phase === s.stats.phase)?.label} />
							<Row label="Power" value={power(s) ?? '—'} />
							<Row label="Recoil" value={r ? `Lv ${r.level} (${r.high} ${r.gap} above ${r.low})` : 'None'} />
							<Row label="Starting PTP" value={`${budget.spent} spent of ${budget.available}`} />
							<Row label="Physical meter" value={s.stats.physicalMeter} />
						</div>
					</Block>

					<Block title={`Potential & traits · ${slots.used}/${slots.total} slots`}>
						<Row
							label="Potential"
							value={
								s.potential.grade
									? `${rules.potentials.find((p) => p.id === s.potential.grade)?.label ?? s.potential.grade}${s.potential.roll ? ` (rolled ${s.potential.roll})` : ' (set by admin)'}`
									: 'Not rolled'
							}
						/>
						<ul class="rv-traits">
							{s.traits.map((t) => {
								const info = traitByName.get(t.name);
								return (
									<li key={t.name}>
										<span class={`trait-chip small rarity-${info?.rarity ?? 'unknown'}`}>
											{info?.sticky && '📌 '}
											{t.name}
										</span>
										<span class="trait-meta">
											{info?.rarity} · {info?.category} · {info?.effect}
											{t.family ? ' · family' : ''}
										</span>
										{t.rollProof && (
											<a href={t.rollProof} target="_blank" rel="noreferrer noopener" class="rv-proof">
												roll
											</a>
										)}
									</li>
								);
							})}
						</ul>
						{combos.map((k) => (
							<details key={k.name} class="rv-combo">
								<summary>✨ {k.name}</summary>
								<div dangerouslySetInnerHTML={richText(k.perks)} />
							</details>
						))}
					</Block>

					<Block title="Combat">
						<Text value={s.combat.info} />
						{s.combat.styles.map((st, i) => (
							<Row key={i} label="Fighting style" value={st.rollProof ? <a href={st.rollProof} target="_blank" rel="noreferrer noopener">{st.name}</a> : st.name} />
						))}
					</Block>

					{s.systems.map((e) => {
						const def = systemById.get(e.system);
						return (
							<Block key={e.key} title={`${def?.label ?? e.system}${s.systems.length > 1 && s.prioritySystem === e.key ? ' · priority' : ''}`}>
								<div class="rv-stats">
									{def &&
										visibleFields(def, e.fields).map((f) => {
											const v = e.fields[f.key];
											const text = Array.isArray(v)
												? f.type === 'list'
													? `${v.length} ${f.label.toLowerCase()}`
													: (v as string[]).join(', ')
												: v;
											return <Row key={f.key} label={f.label} value={text === undefined ? '' : String(text)} />;
										})}
									{e.fields.ceLevel && <Row label="CE level" value={String(e.fields.ceLevel)} />}
								</div>
								{def?.fields
									.filter((f) => f.type === 'list')
									.map((f) =>
										((e.fields[f.key] as Record<string, string>[]) ?? []).map((row, i) => (
											<p key={`${f.key}${i}`} class="rv-text">
												<strong>
													{f.label} #{i + 1}:
												</strong>{' '}
												{(f.columns ?? []).map((col) => `${col.label}: ${row[col.key] || '—'}`).join(' · ')}
											</p>
										)),
									)}
								{e.description && <Text value={e.description} />}
								{e.skills.length > 0 && (
									<ul class="rv-skills">
										{e.skills.map((sk, i) => (
											<li key={i}>
												<strong>{sk.name || 'Unnamed'}</strong> <span class="trait-meta">{sk.type}</span>
												{sk.mastery && <span class="trait-meta"> · {sk.mastery}</span>}
												{sk.effect && <p>{sk.effect}</p>}
											</li>
										))}
									</ul>
								)}
								{claims
									.filter((b) => b.universe === def?.universe)
									.map((b) => (
										<Row key={b.id} label="Canon claim" value={`${b.name} (${b.category || 'canon'} · ${b.max_users === null ? 'no limit' : `${b.used_slots}/${b.max_users}`})`} />
									))}
							</Block>
						);
					})}

					{(s.storage.trim() || s.evolutions.length > 0) && (
						<Block title="Storage & evolution log">
							{s.storage.trim() && <Text value={s.storage} />}
							{s.evolutions.map((ev, i) => (
								<p key={i} class="rv-text">
									<strong>{ev.date || 'Undated'}:</strong> {ev.summary} {ev.earned && `(${ev.earned})`}{' '}
									{ev.link && (
										<a href={ev.link} target="_blank" rel="noreferrer noopener">
											RP link
										</a>
									)}
								</p>
							))}
						</Block>
					)}
				</>
			)}
		</div>
	);
}

function Detail(props: { c: AdminCharacter; owner?: PlayerSummary; board: ClaimRow[]; universes: Universe[]; onDecided: () => void; onChanged: () => void }) {
	const { c } = props;
	const [combos, setCombos] = useState<Combo[]>([]);
	const [held, setHeld] = useState<Set<string>>(new Set());
	const [notes, setNotes] = useState<ReviewNote[]>([]);
	const [note, setNote] = useState('');
	const [confirm, setConfirm] = useState<'approved' | 'denied' | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [slots, setSlots] = useState(String(c.extra_trait_slots));

	useEffect(() => {
		setNote('');
		setConfirm(null);
		setError('');
		setSlots(String(c.extra_trait_slots));
		Promise.all([discoverCombos(c.id), loadHeldClaims(c.id), loadReviewNotes([c.id])]).then(
			([k, h, n]) => {
				setCombos(k);
				setHeld(h);
				setNotes(n);
			},
			(e) => setError(messageOf(e)),
		);
	}, [c.id, c.updated_at]);

	const isEvolution = Boolean(c.approved_at);
	const issues = useMemo(
		() =>
			checkSheet(c.sheet, {
				kind: c.kind,
				name: c.name,
				canonUniverse: c.canon_universe,
				isEvolution,
				extraTraitSlots: c.extra_trait_slots,
				claims: new Map(props.board.map((r) => [r.id, { name: r.name, usedSlots: r.used_slots, maxUsers: r.max_users, category: r.category }])),
				heldClaimIds: held,
				requestedClaims: c.requested_claims,
				comboSystemLimits: combos.map((k) => k.system_limits ?? {}),
			}),
		[c, held, combos, props.board],
	);
	const changes = useMemo(() => (c.approved_sheet ? sheetChanges(c.approved_sheet, c.sheet) : []), [c]);
	const errors = issues.filter((i) => i.level === 'error').length;
	const theme = c.kind === 'oc' ? themeForRole(c.sheet.role) : null;
	const decidable = c.status === 'pending' || c.status === 'needs_correction' || c.status === 'denied' || c.status === 'draft';

	async function decide(outcome: 'approved' | 'needs_correction' | 'denied') {
		if ((outcome === 'denied' || (outcome === 'approved' && errors > 0)) && confirm !== outcome) {
			setConfirm(outcome);
			return;
		}
		setBusy(true);
		setError('');
		try {
			await reviewCharacter(c.id, outcome, note.trim());
			props.onDecided();
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
			setConfirm(null);
		}
	}

	async function change(fn: () => Promise<void>) {
		setError('');
		try {
			await fn();
			props.onChanged();
		} catch (e) {
			setError(messageOf(e));
		}
	}

	return (
		<div class="rv-detail" style={theme ? { '--card-accent': theme.color } : undefined}>
			<header class="rv-head">
				<div>
					<h2>{c.name}</h2>
					<p class="pf-help">
						{props.owner ? `by ${props.owner.display_name}` : 'unknown player'} · {STATUS_LABEL[c.status]}
						{isEvolution && c.status !== 'approved' ? ' · evolution of an approved character' : ''}
						{c.submitted_at ? ` · sent ${ago(c.submitted_at)}` : ''}
					</p>
				</div>
				<a class="pf-button subtle" href={`${base}submit/?id=${c.id}`}>
					Open in form
				</a>
			</header>
			{error && <p class="portal-error">{error}</p>}

			<Block title="Checks">
				<IssueList issues={issues} />
			</Block>

			{isEvolution && c.status !== 'approved' && (
				<Block title={`What changed since approval (${changes.length})`}>
					{changes.length === 0 ? (
						<p class="pf-empty">No changes.</p>
					) : (
						<table class="ov-table rv-diff">
							<thead>
								<tr>
									<th>Where</th>
									<th>Approved</th>
									<th>Now</th>
								</tr>
							</thead>
							<tbody>
								{changes.map((ch) => (
									<tr key={ch.where}>
										<td>{ch.where}</td>
										<td class="was">{ch.before}</td>
										<td class="now">{ch.after}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</Block>
			)}

			<SheetView c={c} combos={combos} board={props.board} universes={props.universes} />

			<Block title="Settings">
				<div class="ov-row">
					<label class="pf-check">
						<input type="checkbox" checked={c.hidden} onChange={(e) => change(() => setCharacterHidden(c.id, e.currentTarget.checked))} />
						Hide from the gallery
					</label>
					{c.kind === 'oc' && (
						<div class="pf-field rv-slots">
							<label class="pf-label" for="rv-slots">
								Extra trait slots
							</label>
							<input
								id="rv-slots"
								type="number"
								min={0}
								max={20}
								value={slots}
								onInput={(e) => setSlots(e.currentTarget.value)}
								onBlur={() => Number(slots) !== c.extra_trait_slots && change(() => setExtraTraitSlots(c.id, Math.max(0, Math.min(20, Number(slots) || 0))))}
							/>
						</div>
					)}
				</div>
			</Block>

			{notes.length > 0 && (
				<Block title="Review history">
					<ul class="ov-events">
						{notes.map((n) => (
							<li key={n.id}>
								<span class="pf-issue-section">{when(n.created_at)}</span> {n.outcome ? STATUS_LABEL[n.outcome] : 'Note'}
								{n.body && `: ${n.body}`}
							</li>
						))}
					</ul>
				</Block>
			)}

			{decidable && (
				<div class="rv-decide">
					<div class="pf-field">
						<label class="pf-label" for="rv-note">
							Note to the player
						</label>
						<textarea
							id="rv-note"
							rows={3}
							value={note}
							onInput={(e) => setNote(e.currentTarget.value)}
							placeholder="What to fix, or a welcome message. The player sees this on My Characters."
						/>
					</div>
					{confirm && (
						<p class="roll-note bad" role="alert">
							{confirm === 'denied'
								? 'Denying is final for the player: the character is locked and they must make a new one. Click Deny again to confirm.'
								: `This sheet still has ${errors} rule problem${errors === 1 ? '' : 's'}. Click Approve again to approve anyway.`}
						</p>
					)}
					<div class="rv-buttons">
						<button type="button" class="pf-button primary" disabled={busy} onClick={() => decide('approved')}>
							{confirm === 'approved' ? 'Approve anyway' : 'Approve'}
						</button>
						<button type="button" class="pf-button" disabled={busy || c.status === 'needs_correction'} onClick={() => decide('needs_correction')}>
							Send back
						</button>
						<button type="button" class="pf-button danger" disabled={busy || c.status === 'denied'} onClick={() => decide('denied')}>
							{confirm === 'denied' ? 'Yes, deny' : 'Deny'}
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

export default function ReviewDashboard() {
	const [me, setMe] = useState<Player | null | undefined>(undefined);
	const [all, setAll] = useState<AdminCharacter[] | null>(null);
	const [players, setPlayers] = useState<Map<string, PlayerSummary>>(new Map());
	const [board, setBoard] = useState<ClaimRow[]>([]);
	const [universes, setUniverses] = useState<Universe[]>([]);
	const [tab, setTab] = useState('pending');
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<string | null>(null);
	const [error, setError] = useState('');

	useEffect(() => startPortalTheme(), []);
	useEffect(() => watchPlayer((p, e) => (e ? setError(messageOf(e)) : setMe(p))), []);

	async function load() {
		try {
			const [chars, ps, b, u] = await Promise.all([loadAllCharacters(), listPlayers(), loadClaimBoard(), loadUniverses()]);
			setAll(chars);
			setPlayers(new Map(ps.map((p) => [p.id, p])));
			setBoard(b);
			setUniverses(u);
			return chars;
		} catch (e) {
			setError(messageOf(e));
			return null;
		}
	}
	useEffect(() => {
		if (me?.isAdmin) load();
	}, [me?.id, me?.isAdmin]);

	const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, all?.filter(t.match).length ?? 0])), [all]);
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		const list = (all ?? []).filter(TABS.find((t) => t.id === tab)!.match);
		return list.filter((c) => !q || c.name.toLowerCase().includes(q) || (players.get(c.owner_id)?.display_name ?? '').toLowerCase().includes(q));
	}, [all, tab, query, players]);
	const current = all?.find((c) => c.id === selected) ?? null;

	if (error) return <p class="portal-error">{error}</p>;
	if (me === undefined) return <p class="portal-status">Checking your login…</p>;
	if (me === null)
		return (
			<div class="portal-card">
				<p>Log in with Discord to continue.</p>
				<button type="button" class="portal-button discord" onClick={() => logIn()}>
					Log in with Discord
				</button>
			</div>
		);
	if (!me.isAdmin) return <p class="portal-error">The review dashboard is for admins only.</p>;
	if (!all) return <p class="portal-status">Loading submissions…</p>;

	return (
		<div class="pf rv">
			<nav class="pf-nav" aria-label="Review queues">
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
			<div class="ov-layout">
				<div class="hud-panel ov-list">
					<input type="search" class="ov-search" placeholder="Search character or player" value={query} onInput={(e) => setQuery(e.currentTarget.value)} aria-label="Search submissions" />
					<ul>
						{shown.map((c) => {
							const owner = players.get(c.owner_id);
							const errors = checkSheet(c.sheet, { kind: c.kind, name: c.name, canonUniverse: c.canon_universe, isEvolution: Boolean(c.approved_at), extraTraitSlots: c.extra_trait_slots }).filter(
								(i) => i.level === 'error',
							).length;
							return (
								<li key={c.id}>
									<button type="button" class={selected === c.id ? 'active' : undefined} onClick={() => setSelected(c.id)}>
										<span class="rv-item">
											<strong>{c.name}</strong>
											<span class="pf-help">
												{owner?.display_name ?? 'unknown'} · {c.kind === 'canon' ? 'canon tryout' : 'OC'}
												{c.approved_at && c.status === 'pending' ? ' · evolution' : ''}
												{c.submitted_at && tab === 'pending' ? ` · ${ago(c.submitted_at)}` : ''}
											</span>
										</span>
										{errors > 0 && <span class="rv-flag" title={`${errors} rule problems`}>⛔ {errors}</span>}
									</button>
								</li>
							);
						})}
						{shown.length === 0 && <li class="pf-empty">{tab === 'pending' ? 'Nothing waiting for review. 🎉' : 'Nothing here.'}</li>}
					</ul>
				</div>
				{current ? (
					<Detail
						c={current}
						owner={players.get(current.owner_id)}
						board={board}
						universes={universes}
						onChanged={load}
						onDecided={async () => {
							const fresh = await load();
							// Move on to the next submission waiting in this queue.
							const next = fresh?.filter(TABS.find((t) => t.id === tab)!.match).find((c) => c.id !== current.id);
							setSelected(next?.id ?? null);
						}}
					/>
				) : (
					<p class="pf-empty ov-pick">Pick a submission to review it.</p>
				)}
			</div>
		</div>
	);
}
