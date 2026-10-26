// S.T.S stats as a control panel: stat rows with bars, Calculated Power, Recoil, PTP and a radar.
import { useId, useState } from 'preact/hooks';
import { power, ptp, rankInfo, ranks, recoil, rules } from '../../lib/portal/rules.ts';
import type { Sheet } from '../../lib/portal/sheet.ts';
import { NumberField, Section, SelectField } from './fields.tsx';

type Rank = (typeof ranks)[number];
const STATS = [
	{ key: 'strength', label: 'Strength', short: 'STR', describe: (r: Rank) => `Lifts ${r.strength}` },
	{ key: 'speed', label: 'Speed', short: 'SPD', describe: (r: Rank) => `Moves at ${r.speed}` },
	{ key: 'defense', label: 'Defense', short: 'DEF', describe: (r: Rank) => `Withstands ${r.defense}` },
	{ key: 'stamina', label: 'Stamina', short: 'STM', describe: (r: Rank) => `${r.stamina} Stamina` },
] as const;

const INTEL = rules.stats.intelligence;
const rankOptions = ranks.map((r) => ({ value: r.rank, label: `${r.rank} · ${r.value}`, group: `Tier ${r.tier}` }));
/** Bars and radar are scaled to the top rank of the character's Phase. */
const phaseTopValue = (phase: number) => {
	const maxTier = rules.stats.phases.find((p) => p.phase === phase)?.maxTier ?? 2;
	return Math.max(...ranks.filter((r) => r.tier <= maxTier).map((r) => r.value));
};

function StatRow(props: { label: string; value: string; options: { value: string; label: string; group?: string }[]; fill: number; detail?: string; onChange: (v: string) => void; disabled: boolean }) {
	const id = useId();
	return (
		<div class="hud-stat">
			<div class="hud-stat-head">
				<label for={id} class="hud-stat-label">
					{props.label}
				</label>
				<select id={id} class="hud-stat-select" value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.currentTarget.value)}>
					<option value="">—</option>
					{[...new Set(props.options.map((o) => o.group ?? ''))].map((g) =>
						g ? (
							<optgroup key={g} label={g}>
								{props.options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
							</optgroup>
						) : (
							props.options.filter((o) => !o.group).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
						),
					)}
				</select>
			</div>
			<div class="hud-bar" aria-hidden="true">
				<span style={{ width: `${Math.max(0, Math.min(1, props.fill)) * 100}%` }} />
			</div>
			{props.detail && <p class="hud-stat-detail">{props.detail}</p>}
		</div>
	);
}

