// Admin "Override" panel: a player's characters and the rolls on each, with a per-roll override
// code or a hand-set value, the rolling lock, and the history. The database checks admin rights
// on every action.
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
	adminSetRoll,
	adminVoidRoll,
	cancelOverride,
	createOverrideFor,
	listPlayers,
	loadPlayerRolls,
	setRollLock,
	type ActiveCode,
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
const KIND_LABEL: Record<RollKind, string> = { potential: 'Potential', cursed_energy: 'Cursed Energy' };

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
	override_cancelled: 'Override code cancelled',
	override_used: 'Used an override code',
	override_failed: 'Wrong override code entered',
	locked: 'Rolling locked',
	unlocked: 'Rolling unlocked',
	admin_set: 'Roll set by an admin',
	admin_voided: 'Unsettled roll cleared by an admin',
};

const valueOptions = (kind: RollKind) =>
	kind === 'potential'
		? rules.potentials.map((p) => ({ value: p.id, label: p.label }))
		: Object.entries(ceLevels).flatMap(([cls, levels]) => (levels as [string, number][]).map(([level, cep]) => ({ value: level, label: `${level} (${cep} CEP)`, group: cls })));

/** One rolled value (a character's Potential or Cursed Energy) with its override code or hand-set controls. */
function RollLine(props: {
	kind: RollKind;
	row: RollRow | null;
	code: ActiveCode | null;
	ownerId: string;
	characterId: string | null;
	act: (fn: () => Promise<unknown>) => Promise<void>;
	busy: boolean;
}) {
	const { kind, row, code } = props;
	const [hours, setHours] = useState('2');
	const [setting, setSetting] = useState(false);
	const [value, setValue] = useState('');
	const [copied, setCopied] = useState(false);
	const status = !row ? 'Not rolled' : row.status === 'active' ? 'Locked in' : 'Settled (approved)';

	return (
		<div class="ov-roll">
			<div class="ov-roll-head">
				<span class="pf-label">{KIND_LABEL[kind]}</span>
				<strong class="ov-roll-value">{row ? describe(row) : '—'}</strong>
				<span class={`ov-roll-status ${row?.status ?? 'none'}`}>{status}</span>
			</div>

			{code ? (
				<div class="ov-code" role="status">
					<strong>{(code.code_plain ?? '········').replace(/(\d{4})(\d{4})/, '$1 $2')}</strong>
					<span class="pf-help">Override code for this roll · expires {when(code.expires_at)}</span>
					<button
						type="button"
						class="pf-button subtle"
						disabled={!code.code_plain}
						onClick={() => navigator.clipboard?.writeText(code.code_plain ?? '').then(() => setCopied(true), () => setCopied(false))}
					>
						{copied ? 'Copied' : 'Copy'}
					</button>
					<button type="button" class="pf-button subtle" disabled={props.busy} onClick={() => props.act(() => cancelOverride(code.id))}>
						Cancel code
					</button>
				</div>
			) : (
				<div class="ov-row">
					{row && (
						<>
							<SelectField
								label="Code valid for"
								value={hours}
								onChange={(v) => setHours(v || '2')}
								options={[
									{ value: '2', label: '2 hours' },
									{ value: '6', label: '6 hours' },
									{ value: '24', label: '24 hours' },
								]}
							/>
							<button type="button" class="pf-button primary" disabled={props.busy} onClick={() => props.act(() => createOverrideFor(row.id, Number(hours)))}>
								Give override code
							</button>
						</>
					)}
					<button type="button" class="pf-button" onClick={() => setSetting(!setting)} aria-expanded={setting}>
						Set manually
					</button>
					{row?.status === 'active' && (
						<button type="button" class="pf-button subtle" disabled={props.busy} onClick={() => props.act(() => adminVoidRoll(props.ownerId, kind))}>
							Clear without a code
						</button>
					)}
				</div>
			)}

			{setting && (
				<div class="ov-row">
					<SelectField label={`New ${KIND_LABEL[kind]}`} value={value} onChange={setValue} options={valueOptions(kind)} />
					<button
						type="button"
						class="pf-button primary"
						disabled={props.busy || !value}
						onClick={() =>
							props.act(async () => {
								await adminSetRoll(props.ownerId, kind, value, props.characterId);
								setSetting(false);
								setValue('');
							})
						}
					>
						Save
					</button>
				</div>
			)}
		</div>
	);
}

