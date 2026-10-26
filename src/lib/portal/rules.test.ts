// Run with: node --test src/lib/portal/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSheet, power, ptp, recoil, traitSlots, type Issue } from './rules.ts';
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
	assert.match(messages(checkSheet(s, ocCtx), 'warning').join(), /Spending 27 PTP but only 20/);
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
	assert.match(messages(checkSheet(s, ocCtx)).join(), /take 6 slots, but you have 4/);
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
