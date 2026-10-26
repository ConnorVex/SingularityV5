// Power system cards: each system's own stat block, canon picks and skills.
import { Fragment } from 'preact';
import type { ClaimRow, Universe } from '../../lib/portal/api.ts';
import type { Sheet, Skill, SystemEntry } from '../../lib/portal/sheet.ts';
import { systemById, systems, visibleFields, type Field, type FieldValue } from '../../lib/portal/systems.ts';
import { CheckboxGroup, NumberField, Section, SelectField, TextArea, TextField } from './fields.tsx';

interface Props {
	sheet: Sheet;
	update: (fn: (s: Sheet) => void) => void;
	requestedClaims: string[];
	setRequestedClaims: (ids: string[]) => void;
	claimBoard: ClaimRow[];
	universes: Universe[];
	heldClaims: Set<string>;
	readOnly: boolean;
	isEvolution: boolean;
}

const newKey = () => Math.random().toString(36).slice(2, 10);

function defaults(fields: Field[]) {
	const out: Record<string, FieldValue> = {};
	for (const f of fields) if (f.default !== undefined) out[f.key] = f.default;
	return out;
}

function FieldInput({ field, value, onChange, disabled }: { field: Field; value: FieldValue | undefined; onChange: (v: FieldValue) => void; disabled: boolean }) {
	const label = field.label;
	const help = field.help;
	const options = (field.options ?? []).map((o) => ({ value: o.value, label: `${o.label ?? o.value}${o.permission ? ' 🔑' : ''}` }));
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
			const set = (next: Record<string, string>[]) => onChange(next);
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
										onChange={(v) => set(rows.map((r, j) => (j === i ? { ...r, [col.key]: v } : r)))}
									/>
								) : (
									<TextField
										key={col.key}
										label={col.label}
										required={col.required}
										value={row[col.key] ?? ''}
										disabled={disabled}
										onInput={(v) => set(rows.map((r, j) => (j === i ? { ...r, [col.key]: v } : r)))}
									/>
								),
							)}
							{!disabled && (
								<button type="button" class="pf-button subtle" onClick={() => set(rows.filter((_, j) => j !== i))}>
									Remove
								</button>
							)}
						</div>
					))}
					{!disabled && (
						<button type="button" class="pf-button" onClick={() => set([...rows, {}])}>
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

function SkillsEditor({ skills, onChange, disabled, limits }: { skills: Skill[]; onChange: (s: Skill[]) => void; disabled: boolean; limits?: { standard?: number; ultimate?: number; label?: string } }) {
	const set = (i: number, patch: Partial<Skill>) => onChange(skills.map((s, j) => (j === i ? { ...s, ...patch } : s)));
	return (
		<div class="pf-wide pf-list">
			<h4 class="pf-subhead">
				Skills
				{limits && (
					<span class="pf-help">
						{' '}
						(start with up to {[limits.standard !== undefined && `${limits.standard} ${limits.label ?? 'Standard'}`, limits.ultimate !== undefined && `${limits.ultimate} Ultimate`].filter(Boolean).join(' and ')})
					</span>
				)}
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
							{ value: 'standard', label: 'Standard (10% Stamina)' },
							{ value: 'ultimate', label: 'Ultimate (30% Stamina, 3-turn cooldown)' },
						]}
					/>
					<TextField label="Mastery" value={skill.mastery} disabled={disabled} onInput={(v) => set(i, { mastery: v })} />
					<TextArea label="What it does" rows={2} value={skill.effect} disabled={disabled} onInput={(v) => set(i, { effect: v })} />
					{!disabled && (
						<button type="button" class="pf-button subtle" onClick={() => onChange(skills.filter((_, j) => j !== i))}>
							Remove skill
						</button>
					)}
				</div>
			))}
			{!disabled && (
				<button type="button" class="pf-button" onClick={() => onChange([...skills, { name: '', type: 'standard', effect: '', mastery: 'Untrained (0/5)' }])}>
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
							<strong>{r.name}</strong> <span class="pf-help">{r.category} · {usage(r)}</span>
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
						.map((r) => ({ value: r.id, label: `${r.name} (${usage(r)}${full(r) ? ', full' : ''})${r.note ? ` · ${r.note}` : ''}`, group: r.category || 'Other', disabled: full(r) }))}
					onChange={(id) => id && props.onChange([...props.picked, id])}
					help="Full claims can’t be picked. Admins confirm claims when they approve your character."
				/>
			)}
		</div>
	);
}

export function SystemsSection(props: Props) {
	const { sheet, update, readOnly } = props;
	const setEntry = (key: string, fn: (e: SystemEntry) => void) =>
		update((s) => {
			const e = s.systems.find((x) => x.key === key);
			if (e) fn(e);
		});

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
								<button
									type="button"
									class="pf-button subtle"
									onClick={() =>
										confirm(`Remove ${def.label} from this character?`) &&
										update((s) => {
											s.systems = s.systems.filter((x) => x.key !== entry.key);
											if (s.prioritySystem === entry.key) s.prioritySystem = '';
										})
									}
								>
									Remove system
								</button>
							)}
						</header>
						{def.notes?.map((n) => (
							<p class="pf-help" key={n}>
								ℹ {n}
							</p>
						))}
						<div class="pf-grid">
							{visibleFields(def, entry.fields).map((field) => (
								<Fragment key={field.key}>
									<FieldInput field={field} value={entry.fields[field.key]} disabled={readOnly} onChange={(v) => setEntry(entry.key, (e) => void (e.fields[field.key] = v))} />
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
								limits={props.isEvolution ? undefined : def.startingMoves?.(entry.fields)}
								onChange={(skills) => setEntry(entry.key, (e) => void (e.skills = skills))}
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
					options={systems.map((s) => ({ value: s.id, label: s.label }))}
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