function PlayerDetail({ player }: { player: PlayerSummary }) {
	const [info, setInfo] = useState<PlayerRollInfo | null>(null);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [reason, setReason] = useState('');

	const reload = () => loadPlayerRolls(player.id).then(setInfo, (e) => setError(messageOf(e)));
	useEffect(() => {
		setInfo(null);
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

	// The latest roll of each kind on a character (ignoring thrown-away ones).
	const rollFor = (characterId: string | null, kind: RollKind) =>
		info?.rolls.find((r) => r.character_id === characterId && r.kind === kind && r.status !== 'void') ?? null;
	const codeFor = (row: RollRow | null) => (row ? (info?.codes.find((c) => c.roll_id === row.id) ?? null) : null);
	const ocs = info?.characters.filter((c) => c.kind === 'oc') ?? [];
	// Unsettled rolls whose character was deleted: they carry to the player's next character.
	const loose = info?.rolls.filter((r) => r.status === 'active' && !info.characters.some((c) => c.id === r.character_id)) ?? [];

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
				<>
					<div class="hud-panel">
						<h3 class="hud-panel-title">Characters and rolls</h3>
						{ocs.length === 0 && loose.length === 0 && <p class="pf-empty">No characters with rolls yet.</p>}
						{ocs.map((c) => {
							const hasJjk = (c.systems ?? []).some((e) => e?.system === 'jujutsu-kaisen');
							const kinds: RollKind[] = ['potential', ...(hasJjk || rollFor(c.id, 'cursed_energy') ? (['cursed_energy'] as RollKind[]) : [])];
							return (
								<div key={c.id} class="ov-char">
									<p class="ov-char-name">
										<strong>{c.name}</strong> <span class="pf-help">{c.status.replace('_', ' ')}</span>
									</p>
									{kinds.map((k) => {
										const row = rollFor(c.id, k);
										return <RollLine key={k} kind={k} row={row} code={codeFor(row)} ownerId={player.id} characterId={c.id} act={act} busy={busy} />;
									})}
								</div>
							);
						})}
						{loose.length > 0 && (
							<div class="ov-char">
								<p class="ov-char-name">
									<strong>Carried over</strong> <span class="pf-help">from a deleted character; goes to their next character</span>
								</p>
								{loose.map((r) => (
									<RollLine key={r.id} kind={r.kind} row={r} code={codeFor(r)} ownerId={player.id} characterId={null} act={act} busy={busy} />
								))}
							</div>
						)}
					</div>

					{info.codes.some((c) => !c.roll_id) && (
						<div class="hud-panel">
							<h3 class="hud-panel-title">Account-wide codes</h3>
							<p class="pf-help">Older codes that clear every unsettled roll on the account when used. New codes are made per roll above.</p>
							{info.codes
								.filter((c) => !c.roll_id)
								.map((c) => (
									<div class="ov-code" key={c.id}>
										<strong>{(c.code_plain ?? '········').replace(/(\d{4})(\d{4})/, '$1 $2')}</strong>
										<span class="pf-help">expires {when(c.expires_at)}</span>
										<button type="button" class="pf-button subtle" disabled={busy} onClick={() => act(() => cancelOverride(c.id))}>
											Cancel code
										</button>
									</div>
								))}
						</div>
					)}

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

					<div class="hud-panel">
						<h3 class="hud-panel-title">History</h3>
						{info.events.length === 0 ? (
							<p class="pf-empty">Nothing yet.</p>
						) : (
							<ul class="ov-events">
								{info.events.map((e) => (
									<li key={e.id}>
										<span class="pf-issue-section">{when(e.created_at)}</span> {EVENT_TEXT[e.action] ?? e.action}
										{e.detail.kind ? ` · ${KIND_LABEL[e.detail.kind as RollKind] ?? ''}` : ''}
										{e.action === 'rolled' && e.detail.result ? `: ${describe({ kind: e.detail.kind as RollKind, result: e.detail.result as RollRow['result'] })}` : ''}
										{e.action === 'admin_set' && e.detail.result ? `: ${describe({ kind: e.detail.kind as RollKind, result: e.detail.result as RollRow['result'] })}` : ''}
										{e.action === 'locked' && e.detail.reason ? `: ${String(e.detail.reason)}` : ''}
										{e.actor_id && e.actor_id !== player.id ? ' (by an admin)' : ''}
									</li>
								))}
							</ul>
						)}
					</div>
				</>
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
			<Section id="override" title="Override" intro="Pick a player to see their characters and rolls. Give a code for one specific roll, or set it by hand. Every action is logged.">
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
