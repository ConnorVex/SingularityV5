// The character submit form: OC sheets, lighter canon tryouts, and edits to approved characters
// (which are then sent as an evolution from the evolution page, EvolvePage.tsx).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
	discoverCombos,
	loadCharacter,
	loadClaimBoard,
	loadHeldClaims,
	loadCharacterRolls,
	loadMyRolls,
	loadUniverses,
	newDraft,
	saveCharacter,
	type CharacterDraft,
	type ClaimRow,
	type Combo,
	type MyRolls,
	type RollKind,
	type RollResult,
	type Universe,
} from '../../lib/portal/api.ts';
import { loadFamilyChoices, type FamilyChoices, type MyTryout } from '../../lib/portal/families.ts';
import { characterIssues, effectiveClaims } from '../../lib/portal/checks.ts';
import { hasBlockingIssues, rules, type Issue } from '../../lib/portal/rules.ts';
import type { Sheet } from '../../lib/portal/sheet.ts';
import { applyTheme, defaultTheme, startPortalTheme, themeForRole } from '../../lib/portal/theme.ts';
import { logIn, watchPlayer, type Player } from '../../lib/supabase.ts';
import { FamiliesSection } from './FamiliesSection.tsx';
import { Section, SelectField, TextArea, TextField } from './fields.tsx';
import { StatsSection } from './StatsSection.tsx';
import { SystemsSection } from './SystemsSection.tsx';
import type { Roller } from './RollPanel.tsx';
import { ComboReveal, TraitsSection } from './TraitsSection.tsx';

const STATUS_TEXT: Record<string, { label: string; text: string }> = {
	draft: { label: 'Draft', text: 'Saved, but not sent for review yet.' },
	pending: { label: 'Waiting for review', text: 'An admin will review it soon. You can still make changes.' },
	approved: { label: 'Approved', text: 'To evolve this character, make the changes here, then describe them on the evolution page. The public version stays as it is until an admin approves.' },
	needs_correction: { label: 'Needs correction', text: 'An admin sent this back. Fix what they asked for, then send it for review again.' },
	denied: { label: 'Denied', text: 'This character was denied and is locked. You’ll need to create a new character.' },
};

