// Equipment submissions: a player pitches a custom item for an approved character, and an admin
// approves it by writing a crafting recipe that only that character can use.
import { supabase } from '../supabase.ts';

const db = () => {
	if (!supabase) throw new Error('The portal is not connected to its database.');
	return supabase;
};
const fail = (error: { message: string } | null) => {
	if (error) throw new Error(error.message);
};

export type EquipmentType = 'weapon' | 'suit' | 'gadget' | 'other';
export type EquipmentStatus = 'pending' | 'needs_correction' | 'approved' | 'denied';
export type Requirement = '' | 'gifted' | 'genius' | 'super_genius';
export type Rarity = '' | 'common' | 'uncommon' | 'rare' | 'legendary' | 'mythic';

export const EQUIPMENT_TYPES: { id: EquipmentType; label: string }[] = [
	{ id: 'weapon', label: 'Weapon' },
	{ id: 'suit', label: 'Suit or armour' },
	{ id: 'gadget', label: 'Gadget' },
	{ id: 'other', label: 'Something else' },
];
export const REQUIREMENTS: { id: Requirement; label: string }[] = [
	{ id: '', label: 'No requirement' },
	{ id: 'gifted', label: 'Gifted Intelligence or higher' },
	{ id: 'genius', label: 'Genius Intelligence or higher' },
	{ id: 'super_genius', label: 'Super Genius Intelligence' },
];
export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'legendary', 'mythic'];
export const STATUS_TEXT: Record<EquipmentStatus, { label: string; tone: string }> = {
	pending: { label: 'In review', tone: 'info' },
	needs_correction: { label: 'Needs correction', tone: 'warn' },
	approved: { label: 'Approved', tone: 'good' },
	denied: { label: 'Denied', tone: 'bad' },
};

export interface CraftingItem {
	id: string;
	name: string;
	kind: 'component' | 'crafted_component' | 'special';
	rarity: string | null;
	description: string;
}
export const KIND_LABEL: Record<CraftingItem['kind'], string> = {
	component: 'Components',
	crafted_component: 'Crafted components',
	special: 'Special items',
};

export interface Ingredient {
	item: string;
	qty: number;
}

export interface EquipmentRequest {
	id: string;
	character_id: string;
	owner_id: string;
	name: string;
	type: EquipmentType;
	description: string;
	effects: string;
	images: string;
	ingredients: Ingredient[];
	status: EquipmentStatus;
	review_note: string;
	recipe_id: string | null;
	submitted_at: string;
	reviewed_at: string | null;
	updated_at: string;
}

export interface EquipmentDraft {
	id?: string;
	characterId: string;
	name: string;
	type: EquipmentType;
	description: string;
	effects: string;
	images: string;
	ingredients: Ingredient[];
}

/** What an admin fills in to approve: becomes the character-only recipe. */
export interface RecipeSpec {
	name: string;
	description: string;
	rarity: Rarity;
	requirement: Requirement;
	craft_minutes: number;
	effects: string;
	ingredients: Ingredient[];
}

/** The crafting catalog players can suggest as ingredients. */
export async function loadCraftingItems(): Promise<CraftingItem[]> {
	const { data, error } = await db().rpc('portal_crafting_items');
	fail(error);
	return (data ?? []) as CraftingItem[];
}

const COLUMNS = 'id, character_id, owner_id, name, type, description, effects, images, ingredients, status, review_note, recipe_id, submitted_at, reviewed_at, updated_at';

/** The logged-in player's requests, newest first. (Admins can read everyone's, so filter explicitly.) */
export async function loadMyEquipment(): Promise<EquipmentRequest[]> {
	const { data: auth } = await db().auth.getSession();
	const uid = auth.session?.user.id;
	if (!uid) return [];
	const { data, error } = await db().from('equipment_requests').select(COLUMNS).eq('owner_id', uid).order('updated_at', { ascending: false });
	fail(error);
	return (data ?? []) as EquipmentRequest[];
}

export async function loadEquipment(id: string): Promise<EquipmentRequest> {
	const { data, error } = await db().from('equipment_requests').select(COLUMNS).eq('id', id).maybeSingle();
	fail(error);
	if (!data) throw new Error('Request not found, or it isn’t yours.');
	return data as EquipmentRequest;
}

export async function submitEquipment(d: EquipmentDraft): Promise<EquipmentRequest> {
	const { data, error } = await db().rpc('submit_equipment', {
		p_id: d.id ?? null,
		p_character: d.characterId,
		p_name: d.name.trim(),
		p_type: d.type,
		p_description: d.description.trim(),
		p_effects: d.effects.trim(),
		p_images: d.images.trim(),
		p_ingredients: d.ingredients.filter((i) => i.item && i.qty > 0),
	});
	fail(error);
	return data as EquipmentRequest;
}

export async function withdrawEquipment(id: string) {
	const { data, error } = await db().from('equipment_requests').delete().eq('id', id).select('id');
	fail(error);
	if (!data?.length) throw new Error('This request can’t be withdrawn any more.');
}

// ───────────────────────────── Admin ─────────────────────────────

export interface EquipmentQueueItem extends EquipmentRequest {
	characterName: string;
	/** The character's approved Intelligence, to judge a recipe requirement. */
	intelligence: string;
}

/** Every open request (admins only; row-level security returns just your own otherwise). */
export async function loadEquipmentQueue(): Promise<EquipmentQueueItem[]> {
	const { data, error } = await db()
		.from('equipment_requests')
		.select(`${COLUMNS}, characters(name, approved_name, intelligence:approved_sheet->stats->>intelligence)`)
		.in('status', ['pending', 'needs_correction'])
		.order('submitted_at', { ascending: true });
	fail(error);
	return (data ?? []).map((r: any) => ({
		...r,
		characterName: r.characters?.approved_name || r.characters?.name || 'A character',
		intelligence: r.characters?.intelligence ?? '',
	}));
}

export async function reviewEquipment(id: string, outcome: Exclude<EquipmentStatus, 'pending'>, note: string, recipe: RecipeSpec | null) {
	const { error } = await db().rpc('review_equipment', {
		p_request: id,
		p_outcome: outcome,
		p_note: note.trim(),
		p_recipe: recipe && {
			...recipe,
			name: recipe.name.trim(),
			description: recipe.description.trim(),
			effects: recipe.effects.trim(),
			ingredients: recipe.ingredients.filter((i) => i.item && i.qty > 0),
		},
	});
	fail(error);
}
