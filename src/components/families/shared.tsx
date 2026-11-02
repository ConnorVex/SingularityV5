// Small pieces shared by the family pages.
import { useEffect } from 'preact/hooks';
import { inkFor, type FamilyStatus } from '../../lib/families/api.ts';
import { applyTheme, defaultTheme, startPortalTheme } from '../../lib/portal/theme.ts';
import { logIn } from '../../lib/supabase.ts';

export const messageOf = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

/** Portal look (rain + accent), tinted with the family's colour when there is one. */
export function useFamilyTheme(colour: string | null | undefined) {
	useEffect(() => startPortalTheme(), []);
	useEffect(() => {
		applyTheme(colour && /^#[0-9a-f]{6}$/i.test(colour) ? { color: colour, ink: inkFor(colour) } : defaultTheme);
	}, [colour]);
}

export const STATUS_TEXT: Record<FamilyStatus, { label: string; help: string }> = {
	pending: { label: 'In review', help: 'An admin will look at your family soon. You can still edit it.' },
	approved: { label: 'Approved', help: 'Listed in the Family Directory.' },
	needs_correction: { label: 'Needs changes', help: 'An admin sent your family back. Make the changes and send it again.' },
	denied: { label: 'Denied', help: 'This family was denied.' },
};

export function StatusBanner({ status, note }: { status: FamilyStatus; note?: string }) {
	if (status === 'approved') return null;
	return (
		<div class={`pf-status status-${status}`} role="status">
			<strong>{STATUS_TEXT[status].label}</strong> · {STATUS_TEXT[status].help}
			{note && <p class="fm-note">Admin note: {note}</p>}
		</div>
	);
}

export function LoginCard({ text, onError }: { text: string; onError: (m: string) => void }) {
	return (
		<div class="portal-card">
			<p>{text}</p>
			<button type="button" class="portal-button discord" onClick={() => logIn().catch((e) => onError(messageOf(e)))}>
				Log in with Discord
			</button>
		</div>
	);
}

/** A row of label/value tiles, like the character HUD. */
export function FactTiles({ items }: { items: { label: string; value: string | number | null | undefined }[] }) {
	const shown = items.filter((i) => i.value !== null && i.value !== undefined && i.value !== '');
	return (
		<dl class="fm-facts">
			{shown.map((i) => (
				<div class="fm-fact" key={i.label}>
					<dt>{i.label}</dt>
					<dd>{i.value}</dd>
				</div>
			))}
		</dl>
	);
}
