// Run with: node --test src/lib/portal/diff.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetChanges } from './diff.ts';
import { emptySheet } from './sheet.ts';

test('lists changed stats, systems and traits with readable names', () => {
	const before = emptySheet();
	before.stats.strength = '1A';
	before.systems = [{ key: 'k', system: 'jujutsu-kaisen', fields: { ctPower: 'Grade 4' }, description: '', skills: [], rollProofs: {} }];
	before.seenCombos = ['x'];
	const after = structuredClone(before);
	after.stats.strength = '2F';
	after.systems[0].fields.ctPower = 'Grade 3';
	after.systems[0].skills.push({ name: 'Blast', type: 'standard', effect: '', mastery: '' });
	after.traits.push({ name: 'Lazy' });
	after.seenCombos.push('y');
	const changes = sheetChanges(before, after);
	const by = (w: string) => changes.find((c) => c.where === w);
	assert.deepEqual(by('Stats › Strength'), { where: 'Stats › Strength', before: '1A', after: '2F' });
	assert.deepEqual(by('Jujutsu Kaisen › Ct Power'), { where: 'Jujutsu Kaisen › Ct Power', before: 'Grade 4', after: 'Grade 3' });
	assert.ok(by('Jujutsu Kaisen › Skills › #1 › Name'));
	assert.ok(by('Traits › Lazy › Name'));
	assert.ok(!changes.some((c) => c.where.includes('Seen')), 'bookkeeping is ignored');
});

test('no changes means an empty list', () => {
	assert.deepEqual(sheetChanges(emptySheet(), emptySheet()), []);
});
