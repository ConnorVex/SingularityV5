// Converts a Miro board (read as canvas SVG through the Miro connector) into skill tree data for <SkillTree>.
// Usage: node scripts/miro-to-skill-tree.mjs <board.svg> <tree-id> ["Root node label"]
// Writes src/data/skill-trees/<tree-id>.json.
//
// Every shape with text becomes a node; every connector line links two nodes, whichever way it was
// drawn. The tree is walked depth-first from the root (the given label, or the most-connected node),
// trying lines drawn outward (start -> end) before others, so each branch is followed to its end
// before any decorative line that loops back into the root is considered.
// Dashed lines mean "also requires": the node they point to needs the node they start from as well.
// Shapes without text (like a dot two lines meet at) are pass-through points, not nodes.
// "(Starter)", "(Free)" and "Free" mean the node costs nothing; any other trailing "(...)" note becomes
// the node's description. Nodes reachable from the root through cost-free nodes are owned from the start;
// deeper cost-free nodes unlock automatically in <SkillTree> once their requirements are met.
// The input can be the raw SVG or the JSON the Miro connector saves for large boards ({ svg: ... }).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [svgPath, treeId, rootLabel] = process.argv.slice(2);
if (!svgPath || !treeId) {
	console.error('Usage: node scripts/miro-to-skill-tree.mjs <board.svg> <tree-id> ["Root node label"]');
	process.exit(1);
}

const decode = (s) =>
	s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&');
