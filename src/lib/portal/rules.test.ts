// Run with: node --test src/lib/portal/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSheet, power, ptp, recoil, systemLimit, traitSlots, type Issue } from './rules.ts';
import { emptySheet, normalizeSheet, type Sheet } from './sheet.ts';

const ocCtx = { kind: 'oc' as const, name: 'Kaito' };

function goodSheet(): Sheet {
	const s = emptySheet();
	s.role = 'villain';
	s.appearance.description = 'Tall.';
	s.lore.backstory = 'Born somewhere.';
	s.lore.personality = 'Calm.';
	s.potential.grade = 'average';
	s.stats = { ...s.stats, phase: 0, strength: '1A', speed: '1A', defense: '1B', stamina: '1C' };
	return s;
}

const messages = (issues: Issue[], level?: Issue['level']) => issues.filter((i) => !level || i.level === level).map((i) => i.message);

test('a complete starting sheet has no errors or warnings', () => {
	assert.deepEqual(checkSheet(goodSheet(), ocCtx), []);
});

test('power is the average of Strength and Speed values', () => {
	const s = goodSheet();
	s.stats.strength = '2F'; // 7
	s.stats.speed = '1A'; // 6
	assert.equal(power(s), 6.5);
});

test('recoil follows the wiki examples', () => {
	const valid = goodSheet();
	Object.assign(valid.stats, { strength: '7A', speed: '8F', defense: '8E' });
	assert.equal(recoil(valid), null);

	const bad = goodSheet();
	Object.assign(bad.stats, { strength: '8D', speed: '6E', defense: '3B' });
	const r = recoil(bad);
	assert.equal(r?.level, 3);
	assert.equal(r?.high, 'Strength');
	assert.equal(r?.low, 'Defense');
});

test('recoil levels: 3 off = Lv 1, 4 off = Lv 2, 5+ off = Lv 3', () => {
	const s = goodSheet();
	// 1A = 6; 1D = 3, 1E = 2, 1F = 1
	for (const [defense, level] of [['1D', 1], ['1E', 2], ['1F', 3]] as const) {
		Object.assign(s.stats, { strength: '1A', speed: '1A', defense });
		assert.equal(recoil(s)?.level, level, `defense ${defense}`);
	}
	Object.assign(s.stats, { strength: '1A', speed: '1A', defense: '1C' });
	assert.equal(recoil(s), null);
});

test('PTP: role start vs spent sub-tiers, intelligence and phase hops', () => {
	const s = goodSheet(); // 1A(6)+1A(6)+1B(5)+1C(4) from 1F(1) = 5+5+4+3 = 17
	assert.deepEqual([ptp(s).spent, ptp(s).available], [17, 20]);
	s.stats.intelligence = 'Above Average';
	assert.equal(ptp(s).spent, 27);
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /spending 27 PTP, but you start with 20/);
	s.stats.earnedPtp = 50; // PTP earned in RP never counts toward a new character's budget
	assert.equal(ptp(s).available, 20);
	assert.deepEqual(checkSheet(s, { ...ocCtx, isEvolution: true }).filter((i) => /PTP/.test(i.message)), []);
	s.stats.intelligence = 'Average';
	s.stats.phase = 1;
	assert.equal(ptp(s).spent, 17 + 15);
});

test('Conduits get +10 PTP, Ghouls get none but start at 4C', () => {
	const s = goodSheet();
	s.systems = [{ key: 'a', system: 'infamous', fields: { class: 'Psychic' }, description: '', skills: [], rollProofs: {} }];
	assert.equal(ptp(s).available, 30);
	s.systems = [{ key: 'a', system: 'tokyo-ghoul', fields: { path: 'Ghoul' }, description: '', skills: [], rollProofs: {} }];
	Object.assign(s.stats, { strength: '4C', speed: '4C', defense: '1F', stamina: '1F' });
	assert.deepEqual([ptp(s).spent, ptp(s).available], [0, 0]);
});

test('trait slots by rarity, family traits take one slot', () => {
	const s = goodSheet();
	s.traits = [{ name: 'Genius' }, { name: 'Lazy' }]; // Rare 2 + Common 1
	assert.deepEqual(traitSlots(s), { used: 3, total: 4 });
	s.traits.push({ name: 'Anomalous Body' }); // Legendary 3
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /take 6 slots, but you only have 4/);
	s.traits[2].family = true;
	assert.equal(traitSlots(s).used, 4);
	assert.equal(traitSlots(s, 2).total, 6);
});

