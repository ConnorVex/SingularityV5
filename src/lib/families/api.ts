// Database calls for the Family System. Row-level security (supabase/migrations/…_families.sql)
// decides what each visitor may read or change; these helpers just shape the rows.
import { supabase } from '../supabase.ts';

export type FamilyStatus = 'pending' | 'approved' | 'needs_correction' | 'denied';
export type Standing = 'sister' | 'allies' | 'friendly' | 'neutral' | 'uneasy' | 'hostile' | 'mortal_enemies';
export type Recruiting = 'open' | 'tryouts' | 'closed';
export type FoundIn = 'mainland' | 'outworld' | 'both';
export type PerkKind =
	| 'starting_stats'
	| 'trait'
	| 'trait_slots'
	| 'system_start'
	| 'locked_power'
	| 'technique'
	| 'fighting_style'
	| 'item'
	| 'rolls'
	| 'progression'
	| 'economy'
	| 'social'
	| 'other';
export type PerkAccess = 'automatic' | 'choice' | 'rolled' | 'earned' | 'taught';

export interface Family {
	id: string;
	slug: string;
	name: string;
	owner_id: string | null;
	status: FamilyStatus;
	head_name: string;
	description: string;
	lore: string;
	race: string;
	specialty: string;
	found_in: FoundIn;
	banner_url: string;
	colour: string;
	recruiting: Recruiting;
	home: string;
	special_statuses: string[];
	review_note: string;
	submitted_at: string | null;
	approved_at: string | null;
	updated_at: string;
}

export interface Division {
	id: string;
	family_id: string;
	name: string;
	description: string;
	open_spots: number;
	head_open: boolean;
	sort: number;
}

export interface Member {
	id: string;
	family_id: string;
	character_id: string | null;
	requested_by: string | null;
	status: 'requested' | 'active';
	name: string;
	division_id: string | null;
	title: string;
	relationship: string;
	image_url: string;
	message: string;
	sort: number;
	created_at: string;
}

export interface Relation {
	id: string;
	family_id: string;
	other_family_id: string | null;
	other_name: string;
	standing: Standing;
	note: string;
	sort: number;
}

export interface StandingNote {
	family_id: string;
	standing: Standing;
	note: string;
}

export interface Perk {
	id: string;
	family_id: string;
	kind: PerkKind;
	access: PerkAccess;
	title: string;
	description: string;
	/** Members only: everyone else sees it as locked. */
	hidden: boolean;
	created_at?: string;
	status?: 'pending' | 'approved' | 'denied';
	review_note?: string;
	request_id?: string | null;
	/** Set once an admin has decided it; kept when the owner changes it again. */
	reviewed_at?: string | null;
}

/** A perk as the family page shows it. Locked hidden perks come without their details. */
export type BoardPerk = Pick<Perk, 'id' | 'family_id' | 'hidden' | 'created_at' | 'title' | 'description'> & {
	unlocked: boolean;
	kind: PerkKind | null;
	access: PerkAccess | null;
};

export interface FamilyOwner {
	family_id: string;
	display_name: string;
	avatar_url: string | null;
}

export interface FamilyBundle {
	family: Family;
	divisions: Division[];
	members: Member[];
	relations: Relation[];
	notes: StandingNote[];
	/** Approved perks; hidden ones are locked unless the viewer is a member, the owner or an admin. */
	perks: BoardPerk[];
	/** Every perk with its review state (owner and admins only). */
	allPerks: Perk[];
	owner: FamilyOwner | null;
	/** Tryouts the viewer may read: their own, or all of them for the owner and admins. Empty when logged out. */
	tryouts: Tryout[];
	/** Character portraits from the gallery, by character id. */
	portraits: Record<string, string>;
}

