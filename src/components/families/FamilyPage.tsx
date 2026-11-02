// One family's page (?f=slug): the public view, join requests, and the owner's editor.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import {
	FOUND_IN,
	PERK_ACCESS,
	PERK_KINDS,
	RECRUITING,
	STANDINGS,
	deleteTryout,
	familiesBase,
	loadFamilies,
	loadFamily,
	loadMyApprovedCharacters,
	removeMember,
	requestToJoin,
	richText,
	sendTryout,
	type FamilyBundle,
	type Member,
	type MyCharacter,
	type TryoutDraft,
} from '../../lib/families/api.ts';
import { portalConfigured, watchPlayer, logIn, type Player } from '../../lib/supabase.ts';
import FamilyEditor from './FamilyEditor.tsx';
import { FactTiles, StatusBanner, messageOf, useFamilyTheme } from './shared.tsx';

function Portrait({ m, portraits }: { m: Member; portraits: Record<string, string> }) {
	const src = (m.character_id && portraits[m.character_id]) || (/^https:\/\//.test(m.image_url) ? m.image_url : '');
	return <span class="fm-face">{src ? <img src={src} alt="" loading="lazy" /> : m.name.slice(0, 1)}</span>;
}

function MemberRow({ m, portraits }: { m: Member; portraits: Record<string, string> }) {
	return (
		<li class={`fm-member${m.title ? ' titled' : ''}`}>
			<Portrait m={m} portraits={portraits} />
			<span class="fm-member-text">
				<strong>{m.name}</strong>
				{(m.title || m.relationship) && <span class="fm-member-sub">{[m.title, m.relationship].filter(Boolean).join(' · ')}</span>}
			</span>
			{m.character_id && <span class="fm-tag" title="A portal character">OC</span>}
		</li>
	);
}

/** Long lists show their first few entries, with a button for the rest. */
const SHOWN = 5;
function Collapsible({ items, noun }: { items: JSX.Element[]; noun: string }) {
	const [all, setAll] = useState(false);
	const hidden = items.length - SHOWN;
	return (
		<>
			<ul class="fm-members">{all || hidden <= 1 ? items : items.slice(0, SHOWN)}</ul>
			{hidden > 1 && (
				<button type="button" class="fm-more" aria-expanded={all} onClick={() => setAll(!all)}>
					{all ? 'Show fewer' : `Show all ${items.length} ${noun}`}
				</button>
			)}
		</>
	);
}

function Prose({ text }: { text: string }) {
	return <div class="fm-prose" dangerouslySetInnerHTML={{ __html: richText(text) }} />;
}

function Block({ id, title, children, badge }: { id: string; title: string; children: ComponentChildren; badge?: ComponentChildren }) {
	return (
		<section class="pf-section fm-block" id={id} aria-labelledby={`${id}-title`}>
			<header class="pf-section-head">
				<h2 id={`${id}-title`}>{title}</h2>
				{badge}
			</header>
			{children}
		</section>
	);
}

const TRYOUT_STATUS = { pending: 'Waiting for the owner', accepted: 'Accepted', declined: 'Declined' } as const;
const EMPTY_TRYOUT: TryoutDraft = { division_id: null, character_name: '', image_url: '', about: '', backstory: '', sample: '' };
const portalSubmit = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}portal/submit/`;

/** The tryout form: a brand-new sample character, no stats. */
function TryoutForm({ b, onSent, onCancel }: { b: FamilyBundle; onSent: () => void; onCancel: () => void }) {
	const [t, setT] = useState<TryoutDraft>(EMPTY_TRYOUT);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const set = <K extends keyof TryoutDraft>(k: K, v: TryoutDraft[K]) => setT({ ...t, [k]: v });
	const imageBad = t.image_url.trim() !== '' && !/^https:\/\//.test(t.image_url.trim());
	const ready = t.character_name.trim() && t.about.trim() && t.sample.trim() && !imageBad;
	return (
		<div class="fm-tryout">
			<p class="pf-subhead">Your tryout</p>
			<p class="pf-help">
				Make up a <strong>brand-new character</strong> for {b.family.name}. No stats, no sheet: just who they are and a sample of how you'd RP them. Only the owner and admins can read it.
			</p>
			<div class="pf-grid">
				<div class="pf-field">
					<label class="pf-label" for="fm-t-name">
						Character name <span class="pf-required">*</span>
					</label>
					<input id="fm-t-name" maxLength={100} value={t.character_name} onInput={(e) => set('character_name', e.currentTarget.value)} />
				</div>
				{b.divisions.length > 0 && (
					<div class="pf-field">
						<label class="pf-label" for="fm-t-div">
							Trying out for
						</label>
						<select id="fm-t-div" value={t.division_id ?? ''} onChange={(e) => set('division_id', e.currentTarget.value || null)}>
							<option value="">Any division</option>
							{b.divisions.map((d) => (
								<option key={d.id} value={d.id}>
									{d.name}
									{d.open_spots > 0 ? ` (${d.open_spots} open)` : ''}
								</option>
							))}
						</select>
					</div>
				)}
				<div class="pf-field">
					<label class="pf-label" for="fm-t-img">
						Picture link
					</label>
					<input id="fm-t-img" type="url" value={t.image_url} onInput={(e) => set('image_url', e.currentTarget.value)} placeholder="https://… (optional)" />
					{imageBad && <p class="pf-help">The link must start with https://</p>}
				</div>
				<div class="pf-field pf-wide">
					<label class="pf-label" for="fm-t-about">
						Who they are <span class="pf-required">*</span>
					</label>
					<textarea
						id="fm-t-about"
						rows={4}
						maxLength={4000}
						value={t.about}
						onInput={(e) => set('about', e.currentTarget.value)}
						placeholder="Personality, look, and what they'd bring to the family."
					/>
				</div>
				<div class="pf-field pf-wide">
					<label class="pf-label" for="fm-t-back">
						Backstory
					</label>
					<textarea
						id="fm-t-back"
						rows={4}
						maxLength={4000}
						value={t.backstory}
						onInput={(e) => set('backstory', e.currentTarget.value)}
						placeholder="How are they connected to the family? Optional."
					/>
				</div>
				<div class="pf-field pf-wide">
					<label class="pf-label" for="fm-t-sample">
						RP sample <span class="pf-required">*</span>
					</label>
					<textarea
						id="fm-t-sample"
						rows={8}
						maxLength={6000}
						value={t.sample}
						onInput={(e) => set('sample', e.currentTarget.value)}
						placeholder="A short scene written as your character, the way you'd post it in RP."
					/>
					<p class="pf-help">{t.sample.length}/6000. **bold** and *italic* work.</p>
				</div>
			</div>
			<div class="fm-edit-row-tools">
				<button type="button" class="pf-button subtle" disabled={busy} onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					class="pf-button primary"
					disabled={!ready || busy}
					onClick={async () => {
						setBusy(true);
						setError('');
						try {
							await sendTryout(b.family.id, t);
							onSent();
						} catch (e) {
							setError(messageOf(e));
							setBusy(false);
						}
					}}
				>
					Send tryout
				</button>
			</div>
			{error && <p class="portal-error">{error}</p>}
		</div>
	);
}

function JoinPanel({ b, player, onChanged }: { b: FamilyBundle; player: Player | null; onChanged: () => void }) {
	const [chars, setChars] = useState<MyCharacter[] | null>(null);
	const [pick, setPick] = useState('');
	const [message, setMessage] = useState('');
	const [formOpen, setFormOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [done, setDone] = useState('');
	useEffect(() => {
		if (player) loadMyApprovedCharacters().then(setChars, (e) => setError(messageOf(e)));
	}, [player?.id]);

	const recruiting = b.family.recruiting;
	if (b.family.status !== 'approved') return null;
	if (!player)
		return (
			<Block id="join" title="Join" badge={<span class="pf-badge ok">{RECRUITING[recruiting]}</span>}>
				<p class="pf-intro">
					{recruiting === 'tryouts'
						? 'This family holds tryouts. Log in with Discord to send one.'
						: 'Log in with Discord to ask to join with one of your approved characters.'}
				</p>
				<button type="button" class="portal-button discord" onClick={() => logIn().catch((e) => setError(messageOf(e)))}>
					Log in with Discord
				</button>
				{error && <p class="portal-error">{error}</p>}
			</Block>
		);
	if (!chars) return null;

	const mineHere = b.members.filter((m) => m.character_id && chars.some((c) => c.id === m.character_id));
	const free = chars.filter((c) => !mineHere.some((m) => m.character_id === c.id));
	const myTryouts = b.tryouts.filter((t) => t.player_id === player.id);
	const passed = myTryouts.some((t) => t.status === 'accepted');
	const waiting = myTryouts.some((t) => t.status === 'pending');
	const canAsk = (recruiting === 'open' || passed) && free.length > 0;

	async function run(action: () => Promise<void>, ok: string) {
		setBusy(true);
		setError('');
		try {
			await action();
			setDone(ok);
			setPick('');
			setMessage('');
			onChanged();
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Block id="join" title="Join" badge={<span class="pf-badge ok">{RECRUITING[recruiting]}</span>}>
			{mineHere.length > 0 && (
				<ul class="fm-mine">
					{mineHere.map((m) => (
						<li key={m.id}>
							<strong>{m.name}</strong> · {m.status === 'active' ? 'Member' : 'Request pending'}
							<button
								type="button"
								class="pf-button subtle"
								disabled={busy}
								onClick={() => run(() => removeMember(m.id), m.status === 'active' ? `${m.name} left the family.` : 'Request withdrawn.')}
							>
								{m.status === 'active' ? 'Leave' : 'Withdraw'}
							</button>
						</li>
					))}
				</ul>
			)}
			{mineHere.some((m) => m.status === 'active') && (
				<p class="pf-help">Leaving removes your character from the roster, and they lose this family's perks.</p>
			)}

			{myTryouts.length > 0 && (
				<ul class="fm-mine">
					{myTryouts.map((t) => (
						<li key={t.id} class={`tryout-${t.status}`}>
							<span>
								Tryout: <strong>{t.character_name}</strong> · <span class="fm-tryout-state">{TRYOUT_STATUS[t.status]}</span>
								{t.owner_note && <span class="fm-request-msg"> “{t.owner_note}”</span>}
							</span>
							{t.status === 'pending' && (
								<button type="button" class="pf-button subtle" disabled={busy} onClick={() => run(() => deleteTryout(t.id), 'Tryout withdrawn.')}>
									Withdraw
								</button>
							)}
						</li>
					))}
				</ul>
			)}

			{recruiting === 'tryouts' && passed && (
				<p class="pf-intro">
					Your tryout was accepted. <a href={portalSubmit}>Submit the character</a> in the portal, and once it's approved, ask to join with it below.
				</p>
			)}

			{canAsk ? (
				<div class="pf-grid">
					<div class="pf-field">
						<label class="pf-label" for="fm-join-char">
							Character
						</label>
						<select id="fm-join-char" value={pick} onChange={(e) => setPick(e.currentTarget.value)}>
							<option value="">Choose…</option>
							{free.map((c) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>
					</div>
					<div class="pf-field pf-wide">
						<label class="pf-label" for="fm-join-msg">
							Message to the owner
						</label>
						<textarea id="fm-join-msg" rows={2} maxLength={500} value={message} onInput={(e) => setMessage(e.currentTarget.value)} placeholder="Optional" />
					</div>
					<div class="pf-wide">
						<button
							type="button"
							class="pf-button primary"
							disabled={!pick || busy}
							onClick={() => run(() => requestToJoin(b.family.id, free.find((c) => c.id === pick)!, message), 'Request sent. The owner will be told on Discord.')}
						>
							Ask to join
						</button>
					</div>
				</div>
			) : recruiting === 'tryouts' && !passed ? (
				waiting ? (
					<p class="pf-intro">Your tryout is with the owner. You'll be pinged on Discord when they decide.</p>
				) : formOpen ? (
					<TryoutForm
						b={b}
						onCancel={() => setFormOpen(false)}
						onSent={() => {
							setFormOpen(false);
							setDone('Tryout sent. The owner will be told on Discord.');
							onChanged();
						}}
					/>
				) : (
					<>
						<p class="pf-intro">This family holds tryouts. Write up a brand-new sample character, and if the owner likes it, you can make that character and join.</p>
						<button type="button" class="pf-button primary" onClick={() => setFormOpen(true)}>
							Request a tryout
						</button>
					</>
				)
			) : recruiting === 'closed' && !passed ? (
				<p class="pf-intro">This family isn't recruiting right now.</p>
			) : (
				<p class="pf-intro">{chars.length ? 'All your approved characters are already here.' : 'You need an approved character to ask to join.'}</p>
			)}
			{done && <p class="fm-done">{done}</p>}
			{error && <p class="portal-error">{error}</p>}
		</Block>
	);
}

function FamilyView({ b, player, onChanged }: { b: FamilyBundle; player: Player | null; onChanged: () => void }) {
	const f = b.family;
	const active = b.members.filter((m) => m.status === 'active');
	const banner = /^https:\/\//.test(f.banner_url) ? f.banner_url : null;
	const unassigned = active.filter((m) => !m.division_id || !b.divisions.some((d) => d.id === m.division_id));
	const relationsBy = STANDINGS.map((s) => ({ ...s, rows: b.relations.filter((r) => r.standing === s.id), note: b.notes.find((n) => n.standing === s.id)?.note }));
	const openPerks = b.perks.filter((p) => p.unlocked);
	const lockedPerks = b.perks.length - openPerks.length;
	const perkGroups = PERK_KINDS.map((k) => ({ ...k, rows: openPerks.filter((p) => p.kind === k.id) })).filter((g) => g.rows.length);

	return (
		<>
			<header class={`fm-hero${banner ? ' has-banner' : ''}`}>
				{banner && <img class="fm-hero-img" src={banner} alt="" />}
				<div class="fm-hero-text">
					<p class="fm-chips">
						{f.special_statuses.map((s) => (
							<span class="fm-chip special" key={s}>
								{s}
							</span>
						))}
						<span class={`fm-chip ${f.recruiting === 'closed' ? 'muted' : 'good'}`}>{RECRUITING[f.recruiting]}</span>
					</p>
					<h1 class="fm-title">{f.name}</h1>
					{f.description && <p class="fm-lead">{f.description}</p>}
				</div>
			</header>

			<FactTiles
				items={[
					{ label: 'Head of Family', value: f.head_name },
					{ label: 'Run by', value: b.owner?.display_name },
					{ label: 'Race', value: f.race },
					{ label: 'Specialty', value: f.specialty },
					{ label: 'Found in', value: FOUND_IN[f.found_in] },
					{ label: 'Members', value: active.length },
				]}
			/>

			{f.lore && (
				<Block id="lore" title="Lore">
					<Prose text={f.lore} />
				</Block>
			)}

			{(b.divisions.length > 0 || unassigned.length > 0) && (
				<Block id="roster" title={b.divisions.length ? 'Divisions' : 'Members'}>
					<div class="fm-divisions">
						{b.divisions.map((d) => {
							const people = active.filter((m) => m.division_id === d.id);
							const open = (key: string, sub: string) => (
								<li class="fm-member open" key={key}>
									<span class="fm-face">?</span>
									<span class="fm-member-text">
										<strong>Open spot</strong>
										<span class="fm-member-sub">{sub}</span>
									</span>
								</li>
							);
							const spots = d.open_spots + (d.head_open ? 1 : 0);
							return (
								<article class="fm-division" key={d.id}>
									<h3>{d.name}</h3>
									<p class="fm-division-count">
										{people.length} member{people.length === 1 ? '' : 's'}
										{spots > 0 && ` · ${spots} open spot${spots === 1 ? '' : 's'}`}
									</p>
									{d.description && <p class="fm-division-text">{d.description}</p>}
									<Collapsible
										noun="members"
										items={[
											...(d.head_open ? [open('head', `Head · ${RECRUITING[f.recruiting]}`)] : []),
											...people.map((m) => <MemberRow key={m.id} m={m} portraits={b.portraits} />),
											...Array.from({ length: d.open_spots }, (_, i) => open(`open-${i}`, RECRUITING[f.recruiting])),
										]}
									/>
								</article>
							);
						})}
						{unassigned.length > 0 && (
							<article class="fm-division">
								<h3>{b.divisions.length ? 'Other members' : 'Roster'}</h3>
								<Collapsible noun="members" items={unassigned.map((m) => <MemberRow key={m.id} m={m} portraits={b.portraits} />)} />
							</article>
						)}
					</div>
				</Block>
			)}

			{f.home && (
				<Block id="home" title="Home">
					<Prose text={f.home} />
				</Block>
			)}

			{b.relations.length > 0 && (
				<Block id="relations" title="Relations">
					<div class="fm-relations">
						{relationsBy
							.filter((s) => s.rows.length)
							.map((s) => (
								<div class={`fm-standing tone-${s.tone}`} key={s.id}>
									<p class="fm-standing-label">{s.label}</p>
									<ul>
										{s.rows.map((r) => (
											<li key={r.id}>
												{r.other_family_id ? <strong>{r.other_name}</strong> : r.other_name}
												{r.note && <span class="fm-member-sub"> · {r.note}</span>}
											</li>
										))}
									</ul>
									{s.note && <p class="fm-standing-note">{s.note}</p>}
								</div>
							))}
					</div>
				</Block>
			)}

			<Block id="perks" title="Perks" badge={b.perks.length ? <span class="mc-count">{b.perks.length}</span> : undefined}>
				{b.perks.length === 0 && <p class="pf-empty">No perks yet.</p>}
				{perkGroups.map((g) => (
					<div class="fm-perk-group" key={g.id}>
						<h3 class="fm-perk-kind">{g.label}</h3>
						{g.rows.map((p) => (
							<details class="fm-perk" key={p.id}>
								<summary>
									<strong>{p.title}</strong>
									<span class="fm-perk-tags">
										{p.hidden && <span class="fm-chip lock">Members only</span>}
										<span class="fm-chip">{PERK_ACCESS.find((x) => x.id === p.access)?.label}</span>
									</span>
								</summary>
								{p.description ? <Prose text={p.description} /> : <p class="pf-empty">No details.</p>}
							</details>
						))}
					</div>
				))}
				{lockedPerks > 0 && (
					<div class="fm-perk-locked">
						<span class="fm-lock" aria-hidden="true">
							🔒
						</span>
						<div>
							<strong>
								{lockedPerks} members-only perk{lockedPerks === 1 ? '' : 's'}
							</strong>
							<p>Only this family's members can see {lockedPerks === 1 ? 'it' : 'them'}. Join the family to find out.</p>
						</div>
					</div>
				)}
			</Block>

			<JoinPanel b={b} player={player} onChanged={onChanged} />
		</>
	);
}

export default function FamilyPage() {
	const slug = useMemo(() => new URLSearchParams(location.search).get('f') ?? '', []);
	const [player, setPlayer] = useState<Player | null | undefined>(undefined);
	const [bundle, setBundle] = useState<FamilyBundle | null>(null);
	const [editing, setEditing] = useState(() => location.hash === '#edit');
	const [families, setFamilies] = useState<{ id: string; name: string }[]>([]);
	const [error, setError] = useState('');

	useFamilyTheme(bundle?.family.colour);
	useEffect(() => {
		if (!portalConfigured) return setError('The portal is not connected to its database yet.');
		if (!slug) return setError('No family chosen.');
		watchPlayer((p) => setPlayer(p));
		const onHash = () => setEditing(location.hash === '#edit');
		addEventListener('hashchange', onHash);
		return () => removeEventListener('hashchange', onHash);
	}, []);

	const canManage = (owner: string | null) => Boolean(player && (player.isAdmin || owner === player.id));
	async function load() {
		try {
			setBundle(await loadFamily(slug, (f) => canManage(f.owner_id)));
		} catch (e) {
			setError(messageOf(e));
		}
	}
	useEffect(() => {
		if (player !== undefined) load();
	}, [player?.id ?? null, player === undefined]);
	useEffect(() => {
		if (bundle) document.title = `${bundle.family.name} | Singularity`;
	}, [bundle?.family.name]);
	// Other families' names, for the relations editor.
	useEffect(() => {
		if (editing && families.length === 0) loadFamilies().then(setFamilies, () => {});
	}, [editing]);

	if (error)
		return (
			<div class="pf fm">
				<p class="portal-error">{error}</p>
				<a class="pf-button" href={familiesBase}>
					← Family Directory
				</a>
			</div>
		);
	if (!bundle) return <p class="portal-status">Loading family…</p>;

	const manage = canManage(bundle.family.owner_id);
	const requests = bundle.members.filter((m) => m.status === 'requested').length;
	const pendingPerks = bundle.allPerks.filter((p) => p.status === 'pending').length;

	return (
		<div class="pf fm fm-page">
			<div class="fm-toolbar">
				<a class="pf-button subtle" href={familiesBase}>
					← Directory
				</a>
				{manage && (
					<button
						type="button"
						class={`pf-button${editing ? '' : ' primary'}`}
						onClick={() => {
							setEditing(!editing);
							history.replaceState(null, '', editing ? location.pathname + location.search : '#edit');
							scrollTo({ top: 0 });
						}}
					>
						{editing ? 'Done editing' : `Manage family${requests ? ` · ${requests} request${requests === 1 ? '' : 's'}` : ''}`}
					</button>
				)}
			</div>
			{manage && <StatusBanner status={bundle.family.status} note={bundle.family.review_note} />}
			{manage && !editing && pendingPerks > 0 && <p class="pf-help">{pendingPerks} perk{pendingPerks === 1 ? '' : 's'} waiting for an admin.</p>}
			{editing && manage ? (
				<FamilyEditor b={bundle} families={families} onSaved={load} />
			) : (
				<FamilyView b={bundle} player={player ?? null} onChanged={load} />
			)}
		</div>
	);
}
