// Potential, the trait picker with slot counting, and discovered trait combinations.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Combo } from '../../lib/portal/api.ts';
import { rules, traits, traitSlots } from '../../lib/portal/rules.ts';
import type { PickedTrait, Sheet } from '../../lib/portal/sheet.ts';
import { Section } from './fields.tsx';
import { RollPanel, type Roller } from './RollPanel.tsx';

const traitByName = new Map(traits.map((t) => [t.name, t]));
const rarityLabel = new Map(rules.traitSlots.rarities.map((r) => [r.id, r]));

/** Escapes text, then allows the **bold** / _italic_ used on the trait boards. */
export function richText(text: string) {
	const html = text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1<em>$2</em>')
		.replace(/\n{2,}/g, '</p><p>')
		.replace(/\n/g, '<br>');
	return { __html: `<p>${html}</p>` };
}

function TraitChip({ name, small }: { name: string; small?: boolean }) {
	const t = traitByName.get(name);
	return (
		<span class={`trait-chip rarity-${t?.rarity ?? 'unknown'} ${small ? 'small' : ''}`}>
			{t?.sticky && <span title="Sticky trait">📌 </span>}
			{name}
		</span>
	);
}

/** The once-only merge animation for a newly formed combination. */
export function ComboReveal({ combo, picked, onDone }: { combo: Combo; picked: string[]; onDone: () => void }) {
	const [phase, setPhase] = useState<'merge' | 'reveal'>('merge');
	const ingredients = combo.requires.map((options) => options.find((o) => picked.includes(o)) ?? options[0]);
	useEffect(() => {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const timer = setTimeout(() => setPhase('reveal'), reduced ? 300 : 2200);
		return () => clearTimeout(timer);
	}, []);
	return (
		<div class="combo-overlay" role="dialog" aria-modal="true" aria-labelledby="combo-reveal-title">
			<div class={`combo-stage ${phase}`}>
				{phase === 'merge' ? (
					<div class="combo-merge" aria-hidden="true">
						{ingredients.map((name, i) => (
							<span class="combo-ingredient" style={{ '--i': i, '--n': ingredients.length }} key={name}>
								<TraitChip name={name} />
							</span>
						))}
						<span class="combo-flash" />
					</div>
				) : (
					<div class="combo-card revealed">
						<p class="combo-kicker">✨ Combination discovered</p>
						<h2 id="combo-reveal-title">{combo.name}</h2>
						<p class="combo-from">
							{ingredients.map((n, i) => (
								<span key={n}>
									{i > 0 && ' + '}
									<TraitChip name={n} small />
								</span>
							))}
						</p>
						<div class="combo-perks" dangerouslySetInnerHTML={richText(combo.perks)} />
						<button type="button" class="pf-button primary" onClick={onDone} autoFocus>
							Awesome!
						</button>
					</div>
				)}
				<p class="sr-only" aria-live="polite">
					{phase === 'merge' ? 'Your traits are combining…' : `Combination discovered: ${combo.name}`}
				</p>
			</div>
		</div>
	);
}

function ComboDetails({ combo, picked, onClose }: { combo: Combo; picked: string[]; onClose: () => void }) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		addEventListener('keydown', onKey);
		return () => removeEventListener('keydown', onKey);
	}, [onClose]);
	return (
		<div class="combo-overlay" role="dialog" aria-modal="true" aria-labelledby="combo-detail-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
			<div class="combo-card">
				<p class="combo-kicker">Trait combination</p>
				<h2 id="combo-detail-title">{combo.name}</h2>
				<p class="combo-from">
					Formed by{' '}
					{combo.requires.map((options, i) => (
						<span key={i}>
							{i > 0 && ' + '}
							<TraitChip name={options.find((o) => picked.includes(o)) ?? options.join(' / ')} small />
						</span>
					))}
				</p>
				<div class="combo-perks" dangerouslySetInnerHTML={richText(combo.perks)} />
				<p class="pf-help">The traits that form a combination give up their own perks for the combination’s.</p>
				<button type="button" class="pf-button" onClick={onClose} autoFocus>
					Close
				</button>
			</div>
		</div>
	);
}

interface Props {
	sheet: Sheet;
	update: (fn: (s: Sheet) => void) => void;
	combos: Combo[];
	extraSlots: number;
	/** Sticky traits from the approved version can't be removed by the player. */
	lockedTraits: Set<string>;
	readOnly: boolean;
	roller: Roller;
}