const RACES = ['Human', 'Ghoul', 'Devil', 'Fiend', 'Hybrid', 'Conduit', 'Vampire', 'Cyborg'];
const STYLES = ['Brawler', 'Drunken Fist', 'Gunslinger', 'Hamon Bubble', "Speed O' Sound"];
// The form's steps, in order. Canon tryouts skip the sheet steps.
const STEPS: { id: string; label: string; ocOnly?: boolean }[] = [
	{ id: 'basics', label: 'Basics' },
	{ id: 'appearance', label: 'Appearance' },
	{ id: 'lore', label: 'Lore' },
	{ id: 'stats', label: 'Stats', ocOnly: true },
	{ id: 'traits', label: 'Traits', ocOnly: true },
	{ id: 'combat', label: 'Combat', ocOnly: true },
	{ id: 'systems', label: 'Systems', ocOnly: true },
	{ id: 'storage', label: 'Storage', ocOnly: true },
	{ id: 'families', label: 'Families' },
	{ id: 'review', label: 'Review & send' },
];
// Which step each rule check belongs to (Issue.section → step id).
const STEP_OF: Record<string, string> = {
	Basics: 'basics',
	Appearance: 'appearance',
	Lore: 'lore',
	Tryout: 'lore',
	Stats: 'stats',
	Traits: 'traits',
	Combat: 'combat',
	Systems: 'systems',
	Families: 'families',
};

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
	const [step, setStepState] = useState(() => location.hash.slice(1) || 'basics');
	const [visited, setVisited] = useState<Set<string>>(() => new Set());
	const [familyChoices, setFamilyChoices] = useState<FamilyChoices | null>(null);
	const [myRolls, setMyRolls] = useState<MyRolls | null>(null);
	const [characterRolls, setCharacterRolls] = useState<Partial<Record<RollKind, RollResult>>>({});
	const refreshRolls = (characterId?: string | null) => {
		loadMyRolls().then(setMyRolls, () => setMyRolls(null));
		const id = characterId ?? latest.current?.id ?? savedId.current;
		if (id) loadCharacterRolls(id).then(setCharacterRolls, () => undefined);
	};
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
				refreshRolls(c.id);
				loadFamilyChoices(c.id).then(setFamilyChoices, () => setFamilyChoices({ families: [], tryouts: [], memberships: [] }));
				if (c.id) {
					// A saved character has been through the form before: show every step's state.
					setVisited(new Set(STEPS.map((st) => st.id)));
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
			const result = await saveCharacter({ ...current, id, requestedClaims: effectiveClaims(current, board) }, status);
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

	const issues: Issue[] = useMemo(
		() => (draft ? characterIssues(draft, { board, held, combos, familyIds: familyChoices?.memberships.map((m) => m.family_id) ?? [] }) : []),
		[draft, board, held, combos, familyChoices],
	);

	// The steps this character has, and moving between them (the step lives in the URL hash).
	const steps = STEPS.filter((st) => draft?.kind !== 'canon' || !st.ocOnly);
	const current = steps.some((st) => st.id === step) ? step : 'basics';
	function setStep(id: string) {
		setVisited((v) => new Set(v).add(current));
		setStepState(id);
		history.replaceState(null, '', `${location.pathname}${location.search}#${id}`);
		document.querySelector('.pf')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
	// On phones the rail is a sideways-scrolling row: keep the current step in view.
	useEffect(() => {
		const rail = document.querySelector<HTMLElement>('.pf-rail ol');
		const here = rail?.querySelector<HTMLElement>('[aria-current="step"]');
		if (!rail || !here || rail.scrollWidth <= rail.clientWidth) return;
		const a = here.getBoundingClientRect();
		const r = rail.getBoundingClientRect();
		rail.scrollLeft += a.left - r.left - (r.width - a.width) / 2;
	}, [current, Boolean(draft)]);
	useEffect(() => {
		const onHash = () =>
			setStepState((prev) => {
				setVisited((v) => new Set(v).add(prev));
				return location.hash.slice(1) || 'basics';
			});
		addEventListener('hashchange', onHash);
		return () => removeEventListener('hashchange', onHash);
	}, []);

	// Combinations whose reveal hasn't played yet for this character.
	const unseen = draft ? combos.filter((c) => !draft.sheet.seenCombos.includes(c.name)) : [];

	/** Saves now (waiting for any running save) and returns the character's id, or null without a name. */
	async function ensureSaved(): Promise<string | null> {
		while (saving.current) await new Promise((r) => setTimeout(r, 100));
		if (!latest.current?.name.trim()) return null;
		const result = await save();
		return result?.id ?? latest.current?.id ?? savedId.current;
	}

	const roller: Roller = { characterId: draft?.id ?? null, myRolls, characterRolls, ensureSaved, refresh: () => refreshRolls() };

	// Rolls stick to the character: a Jujutsu Kaisen card added (again) gets the character's
	// Cursed Energy straight away, without waiting for a save.
	useEffect(() => {
		const ce = characterRolls.cursed_energy;
		if (!draft || readOnly || !ce?.class) return;
		const missing = draft.sheet.systems.some((e) => e.system === 'jujutsu-kaisen' && e.fields.ceClass !== ce.class);
		if (!missing) return;
		updateSheet((x) => {
			for (const e of x.systems) {
				if (e.system !== 'jujutsu-kaisen') continue;
				e.fields.ceClass = ce.class ?? '';
				e.fields.ceAmount = ce.cep ?? 0;
				e.fields.ceLevel = ce.level ?? '';
			}
		});
	}, [characterRolls, draft?.sheet.systems.length]);

	async function submit() {
		if (hasBlockingIssues(issues)) {
			setStep('review');
			return;
		}
		while (saving.current) await new Promise((r) => setTimeout(r, 100));
		if (isEvolution) {
			// Approved characters: save the changes, then describe them on the evolution page.
			const result = await save();
			if (result) location.href = `${location.pathname.replace(/submit\/?$/, 'evolve/')}?id=${result.id}`;
			return;
		}
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
						My Stuff
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
	const index = steps.findIndex((st) => st.id === current);
	const next = steps[index + 1];
	const back = steps[index - 1];
	const label = (id: string) => (id === 'lore' && !oc ? 'Tryout' : steps.find((st) => st.id === id)?.label ?? id);

	/** A step's mark on the rail, once the player has been through it (or reached Review):
	 * its worst open check, or a tick. A fresh form isn't covered in red marks. */
	const stepState = (id: string) => {
		if (id === 'review' || !(visited.has(id) || current === 'review')) return 'todo';
		const own = issues.filter((i) => STEP_OF[i.section] === id);
		if (own.some((i) => i.level === 'error')) return 'error';
		if (own.length > 0) return 'warn';
		return 'done';
	};
	const IssueList = ({ list }: { list: Issue[] }) => (
		<ul>
			{list.map((i, n) => (
				<li key={n}>
					<button type="button" class="pf-issue-jump" onClick={() => setStep(STEP_OF[i.section] ?? 'review')}>
						<span class="pf-issue-section">{i.section === 'Tryout' ? 'Tryout' : label(STEP_OF[i.section] ?? '') || i.section}</span> {i.message}
					</button>
				</li>
			))}
		</ul>
	);
	const useTryout = (t: MyTryout) =>
		change((d) => {
			if (!d.name.trim()) d.name = t.character_name;
			if (!d.sheet.appearance.image.trim()) d.sheet.appearance.image = t.image_url;
			if (!d.sheet.lore.personality.trim()) d.sheet.lore.personality = t.about;
			if (!d.sheet.lore.backstory.trim()) d.sheet.lore.backstory = t.backstory;
			if (!d.sheet.families.includes(t.family_id)) d.sheet.families.push(t.family_id);
		});
	const familyNames = s.families.map((id) => familyChoices?.families.find((f) => f.id === id)?.name).filter(Boolean);

	return (
		<div class="pf pf-wizard">
			{status && (
				<div class={`pf-status status-${draft.status}`}>
					<strong>{status.label}</strong> · {status.text}
				</div>
			)}

			<div class="pf-layout">
				<nav class="pf-rail" aria-label="Form steps">
					<a class="pf-back" href={location.pathname.replace(/submit\/?$/, 'characters/')}>
						← My Stuff
					</a>
					<ol>
						{steps.map((st, n) => {
							const mark = stepState(st.id);
							return (
								<li key={st.id}>
									<a
										href={`#${st.id}`}
										class={`pf-rail-step ${mark}${st.id === current ? ' current' : ''}`}
										aria-current={st.id === current ? 'step' : undefined}
										onClick={(e) => {
											e.preventDefault();
											setStep(st.id);
										}}
									>
										<span class="pf-rail-mark" aria-hidden="true">
											{mark === 'error' ? '!' : mark === 'warn' ? '•' : mark === 'done' ? '✓' : n + 1}
										</span>
										<span>{label(st.id)}</span>
										{mark === 'error' && <span class="sr-only"> (needs fixing)</span>}
									</a>
								</li>
							);
						})}
					</ol>
				</nav>

				<div class="pf-stage">
					<p class="pf-step-count">
						Step {index + 1} of {steps.length}
					</p>
					<div class="pf-step" hidden={current !== 'basics'}>
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
					</div>
					<div class="pf-step" hidden={current !== 'appearance'}>
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
					</div>
					<div class="pf-step" hidden={current !== 'lore'}>
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
					</div>

					{oc && (
						<>
							<div class="pf-step" hidden={current !== 'stats'}>
								<StatsSection sheet={s} update={updateSheet} readOnly={readOnly} isEvolution={isEvolution} />
							</div>
							<div class="pf-step" hidden={current !== 'traits'}>
								<TraitsSection
									sheet={s}
									update={updateSheet}
									combos={combos}
									extraSlots={draft.extraTraitSlots}
									lockedTraits={new Set(draft.approvedSheet?.traits.map((t) => t.name) ?? [])}
									readOnly={readOnly}
									roller={roller}
								/>
							</div>
							<div class="pf-step" hidden={current !== 'combat'}>
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
							</div>
							<div class="pf-step" hidden={current !== 'systems'}>
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
							</div>
							<div class="pf-step" hidden={current !== 'storage'}>
								<Section id="storage" title="Storage">
									<TextArea
										label="Storage"
										value={s.storage}
										disabled={readOnly}
										onInput={(v) => updateSheet((x) => void (x.storage = v))}
										help="What you currently have: technique slots, physical points and so on."
									/>
								</Section>
							</div>
						</>
					)}

					<div class="pf-step" hidden={current !== 'families'}>
						<FamiliesSection
							choices={familyChoices}
							picked={s.families}
							setPicked={(ids) => updateSheet((x) => void (x.families = ids))}
							onUseTryout={useTryout}
							approved={draft.approvedAt && draft.id ? { id: draft.id, name: draft.name } : null}
							onJoined={() => loadFamilyChoices(draft.id).then(setFamilyChoices)}
							readOnly={readOnly}
						/>
					</div>

					<div class="pf-step" hidden={current !== 'review'}>
						<section class="pf-section pf-review" id="review" aria-labelledby="pf-review-title">
							<header class="pf-section-head">
								<h2 id="pf-review-title">Review & send</h2>
							</header>
							<div class="pf-summary">
								{/^https:\/\//.test(s.appearance.image) && <img src={s.appearance.image} alt="" />}
								<div>
									<p class="pf-summary-name">{draft.name || 'Unnamed character'}</p>
									<p class="pf-help">
										{oc
											? `Original character${s.role ? ` · ${rules.roles.find((r) => r.id === s.role)?.label ?? s.role}` : ''}${s.potential.grade ? ` · ${rules.potentials.find((p) => p.id === s.potential.grade)?.label ?? s.potential.grade} Potential` : ''}`
											: `Canon tryout${draft.canonUniverse ? ` · ${universes.find((u) => u.slug === draft.canonUniverse)?.name ?? draft.canonUniverse}` : ''}`}
									</p>
									{familyNames.length > 0 && <p class="pf-help">Joining {familyNames.join(', ')}: the family’s owner or an admin reviews it.</p>}
								</div>
							</div>
							{issues.length === 0 ? (
								<p class="pf-ok">✅ Everything checks out. You’re ready to send.</p>
							) : (
								<>
									{errors.length > 0 && (
										<div class="pf-issue-group error">
											<h3>⛔ Fix before sending ({errors.length})</h3>
											<IssueList list={errors} />
										</div>
									)}
									{warnings.length > 0 && (
										<div class="pf-issue-group warning">
											<h3>⚠️ Warnings ({warnings.length})</h3>
											<p class="pf-help">You can still send it; the reviewer sees these too.</p>
											<IssueList list={warnings} />
										</div>
									)}
									{permissions.length > 0 && (
										<div class="pf-issue-group permission">
											<h3>🔑 Needs permission ({permissions.length})</h3>
											<IssueList list={permissions} />
										</div>
									)}
								</>
							)}
						</section>
					</div>
				</div>
			</div>

			<div class="pf-actions" role="region" aria-label="Save and send">
				<span class={`pf-save-state ${saveState}`} role="status">
					{saveState === 'saving' && 'Saving…'}
					{saveState === 'saved' && '✓ Saved'}
					{saveState === 'unsaved' && (draft.name.trim() ? 'Unsaved changes' : 'Add a name to start saving')}
					{saveState === 'error' && `Couldn’t save: ${saveError}`}
				</span>
				{back && (
					<button type="button" class="pf-button subtle" aria-label="Back" onClick={() => setStep(back.id)}>
						<span>←<span class="pf-long"> Back</span></span>
					</button>
				)}
				{!readOnly && (
					<button type="button" class="pf-button" disabled={!draft.name.trim() || saveState === 'saving'} onClick={() => save()}>
						<span>Save<span class="pf-long"> draft</span></span>
					</button>
				)}
				{next ? (
					<button type="button" class="pf-button primary" onClick={() => setStep(next.id)}>
						<span>Next<span class="pf-long">: {label(next.id)}</span> →</span>
					</button>
				) : (
					!readOnly && (
						<button type="button" class="pf-button primary" disabled={saveState === 'saving'} onClick={submit}>
							{isEvolution
								? 'Continue to the evolution →'
								: draft.status === 'pending'
									? 'Save changes'
									: 'Send for review'}
						</button>
					)
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