test('unknown and duplicate traits are errors', () => {
	const s = goodSheet();
	s.traits = [{ name: 'Lazy', rollProof: 'https://discord.com/x' }, { name: 'Lazy', rollProof: 'x' }, { name: 'Made Up', rollProof: 'x' }];
	const errors = messages(checkSheet(s, ocCtx), 'error').join();
	assert.match(errors, /picked twice/);
	assert.match(errors, /isn’t a known trait/);
});

test('potential limits the phase and tiers', () => {
	const s = goodSheet();
	s.potential.grade = 'limited';
	s.stats.phase = 1;
	s.stats.strength = '3F';
	const warnings = messages(checkSheet(s, ocCtx), 'warning').join();
	assert.match(warnings, /Limited Potential can’t reach Phase 1/);
	assert.match(warnings, /stops at Tier 2/);
	s.potential.grade = 'apex';
	assert.match(messages(checkSheet(s, ocCtx), 'permission').join(), /rolled by staff/);
});

test('system budgets, move limits, permission picks and required fields', () => {
	const s = goodSheet();
	s.systems = [
		{
			key: 'a',
			system: 'abilities',
			fields: { classes: ['God'], power: 'Puny', range: 'Medium' }, // 2 + 2 = 4 points: OK
			description: '',
			skills: [
				{ name: 'A', type: 'standard', effect: '', mastery: '' },
				{ name: 'B', type: 'standard', effect: '', mastery: '' },
				{ name: 'C', type: 'standard', effect: '', mastery: '' },
				{ name: 'D', type: 'passive', effect: '', mastery: '' },
			],
			rollProofs: {},
		},
	];
	let issues = checkSheet(s, ocCtx);
	assert.match(messages(issues, 'permission').join(), /God \(Ability class\(es\)\) needs permission/);
	assert.match(messages(issues, 'permission').join(), /custom passive “D”/);
	assert.match(messages(issues, 'warning').join(), /3 Standard skills, but you can start with 2/);
	assert.doesNotMatch(messages(issues).join(), /Ability Tier Points/);
	s.systems[0].fields.power = 'Insignificant'; // 3 + 2 = 5
	assert.match(messages(checkSheet(s, ocCtx), 'warning').join(), /5 Ability Tier Points spent, but you start with 4/);

	s.systems.push({ key: 'b', system: 'jojo', fields: { path: 'Stand' }, description: '', skills: [], rollProofs: {} });
	issues = checkSheet(s, ocCtx);
	assert.match(messages(issues, 'error').join(), /pick your priority system/);
	assert.match(messages(issues, 'error').join(), /fill in Stand name/);
});

test('Ghouls cannot be combined with other systems except Chainsaw Man', () => {
	const s = goodSheet();
	const ghoul = { key: 'g', system: 'tokyo-ghoul', fields: { path: 'Ghoul', kagune: 'Ukaku' }, description: '', skills: [], rollProofs: { kagune: 'https://x' } };
	s.systems = [ghoul, { key: 'c', system: 'chainsaw-man', fields: { path: 'Human with contracts', contracts: [] }, description: '', skills: [], rollProofs: {} }];
	s.prioritySystem = 'g';
	Object.assign(s.stats, { strength: '4C', speed: '4C', defense: '1F', stamina: '1F' }); // Ghouls get no PTP
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), []);
	s.systems.push({ key: 'q', system: 'quirk', fields: { type: 'Emitter' }, description: '', skills: [], rollProofs: {} });
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /can’t be combined with My Hero Academia/);
});

test('contracts need a price, what they grant and a punishment', () => {
	const s = goodSheet();
	s.systems = [
		{
			key: 'c',
			system: 'chainsaw-man',
			fields: { path: 'Human with contracts', contracts: [{ devil: 'Fox', type: 'Summoning', price: 'a finger', grants: 'bites', punishment: '' }] },
			description: '',
			skills: [],
			rollProofs: {},
		},
	];
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /Contracts #1 is missing “Punishment for breaking it”/);
});

