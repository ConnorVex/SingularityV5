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

export interface PendingOverride {
	roll_id: string;
	kind: RollKind;
	character_id: string | null;
	expires_at: string;
}

export interface MyRolls {
	/** Unsettled rolls, with the character each is tied to (if it still exists and isn't denied). */
	active: Partial<Record<RollKind, { row: RollRow; heldBy: { id: string; name: string } | null }>>;
	lock: { reason: string } | null;
	/** Rolls an admin has made an override code for (the code itself stays with the admin). */
	pending: PendingOverride[];
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
	const { data: auth } = await db().auth.getSession();
	const uid = auth.session?.user.id ?? '';
	const [rolls, lock, chars, pending] = await Promise.all([
		db().from('player_rolls').select('id, kind, result, status, character_id, created_at').eq('owner_id', uid).eq('status', 'active'),
		db().from('roll_locks').select('reason').eq('owner_id', uid).maybeSingle(),
		db().from('characters').select('id, name, status').eq('owner_id', uid),
		db().rpc('my_pending_overrides'),
	]);
	fail(rolls.error);
	fail(lock.error);
	fail(chars.error);
	const active: MyRolls['active'] = {};
	for (const row of (rolls.data ?? []) as RollRow[]) {
		const c = (chars.data ?? []).find((x) => x.id === row.character_id && x.status !== 'denied');
		active[row.kind] = { row, heldBy: c ? { id: c.id, name: c.name } : null };
	}
	return { active, lock: lock.data, pending: pending.error ? [] : ((pending.data ?? []) as PendingOverride[]) };
}

/** This character's own rolls (any not thrown away), newest first per kind. They stick to the
 * character even when the card that shows them is removed and added again. */
export async function loadCharacterRolls(characterId: string): Promise<Partial<Record<RollKind, RollResult>>> {
	const { data, error } = await db()
		.from('player_rolls')
		.select('kind, result, created_at')
		.eq('character_id', characterId)
		.neq('status', 'void')
		.order('created_at', { ascending: false });
	fail(error);
	const out: Partial<Record<RollKind, RollResult>> = {};
	for (const r of data ?? []) out[r.kind as RollKind] ??= r.result as RollResult;
	return out;
}

