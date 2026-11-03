// Interactive skill trees, shared by <SkillTree> (built into the page) and locked systems (drawn in
// the browser from data only granted players receive). skillTreeHtml() lays nodes out in rows by
// how many requirements deep they are; initSkillTree() wires up planning, the cost total and lines.

export interface Cost {
	amount: number;
	item: string;
}
export interface SkillNode {
	id: string;
	label: string;
	cost?: Cost[];
	requires?: string[];
	description?: string;
	/** Already owned at the start (the root of the tree). */
	start?: boolean;
}

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const format = (n: number) => n.toLocaleString('en-US');

/** The tree's markup. `colorBranches` gives each branch that begins at a starting point its own color. */
export function skillTreeHtml(id: string, nodes: SkillNode[], colorBranches = false): string {
	const byId = new Map(nodes.map((n) => [n.id, n]));

	// A starting point with a starting-point sibling begins a new branch; every node below it takes its
	// color (following each node's first requirement). Nodes above or outside such branches keep the accent.
	const palette = ['#e5484d', '#f76b15', '#e2a336', '#30a46c', '#12a594', '#0090ff', '#8e4ec6', '#d6409f'];
	const heads = new Map<string, string>();
	if (colorBranches) {
		const startKids = new Map<string, SkillNode[]>();
		for (const n of nodes) {
			const parent = n.requires?.[0];
			if (parent && n.start) (startKids.get(parent) ?? startKids.set(parent, []).get(parent)!).push(n);
		}
		for (const n of nodes) {
			const siblings = startKids.get(n.requires?.[0] ?? '');
			if (n.start && siblings && siblings.length > 1) heads.set(n.id, palette[heads.size % palette.length]);
		}
	}
	const branchColors = new Map<string, string | undefined>();
	const branchColor = (node: SkillNode): string | undefined => {
		if (!branchColors.has(node.id)) {
			const parent = byId.get(node.requires?.[0] ?? '');
			branchColors.set(node.id, heads.get(node.id) ?? (parent && branchColor(parent)));
		}
		return branchColors.get(node.id);
	};

	const depths = new Map<string, number>();
	const depth = (node: SkillNode): number => {
		if (!depths.has(node.id)) {
			const reqs = (node.requires ?? []).map((r) => byId.get(r)).filter((n) => n !== undefined);
			depths.set(node.id, reqs.length ? 1 + Math.max(...reqs.map(depth)) : 0);
		}
		return depths.get(node.id)!;
	};
	const rows: SkillNode[][] = [];
	for (const node of nodes) (rows[depth(node)] ??= []).push(node);

	const nodeHtml = (node: SkillNode) => {
		const classes = ['st-node', node.start && 'start', !node.start && !node.cost?.length && 'free'].filter(Boolean).join(' ');
		const color = branchColor(node);
		const costs = node.cost?.length
			? node.cost.map((c) => `<span class="st-cost">${format(c.amount)} ${esc(c.item)}</span>`).join('')
			: `<span class="st-cost">${node.start ? 'Starting point' : 'Free'}</span>`;
		return (
			`<button type="button" class="${classes}"${color ? ` style="--branch: ${esc(color)}"` : ''}` +
			` data-node="${esc(node.id)}" data-requires="${esc((node.requires ?? []).join(','))}"` +
			` data-cost="${esc(JSON.stringify(node.cost ?? []))}" aria-pressed="${node.start ? 'true' : 'false'}"` +
			`${node.start || !node.cost?.length ? ' disabled' : ''}>` +
			`<span class="st-label">${esc(node.label)}</span><span class="st-costs">${costs}</span>` +
			`${node.description ? `<span class="st-desc">${esc(node.description)}</span>` : ''}</button>`
		);
	};

	return (
		`<div class="skill-tree not-content" data-tree="${esc(id)}">` +
		`<div class="st-toolbar"><p class="st-total" data-total>Click a node to plan it. Its requirements must be planned first.</p>` +
		`<button type="button" class="st-reset" data-reset>Reset</button></div>` +
		`<div class="st-scroll"><div class="st-canvas" data-canvas><svg class="st-lines" data-lines aria-hidden="true"></svg>` +
		rows.map((row) => `<div class="st-row">${row.map(nodeHtml).join('')}</div>`).join('') +
		`</div></div></div>`
	);
}