/** Five-axis profile of the character, scaled to their Phase. Exact numbers are in the rows beside it. */
function Radar({ axes }: { axes: { short: string; label: string; fill: number; text: string }[] }) {
	const [hover, setHover] = useState<number | null>(null);
	const size = 300;
	const c = size / 2;
	const r = 100;
	const point = (i: number, f: number) => {
		const a = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
		return [c + Math.cos(a) * r * f, c + Math.sin(a) * r * f] as const;
	};
	const ring = (f: number) => axes.map((_, i) => point(i, f).join(',')).join(' ');
	const shape = axes.map((a, i) => point(i, Math.max(0.04, Math.min(1, a.fill))).join(',')).join(' ');
	return (
		<figure class="hud-radar">
			<svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Stat profile: ${axes.map((a) => `${a.label} ${a.text}`).join(', ')}`}>
				{[0.25, 0.5, 0.75, 1].map((f) => (
					<polygon key={f} points={ring(f)} class="hud-radar-ring" />
				))}
				{axes.map((_, i) => {
					const [x, y] = point(i, 1);
					return <line key={i} x1={c} y1={c} x2={x} y2={y} class="hud-radar-ring" />;
				})}
				<polygon points={shape} class="hud-radar-shape" />
				{axes.map((a, i) => {
					const [x, y] = point(i, Math.max(0.04, Math.min(1, a.fill)));
					const [lx, ly] = point(i, 1.22);
					return (
						<g key={a.short} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
							<circle cx={x} cy={y} r={14} class="hud-radar-hit" />
							<circle cx={x} cy={y} r={hover === i ? 6 : 4} class="hud-radar-dot" />
							<text x={lx} y={ly} class="hud-radar-label" text-anchor="middle" dominant-baseline="middle">
								{a.short}
							</text>
						</g>
					);
				})}
				{hover !== null && (
					<g class="hud-radar-tip" pointer-events="none">
						<rect x={c - 70} y={size - 34} width={140} height={26} rx={6} />
						<text x={c} y={size - 21} text-anchor="middle" dominant-baseline="middle">
							{axes[hover].label}: {axes[hover].text}
						</text>
					</g>
				)}
			</svg>
		</figure>
	);
}

export function StatsSection({ sheet, update, readOnly, isEvolution }: { sheet: Sheet; update: (fn: (s: Sheet) => void) => void; readOnly: boolean; isEvolution: boolean }) {
	const s = sheet.stats;
	const p = power(sheet);
	const r = recoil(sheet);
	const budget = ptp(sheet);
	const top = phaseTopValue(s.phase);
	const overBudget = !isEvolution && budget.roleKnown && budget.spent > budget.available;
	const intelIndex = Math.max(0, INTEL.findIndex((i) => i.value === s.intelligence));
	const phase = rules.stats.phases.find((x) => x.phase === s.phase);

	const axes = [
		...STATS.map((stat) => {
			const info = rankInfo(s[stat.key]);
			return { short: stat.short, label: stat.label, fill: info ? info.value / top : 0, text: info ? `${info.rank} (${info.value})` : 'not set' };
		}),
		{ short: 'INT', label: 'Intelligence', fill: intelIndex / (INTEL.length - 1), text: s.intelligence || 'Average' },
	];

	return (
		<Section id="stats" title="S.T.S stats" intro="Spend your starting PTP: each one moves a stat up one Sub-Tier. Bars fill toward the top of your Phase.">
			<div class="hud-split pf-wide">
				<div class="hud-panel">
					<h3 class="hud-panel-title">Parameter tuning</h3>
					{STATS.map((stat) => {
						const info = rankInfo(s[stat.key]);
						const above = info && phase && info.tier > phase.maxTier;
						return (
							<StatRow
								key={stat.key}
								label={stat.label}
								value={s[stat.key]}
								options={rankOptions}
								fill={info ? info.value / top : 0}
								detail={info ? `${stat.describe(info)}${above ? ' · ⚠ above your Phase' : ''}` : 'Pick a rank'}
								disabled={readOnly}
								onChange={(v) => update((x) => void (x.stats[stat.key] = v))}
							/>
						);
					})}
					<StatRow
						label="Intelligence"
						value={s.intelligence}
						options={INTEL.map((i) => ({
							value: i.value,
							label: `${i.value} (${i.ptp > 0 ? `−${i.ptp}` : i.ptp < 0 ? `+${-i.ptp}` : '0'} PTP)${'permission' in i && i.permission ? ' 🔑' : ''}`,
						}))}
						fill={intelIndex / (INTEL.length - 1)}
						disabled={readOnly}
						onChange={(v) => update((x) => void (x.stats.intelligence = v))}
					/>
				</div>

				<div class="hud-panel hud-readout">
					<div class="hud-tiles">
						<div class="hud-tile accent">
							<span class="hud-tile-label">Calculated power</span>
							<strong>{p ?? '—'}</strong>
							<span class="hud-tile-sub">(Strength + Speed) ÷ 2</span>
						</div>
						<div class={`hud-tile ${r ? 'bad' : ''}`} role="status">
							<span class="hud-tile-label">Recoil</span>
							<strong>{r ? `LV ${r.level}` : 'None'}</strong>
							<span class="hud-tile-sub">{r ? `${r.high} is ${r.gap} above ${r.low}` : 'Str / Spd / Def balanced'}</span>
						</div>
						<div class={`hud-tile ${overBudget ? 'bad' : ''}`}>
							<span class="hud-tile-label">PTP</span>
							<strong>
								{budget.spent}
								<small> / {budget.roleKnown ? budget.available : '?'}</small>
							</strong>
							<span class="hud-tile-sub">
								{!budget.roleKnown
									? 'Pick a role first'
									: budget.noPtp
										? 'No starting PTP (trait or system)'
										: `${budget.start} role + ${budget.bonus} systems ${budget.traitBonus < 0 ? '−' : '+'} ${Math.abs(budget.traitBonus)} traits`}
							</span>
						</div>
					</div>
					<Radar axes={axes} />
				</div>
			</div>

			<SelectField
				label="Phase"
				required
				value={String(s.phase)}
				disabled={readOnly}
				onChange={(v) => update((x) => void (x.stats.phase = Number(v) || 0))}
				options={rules.stats.phases.map((ph) => ({ value: String(ph.phase), label: `${ph.label} (Tiers ${ph.minTier}–${ph.maxTier})` }))}
			/>
			<NumberField
				label="Physical meter"
				min={0}
				value={s.physicalMeter}
				disabled={readOnly}
				onInput={(v) => update((x) => void (x.stats.physicalMeter = v))}
				help="Physical Points toward your next 15 PTP."
			/>
		</Section>
	);
}
