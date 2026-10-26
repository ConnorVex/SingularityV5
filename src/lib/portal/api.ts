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
