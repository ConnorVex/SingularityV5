// Portal colour theme: the accent follows the character's role and fades between roles.
import rulesData from '../../data/portal/rules.json' with { type: 'json' };
import { setMatrixColor, startMatrix } from './matrix.ts';

export interface Theme {
	color: string;
	ink: string;
}

export const defaultTheme: Theme = rulesData.defaultTheme;

export const themeForRole = (role: string | undefined | null): Theme => rulesData.roles.find((r) => r.id === role) ?? defaultTheme;

/** Applies a theme to the page: CSS accent colours (which transition in portal.css) and the rain. */
export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	root.style.setProperty('--pf-accent', theme.color);
	root.style.setProperty('--pf-ink', theme.ink);
	setMatrixColor(theme.color);
}

/** Starts the portal look (rain + default colours) on a page. */
export function startPortalTheme(theme: Theme = defaultTheme) {
	startMatrix(theme.color);
	applyTheme(theme);
}
