// The Equipment tab of My Stuff: the player's equipment requests and where each one stands.
import { useEffect, useState } from 'preact/hooks';
import type { CharacterSummary } from '../../lib/portal/api.ts';
import { EQUIPMENT_TYPES, STATUS_TEXT, loadMyEquipment, withdrawEquipment, type EquipmentRequest } from '../../lib/portal/equipment.ts';

const portal = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}portal/`;
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

function Request({ r, character, onChanged }: { r: EquipmentRequest; character: string; onChanged: () => void }) {
	const [confirm, setConfirm] = useState(false);
	const [error, setError] = useState('');
	const status = STATUS_TEXT[r.status];
	const open = r.status === 'pending' || r.status === 'needs_correction';
	return (
		<li class="me-item">
			<div class="me-head">
				<h3>{r.name}</h3>
				<span class={`dd-status tone-${status.tone}`}>{status.label}</span>
			</div>
			<p class="pf-help">
				{EQUIPMENT_TYPES.find((t) => t.id === r.type)?.label} for <strong>{character}</strong> · {r.status === 'pending' ? `sent ${when(r.submitted_at)}` : `updated ${when(r.updated_at)}`}
			</p>
			{r.status === 'approved' && <p class="me-note good">The recipe is on {character}. Gather the ingredients and craft it with the Ultron bot.</p>}
			{r.review_note && <p class={`me-note ${status.tone}`}>“{r.review_note}”</p>}
			{open && (
				<div class="me-actions">
					<a class={`pf-button${r.status === 'needs_correction' ? ' primary' : ''}`} href={`${portal}equipment/?id=${r.id}`}>
						{r.status === 'needs_correction' ? 'Fix and resend' : 'Edit'}
					</a>
					{confirm ? (
						<>
							<button
								type="button"
								class="pf-button danger"
								onClick={() =>
									withdrawEquipment(r.id).then(onChanged, (e) => {
										setError(messageOf(e));
										setConfirm(false);
									})
								}
							>
								Yes, withdraw
							</button>
							<button type="button" class="pf-button subtle" onClick={() => setConfirm(false)}>
								Keep it
							</button>
						</>
					) : (
						<button type="button" class="pf-button subtle" onClick={() => setConfirm(true)}>
							Withdraw
						</button>
					)}
				</div>
			)}
			{error && <p class="portal-error">{error}</p>}
		</li>
	);
}

export function MyEquipment({ characters }: { characters: CharacterSummary[] }) {
	const [list, setList] = useState<EquipmentRequest[] | null>(null);
	const [error, setError] = useState('');
	const load = () => loadMyEquipment().then(setList, (e) => setError(messageOf(e)));
	useEffect(() => {
		load();
	}, []);

	const canPitch = characters.some((c) => c.approved_at && c.status !== 'denied');
	const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? 'a character';

	if (error) return <p class="portal-error">Couldn’t load your equipment: {error}</p>;
	if (!list) return <p class="portal-status">Loading your equipment…</p>;
	return (
		<div class="me">
			<div class="me-top">
				<p class="pf-help">Pitch a custom item for an approved character and a Gamemaster writes its crafting recipe.</p>
				{canPitch && (
					<a class="pf-button primary" href={`${portal}equipment/`}>
						Pitch equipment
					</a>
				)}
			</div>
			{list.length === 0 ? (
				<div class="portal-card mc-empty">
					<h2>No equipment yet</h2>
					<p>{canPitch ? 'Your equipment requests and their recipes will show up here.' : 'Once one of your characters is approved, you can pitch equipment for it.'}</p>
				</div>
			) : (
				<ul class="me-list">
					{list.map((r) => (
						<Request key={r.id} r={r} character={nameOf(r.character_id)} onChanged={load} />
					))}
				</ul>
			)}
		</div>
	);
}
