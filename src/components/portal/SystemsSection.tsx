// Power system cards: each system's own stat block, canon picks and skills.
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { ClaimRow, Universe } from '../../lib/portal/api.ts';
import { minimumMoves, rules, systemLimit } from '../../lib/portal/rules.ts';
import type { Sheet, Skill, SystemEntry } from '../../lib/portal/sheet.ts';
import { countsTowardLimit, systemById, systems, visibleFields, type Field, type FieldValue, type Option } from '../../lib/portal/systems.ts';
import { CheckboxGroup, NumberField, Section, SelectField, TextArea, TextField } from './fields.tsx';
import { RollPanel, type Roller } from './RollPanel.tsx';

interface Props {
	sheet: Sheet;
	update: (fn: (s: Sheet) => void) => void;
	requestedClaims: string[];
	setRequestedClaims: (ids: string[]) => void;
	claimBoard: ClaimRow[];
	universes: Universe[];
	heldClaims: Set<string>;
	comboSystemLimits: Record<string, number>[];
	readOnly: boolean;
	isEvolution: boolean;
	roller: Roller;
}

const newKey = () => Math.random().toString(36).slice(2, 10);

function defaults(fields: Field[]) {
	const out: Record<string, FieldValue> = {};
	for (const f of fields) if (f.default !== undefined) out[f.key] = f.default;
	return out;
}

function FieldInput(props: {
	field: Field;
	value: FieldValue | undefined;
	onChange: (v: FieldValue) => void;
	/** For lists: change the latest value, so quick edits to several cells don't overwrite each other. */
	onUpdate?: (fn: (prev: FieldValue | undefined) => FieldValue) => void;
	disabled: boolean;
	blocked?: { value: string; reason: string };
}) {
	const { field, value, onChange, disabled, blocked } = props;
	const label = field.label;
	const help = field.help;
	const options = (field.options ?? []).map((o: Option) => {
		const isBlocked = blocked?.value === o.value && value !== o.value;
		return { value: o.value, label: `${o.label ?? o.value}${o.permission ? ' 🔑' : ''}${isBlocked ? ` (${blocked!.reason})` : ''}`, disabled: isBlocked };
	});
	switch (field.type) {
		case 'select':
			return <SelectField label={label} help={help} required={field.required} value={String(value ?? '')} options={options} disabled={disabled} onChange={onChange} />;
		case 'multiselect':
			return <CheckboxGroup label={label} help={help} required={field.required} values={Array.isArray(value) ? (value as string[]) : []} options={options} disabled={disabled} onChange={onChange} />;
		case 'number':
			return <NumberField label={label} help={help} required={field.required} min={field.min} value={typeof value === 'number' ? value : Number(value) || 0} disabled={disabled} onInput={onChange} />;
		case 'textarea':
			return <TextArea label={label} help={help} required={field.required} rows={3} value={String(value ?? '')} disabled={disabled} onInput={onChange} />;
		case 'list': {
			const rows = (Array.isArray(value) ? value : []) as Record<string, string>[];
			type Rows = Record<string, string>[];
			// Each edit is applied to the newest rows, not the ones this render saw.
			const set = (fn: (prev: Rows) => Rows) =>
				props.onUpdate ? props.onUpdate((prev) => fn((Array.isArray(prev) ? prev : []) as Rows)) : onChange(fn(rows));
			return (
				<div class="pf-wide pf-list">
					<h4 class="pf-subhead">{label}</h4>
					{rows.map((row, i) => (
						<div class="pf-list-row" key={i}>
							{(field.columns ?? []).map((col) =>
								col.type === 'select' ? (
									<SelectField
										key={col.key}
										label={col.label}
										required={col.required}
										value={row[col.key] ?? ''}
										options={(col.options ?? []).map((o) => ({ value: o.value }))}
										disabled={disabled}
										onChange={(v) => set((prev) => prev.map((r, j) => (j === i ? { ...r, [col.key]: v } : r)))}
									/>
								) : (
									<TextField
										key={col.key}
										label={col.label}
										required={col.required}
										value={row[col.key] ?? ''}
										disabled={disabled}
										onInput={(v) => set((prev) => prev.map((r, j) => (j === i ? { ...r, [col.key]: v } : r)))}
									/>
								),
							)}
							{!disabled && (
								<button type="button" class="pf-button subtle" onClick={() => set((prev) => prev.filter((_, j) => j !== i))}>
									Remove
								</button>
							)}
						</div>
					))}
					{!disabled && (
						<button type="button" class="pf-button" onClick={() => set((prev) => [...prev, Object.fromEntries((field.columns ?? []).filter((c) => c.default !== undefined).map((c) => [c.key, String(c.default)]))])}>
							+ Add {label.replace(/s$/, '').toLowerCase()}
						</button>
					)}
				</div>
			);
		}
		default:
			return <TextField label={label} help={help} required={field.required} value={String(value ?? '')} disabled={disabled} onInput={onChange} />;
	}
}

