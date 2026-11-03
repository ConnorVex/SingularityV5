// Locked (Permission Based) systems. Players log in with Discord through the Divine Database's
// Supabase project; row-level security only sends a system's pages to players who have access,
// so nothing locked is ever in the Index's own HTML.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const anonKey = (import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

let client: SupabaseClient | null = null;

/** The shared Supabase client, or null when the build has no database settings. */
export function db() {
	if (!client && url && anonKey) {
		client = createClient(url, anonKey, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } });
	}
	return client;
}

export interface LockedPage {
	slug: string;
	title: string;
	body: string;
}

export interface Viewer {
	loggedIn: boolean;
	isAdmin: boolean;
	/** Slugs of the locked systems this viewer can open. */
	systems: string[];
}

/** Who's looking: logged in or not, admin or not, and which locked systems they can open. */
export async function viewer(): Promise<Viewer> {
	const sb = db();
	if (!sb) return { loggedIn: false, isAdmin: false, systems: [] };
	const { session } = (await sb.auth.getSession()).data;
	if (!session) return { loggedIn: false, isAdmin: false, systems: [] };

	// ensure_profile makes the profile admins grant access to, for first-time players.
	const [, admin, systems] = await Promise.all([sb.rpc('ensure_profile'), sb.rpc('is_admin'), sb.rpc('my_locked_systems')]);
	return {
		loggedIn: true,
		isAdmin: admin.data === true,
		systems: ((systems.data ?? []) as unknown[]).map((row) => (typeof row === 'string' ? row : String(Object.values(row as object)[0]))),
	};
}

/** Sends the visitor to Discord, then back to this page. */
export async function logIn() {
	const sb = db();
	if (!sb) throw new Error('Logging in is not set up on this build.');
	const { error } = await sb.auth.signInWithOAuth({
		provider: 'discord',
		options: { redirectTo: location.origin + location.pathname },
	});
	if (error) throw error;
}

export async function logOut() {
	await db()?.auth.signOut();
}

export async function lockedPages(system: string): Promise<LockedPage[]> {
	const sb = db();
	if (!sb) return [];
	const { data, error } = await sb.from('locked_pages').select('slug, title, body').eq('system', system).order('sort');
	if (error) throw error;
	return data ?? [];
}

export interface Player {
	profile_id: string;
	display_name: string;
	discord_id: string;
	avatar_url: string | null;
	granted_at?: string;
}

export async function accessList(system: string): Promise<Player[]> {
	const { data, error } = await db()!.rpc('system_access_list', { p_system: system });
	if (error) throw error;
	return data ?? [];
}

export async function findPlayers(query: string): Promise<Player[]> {
	const { data, error } = await db()!.rpc('find_players', { p_query: query });
	if (error) throw error;
	return data ?? [];
}

export async function setAccess(system: string, profile: string, grant: boolean) {
	const { error } = await db()!.rpc(grant ? 'grant_system_access' : 'revoke_system_access', {
		p_system: system,
		p_profile: profile,
	});
	if (error) throw error;
}

const GLYPHS = '█▓▒░#%&@$ΣΞΨλ¥§╳╱╲⌁⌇特異点01';

/**
 * Keeps an element's text shifting through random glyphs, with flickers of the real text.
 * With reduced motion it's scrambled once and left still. Returns a stop function.
 */
export function glitchText(el: HTMLElement, text: string) {
	const scramble = (reveal: number) =>
		[...text].map((ch) => (ch === ' ' || Math.random() < reveal ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('');
	el.setAttribute('aria-hidden', 'true');
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
		el.textContent = scramble(0.3);
		return () => {};
	}
	let tick = 0;
	const timer = setInterval(() => {
		tick++;
		// Every so often the real name almost resolves, then breaks apart again.
		el.textContent = scramble(tick % 24 < 3 ? 0.85 : 0.15);
	}, 90);
	return () => clearInterval(timer);
}
