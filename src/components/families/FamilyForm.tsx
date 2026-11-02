// The family's own details: used when founding a family and on the owner's "Page" tab.
import { SelectField, TextArea, TextField } from '../portal/fields.tsx';
import { FOUND_IN, RECRUITING, type FamilyFields } from '../../lib/families/api.ts';

export const emptyFamily = (): FamilyFields => ({
	name: '',
	head_name: '',
	description: '',
	lore: '',
	race: '',
	specialty: '',
	found_in: 'mainland',
	banner_url: '',
	colour: '#20e0a0',
	recruiting: 'closed',
	home: '',
});

/** Problems that stop the form from saving. */
export function familyProblems(f: FamilyFields): string[] {
	const out: string[] = [];
	if (!f.name.trim()) out.push('Give your family a name.');
	if (!f.head_name.trim()) out.push('Name the Head of Family.');
	if (!f.description.trim()) out.push('Write a short description.');
	if (!f.lore.trim()) out.push('Write some lore.');
	if (f.banner_url && !/^https:\/\//.test(f.banner_url)) out.push('The banner link must start with https://');
	if (!/^#[0-9a-f]{6}$/i.test(f.colour)) out.push('Pick a colour.');
	return out;
}

export function FamilyForm({ value, onChange, nameLocked }: { value: FamilyFields; onChange: (v: FamilyFields) => void; nameLocked?: boolean }) {
	const set = <K extends keyof FamilyFields>(key: K, v: FamilyFields[K]) => onChange({ ...value, [key]: v });
	return (
		<>
			<TextField
				label="Family name"
				required
				value={value.name}
				onInput={(v) => set('name', v)}
				disabled={nameLocked}
				help={nameLocked ? 'Ask an admin to rename an approved family.' : undefined}
			/>
			<TextField label="Head of Family" required value={value.head_name} onInput={(v) => set('head_name', v)} help="The character who leads the family." />
			<TextField label="Race" value={value.race} onInput={(v) => set('race', v)} placeholder="e.g. Yokai" />
			<TextField label="Specialty" value={value.specialty} onInput={(v) => set('specialty', v)} placeholder="e.g. Sorcery, Heroism" />
			<SelectField
				label="Found in"
				value={value.found_in}
				onChange={(v) => set('found_in', (v || 'mainland') as FamilyFields['found_in'])}
				options={Object.entries(FOUND_IN).map(([v, label]) => ({ value: v, label }))}
			/>
			<SelectField
				label="Recruiting"
				value={value.recruiting}
				onChange={(v) => set('recruiting', (v || 'closed') as FamilyFields['recruiting'])}
				options={Object.entries(RECRUITING).map(([v, label]) => ({ value: v, label }))}
				help="Recruiting: players ask to join. Tryouts: players send a tryout for you to review."
			/>
			<div class="pf-field">
				<label class="pf-label" for="fm-colour">
					Colour
				</label>
				<div class="fm-colour">
					<input id="fm-colour" type="color" value={value.colour} onInput={(e) => set('colour', e.currentTarget.value)} />
					<code>{value.colour}</code>
				</div>
				<p class="pf-help">Tints the family's page and card.</p>
			</div>
			<TextField label="Banner image link" type="url" value={value.banner_url} onInput={(v) => set('banner_url', v.trim())} placeholder="https://…" help="A wide image. Paste a link (Discord, Imgur…); nothing is uploaded." />
			<TextArea label="Description" required rows={3} value={value.description} onInput={(v) => set('description', v)} help="One or two sentences for the directory card." />
			<TextArea label="Lore" required rows={8} value={value.lore} onInput={(v) => set('lore', v)} help="Blank lines start new paragraphs. **bold** and *italic* work." />
			<TextArea label="Home" rows={4} value={value.home} onInput={(v) => set('home', v)} help="Where the family lives. Optional." />
			{value.banner_url && /^https:\/\//.test(value.banner_url) && (
				<div class="pf-field pf-wide">
					<span class="pf-label">Banner preview</span>
					<img class="pf-preview" src={value.banner_url} alt="" />
				</div>
			)}
		</>
	);
}
