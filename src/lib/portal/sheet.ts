// The shape of a character sheet as stored in characters.sheet (jsonb).
import type { Fields } from './systems.ts';

export type SkillType = 'passive' | 'standard' | 'ultimate';

export interface Skill {
	name: string;
	type: SkillType;
	effect: string;
	mastery: string;
}

export interface SystemEntry {
	/** Stable id within the sheet, so priority can point at it. */
	key: string;
	system: string;
	fields: Fields;
	description: string;
	skills: Skill[];
	/** Rolls for this system's rolled fields: field key → Discord message link. */
	rollProofs: Record<string, string>;
}

export interface PickedTrait {
	name: string;
	/** Offered by a family: takes a single slot whatever its rarity. */
	family?: boolean;
	rollProof?: string;
}

export interface Sheet {
	role?: string;
	age?: string;
	pronouns?: string;
	race?: string;
	appearance: { image: string; description: string; extraImages: string };
	lore: { backstory: string; personality: string; likes: string; dislikes: string; relations: string };
	stats: {
		phase: number;
		strength: string;
		speed: string;
		defense: string;
		stamina: string;
		intelligence: string;
		physicalMeter: number;
		/** PTP earned in RP since the character started. */
		earnedPtp: number;
	};
	potential: { grade: string; rollProof: string };
	traits: PickedTrait[];
	/** Combinations whose reveal animation has already played. */
	seenCombos: string[];
	combat: { info: string; styles: { name: string; rollProof: string }[] };
	systems: SystemEntry[];
	/** key of the SystemEntry that is the priority system. */
	prioritySystem: string;
	storage: string;
	evolutions: { date: string; summary: string; earned: string; link: string }[];
	/** Canon tryouts only. */
	canon: { portrayal: string; sample: string };
}

export const emptySheet = (): Sheet => ({
	appearance: { image: '', description: '', extraImages: '' },
	lore: { backstory: '', personality: '', likes: '', dislikes: '', relations: '' },
	stats: { phase: 0, strength: '', speed: '', defense: '', stamina: '', intelligence: 'Average', physicalMeter: 0, earnedPtp: 0 },
	potential: { grade: '', rollProof: '' },
	traits: [],
	seenCombos: [],
	combat: { info: '', styles: [] },
	systems: [],
	prioritySystem: '',
	storage: '',
	evolutions: [],
	canon: { portrayal: '', sample: '' },
});

/** Fills in anything missing from an older or partial sheet. */
export function normalizeSheet(raw: unknown): Sheet {
	const base = emptySheet();
	const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Sheet>;
	return {
		...base,
		...s,
		appearance: { ...base.appearance, ...s.appearance },
		lore: { ...base.lore, ...s.lore },
		stats: { ...base.stats, ...s.stats },
		potential: { ...base.potential, ...s.potential },
		combat: { ...base.combat, ...s.combat, styles: s.combat?.styles ?? [] },
		canon: { ...base.canon, ...s.canon },
		traits: Array.isArray(s.traits) ? s.traits : [],
		seenCombos: Array.isArray(s.seenCombos) ? s.seenCombos : [],
		systems: Array.isArray(s.systems) ? s.systems.map((e: Partial<SystemEntry>) => ({ key: '', system: '', rollProofs: {}, skills: [], description: '', fields: {}, ...e })) : [],
		evolutions: Array.isArray(s.evolutions) ? s.evolutions : [],
	};
}
