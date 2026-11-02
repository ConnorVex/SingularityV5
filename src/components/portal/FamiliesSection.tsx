// The Families step of the character form: pick families to join, or use an accepted tryout.
import { useState } from 'preact/hooks';
import { joinBlock, type FamilyChoices, type MyTryout } from '../../lib/portal/families.ts';
import { requestToJoin } from '../../lib/families/api.ts';
import { Section } from './fields.tsx';

const familyHref = (slug: string) => `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}families/view/?f=${encodeURIComponent(slug)}`;
const RECRUITING = { open: 'Recruiting', tryouts: 'Tryouts', closed: 'Closed' };

interface Props {
	choices: FamilyChoices | null;
	picked: string[];
	setPicked: (ids: string[]) => void;
	onUseTryout: (t: MyTryout) => void;
	/** Set for an approved character: it asks to join straight away instead of on approval. */
	approved: { id: string; name: string } | null;
	onJoined: () => void;
	readOnly: boolean;
}

export function FamiliesSection({ choices, picked, setPicked, onUseTryout, approved, onJoined, readOnly }: Props) {
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');

	const intro = approved
		? 'Ask to join a family. Its owner accepts or declines the request.'
		: 'Pick any families this character should join. When you send the character, the family’s owner or an admin reviews it.';

	if (!choices)
		return (
			<Section id="families" title="Families" intro={intro}>
				<p class="pf-wide portal-status">Loading families…</p>
			</Section>
		);

	const accepted = choices.tryouts.filter((t) => t.status === 'accepted' && choices.families.some((f) => f.id === t.family_id));
	const membership = (id: string) => choices.memberships.find((m) => m.family_id === id)?.status;

	async function join(familyId: string) {
		if (!approved) return;
		setBusy(familyId);
		setError('');
		try {
			await requestToJoin(familyId, approved, '');
			onJoined();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy('');
		}
	}

	return (
		<Section id="families" title="Families" intro={intro}>
			{!approved && accepted.length > 0 && (
				<div class="pf-wide fs-tryouts">
					<h3 class="pf-subhead">Your accepted tryouts</h3>
					{accepted.map((t) => {
						const family = choices.families.find((f) => f.id === t.family_id)!;
						return (
							<div class="fs-tryout" key={t.id}>
								<p>
									<strong>{t.character_name}</strong> passed the tryout for <strong>{family.name}</strong>.
								</p>
								{!readOnly && (
									<button type="button" class="pf-button" onClick={() => onUseTryout(t)}>
										Use this tryout
									</button>
								)}
							</div>
						);
					})}
					<p class="pf-help">Using a tryout picks its family and fills in any empty name, picture, personality and backstory from it.</p>
				</div>
			)}

			{choices.families.length === 0 ? (
				<p class="pf-wide pf-empty">There are no families to join yet.</p>
			) : (
				<ul class="pf-wide fs-grid">
					{choices.families.map((f) => {
						const member = membership(f.id);
						const block = member ? null : joinBlock(f, choices.tryouts);
						const isPicked = picked.includes(f.id);
						return (
							<li key={f.id} class={`fs-card${isPicked || member ? ' picked' : ''}${block ? ' blocked' : ''}`} style={/^#[0-9a-f]{6}$/i.test(f.colour) ? { '--fs-colour': f.colour } : undefined}>
								<div class="fs-head">
									<a href={familyHref(f.slug)} target="_blank" rel="noopener">
										{f.name}
									</a>
									<span class="fs-tag">{member === 'active' ? 'Member' : member === 'requested' ? 'Asked to join' : RECRUITING[f.recruiting]}</span>
								</div>
								{f.description && <p class="fs-text">{f.description}</p>}
								{block && <p class="pf-help">{block}</p>}
								{!member && !block && !readOnly && (
									approved ? (
										<button type="button" class="pf-button" disabled={busy === f.id} onClick={() => join(f.id)}>
											{busy === f.id ? 'Asking…' : 'Ask to join'}
										</button>
									) : (
										<label class="fs-pick">
											<input
												type="checkbox"
												checked={isPicked}
												onChange={(e) => setPicked(e.currentTarget.checked ? [...picked, f.id] : picked.filter((id) => id !== f.id))}
											/>
											Join {f.name}
										</label>
									)
								)}
							</li>
						);
					})}
				</ul>
			)}
			{error && <p class="pf-wide portal-error">{error}</p>}
		</Section>
	);
}
