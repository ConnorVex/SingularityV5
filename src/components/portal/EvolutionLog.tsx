// The character's approved evolutions, read-only.
import type { Sheet } from '../../lib/portal/sheet.ts';

/** The character's approved evolutions; only admins add to it, by approving an evolution. */
export function EvolutionLog({ entries }: { entries: Sheet['evolutions'] }) {
	return (
		<div class="pf-wide pf-evo-log">
			<h3 class="pf-subhead">Evolution log</h3>
			{entries.length === 0 ? (
				<p class="pf-help">No approved evolutions yet. Approved evolutions are added here automatically.</p>
			) : (
				<ol>
					{[...entries].reverse().map((ev, i) => (
						<li key={i}>
							<span class="pf-evo-date">{ev.date}</span>
							<p class="pf-evo-summary">{ev.summary}</p>
							{ev.earned && <p class="pf-help">Earned: {ev.earned}</p>}
							{ev.link
								.split(/\s+/)
								.filter((l) => /^https:\/\//.test(l))
								.map((l) => (
									<a key={l} href={l} target="_blank" rel="noopener noreferrer">
										Proof ↗
									</a>
								))}
						</li>
					))}
				</ol>
			)}
		</div>
	);
}
