// Live rule checks for the submit form. Everything here is a pure function of the sheet,
// so the same checks can run in the form, on the admin dashboard and in tests.
import ranksData from '../../data/portal/ranks.json' with { type: 'json' };
import rulesData from '../../data/portal/rules.json' with { type: 'json' };
import traitsData from '../../data/portal/traits.json' with { type: 'json' };
import type { Sheet } from './sheet.ts';
import { countsTowardLimit, systemById, visibleFields, type Field } from './systems.ts';

export const ranks = ranksData.ranks;
export const rules = rulesData;
export const traits = traitsData.traits;

const rankByName = new Map(ranks.map((r) => [r.rank, r]));
const traitByName = new Map(traits.map((t) => [t.name, t]));
const slotsByRarity = new Map(rules.traitSlots.rarities.map((r) => [r.id, r.slots]));

/** 'error' blocks sending for review; 'warning' is shown to player and admins; 'permission' flags a pick that needs an admin's OK. */
export type IssueLevel = 'error' | 'warning' | 'permission';
export interface Issue {
	level: IssueLevel;
	section: string;
	message: string;
}

export interface CheckContext {
	kind: 'oc' | 'canon';
	name: string;
	canonUniverse?: string | null;
	/** Editing an already-approved character: starting budgets no longer apply. */
	isEvolution?: boolean;
	extraTraitSlots?: number;
	/** Claim board rows for the picked claims: id → usage. */
	claims?: Map<string, { name: string; usedSlots: number; maxUsers: number | null; category?: string }>;
	/** Power-set limits from the character's discovered trait combinations. */
	comboSystemLimits?: Record<string, number>[];
	/** Claims this character already holds (don't count against it). */
	heldClaimIds?: Set<string>;
	requestedClaims?: string[];
}

export const rankValue = (rank: string) => rankByName.get(rank)?.value;
export const rankInfo = (rank: string) => rankByName.get(rank);

/** Power = (Strength value + Speed value) ÷ 2. */
export function power(sheet: Sheet): number | null {
	const str = rankValue(sheet.stats.strength);
	const spd = rankValue(sheet.stats.speed);
	return str === undefined || spd === undefined ? null : (str + spd) / 2;
}

const STAT_LABELS = { strength: 'Strength', speed: 'Speed', defense: 'Defense' } as const;

/** Recoil: Strength, Speed and Defense must stay within 2 Sub-Tiers of each other. */
export function recoil(sheet: Sheet): { level: number; high: string; low: string; gap: number } | null {
	const entries = (Object.keys(STAT_LABELS) as (keyof typeof STAT_LABELS)[])
		.map((key) => ({ key, value: rankValue(sheet.stats[key]) }))
		.filter((e): e is { key: keyof typeof STAT_LABELS; value: number } => e.value !== undefined);
	if (entries.length < 2) return null;
	entries.sort((a, b) => b.value - a.value);
	const high = entries[0];
	const low = entries.at(-1)!;
	const gap = high.value - low.value;
	if (gap <= rules.stats.recoilFreeGap) return null;
	return { level: Math.min(3, gap - rules.stats.recoilFreeGap), high: STAT_LABELS[high.key], low: STAT_LABELS[low.key], gap };
}

export function traitSlots(sheet: Sheet, extraSlots = 0) {
	const used = sheet.traits.reduce((sum, picked) => {
		if (picked.family) return sum + rules.traitSlots.familyTrait.slots;
		return sum + (slotsByRarity.get(traitByName.get(picked.name)?.rarity ?? '') ?? 1);
	}, 0);
	return { used, total: rules.traitSlots.base + extraSlots };
}

/** PTP spent on stats, Intelligence and Phase hops, and the starting PTP available:
 * the role's starting PTP plus bonuses from systems and traits. PTP earned in RP isn't
 * part of a new character's budget. */
