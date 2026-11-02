// Evolving an approved character: see what changed on the sheet, describe how it was earned, and send.
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
	discoverCombos,
	loadCharacter,
	loadClaimBoard,
	loadEvolutions,
	loadHeldClaims,
	submitEvolution,
	type CharacterDraft,
	type EvolutionRequest,
} from '../../lib/portal/api.ts';
import { characterIssues, type CheckData } from '../../lib/portal/checks.ts';
import { loadFamilyChoices } from '../../lib/portal/families.ts';
import { hasBlockingIssues, rules } from '../../lib/portal/rules.ts';
import { applyTheme, defaultTheme, themeForRole } from '../../lib/portal/theme.ts';
import { logIn, watchPlayer, type Player } from '../../lib/supabase.ts';
import { ChangeList, changeCount } from './ChangeList.tsx';
import { TextArea } from './fields.tsx';
import { EvolutionLog } from './EvolutionLog.tsx';

const portal = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}portal/`;
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

interface WriteUp {
	summary: string;
	earned: string;
	links: string;
}
const blank: WriteUp = { summary: '', earned: '', links: '' };

// The write-up is kept in this browser until it's sent, so nothing is lost on a reload.
const storeKey = (id: string) => `dd-evolution-${id}`;
function readStored(id: string): WriteUp | null {
	try {
		const raw = localStorage.getItem(storeKey(id));
		return raw ? { ...blank, ...JSON.parse(raw) } : null;
	} catch {
		return null;
	}
}
function writeStored(id: string, w: WriteUp | null) {
	try {
		if (w) localStorage.setItem(storeKey(id), JSON.stringify(w));
		else localStorage.removeItem(storeKey(id));
	} catch {
		/* private mode or blocked storage: the write-up just isn't remembered */
	}
}

export default function EvolvePage() {
	const id = new URLSearchParams(location.search).get('id');
	const [player, setPlayer] = useState<Player | null | undefined>(undefined);
	const [c, setC] = useState<CharacterDraft | null>(null);
	const [checks, setChecks] = useState<CheckData | null>(null);
	const [open, setOpen] = useState<EvolutionRequest | null>(null);
	const [writeUp, setWriteUp] = useState<WriteUp>(blank);
	const [error, setError] = useState('');
	const [sendError, setSendError] = useState('');
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState(false);

	useEffect(() => watchPlayer((p, e) => (e ? setError(messageOf(e)) : setPlayer(p))), []);
	useEffect(() => {
		if (!player || !id) return;
		(async () => {
			const character = await loadCharacter(id);
			setC(character);
			applyTheme(character.kind === 'oc' && character.sheet.role ? themeForRole(character.sheet.role) : defaultTheme);
			const [evolutions, board, held, combos, families] = await Promise.all([
				loadEvolutions([id]).catch(() => []),
				loadClaimBoard(),
				loadHeldClaims(id),
				discoverCombos(id).catch(() => []),
				loadFamilyChoices(id).catch(() => null),
			]);
			const current = evolutions.find((r) => r.status === 'pending' || r.status === 'needs_correction') ?? null;
			setOpen(current);
			setWriteUp(readStored(id) ?? (current ? { summary: current.summary, earned: current.earned, links: current.links } : blank));
			setChecks({ board, held, combos, familyIds: families?.memberships.map((m) => m.family_id) ?? [] });
		})().catch((e) => setError(messageOf(e)));
	}, [player?.id, id]);

	const edit = (patch: Partial<WriteUp>) =>
		setWriteUp((w) => {
			const next = { ...w, ...patch };
			if (id) writeStored(id, next);
			return next;
		});

	const issues = useMemo(() => (c && checks ? characterIssues(c, checks) : []), [c, checks]);
	const changes = useMemo(() => (c?.approvedSheet ? changeCount(c.approvedSheet, c.sheet) : 0), [c]);

	async function send() {
		if (!c?.id) return;
		if (!writeUp.summary.trim()) return setSendError('Describe what evolved before sending.');
		if (hasBlockingIssues(issues)) return setSendError('Fix the problems in the checks first.');
		setSending(true);
		setSendError('');
		try {
			await submitEvolution(c.id, writeUp.summary.trim(), writeUp.earned.trim(), writeUp.links.trim());
			writeStored(c.id, null);
			setSent(true);
		} catch (e) {
			setSendError(messageOf(e));
		} finally {
			setSending(false);
		}
	}

	if (error) return <p class="portal-error">Couldn’t load this character: {error}</p>;
	if (player === undefined) return <p class="portal-status">Checking your login…</p>;
	if (player === null)
		return (
			<div class="portal-card">
				<p>Log in with Discord to evolve your character.</p>
				<button type="button" class="portal-button discord" onClick={() => logIn().catch((e) => setError(messageOf(e)))}>
					Log in with Discord
				</button>
			</div>
		);
	if (!id)
		return (
			<div class="portal-card">
				<p>Pick the character to evolve from your home page or My Stuff.</p>
				<a class="pf-button primary" href={portal}>
					Go to the Divine Database
				</a>
			</div>
		);
	if (!c) return <p class="portal-status">Loading your character…</p>;
	if (!c.approvedAt || c.status === 'denied')
		return (
			<div class="portal-card">
				<p>
					Only approved characters can evolve. <strong>{c.name}</strong> hasn’t been approved yet.
				</p>
				<a class="pf-button primary" href={`${portal}submit/?id=${c.id}`}>
					Open the character
				</a>
			</div>
		);

	const formHref = `${portal}submit/?id=${c.id}`;
	if (sent)
		return (
			<div class="portal-card pf-done">
				<h2>Evolution sent for review! 🧬</h2>
				<p>
					<strong>{c.name}</strong>’s evolution is waiting for an admin. You’ll get a ping in the announcements channel when it’s been reviewed. The approved
					version stays public until then.
				</p>
				<p>
					<a class="pf-button primary" href={portal}>
						Back home
					</a>{' '}
					<a class="pf-button" href={location.href} onClick={() => setSent(false)}>
						Back to the evolution
					</a>
				</p>
			</div>
		);

	const errors = issues.filter((i) => i.level === 'error');
	const others = issues.filter((i) => i.level !== 'error');
	const reviewing = open?.status === 'pending' || c.status === 'pending';
	const role = rules.roles.find((r) => r.id === c.sheet.role)?.label;
	const image = /^https:\/\//.test(c.sheet.appearance.image) ? c.sheet.appearance.image : null;

	return (
		<div class="pf ev">
			<header class="ev-head">
				{image ? <img src={image} alt="" /> : <span class="ev-initial">{c.name.slice(0, 1).toUpperCase()}</span>}
				<div>
					<h2>{c.name}</h2>
					<p class="pf-help">
						{c.kind === 'oc' ? `Original character${role ? ` · ${role}` : ''}` : 'Canon character'} · approved {when(c.approvedAt)} ·{' '}
						{c.sheet.evolutions.length} evolution{c.sheet.evolutions.length === 1 ? '' : 's'}
					</p>
				</div>
			</header>

			{open?.status === 'needs_correction' && (
				<div class="pf-status status-needs_correction">
					<strong>Sent back</strong> · {open.review_note || 'An admin asked for changes. Open a ticket if you’re not sure what to fix.'}
				</div>
			)}
			{reviewing && (
				<div class="pf-status status-pending">
					<strong>In review</strong> · You can still change the sheet and the write-up; press Update evolution to send the changes.
				</div>
			)}

			<section class="pf-section ev-step">
				<header class="pf-section-head">
					<span class="ev-num">1</span>
					<h2>Update the sheet</h2>
					<a class="pf-button" href={formHref}>
						{changes ? 'Keep editing' : 'Edit the sheet'}
					</a>
				</header>
				<p class="pf-intro">
					Make the changes in the character form: new skills, stats, systems, traits. They save as you go, and the approved version stays public until the
					evolution is approved.
				</p>
				{c.approvedSheet && (
					<div class="ev-changes">
						<h3 class="pf-subhead">
							What changed since approval <span class="cl-count">{changes}</span>
						</h3>
						<ChangeList before={c.approvedSheet} after={c.sheet} />
					</div>
				)}
			</section>

			<section class="pf-section ev-step">
				<header class="pf-section-head">
					<span class="ev-num">2</span>
					<h2>Describe the evolution</h2>
				</header>
				<div class="pf-grid">
					<TextArea
						label="What evolved"
						required
						rows={4}
						value={writeUp.summary}
						onInput={(v) => edit({ summary: v })}
						help="In your own words: what’s new or stronger, and why it matters for the character."
					/>
					<TextArea
						label="How it was earned"
						rows={3}
						value={writeUp.earned}
						onInput={(v) => edit({ earned: v })}
						help="The fight, training, event or reward that earned it."
					/>
					<TextArea
						label="Proof (one link per line)"
						rows={2}
						value={writeUp.links}
						placeholder="https://discord.com/channels/…"
						onInput={(v) => edit({ links: v })}
					/>
				</div>
			</section>

			<section class="pf-section ev-step">
				<header class="pf-section-head">
					<span class="ev-num">3</span>
					<h2>Check and send</h2>
				</header>
				{!checks ? (
					<p class="portal-status">Checking the sheet…</p>
				) : issues.length === 0 ? (
					<p class="pf-ok">✅ The sheet checks out.</p>
				) : (
					<>
						{errors.length > 0 && (
							<div class="pf-issue-group error">
								<h3>⛔ Fix before sending ({errors.length})</h3>
								<ul>
									{errors.map((i, n) => (
										<li key={n}>
											<span class="pf-issue-section">{i.section}</span> {i.message}
										</li>
									))}
								</ul>
							</div>
						)}
						{others.length > 0 && (
							<div class="pf-issue-group warning">
								<h3>⚠️ For the reviewer ({others.length})</h3>
								<ul>
									{others.map((i, n) => (
										<li key={n}>
											<span class="pf-issue-section">{i.section}</span> {i.message}
										</li>
									))}
								</ul>
							</div>
						)}
					</>
				)}
				{changes === 0 && <p class="pf-help">You haven’t changed the sheet yet. You can still send a write-up on its own.</p>}
				{sendError && <p class="portal-error">{sendError}</p>}
				<div class="ev-send">
					<button type="button" class="pf-button primary" disabled={sending || !checks} onClick={send}>
						{sending ? 'Sending…' : reviewing ? 'Update evolution' : 'Send evolution for review'}
					</button>
				</div>
			</section>

			<section class="pf-section">
				<EvolutionLog entries={c.sheet.evolutions} />
			</section>
		</div>
	);
}