type MoveLimits = { standard?: number; ultimate?: number; label?: string };

/** e.g. "needs 1–2 Extension Techniques" or "needs at least 2 Standard skills" */
function describeMoves(limits: MoveLimits, showMax: boolean) {
	const part = (max: number | undefined, name: string) => {
		if (max === undefined) return null;
		const min = minimumMoves(max);
		const plural = (n: number) => `${name}${n === 1 ? '' : 's'}`;
		if (!showMax) return min > 0 ? `at least ${min} ${plural(min)}` : null;
		return min === max ? `${max} ${plural(max)}` : `${min}–${max} ${plural(max)}`;
	};
	return [part(limits.standard, limits.label ?? 'Standard skill'), part(limits.ultimate, 'Ultimate skill')].filter(Boolean).join(' and ');
}

function SkillsEditor({ skills, onUpdate, disabled, limits, isEvolution }: { skills: Skill[]; onUpdate: (fn: (prev: Skill[]) => Skill[]) => void; disabled: boolean; limits?: MoveLimits; isEvolution: boolean }) {
	// Edits apply to the newest skills, so quick changes to several fields don't overwrite each other.
	const set = (i: number, patch: Partial<Skill>) => onUpdate((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
	const needs = limits ? describeMoves(limits, !isEvolution) : '';
	const standardName = limits?.label ?? 'Standard';
	return (
		<div class="pf-wide pf-list">
			<h4 class="pf-subhead">
				{limits?.label ? `${limits.label}s & skills` : 'Skills'}
				{needs && <span class="pf-help"> (needs {needs})</span>}
			</h4>
			{skills.map((skill, i) => (
				<div class="pf-list-row" key={i}>
					<TextField label="Skill name" required value={skill.name} disabled={disabled} onInput={(v) => set(i, { name: v })} />
					<SelectField
						label="Type"
						value={skill.type}
						disabled={disabled}
						onChange={(v) => set(i, { type: (v || 'standard') as Skill['type'] })}
						options={[
							{ value: 'passive', label: 'Passive (free, needs permission) 🔑' },
							{ value: 'standard', label: limits?.label ? `${standardName} (Standard, 10% Stamina)` : 'Standard (10% Stamina)' },
							{ value: 'ultimate', label: 'Ultimate (30% Stamina, 3-turn cooldown)' },
						]}
					/>
					<TextField label="Mastery" value={skill.mastery} disabled={disabled} onInput={(v) => set(i, { mastery: v })} />
					<TextArea label="What it does" rows={2} value={skill.effect} disabled={disabled} onInput={(v) => set(i, { effect: v })} />
					{!disabled && (
						<button type="button" class="pf-button subtle" onClick={() => onUpdate((prev) => prev.filter((_, j) => j !== i))}>
							Remove skill
						</button>
					)}
				</div>
			))}
			{!disabled && (
				<button type="button" class="pf-button" onClick={() => onUpdate((prev) => [...prev, { name: '', type: 'standard', effect: '', mastery: 'Untrained (0/5)' }])}>
					+ Add skill
				</button>
			)}
		</div>
	);
}

function ClaimPicker(props: { universe: string; label: string; board: ClaimRow[]; picked: string[]; held: Set<string>; onChange: (ids: string[]) => void; disabled: boolean }) {
	const rows = props.board.filter((r) => r.universe === props.universe && r.claim_type === 'ability');
	const mine = rows.filter((r) => props.picked.includes(r.id));
	const full = (r: ClaimRow) => r.max_users !== null && r.used_slots >= r.max_users && !props.held.has(r.id);
	const usage = (r: ClaimRow) => (r.max_users === null ? 'no limit' : `${r.used_slots}/${r.max_users}`);
	return (
		<div class="pf-wide claim-picker">
			<h4 class="pf-subhead">{props.label} (optional)</h4>
			{mine.length > 0 && (
				<ul class="claim-picked">
					{mine.map((r) => (
						<li key={r.id}>
							<strong>{r.name}</strong>
							{rules.permissionClaimCategories.includes(r.category) && <span title="Needs permission"> 🔑</span>}{' '}
							<span class="pf-help">
								{r.category} · {usage(r)}
							</span>
							{!props.disabled && (
								<button type="button" class="pf-button subtle" onClick={() => props.onChange(props.picked.filter((id) => id !== r.id))}>
									Remove
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			{!props.disabled && (
				<SelectField
					label={`Claim a ${props.label.toLowerCase()}`}
					value=""
					placeholder="Pick from the canon list…"
					options={rows
						.filter((r) => !props.picked.includes(r.id))
						.map((r) => ({
							value: r.id,
							label: `${r.name} (${usage(r)}${full(r) ? ', full' : ''})${r.note ? ` · ${r.note}` : ''}${rules.permissionClaimCategories.includes(r.category) ? ' 🔑' : ''}`,
							group: r.category || 'Other',
							disabled: full(r),
						}))}
					onChange={(id) => id && props.onChange([...props.picked, id])}
					help="Full claims can’t be picked. Admins confirm claims when they approve your character."
				/>
			)}
		</div>
	);
}

/** Asks on the page itself, since some browsers silently block confirm() pop-ups. */
function RemoveButton({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
	const [asking, setAsking] = useState(false);
	if (!asking)
		return (
			<button type="button" class="pf-button subtle" onClick={() => setAsking(true)}>
				{label}
			</button>
		);
	return (
		<span class="pf-confirm" role="group" aria-label={confirmLabel}>
			<span>{confirmLabel}</span>
			<button type="button" class="pf-button danger" onClick={onConfirm} autoFocus>
				Yes, remove
			</button>
			<button type="button" class="pf-button subtle" onClick={() => setAsking(false)}>
				Cancel
			</button>
		</span>
	);
}

export function SystemsSection(props: Props) {
	const { sheet, update, readOnly } = props;
	const setEntry = (key: string, fn: (e: SystemEntry) => void) =>
		update((s) => {
			const e = s.systems.find((x) => x.key === key);
			if (e) fn(e);
		});

	/** True when the other cards of this system already use up its limited choice (e.g. a second Stand). */
	const limitedChoiceFull = (entry: SystemEntry) => {
		const def = systemById.get(entry.system);
		const others = sheet.systems.filter((e) => e !== entry && e.system === entry.system && countsTowardLimit(def, e.fields)).length;
		return others >= systemLimit(sheet, entry.system, props.comboSystemLimits);
	};

	return (
		<Section id="systems" title="Power systems" intro="Add a card for each power system your character has. With more than one, pick a priority system.">
			{sheet.systems.length > 1 && (
				<SelectField
					label="Priority system"
					required
					value={sheet.prioritySystem}
					disabled={readOnly}
					onChange={(v) => update((s) => void (s.prioritySystem = v))}
					options={sheet.systems.map((e) => ({ value: e.key, label: systemById.get(e.system)?.label ?? e.system }))}
					help="Non-priority systems pay double Stamina for Standard and Ultimate skills."
				/>
			)}

			{sheet.systems.map((entry) => {
				const def = systemById.get(entry.system);
				if (!def) return null;
				const budget = def.budget && !props.isEvolution ? { total: def.budget.total(entry.fields), spent: def.budget.spent(entry.fields) } : null;
				const universe = props.universes.find((u) => u.slug === def.universe);
				return (
					<article class="system-card pf-wide" key={entry.key}>
						<header class="system-card-head">
							<h3>{def.label}</h3>
							{budget && budget.total > 0 && (
								<span class={`pf-badge ${budget.spent > budget.total ? 'bad' : 'ok'}`}>
									{def.budget!.label}: {budget.spent} / {budget.total}
								</span>
							)}
							{!readOnly && (
								<RemoveButton
									label="Remove system"
									confirmLabel={`Remove ${def.label}?`}
									onConfirm={() =>
										update((s) => {
											s.systems = s.systems.filter((x) => x.key !== entry.key);
											if (s.prioritySystem === entry.key || s.systems.length === 1) s.prioritySystem = s.systems[0]?.key ?? '';
										})
									}
								/>
							)}
						</header>
						{def.notes?.map((n) => (
							<p class="pf-help" key={n}>
								ℹ {n}
							</p>
						))}
						<div class="pf-grid">
							{def.fields.some((f) => f.rolled === 'cursed_energy') && (
								<RollPanel
									kind="cursed_energy"
									record={props.roller.characterRolls.cursed_energy}
									current={
										entry.fields.ceClass
											? { class: String(entry.fields.ceClass), cep: Number(entry.fields.ceAmount) || 0, level: String(entry.fields.ceLevel ?? '') }
											: null
									}
									characterId={props.roller.characterId}
									myRolls={props.roller.myRolls}
									ensureSaved={props.roller.ensureSaved}
									refresh={props.roller.refresh}
									readOnly={readOnly}
									onRolled={(r) =>
										update((s) => {
											for (const e of s.systems) {
												if (e.system !== entry.system) continue;
												e.fields.ceClass = r.class ?? '';
												e.fields.ceAmount = r.cep ?? 0;
												e.fields.ceLevel = r.level ?? '';
											}
										})
									}
									onCleared={() =>
										update((s) => {
											for (const e of s.systems) {
												if (e.system !== entry.system) continue;
												e.fields.ceClass = '';
												e.fields.ceAmount = 0;
												e.fields.ceLevel = '';
											}
										})
									}
								/>
							)}
							{visibleFields(def, entry.fields).filter((field) => !field.rolled).map((field) => (
								<Fragment key={field.key}>
									<FieldInput
										field={field}
										value={entry.fields[field.key]}
										disabled={readOnly}
										blocked={def.limitedChoice?.key === field.key && limitedChoiceFull(entry) ? { value: def.limitedChoice.value, reason: 'max reached' } : undefined}
										onChange={(v) => setEntry(entry.key, (e) => void (e.fields[field.key] = v))}
										onUpdate={(fn) => setEntry(entry.key, (e) => void (e.fields[field.key] = fn(e.fields[field.key])))}
									/>
									{field.rollProof && (
										<TextField
											label={`${field.label}: roll link`}
											value={entry.rollProofs[field.key] ?? ''}
											placeholder="https://discord.com/channels/…"
											disabled={readOnly}
											onInput={(v) => setEntry(entry.key, (e) => void (e.rollProofs[field.key] = v))}
										/>
									)}
								</Fragment>
							))}
							<TextArea
								label="Description"
								help="What it is and how it works, in your own words."
								value={entry.description}
								disabled={readOnly}
								onInput={(v) => setEntry(entry.key, (e) => void (e.description = v))}
							/>
							{def.universe && def.claimLabel && (
								<ClaimPicker
									universe={def.universe}
									label={universe?.ability_label ? `Canon ${universe.ability_label}` : def.claimLabel}
									board={props.claimBoard}
									picked={props.requestedClaims}
									held={props.heldClaims}
									disabled={readOnly}
									onChange={props.setRequestedClaims}
								/>
							)}
							<SkillsEditor
								skills={entry.skills}
								disabled={readOnly}
								limits={def.startingMoves?.(entry.fields)}
								isEvolution={props.isEvolution}
								onUpdate={(fn) => setEntry(entry.key, (e) => void (e.skills = fn(e.skills)))}
							/>
						</div>
					</article>
				);
			})}

			{!readOnly && (
				<SelectField
					label="Add a power system"
					value=""
					placeholder="Choose a system to add…"
					options={systems.map((sys) => {
						// Systems where only one choice is limited (JoJo's Stand) can always get another card.
						const limit = systemLimit(sheet, sys.id, props.comboSystemLimits);
						const have = sheet.systems.filter((e) => e.system === sys.id).length;
						const full = !sys.limitedChoice && have >= limit;
						return { value: sys.id, label: `${sys.label}${full ? ` (only ${limit === 1 ? 'one' : limit} allowed)` : ''}`, disabled: full };
					})}
					help={`${rules.powerSets.unlimited.map((id) => systemById.get(id)?.label).join(' and ')} can be added more than once. Every other system can be added once, unless a trait like Dual Gift allows more.`}
					onChange={(id) =>
						id &&
						update((s) => {
							const def = systemById.get(id)!;
							const key = newKey();
							s.systems.push({ key, system: id, fields: defaults(def.fields), description: '', skills: [], rollProofs: {} });
							if (s.systems.length === 1) s.prioritySystem = key;
						})
					}
				/>
			)}
		</Section>
	);
}
