// Data for the Divine Database home page: what the player has, and what's waiting on them.
// Every read goes through row-level security, so players only ever get their own rows.
import { supabase } from '../supabase.ts';
import { loadMyCharacters, type CharacterSummary } from './api.ts';

const db = () => {
	if (!supabase) throw new Error('The portal is not connected to its database.');
	return supabase;
};

export interface Membership {
	characterId: string;
	status: 'requested' | 'active';
	familyName: string;
	familySlug: string;
}

export interface OwnedFamily {
	name: string;
	slug: string;
	status: 'pending' | 'approved' | 'needs_correction' | 'denied';
	joinRequests: number;
	tryouts: number;
	/** New characters that picked this family and wait for the owner's review. */
	reviews: number;
}

export interface AdminQueue {
	characters: number;
	families: number;
	perkRequests: number;
	equipment: number;
}

export interface HomeData {
	characters: CharacterSummary[];
	memberships: Membership[];
	family: OwnedFamily | null;
	/** Equipment requests sent back to the player for correction. */
	equipmentToFix: number;
	admin: AdminQueue | null;
}

/** Counts rows without downloading them. */
async function count(query: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
	const { count, error } = await query;
	if (error) throw new Error(error.message);
	return count ?? 0;
}

export async function loadHome(isAdmin: boolean): Promise<HomeData> {
	const { data: auth } = await db().auth.getSession();
	const uid = auth.session?.user.id;
	const characters = await loadMyCharacters();
	const ids = characters.map((c) => c.id);

	// Families arrived after the portal; if their tables aren't there, the home page still works.
	const [memberships, family] = await Promise.all([
		ids.length
			? db()
					.from('family_members')
					.select('character_id, status, families(name, slug)')
					.in('character_id', ids)
					.then(({ data }) =>
						(data ?? []).map((m: any) => ({
							characterId: m.character_id,
							status: m.status,
							familyName: m.families?.name ?? 'A family',
							familySlug: m.families?.slug ?? '',
						})),
					)
			: Promise.resolve([] as Membership[]),
		uid
			? db()
					.from('families')
					.select('id, name, slug, status')
					.eq('owner_id', uid)
					.neq('status', 'denied')
					.maybeSingle()
					.then(async ({ data: f }) => {
						if (!f) return null;
						const [joinRequests, tryouts] = await Promise.all([
							count(db().from('family_members').select('id', { count: 'exact', head: true }).eq('family_id', f.id).eq('status', 'requested')),
							count(db().from('family_tryouts').select('id', { count: 'exact', head: true }).eq('family_id', f.id).eq('status', 'pending')).catch(() => 0),
						]);
						return { name: f.name, slug: f.slug, status: f.status, joinRequests, tryouts } as OwnedFamily;
					})
			: Promise.resolve(null),
	]).catch(() => [[], null] as const);

	const equipmentToFix = uid
		? await count(db().from('equipment_requests').select('id', { count: 'exact', head: true }).eq('owner_id', uid).eq('status', 'needs_correction')).catch(() => 0)
		: 0;

	let admin: AdminQueue | null = null;
	if (isAdmin) {
		const [chars, families, perkRequests, equipment] = await Promise.all([
			count(db().from('characters').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
			count(db().from('families').select('id', { count: 'exact', head: true }).eq('status', 'pending')).catch(() => 0),
			count(db().from('family_perk_requests').select('id', { count: 'exact', head: true }).is('decided_at', null)).catch(() => 0),
			count(db().from('equipment_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')).catch(() => 0),
		]);
		admin = { characters: chars, families, perkRequests, equipment };
	}

	return { characters, memberships: [...memberships], family, equipmentToFix, admin };
}

export interface TryoutSummary {
	id: string;
	characterName: string;
	familyName: string;
	familySlug: string;
	status: 'pending' | 'accepted' | 'declined';
	ownerNote: string;
	createdAt: string;
}

export interface MyFamilies {
	family: OwnedFamily | null;
	memberships: (Membership & { characterName: string })[];
	tryouts: TryoutSummary[];
}

/** The Families tab of My Stuff: the family you own, your characters' families, and your tryouts. */
export async function loadMyFamilies(): Promise<MyFamilies> {
	const home = await loadHome(false);
	const { data: auth } = await db().auth.getSession();
	const uid = auth.session?.user.id;
	const { data } = uid
		? await db()
				.from('family_tryouts')
				.select('id, character_name, status, owner_note, created_at, families(name, slug)')
				.eq('player_id', uid)
				.order('created_at', { ascending: false })
		: { data: [] };
	const nameOf = (id: string) => home.characters.find((c) => c.id === id)?.name ?? 'A character';
	return {
		family: home.family,
		memberships: home.memberships.map((m) => ({ ...m, characterName: nameOf(m.characterId) })),
		tryouts: (data ?? []).map((t: any) => ({
			id: t.id,
			characterName: t.character_name,
			familyName: t.families?.name ?? 'A family',
			familySlug: t.families?.slug ?? '',
			status: t.status,
			ownerNote: t.owner_note ?? '',
			createdAt: t.created_at,
		})),
	};
}