export function ptp(sheet: Sheet) {
	const entries = sheet.systems.map((e) => ({ e, def: systemById.get(e.system) }));
	const ghoul = entries.map(({ e, def }) => def?.baseStats?.(e.fields)).find(Boolean) ?? null;
	const role = rules.roles.find((r) => r.id === sheet.role);
	const picked = new Set(sheet.traits.map((t) => t.name));
	const traitRules = rules.stats.traitPtp.filter((t) => picked.has(t.trait));
	const noPtp = Boolean(ghoul?.noPtp) || traitRules.some((t) => 'noStartingPtp' in t && t.noStartingPtp);

	const start = noPtp ? 0 : role?.startingPtp ?? 0;
	const bonus = noPtp ? 0 : entries.reduce((sum, { e, def }) => sum + (def?.ptpBonus?.(e.fields) ?? 0), 0);
	const traitBonus = noPtp ? 0 : traitRules.reduce((sum, t) => sum + ('ptp' in t ? (t.ptp ?? 0) : 0), 0);
	const available = Math.max(0, start + bonus + traitBonus);

	// Where each stat starts before any PTP: 1F, unless a system or trait says otherwise.
	const base = rankValue(rules.stats.baseRank) ?? 1;
	const startOf = (stat: string) => {
		let from = base;
		if (ghoul?.stats.includes(stat)) from = rankValue(ghoul.rank) ?? from;
		for (const t of traitRules) {
			const ranks = 'baseRanks' in t ? (t.baseRanks as Record<string, string>) : undefined;
			if (ranks?.[stat]) from = rankValue(ranks[stat]) ?? from;
		}
		return from;
	};
	let spent = 0;
	for (const stat of ['strength', 'speed', 'defense', 'stamina'] as const) {
		const value = rankValue(sheet.stats[stat]);
		if (value !== undefined) spent += Math.max(0, value - startOf(stat));
	}
	spent += rules.stats.intelligence.find((i) => i.value === sheet.stats.intelligence)?.ptp ?? 0;
	spent += rules.stats.phases.filter((p) => p.phase <= sheet.stats.phase).reduce((sum, p) => sum + p.hopCost, 0);
	return { spent, available, start, bonus, traitBonus, noPtp, roleKnown: Boolean(role) };
}

/** How many of one power system a character may have: Abilities and Quirks are unlimited,
 * the rest one each unless a trait or discovered combination raises it. */
export function systemLimit(sheet: Sheet, systemId: string, comboLimits: Record<string, number>[] = []): number {
	if (rules.powerSets.unlimited.includes(systemId)) return Infinity;
	let limit = 1;
	for (const t of rules.powerSets.traitLimits) {
		const limits = t.limits as Record<string, number>;
		if (sheet.traits.some((p) => p.name === t.trait)) limit = Math.max(limit, limits[systemId] ?? 1);
	}
	for (const c of comboLimits) limit = Math.max(limit, c[systemId] ?? 1);
	return limit;
}

/** Fewest skills a new card needs: one less than the starting maximum. */
export const minimumMoves = (max: number | undefined) => (max === undefined ? 0 : Math.max(0, max - 1));

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' ? v.trim() === '' : Array.isArray(v) && v.length === 0);
const isLink = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());

