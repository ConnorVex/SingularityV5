// Builds src/data/portal/ranks.json from the S.T.S Phase pages, so the character portal
// uses the same ranks and values as the wiki. Run after editing a Phase page:
//   node scripts/portal-ranks.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'src/content/docs/Important Systems/Singularity Tiering System/Phases';
const out = 'src/data/portal/ranks.json';

const phaseOf = (tier) => (tier <= 2 ? 0 : tier <= 8 ? 1 : tier <= 14 ? 2 : 3);
const clean = (cell) => cell.replace(/\*\*/g, '').replace(/<[^>]*>/g, '').trim();

const ranks = [];
for (const file of readdirSync(dir).filter((f) => /^Phase \d/.test(f)).sort()) {
	for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
		// | **1F** | 1 | Strength | Speed | Defense | Stamina |
		const cells = line.trim().split('|').slice(1, -1).map(clean);
		const match = cells[0]?.match(/^(\d+)([FEDCBAS])$/);
		if (!match || cells.length < 6 || !/^\d+$/.test(cells[1])) continue;
		const tier = Number(match[1]);
		ranks.push({
			rank: cells[0],
			tier,
			phase: phaseOf(tier),
			value: Number(cells[1]),
			strength: cells[2],
			speed: cells[3],
			defense: cells[4],
			stamina: cells[5],
		});
	}
}

ranks.sort((a, b) => a.value - b.value);
const values = ranks.map((r) => r.value);
const gaps = values.filter((v, i) => i > 0 && v !== values[i - 1] + 1);
if (gaps.length) throw new Error(`Rank values are not continuous near: ${gaps.join(', ')}`);

writeFileSync(out, JSON.stringify({ source: dir, ranks }, null, '\t') + '\n');
console.log(`Wrote ${ranks.length} ranks (${ranks[0].rank} → ${ranks.at(-1).rank}) to ${out}`);
