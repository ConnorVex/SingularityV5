// The character submit form: OC sheets, lighter canon tryouts, evolutions of approved characters.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
	discoverCombos,
	loadCharacter,
	loadClaimBoard,
	loadHeldClaims,
	loadMyRolls,
	loadUniverses,
	newDraft,
	saveCharacter,
	type CharacterDraft,
	type ClaimRow,
	type Combo,
	type MyRolls,
	type Universe,
} from '../../lib/portal/api.ts';
import { checkSheet, hasBlockingIssues, rules, type Issue } from '../../lib/portal/rules.ts';
import type { Sheet } from '../../lib/portal/sheet.ts';
import { systemById } from '../../lib/portal/systems.ts';
import { applyTheme, defaultTheme, startPortalTheme, themeForRole } from '../../lib/portal/theme.ts';
import { logIn, watchPlayer, type Player } from '../../lib/supabase.ts';
import { Section, SelectField, TextArea, TextField } from './fields.tsx';
import { StatsSection } from './StatsSection.tsx';
import { SystemsSection } from './SystemsSection.tsx';
import type { Roller } from './RollPanel.tsx';
import { ComboReveal, TraitsSection } from './TraitsSection.tsx';

const STATUS_TEXT: Record<string, { label: string; text: string }> = {
	draft: { label: 'Draft', text: 'Saved, but not sent for review yet.' },
	pending: { label: 'Waiting for review', text: 'An admin will review it soon. You can still make changes.' },
	approved: { label: 'Approved', text: 'Any change you make here is an evolution: the public version stays as it is until an admin approves the changes.' },
	needs_correction: { label: 'Needs correction', text: 'An admin sent this back. Fix what they asked for, then send it for review again.' },
	denied: { label: 'Denied', text: 'This character was denied and is locked. You’ll need to create a new character.' },
};

const RACES = ['Human', 'Ghoul', 'Devil', 'Fiend', 'Hybrid', 'Conduit', 'Vampire', 'Cyborg'];
const STYLES = ['Brawler', 'Drunken Fist', 'Gunslinger', 'Hamon Bubble', "Speed O' Sound"];
const SECTIONS: [string, string][] = [
	['basics', 'Basics'],
	['appearance', 'Appearance'],
	['lore', 'Lore'],
	['stats', 'Stats'],
	['traits', 'Traits'],
	['combat', 'Combat'],
	['systems', 'Systems'],
	['storage', 'Storage & evolutions'],
];

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const traitKey = (s: Sheet) => s.traits.map((t) => `${t.name}${t.family ? '*' : ''}`).sort().join('|');

type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