test('full canon claims block sending, unless already held', () => {
	const s = goodSheet();
	const claims = new Map([['x', { name: 'Cloning', usedSlots: 2, maxUsers: 2 }]]);
	assert.match(messages(checkSheet(s, { ...ocCtx, claims, requestedClaims: ['x'] }), 'error').join(), /Cloning is already full \(2\/2\)/);
	assert.deepEqual(checkSheet(s, { ...ocCtx, claims, requestedClaims: ['x'], heldClaimIds: new Set(['x']) }), []);
});

test('canon tryouts use the lighter sheet', () => {
	const s = emptySheet();
	const ctx = { kind: 'canon' as const, name: 'Satoru Gojo', canonUniverse: 'jujutsu-kaisen' };
	assert.deepEqual(messages(checkSheet(s, ctx), 'error'), ['Explain how you’ll portray this character.', 'Add a short roleplay sample.']);
	s.canon = { portrayal: 'Smug.', sample: 'Throughout heaven and earth…' };
	assert.deepEqual(checkSheet(s, ctx), []);
});

test('normalizeSheet fills in missing parts', () => {
	const s = normalizeSheet({ lore: { backstory: 'x' }, systems: [{ key: 'a', system: 'quirk', fields: {} }] });
	assert.equal(s.lore.backstory, 'x');
	assert.equal(s.lore.personality, '');
	assert.deepEqual(s.systems[0].skills, []);
	assert.deepEqual(s.traits, []);
});

const card = (key: string, system: string, fields = {}, skills: { name: string; type: 'standard' | 'ultimate' | 'passive' }[] = []) => ({
	key,
	system,
	fields,
	description: '',
	skills: skills.map((s) => ({ ...s, effect: '', mastery: '' })),
	rollProofs: {},
});

test('one of each power set, except Abilities and Quirks', () => {
	const s = goodSheet();
	s.prioritySystem = 'a';
	s.systems = [card('a', 'abilities', { classes: ['Generation'] }, [{ name: 'x', type: 'standard' }]), card('b', 'abilities', { classes: ['Generation'] }, [{ name: 'y', type: 'standard' }])];
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'error').join(), /only have/);
	s.systems.push(card('c', 'fire-force', { generation: 'Second', theme: 'Ash' }), card('d', 'fire-force', { generation: 'Second', theme: 'Ash' }));
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /only have one Fire Force power set, but you have 2/);
	assert.equal(systemLimit(s, 'abilities'), Infinity);
	assert.equal(systemLimit(s, 'quirk'), Infinity);
});

test('Dual Gift allows 2 Cursed Techniques and Conduits; combinations can raise limits further', () => {
	const s = goodSheet();
	assert.equal(systemLimit(s, 'jujutsu-kaisen'), 1);
	s.traits = [{ name: 'Dual Gift' }];
	assert.equal(systemLimit(s, 'jujutsu-kaisen'), 2);
	assert.equal(systemLimit(s, 'infamous'), 2);
	assert.equal(systemLimit(s, 'jojo'), 1);
	assert.equal(systemLimit(s, 'jujutsu-kaisen', [{ 'jujutsu-kaisen': 3 }]), 3);
});

test('starting skills: at least one less than the maximum', () => {
	const s = goodSheet();
	s.systems = [card('q', 'quirk', { type: 'Emitter' }, [{ name: 'a', type: 'standard' }])]; // needs 2 standard + 1 ultimate
	const errors = messages(checkSheet(s, ocCtx), 'error').join();
	assert.match(errors, /add at least 2 Standard skills \(you have 1\)/);
	assert.match(errors, /add at least 1 Ultimate skill \(you have 0\)/);
	s.systems = [card('j', 'jujutsu-kaisen', { ceClass: 'Common', ceAmount: 100 }, [])];
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /add at least 1 Extension Technique \(you have 0\)/);
	s.systems[0].skills = [{ name: 'Ext', type: 'standard', effect: '', mastery: '' }];
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'error').join(), /Extension/);
	s.systems = [card('a', 'abilities', { classes: ['Generation'] }, [])]; // needs 1 standard, 0 ultimate
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), ['Abilities: add at least 1 Standard skill (you have 0).']);
});

test('Family Locked claims need permission', () => {
	const s = goodSheet();
	const claims = new Map([['l', { name: 'Limitless', usedSlots: 0, maxUsers: null, category: 'Family Locked' }]]);
	assert.match(messages(checkSheet(s, { ...ocCtx, claims, requestedClaims: ['l'] }), 'permission').join(), /Limitless is Family Locked/);
});

