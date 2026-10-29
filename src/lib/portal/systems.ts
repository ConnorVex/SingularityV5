// What the submit form asks for on each power system's card, mirrored from the wiki's
// Power Systems pages. Edit here when a system's rules change.
import rulesData from '../../data/portal/rules.json' with { type: 'json' };

const cyber = rulesData.cyberware;

export type FieldValue = string | number | string[] | Record<string, string>[];
export type Fields = Record<string, FieldValue | undefined>;

export interface Option {
	value: string;
	label?: string;
	/** Points this choice costs from the system's starting budget. */
	points?: number;
	/** Needs admin permission; flagged for reviewers. */
	permission?: boolean;
}

export interface Field {
	key: string;
	label: string;
	type: 'select' | 'multiselect' | 'number' | 'text' | 'textarea' | 'list';
	options?: Option[];
	/** For 'list': the columns of each row. */
	columns?: Field[];
	help?: string;
	default?: FieldValue;
	min?: number;
	/** Only shown while another field has one of these values. */
	showIf?: { key: string; in: string[] };
	required?: boolean;
	/** A Discord message link proving a roll. */
	rollProof?: boolean;
	/** Filled by a roll on the portal (read-only on the card). */
	rolled?: 'cursed_energy';
}

export interface SystemDef {
	id: string;
	label: string;
	/** Wiki series slug, for canon claims. */
	universe?: string;
	/** What a canon pick is called here, e.g. 'Stand'. Enables picking from the claim board. */
	claimLabel?: string;
	fields: Field[];
	/** Starting points to spend on this system's stats. */
	budget?: { label: string; total: (f: Fields) => number; spent: (f: Fields) => number };
	/** Most skills a brand-new character may start with. */
	startingMoves?: (f: Fields) => { standard?: number; ultimate?: number; label?: string };
	/** Extra Physical Tiering Points this system grants. */
	ptpBonus?: (f: Fields) => number;
	/** When only some cards count toward the one-per-character limit, e.g. only Stands for JoJo.
	 * Without it, every card of this system counts. */
	limitedChoice?: { key: string; value: string; label: string };
	/** Systems this one can be combined with; others are blocked. */
	onlyWith?: (f: Fields) => string[] | null;
	/** Sets the character's base physical stats instead of PTP. */
	baseStats?: (f: Fields) => { rank: string; stats: string[]; noPtp: boolean } | null;
	/** Extra rule checks for this system; `starting` is true for characters not yet approved. */
	checks?: (f: Fields, starting: boolean) => { level: 'error' | 'warning' | 'permission'; message: string }[];
	notes?: string[];
}

const levels = (names: string[], perm: string[] = []): Option[] =>
	names.map((value, points) => ({ value, points, permission: perm.includes(value) }));

const indexOf = (options: Option[] | undefined, value: FieldValue | undefined) =>
	Math.max(0, options?.findIndex((o) => o.value === value) ?? 0);

const num = (v: FieldValue | undefined) => (typeof v === 'number' ? v : Number(v) || 0);

const abilityPower = levels(
	['No Power', 'Miniscule', 'Puny', 'Insignificant', 'Trivial', 'Meager', 'Little', 'Small', 'Average', 'Decent', 'Vast', 'Immense', 'Colossal', 'Peak', 'Apex'],
	['Colossal', 'Peak', 'Apex'],
);
const abilityRange = levels(['Physical', 'Close', 'Medium', 'Long', 'Extremely Long']);

const quirkPower = levels(
	['No Power', 'Miniscule', 'Puny', 'Insignificant', 'Trivial', 'Meager', 'Little', 'Small', 'Average', 'Decent', 'Great', 'Plus Variant', 'Maximum Variant', 'Infinite Variant'],
	['Plus Variant', 'Maximum Variant', 'Infinite Variant'],
);
const quirkRange = levels(['Physical', 'Close', 'Medium', 'Long']);

const standGrades = [
	{ value: 'E', points: 1 },
	{ value: 'D', points: 2 },
	{ value: 'C', points: 3 },
	{ value: 'B', points: 4 },
	{ value: 'A', points: 5 },
	{ value: 'S', points: 6 },
];
const standStats = ['Destructive Power', 'Speed', 'Range', 'Durability', 'Precision', 'Developmental Potential'];
const standKey = (stat: string) => 'stand' + stat.replace(/\s/g, '');

const infamousClasses: Option[] = [
	{ value: 'Elemental', points: 4 },
	{ value: 'Energy', points: 5 },
	{ value: 'Psychic', points: 0 },
	{ value: 'Biologically Enhanced', points: 0 },
	{ value: 'Meta', points: 0, permission: true },
];

