// Found a family: the application the admins review. A player can own one family.
import { useEffect, useState } from 'preact/hooks';
import { createFamily, familiesBase, familyHref, loadMyFamily, type Family, type FamilyFields } from '../../lib/families/api.ts';
import { portalConfigured, watchPlayer, type Player } from '../../lib/supabase.ts';
import { FamilyForm, emptyFamily, familyProblems } from './FamilyForm.tsx';
import { LoginCard, StatusBanner, messageOf, useFamilyTheme } from './shared.tsx';

export default function FoundFamily() {
	const [player, setPlayer] = useState<Player | null | undefined>(undefined);
	const [mine, setMine] = useState<Family | null | undefined>(undefined);
	const [form, setForm] = useState<FamilyFields>(emptyFamily);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	useFamilyTheme(form.colour);
	useEffect(() => {
		if (!portalConfigured) return setError('The portal is not connected to its database yet.');
		watchPlayer((p, e) => (e ? setError(messageOf(e)) : setPlayer(p)));
	}, []);
	useEffect(() => {
		if (player) loadMyFamily().then(setMine, (e) => setError(messageOf(e)));
	}, [player?.id]);

	if (error && player === undefined) return <p class="portal-error">{error}</p>;
	if (player === undefined) return <p class="portal-status">Checking your login…</p>;
	if (player === null) return <LoginCard text="Log in with Discord to found a family." onError={setError} />;
	if (mine === undefined) return <p class="portal-status">Loading…</p>;

	if (mine)
		return (
			<div class="pf fm">
				<div class="portal-card">
					<h2>You already run a family</h2>
					<p>
						Each player can own one family. Yours is <strong>{mine.name}</strong>.
					</p>
					<StatusBanner status={mine.status} note={mine.review_note} />
					<a class="pf-button primary" href={`${familyHref(mine.slug)}#edit`}>
						Manage {mine.name}
					</a>
				</div>
			</div>
		);

	const problems = familyProblems(form);
	return (
		<div class="pf fm">
			<section class="pf-section">
				<header class="pf-section-head">
					<h2>Your family</h2>
				</header>
				<p class="pf-intro">
					Every new family is reviewed by the admins before it appears in the directory. After that you can add divisions, members, relations and perks from your family's page. See{' '}
					<a href={`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}rp-systems/families/founding-a-family/`}>Founding a Family</a> for the rules.
				</p>
				<div class="pf-grid">
					<FamilyForm value={form} onChange={setForm} />
				</div>
			</section>
			<div class="pf-actions">
				<span class={`pf-save-state${error ? ' error' : ''}`}>{error || problems[0] || 'Ready to send'}</span>
				<a class="pf-button subtle" href={familiesBase}>
					Cancel
				</a>
				<button
					type="button"
					class="pf-button primary"
					disabled={busy || problems.length > 0}
					onClick={async () => {
						setBusy(true);
						setError('');
						try {
							const created = await createFamily({ ...form, name: form.name.trim(), head_name: form.head_name.trim() });
							location.href = familyHref(created.slug);
						} catch (e) {
							setError(messageOf(e).includes('families_one_per_owner') ? 'You already run a family.' : messageOf(e));
							setBusy(false);
						}
					}}
				>
					Send for review
				</button>
			</div>
		</div>
	);
}
