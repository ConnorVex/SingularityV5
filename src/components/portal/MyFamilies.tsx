// The Families tab of My Stuff: the family you own, your characters' families, and your tryouts.
import { useEffect, useState } from 'preact/hooks';
import { loadMyFamilies, type MyFamilies as Data } from '../../lib/portal/home.ts';

const families = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}families/`;
const familyHref = (slug: string) => `${families}view/?f=${encodeURIComponent(slug)}`;
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

const FAMILY_STATUS = {
	pending: { label: 'In review', tone: 'info' },
	approved: { label: 'Approved', tone: 'good' },
	needs_correction: { label: 'Needs correction', tone: 'warn' },
	denied: { label: 'Denied', tone: 'bad' },
};
const TRYOUT_STATUS = {
	pending: { label: 'Waiting for the owner', tone: 'info' },
	accepted: { label: 'Accepted', tone: 'good' },
	declined: { label: 'Declined', tone: 'bad' },
};

export function MyFamilies() {
	const [data, setData] = useState<Data | null>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		loadMyFamilies().then(setData, (e) => setError(messageOf(e)));
	}, []);

	if (error) return <p class="portal-error">Couldn’t load your families: {error}</p>;
	if (!data) return <p class="portal-status">Loading your families…</p>;

	const f = data.family;
	const accepted = data.tryouts.filter((t) => t.status === 'accepted');
	return (
		<div class="dd-home mf">
			<section class="portal-card">
				<header class="dd-stuff-head">
					<h3>Your family</h3>
					<a href={families}>Directory</a>
				</header>
				{f ? (
					<div class="mf-owned">
						<div>
							<a class="mf-name" href={familyHref(f.slug)}>
								{f.name}
							</a>
							<p class="pf-help">
								<span class={`dd-status tone-${FAMILY_STATUS[f.status].tone}`}>{FAMILY_STATUS[f.status].label}</span>
								{f.joinRequests > 0 && ` · ${f.joinRequests} join request${f.joinRequests === 1 ? '' : 's'}`}
								{f.tryouts > 0 && ` · ${f.tryouts} tryout${f.tryouts === 1 ? '' : 's'} waiting`}
							</p>
						</div>
						<a class="pf-button primary" href={familyHref(f.slug)}>
							Manage family
						</a>
					</div>
				) : (
					<div class="mf-owned">
						<p class="pf-help">You don’t own a family. Each player can found one, and an admin reviews it.</p>
						<a class="pf-button primary" href={`${families}new/`}>
							Found a family
						</a>
					</div>
				)}
			</section>

			<section class="portal-card">
				<header class="dd-stuff-head">
					<h3>Your characters’ families</h3>
				</header>
				{data.memberships.length === 0 ? (
					<p class="pf-empty">
						None of your characters is in a family yet. Open a family’s page from the <a href={families}>directory</a> to ask to join, or pick families in the
						character form.
					</p>
				) : (
					<ul class="dd-rows">
						{data.memberships.map((m) => (
							<li key={`${m.familySlug}-${m.characterId}`}>
								<span>
									<strong>{m.characterName}</strong> in <a href={familyHref(m.familySlug)}>{m.familyName}</a>
								</span>
								<span class={`dd-status tone-${m.status === 'active' ? 'good' : 'info'}`}>{m.status === 'active' ? 'Member' : 'Asked to join'}</span>
							</li>
						))}
					</ul>
				)}
			</section>

			<section class="portal-card">
				<header class="dd-stuff-head">
					<h3>Your tryouts</h3>
				</header>
				{data.tryouts.length === 0 ? (
					<p class="pf-empty">No tryouts. Families that hold tryouts have a “Send a tryout” button on their page.</p>
				) : (
					<ul class="dd-rows">
						{data.tryouts.map((t) => (
							<li key={t.id}>
								<span>
									<strong>{t.characterName}</strong> for <a href={familyHref(t.familySlug)}>{t.familyName}</a>
									<span class="pf-help"> · sent {when(t.createdAt)}</span>
									{t.ownerNote && <span class="mf-note">“{t.ownerNote}”</span>}
								</span>
								<span class={`dd-status tone-${TRYOUT_STATUS[t.status].tone}`}>{TRYOUT_STATUS[t.status].label}</span>
							</li>
						))}
					</ul>
				)}
				{accepted.length > 0 && (
					<p class="pf-help mf-tip">
						Passed a tryout? Make the character in the <a href={`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}portal/submit/`}>character form</a> and use “Use this
						tryout” on its Families step.
					</p>
				)}
			</section>
		</div>
	);
}
