// Potential / Cursed Energy rolling on the portal, with the account lock and override codes.
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { redeemOverride, rollFor, type MyRolls, type RollKind, type RollResult } from '../../lib/portal/api.ts';
import { rules } from '../../lib/portal/rules.ts';

const DICE: Record<RollKind, { sides: number; name: string; die: string }> = {
	potential: { sides: 500, name: 'Potential', die: '1d500' },
	cursed_energy: { sides: 1260, name: 'Cursed Energy', die: '1d1260' },
};

const potentialLabel = (grade?: string) => rules.potentials.find((p) => p.id === grade)?.label ?? grade ?? '';
const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

/** Shown next to one roll while an admin's override code for it is active. The code only
 * works here, on the roll it was made for. */
function OverrideBox({ rollId, expires, onDone }: { rollId: string; expires: string; onDone: () => void }) {
	const id = useId();
	const [code, setCode] = useState('');
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
	return (
		<form
			class="roll-override"
			onSubmit={async (e) => {
				e.preventDefault();
				setBusy(true);
				try {
					const result = await redeemOverride(code, rollId);
					setNote(result);
					if (result.ok) {
						setCode('');
						onDone();
					}
				} catch (err) {
					setNote({ ok: false, message: messageOf(err) });
				} finally {
					setBusy(false);
				}
			}}
		>
			<label class="pf-label" for={id}>
				Override code for this roll
			</label>
			<p class="pf-help">An admin made a code that lets you re-roll this. It expires {new Date(expires).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.</p>
			<div class="roll-override-row">
				<input
					id={id}
					inputMode="numeric"
					autoComplete="off"
					placeholder="8-digit code"
					maxLength={12}
					value={code}
					onInput={(e) => setCode(e.currentTarget.value)}
				/>
				<button type="submit" class="pf-button" disabled={busy || code.replace(/\D/g, '').length < 8}>
					Use code
				</button>
			</div>
			{note && (
				<p class={note.ok ? 'roll-note ok' : 'roll-note bad'} role="status">
					{note.message}
				</p>
			)}
		</form>
	);
}

/** What a section needs to offer rolling for the character being edited. */
export interface Roller {
	characterId: string | null;
	myRolls: MyRolls | null;
	/** This character's own rolls from the database, even if not in the sheet yet. */
	characterRolls: Partial<Record<RollKind, RollResult>>;
	ensureSaved: () => Promise<string | null>;
	refresh: () => void;
}

interface Props {
	kind: RollKind;
	/** The character's current roll, as stored in its sheet. */
	current: RollResult | null;
	/** The roll record tied to this character, if any. */
	record?: RollResult | null;
	characterId: string | null;
	myRolls: MyRolls | null;
	/** Saves the character first (the roll is tied to it); returns its id. */
	ensureSaved: () => Promise<string | null>;
	onRolled: (result: RollResult) => void;
	/** Called when an override code clears this roll, so the form can empty the value. */
	onCleared: () => void;
	refresh: () => void;
	readOnly: boolean;
}

export function RollPanel({ kind, current, record, characterId, myRolls, ensureSaved, onRolled, onCleared, refresh, readOnly }: Props) {
	const dice = DICE[kind];
	const [rolling, setRolling] = useState(false);
	const [ticker, setTicker] = useState(0);
	const [error, setError] = useState('');
	const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	useEffect(() => () => clearInterval(timer.current), []);

	const active = myRolls?.active[kind];
	// The sheet only keeps the result; the dice numbers live on the roll record, which also
	// keeps the roll showing if its card was removed and added back.
	const shown: RollResult | null = record ? { ...current, ...record } : active?.heldBy?.id === characterId && characterId ? { ...current, ...active.row.result } : current;
	const has = kind === 'potential' ? Boolean(shown?.grade) : Boolean(shown?.class);
	const heldElsewhere = active?.heldBy && active.heldBy.id !== characterId ? active.heldBy : null;
	const carried = active && !active.heldBy;
	const locked = myRolls?.lock;
	// An admin's override code waiting for this roll (on this character, or the one it's locked to).
	const pendingHere = has && characterId ? myRolls?.pending.find((p) => p.kind === kind && p.character_id === characterId) : undefined;
	const pendingElsewhere = heldElsewhere ? myRolls?.pending.find((p) => p.kind === kind && p.roll_id === active?.row.id) : undefined;

	async function roll() {
		setError('');
		const id = await ensureSaved();
		if (!id) {
			setError('Give your character a name first so it can be saved. Your roll is tied to it.');
			return;
		}
		setRolling(true);
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		timer.current = setInterval(() => setTicker(1 + Math.floor(Math.random() * dice.sides)), 60);
		const started = Date.now();
		try {
			const result = await rollFor(kind, id);
			await new Promise((r) => setTimeout(r, Math.max(0, (reduced ? 200 : 1400) - (Date.now() - started))));
			onRolled(result);
			refresh();
		} catch (e) {
			setError(messageOf(e));
		} finally {
			clearInterval(timer.current);
			setRolling(false);
		}
	}

	return (
		<div class="roll-panel pf-wide" aria-live="polite">
			<div class="roll-head">
				<span class="pf-label">
					{dice.name} <span class="pf-required">*</span>
				</span>
				<span class="roll-die">{dice.die}</span>
			</div>

			{rolling ? (
				<div class="roll-value rolling">
					<strong>{ticker}</strong>
					<span>Rolling…</span>
				</div>
			) : has ? (
				<div class="roll-value">
					{kind === 'potential' ? (
						<>
							<strong>{potentialLabel(shown?.grade)}</strong>
							<span>{shown?.roll ? `Rolled ${shown.roll} on 1d500 · locked in` : shown?.roll === null ? 'Set by an admin · locked in' : 'Locked in'}</span>
						</>
					) : (
						<>
							<strong>
								{shown?.class} · {shown?.level}
							</strong>
							<span>
								{shown?.cep} CEP
								{shown?.classRoll ? ` · class roll ${shown.classRoll}/1260, amount roll ${shown.amountRoll}` : shown?.classRoll === null ? ' · set by an admin' : ''} · locked in
							</span>
						</>
					)}
					{pendingHere && !readOnly && (
						<OverrideBox
							rollId={pendingHere.roll_id}
							expires={pendingHere.expires_at}
							onDone={() => {
								onCleared();
								refresh();
							}}
						/>
					)}
				</div>
			) : readOnly ? (
				<p class="pf-help">Not rolled.</p>
			) : heldElsewhere ? (
				<div class="roll-locked">
					<p>
						🔒 Your {dice.name} roll is locked to <strong>{heldElsewhere.name}</strong>. Get that character approved first. Deleting it or starting over won’t give you a new
						roll.
					</p>
					{pendingElsewhere ? (
						<OverrideBox rollId={pendingElsewhere.roll_id} expires={pendingElsewhere.expires_at} onDone={refresh} />
					) : (
						<p class="pf-help">If you think you should get a new roll, ask an admin. They can give you a code for it.</p>
					)}
				</div>
			) : locked && !carried ? (
				<div class="roll-locked">
					<p>
						🔒 An admin has locked rolling on your account{locked.reason ? `: ${locked.reason}` : '.'} Ask an admin if you think this is a mistake.
					</p>
				</div>
			) : (
				<div class="roll-actions">
					<button type="button" class="pf-button primary" onClick={roll}>
						{carried ? `Use my ${dice.name} roll` : `Roll ${dice.name}`}
					</button>
					<p class="pf-help">
						{carried
							? 'You already rolled this for a character you deleted or that was denied. It carries over to this one.'
							: 'You only get one roll. It’s locked to your account until a character with it is approved.'}
					</p>
				</div>
			)}
			{error && (
				<p class="roll-note bad" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