export const systems: SystemDef[] = [
	{
		id: 'abilities',
		label: 'Abilities',
		fields: [
			{
				key: 'classes',
				label: 'Ability class(es)',
				type: 'multiselect',
				options: [{ value: 'Manipulation' }, { value: 'Generation' }, { value: 'Transformation' }, { value: 'God', permission: true }],
				required: true,
			},
			{ key: 'power', label: 'Ability Power', type: 'select', options: abilityPower, default: 'No Power' },
			{ key: 'range', label: 'Ability Range', type: 'select', options: abilityRange, default: 'Physical' },
			{ key: 'upgradePoints', label: 'Ability Upgrade Points (AUP)', type: 'number', default: 0, min: 0 },
		],
		budget: {
			label: 'Ability Tier Points',
			total: () => 4,
			spent: (f) => indexOf(abilityPower, f.power) + indexOf(abilityRange, f.range),
		},
		startingMoves: () => ({ standard: 2, ultimate: 1 }),
		notes: ['Colossal, Peak and Apex power need the Bio-King trait.'],
	},
	{
		id: 'quirk',
		label: 'My Hero Academia (Quirk)',
		universe: 'my-hero-academia',
		claimLabel: 'Canon Quirk',
		fields: [
			{ key: 'type', label: 'Quirk type', type: 'select', options: [{ value: 'Emitter' }, { value: 'Transformation' }, { value: 'Mutation' }], required: true },
			{ key: 'power', label: 'Quirk Power', type: 'select', options: quirkPower, default: 'No Power' },
			{ key: 'range', label: 'Quirk Range', type: 'select', options: quirkRange, default: 'Physical' },
			{ key: 'upgradePoints', label: 'Quirk Upgrade Points (QUP)', type: 'number', default: 0, min: 0 },
		],
		budget: {
			label: 'Quirk Tier Points',
			total: () => 3,
			spent: (f) => indexOf(quirkPower, f.power) + indexOf(quirkRange, f.range),
		},
		startingMoves: () => ({ standard: 3, ultimate: 2 }),
	},
	{
		id: 'jujutsu-kaisen',
		label: 'Jujutsu Kaisen',
		universe: 'jujutsu-kaisen',
		claimLabel: 'Cursed Technique',
		fields: [
			{
				key: 'ceClass',
				label: 'Cursed Energy',
				type: 'select',
				options: [{ value: 'Common' }, { value: 'Uncommon' }, { value: 'Rare' }, { value: 'Legendary' }, { value: 'Mythical' }],
				required: true,
				rolled: 'cursed_energy',
			},
			{ key: 'ceAmount', label: 'Cursed Energy Points', type: 'number', min: 0, required: true, rolled: 'cursed_energy' },
			{
				key: 'ceOutput',
				label: 'Cursed Energy Output',
				type: 'select',
				options: levels(['None', 'Extremely Poor', 'Poor', 'Miniscule', 'Small', 'Average', 'Above Average', 'Good', 'High', 'Amazing', 'Extremely High', 'Intense', 'Immense', 'Maximum']),
				default: 'None',
			},
			{ key: 'ceControl', label: 'Cursed Energy Control level', type: 'number', default: 0, min: 0 },
			{ key: 'rp2rpRecharge', label: 'RP2RP Recharge level', type: 'number', default: 0, min: 0 },
			{ key: 'completeRecharge', label: 'Complete Recharge level', type: 'number', default: 0, min: 0 },
			{ key: 'ceUpgradePoints', label: 'Cursed Energy Upgrade Points (CEUP)', type: 'number', default: 0, min: 0 },
			{ key: 'ctName', label: 'Cursed Technique name', type: 'text' },
			{ key: 'ctType', label: 'Cursed Technique type', type: 'select', options: [{ value: 'Innate' }, { value: 'Inherited' }] },
			{ key: 'ctClass', label: 'Cursed Technique class', type: 'select', options: [{ value: 'General' }, { value: 'Shikigami' }, { value: 'Support' }] },
			{
				key: 'ctRange',
				label: 'Cursed Technique Range',
				type: 'select',
				options: levels(['Physical', 'Close', 'Medium', 'Long', 'Impossible', 'Heavenly', 'Unknown'], ['Impossible', 'Heavenly', 'Unknown']),
				default: 'Physical',
			},
			{
				key: 'ctPower',
				label: 'Cursed Technique Power',
				type: 'select',
				options: levels(['Below Grade 4', 'Grade 4', 'Semi Grade 3', 'Grade 3', 'Semi Grade 2', 'Grade 2', 'Semi Grade 1', 'Grade 1', 'Special Grade'], ['Special Grade']),
				default: 'Below Grade 4',
			},
			{
				key: 'ctEfficiency',
				label: 'Cursed Technique Efficiency',
				type: 'select',
				options: levels(
					['Extremely Poor', 'Very Poor', 'Poor', 'Subpar', 'Tolerable', 'Average', 'Decent', 'Adequate', 'Great', 'Amazing', 'Insane', 'Remarkable', 'Unparalleled', 'Terrifying'],
					['Unparalleled', 'Terrifying'],
				),
				default: 'Extremely Poor',
			},
			{ key: 'ctUpgradePoints', label: 'Cursed Technique Upgrade Points (CTUP)', type: 'number', default: 0, min: 0 },
			{
				key: 'heavenlyRestriction',
				label: 'Heavenly Restriction',
				type: 'select',
				options: [{ value: 'None' }, { value: 'Physical' }, { value: 'Cursed Energy' }, { value: 'Twins' }, { value: 'Equilibrium' }],
				default: 'None',
				rollProof: true,
			},
			{ key: 'bindingVows', label: 'Binding Vows', type: 'textarea' },
			{ key: 'cursedTools', label: 'Cursed Tools', type: 'textarea' },
		],
		startingMoves: () => ({ standard: 2, label: 'Extension Technique' }),
		ptpBonus: (f) => (f.heavenlyRestriction === 'Physical' ? 9 : 0),
		notes: ['Barriers and Domain Expansions are added later as evolutions.'],
	},
	{
		id: 'jojo',
		label: "JoJo's Bizarre Adventure",
		universe: 'jojo',
		claimLabel: 'Canon Stand',
		limitedChoice: { key: 'path', value: 'Stand', label: 'Stand' },
		fields: [
			{
				key: 'path',
				label: 'Path',
				type: 'select',
				options: [{ value: 'Stand' }, { value: 'Hamon' }, { value: 'Spin' }, { value: 'Vampire' }, { value: 'Ultimate Life Form', permission: true }],
				required: true,
			},
			{ key: 'standName', label: 'Stand name', type: 'text', showIf: { key: 'path', in: ['Stand'] }, required: true },
			...standStats.map(
				(stat): Field => ({
					key: standKey(stat),
					label: stat,
					type: 'select',
					options: stat === 'Developmental Potential' ? [...standGrades, { value: '∞', points: 0, permission: true }] : standGrades,
					showIf: { key: 'path', in: ['Stand'] },
					required: true,
				}),
			),
			{ key: 'standArrow', label: 'Stand Arrow roll (if not born with it)', type: 'text', showIf: { key: 'path', in: ['Stand'] }, rollProof: true },
			{ key: 'hamonMastery', label: 'Hamon Mastery', type: 'number', default: 0, min: 0, showIf: { key: 'path', in: ['Hamon'] } },
			{ key: 'spinMastery', label: 'Spin Mastery', type: 'number', default: 0, min: 0, showIf: { key: 'path', in: ['Spin'] } },
			{ key: 'vampireMastery', label: 'Vampire Mastery', type: 'number', default: 0, min: 0, showIf: { key: 'path', in: ['Vampire'] } },
			{ key: 'vampireUpgradePoints', label: 'Vampire Upgrade Points', type: 'number', default: 0, min: 0, showIf: { key: 'path', in: ['Vampire'] } },
		],
		budget: {
			label: 'Stand Points',
			total: (f) => (f.path === 'Stand' ? 15 : 0),
			spent: (f) =>
				f.path === 'Stand'
					? standStats.reduce((sum, stat) => sum + (standGrades.find((g) => g.value === f[standKey(stat)])?.points ?? 0), 0)
					: 0,
		},
		notes: ['Hamon can only be started by Outworlders, so Mainlanders learn it in RP.'],
	},
	{
		id: 'fire-force',
		label: 'Fire Force',
		universe: 'fire-force',
		claimLabel: 'Canon Ignition Ability',
		fields: [
			{ key: 'generation', label: 'Generation', type: 'select', options: [{ value: 'Second' }, { value: 'Third' }], required: true },
			{ key: 'theme', label: 'Theme', type: 'text', required: true, help: 'Every Pyrokinetic follows a theme and sticks to it.' },
			{ key: 'manipulation', label: 'Pyrokinetic Manipulation level', type: 'number', default: 0, min: 0, showIf: { key: 'generation', in: ['Second'] } },
			{ key: 'power', label: 'Pyrokinetic Power level', type: 'number', default: 0, min: 0, showIf: { key: 'generation', in: ['Third'] } },
			{ key: 'oxygenTank', label: 'Oxygen Tank level', type: 'number', default: 1, min: 1, showIf: { key: 'generation', in: ['Third'] } },
			{ key: 'efficiency', label: 'Pyrokinetic Efficiency level', type: 'number', default: 0, min: 0, showIf: { key: 'generation', in: ['Third'] } },
			{ key: 'absorption', label: 'Oxygen Absorption Rate level', type: 'number', default: 0, min: 0, showIf: { key: 'generation', in: ['Third'] } },
		],
		budget: {
			label: 'Fire Force Tier Points',
			total: (f) => (f.generation === 'Third' ? 8 : 0),
			spent: (f) => (f.generation === 'Third' ? num(f.power) + Math.max(0, num(f.oxygenTank) - 1) + num(f.efficiency) + num(f.absorption) : 0),
		},
	},
	{
		id: 'infamous',
		label: 'inFAMOUS (Conduit)',
		universe: 'infamous',
		claimLabel: 'Canon Conduit',
		fields: [
			{ key: 'class', label: 'Conduit class', type: 'select', options: infamousClasses, required: true, help: 'Quantum can’t be picked.' },
			{ key: 'element', label: 'Element / Energy', type: 'text', showIf: { key: 'class', in: ['Elemental', 'Energy'] }, required: true },
			{ key: 'power', label: 'Power level', type: 'number', default: 0, min: 0, showIf: { key: 'class', in: ['Elemental', 'Energy'] } },
			{ key: 'tank', label: 'Tank level', type: 'number', default: 0, min: 0, showIf: { key: 'class', in: ['Elemental', 'Energy'] } },
			{ key: 'karma', label: 'Karma', type: 'select', options: [{ value: 'Good' }, { value: 'Neutral' }, { value: 'Evil' }], default: 'Neutral' },
		],
		budget: {
			label: 'Conduit Tier Points',
			total: (f) => infamousClasses.find((c) => c.value === f.class)?.points ?? 0,
			spent: (f) => num(f.power) + num(f.tank),
		},
		ptpBonus: (f) => 10 + (f.class === 'Biologically Enhanced' ? 20 : 0),
	},
	{
		id: 'tokyo-ghoul',
		label: 'Tokyo Ghoul',
		universe: 'tokyo-ghoul',
		fields: [
			{ key: 'path', label: 'Path', type: 'select', options: [{ value: 'Ghoul' }, { value: 'Human (Quinque user)' }], required: true },
			{
				key: 'kagune',
				label: 'Kagune type (rolled)',
				type: 'select',
				options: [{ value: 'Ukaku' }, { value: 'Koukaku' }, { value: 'Bikaku' }, { value: 'Ashiaku' }, { value: 'Rinkaku' }, { value: 'Udeaku' }, { value: 'Chimera', permission: true }],
				showIf: { key: 'path', in: ['Ghoul'] },
				required: true,
				rollProof: true,
			},
			{ key: 'rcTank', label: 'Rc Tank', type: 'number', default: 460, min: 0, showIf: { key: 'path', in: ['Ghoul'] } },
			{ key: 'gep', label: 'Ghoul Evolution Points (GEP)', type: 'number', default: 0, min: 0, showIf: { key: 'path', in: ['Ghoul'] } },
			{ key: 'quinque', label: 'Quinque', type: 'textarea', showIf: { key: 'path', in: ['Human (Quinque user)'] } },
		],
		onlyWith: (f) => (f.path === 'Ghoul' ? ['chainsaw-man'] : null),
		baseStats: (f) => (f.path === 'Ghoul' ? { rank: '4C', stats: ['strength', 'speed'], noPtp: true } : null),
		notes: ['Ghouls can only pair with Chainsaw Man, and only by making contracts with Devils.'],
	},
	{
		id: 'chainsaw-man',
		label: 'Chainsaw Man',
		universe: 'chainsaw-man',
		fields: [
			{ key: 'path', label: 'Path', type: 'select', options: [{ value: 'Devil' }, { value: 'Fiend' }, { value: 'Hybrid' }, { value: 'Human with contracts' }], required: true },
			{
				key: 'devilClass',
				label: 'Devil class',
				type: 'select',
				options: [{ value: 'Mundane' }, { value: 'Rational' }, { value: 'Irrational' }, { value: 'Primal' }],
				showIf: { key: 'path', in: ['Devil', 'Fiend', 'Hybrid'] },
				required: true,
			},
			{ key: 'concept', label: 'Feared concept', type: 'text', showIf: { key: 'path', in: ['Devil', 'Fiend', 'Hybrid'] }, required: true },
			{ key: 'bloodTank', label: 'Blood tank (BP)', type: 'number', min: 0, showIf: { key: 'path', in: ['Devil', 'Fiend', 'Hybrid'] } },
			{ key: 'dap', label: 'Devil Ability Power (DAP)', type: 'number', min: 0, showIf: { key: 'path', in: ['Devil', 'Fiend', 'Hybrid'] } },
			{
				key: 'contracts',
				label: 'Contracts',
				type: 'list',
				showIf: { key: 'path', in: ['Human with contracts', 'Hybrid'] },
				columns: [
					{ key: 'devil', label: 'Devil', type: 'text', required: true },
					{
						key: 'type',
						label: 'Type',
						type: 'select',
						options: [{ value: 'Summoning' }, { value: 'Supernatural Object' }, { value: 'Hybrid' }, { value: 'Devil Transformation' }],
						required: true,
					},
					{ key: 'price', label: 'Price', type: 'text', required: true },
					{ key: 'grants', label: 'What the human can do', type: 'text', required: true },
					{ key: 'punishment', label: 'Punishment for breaking it', type: 'text', required: true },
				],
			},
		],
		notes: ['A contract missing its price, what it grants, or its punishment isn’t a contract.', 'Fiends have their DAP halved.'],
	},
	{
		id: 'cyberpunk',
		label: 'Cyberpunk 2077',
		universe: 'cyberpunk-2077',
		fields: [
			{ key: 'start', label: 'Start', type: 'select', options: [{ value: 'Powered' }, { value: 'Unpowered' }], required: true, help: 'Unpowered starts unlock the Mastery System.' },
			{ key: 'streetCred', label: 'Street Cred', type: 'number', default: 0, min: 0 },
			{ key: 'xp', label: 'XP (out of 100)', type: 'number', default: 0, min: 0, showIf: { key: 'start', in: ['Unpowered'] } },
			{ key: 'skillPoints', label: 'Skill Points', type: 'number', default: 0, min: 0, showIf: { key: 'start', in: ['Unpowered'] } },
			{
				key: 'cyberware',
				label: 'Cyberware',
				type: 'list',
				help: 'Starting characters can only install basic cyberware: Civilian grade, Tier 1.',
				columns: [
					{ key: 'slot', label: 'Slot', type: 'select', options: cyber.slots.map((x) => ({ value: x.id, label: `${x.id} (${x.count})` })), required: true },
					{ key: 'name', label: 'Cyberware', type: 'text', required: true },
					{ key: 'grade', label: 'Grade', type: 'select', options: cyber.grades.map((g) => ({ value: g })), required: true, default: 'Civilian' },
					{ key: 'tier', label: 'Tier', type: 'select', options: cyber.tiers.map((t) => ({ value: String(t.tier), label: `Tier ${t.tier} (level ${t.level}+)` })), required: true, default: '1' },
				],
			},
		],
		checks: (f, starting) => {
			const out: { level: 'error' | 'warning' | 'permission'; message: string }[] = [];
			const items = (Array.isArray(f.cyberware) ? f.cyberware : []) as Record<string, string>[];
			for (const slot of cyber.slots) {
				const used = items.filter((i) => i.slot === slot.id).length;
				if (used > slot.count) out.push({ level: 'error', message: `Cyberware: ${used} pieces in ${slot.id}, but it has ${slot.count} slot${slot.count === 1 ? '' : 's'}.` });
			}
			items.forEach((i, n) => {
				const label = i.name || `#${n + 1}`;
				if (starting && i.grade && !cyber.starting.grades.includes(i.grade)) {
					out.push({ level: 'error', message: `Cyberware: ${label} is ${i.grade}. Starting characters can only take Civilian cyberware.` });
				}
				if (starting && Number(i.tier) > cyber.starting.maxTier) {
					out.push({ level: 'error', message: `Cyberware: ${label} is Tier ${i.tier}. Starting characters can only take Tier ${cyber.starting.maxTier}.` });
				}
				if (i.grade === 'Modified') out.push({ level: 'permission', message: `Cyberware: ${label} is Modified (scavenged or made; making it needs Genius Intelligence).` });
			});
			return out;
		},
	},
];

export const systemById = new Map(systems.map((s) => [s.id, s]));

export const visibleFields = (def: SystemDef, f: Fields) =>
	def.fields.filter((field) => !field.showIf || field.showIf.in.includes(String(f[field.showIf.key] ?? '')));

/** Whether a card counts toward its system's one-per-character limit. */
export const countsTowardLimit = (def: SystemDef | undefined, f: Fields) =>
	!def?.limitedChoice || f[def.limitedChoice.key] === def.limitedChoice.value;