export default function SubmitForm() {
	const [player, setPlayer] = useState<Player | null | undefined>(undefined);
	const [draft, setDraft] = useState<CharacterDraft | null>(null);
	const [universes, setUniverses] = useState<Universe[]>([]);
	const [board, setBoard] = useState<ClaimRow[]>([]);
	const [held, setHeld] = useState<Set<string>>(new Set());
	const [combos, setCombos] = useState<Combo[]>([]);
	const [loadError, setLoadError] = useState('');
	const [saveState, setSaveState] = useState<SaveState>('idle');
	const [saveError, setSaveError] = useState('');
	const [submitted, setSubmitted] = useState(false);
	const [activeSection, setActiveSection] = useState('basics');
	const [myRolls, setMyRolls] = useState<MyRolls | null>(null);
	const refreshRolls = () => void loadMyRolls().then(setMyRolls, () => setMyRolls(null));
	const version = useRef(0);
	const discoveredFor = useRef<string | null>(null);
	const saving = useRef(false);
	// Saves always send the newest draft and id, even when an autosave timer outlives a render.
	const latest = useRef<CharacterDraft | null>(null);
	const savedId = useRef<string | null>(null);
	// Bumped when changes arrived during a save, so another autosave is scheduled.
	const [retry, setRetry] = useState(0);
	latest.current = draft;

	useEffect(() => watchPlayer((p, error) => (error ? setLoadError(messageOf(error)) : setPlayer(p))), []);
	useEffect(() => startPortalTheme(), []);

	// The page takes on the role's colour (canon tryouts keep the default).
	const role = draft?.kind === 'oc' ? draft.sheet.role : null;
	useEffect(() => applyTheme(role ? themeForRole(role) : defaultTheme), [role]);

	useEffect(() => {
		if (!player) return;
		const id = new URLSearchParams(location.search).get('id');
		Promise.all([loadUniverses(), loadClaimBoard(), id ? loadCharacter(id) : Promise.resolve(newDraft()), id ? loadHeldClaims(id) : Promise.resolve(new Set<string>())])
			.then(async ([u, b, c, h]) => {
				setUniverses(u);
				setBoard(b);
				setHeld(h);
				setDraft(c);
				refreshRolls();
				if (c.id) {
					setCombos(await discoverCombos(c.id));
					discoveredFor.current = traitKey(c.sheet);
					setSaveState('saved');
				}
			})
			.catch((e) => setLoadError(messageOf(e)));
	}, [player?.id]);

	const readOnly = draft?.status === 'denied';
	const isEvolution = Boolean(draft?.approvedAt);

	/** Applies a change to the draft and schedules an autosave. */
	const change = (fn: (d: CharacterDraft) => void) => {
		setDraft((d) => {
			if (!d) return d;
			const next = structuredClone(d);
			fn(next);
			return next;
		});
		version.current++;
		setSaveState('unsaved');
	};
	const updateSheet = (fn: (s: Sheet) => void) => change((d) => fn(d.sheet));

	// Canon picks only count for systems the character still has.
	const effectiveClaims = (d: CharacterDraft) => {
		const universesInUse = new Set(d.sheet.systems.map((e) => systemById.get(e.system)?.universe).filter(Boolean));
		return d.requestedClaims.filter((id) => universesInUse.has(board.find((r) => r.id === id)?.universe));
	};

	async function save(status?: 'draft' | 'pending') {
		const current = latest.current;
		if (!current || readOnly) return null;
		if (saving.current) {
			// Another save is running; it schedules a fresh one when it finishes.
			return null;
		}
		if (!current.name.trim()) {
			setSaveState('unsaved');
			return null;
		}
		saving.current = true;
		const startedAt = version.current;
		setSaveState('saving');
		setSaveError('');
		try {
			const id = current.id ?? savedId.current;
			const result = await saveCharacter({ ...current, id, requestedClaims: effectiveClaims(current) }, status);
			savedId.current = result.id;
			setDraft((d) => (d ? { ...d, id: result.id, status: result.status } : d));
			if (!id) history.replaceState(null, '', `?id=${result.id}`);
			const key = traitKey(current.sheet);
			if (discoveredFor.current !== key) {
				discoveredFor.current = key;
				setCombos(await discoverCombos(result.id));
			}
			return result;
		} catch (e) {
			setSaveError(messageOf(e));
			setSaveState('error');
			return null;
		} finally {
			saving.current = false;
			if (version.current !== startedAt) {
				setSaveState('unsaved');
				setRetry((n) => n + 1);
			} else setSaveState((s) => (s === 'error' ? s : 'saved'));
		}
	}

	// Autosave a moment after the last change.
	useEffect(() => {
		if (saveState !== 'unsaved' || !draft?.name.trim() || readOnly) return;
		const timer = setTimeout(() => save(), 1500);
		return () => clearTimeout(timer);
	}, [draft, saveState, retry]);

	const issues: Issue[] = useMemo(() => {
		if (!draft) return [];
		const claims = new Map(board.map((r) => [r.id, { name: r.name, usedSlots: r.used_slots, maxUsers: r.max_users, category: r.category }]));
		const list = checkSheet(draft.sheet, {
			kind: draft.kind,
			name: draft.name,
			canonUniverse: draft.canonUniverse,
			isEvolution,
			extraTraitSlots: draft.extraTraitSlots,
			claims,
			heldClaimIds: held,
			requestedClaims: effectiveClaims(draft),
			comboSystemLimits: combos.map((c) => c.system_limits ?? {}),
		});
		if (draft.kind === 'canon' && draft.canonUniverse && draft.name.trim()) {
			const taken = board.find(
				(r) => r.claim_type === 'character' && r.universe === draft.canonUniverse && r.name.toLowerCase() === draft.name.trim().toLowerCase(),
			);
			if (taken && !held.has(taken.id) && taken.max_users !== null && taken.used_slots >= taken.max_users) {
				list.unshift({ level: 'error', section: 'Basics', message: `${taken.name} is already claimed.` });
			}
		}
		return list;
	}, [draft, board, held, combos]);

	// Highlight the tab of the section being read.
	const loaded = Boolean(draft);
	useEffect(() => {
		if (!loaded) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
				if (visible) setActiveSection(visible.target.id);
			},
			{ rootMargin: '-35% 0px -55% 0px' },
		);
		document.querySelectorAll('.pf-section[id]').forEach((el) => observer.observe(el));
		return () => observer.disconnect();
	}, [loaded, draft?.kind]);

	// Combinations whose reveal hasn't played yet for this character.
	const unseen = draft ? combos.filter((c) => !draft.sheet.seenCombos.includes(c.name)) : [];

	/** Saves now (waiting for any running save) and returns the character's id, or null without a name. */
	async function ensureSaved(): Promise<string | null> {
		while (saving.current) await new Promise((r) => setTimeout(r, 100));
		if (!latest.current?.name.trim()) return null;
		const result = await save();
		return result?.id ?? latest.current?.id ?? savedId.current;
	}

	const roller: Roller = { characterId: draft?.id ?? null, myRolls, ensureSaved, refresh: refreshRolls };

	async function submit() {
		if (hasBlockingIssues(issues)) {
			document.getElementById('pf-issues')?.scrollIntoView({ behavior: 'smooth' });
			return;
		}
		while (saving.current) await new Promise((r) => setTimeout(r, 100));
		const result = await save('pending');
		if (result) setSubmitted(true);
	}

	if (loadError) return <p class="portal-error">Couldn’t load the form: {loadError}</p>;
	if (player === undefined) return <p class="portal-status">Checking your login…</p>;
	if (player === null)
		return (
			<div class="portal-card">
				<p>Log in with Discord to create a character.</p>
				<button type="button" class="portal-button discord" onClick={() => logIn().catch((e) => setLoadError(messageOf(e)))}>
					Log in with Discord
				</button>
			</div>
		);
	if (!draft) return <p class="portal-status">Loading…</p>;

	if (submitted)
		return (
			<div class="portal-card pf-done">
				<h2>Sent for review! 🎉</h2>
				<p>
					<strong>{draft.name}</strong> is now waiting for an admin. You’ll get a ping in the announcements channel when it’s been reviewed, and you can keep
					editing it in the meantime.
				</p>
				<p>
					<a class="pf-button primary" href={location.pathname + location.search} onClick={() => setSubmitted(false)}>
						Back to the character
					</a>{' '}
					<a class="pf-button" href={location.pathname.replace(/submit\/?$/, 'characters/')}>
						My Characters
					</a>
				</p>
			</div>
		);

	const s = draft.sheet;
	const errors = issues.filter((i) => i.level === 'error');
	const warnings = issues.filter((i) => i.level === 'warning');
	const permissions = issues.filter((i) => i.level === 'permission');
	const status = draft.status ? STATUS_TEXT[draft.status] : null;
	const oc = draft.kind === 'oc';

	return (
		<div class="pf">
			{status && (
				<div class={`pf-status status-${draft.status}`}>
					<strong>{status.label}</strong> · {status.text}
				</div>
			)}

			<a class="pf-back" href={location.pathname.replace(/submit\/?$/, 'characters/')}>
				← My Characters
			</a>
			<nav class="pf-nav" aria-label="Form sections">
				{SECTIONS.filter(([id]) => oc || ['basics', 'appearance', 'lore'].includes(id)).map(([id, label]) => (
					<a key={id} href={`#${id}`} class={activeSection === id ? 'active' : undefined} aria-current={activeSection === id ? 'true' : undefined}>
						{id === 'lore' && !oc ? 'Tryout' : label}
					</a>
				))}
				<a href="#pf-issues" class={activeSection === 'pf-issues' ? 'active' : undefined}>
					Review & send
				</a>
			</nav>

			<Section id="basics" title="Basics">
				{!draft.id && (
					<SelectField
						label="Submission type"
						required
						value={draft.kind}
						onChange={(v) => change((d) => void (d.kind = v === 'canon' ? 'canon' : 'oc'))}
						options={[
							{ value: 'oc', label: 'Original character (OC)' },
							{ value: 'canon', label: 'Canon character tryout' },
						]}
					/>
				)}
				{!oc && (
					<SelectField
						label="Series"
						required
						value={draft.canonUniverse ?? ''}
						disabled={readOnly || isEvolution}
						onChange={(v) => change((d) => void (d.canonUniverse = v || null))}
						options={universes.map((u) => ({ value: u.slug, label: u.name }))}
					/>
				)}
				<TextField
					label={oc ? 'Character name' : 'Canon character'}
					required
					value={draft.name}
					disabled={readOnly}
					list={!oc ? 'pf-canon-names' : undefined}
					onInput={(v) => change((d) => void (d.name = v))}
					help={!draft.id ? 'Your character saves automatically once it has a name.' : undefined}
				/>
				{!oc && (
					<datalist id="pf-canon-names">
						{board
							.filter((r) => r.claim_type === 'character' && r.universe === draft.canonUniverse)
							.map((r) => (
								<option key={r.id} value={r.name}>
									{r.max_users !== null && r.used_slots >= r.max_users ? 'Already claimed' : ''}
								</option>
							))}
					</datalist>
				)}
				{oc && (
					<>
						<SelectField
							label="Role"
							required
							value={s.role ?? ''}
							disabled={readOnly}
							onChange={(v) => updateSheet((x) => void (x.role = v))}
							options={rules.roles.map((r) => ({ value: r.id, label: `${r.label} (starts with ${r.startingPtp} PTP)` }))}
						/>
						<TextField label="Race" value={s.race ?? ''} list="pf-races" disabled={readOnly} onInput={(v) => updateSheet((x) => void (x.race = v))} />
						<datalist id="pf-races">
							{RACES.map((r) => (
								<option key={r} value={r} />
							))}
						</datalist>
						<TextField label="Age" value={s.age ?? ''} disabled={readOnly} onInput={(v) => updateSheet((x) => void (x.age = v))} />
						<TextField label="Pronouns" value={s.pronouns ?? ''} disabled={readOnly} onInput={(v) => updateSheet((x) => void (x.pronouns = v))} />
					</>
				)}
			</Section>

			<Section id="appearance" title="Appearance">
				<TextField
					label="Main picture (link)"
					type="url"
					value={s.appearance.image}
					placeholder="https://…"
					disabled={readOnly}
					onInput={(v) => updateSheet((x) => void (x.appearance.image = v))}
				/>
				{/^https:\/\//.test(s.appearance.image) && <img class="pf-preview" src={s.appearance.image} alt={`Picture of ${draft.name || 'your character'}`} />}
				{oc && (
					<>
						<TextArea
							label="Appearance"
							required
							value={s.appearance.description}
							disabled={readOnly}
							onInput={(v) => updateSheet((x) => void (x.appearance.description = v))}
							help="Physical appearance and traits that distinguish your character."
						/>
						<TextArea
							label="Extra pictures (one link per line)"
							rows={2}
							value={s.appearance.extraImages}
							disabled={readOnly}
							onInput={(v) => updateSheet((x) => void (x.appearance.extraImages = v))}
						/>
					</>
				)}
			</Section>

			{oc ? (
				<Section id="lore" title="Lore">
					<TextArea label="Backstory" required rows={8} value={s.lore.backstory} disabled={readOnly} onInput={(v) => updateSheet((x) => void (x.lore.backstory = v))} />
					<TextArea
						label="Personality"
						required
						value={s.lore.personality}
						disabled={readOnly}
						onInput={(v) => updateSheet((x) => void (x.lore.personality = v))}
						help="Their character traits, not the traits you rolled."
					/>
					<TextArea label="Likes" rows={2} value={s.lore.likes} disabled={readOnly} onInput={(v) => updateSheet((x) => void (x.lore.likes = v))} />
					<TextArea label="Dislikes" rows={2} value={s.lore.dislikes} disabled={readOnly} onInput={(v) => updateSheet((x) => void (x.lore.dislikes = v))} />
					<TextArea label="Relations" rows={3} value={s.lore.relations} disabled={readOnly} onInput={(v) => updateSheet((x) => void (x.lore.relations = v))} />
				</Section>
			) : (
				<Section id="lore" title="Tryout">
					<TextArea
						label="How you’ll portray them"
						required
						rows={5}
						value={s.canon.portrayal}
						disabled={readOnly}
						onInput={(v) => updateSheet((x) => void (x.canon.portrayal = v))}
						help="Their personality, where they are in their story, and what you want to do with them."
					/>
					<TextArea
						label="Roleplay sample"
						required
						rows={8}
						value={s.canon.sample}
						disabled={readOnly}
						onInput={(v) => updateSheet((x) => void (x.canon.sample = v))}
						help="A short post written as this character."
					/>
				</Section>
			)}

			{oc && (
				<>
					<StatsSection sheet={s} update={updateSheet} readOnly={readOnly} isEvolution={isEvolution} />
					<TraitsSection
						sheet={s}
						update={updateSheet}
						combos={combos}
						extraSlots={draft.extraTraitSlots}
						lockedTraits={new Set(draft.approvedSheet?.traits.map((t) => t.name) ?? [])}
						readOnly={readOnly}
						roller={roller}
					/>

					<Section id="combat" title="Combat">
						<TextArea
							label="Combat info"
							value={s.combat.info}
							disabled={readOnly}
							onInput={(v) => updateSheet((x) => void (x.combat.info = v))}
							help="Physical expertise and how they fight."
						/>
						<div class="pf-wide pf-list">
							<h3 class="pf-subhead">Fighting Styles</h3>
							{s.combat.styles.map((style, i) => (
								<div class="pf-list-row" key={i}>
									<TextField
										label="Style"
										required
										list="pf-styles"
										value={style.name}
										disabled={readOnly}
										onInput={(v) => updateSheet((x) => void (x.combat.styles[i].name = v))}
									/>
									<TextField
										label="Roll link"
										value={style.rollProof}
										placeholder="https://discord.com/channels/…"
										disabled={readOnly}
										onInput={(v) => updateSheet((x) => void (x.combat.styles[i].rollProof = v))}
									/>
									{!readOnly && (
										<button type="button" class="pf-button subtle" onClick={() => updateSheet((x) => void x.combat.styles.splice(i, 1))}>
											Remove
										</button>
									)}
								</div>
							))}
							<datalist id="pf-styles">
								{STYLES.map((n) => (
									<option key={n} value={n} />
								))}
							</datalist>
							{!readOnly && (
								<button type="button" class="pf-button" onClick={() => updateSheet((x) => void x.combat.styles.push({ name: '', rollProof: '' }))}>
									+ Add fighting style
								</button>
							)}
						</div>
					</Section>

					<SystemsSection
						sheet={s}
						update={updateSheet}
						requestedClaims={draft.requestedClaims}
						setRequestedClaims={(ids) => change((d) => void (d.requestedClaims = ids))}
						claimBoard={board}
						universes={universes}
						heldClaims={held}
						comboSystemLimits={combos.map((c) => c.system_limits ?? {})}
						readOnly={readOnly}
						isEvolution={isEvolution}
						roller={roller}
					/>

					<Section id="storage" title="Storage & evolutions">
						<TextArea
							label="Storage"
							value={s.storage}
							disabled={readOnly}
							onInput={(v) => updateSheet((x) => void (x.storage = v))}
							help="What you currently have: technique slots, physical points and so on."
						/>
						<div class="pf-wide pf-list">
							<h3 class="pf-subhead">Evolution log</h3>
							<p class="pf-help">When your character evolves, add an entry here and send the character for review again.</p>
							{s.evolutions.map((ev, i) => (
								<div class="pf-list-row" key={i}>
									<TextField label="Date" type="date" value={ev.date} disabled={readOnly} onInput={(v) => updateSheet((x) => void (x.evolutions[i].date = v))} />
									<TextField
										label="What changed"
										required
										value={ev.summary}
										disabled={readOnly}
										onInput={(v) => updateSheet((x) => void (x.evolutions[i].summary = v))}
									/>
									<TextField
										label="How it was earned"
										value={ev.earned}
										disabled={readOnly}
										onInput={(v) => updateSheet((x) => void (x.evolutions[i].earned = v))}
									/>
									<TextField
										label="RP link"
										value={ev.link}
										placeholder="https://discord.com/channels/…"
										disabled={readOnly}
										onInput={(v) => updateSheet((x) => void (x.evolutions[i].link = v))}
									/>
									{!readOnly && (
										<button type="button" class="pf-button subtle" onClick={() => updateSheet((x) => void x.evolutions.splice(i, 1))}>
											Remove
										</button>
									)}
								</div>
							))}
							{!readOnly && (
								<button
									type="button"
									class="pf-button"
									onClick={() => updateSheet((x) => void x.evolutions.push({ date: new Date().toISOString().slice(0, 10), summary: '', earned: '', link: '' }))}
								>
									+ Add evolution
								</button>
							)}
						</div>
					</Section>
				</>
			)}

			<section class="pf-section pf-review" id="pf-issues" aria-labelledby="pf-issues-title">
				<header class="pf-section-head">
					<h2 id="pf-issues-title">Review & send</h2>
				</header>
				{issues.length === 0 ? (
					<p class="pf-ok">✅ Everything checks out.</p>
				) : (
					<>
						{errors.length > 0 && (
							<div class="pf-issue-group error">
								<h3>⛔ Fix before sending ({errors.length})</h3>
								<ul>{errors.map((i, n) => <li key={n}><span class="pf-issue-section">{i.section}</span> {i.message}</li>)}</ul>
							</div>
						)}
						{warnings.length > 0 && (
							<div class="pf-issue-group warning">
								<h3>⚠️ Warnings ({warnings.length})</h3>
								<p class="pf-help">You can still send it; admins will see these too.</p>
								<ul>{warnings.map((i, n) => <li key={n}><span class="pf-issue-section">{i.section}</span> {i.message}</li>)}</ul>
							</div>
						)}
						{permissions.length > 0 && (
							<div class="pf-issue-group permission">
								<h3>🔑 Needs permission ({permissions.length})</h3>
								<ul>{permissions.map((i, n) => <li key={n}><span class="pf-issue-section">{i.section}</span> {i.message}</li>)}</ul>
							</div>
						)}
					</>
				)}
			</section>

			<div class="pf-actions" role="region" aria-label="Save and send">
				<span class={`pf-save-state ${saveState}`} role="status">
					{saveState === 'saving' && 'Saving…'}
					{saveState === 'saved' && '✓ Saved'}
					{saveState === 'unsaved' && (draft.name.trim() ? 'Unsaved changes' : 'Add a name to start saving')}
					{saveState === 'error' && `Couldn’t save: ${saveError}`}
				</span>
				{!readOnly && (
					<>
						<button type="button" class="pf-button" disabled={!draft.name.trim() || saveState === 'saving'} onClick={() => save()}>
							Save draft
						</button>
						<button type="button" class="pf-button primary" disabled={saveState === 'saving'} onClick={submit}>
							{draft.status === 'pending' ? 'Save changes' : 'Send for review'}
						</button>
					</>
				)}
			</div>

			{unseen.length > 0 && (
				<ComboReveal
					key={unseen[0].name}
					combo={unseen[0]}
					picked={s.traits.map((t) => t.name)}
					onDone={() => updateSheet((x) => void x.seenCombos.push(unseen[0].name))}
				/>
			)}
		</div>
	);
}
