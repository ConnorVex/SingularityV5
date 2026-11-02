// Rows of crafting item + amount, used by the equipment form and the equipment review.
import { KIND_LABEL, type CraftingItem, type Ingredient } from '../../lib/portal/equipment.ts';

export function IngredientPicker(props: { label: string; help?: string; items: CraftingItem[]; value: Ingredient[]; onChange: (v: Ingredient[]) => void }) {
	const rows = props.value;
	const set = (i: number, patch: Partial<Ingredient>) => props.onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
	const kinds = Object.keys(KIND_LABEL) as CraftingItem['kind'][];
	return (
		<fieldset class="pf-field pf-wide ip">
			<legend class="pf-label">{props.label}</legend>
			{props.help && <p class="pf-help">{props.help}</p>}
			{rows.length > 0 && (
				<ul class="ip-rows">
					{rows.map((r, i) => (
						<li key={i} class="ip-row">
							<select aria-label={`Ingredient ${i + 1}`} value={r.item} onChange={(e) => set(i, { item: e.currentTarget.value })}>
								<option value="">Choose an item…</option>
								{kinds.map((k) => (
									<optgroup key={k} label={KIND_LABEL[k]}>
										{props.items
											.filter((it) => it.kind === k)
											.map((it) => (
												<option key={it.id} value={it.id} disabled={it.id !== r.item && rows.some((x) => x.item === it.id)}>
													{it.name}
													{it.rarity ? ` (${it.rarity})` : ''}
												</option>
											))}
									</optgroup>
								))}
							</select>
							<input
								type="number"
								inputMode="numeric"
								min={1}
								max={999}
								aria-label={`Amount of ingredient ${i + 1}`}
								value={r.qty}
								onInput={(e) => set(i, { qty: Math.max(1, Math.min(999, Math.round(Number(e.currentTarget.value) || 1))) })}
							/>
							<button type="button" class="pf-button subtle" aria-label={`Remove ingredient ${i + 1}`} onClick={() => props.onChange(rows.filter((_, n) => n !== i))}>
								✕
							</button>
						</li>
					))}
				</ul>
			)}
			<button type="button" class="pf-button" onClick={() => props.onChange([...rows, { item: '', qty: 1 }])}>
				+ Add an ingredient
			</button>
		</fieldset>
	);
}
