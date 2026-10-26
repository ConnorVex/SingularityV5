// Admin "Override" panel: a player's rolls and history, override codes, rolling locks,
// and setting a roll by hand. The database checks admin rights on every action.
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
	adminSetRoll,
	adminVoidRoll,
	createOverrideCode,
	listPlayers,
	loadPlayerRolls,
	setRollLock,
	type PlayerRollInfo,
	type PlayerSummary,
	type RollKind,
	type RollRow,
} from '../../lib/portal/api.ts';
import { rules } from '../../lib/portal/rules.ts';
import { startPortalTheme } from '../../lib/portal/theme.ts';
import { logIn, watchPlayer, type Player } from '../../lib/supabase.ts';
import { Section, SelectField, TextField } from './fields.tsx';

const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const potentialLabel = (grade?: string) => rules.potentials.find((p) => p.id === grade)?.label ?? grade ?? '?';
const { note: _note, ...ceLevels } = rules.cursedEnergyLevels;

function describe(row: Pick<RollRow, 'kind' | 'result'>) {
	const r = row.result;
	if (row.kind === 'potential') return `${potentialLabel(r.grade)}${r.roll ? ` (rolled ${r.roll}/500)` : ' (set by admin)'}`;
	return `${r.class} · ${r.level} · ${r.cep} CEP${r.classRoll ? ` (rolled ${r.classRoll}/1260, ${r.amountRoll})` : ' (set by admin)'}`;
}

const EVENT_TEXT: Record<string, string> = {
	rolled: 'Rolled',
	moved: 'Carried a roll to another character',
	consumed: 'Roll settled by an approval',
	override_created: 'Override code created',
	override_used: 'Used an override code',
	override_failed: 'Wrong override code entered',
	locked: 'Rolling locked',
	unlocked: 'Rolling unlocked',
	admin_set: 'Roll set by an admin',
	admin_voided: 'Unsettled roll cleared by an admin',
};