export function TraitsSection({ sheet, update, combos, extraSlots, lockedTraits, readOnly, roller }: Props) {
	const [query, setQuery] = useState('');
	const [open, setOpen] = useState<Combo | null>(null);
	const picked = sheet.traits.map((t) => t.name);
	const slots = traitSlots(sheet, extraSlots);
	const comboOf = useMemo(() => {
		const map = new Map<string, string>();
		for (const c of combos) for (const options of c.requires) for (const o of options) if (picked.includes(o)) map.set(o, c.name);
		return map;
	}, [combos, picked.join('|')]);

	const results = useMemo(() => {
		const q = query.trim().toLowerCase();
		return traits.filter((t) => !picked.includes(t.name) && (!q || t.name.toLowerCase().includes(q) || t.rarity.includes(q) || t.category.includes(q) || t.effect.includes(q)));
	}, [query, picked.join('|')]);

	const setTrait = (i: number, patch: Partial<PickedTrait>) => update((s) => Object.assign(s.traits[i], patch));
	const left = slots.total - slots.used;
	const slotsOf = (name: string) => rarityLabel.get(traitByName.get(name)?.rarity ?? '')?.slots ?? 1;
	const familyTaken = sheet.traits.some((t) => t.family);

	return (
		<Section
			id="traits"
			title="Traits"
			intro="Roll your Potential here, then add the traits you rolled. Common and Uncommon traits take 1 slot, Rare 2, Legendary 3, Mythic 4."
			badge={
				<span class={`pf-badge ${slots.used > slots.total ? 'bad' : 'ok'}`}>
					Slots {slots.used} / {slots.total}
				</span>
			}
		>
			<RollPanel
				kind="potential"
				current={sheet.potential.grade ? { grade: sheet.potential.grade, roll: sheet.potential.roll } : null}
				characterId={roller.characterId}
				myRolls={roller.myRolls}
				ensureSaved={roller.ensureSaved}
				refresh={roller.refresh}
				readOnly={readOnly}
				onRolled={(r) =>
					update((s) => {
						s.potential.grade = r.grade ?? '';
						s.potential.roll = r.roll ?? null;
					})
				}
			/>
			{(() => {
				const p = rules.potentials.find((x) => x.id === sheet.potential.grade);
				return p ? <p class="pf-help pf-wide">{`${p.label} Potential reaches up to Phase ${p.maxPhase} (Tier ${p.maxTier}).`}</p> : null;
			})()}

			<div class="pf-wide">
				<h3 class="pf-subhead">Your traits</h3>
				{sheet.traits.length === 0 && <p class="pf-empty">No traits yet. Search below to add the ones you rolled.</p>}
				<ul class="trait-list">
					{sheet.traits.map((t, i) => {
						const info = traitByName.get(t.name);
						const rarity = rarityLabel.get(info?.rarity ?? '');
						const locked = lockedTraits.has(t.name) && Boolean(info?.sticky);
						return (
							<li key={t.name} class="trait-row">
								<div class="trait-row-main">
									<TraitChip name={t.name} />
									<span class="trait-meta">
										{rarity?.label ?? 'Unknown'} · {info?.category} · {info?.effect} · {t.family ? 1 : rarity?.slots ?? '?'} slot{(t.family ? 1 : rarity?.slots) === 1 ? '' : 's'}
									</span>
									{comboOf.has(t.name) && <span class="combo-tag">✨ Combined into {comboOf.get(t.name)}</span>}
								</div>
								<div class="trait-row-controls">
									<input
										type="url"
										class="trait-proof"
										aria-label={`Roll link for ${t.name}`}
										placeholder="Roll link (Discord)"
										value={t.rollProof ?? ''}
										disabled={readOnly}
										onInput={(e) => setTrait(i, { rollProof: e.currentTarget.value })}
									/>
									{(() => {
										const cantUntick = t.family && slotsOf(t.name) - 1 > left;
										const cantTick = !t.family && familyTaken;
										return (
											<label
												class="pf-check"
												title={cantUntick ? 'Not enough free slots to make this a regular trait.' : cantTick ? 'Only one trait can be a Family trait.' : undefined}
											>
												<input
													type="checkbox"
													checked={Boolean(t.family)}
													disabled={readOnly || cantUntick || cantTick}
													onChange={(e) => setTrait(i, { family: e.currentTarget.checked })}
												/>
												Family trait
											</label>
										);
									})()}
									<button
										type="button"
										class="pf-button subtle"
										disabled={readOnly || locked}
										title={locked ? 'Sticky traits can only be removed by an Administrator.' : undefined}
										onClick={() => update((s) => void s.traits.splice(i, 1))}
									>
										{locked ? 'Sticky' : 'Remove'}
									</button>
								</div>
							</li>
						);
					})}
				</ul>
			</div>

			{combos.length > 0 && (
				<div class="pf-wide">
					<h3 class="pf-subhead">Trait combinations</h3>
					<div class="combo-list">
						{combos.map((c) => (
							<button type="button" key={c.name} class="combo-card-button" onClick={() => setOpen(c)}>
								<span class="combo-kicker">✨ Combination</span>
								<strong>{c.name}</strong>
								<span class="pf-help">Click for details</span>
							</button>
						))}
					</div>
				</div>
			)}

			{!readOnly && (
				<div class="pf-wide trait-search">
					<label class="pf-label" for="trait-search">
						Add a trait
					</label>
					<input id="trait-search" type="search" placeholder="Search by name, rarity or type (e.g. “rare”, “skill”)" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
					<p class="pf-help" role="status">
						{left <= 0
							? 'All your trait slots are full. Remove a trait to add a different one.'
							: `${left} slot${left === 1 ? '' : 's'} left. Traits that don’t fit are greyed out.`}
					</p>
					<ul class="trait-results" aria-label="Matching traits">
						{results.slice(0, 40).map((t) => {
							const need = slotsOf(t.name);
							const fits = need <= left;
							return (
								<li key={t.name}>
									<button type="button" disabled={!fits} onClick={() => fits && update((s) => void s.traits.push({ name: t.name }))}>
										<TraitChip name={t.name} />
										<span class="trait-meta">
											{rarityLabel.get(t.rarity)?.label} · {t.category} · {t.effect}
										</span>
										{!fits && (
											<span class="trait-need">
												Needs {need} slot{need === 1 ? '' : 's'}, {Math.max(0, left)} left
											</span>
										)}
									</button>
								</li>
							);
						})}
						{results.length === 0 && <li class="pf-empty">No matching traits.</li>}
					</ul>
				</div>
			)}

			{open && <ComboDetails combo={open} picked={picked} onClose={() => setOpen(null)} />}
		</Section>
	);
}
