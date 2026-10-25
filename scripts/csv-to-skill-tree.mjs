// Converts a Miro board CSV export into skill tree data for <SkillTree>.
// Usage: node scripts/csv-to-skill-tree.mjs "<export.csv>" <tree-id>
// Writes src/data/skill-trees/<tree-id>.json. Miro's export has no connections, so each node's
// "requires" list starts empty and is filled in afterwards.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [csvPath, treeId] = process.argv.slice(2);
if (!csvPath || !treeId) {
	console.error('Usage: node scripts/csv-to-skill-tree.mjs "<export.csv>" <tree-id>');
	process.exit(1);
}

const slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

// "Phase 4 Upgrade 50 Blast Shards 5 Blast Cores" -> label "Phase 4 Upgrade",
// cost [{50, Blast Shards}, {5, Blast Cores}]. Costs are "<number> <Item>" pairs that run to the end
// of the text, where an item is a plural ("Blast Shards") or an abbreviation ("CEUP").
const ITEM = String.raw`(?:[A-Z][\w-]*\s+)*(?:[A-Z][\w-]*s|[A-Z]{2,})`;
const COST = new RegExp(String.raw`(\d[\d,]*)\s+(${ITEM})\b`, 'g');
const ALL_COSTS = new RegExp(String.raw`^(?:\s*\d[\d,]*\s+${ITEM})+\s*$`);
function parseNode(text) {
	let split = text.length;
	for (const m of text.matchAll(/\s(?=\d)/g)) {
		if (m.index > 0 && ALL_COSTS.test(text.slice(m.index))) {
			split = m.index;
			break;
		}
	}
	const label = text.slice(0, split).trim();
	const cost = [...text.slice(split).matchAll(COST)].map(([, n, item]) => ({ amount: Number(n.replace(/,/g, '')), item }));
	return { id: slug(label), label, ...(cost.length && { cost }), requires: [] };
}

const lines = readFileSync(csvPath, 'utf8')
	.split(/\r?\n/)
	.map((l) => l.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
	.filter(Boolean);

const nodes = lines.map(parseNode);
mkdirSync('src/data/skill-trees', { recursive: true });
const out = `src/data/skill-trees/${treeId}.json`;
writeFileSync(out, JSON.stringify({ nodes }, null, '\t') + '\n');
console.log(`Wrote ${nodes.length} nodes to ${out}`);
for (const n of nodes) console.log(`  ${n.id}: ${n.label}${n.cost ? ' (' + n.cost.map((c) => `${c.amount} ${c.item}`).join(', ') + ')' : ''}`);