export function checkSheet(sheet: Sheet, ctx: CheckContext): Issue[] {
	const issues: Issue[] = [];
	const add = (level: IssueLevel, section: string, message: string) => issues.push({ level, section, message });
	const oc = ctx.kind === 'oc';

	// ── Basics ──
	if (blank(ctx.name)) add('error', 'Basics', 'Give your character a name.');
	if (!oc && blank(ctx.canonUniverse)) add('error', 'Basics', 'Pick which series your canon character is from.');
	if (oc && blank(sheet.role)) add('error', 'Basics', 'Pick a role.');

	// ── Appearance & lore ──
	if (!blank(sheet.appearance.image) && !isLink(sheet.appearance.image)) add('warning', 'Appearance', 'The main picture should be a link starting with https://');
	if (oc) {
		if (blank(sheet.appearance.description)) add('error', 'Appearance', 'Describe what your character looks like.');
		if (blank(sheet.lore.backstory)) add('error', 'Lore', 'Write your character’s backstory.');
		if (blank(sheet.lore.personality)) add('error', 'Lore', 'Describe your character’s personality.');
	} else {
		if (blank(sheet.canon.portrayal)) add('error', 'Tryout', 'Explain how you’ll portray this character.');
		if (blank(sheet.canon.sample)) add('error', 'Tryout', 'Add a short roleplay sample.');
	}
	if (!oc) return issues; // canon tryouts use the lighter sheet

	// ── S.T.S stats ──
	const s = sheet.stats;
	for (const stat of ['strength', 'speed', 'defense', 'stamina'] as const) {
		if (blank(s[stat])) add('error', 'Stats', `Pick a rank for ${stat[0].toUpperCase() + stat.slice(1)}.`);
	}
	const phase = rules.stats.phases.find((p) => p.phase === s.phase);
	for (const stat of ['strength', 'speed', 'defense', 'stamina'] as const) {
		const info = rankInfo(s[stat]);
		if (info && phase && info.tier > phase.maxTier) {
			add('warning', 'Stats', `${stat[0].toUpperCase() + stat.slice(1)} (${info.rank}) is above ${phase.label} (up to Tier ${phase.maxTier}).`);
		}
	}
	const r = recoil(sheet);
	if (r) add('warning', 'Stats', `Recoil Lv ${r.level}: ${r.high} is ${r.gap} Sub-Tiers above ${r.low} (more than 2 apart).`);

	const potential = rules.potentials.find((p) => p.id === sheet.potential.grade);
	if (!potential) add('error', 'Traits', 'Roll your Potential.');
	else {
		if ('rolled' in potential && potential.rolled) add('permission', 'Traits', `${potential.label} Potential is rolled by staff.`);
		if (s.phase > potential.maxPhase) add('warning', 'Stats', `${potential.label} Potential can’t reach Phase ${s.phase} (max Phase ${potential.maxPhase}).`);
		for (const stat of ['strength', 'speed', 'defense', 'stamina'] as const) {
			const info = rankInfo(s[stat]);
			if (info && info.tier > potential.maxTier) add('warning', 'Stats', `${potential.label} Potential stops at Tier ${potential.maxTier}, but ${stat} is ${info.rank}.`);
		}
	}
	const intel = rules.stats.intelligence.find((i) => i.value === s.intelligence);
	if (intel && 'permission' in intel && intel.permission) add('permission', 'Stats', `${intel.value} Intelligence needs permission.`);

	if (!ctx.isEvolution) {
		const budget = ptp(sheet);
		if (budget.roleKnown && budget.spent > budget.available) {
			const parts = budget.noPtp
				? 'none, because of a trait or system that blocks starting PTP'
				: `${budget.start} from your role, ${budget.bonus} from systems, ${budget.traitBonus} from traits`;
			add('error', 'Stats', `You’re spending ${budget.spent} PTP, but you start with ${budget.available} (${parts}).`);
		}
	}

	// ── Traits ──
	const slots = traitSlots(sheet, ctx.extraTraitSlots ?? 0);
	if (slots.used > slots.total) add('error', 'Traits', `Your traits take ${slots.used} slots, but you only have ${slots.total}. Remove a trait.`);
	if (sheet.traits.filter((t) => t.family).length > rules.traitSlots.familyTrait.max) add('error', 'Traits', 'Only one trait can be a Family trait.');
	const seen = new Set<string>();
	for (const picked of sheet.traits) {
		if (!traitByName.has(picked.name)) add('error', 'Traits', `“${picked.name}” isn’t a known trait.`);
		if (seen.has(picked.name)) add('error', 'Traits', `“${picked.name}” is picked twice.`);
		seen.add(picked.name);
		if (blank(picked.rollProof)) add('warning', 'Traits', `Add the roll link for ${picked.name}.`);
	}

	// ── Combat ──
	for (const style of sheet.combat.styles) {
		if (blank(style.name)) add('error', 'Combat', 'A Fighting Style is missing its name.');
		else if (blank(style.rollProof)) add('warning', 'Combat', `Add the roll link for ${style.name}.`);
	}

	// ── Systems ──
	checkSystems(sheet, ctx, add);

	// ── Canon claims ──
	for (const id of ctx.requestedClaims ?? []) {
		const claim = ctx.claims?.get(id);
		if (!claim) add('error', 'Systems', 'A picked canon claim no longer exists.');
		else if (!ctx.heldClaimIds?.has(id) && claim.maxUsers !== null && claim.usedSlots >= claim.maxUsers) {
			add('error', 'Systems', `${claim.name} is already full (${claim.usedSlots}/${claim.maxUsers}).`);
		}
		if (claim && rules.permissionClaimCategories.includes(claim.category ?? '')) {
			add('permission', 'Systems', `${claim.name} is ${claim.category}: you need to join the family that holds it.`);
		}
	}

	return issues;
}

