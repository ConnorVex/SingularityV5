// What changed since a character's last approval, grouped by part of the sheet. Shown to the
// player on the evolution page and to reviewers on the review dashboard.
import { useMemo } from 'preact/hooks';
import { sheetChanges, type Change } from '../../lib/portal/diff.ts';
import type { Sheet } from '../../lib/portal/sheet.ts';

// Long text reads better as a toggle than squeezed side by side.
const LONG = 90;

function Value({ text, kind }: { text: string; kind: 'was' | 'now' }) {
	return <span class={`cl-value ${kind}${text === '—' ? ' empty' : ''}`}>{text === '—' ? (kind === 'was' ? 'empty' : 'removed') : text}</span>;
}

function Item({ change }: { change: Change }) {
	const field = change.where.split(' › ').slice(1).join(' › ') || change.where;
	const long = change.before.length > LONG || change.after.length > LONG;
	if (long)
		return (
			<li class="cl-item">
				<details>
					<summary>
						<span class="cl-field">{field}</span> <span class="cl-edited">rewritten</span>
					</summary>
					<p class="cl-label">Before</p>
					<p class="cl-long was">{change.before === '—' ? 'empty' : change.before}</p>
					<p class="cl-label">Now</p>
					<p class="cl-long now">{change.after === '—' ? 'removed' : change.after}</p>
				</details>
			</li>
		);
	return (
		<li class="cl-item">
			<span class="cl-field">{field}</span>
			<span class="cl-pair">
				<Value text={change.before} kind="was" />
				<span class="cl-arrow" aria-label="changed to">
					→
				</span>
				<Value text={change.after} kind="now" />
			</span>
		</li>
	);
}

export function ChangeList({ before, after }: { before: Sheet; after: Sheet }) {
	const groups = useMemo(() => {
		const map = new Map<string, Change[]>();
		for (const c of sheetChanges(before, after)) {
			// Top-level fields (role, race, priority system…) share one group.
			const group = c.where.includes(' › ') ? c.where.split(' › ')[0] : 'General';
			map.set(group, [...(map.get(group) ?? []), c]);
		}
		return [...map];
	}, [before, after]);

	if (groups.length === 0) return <p class="pf-empty">Nothing has changed since the last approval.</p>;
	return (
		<div class="cl">
			{groups.map(([group, list]) => (
				<section class="cl-group" key={group}>
					<h4>
						{group} <span class="cl-count">{list.length}</span>
					</h4>
					<ul>
						{list.map((c) => (
							<Item key={c.where} change={c} />
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

export const changeCount = (before: Sheet, after: Sheet) => sheetChanges(before, after).length;