const attr = (tag, name) => {
	const m = tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`));
	return m ? decode(m[1] ?? m[2]) : undefined;
};
const slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

// Costs are "<number> <Item>" pairs at the end of a node's text, where an item is a plural
// ("Blast Shards"), an abbreviation ("LP", "CEUP") or a known singular currency ("1 Blast Core"),
// which is stored in its plural form so totals add up under one name.
const SINGULAR = ['Blast Shard', 'Blast Core', 'Core Relay'];
const ITEM = String.raw`(?:${SINGULAR.join('|')}|(?:[A-Z][\w-]*\s+)*(?:[A-Z][\w-]*s|[A-Z]{2,}))`;
const AMOUNT = String.raw`\d[\d,.]*K?`;
const COST = new RegExp(String.raw`(${AMOUNT})\s+(${ITEM})\b`, 'g');
const ALL_COSTS = new RegExp(String.raw`^(?:\s*${AMOUNT}\s+${ITEM})+\s*$`);
const toNumber = (n) => Number(n.replace(/[,K]/g, '')) * (n.endsWith('K') ? 1000 : 1);
function parseText(raw) {
	let text = raw;
	const notes = [];
	// Peel trailing "(...)" notes and "Free" off the end.
	for (let m; (m = text.match(/\s*(?:\(([^()]*)\)|\b(Free))\s*$/)); ) {
		const note = (m[1] ?? m[2]).trim();
		if (!/^(starter|free)$/i.test(note)) notes.unshift(note);
		text = text.slice(0, m.index);
	}
	let split = text.length;
	for (const m of text.matchAll(/\s(?=\d)/g)) {
		if (m.index > 0 && ALL_COSTS.test(text.slice(m.index))) {
			split = m.index;
			break;
		}
	}
	const label = text.slice(0, split).trim();
	const cost = [...text.slice(split).matchAll(COST)].map(([, n, item]) => ({
		amount: toNumber(n),
		item: SINGULAR.includes(item) ? `${item}s` : item,
	}));
	return { label, cost, description: notes.join(' · ') };
}

const raw = readFileSync(svgPath, 'utf8');
const svg = raw.trimStart().startsWith('{') ? JSON.parse(raw).svg : raw;

const shapes = new Map();
const junctions = new Set();
for (const [tag] of svg.matchAll(/<(?:rect|ellipse|circle|polygon|path|text|foreignObject)\b[^>]*>/g)) {
	const id = attr(tag, 'id');
	if (!id) continue;
	// Each <p> or <br> is a line; join lines with spaces. NFKC turns styled letters (𝐁𝐨𝐥𝐝, 𝔹𝕝𝕒𝕔𝕜) into plain ones.
	const text = (attr(tag, 'data-content') ?? '')
		.replace(/<\/p>\s*<p>|<br\s*\/?>/g, ' ')
		.replace(/<[^>]+>/g, '')
		.normalize('NFKC')
		.replace(/\s+/g, ' ')
		.trim();
	if (text) shapes.set(id, text);
	else junctions.add(id);
}

// Collapse pass-through points: a line into a junction and a line out of it become one line.
const rawLines = [...svg.matchAll(/<line\b[^>]*>/g)].map(([tag]) => ({
	a: attr(tag, 'data-start'),
	b: attr(tag, 'data-end'),
	dashed: !!attr(tag, 'stroke-dasharray'),
}));
const lines = rawLines.filter((l) => !junctions.has(l.a) && !junctions.has(l.b));
for (const j of junctions) {
	const touching = rawLines.filter((l) => l.a === j || l.b === j);
	const into = touching.filter((l) => l.b === j).map((l) => l.a);
	const outOf = touching.filter((l) => l.a === j).map((l) => l.b);
	for (const a of into) for (const b of outOf) lines.push({ a, b, dashed: false });
}

const adjacency = new Map([...shapes.keys()].map((id) => [id, new Set()]));
const outgoing = new Map([...shapes.keys()].map((id) => [id, new Set()]));
const dashed = [];
for (const { a, b, dashed: isDashed } of lines) {
	if (!adjacency.has(a) || !adjacency.has(b) || a === b) continue;
	if (isDashed) {
		dashed.push([a, b]);
		continue;
	}
	adjacency.get(a).add(b);
	adjacency.get(b).add(a);
	outgoing.get(a).add(b);
}

const ids = [...shapes.keys()].filter((id) => adjacency.get(id).size > 0 || dashed.some((d) => d.includes(id)));
const root = rootLabel
	? ids.find((id) => shapes.get(id).toLowerCase().startsWith(rootLabel.toLowerCase()))
	: ids.reduce((best, id) => (adjacency.get(id).size > adjacency.get(best).size ? id : best), ids[0]);
if (!root) {
	console.error(`Root node "${rootLabel}" not found.`);
	process.exit(1);
}

// Depth-first walk from the root: each node's parent is whichever node reached it first.
const parent = new Map([[root, null]]);
const order = [];
const visit = (id) => {
	order.push(id);
	const out = [...outgoing.get(id)];
	const rest = [...adjacency.get(id)].filter((n) => !outgoing.get(id).has(n));
	for (const next of [...out, ...rest]) {
		if (!parent.has(next)) {
			parent.set(next, id);
			visit(next);
		}
	}
};
visit(root);

// Nodes only reachable through a dashed line hang off its start; then they walk on as usual.
for (let added = true; added; ) {
	added = false;
	for (const [a, b] of dashed) {
		if (parent.has(a) && !parent.has(b)) {
			parent.set(b, a);
			visit(b);
			added = true;
		}
	}
}

// Every other dashed line adds an extra requirement, unless it would point back up the node's own branch.
const extraRequires = new Map();
const isAncestor = (maybe, id) => {
	for (let p = parent.get(id); p; p = parent.get(p)) if (p === maybe) return true;
	return false;
};
for (const [a, b] of dashed) {
	if (!parent.has(a) || !parent.has(b) || parent.get(b) === a || isAncestor(b, a)) continue;
	(extraRequires.get(b) ?? extraRequires.set(b, []).get(b)).push(a);
}

const usedIds = new Set();
const nodeId = new Map();
for (const id of order) {
	let s = slug(parseText(shapes.get(id)).label) || 'node';
	for (let n = 2; usedIds.has(s); n++) s = `${slug(parseText(shapes.get(id)).label)}-${n}`;
	usedIds.add(s);
	nodeId.set(id, s);
}

// Walk in tree order (parents first) to decide what's owned from the start.
const owned = new Set();
for (const id of order) {
	const { cost } = parseText(shapes.get(id));
	if (id === root || (!cost.length && owned.has(parent.get(id)))) owned.add(id);
}

const nodes = order.map((id) => {
	const { label, cost, description } = parseText(shapes.get(id));
	const start = owned.has(id);
	return {
		id: nodeId.get(id),
		label,
		...(cost.length && { cost }),
		...(description && { description }),
		...(start && { start: true }),
		...(id !== root && { requires: [parent.get(id), ...(extraRequires.get(id) ?? [])].map((r) => nodeId.get(r)) }),
	};
});

const unconnected = [...shapes.keys()].filter((id) => !parent.has(id)).map((id) => shapes.get(id));

mkdirSync('src/data/skill-trees', { recursive: true });
const out = `src/data/skill-trees/${treeId}.json`;
writeFileSync(out, JSON.stringify({ nodes }, null, '\t') + '\n');
console.log(`Wrote ${nodes.length} nodes to ${out} (root: ${shapes.get(root)})`);
for (const n of nodes) {
	const cost = n.cost ? ` [${n.cost.map((c) => `${c.amount} ${c.item}`).join(', ')}]` : '';
	console.log(`  ${n.requires ? n.requires.join(' + ') + ' -> ' : ''}${n.id}${cost}`);
}
if (unconnected.length) console.log(`Not connected to the tree (skipped): ${unconnected.join(' | ')}`);