/** Makes a rendered tree interactive. The planned build is saved in the visitor's browser. */
export function initSkillTree(tree: HTMLElement) {
	const key = `skill-tree:${tree.dataset.tree}`;
	const canvas = tree.querySelector<HTMLElement>('[data-canvas]')!;
	const svg = tree.querySelector<SVGSVGElement>('[data-lines]')!;
	const totalEl = tree.querySelector<HTMLElement>('[data-total]')!;
	const nodes = [...tree.querySelectorAll<HTMLButtonElement>('[data-node]')];
	const byId = new Map(nodes.map((n) => [n.dataset.node!, n]));
	const requires = (n: HTMLElement) => (n.dataset.requires ? n.dataset.requires.split(',') : []);
	const hint = totalEl.textContent;

	let planned = new Set<string>();
	try {
		planned = new Set(JSON.parse(localStorage.getItem(key) ?? '[]'));
	} catch {}
	const save = () => {
		try {
			localStorage.setItem(key, JSON.stringify([...planned]));
		} catch {}
	};

	// Free nodes are on whenever everything they require is on.
	const isOn = (n?: HTMLElement): boolean =>
		!!n &&
		(n.classList.contains('start') ||
			planned.has(n.dataset.node!) ||
			(n.classList.contains('free') && requires(n).every((r) => isOn(byId.get(r)))));

	// Unplanning a node also unplans everything that depends on it, including through free nodes.
	const unplan = (id: string) => {
		planned.delete(id);
		for (const n of nodes) {
			if (!requires(n).includes(id)) continue;
			if (planned.has(n.dataset.node!)) unplan(n.dataset.node!);
			else if (n.classList.contains('free')) unplan(n.dataset.node!);
		}
	};

	const drawLines = () => {
		svg.setAttribute('width', String(canvas.scrollWidth));
		svg.setAttribute('height', String(canvas.scrollHeight));
		let paths = '';
		for (const node of nodes) {
			for (const reqId of requires(node)) {
				const req = byId.get(reqId);
				if (!req) continue;
				const x1 = req.offsetLeft + req.offsetWidth / 2;
				const y1 = req.offsetTop + req.offsetHeight;
				const x2 = node.offsetLeft + node.offsetWidth / 2;
				const y2 = node.offsetTop;
				const mid = (y1 + y2) / 2;
				const on = isOn(req) && isOn(node);
				const color = node.style.getPropertyValue('--branch');
				const style = color ? ` style="--branch: ${color}"` : '';
				paths += `<path class="${on ? 'on' : ''}"${style} d="M${x1} ${y1} C${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}" />`;
			}
		}
		svg.innerHTML = paths;
	};

	const render = () => {
		const totals = new Map<string, number>();
		for (const node of nodes) {
			const on = isOn(node);
			const available = requires(node).every((r) => isOn(byId.get(r)));
			node.setAttribute('aria-pressed', String(on));
			node.classList.toggle('available', !on && available);
			node.classList.toggle('locked', !on && !available);
			if (on && node.dataset.cost !== '[]') {
				for (const c of JSON.parse(node.dataset.cost!) as Cost[]) {
					totals.set(c.item, (totals.get(c.item) ?? 0) + c.amount);
				}
			}
		}
		totalEl.textContent = totals.size
			? `Planned cost: ${[...totals].map(([item, n]) => `${n.toLocaleString('en-US')} ${item}`).join(' · ')}`
			: hint;
		drawLines();
	};

	for (const node of nodes) {
		node.addEventListener('click', () => {
			const id = node.dataset.node!;
			if (planned.has(id)) unplan(id);
			else if (node.classList.contains('available')) planned.add(id);
			else return;
			save();
			render();
		});
	}
	tree.querySelector('[data-reset]')!.addEventListener('click', () => {
		planned.clear();
		save();
		render();
	});

	new ResizeObserver(drawLines).observe(canvas);
	render();
	// Wide trees start scrolled to the middle so the root is in view.
	const scroller = tree.querySelector<HTMLElement>('.st-scroll')!;
	scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
}