export const STANDINGS: { id: Standing; label: string; tone: string }[] = [
	{ id: 'sister', label: 'Sister Family', tone: 'sister' },
	{ id: 'allies', label: 'Allies', tone: 'good' },
	{ id: 'friendly', label: 'Friendly', tone: 'tip' },
	{ id: 'neutral', label: 'Neutral', tone: 'muted' },
	{ id: 'uneasy', label: 'Uneasy', tone: 'info' },
	{ id: 'hostile', label: 'Hostile', tone: 'warn' },
	{ id: 'mortal_enemies', label: 'Mortal Enemies', tone: 'bad' },
];

export const PERK_KINDS: { id: PerkKind; label: string; hint: string }[] = [
	{ id: 'starting_stats', label: 'Starting stats', hint: 'Higher starting stats or extra tier points' },
	{ id: 'trait', label: 'Family trait', hint: 'A trait that runs in the family' },
	{ id: 'trait_slots', label: 'Trait slots', hint: 'Extra trait slots, or a different way to fill them' },
	{ id: 'system_start', label: 'Power system start', hint: 'A head start in a power system, like Cursed Energy or an ability' },
	{ id: 'locked_power', label: 'Family Locked power', hint: 'A technique or power only this family can hold' },
	{ id: 'technique', label: 'Secret technique', hint: 'Something the family has mastered, like a special transformation' },
	{ id: 'fighting_style', label: 'Fighting style', hint: 'A style only taught inside the family' },
	{ id: 'item', label: 'Items & vault', hint: 'Starting gear, or access to a shared vault' },
	{ id: 'rolls', label: 'Better rolls', hint: 'Extra rolls, better odds, or picking instead of rolling' },
	{ id: 'progression', label: 'Faster growth', hint: 'Quicker evolutions, mastery or training' },
	{ id: 'economy', label: 'Money', hint: 'Starting money or better earnings' },
	{ id: 'social', label: 'Standing & protection', hint: 'Contacts, a safehouse, reputation, or protection in RP' },
	{ id: 'other', label: 'Other', hint: 'Anything else' },
];

export const PERK_ACCESS: { id: PerkAccess; label: string }[] = [
	{ id: 'automatic', label: 'Every member' },
	{ id: 'choice', label: 'Members can pick it' },
	{ id: 'rolled', label: 'Rolled for' },
	{ id: 'earned', label: 'Earned in RP' },
	{ id: 'taught', label: 'Taught by a member' },
];

export const RECRUITING: Record<Recruiting, string> = { open: 'Recruiting', tryouts: 'Tryouts open', closed: 'Not recruiting' };
export const FOUND_IN: Record<FoundIn, string> = { mainland: 'Mainland', outworld: 'Outworld', both: 'Mainland & Outworld' };

/** The editable columns of a family (everything else is set by the database or admins). */
export const EDITABLE = [
	'name',
	'head_name',
	'description',
	'lore',
	'race',
	'specialty',
	'found_in',
	'banner_url',
	'colour',
	'recruiting',
	'home',
] as const;
export type FamilyFields = Pick<Family, (typeof EDITABLE)[number]>;

function db() {
	if (!supabase) throw new Error('The portal is not connected to its database yet.');
	return supabase;
}

const fail = (error: { message: string } | null) => {
	if (error) throw new Error(error.message);
};

export async function currentUserId(): Promise<string | null> {
	const { data } = await db().auth.getSession();
	return data.session?.user.id ?? null;
}

// ───────────────────────────── Reading ─────────────────────────────

export interface FamilyCard extends Family {
	memberCount: number;
	ownerName: string | null;
}

/** Every family the viewer can see (approved ones, plus their own or all for admins). */
export async function loadFamilies(): Promise<FamilyCard[]> {
	const [families, members, owners] = await Promise.all([
		db().from('families').select('*').order('name'),
		db().from('family_members').select('family_id').eq('status', 'active'),
		db().from('family_owners').select('*'),
	]);
	fail(families.error);
	fail(members.error);
	fail(owners.error);
	const counts = new Map<string, number>();
	for (const m of members.data ?? []) counts.set(m.family_id, (counts.get(m.family_id) ?? 0) + 1);
	const ownerNames = new Map((owners.data ?? []).map((o) => [o.family_id, o.display_name as string]));
	return (families.data ?? []).map((f) => ({ ...f, memberCount: counts.get(f.id) ?? 0, ownerName: ownerNames.get(f.id) ?? null }));
}

