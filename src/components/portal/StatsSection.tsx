// S.T.S stats with live Power, Recoil and PTP counts.
import { power, ptp, rankInfo, ranks, recoil, rules } from '../../lib/portal/rules.ts';
import type { Sheet } from '../../lib/portal/sheet.ts';
import { NumberField, Section, SelectField } from './fields.tsx';

const STATS = [
	{ key: 'strength', label: 'Strength', describe: (r: (typeof ranks)[number]) => `Lifts ${r.strength}` },
	{ key: 'speed', label: 'Speed', describe: (r: (typeof ranks)[number]) => `Moves at ${r.speed}` },
	{ key: 'defense', label: 'Defense', describe: (r: (typeof ranks)[number]) => `Withstands ${r.defense}` },
	{ key: 'stamina', label: 'Stamina', describe: (r: (typeof ranks)[number]) => `${r.stamina} Stamina` },
] as const;

const rankOptions = ranks.map((r) => ({ value: r.rank, label: `${r.rank} (value ${r.value})`, group: `Tier ${r.tier}` }));

export function StatsSection({ sheet, update, readOnly, isEvolution }: { sheet: Sheet; update: (fn: (s: Sheet) => void) => void; readOnly: boolean; isEvolution: boolean }) {
	const s = sheet.stats;
	const p = power(sheet);
	const r = recoil(sheet);
	const budget = ptp(sheet);
	const phase = rules.stats.phases.find((x) => x.phase === s.phase);

	return (
		<Section
			id="stats"
			title="S.T.S stats"
			intro="Every PTP moves a stat up one Sub-Tier. Power is worked out for you."
			badge={
				<span class={`pf-badge ${!isEvolution && budget.roleKnown && budget.spent > budget.available ? 'bad' : 'ok'}`}>
					PTP {budget.spent} / {budget.roleKnown ? budget.available : '?'}
				</span>
			}
		>
			<SelectField
				label="Phase"
				required
				value={String(s.phase)}
				disabled={readOnly}
				onChange={(v) => update((x) => void (x.stats.phase = Number(v) || 0))}
				options={rules.stats.phases.map((ph) => ({ value: String(ph.phase), label: `${ph.label} (Tiers ${ph.minTier}–${ph.maxTier})` }))}
			/>
			<SelectField
				label="Intelligence"
				value={s.intelligence}
				disabled={readOnly}
				onChange={(v) => update((x) => void (x.stats.intelligence = v))}
				options={rules.stats.intelligence.map((i) => ({
					value: i.value,
					label: `${i.value} (${i.ptp > 0 ? `costs ${i.ptp}` : i.ptp < 0 ? `gives ${-i.ptp}` : '0'} PTP)${'permission' in i && i.permission ? ' 🔑' : ''}`,
				}))}
			/>
			{STATS.map((stat) => {
				const info = rankInfo(s[stat.key]);
				return (
					<SelectField
						key={stat.key}
						label={stat.label}
						required
						value={s[stat.key]}
						disabled={readOnly}
						onChange={(v) => update((x) => void (x.stats[stat.key] = v))}
						options={phase ? rankOptions.map((o) => ({ ...o, label: (rankInfo(o.value)?.tier ?? 0) > phase.maxTier ? `${o.label} ⚠ above Phase` : o.label })) : rankOptions}
						help={info ? stat.describe(info) : undefined}
					/>
				);
			})}

			<div class="pf-wide stat-summary">
				<div class="stat-tile">
					<span class="stat-tile-label">Power</span>
					<strong>{p ?? '–'}</strong>
					<span class="pf-help">(Strength + Speed) ÷ 2</span>
				</div>
				<div class={`stat-tile ${r ? 'bad' : 'ok'}`} role="status">
					<span class="stat-tile-label">Recoil</span>
					<strong>{r ? `Lv ${r.level}` : 'None'}</strong>
					<span class="pf-help">{r ? `${r.high} is ${r.gap} Sub-Tiers above ${r.low}` : 'Strength, Speed and Defense are within 2 Sub-Tiers'}</span>
				</div>
				<div class={`stat-tile ${!isEvolution && budget.roleKnown && budget.spent > budget.available ? 'bad' : 'ok'}`}>
					<span class="stat-tile-label">PTP</span>
					<strong>
						{budget.spent} spent / {budget.roleKnown ? budget.available : '?'}
					</strong>
					<span class="pf-help">
						{budget.roleKnown
							? `${budget.start} from your role + ${budget.bonus} from systems + ${Number(s.earnedPtp) || 0} earned`
							: 'Pick a role to see your starting PTP'}
					</span>
				</div>
			</div>

			<NumberField
				label="Physical meter"
				min={0}
				value={s.physicalMeter}
				disabled={readOnly}
				onInput={(v) => update((x) => void (x.stats.physicalMeter = v))}
				help="Physical Points toward your next 15 PTP."
			/>
			<NumberField
				label="PTP earned in RP"
				min={0}
				value={s.earnedPtp}
				disabled={readOnly}
				onInput={(v) => update((x) => void (x.stats.earnedPtp = v))}
				help="Total PTP you’ve earned from training since your character started."
			/>
		</Section>
	);
}
