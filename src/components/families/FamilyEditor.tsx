// The owner's editor for their family: page details, divisions, roster, relations and perks.
// Admins get the same editor for any family.
import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
	EDITABLE,
	PERK_ACCESS,
	PERK_KINDS,
	STANDINGS,
	acceptMember,
	decideTryout,
	deleteTryout,
	removeMember,
	richText,
	saveDivisions,
	sendPerks,
	saveRelations,
	saveRoster,
	saveStandingNotes,
	updateFamily,
	type DivisionDraft,
	type FamilyBundle,
	type FamilyFields,
	type Tryout,
	type MemberDraft,
	type Perk,
	type PerkDraft,
	type PerkAccess,
	type PerkKind,
	type RelationDraft,
	type Standing,
} from '../../lib/families/api.ts';
import { FamilyForm, familyProblems } from './FamilyForm.tsx';
import { messageOf } from './shared.tsx';

const TABS = [
	{ id: 'page', label: 'Page' },
	{ id: 'divisions', label: 'Divisions' },
	{ id: 'roster', label: 'Roster' },
	{ id: 'tryouts', label: 'Tryouts' },
	{ id: 'relations', label: 'Relations' },
	{ id: 'perks', label: 'Perks' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** Save bar shared by every tab. */
function SaveBar({
	dirty,
	problems,
	onSave,
	extra,
	label = 'Save',
	status,
}: {
	dirty: boolean;
	problems?: string[];
	onSave: () => Promise<void>;
	extra?: ComponentChildren;
	label?: string;
	/** Replaces "Unsaved changes". */
	status?: string;
}) {
	const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
	const [error, setError] = useState('');
	const blocked = Boolean(problems?.length);
	return (
		<div class="pf-actions">
			<span class={`pf-save-state ${state === 'saved' && !dirty ? 'saved' : state === 'error' ? 'error' : ''}`}>
				{state === 'saving' ? 'Saving…' : state === 'error' ? error : blocked ? problems![0] : dirty ? status || 'Unsaved changes' : state === 'saved' ? 'Saved' : 'No changes'}
			</span>
			{extra}
			<button
				type="button"
				class="pf-button primary"
				disabled={!dirty || blocked || state === 'saving'}
				onClick={async () => {
					setState('saving');
					try {
						await onSave();
						setState('saved');
					} catch (e) {
						setError(messageOf(e));
						setState('error');
					}
				}}
			>
				{label}
			</button>
		</div>
	);
}

function Move({ i, n, onMove }: { i: number; n: number; onMove: (from: number, to: number) => void }) {
	return (
		<span class="fm-move">
			<button type="button" class="pf-button subtle" disabled={i === 0} onClick={() => onMove(i, i - 1)} aria-label="Move up">
				↑
			</button>
			<button type="button" class="pf-button subtle" disabled={i === n - 1} onClick={() => onMove(i, i + 1)} aria-label="Move down">
				↓
			</button>
		</span>
	);
}

const moved = <T,>(list: T[], from: number, to: number) => {
	const next = [...list];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
};

// ───────────────────────────── Page ─────────────────────────────

function PageTab({ b, onSaved }: { b: FamilyBundle; onSaved: () => void }) {
	const initial = useMemo(() => Object.fromEntries(EDITABLE.map((k) => [k, b.family[k]])) as FamilyFields, [b.family]);
	const [form, setForm] = useState(initial);
	const dirty = JSON.stringify(form) !== JSON.stringify(initial);
	const resend = b.family.status === 'needs_correction';
	return (
		<>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Family page</h2>
				</header>
				<div class="pf-grid">
					<FamilyForm value={form} onChange={setForm} nameLocked={b.family.status === 'approved'} />
				</div>
			</section>
			<SaveBar
				dirty={dirty || resend}
				problems={familyProblems(form)}
				onSave={async () => {
					await updateFamily(b.family.id, { ...form, ...(resend ? { status: 'pending' as const } : {}) });
					onSaved();
				}}
				extra={resend ? <span class="pf-help">Saving sends it back to the admins.</span> : undefined}
			/>
		</>
	);
}

// ───────────────────────────── Divisions ─────────────────────────────

function DivisionsTab({ b, onSaved }: { b: FamilyBundle; onSaved: () => void }) {
	const initial = useMemo<DivisionDraft[]>(() => b.divisions.map(({ family_id, ...d }) => d), [b.divisions]);
	const [rows, setRows] = useState(initial);
	const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
	const set = (i: number, patch: Partial<DivisionDraft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
	return (
		<>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Divisions</h2>
				</header>
				<p class="pf-intro">Groups inside the family, like the Brando Clan's Phalanxes. Put members into them on the Roster tab.</p>
				{rows.map((d, i) => (
					<div class="fm-edit-row" key={d.id ?? `new-${i}`}>
						<div class="pf-grid">
							<div class="pf-field">
								<label class="pf-label" for={`div-name-${i}`}>
									Name
								</label>
								<input id={`div-name-${i}`} value={d.name} onInput={(e) => set(i, { name: e.currentTarget.value })} />
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`div-open-${i}`}>
									Open spots
								</label>
								<input id={`div-open-${i}`} type="number" min={0} max={50} value={d.open_spots} onInput={(e) => set(i, { open_spots: Math.max(0, Math.min(50, Number(e.currentTarget.value) || 0)) })} />
							</div>
							<label class="pf-check">
								<input type="checkbox" checked={d.head_open} onChange={(e) => set(i, { head_open: e.currentTarget.checked })} />
								The head spot is open
							</label>
							<div class="pf-field pf-wide">
								<label class="pf-label" for={`div-desc-${i}`}>
									Description
								</label>
								<textarea id={`div-desc-${i}`} rows={2} value={d.description} onInput={(e) => set(i, { description: e.currentTarget.value })} />
							</div>
						</div>
						<div class="fm-edit-row-tools">
							<Move i={i} n={rows.length} onMove={(a, c) => setRows(moved(rows, a, c))} />
							<button type="button" class="pf-button subtle" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
								Remove
							</button>
						</div>
					</div>
				))}
				<button type="button" class="pf-button" onClick={() => setRows([...rows, { name: '', description: '', open_spots: 0, head_open: false, sort: rows.length + 1 }])}>
					+ Add division
				</button>
			</section>
			<SaveBar
				dirty={dirty}
				problems={rows.some((r) => !r.name.trim()) ? ['Every division needs a name.'] : []}
				onSave={async () => {
					await saveDivisions(b.family.id, b.divisions, rows);
					onSaved();
				}}
			/>
		</>
	);
}

// ───────────────────────────── Roster ─────────────────────────────

function RosterTab({ b, onSaved }: { b: FamilyBundle; onSaved: () => void }) {
	const requests = b.members.filter((m) => m.status === 'requested');
	const active = b.members.filter((m) => m.status === 'active');
	const initial = useMemo<MemberDraft[]>(
		() => active.map((m) => ({ id: m.id, name: m.name, division_id: m.division_id, title: m.title, relationship: m.relationship, image_url: m.image_url, sort: m.sort, character_id: m.character_id })),
		[b.members],
	);
	const [rows, setRows] = useState(initial);
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
	const set = (i: number, patch: Partial<MemberDraft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

	async function act(id: string, action: () => Promise<void>) {
		setBusy(id);
		setError('');
		try {
			await action();
			onSaved();
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy('');
		}
	}

	return (
		<>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Join requests</h2>
					<span class="pf-badge">{requests.length}</span>
				</header>
				{requests.length === 0 ? (
					<p class="pf-empty">No requests right now.</p>
				) : (
					<ul class="fm-requests">
						{requests.map((m) => (
							<li key={m.id}>
								<div>
									<strong>{m.name}</strong>
									<span class="fm-member-sub"> · asked {new Date(m.created_at).toLocaleDateString()}</span>
									{m.message && <p class="fm-request-msg">“{m.message}”</p>}
								</div>
								<span class="pf-confirm">
									<button type="button" class="pf-button primary" disabled={busy === m.id} onClick={() => act(m.id, () => acceptMember(m.id))}>
										Accept
									</button>
									<button type="button" class="pf-button subtle" disabled={busy === m.id} onClick={() => act(m.id, () => removeMember(m.id))}>
										Decline
									</button>
								</span>
							</li>
						))}
					</ul>
				)}
				{error && <p class="portal-error">{error}</p>}
			</section>

			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Roster</h2>
					<span class="pf-badge">{rows.length}</span>
				</header>
				<p class="pf-intro">
					Characters who joined through the portal are marked <span class="fm-tag">OC</span>. You can also type in names, for members from before the portal. Removing someone takes them off the roster completely.
				</p>
				{rows.map((m, i) => (
					<div class="fm-edit-row" key={m.id ?? `new-${i}`}>
						<div class="pf-grid fm-roster-grid">
							<div class="pf-field">
								<label class="pf-label" for={`m-name-${i}`}>
									Name {m.character_id && <span class="fm-tag">OC</span>}
								</label>
								<input id={`m-name-${i}`} value={m.name} disabled={Boolean(m.character_id)} onInput={(e) => set(i, { name: e.currentTarget.value })} />
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`m-div-${i}`}>
									Division
								</label>
								<select id={`m-div-${i}`} value={m.division_id ?? ''} onChange={(e) => set(i, { division_id: e.currentTarget.value || null })}>
									<option value="">None</option>
									{b.divisions.map((d) => (
										<option key={d.id} value={d.id}>
											{d.name}
										</option>
									))}
								</select>
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`m-title-${i}`}>
									Title
								</label>
								<input id={`m-title-${i}`} value={m.title} maxLength={60} placeholder="e.g. Head" onInput={(e) => set(i, { title: e.currentTarget.value })} />
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`m-rel-${i}`}>
									Relationship to the Head
								</label>
								<input id={`m-rel-${i}`} value={m.relationship} maxLength={60} placeholder="e.g. Daughter" onInput={(e) => set(i, { relationship: e.currentTarget.value })} />
							</div>
							{!m.character_id && (
								<div class="pf-field pf-wide">
									<label class="pf-label" for={`m-img-${i}`}>
										Picture link
									</label>
									<input id={`m-img-${i}`} type="url" value={m.image_url} placeholder="https://… (optional)" onInput={(e) => set(i, { image_url: e.currentTarget.value.trim() })} />
								</div>
							)}
						</div>
						<div class="fm-edit-row-tools">
							<Move i={i} n={rows.length} onMove={(a, c) => setRows(moved(rows, a, c))} />
							<button type="button" class="pf-button subtle" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
								Remove
							</button>
						</div>
					</div>
				))}
				<button type="button" class="pf-button" onClick={() => setRows([...rows, { name: '', division_id: null, title: '', relationship: '', image_url: '', sort: rows.length + 1 }])}>
					+ Add a name
				</button>
			</section>
			<SaveBar
				dirty={dirty}
				problems={[
					...(rows.some((r) => !r.name.trim()) ? ['Every member needs a name.'] : []),
					...(rows.some((r) => r.image_url && !/^https:\/\//.test(r.image_url)) ? ['Picture links must start with https://'] : []),
				]}
				onSave={async () => {
					await saveRoster(b.family.id, active, rows);
					onSaved();
				}}
			/>
		</>
	);
}

// ───────────────────────────── Tryouts ─────────────────────────────

const TRYOUT_STATUS = { pending: 'Waiting', accepted: 'Accepted', declined: 'Declined' } as const;

function TryoutCard({ t, b, onSaved }: { t: Tryout; b: FamilyBundle; onSaved: () => void }) {
	const [note, setNote] = useState(t.owner_note);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const division = b.divisions.find((d) => d.id === t.division_id)?.name;
	const image = /^https:\/\//.test(t.image_url) ? t.image_url : null;
	async function run(action: () => Promise<void>) {
		setBusy(true);
		setError('');
		try {
			await action();
			onSaved();
		} catch (e) {
			setError(messageOf(e));
			setBusy(false);
		}
	}
	return (
		<details class={`fm-tryout-card tryout-${t.status}`} open={t.status === 'pending'}>
			<summary>
				{image ? <img class="fm-face" src={image} alt="" /> : <span class="fm-face">{t.character_name.charAt(0).toUpperCase()}</span>}
				<span class="fm-member-text">
					<strong>{t.character_name}</strong>
					<span class="fm-member-sub">
						{new Date(t.created_at).toLocaleDateString()}
						{division && ` · for ${division}`}
					</span>
				</span>
				<span class="fm-tryout-state">{TRYOUT_STATUS[t.status]}</span>
			</summary>
			<div class="fm-tryout-body">
				<h4>Who they are</h4>
				<div class="fm-prose" dangerouslySetInnerHTML={{ __html: richText(t.about) }} />
				{t.backstory && (
					<>
						<h4>Backstory</h4>
						<div class="fm-prose" dangerouslySetInnerHTML={{ __html: richText(t.backstory) }} />
					</>
				)}
				<h4>RP sample</h4>
				<div class="fm-prose fm-sample" dangerouslySetInnerHTML={{ __html: richText(t.sample) }} />
				{t.status === 'pending' ? (
					<>
						<div class="pf-field">
							<label class="pf-label" for={`t-note-${t.id}`}>
								Note to the player
							</label>
							<input id={`t-note-${t.id}`} maxLength={1000} value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="Optional, shown to them" />
						</div>
						<div class="fm-edit-row-tools">
							<button type="button" class="pf-button subtle" disabled={busy} onClick={() => run(() => decideTryout(t.id, 'declined', note))}>
								Decline
							</button>
							<button type="button" class="pf-button primary" disabled={busy} onClick={() => run(() => decideTryout(t.id, 'accepted', note))}>
								Accept
							</button>
						</div>
					</>
				) : (
					<>
						{t.owner_note && <p class="fm-request-msg">Your note: “{t.owner_note}”</p>}
						<div class="fm-edit-row-tools">
							<button type="button" class="pf-button subtle" disabled={busy} onClick={() => run(() => deleteTryout(t.id))}>
								Delete
							</button>
						</div>
					</>
				)}
				{error && <p class="portal-error">{error}</p>}
			</div>
		</details>
	);
}

function TryoutsTab({ b, onSaved }: { b: FamilyBundle; onSaved: () => void }) {
	const pending = b.tryouts.filter((t) => t.status === 'pending');
	const decided = b.tryouts.filter((t) => t.status !== 'pending');
	return (
		<section class="pf-section">
			<header class="pf-section-head">
				<h2>Tryouts</h2>
				<span class="pf-badge">{pending.length}</span>
			</header>
			<p class="pf-intro">
				{b.family.recruiting === 'tryouts'
					? 'Players send a brand-new sample character. Accepting lets them make that character and ask to join. Deleting an accepted tryout takes that away again.'
					: 'Set Recruiting to "Tryouts open" on the Page tab to take tryouts.'}
			</p>
			{pending.length === 0 && <p class="pf-empty">No tryouts waiting.</p>}
			<div class="fm-tryout-list">
				{pending.map((t) => (
					<TryoutCard key={t.id} t={t} b={b} onSaved={onSaved} />
				))}
			</div>
			{decided.length > 0 && (
				<>
					<p class="pf-subhead">Decided</p>
					<div class="fm-tryout-list">
						{decided.map((t) => (
							<TryoutCard key={t.id} t={t} b={b} onSaved={onSaved} />
						))}
					</div>
				</>
			)}
		</section>
	);
}

// ───────────────────────────── Relations ─────────────────────────────

function RelationsTab({ b, families, onSaved }: { b: FamilyBundle; families: { id: string; name: string }[]; onSaved: () => void }) {
	const initial = useMemo<RelationDraft[]>(() => b.relations.map(({ family_id, ...r }) => r), [b.relations]);
	const initialNotes = useMemo(() => Object.fromEntries(b.notes.map((n) => [n.standing, n.note])) as Partial<Record<Standing, string>>, [b.notes]);
	const [rows, setRows] = useState(initial);
	const [notes, setNotes] = useState(initialNotes);
	const dirty = JSON.stringify(rows) !== JSON.stringify(initial) || JSON.stringify(notes) !== JSON.stringify(initialNotes);
	const set = (i: number, patch: Partial<RelationDraft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
	const others = families.filter((f) => f.id !== b.family.id);
	return (
		<>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Relations</h2>
				</header>
				<p class="pf-intro">Your family's standing towards others. Families not on the site yet can be typed in.</p>
				<datalist id="fm-family-names">
					{others.map((f) => (
						<option key={f.id} value={f.name} />
					))}
				</datalist>
				{rows.map((r, i) => (
					<div class="fm-edit-row" key={r.id ?? `new-${i}`}>
						<div class="pf-grid">
							<div class="pf-field">
								<label class="pf-label" for={`r-name-${i}`}>
									Family
								</label>
								<input
									id={`r-name-${i}`}
									list="fm-family-names"
									value={r.other_name}
									onInput={(e) => {
										const name = e.currentTarget.value;
										set(i, { other_name: name, other_family_id: others.find((f) => f.name.toLowerCase() === name.trim().toLowerCase())?.id ?? null });
									}}
								/>
								{r.other_family_id && <p class="pf-help">Linked to their page.</p>}
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`r-standing-${i}`}>
									Standing
								</label>
								<select id={`r-standing-${i}`} value={r.standing} onChange={(e) => set(i, { standing: e.currentTarget.value as Standing })}>
									{STANDINGS.map((s) => (
										<option key={s.id} value={s.id}>
											{s.label}
										</option>
									))}
								</select>
							</div>
							<div class="pf-field">
								<label class="pf-label" for={`r-note-${i}`}>
									Note
								</label>
								<input id={`r-note-${i}`} value={r.note} maxLength={300} placeholder="Optional" onInput={(e) => set(i, { note: e.currentTarget.value })} />
							</div>
						</div>
						<div class="fm-edit-row-tools">
							<Move i={i} n={rows.length} onMove={(a, c) => setRows(moved(rows, a, c))} />
							<button type="button" class="pf-button subtle" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
								Remove
							</button>
						</div>
					</div>
				))}
				<button type="button" class="pf-button" onClick={() => setRows([...rows, { other_name: '', other_family_id: null, standing: 'neutral', note: '', sort: rows.length + 1 }])}>
					+ Add relation
				</button>
			</section>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>What standings mean</h2>
				</header>
				<p class="pf-intro">Optional. Shown under each standing on your page, e.g. what Allies may do in your home.</p>
				<div class="pf-grid">
					{STANDINGS.map((s) => (
						<div class="pf-field" key={s.id}>
							<label class="pf-label" for={`sn-${s.id}`}>
								{s.label}
							</label>
							<textarea id={`sn-${s.id}`} rows={2} maxLength={400} value={notes[s.id] ?? ''} onInput={(e) => setNotes({ ...notes, [s.id]: e.currentTarget.value })} />
						</div>
					))}
				</div>
			</section>
			<SaveBar
				dirty={dirty}
				problems={rows.some((r) => !r.other_name.trim()) ? ['Every relation needs a family name.'] : []}
				onSave={async () => {
					await saveRelations(b.family.id, b.relations, rows);
					await saveStandingNotes(b.family.id, notes);
					onSaved();
				}}
			/>
		</>
	);
}

// ───────────────────────────── Perks ─────────────────────────────

const PERK_STATUS = { pending: 'Waiting for an admin', approved: 'Approved', denied: 'Denied' } as const;
const NEW_PERK: PerkDraft = { kind: 'trait', access: 'automatic', title: '', description: '', hidden: false };
const perkFields = (p: PerkDraft): PerkDraft => ({ id: p.id, kind: p.kind, access: p.access, title: p.title, description: p.description, hidden: p.hidden });

type PerkRow = { key: string; draft: PerkDraft; saved?: Perk; removed?: boolean };

function PerkFields({ id, draft, onChange }: { id: string; draft: PerkDraft; onChange: (d: PerkDraft) => void }) {
	return (
		<div class="pf-grid">
			<div class="pf-field">
				<label class="pf-label" for={`p-kind-${id}`}>
					Kind
				</label>
				<select id={`p-kind-${id}`} value={draft.kind} onChange={(e) => onChange({ ...draft, kind: e.currentTarget.value as PerkKind })}>
					{PERK_KINDS.map((k) => (
						<option key={k.id} value={k.id}>
							{k.label}
						</option>
					))}
				</select>
				<p class="pf-help">{PERK_KINDS.find((k) => k.id === draft.kind)?.hint}</p>
			</div>
			<div class="pf-field">
				<label class="pf-label" for={`p-access-${id}`}>
					Who gets it
				</label>
				<select id={`p-access-${id}`} value={draft.access} onChange={(e) => onChange({ ...draft, access: e.currentTarget.value as PerkAccess })}>
					{PERK_ACCESS.map((k) => (
						<option key={k.id} value={k.id}>
							{k.label}
						</option>
					))}
				</select>
			</div>
			<div class="pf-field pf-wide">
				<label class="pf-label" for={`p-title-${id}`}>
					Name
				</label>
				<input id={`p-title-${id}`} value={draft.title} maxLength={100} onInput={(e) => onChange({ ...draft, title: e.currentTarget.value })} />
			</div>
			<div class="pf-field pf-wide">
				<label class="pf-label" for={`p-desc-${id}`}>
					What it gives
				</label>
				<textarea
					id={`p-desc-${id}`}
					rows={4}
					maxLength={8000}
					value={draft.description}
					onInput={(e) => onChange({ ...draft, description: e.currentTarget.value })}
					placeholder="Effects, limits, cooldowns, and any rolls. **bold** and *italic* work."
				/>
			</div>
			<label class="pf-check pf-wide">
				<input type="checkbox" checked={draft.hidden} onChange={(e) => onChange({ ...draft, hidden: e.currentTarget.checked })} />
				Members only: hide it from anyone outside the family
			</label>
		</div>
	);
}

function PerksTab({ b, onSaved }: { b: FamilyBundle; onSaved: () => void }) {
	const initial = useMemo<PerkRow[]>(() => b.allPerks.map((p) => ({ key: p.id, draft: perkFields(p), saved: p })), [b.allPerks]);
	const [rows, setRows] = useState(initial);
	const [note, setNote] = useState('');
	const set = (key: string, patch: Partial<PerkRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
	const changed = (r: PerkRow) => !r.saved || JSON.stringify(r.draft) !== JSON.stringify(perkFields(r.saved));
	const sending = rows.filter((r) => !r.removed && changed(r));
	const removed = rows.filter((r) => r.removed && r.saved);
	const added = sending.filter((r) => !r.saved).length;
	const summary = [added && `${added} new`, sending.length - added && `${sending.length - added} changed`, removed.length && `${removed.length} removed`].filter(Boolean).join(' · ');
	const problems = [
		...(sending.some((r) => !r.draft.title.trim()) ? ['Every perk needs a name.'] : []),
		...(sending.length > 25 ? ['Send at most 25 perks at a time.'] : []),
	];
	return (
		<>
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Perks</h2>
				</header>
				<p class="pf-intro">
					A perk can be anything: a stat boost, a trait, a technique, gear, money, or protection in RP. Add or change as many as you like, then send them together. The admins
					approve or deny each perk on its own, including whether it's <strong>members only</strong>. Changing a perk sends it back for approval.
				</p>
				{rows.map((r) => {
					const status = r.saved?.status;
					const edited = r.saved && changed(r);
					return (
						<details class={`fm-perk-edit${status ? ` perk-${status}` : ''}${r.removed ? ' removed' : ''}`} key={r.key} open={!r.saved}>
							<summary>
								<span class="fm-perk-edit-name">{r.draft.title.trim() || 'New perk'}</span>
								<span class="fm-perk-edit-tags">
									{r.removed ? (
										<span class="fm-chip lock">Will be removed</span>
									) : !r.saved ? (
										<span class="fm-chip">New</span>
									) : edited ? (
										<span class="fm-chip">Changed</span>
									) : (
										status && <span class={`fm-chip state-${status}`}>{PERK_STATUS[status]}</span>
									)}
									{r.draft.hidden && <span class="fm-chip lock">Members only</span>}
								</span>
							</summary>
							<div class="fm-perk-edit-body">
								{r.saved?.review_note && !edited && <p class="fm-perk-state">Admin note: {r.saved.review_note}</p>}
								{!r.removed && <PerkFields id={r.key} draft={r.draft} onChange={(draft) => set(r.key, { draft })} />}
								<div class="fm-edit-row-tools">
									{edited && !r.removed && (
										<button type="button" class="pf-button subtle" onClick={() => set(r.key, { draft: perkFields(r.saved!) })}>
											Undo changes
										</button>
									)}
									<button
										type="button"
										class="pf-button subtle"
										onClick={() => (r.saved ? set(r.key, { removed: !r.removed }) : setRows(rows.filter((x) => x.key !== r.key)))}
									>
										{r.removed ? 'Keep it' : 'Remove'}
									</button>
								</div>
							</div>
						</details>
					);
				})}
				<button type="button" class="pf-button" onClick={() => setRows([...rows, { key: `new-${Date.now()}`, draft: { ...NEW_PERK } }])}>
					+ Add a perk
				</button>
				{sending.length > 0 && (
					<div class="pf-field fm-perk-note">
						<label class="pf-label" for="perk-note">
							Note to the admins
						</label>
						<textarea id="perk-note" rows={2} maxLength={2000} value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="Optional: anything they should know about these perks" />
					</div>
				)}
			</section>
			<SaveBar
				dirty={sending.length > 0 || removed.length > 0}
				problems={problems}
				label={sending.length ? `Send ${sending.length} for review` : 'Save'}
				status={summary}
				onSave={async () => {
					await sendPerks(
						b.family.id,
						sending.map((r) => r.draft),
						removed.map((r) => r.saved!.id),
						note,
					);
					onSaved();
				}}
			/>
		</>
	);
}

// ───────────────────────────── Editor ─────────────────────────────

export default function FamilyEditor({ b, families, onSaved }: { b: FamilyBundle; families: { id: string; name: string }[]; onSaved: () => void }) {
	const [tab, setTab] = useState<Tab>('page');
	const requests = b.members.filter((m) => m.status === 'requested').length;
	const tryouts = b.tryouts.filter((t) => t.status === 'pending').length;
	return (
		<>
			<nav class="pf-nav" aria-label="Edit family">
				{TABS.map((t) => (
					<a
						key={t.id}
						href={`#edit-${t.id}`}
						class={tab === t.id ? 'active' : undefined}
						aria-current={tab === t.id ? 'true' : undefined}
						onClick={(e) => {
							e.preventDefault();
							setTab(t.id);
						}}
					>
						{t.label}
						{t.id === 'roster' && requests > 0 && <span class="mc-count"> {requests}</span>}
						{t.id === 'tryouts' && tryouts > 0 && <span class="mc-count"> {tryouts}</span>}
					</a>
				))}
			</nav>
			{/* Keyed by the data, so a reload after saving resets each tab's draft. */}
			{tab === 'page' && <PageTab key={b.family.updated_at} b={b} onSaved={onSaved} />}
			{tab === 'divisions' && <DivisionsTab key={JSON.stringify(b.divisions)} b={b} onSaved={onSaved} />}
			{tab === 'roster' && <RosterTab key={JSON.stringify(b.members)} b={b} onSaved={onSaved} />}
			{tab === 'tryouts' && <TryoutsTab b={b} onSaved={onSaved} />}
			{tab === 'relations' && <RelationsTab key={JSON.stringify([b.relations, b.notes])} b={b} families={families} onSaved={onSaved} />}
			{tab === 'perks' && <PerksTab key={JSON.stringify(b.allPerks)} b={b} onSaved={onSaved} />}
		</>
	);
}