test('JoJo: only Stands are limited to one', () => {
	const s = goodSheet();
	s.prioritySystem = 'h';
	s.systems = [card('h', 'jojo', { path: 'Hamon' }), card('p', 'jojo', { path: 'Spin' }), card('v', 'jojo', { path: 'Vampire' })];
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'error').join(), /only have/);
	const stand = { path: 'Stand', standName: 'A', standDestructivePower: 'E', standSpeed: 'E', standRange: 'E', standDurability: 'E', standPrecision: 'E', standDevelopmentalPotential: 'E' };
	s.systems.push(card('s1', 'jojo', stand));
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'error').join(), /only have/);
	s.systems.push(card('s2', 'jojo', { ...stand, standName: 'B' }));
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /You can only have one Stand, but you have 2/);
});

test('traits change starting PTP: Physically Fit +5, Lazy −5, Frail Body none', () => {
	const s = goodSheet(); // Villain: 20 starting PTP, spends 17
	s.traits = [{ name: 'Physically Fit' }];
	assert.deepEqual([ptp(s).available, ptp(s).traitBonus], [25, 5]);
	s.traits = [{ name: 'Lazy' }];
	assert.equal(ptp(s).available, 15);
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /spending 17 PTP, but you start with 15 \(20 from your role, 0 from systems, -5 from traits\)/);
	s.traits = [{ name: 'Frail Body' }];
	Object.assign(s.stats, { strength: '1F', speed: '1F', defense: '1F', stamina: '1E' });
	assert.deepEqual([ptp(s).spent, ptp(s).available, ptp(s).noPtp], [0, 0, true]); // 1E Stamina is free for Frail Body
	assert.doesNotMatch(messages(checkSheet(s, ocCtx), 'error').join(), /PTP/);
	s.stats.strength = '1E';
	assert.match(messages(checkSheet(s, ocCtx), 'error').join(), /start with 0 \(none/);
});

test('a missing Cursed Energy roll is reported once', () => {
	const s = goodSheet();
	s.systems = [{ key: 'j', system: 'jujutsu-kaisen', fields: {}, description: '', skills: [{ name: 'x', type: 'standard', effect: '', mastery: '' }], rollProofs: {} }];
	const ce = messages(checkSheet(s, ocCtx), 'error').filter((m) => m.includes('Cursed Energy'));
	assert.deepEqual(ce, ['Jujutsu Kaisen: roll your Cursed Energy.']);
});

test('cyberware: slot counts, and starting characters only get Civilian Tier 1', () => {
	const s = goodSheet();
	const cyber = (items: Record<string, string>[]) => [{ key: 'c', system: 'cyberpunk', fields: { start: 'Powered', cyberware: items }, description: '', skills: [], rollProofs: {} }];
	s.systems = cyber([
		{ slot: 'Ocular', name: 'Kiroshi Optics', grade: 'Civilian', tier: '1' },
		{ slot: 'Nervous System', name: 'Reflex Tuner', grade: 'Civilian', tier: '1' },
		{ slot: 'Nervous System', name: 'Synaptic Boost', grade: 'Civilian', tier: '1' },
	]);
	assert.deepEqual(messages(checkSheet(s, ocCtx), 'error'), []);
	s.systems = cyber([
		{ slot: 'Ocular', name: 'A', grade: 'Civilian', tier: '1' },
		{ slot: 'Ocular', name: 'B', grade: 'Military', tier: '3' },
		{ slot: 'Arms', name: 'C', grade: 'Modified', tier: '1' },
	]);
	const errors = messages(checkSheet(s, ocCtx), 'error').join(' | ');
	assert.match(errors, /2 pieces in Ocular, but it has 1 slot/);
	assert.match(errors, /B is Military\. Starting characters can only take Civilian/);
	assert.match(errors, /B is Tier 3\. Starting characters can only take Tier 1/);
	assert.match(messages(checkSheet(s, ocCtx), 'permission').join(), /C is Modified/);
	// Approved characters evolving may have better cyberware; slot counts still apply.
	const evo = messages(checkSheet(s, { ...ocCtx, isEvolution: true }), 'error').join(' | ');
	assert.doesNotMatch(evo, /Starting characters/);
	assert.match(evo, /2 pieces in Ocular/);
});
