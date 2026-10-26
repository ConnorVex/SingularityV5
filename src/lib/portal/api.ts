// Database calls used by the portal pages. Row-level security decides what each one may see.
import { supabase } from '../supabase.ts';
import { normalizeSheet, type Sheet } from './sheet.ts';

export type Status = 'draft' | 'pending' | 'approved' | 'needs_correction' | 'denied';

export interface CharacterDraft {
	id: string | null;
	kind: 'oc' | 'canon';
	name: string;
	canonUniverse: string | null;
	sheet: Sheet;
	requestedClaims: string[];
	status: Status | null;
	approvedAt: string | null;
	approvedSheet: Sheet | null;
	extraTraitSlots: number;
}

export interface Universe {
	slug: string;
	name: string;
	ability_label: string | null;
}

export interface ClaimRow {
	id: string;
	universe: string;
	claim_type: 'character' | 'ability';
	category: string;
	name: string;
	max_users: number | null;
	used_slots: number;
	note: string;
}

export interface Combo {
	name: string;
	requires: string[][];
	perks: string;
	/** Power systems this combination lets the character have more of, e.g. { system: 3 }. */
	system_limits?: Record<string, number>;
}

function db() {
	if (!supabase) throw new Error('The portal is not connected to its database yet.');
	return supabase;
}

const fail = (error: { message: string } | null) => {
	if (error) throw new Error(error.message);
};

export const newDraft = (): CharacterDraft => ({
	id: null,
	kind: 'oc',
	name: '',
	canonUniverse: null,
	sheet: normalizeSheet({}),
	requestedClaims: [],
	status: null,
	approvedAt: null,
	approvedSheet: null,
	extraTraitSlots: 0,
});

export async function loadCharacter(id: string): Promise<CharacterDraft> {
	const { data, error } = await db().from('characters').select('*').eq('id', id).maybeSingle();
	fail(error);
	if (!data) throw new Error('Character not found, or it isn’t yours.');
	return {
		id: data.id,
		kind: data.kind,
		name: data.name,
		canonUniverse: data.canon_universe,
		sheet: normalizeSheet(data.sheet),
		requestedClaims: data.requested_claims ?? [],
		status: data.status,
		approvedAt: data.approved_at,
		approvedSheet: data.approved_sheet ? normalizeSheet(data.approved_sheet) : null,
		extraTraitSlots: data.extra_trait_slots ?? 0,
	};
}

/** Saves the character. `status` defaults to keeping 'pending', otherwise 'draft'. */
export async function saveCharacter(c: CharacterDraft, status?: 'draft' | 'pending'): Promise<{ id: string; status: Status }> {
	const row = {
		kind: c.kind,
		name: c.name.trim(),
		canon_universe: c.kind === 'canon' ? c.canonUniverse : null,
		sheet: c.sheet,
		requested_claims: c.requestedClaims,
		status: status ?? (c.status === 'pending' ? 'pending' : 'draft'),
	};
	const query = c.id ? db().from('characters').update(row).eq('id', c.id) : db().from('characters').insert(row);
	const { data, error } = await query.select('id, status').single();
	fail(error);
	return data as { id: string; status: Status };
}

export async function discoverCombos(characterId: string): Promise<Combo[]> {
	const { data, error } = await db().rpc('discover_combos', { p_character_id: characterId });
	fail(error);
	return (data ?? []) as Combo[];
}

export async function loadUniverses(): Promise<Universe[]> {
	const { data, error } = await db().from('universes').select('slug, name, ability_label').order('sort_order');
	fail(error);
	return data ?? [];
}

export async function loadClaimBoard(): Promise<ClaimRow[]> {
	const { data, error } = await db().from('claim_board').select('*').order('sort_order');
	fail(error);
	return data ?? [];
}

/** Claimables this character already holds. */
export async function loadHeldClaims(characterId: string): Promise<Set<string>> {
	const { data, error } = await db().from('claims').select('claimable_id').eq('character_id', characterId);
	fail(error);
	return new Set((data ?? []).map((r) => r.claimable_id));
}

// ───────────────────────────── Rolls ─────────────────────────────

export type RollKind = 'potential' | 'cursed_energy';

export interface RollResult {
	roll?: number | null;
	grade?: string;
	classRoll?: number | null;
	class?: string;
	amountRoll?: number;
	level?: string;
	cep?: number;
	/** The character already had this roll. */
	existing?: boolean;
	/** An unsettled roll moved over from a deleted or denied character. */
	carried?: boolean;
}

