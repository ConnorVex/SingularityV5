// Small labelled inputs shared by the portal forms.
import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';

interface Base {
	label: string;
	help?: ComponentChildren;
	required?: boolean;
	disabled?: boolean;
}

function Label({ id, label, required }: { id: string; label: string; required?: boolean }) {
	return (
		<label for={id} class="pf-label">
			{label}
			{required && <span class="pf-required" aria-hidden="true"> *</span>}
		</label>
	);
}

export function TextField(props: Base & { value: string; onInput: (v: string) => void; placeholder?: string; list?: string; type?: 'text' | 'url' | 'date' | 'search' }) {
	const id = useId();
	return (
		<div class="pf-field">
			<Label id={id} label={props.label} required={props.required} />
			<input
				id={id}
				type={(props.type ?? 'text') as 'text'} // Preact's types only allow text-like types alongside `list`
				value={props.value}
				placeholder={props.placeholder}
				list={props.list}
				disabled={props.disabled}
				onInput={(e) => props.onInput(e.currentTarget.value)}
			/>
			{props.help && <p class="pf-help">{props.help}</p>}
		</div>
	);
}

export function TextArea(props: Base & { value: string; onInput: (v: string) => void; rows?: number; placeholder?: string }) {
	const id = useId();
	return (
		<div class="pf-field pf-wide">
			<Label id={id} label={props.label} required={props.required} />
			<textarea
				id={id}
				rows={props.rows ?? 4}
				value={props.value}
				placeholder={props.placeholder}
				disabled={props.disabled}
				onInput={(e) => props.onInput(e.currentTarget.value)}
			/>
			{props.help && <p class="pf-help">{props.help}</p>}
		</div>
	);
}

export function NumberField(props: Base & { value: number | undefined; onInput: (v: number) => void; min?: number }) {
	const id = useId();
	return (
		<div class="pf-field">
			<Label id={id} label={props.label} required={props.required} />
			<input
				id={id}
				type="number"
				inputMode="decimal"
				min={props.min}
				value={props.value ?? ''}
				disabled={props.disabled}
				onInput={(e) => props.onInput(Number(e.currentTarget.value) || 0)}
			/>
			{props.help && <p class="pf-help">{props.help}</p>}
		</div>
	);
}

export interface SelectOption {
	value: string;
	label?: string;
	disabled?: boolean;
	group?: string;
}

export function SelectField(props: Base & { value: string; onChange: (v: string) => void; options: SelectOption[]; placeholder?: string }) {
	const id = useId();
	const groups = [...new Set(props.options.map((o) => o.group ?? ''))];
	const render = (o: SelectOption) => (
		<option key={o.value} value={o.value} disabled={o.disabled}>
			{o.label ?? o.value}
		</option>
	);
	return (
		<div class="pf-field">
			<Label id={id} label={props.label} required={props.required} />
			<select id={id} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.currentTarget.value)}>
				<option value="">{props.placeholder ?? 'Choose…'}</option>
				{groups.length > 1
					? groups.map((g) => (
							<optgroup key={g} label={g}>
								{props.options.filter((o) => (o.group ?? '') === g).map(render)}
							</optgroup>
						))
					: props.options.map(render)}
			</select>
			{props.help && <p class="pf-help">{props.help}</p>}
		</div>
	);
}

export function CheckboxGroup(props: Base & { values: string[]; onChange: (v: string[]) => void; options: SelectOption[] }) {
	return (
		<fieldset class="pf-field pf-checks">
			<legend class="pf-label">
				{props.label}
				{props.required && <span class="pf-required" aria-hidden="true"> *</span>}
			</legend>
			{props.options.map((o) => (
				<label key={o.value} class="pf-check">
					<input
						type="checkbox"
						checked={props.values.includes(o.value)}
						disabled={props.disabled}
						onChange={(e) =>
							props.onChange(e.currentTarget.checked ? [...props.values, o.value] : props.values.filter((v) => v !== o.value))
						}
					/>
					{o.label ?? o.value}
				</label>
			))}
			{props.help && <p class="pf-help">{props.help}</p>}
		</fieldset>
	);
}

export function Section(props: { title: string; id: string; children: ComponentChildren; intro?: ComponentChildren; badge?: ComponentChildren }) {
	return (
		<section class="pf-section" id={props.id} aria-labelledby={`${props.id}-title`}>
			<header class="pf-section-head">
				<h2 id={`${props.id}-title`}>{props.title}</h2>
				{props.badge}
			</header>
			{props.intro && <p class="pf-intro">{props.intro}</p>}
			<div class="pf-grid">{props.children}</div>
		</section>
	);
}
