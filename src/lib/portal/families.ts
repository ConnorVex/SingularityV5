// Family data the character form needs: which families a character can join, the player's
// tryouts, and the character's current memberships. Row-level security limits every read.
import { supabase } from '../supabase.ts';

const db = () => {
	if (!supabase) throw new Error('The portal is not connected to its database.');
	return supabase;
};

export interface JoinableFamily {
	id: string;
	slug: string;
	name: string;
	description: string;
	colour: string;
	banner_url: string;
	recruiting: 'open' | 'tryouts' | 'closed';
}

export interface MyTryout {
	id: string;
	family_id: string;
	character_name: string;
	image_url: string;
	about: string;
	backstory: string;
	status: 'pending' | 'accepted' | 'declined';
}

export interface CharacterMembership {
	family_id: string;
	status: 'requested' | 'active';
}

export interface FamilyChoices {
	families: JoinableFamily[];
	tryouts: MyTryout[];
	memberships: CharacterMembership[];
}

/** Everything the Families step shows. Families came after the portal, so a missing table
 * just means an empty step. */
export async function loadFamilyChoices(characterId: string | null): Promise<FamilyChoices> {
	const { data: auth } = await db().auth.getSession();
	const uid = auth.session?.user.id;
	const [families, tryouts, memberships] = await Promise.all([
		db().from('families').select('id, slug, name, description, colour, banner_url, recruiting').eq('status', 'approved').order('name'),
		uid
			? db().from('family_tryouts').select('id, family_id, character_name, image_url, about, backstory, status').eq('player_id', uid).order('created_at', { ascending: false })
			: Promise.resolve({ data: [], error: null }),
		characterId ? db().from('family_members').select('family_id, status').eq('character_id', characterId) : Promise.resolve({ data: [], error: null }),
	]);
	return {
		families: (families.data ?? []) as JoinableFamily[],
		tryouts: (tryouts.data ?? []) as MyTryout[],
		memberships: (memberships.data ?? []) as CharacterMembership[],
	};
}

/** Whether the player may pick this family, and why not. */
export function joinBlock(family: JoinableFamily, tryouts: MyTryout[]): string | null {
	const passed = tryouts.some((t) => t.family_id === family.id && t.status === 'accepted');
	if (passed || family.recruiting === 'open') return null;
	if (family.recruiting === 'tryouts') return 'Holds tryouts: send a tryout from its page first.';
	return 'Not recruiting right now.';
}