/** Uses an override code; with rollId, the code must be the one made for that roll. */
export async function redeemOverride(code: string, rollId?: string): Promise<{ ok: boolean; message: string }> {
	const { data, error } = await db().rpc('redeem_roll_override', { p_code: code, p_roll: rollId ?? null });
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

export interface ActiveCode {
	id: string;
	roll_id: string | null;
	kind: RollKind | null;
	character_id: string | null;
	code_plain: string | null;
	expires_at: string;
}

export interface PlayerRollInfo {
	rolls: RollRow[];
	lock: { reason: string; locked_at: string } | null;
	events: { id: number; action: string; detail: Record<string, unknown>; created_at: string; actor_id: string | null }[];
	characters: { id: string; name: string; status: Status; kind: 'oc' | 'canon'; systems: { system: string }[] | null }[];
	codes: ActiveCode[];
}

export async function listPlayers(): Promise<PlayerSummary[]> {
	const { data, error } = await db().from('profiles').select('id, discord_id, display_name, avatar_url').order('display_name');
	fail(error);
	return data ?? [];
}

export async function loadPlayerRolls(ownerId: string): Promise<PlayerRollInfo> {
	const [rolls, lock, events, characters, codes] = await Promise.all([
		db().from('player_rolls').select('id, kind, result, status, character_id, created_at').eq('owner_id', ownerId).order('created_at', { ascending: false }),
		db().from('roll_locks').select('reason, locked_at').eq('owner_id', ownerId).maybeSingle(),
		db().from('roll_events').select('id, action, detail, created_at, actor_id').eq('owner_id', ownerId).order('id', { ascending: false }).limit(40),
		db().from('characters').select('id, name, status, kind, systems:sheet->systems').eq('owner_id', ownerId).order('created_at', { ascending: false }),
		db()
			.from('roll_override_codes')
			.select('id, roll_id, kind, character_id, code_plain, expires_at')
			.eq('owner_id', ownerId)
			.is('used_at', null)
			.is('cancelled_at', null)
			.gt('expires_at', new Date().toISOString()),
	]);
	for (const r of [rolls, lock, events, characters, codes]) fail(r.error);
	return {
		rolls: (rolls.data ?? []) as RollRow[],
		lock: lock.data,
		events: (events.data ?? []) as PlayerRollInfo['events'],
		characters: (characters.data ?? []) as PlayerRollInfo['characters'],
		codes: (codes.data ?? []) as ActiveCode[],
	};
}

export async function createOverrideCode(ownerId: string, hours: number): Promise<{ code: string; expires: string }> {
	const { data, error } = await db().rpc('create_roll_override', { p_owner: ownerId, p_hours: hours });
	fail(error);
	return data as { code: string; expires: string };
}

/** A single-use code that lets the player re-roll this one roll. */
export async function createOverrideFor(rollId: string, hours: number): Promise<{ id: string; code: string; expires: string }> {
	const { data, error } = await db().rpc('create_roll_override_for', { p_roll: rollId, p_hours: hours });
	fail(error);
	return data as { id: string; code: string; expires: string };
}

export async function cancelOverride(codeId: string) {
	const { error } = await db().rpc('cancel_roll_override', { p_code_id: codeId });
	fail(error);
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

// ───────────────────────────── My Characters ─────────────────────────────

export interface CharacterSummary {
	id: string;
	name: string;
	kind: 'oc' | 'canon';
	canon_universe: string | null;
	status: Status;
	approved_at: string | null;
	submitted_at: string | null;
	updated_at: string;
	created_at: string;
	image: string | null;
	role: string | null;
	potential: string | null;
}

export interface ReviewNote {
	id: string;
	character_id: string;
	outcome: 'approved' | 'needs_correction' | 'denied' | null;
	body: string;
	created_at: string;
}

/** The logged-in player's own characters, newest activity first. (Admins can read everyone's,
 * so this filters to the player explicitly.) */
export async function loadMyCharacters(): Promise<CharacterSummary[]> {
	const { data: auth } = await db().auth.getSession();
	const uid = auth.session?.user.id;
	if (!uid) return [];
	const { data, error } = await db()
		.from('characters')
		.select(
			'id, name, kind, canon_universe, status, approved_at, submitted_at, updated_at, created_at, image:sheet->appearance->>image, role:sheet->>role, potential:sheet->potential->>grade',
		)
		.eq('owner_id', uid)
		.order('updated_at', { ascending: false });
	fail(error);
	return (data ?? []) as CharacterSummary[];
}

export async function loadReviewNotes(characterIds: string[]): Promise<ReviewNote[]> {
	if (characterIds.length === 0) return [];
	const { data, error } = await db()
		.from('review_notes')
		.select('id, character_id, outcome, body, created_at')
		.in('character_id', characterIds)
		.order('created_at', { ascending: false });
	fail(error);
	return (data ?? []) as ReviewNote[];
}

export async function deleteCharacter(id: string) {
	const { data, error } = await db().from('characters').delete().eq('id', id).select('id');
	fail(error);
	if (!data?.length) throw new Error('This character can’t be deleted.');
}

// ───────────────────────────── Admin: review ─────────────────────────────

export interface AdminCharacter {
	id: string;
	owner_id: string;
	name: string;
	kind: 'oc' | 'canon';
	canon_universe: string | null;
	status: Status;
	hidden: boolean;
	extra_trait_slots: number;
	requested_claims: string[];
	sheet: Sheet;
	approved_sheet: Sheet | null;
	approved_at: string | null;
	submitted_at: string | null;
	reviewed_at: string | null;
	updated_at: string;
	created_at: string;
}

/** Every character (admins only; row-level security returns just your own otherwise). */
export async function loadAllCharacters(): Promise<AdminCharacter[]> {
	const { data, error } = await db()
		.from('characters')
		.select(
			'id, owner_id, name, kind, canon_universe, status, hidden, extra_trait_slots, requested_claims, sheet, approved_sheet, approved_at, submitted_at, reviewed_at, updated_at, created_at',
		)
		.order('submitted_at', { ascending: true, nullsFirst: false });
	fail(error);
	return (data ?? []).map((c) => ({
		...c,
		sheet: normalizeSheet(c.sheet),
		approved_sheet: c.approved_sheet ? normalizeSheet(c.approved_sheet) : null,
	})) as AdminCharacter[];
}

export async function reviewCharacter(id: string, outcome: 'approved' | 'needs_correction' | 'denied', note: string) {
	const { error } = await db().rpc('review_character', { p_character_id: id, p_outcome: outcome, p_note: note });
	fail(error);
}

export async function setCharacterHidden(id: string, hidden: boolean) {
	const { error } = await db().from('characters').update({ hidden }).eq('id', id);
	fail(error);
}

export async function setExtraTraitSlots(id: string, slots: number) {
	const { error } = await db().from('characters').update({ extra_trait_slots: slots }).eq('id', id);
	fail(error);
}

/** Deletes a character and frees its canon claims (admins only). */
export async function adminDeleteCharacter(id: string): Promise<{ name: string; releasedClaims: string[] }> {
	const { data, error } = await db().rpc('admin_delete_character', { p_character_id: id });
	fail(error);
	return data as { name: string; releasedClaims: string[] };
}
