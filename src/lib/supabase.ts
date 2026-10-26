// Browser-side connection to the character portal database (Supabase).
// Only the public URL and anon key are used here; the database's row-level security
// decides what each visitor can read or change.
import { createClient, type Session } from '@supabase/supabase-js';

// Tolerate the REST address (".../rest/v1/") being pasted instead of the project URL.
const url = (import.meta.env.PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const anonKey = (import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

export const portalConfigured = Boolean(url && anonKey);

export const supabase = portalConfigured
	? createClient(url, anonKey, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } })
	: null;

export interface Player {
	id: string;
	discordId: string;
	displayName: string;
	avatarUrl: string | null;
	isAdmin: boolean;
}

function client() {
	if (!supabase) throw new Error('The portal is not connected to its database yet.');
	return supabase;
}

/** Sends the visitor to Discord, then back to the page they were on. */
export async function logIn() {
	const { error } = await client().auth.signInWithOAuth({
		provider: 'discord',
		options: { redirectTo: location.origin + location.pathname },
	});
	if (error) throw error;
}

export async function logOut() {
	const { error } = await client().auth.signOut();
	if (error) throw error;
}

/** The logged-in player (creating their profile on first visit), or null when logged out. */
export async function currentPlayer(session?: Session | null): Promise<Player | null> {
	const db = client();
	if (session === undefined) session = (await db.auth.getSession()).data.session;
	if (!session) return null;

	const [profile, admin] = await Promise.all([db.rpc('ensure_profile'), db.rpc('is_admin')]);
	if (profile.error) throw profile.error;
	if (admin.error) throw admin.error;

	return {
		id: profile.data.id,
		discordId: profile.data.discord_id,
		displayName: profile.data.display_name,
		avatarUrl: profile.data.avatar_url,
		isAdmin: admin.data === true,
	};
}

/** Calls `callback` now and whenever the visitor logs in or out. */
export function watchPlayer(callback: (player: Player | null, error?: unknown) => void) {
	const db = client();
	let last: string | undefined;
	db.auth.onAuthStateChange((event, session) => {
		const key = session?.user.id ?? '';
		// Token refreshes fire often; only reload the player when who is logged in changes.
		if (event !== 'INITIAL_SESSION' && key === last) return;
		last = key;
		// Supabase advises not to await other calls inside this callback.
		setTimeout(() => {
			currentPlayer(session).then(
				(player) => callback(player),
				(error) => callback(null, error),
			);
		}, 0);
	});
}

/** Login problems Discord or Supabase report back in the address bar, if any. */
export function loginErrorFromUrl(): string | null {
	const params = new URLSearchParams(location.search + '&' + location.hash.slice(1));
	return params.get('error_description') ?? params.get('error');
}
