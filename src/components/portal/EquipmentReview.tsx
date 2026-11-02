// The Equipment tab of the review inbox: each pitch next to the recipe the admin writes for it.
// Approving creates a crafting recipe only that character can use.
import { useState } from 'preact/hooks';
import type { PlayerSummary } from '../../lib/portal/api.ts';
import {
	EQUIPMENT_TYPES,
	RARITIES,
	REQUIREMENTS,
	STATUS_TEXT,
	reviewEquipment,
	type CraftingItem,
	type EquipmentQueueItem,
	type RecipeSpec,
} from '../../lib/portal/equipment.ts';
import { NumberField, SelectField, TextArea, TextField } from './fields.tsx';
import { IngredientPicker } from './IngredientPicker.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

function Card({ r, items, player, onDone }: { r: EquipmentQueueItem; items: CraftingItem[]; player?: PlayerSummary; onDone: () => void }) {
	const [recipe, setRecipe] = useState<RecipeSpec>(() => ({
		name: r.name,
		description: r.description,
		rarity: '',
		requirement: '',
		craft_minutes: 60,
		effects: r.effects,
		ingredients: r.ingredients,
	}));
	const [note, setNote] = useState('');
	const [confirm, setConfirm] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const edit = (patch: Partial<RecipeSpec>) => setRecipe((x) => ({ ...x, ...patch }));
	const status = STATUS_TEXT[r.status];
	const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? 'Unknown item';
	const links = r.images.split(/\s+/).filter((l) => /^https:\/\//.test(l));

	async function decide(outcome: 'approved' | 'needs_correction' | 'denied') {
		if (outcome === 'denied' && !confirm) return setConfirm(true);
		if (outcome === 'approved') {
			if (!recipe.name.trim()) return setError('Give the recipe a name.');
			if (!recipe.ingredients.some((i) => i.item)) return setError('A recipe needs at least one ingredient.');
			if (recipe.craft_minutes < 5 || recipe.craft_minutes > 10080) return setError('Crafting time must be between 5 minutes and 7 days (10080 minutes).');
		}
		setBusy(true);
		setError('');
		try {
			await reviewEquipment(r.id, outcome, note, outcome === 'approved' ? recipe : null);
			onDone();
		} catch (e) {
			setError(messageOf(e));
			setBusy(false);
			setConfirm(false);
		}
	}

	return (
		<li class="eqr-card">
			<div class="me-head">
				<h3>{r.name}</h3>
				<span class={`dd-status tone-${status.tone}`}>{status.label}</span>
			</div>
			<p class="pf-help">
				{EQUIPMENT_TYPES.find((t) => t.id === r.type)?.label} for <strong>{r.characterName}</strong>
				{r.intelligence ? ` (${r.intelligence} Intelligence)` : ''} · by {player?.display_name ?? 'unknown player'} · sent{' '}
				{new Date(r.submitted_at).toLocaleDateString()}
			</p>

			<div class="eqr-pitch">
				{r.description && (
					<>
						<span class="pf-label">What it looks like</span>
						<p>{r.description}</p>
					</>
				)}
				<span class="pf-label">What it does</span>
				<p>{r.effects}</p>
				{r.ingredients.length > 0 && (
					<>
						<span class="pf-label">Suggested ingredients</span>
						<p>{r.ingredients.map((i) => `${i.qty} × ${itemName(i.item)}`).join(', ')}</p>
					</>
				)}
				{links.length > 0 && (
					<p>
						{links.map((l, i) => (
							<a key={l} href={l} target="_blank" rel="noreferrer noopener">
								{i === 0 ? 'Reference ↗' : ` · reference ${i + 1} ↗`}
							</a>
						))}
					</p>
				)}
			</div>

			<div class="eqr-recipe">
				<h4>The recipe</h4>
				<p class="pf-help">Approving makes this item and a recipe that only {r.characterName} can craft. The item itself can be traded once made.</p>
				<div class="pf-grid">
					<TextField label="Item name" required value={recipe.name} onInput={(v) => edit({ name: v })} />
					<SelectField label="Rarity" value={recipe.rarity} placeholder="No rarity" onChange={(v) => edit({ rarity: v as RecipeSpec['rarity'] })} options={RARITIES.map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))} />
					<SelectField
						label="Intelligence needed"
						value={recipe.requirement}
						placeholder="No requirement"
						onChange={(v) => edit({ requirement: v as RecipeSpec['requirement'] })}
						options={REQUIREMENTS.filter((x) => x.id).map((x) => ({ value: x.id, label: x.label }))}
					/>
					<NumberField label="Crafting time (minutes)" required min={5} value={recipe.craft_minutes} onInput={(v) => edit({ craft_minutes: Math.round(v) })} help="5 minutes to 7 days (10080)." />
					<TextArea label="Description" rows={2} value={recipe.description} onInput={(v) => edit({ description: v })} help="Shown on the item. Up to 1000 characters." />
					<TextArea label="Effects" rows={4} value={recipe.effects} onInput={(v) => edit({ effects: v })} help="What the item does, as players will see it on the recipe." />
					<IngredientPicker label="Ingredients" items={items} value={recipe.ingredients} onChange={(v) => edit({ ingredients: v })} />
					<TextArea label="Note to the player" rows={2} value={note} onInput={(v) => setNote(v)} placeholder="What to fix, or what you changed." />
				</div>
			</div>

			{confirm && (
				<p class="roll-note bad" role="alert">
					Denying is final: the player would have to pitch it again. Click Deny again to confirm.
				</p>
			)}
			{error && <p class="portal-error">{error}</p>}
			<div class="eqr-buttons">
				<button type="button" class="pf-button" disabled={busy || r.status === 'needs_correction'} onClick={() => decide('needs_correction')}>
					Send back
				</button>
				<button type="button" class="pf-button danger" disabled={busy} onClick={() => decide('denied')}>
					{confirm ? 'Yes, deny' : 'Deny'}
				</button>
				<button type="button" class="pf-button primary" disabled={busy} onClick={() => decide('approved')}>
					Approve with this recipe
				</button>
			</div>
		</li>
	);
}

export function EquipmentReview(props: { requests: EquipmentQueueItem[]; items: CraftingItem[]; players: Map<string, PlayerSummary>; onDone: () => void }) {
	if (props.requests.length === 0) return <p class="pf-empty">No equipment waiting. 🎉</p>;
	return (
		<ul class="eqr">
			{props.requests.map((r) => (
				<Card key={`${r.id}-${r.updated_at}`} r={r} items={props.items} player={props.players.get(r.owner_id)} onDone={props.onDone} />
			))}
		</ul>
	);
}
