// Portal colour theme: the accent is the site accent, or a character's role colour, and fades between them.
import rulesData from '../../data/portal/rules.json' with { type: 'json' };

export interface Theme {
	color: string;
	ink: string;
}

export const defaultTheme: Theme = rulesData.defaultTheme;

export const themeForRole = (role: string | undefined | null): Theme => rulesData.roles.find((r) => r.id === role) ?? defaultTheme;

/** Applies a theme to the page (the CSS accent colours transition in portal.css). The default
 *  theme hands the accent back to the site's own colour. */
export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	if (theme === defaultTheme) {
		root.style.removeProperty('--pf-accent');
		root.style.removeProperty('--pf-ink');
		return;
	}
	root.style.setProperty('--pf-accent', theme.color);
	root.style.setProperty('--pf-ink', theme.ink);
}

/** Starts the portal look on a page. */
export function startPortalTheme(theme: Theme = defaultTheme) {
	applyTheme(theme);
}