export async function loadFamily(slug: string, canManage: (f: Family) => boolean): Promise<FamilyBundle> {
	const { data: family, error } = await db().from('families').select('*').eq('slug', slug).maybeSingle();
	fail(error);
	if (!family) throw new Error('Family not found.');
	const id = family.id;
	const manage = canManage(family);
	const loggedIn = Boolean(await currentUserId());
	const [divisions, members, relations, notes, perks, allPerks, owner, tryouts] = await Promise.all([
		db().from('family_divisions').select('*').eq('family_id', id).order('sort'),
		db().from('family_members').select('*').eq('family_id', id).order('sort').order('created_at'),
		db().from('family_relations').select('*').eq('family_id', id).order('sort'),
		db().from('family_standing_notes').select('*').eq('family_id', id),
		db().from('family_perk_board').select('*').eq('family_id', id).order('created_at'),
		manage ? db().from('family_perks').select('*').eq('family_id', id).order('created_at') : Promise.resolve({ data: [], error: null }),
		db().from('family_owners').select('*').eq('family_id', id).maybeSingle(),
		loggedIn
			? db().from('family_tryouts').select('*').eq('family_id', id).order('created_at', { ascending: false })
			: Promise.resolve({ data: [], error: null }),
	]);
	for (const r of [divisions, members, relations, notes, perks, allPerks, owner, tryouts]) fail(r.error);

	const characterIds = (members.data ?? []).map((m) => m.character_id).filter(Boolean);
	const portraits: Record<string, string> = {};
	if (characterIds.length) {
		const { data } = await db().from('gallery').select('id, image:sheet->appearance->>image').in('id', characterIds);
		for (const g of data ?? []) if (g.image && /^https:\/\//.test(g.image)) portraits[g.id] = g.image;
	}
	return {
		family,
		divisions: divisions.data ?? [],
		members: members.data ?? [],
		relations: relations.data ?? [],
		notes: notes.data ?? [],
		perks: perks.data ?? [],
		allPerks: allPerks.data ?? [],
		owner: owner.data ?? null,
		tryouts: tryouts.data ?? [],
		portraits,
	};
}

/** The logged-in player's own family, if they have one (not counting denied ones). */
export async function loadMyFamily(): Promise<Family | null> {
	const uid = await currentUserId();
	if (!uid) return null;
	const { data, error } = await db().from('families').select('*').eq('owner_id', uid).neq('status', 'denied').maybeSingle();
	fail(error);
	return data;
}

export interface MyCharacter {
	id: string;
	name: string;
}

/** The player's approved characters (the ones that can join a family). */
export async function loadMyApprovedCharacters(): Promise<MyCharacter[]> {
	const uid = await currentUserId();
	if (!uid) return [];
	const { data, error } = await db()
		.from('characters')
		.select('id, name, approved_name')
		.eq('owner_id', uid)
		.not('approved_at', 'is', null)
		.neq('status', 'denied')
		.order('name');
	fail(error);
	return (data ?? []).map((c) => ({ id: c.id, name: c.approved_name || c.name }));
}

// ───────────────────────────── Founding and editing ─────────────────────────────

export async function createFamily(fields: FamilyFields): Promise<Family> {
	const { data, error } = await db().from('families').insert(fields).select('*').single();
	fail(error);
	return data;
}

export async function updateFamily(id: string, fields: Partial<FamilyFields> & { status?: FamilyStatus }): Promise<Family> {
	const { data, error } = await db().from('families').update(fields).eq('id', id).select('*').single();
	fail(error);
	return data;
}

export async function deleteFamily(id: string) {
	const { data, error } = await db().from('families').delete().eq('id', id).select('id');
	fail(error);
	if (!data?.length) throw new Error('This family can’t be deleted.');
}

/** Inserts, updates and deletes rows of one child table so it matches `rows`. */
async function sync<T extends { id?: string }>(table: string, familyId: string, before: { id: string }[], rows: T[]) {
	const keep = new Set(rows.map((r) => r.id).filter(Boolean));
	const removed = before.filter((b) => !keep.has(b.id)).map((b) => b.id);
	if (removed.length) fail((await db().from(table).delete().in('id', removed)).error);
	for (const row of rows) {
		const { id, ...rest } = row;
		const values = { ...rest, family_id: familyId };
		fail((id ? await db().from(table).update(values).eq('id', id) : await db().from(table).insert(values)).error);
	}
}

export type DivisionDraft = Omit<Division, 'id' | 'family_id'> & { id?: string };
export type RelationDraft = Omit<Relation, 'id' | 'family_id'> & { id?: string };
export type MemberDraft = Pick<Member, 'name' | 'division_id' | 'title' | 'relationship' | 'image_url' | 'sort'> & { id?: string; character_id?: string | null };
export type PerkDraft = Pick<Perk, 'kind' | 'access' | 'title' | 'description' | 'hidden'> & { id?: string };

export const saveDivisions = (familyId: string, before: Division[], rows: DivisionDraft[]) =>
	sync('family_divisions', familyId, before, rows.map((r, i) => ({ ...r, sort: i + 1 })));

export const saveRelations = (familyId: string, before: Relation[], rows: RelationDraft[]) =>
	sync('family_relations', familyId, before, rows.map((r, i) => ({ ...r, sort: i + 1 })));

/** Saves the active roster: order, divisions, titles. Requests are handled separately. */
export const saveRoster = (familyId: string, before: Member[], rows: MemberDraft[]) =>
	sync(
		'family_members',
		familyId,
		before,
		rows.map(({ character_id, ...r }, i) => ({ ...r, sort: i + 1, ...(r.id ? {} : { character_id: character_id ?? null }) })),
	);

export async function saveStandingNotes(familyId: string, notes: Partial<Record<Standing, string>>) {
	const keep = Object.entries(notes).filter(([, v]) => v && v.trim());
	const drop = STANDINGS.map((s) => s.id).filter((s) => !keep.some(([k]) => k === s));
	if (drop.length) fail((await db().from('family_standing_notes').delete().eq('family_id', familyId).in('standing', drop)).error);
	if (keep.length)
		fail((await db().from('family_standing_notes').upsert(keep.map(([standing, note]) => ({ family_id: familyId, standing, note: note!.trim() })))).error);
}

/** Removes `removed` perks, then sends every new or changed perk to the admins as one request. */
export async function sendPerks(familyId: string, perks: PerkDraft[], removed: string[], note: string) {
	if (removed.length) fail((await db().from('family_perks').delete().in('id', removed)).error);
	if (perks.length)
		fail((await db().rpc('submit_perk_request', { p_family: familyId, p_note: note, p_perks: perks.map((p) => ({ ...p, title: p.title.trim() })) })).error);
}

// ───────────────────────────── Joining ─────────────────────────────

export async function requestToJoin(familyId: string, character: MyCharacter, message: string) {
	const { error } = await db()
		.from('family_members')
		.insert({ family_id: familyId, character_id: character.id, name: character.name, message: message.trim() });
	if (error?.message.includes('duplicate key')) throw new Error(`${character.name} is already in this family or has asked to join.`);
	fail(error);
}

// ───────────────────────────── Tryouts ─────────────────────────────

/** A sample character sent to a family holding tryouts. Private to the sender, the owner and admins. */
export interface Tryout {
	id: string;
	family_id: string;
	player_id: string;
	division_id: string | null;
	character_name: string;
	image_url: string;
	about: string;
	backstory: string;
	sample: string;
	status: 'pending' | 'accepted' | 'declined';
	owner_note: string;
	created_at: string;
	reviewed_at: string | null;
}
export type TryoutDraft = Pick<Tryout, 'division_id' | 'character_name' | 'image_url' | 'about' | 'backstory' | 'sample'>;

export async function sendTryout(familyId: string, t: TryoutDraft) {
	const { error } = await db()
		.from('family_tryouts')
		.insert({
			family_id: familyId,
			division_id: t.division_id || null,
			character_name: t.character_name.trim(),
			image_url: t.image_url.trim(),
			about: t.about.trim(),
			backstory: t.backstory.trim(),
			sample: t.sample.trim(),
		});
	if (error?.message.includes('family_tryouts_one_pending')) throw new Error('You already have a tryout waiting for this family.');
	fail(error);
}

export async function decideTryout(id: string, status: 'accepted' | 'declined', note: string) {
	fail((await db().from('family_tryouts').update({ status, owner_note: note.trim() }).eq('id', id)).error);
}

export async function deleteTryout(id: string) {
	fail((await db().from('family_tryouts').delete().eq('id', id)).error);
}

export async function acceptMember(id: string) {
	fail((await db().from('family_members').update({ status: 'active' }).eq('id', id)).error);
}

/** Declines a request, kicks a member, or leaves (for the character's own player). */
export async function removeMember(id: string) {
	const { data, error } = await db().from('family_members').delete().eq('id', id).select('id');
	fail(error);
	if (!data?.length) throw new Error('You can’t remove this member.');
}

// ───────────────────────────── Admin ─────────────────────────────

export async function reviewFamily(id: string, outcome: Exclude<FamilyStatus, 'pending'>, note: string) {
	fail((await db().rpc('review_family', { p_family: id, p_outcome: outcome, p_note: note })).error);
}

export async function setFamilyAdminFields(id: string, fields: { owner_id?: string | null; special_statuses?: string[]; name?: string }) {
	fail((await db().from('families').update(fields).eq('id', id)).error);
}

/** A batch of perks an owner sent together (admins only). */
export interface PerkRequest {
	id: string;
	family_id: string;
	note: string;
	created_at: string;
	family: { name: string; slug: string } | null;
	sender: { display_name: string } | null;
	/** The perks still waiting in this request. */
	perks: Perk[];
}

export async function loadPerkQueue(): Promise<PerkRequest[]> {
	const { data, error } = await db()
		.from('family_perk_requests')
		.select('*, family:families(name, slug), sender:profiles(display_name), perks:family_perks(*)')
		.is('decided_at', null)
		.order('created_at');
	fail(error);
	return ((data ?? []) as PerkRequest[])
		.map((r) => ({ ...r, perks: r.perks.filter((p) => p.status === 'pending').sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')) }))
		.filter((r) => r.perks.length);
}

export type PerkDecision = { id: string; status: 'approved' | 'denied'; note: string };

export async function reviewPerks(requestId: string, decisions: PerkDecision[]) {
	fail((await db().rpc('review_perk_request', { p_request: requestId, p_decisions: decisions })).error);
}

export interface PlayerRow {
	id: string;
	display_name: string;
	discord_id: string;
}

/** Every player (admins only). */
export async function loadPlayers(): Promise<PlayerRow[]> {
	const { data, error } = await db().from('profiles').select('id, display_name, discord_id').order('display_name');
	fail(error);
	return data ?? [];
}

// ───────────────────────────── Display helpers ─────────────────────────────

/** Text colour that reads on top of `hex`. */
export function inkFor(hex: string): string {
	const n = parseInt(hex.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#0b0d10' : '#ffffff';
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Paragraphs plus **bold** and *italic*, with everything else escaped. */
export function richText(text: string): string {
	return text
		.trim()
		.split(/\n\s*\n/)
		.map((p) =>
			escapeHtml(p.trim())
				.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
				.replace(/\*(.+?)\*/g, '<em>$1</em>')
				.replace(/\n/g, '<br />'),
		)
		.filter(Boolean)
		.map((p) => `<p>${p}</p>`)
		.join('');
}

export const familiesBase = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}families/`;
export const familyHref = (slug: string) => `${familiesBase}view/?f=${encodeURIComponent(slug)}`;