export interface RollRow {
	id: string;
	kind: RollKind;
	result: RollResult;
	status: 'active' | 'consumed' | 'void';
	character_id: string | null;
	created_at: string;
}

export interface MyRolls {
	/** Unsettled rolls, with the character each is tied to (if it still exists and isn't denied). */
	active: Partial<Record<RollKind, { row: RollRow; heldBy: { id: string; name: string } | null }>>;
	lock: { reason: string } | null;
}

/** Rolls through the 'roll' Edge Function, which checks Singularity membership first. */
export async function rollFor(kind: RollKind, characterId: string): Promise<RollResult> {
	const { data, error } = await db().functions.invoke('roll', { body: { kind, characterId } });
	if (error) {
		let message = error.message;
		try {
			const body = await (error as { context?: Response }).context?.json();
			if (body?.error) message = body.error;
		} catch {
			// keep the generic message
		}
		throw new Error(message);
	}
	return (data as { roll: RollResult }).roll;
}

export async function loadMyRolls(): Promise<MyRolls> {
	const [rolls, lock, chars] = await Promise.all([
		db().from('player_rolls').select('id, kind, result, status, character_id, created_at').eq('status', 'active'),
		db().from('roll_locks').select('reason').maybeSingle(),
		db().from('characters').select('id, name, status'),
	]);
	fail(rolls.error);
	fail(lock.error);
	fail(chars.error);
	const active: MyRolls['active'] = {};
	for (const row of (rolls.data ?? []) as RollRow[]) {
		const c = (chars.data ?? []).find((x) => x.id === row.character_id && x.status !== 'denied');
		active[row.kind] = { row, heldBy: c ? { id: c.id, name: c.name } : null };
	}
	return { active, lock: lock.data };
}

export async function redeemOverride(code: string): Promise<{ ok: boolean; message: string }> {
	const { data, error } = await db().rpc('redeem_roll_override', { p_code: code });
	fail(error);
	return data as { ok: boolean; message: string };
}

// ───────────────────────────── Admin: rolls ─────────────────────────────

export interface PlayerSummary {
	id: string;
	discord_id: string;
	display_name: string;
	avatar_url: string | null;
}

export interface PlayerRollInfo {
	rolls: RollRow[];
	lock: { reason: string; locked_at: string } | null;
	events: { id: number; action: string; detail: Record<string, unknown>; created_at: string; actor_id: string | null }[];
	characters: { id: string; name: string; status: Status; kind: 'oc' | 'canon' }[];
}

export async function listPlayers(): Promise<PlayerSummary[]> {
	const { data, error } = await db().from('profiles').select('id, discord_id, display_name, avatar_url').order('display_name');
	fail(error);
	return data ?? [];
}

export async function loadPlayerRolls(ownerId: string): Promise<PlayerRollInfo> {
	const [rolls, lock, events, characters] = await Promise.all([
		db().from('player_rolls').select('id, kind, result, status, character_id, created_at').eq('owner_id', ownerId).order('created_at', { ascending: false }),
		db().from('roll_locks').select('reason, locked_at').eq('owner_id', ownerId).maybeSingle(),
		db().from('roll_events').select('id, action, detail, created_at, actor_id').eq('owner_id', ownerId).order('id', { ascending: false }).limit(40),
		db().from('characters').select('id, name, status, kind').eq('owner_id', ownerId).order('created_at', { ascending: false }),
	]);
	for (const r of [rolls, lock, events, characters]) fail(r.error);
	return {
		rolls: (rolls.data ?? []) as RollRow[],
		lock: lock.data,
		events: (events.data ?? []) as PlayerRollInfo['events'],
		characters: (characters.data ?? []) as PlayerRollInfo['characters'],
	};
}

export async function createOverrideCode(ownerId: string, hours: number): Promise<{ code: string; expires: string }> {
	const { data, error } = await db().rpc('create_roll_override', { p_owner: ownerId, p_hours: hours });
	fail(error);
	return data as { code: string; expires: string };
}

export async function setRollLock(ownerId: string, locked: boolean, reason: string) {
	const { error } = await db().rpc('set_roll_lock', { p_owner: ownerId, p_locked: locked, p_reason: reason });
	fail(error);
}

export async function adminSetRoll(ownerId: string, kind: RollKind, value: string, characterId: string | null) {
	const { error } = await db().rpc('admin_set_roll', { p_owner: ownerId, p_kind: kind, p_value: value, p_character: characterId });
	fail(error);
}

export async function adminVoidRoll(ownerId: string, kind: RollKind) {
	const { error } = await db().rpc('admin_void_roll', { p_owner: ownerId, p_kind: kind });
	fail(error);
}
