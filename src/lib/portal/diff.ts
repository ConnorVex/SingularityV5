// What changed between a character's approved sheet and its current one (for evolutions).
import type { Sheet } from './sheet.ts';
import { systemById } from './systems.ts';

export interface Change {
	/** Readable location, e.g. "Stats › Strength" or "Jujutsu Kaisen › Skills #2 › Name". */
	where: string;
	before: string;
	after: string;
}

// Bookkeeping that isn't part of the character.
const IGNORED = new Set(['seenCombos', 'rollProofs', 'key']);

const words = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

const show = (v: unknown) => {
	if (v === undefined || v === null || v === '') return '—';
	if (typeof v === 'object') return JSON.stringify(v);
	return String(v);
};

/** Flattens a sheet to { "a.b.0.c": value } so two versions can be compared leaf by leaf. */
function flatten(value: unknown, path: string[] = [], out = new Map<string, unknown>()) {
	if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) {
		out.set(path.join('.'), value.join(', '));
	} else if (Array.isArray(value)) {
		value.forEach((v, i) => flatten(v, [...path, String(i)], out));
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) if (!IGNORED.has(k)) flatten(v, [...path, k], out);
	} else {
		out.set(path.join('.'), value);
	}
	return out;
}

/** Turns "systems.1.fields.ctPower" into "Jujutsu Kaisen › Ct Power", using the sheet for names. */
function label(path: string, sheet: Sheet, old: Sheet): string {
	const parts = path.split('.');
	const out: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		const prev = parts[i - 1];
		if (prev === 'systems' && /^\d+$/.test(p)) {
			const entry = sheet.systems[Number(p)] ?? old.systems[Number(p)];
			out[out.length - 1] = systemById.get(entry?.system ?? '')?.label ?? 'System';
			continue;
		}
		if (prev === 'traits' && /^\d+$/.test(p)) {
			out.push((sheet.traits[Number(p)] ?? old.traits[Number(p)])?.name ?? `#${Number(p) + 1}`);
			continue;
		}
		if (/^\d+$/.test(p)) {
			out.push(`#${Number(p) + 1}`);
			continue;
		}
		if (p === 'fields') continue;
		out.push(words(p));
	}
	return out.join(' › ');
}

export function sheetChanges(before: Sheet, after: Sheet): Change[] {
	const a = flatten(before);
	const b = flatten(after);
	const changes: Change[] = [];
	for (const key of new Set([...a.keys(), ...b.keys()])) {
		const x = show(a.get(key));
		const y = show(b.get(key));
		if (x !== y) changes.push({ where: label(key, after, before), before: x, after: y });
	}
	return changes;
}