function checkSystems(sheet: Sheet, ctx: CheckContext, add: (level: IssueLevel, section: string, message: string) => void) {
	const entries = sheet.systems;
	if (entries.length > 1 && !entries.some((e) => e.key === sheet.prioritySystem)) {
		add('error', 'Systems', 'With more than one power system, pick your priority system.');
	}
	const counts = new Map<string, number>();
	for (const e of entries) {
		if (countsTowardLimit(systemById.get(e.system), e.fields)) counts.set(e.system, (counts.get(e.system) ?? 0) + 1);
	}
	for (const [system, count] of counts) {
		const limit = systemLimit(sheet, system, ctx.comboSystemLimits);
		if (count > limit) {
			const def = systemById.get(system);
			const what = def?.limitedChoice ? def.limitedChoice.label : `${def?.label ?? system} power set`;
			add('error', 'Systems', `You can only have ${limit === 1 ? 'one' : limit} ${what}${limit === 1 ? '' : 's'}, but you have ${count}.`);
		}
	}
	for (const entry of entries) {
		const def = systemById.get(entry.system);
		if (!def) {
			add('error', 'Systems', `Unknown power system “${entry.system}”.`);
			continue;
		}
		const where = def.label;
		const allowed = def.onlyWith?.(entry.fields);
		if (allowed) {
			for (const other of entries) {
				if (other !== entry && !allowed.includes(other.system)) {
					add('error', 'Systems', `${where} can’t be combined with ${systemById.get(other.system)?.label ?? other.system}.`);
				}
			}
		}
		// Rolled fields come from one roll: report a missing roll once, not once per field.
		const missingRolls = new Set<string>();
		for (const field of visibleFields(def, entry.fields)) {
			if (field.rolled && field.required && blank(entry.fields[field.key])) {
				if (!missingRolls.has(field.rolled)) add('error', 'Systems', `${where}: roll your ${field.label}.`);
				missingRolls.add(field.rolled);
				continue;
			}
			checkField(field, entry.fields[field.key], where, add, entry.rollProofs?.[field.key]);
		}

		if (!ctx.isEvolution && def.budget) {
			const total = def.budget.total(entry.fields);
			const spent = def.budget.spent(entry.fields);
			if (spent > total) add('warning', 'Systems', `${where}: ${spent} ${def.budget.label} spent, but you start with ${total}.`);
		}
		const moves = def.startingMoves?.(entry.fields);
		for (const type of ['standard', 'ultimate'] as const) {
			const max = moves?.[type];
			if (max === undefined) continue;
			const name = type === 'standard' ? moves?.label ?? 'Standard skill' : 'Ultimate skill';
			const count = entry.skills.filter((sk) => sk.type === type).length;
			const min = minimumMoves(max);
			if (count < min) add('error', 'Systems', `${where}: add at least ${min} ${name}${min === 1 ? '' : 's'} (you have ${count}).`);
			else if (!ctx.isEvolution && count > max) add('warning', 'Systems', `${where}: ${count} ${name}s, but you can start with ${max}.`);
		}
		for (const skill of entry.skills) {
			if (blank(skill.name)) add('error', 'Systems', `${where}: a skill is missing its name.`);
			if (skill.type === 'passive') add('permission', 'Systems', `${where}: custom passive “${skill.name || 'unnamed'}” needs permission.`);
		}
	}
}

function checkField(field: Field, value: unknown, where: string, add: (level: IssueLevel, section: string, message: string) => void, rollProof?: string) {
	if (field.required && blank(value)) {
		add('error', 'Systems', field.rolled ? `${where}: roll your ${field.label}.` : `${where}: fill in ${field.label}.`);
		return;
	}
	const picked = Array.isArray(value) ? value : [value];
	for (const option of field.options ?? []) {
		if (option.permission && picked.includes(option.value)) add('permission', 'Systems', `${where}: ${option.value} (${field.label}) needs permission.`);
	}
	if (field.rollProof && !blank(value) && value !== 'None' && blank(rollProof)) add('warning', 'Systems', `${where}: add the roll link for ${field.label}.`);
	if (field.type === 'list' && Array.isArray(value)) {
		(value as Record<string, string>[]).forEach((row, i) => {
			for (const column of field.columns ?? []) {
				if (column.required && blank(row[column.key])) add('error', 'Systems', `${where}: ${field.label} #${i + 1} is missing “${column.label}”.`);
			}
		});
	}
}

export const hasBlockingIssues = (issues: Issue[]) => issues.some((i) => i.level === 'error');
