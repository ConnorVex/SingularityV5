// Pitching a custom piece of equipment for an approved character. ?id=… edits a request that is
// still open; ?character=… picks the character up front.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { loadMyCharacters, type CharacterSummary } from '../../lib/portal/api.ts';
import {
	EQUIPMENT_TYPES,
	STATUS_TEXT,
	loadCraftingItems,
	loadEquipment,
	submitEquipment,
	type CraftingItem,
	type EquipmentDraft,
	type EquipmentRequest,
} from '../../lib/portal/equipment.ts';
import { startPortalTheme } from '../../lib/portal/theme.ts';
import { logIn, watchPlayer, type Player } from '../../lib/supabase.ts';
import { SelectField, TextArea, TextField } from './fields.tsx';
import { IngredientPicker } from './IngredientPicker.tsx';

const portal = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}portal/`;
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

const blank = (characterId = ''): EquipmentDraft => ({ characterId, name: '', type: 'weapon', description: '', effects: '', images: '', ingredients: [] });
const toDraft = (r: EquipmentRequest): EquipmentDraft => ({
	id: r.id,
	characterId: r.character_id,
	name: r.name,
	type: r.type,
	description: r.description,
	effects: r.effects,
	images: r.images,
	ingredients: r.ingredients,
});

export default function EquipmentForm() {
	const params = new URLSearchParams(location.search);
	const editId = params.get('id');
	const [player, setPlayer] = useState<Player | null | undefined>(undefined);
	const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
	const [items, setItems] = useState<CraftingItem[]>([]);
	const [existing, setExisting] = useState<EquipmentRequest | null>(null);
	const [d, setD] = useState<EquipmentDraft>(() => blank(params.get('character') ?? ''));
	const [error, setError] = useState('');
	const [sendError, setSendError] = useState('');
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState<EquipmentRequest | null>(null);

	useEffect(() => startPortalTheme(), []);
	useEffect(() => watchPlayer((p, e) => (e ? setError(messageOf(e)) : setPlayer(p))), []);
	useEffect(() => {
		if (!player) return;
		Promise.all([loadMyCharacters(), loadCraftingItems(), editId ? loadEquipment(editId) : Promise.resolve(null)]).then(([c, i, r]) => {
			setCharacters(c);
			setItems(i);
			if (r) {
				setExisting(r);
				setD(toDraft(r));
			}
		}, (e) => setError(messageOf(e)));
	}, [player?.id]);

	const approved = useMemo(() => (characters ?? []).filter((c) => c.approved_at && c.status !== 'denied'), [characters]);
	const edit = (patch: Partial<EquipmentDraft>) => setD((x) => ({ ...x, ...patch }));
	const locked = existing && (existing.status === 'approved' || existing.status === 'denied');

	async function send() {
		const missing = [!d.characterId && 'a character', !d.name.trim() && 'a name', !d.effects.trim() && 'what it does'].filter(Boolean);
		if (missing.length) return setSendError(`Add ${missing.join(', ')} before sending.`);
		setSending(true);
		setSendError('');
		try {
			setSent(await submitEquipment(d));
		} catch (e) {
			setSendError(messageOf(e));
		} finally {
			setSending(false);
		}
	}

	if (error) return <p class="portal-error">{error}</p>;
	if (player === undefined) return <p class="portal-status">Checking your login…</p>;
	if (player === null)
		return (
			<div class="portal-card">
				<p>Log in with Discord to pitch equipment for your character.</p>
				<button type="button" class="portal-button discord" onClick={() => logIn().catch((e) => setError(messageOf(e)))}>
					Log in with Discord
				</button>
			</div>
		);
	if (!characters) return <p class="portal-status">Loading…</p>;
	if (approved.length === 0)
		return (
			<div class="portal-card">
				<p>Equipment is made for an approved character. Once one of your characters is approved, you can pitch equipment for it here.</p>
				<a class="pf-button primary" href={`${portal}submit/`}>
					Make a character
				</a>
			</div>
		);
	if (sent)
		return (
			<div class="portal-card pf-done">
				<h2>Equipment sent for review! 🛠️</h2>
				<p>
					A Gamemaster will look at <strong>{sent.name}</strong> and write its crafting recipe. You’ll get a ping in the announcements channel when it’s been
					reviewed.
				</p>
				<p>
					<a class="pf-button primary" href={`${portal}characters/?tab=equipment`}>
						See my equipment
					</a>{' '}
					<a class="pf-button" href={`${portal}equipment/`}>
						Pitch another
					</a>
				</p>
			</div>
		);
	if (locked)
		return (
			<div class="portal-card">
				<p>
					<strong>{existing!.name}</strong> has been {STATUS_TEXT[existing!.status].label.toLowerCase()} and can’t be changed any more.
				</p>
				<a class="pf-button primary" href={`${portal}characters/?tab=equipment`}>
					Back to my equipment
				</a>
			</div>
		);

	return (
		<div class="pf eq">
			{existing?.status === 'needs_correction' && (
				<div class="pf-status status-needs_correction">
					<strong>Sent back</strong> · {existing.review_note || 'A Gamemaster asked for changes. Open a ticket if you’re not sure what to fix.'}
				</div>
			)}
			{existing?.status === 'pending' && (
				<div class="pf-status status-pending">
					<strong>In review</strong> · You can still change it; press Update to save the changes.
				</div>
			)}

			<section class="pf-section">
				<header class="pf-section-head">
					<h2>The equipment</h2>
				</header>
				<p class="pf-intro">
					Describe the item you want and what it should do. A Gamemaster turns it into a crafting recipe that only this character can use. You still gather the
					ingredients and craft it yourself; the finished item can be traded like any other.{' '}
					<a href={`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}rp-systems/crafting/overview/`}>How crafting works</a>
				</p>
				<div class="pf-grid">
					<SelectField
						label="For which character"
						required
						value={d.characterId}
						onChange={(v) => edit({ characterId: v })}
						options={approved.map((c) => ({ value: c.id, label: c.name }))}
					/>
					<SelectField label="Type" required value={d.type} onChange={(v) => edit({ type: (v || 'other') as EquipmentDraft['type'] })} options={EQUIPMENT_TYPES.map((t) => ({ value: t.id, label: t.label }))} />
					<TextField label="Name" required value={d.name} onInput={(v) => edit({ name: v })} placeholder="e.g. Ember-Forged Gauntlets" />
					<TextArea label="What it looks like" rows={3} value={d.description} onInput={(v) => edit({ description: v })} help="A short description of the item, shown on it once it’s made." />
					<TextArea
						label="What it does"
						required
						rows={5}
						value={d.effects}
						onInput={(v) => edit({ effects: v })}
						help="Its abilities, limits and drawbacks. The Gamemaster may balance it before approving."
					/>
					<TextArea label="Reference pictures (one link per line)" rows={2} value={d.images} onInput={(v) => edit({ images: v })} placeholder="https://…" />
				</div>
			</section>

			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Suggested ingredients</h2>
				</header>
				<div class="pf-grid">
					<IngredientPicker
						label="Ingredients (optional)"
						help="Pick the crafting items you think it should take. The Gamemaster decides the final recipe."
						items={items}
						value={d.ingredients}
						onChange={(v) => edit({ ingredients: v })}
					/>
				</div>
			</section>

			{sendError && <p class="portal-error">{sendError}</p>}
			<div class="ev-send">
				<a class="pf-button" href={`${portal}characters/?tab=equipment`}>
					Cancel
				</a>
				<button type="button" class="pf-button primary" disabled={sending} onClick={send}>
					{sending ? 'Sending…' : existing ? 'Update' : 'Send for review'}
				</button>
			</div>
		</div>
	);
}
