// The rule checks for a whole character, shared by the form and the evolution page.
import type { CharacterDraft, ClaimRow, Combo } from './api.ts';
import { checkSheet, type Issue } from './rules.ts';
import { systemById } from './systems.ts';

export interface CheckData {
	board: ClaimRow[];
	/** Claims this character already holds. */
	held: Set<string>;
	combos: Combo[];
	/** Families the character is in, asking to join, or picked in the form. */
	familyIds: string[];
}

/** Canon picks only count for systems the character still has. */
export function effectiveClaims(d: CharacterDraft, board: ClaimRow[]): string[] {
	const universesInUse = new Set(d.sheet.systems.map((e) => systemById.get(e.system)?.universe).filter(Boolean));
	return d.requestedClaims.filter((id) => universesInUse.has(board.find((r) => r.id === id)?.universe));
}

export function characterIssues(draft: CharacterDraft, data: CheckData): Issue[] {
	const { board, held, combos } = data;
	const claims = new Map(board.map((r) => [r.id, { name: r.name, usedSlots: r.used_slots, maxUsers: r.max_users, category: r.category }]));
	const list = checkSheet(draft.sheet, {
		kind: draft.kind,
		name: draft.name,
		canonUniverse: draft.canonUniverse,
		isEvolution: Boolean(draft.approvedAt),
		extraTraitSlots: draft.extraTraitSlots,
		claims,
		heldClaimIds: held,
		requestedClaims: effectiveClaims(draft, board),
		comboSystemLimits: combos.map((c) => c.system_limits ?? {}),
		families: [...draft.sheet.families, ...data.familyIds],
	});
	if (draft.kind === 'canon' && draft.canonUniverse && draft.name.trim()) {
		const taken = board.find((r) => r.claim_type === 'character' && r.universe === draft.canonUniverse && r.name.toLowerCase() === draft.name.trim().toLowerCase());
		if (taken && !held.has(taken.id) && taken.max_users !== null && taken.used_slots >= taken.max_users) {
			list.unshift({ level: 'error', section: 'Basics', message: `${taken.name} is already claimed.` });
		}
	}
	return list;
}