function PlayerDetail({ player }: { player: PlayerSummary }) {
	const [info, setInfo] = useState<PlayerRollInfo | null>(null);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [hours, setHours] = useState('2');
	const [code, setCode] = useState<{ code: string; expires: string } | null>(null);
	const [copied, setCopied] = useState(false);
	const [reason, setReason] = useState('');
	const [setKind, setSetKind] = useState<RollKind>('potential');
	const [setValue, setSetValue] = useState('');
	const [setChar, setSetChar] = useState('');

	const reload = () => loadPlayerRolls(player.id).then(setInfo, (e) => setError(messageOf(e)));
	useEffect(() => {
		setInfo(null);
		setCode(null);
		setError('');
		reload();
	}, [player.id]);

	async function act(fn: () => Promise<unknown>) {
		setBusy(true);
		setError('');
		try {
			await fn();
			await reload();
		} catch (e) {
			setError(messageOf(e));
		} finally {
			setBusy(false);
		}
	}

	const charName = (id: string | null) => info?.characters.find((c) => c.id === id)?.name ?? (id ? 'deleted character' : 'no character');
	const active = info?.rolls.filter((r) => r.status === 'active') ?? [];

	return (
		<div class="ov-detail">
			<header class="ov-player">
				{player.avatar_url && <img src={player.avatar_url} alt="" width={48} height={48} />}
				<div>
					<strong>{player.display_name}</strong>
					<span class="pf-help">Discord ID {player.discord_id}</span>
				</div>
				{info?.lock && <span class="pf-badge bad">Rolling locked</span>}
			</header>
			{error && <p class="portal-error">{error}</p>}
			{!info ? (
				<p class="portal-status">Loading…</p>
			) : (
				<div class="pf-grid">
					<div class="hud-panel">
						<h3 class="hud-panel-title">Override code</h3>
						<p class="pf-help">Lets this player roll again once. Give it to them privately; it only works on their account.</p>
						<div class="ov-row">
							<SelectField
								label="Valid for"
								value={hours}
								onChange={(v) => setHours(v || '2')}
								options={[
									{ value: '2', label: '2 hours' },
									{ value: '6', label: '6 hours' },
									{ value: '24', label: '24 hours' },
								]}
							/>
							<button type="button" class="pf-button primary" disabled={busy} onClick={() => act(async () => setCode(await createOverrideCode(player.id, Number(hours))))}>
								Generate code
							</button>
						</div>
						{code && (
							<div class="ov-code" role="status">
								<strong>{code.code.replace(/(\d{4})(\d{4})/, '$1 $2')}</strong>
								<span class="pf-help">Expires {when(code.expires)} · shown only now</span>
								<button
									type="button"
									class="pf-button subtle"
									onClick={() => navigator.clipboard?.writeText(code.code).then(() => setCopied(true), () => setCopied(false))}
								>
									{copied ? 'Copied' : 'Copy'}
								</button>
							</div>
						)}
					</div>

					<div class="hud-panel">
						<h3 class="hud-panel-title">Rolling lock</h3>
						{info.lock ? (
							<>
								<p>
									Locked since {when(info.lock.locked_at)}
									{info.lock.reason ? `: ${info.lock.reason}` : ''}. The player keeps their current rolls but can’t roll new ones.
								</p>
								<button type="button" class="pf-button" disabled={busy} onClick={() => act(() => setRollLock(player.id, false, ''))}>
									Unlock rolling
								</button>
							</>
						) : (
							<>
								<TextField label="Reason (the player sees this)" value={reason} onInput={setReason} placeholder="e.g. Abusing rerolls" />
								<button type="button" class="pf-button danger" disabled={busy} onClick={() => act(() => setRollLock(player.id, true, reason))}>
									Lock rolling
								</button>
							</>
						)}
					</div>

					<div class="hud-panel pf-wide">
						<h3 class="hud-panel-title">Rolls</h3>
						{info.rolls.length === 0 ? (
							<p class="pf-empty">No rolls yet.</p>
						) : (
							<table class="ov-table">
								<thead>
									<tr>
										<th>Kind</th>
										<th>Result</th>
										<th>Status</th>
										<th>Character</th>
										<th>When</th>
									</tr>
								</thead>
								<tbody>
									{info.rolls.map((r) => (
										<tr key={r.id} class={r.status}>
											<td>{r.kind === 'potential' ? 'Potential' : 'Cursed Energy'}</td>
											<td>{describe(r)}</td>
											<td>{r.status === 'active' ? 'Unsettled (locked)' : r.status === 'consumed' ? 'Settled' : 'Cleared'}</td>
											<td>{charName(r.character_id)}</td>
											<td>{when(r.created_at)}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
						{active.length > 0 && (
							<div class="ov-row">
								{active.map((r) => (
									<button key={r.id} type="button" class="pf-button subtle" disabled={busy} onClick={() => act(() => adminVoidRoll(player.id, r.kind))}>
										Clear unsettled {r.kind === 'potential' ? 'Potential' : 'Cursed Energy'}
									</button>
								))}
							</div>
						)}
					</div>

					<div class="hud-panel pf-wide">
						<h3 class="hud-panel-title">Set a roll by hand</h3>
						<p class="pf-help">For staff-rolled Potentials (Peak, Ultimate, Apex), rolls made on Discord before the portal, or locking a player to a value.</p>
						<div class="ov-row">
							<SelectField
								label="Roll"
								value={setKind}
								onChange={(v) => {
									setSetKind((v || 'potential') as RollKind);
									setSetValue('');
								}}
								options={[
									{ value: 'potential', label: 'Potential' },
									{ value: 'cursed_energy', label: 'Cursed Energy' },
								]}
							/>
							<SelectField
								label="Value"
								value={setValue}
								onChange={setSetValue}
								options={
									setKind === 'potential'
										? rules.potentials.map((p) => ({ value: p.id, label: p.label }))
										: Object.entries(ceLevels).flatMap(([cls, levels]) =>
												(levels as [string, number][]).map(([level, cep]) => ({ value: level, label: `${level} (${cep} CEP)`, group: cls })),
											)
								}
							/>
							<SelectField
								label="Character (optional)"
								value={setChar}
								onChange={setSetChar}
								placeholder="None: their next character"
								options={info.characters.filter((c) => c.kind === 'oc').map((c) => ({ value: c.id, label: `${c.name} (${c.status.replace('_', ' ')})` }))}
							/>
							<button type="button" class="pf-button primary" disabled={busy || !setValue} onClick={() => act(() => adminSetRoll(player.id, setKind, setValue, setChar || null))}>
								Set roll
							</button>
						</div>
					</div>

					<div class="hud-panel pf-wide">
						<h3 class="hud-panel-title">History</h3>
						{info.events.length === 0 ? (
							<p class="pf-empty">Nothing yet.</p>
						) : (
							<ul class="ov-events">
								{info.events.map((e) => (
									<li key={e.id}>
										<span class="pf-issue-section">{when(e.created_at)}</span> {EVENT_TEXT[e.action] ?? e.action}
										{e.action === 'rolled' && e.detail.result ? `: ${describe({ kind: e.detail.kind as RollKind, result: e.detail.result as RollRow['result'] })}` : ''}
										{e.action === 'locked' && e.detail.reason ? `: ${String(e.detail.reason)}` : ''}
										{e.actor_id && e.actor_id !== player.id ? ' (by an admin)' : ''}
									</li>
								))}
							</ul>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

export default function OverridePanel() {
	const [me, setMe] = useState<Player | null | undefined>(undefined);
	const [players, setPlayers] = useState<PlayerSummary[]>([]);
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<PlayerSummary | null>(null);
	const [error, setError] = useState('');

	useEffect(() => startPortalTheme(), []);
	useEffect(() => watchPlayer((p, e) => (e ? setError(messageOf(e)) : setMe(p))), []);
	useEffect(() => {
		if (me?.isAdmin) listPlayers().then(setPlayers, (e) => setError(messageOf(e)));
	}, [me?.id, me?.isAdmin]);

	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		return players.filter((p) => !q || p.display_name.toLowerCase().includes(q) || p.discord_id.includes(q));
	}, [players, query]);

	if (error) return <p class="portal-error">{error}</p>;
	if (me === undefined) return <p class="portal-status">Checking your login…</p>;
	if (me === null)
		return (
			<div class="portal-card">
				<p>Log in with Discord to continue.</p>
				<button type="button" class="portal-button discord" onClick={() => logIn()}>
					Log in with Discord
				</button>
			</div>
		);
	if (!me.isAdmin) return <p class="portal-error">This panel is for admins only.</p>;

	return (
		<div class="pf ov">
			<Section id="override" title="Override" intro="Manage a player's Potential and Cursed Energy rolls. Every action here is logged.">
				<div class="ov-layout pf-wide">
					<div class="hud-panel ov-list">
						<h3 class="hud-panel-title">Players</h3>
						<input type="search" class="ov-search" placeholder="Search name or Discord ID" value={query} onInput={(e) => setQuery(e.currentTarget.value)} aria-label="Search players" />
						<ul>
							{shown.map((p) => (
								<li key={p.id}>
									<button type="button" class={selected?.id === p.id ? 'active' : undefined} onClick={() => setSelected(p)}>
										{p.avatar_url && <img src={p.avatar_url} alt="" width={28} height={28} />}
										<span>{p.display_name}</span>
									</button>
								</li>
							))}
							{shown.length === 0 && <li class="pf-empty">No players found. Players appear here after they log in once.</li>}
						</ul>
					</div>
					{selected ? <PlayerDetail player={selected} /> : <p class="pf-empty ov-pick">Pick a player to see their rolls.</p>}
				</div>
			</Section>
		</div>
	);
}
