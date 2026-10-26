-- Singularity character portal: starting data.
--
-- Run after 20261026120000_portal_schema.sql, in the SQL Editor.
-- Safe to run again: existing rows are left alone.
--
-- The canon claims below are copied from the wiki's canon pages as of 2026-10-26.
-- Holders from before the portal are counted in manual_users. Edit any of it later
-- from the admin dashboard.


-- ───────────────────────────── Admins ─────────────────────────────

insert into public.admins (discord_id, label) values
	('530159153482694666', 'Owner'),
	('438334230653829120', 'Minako'),
	('1106763623860273163', 'Geeked'),
	('820901708350619679', 'Tamaki')
on conflict (discord_id) do nothing;


-- ───────────────────────────── Universes ─────────────────────────────

insert into public.universes (slug, name, ability_label, sort_order) values
	('chainsaw-man', 'Chainsaw Man', null, 10),
	('cyberpunk-2077', 'Cyberpunk 2077', null, 20),
	('fire-force', 'Fire Force', 'Ignition Ability', 30),
	('infamous', 'inFAMOUS', 'Conduit', 40),
	('jojo', 'JoJo''s Bizarre Adventure', 'Stand', 50),
	('jujutsu-kaisen', 'Jujutsu Kaisen', 'Cursed Technique', 60),
	('my-hero-academia', 'My Hero Academia', 'Quirk', 70),
	('tokyo-ghoul', 'Tokyo Ghoul', null, 80)
on conflict (slug) do nothing;


-- ───────────────────────────── Claimed canon characters ─────────────────────────────

insert into public.claimables (universe, claim_type, name, max_users, manual_users, sort_order)
select universe, 'character', name, 1, 1, ord
from (values
	('cyberpunk-2077', 'Victor Vector', 1),
	('cyberpunk-2077', 'Doc', 2),
	('fire-force', 'Tamaki Kotatsu', 1),
	('jujutsu-kaisen', 'Satoru Gojo', 1),
	('jujutsu-kaisen', 'Maki Zen''in', 2),
	('jujutsu-kaisen', 'Shoko Ieiri', 3),
	('jujutsu-kaisen', 'Toji Fushiguro', 4),
	('jujutsu-kaisen', 'Yuki Tsukumo', 5),
	('jujutsu-kaisen', 'Utahime Iori', 6),
	('jujutsu-kaisen', 'Kento Nanami', 7),
	('my-hero-academia', 'Moe Kamaji', 1),
	('my-hero-academia', 'Nemuri Kayama', 2),
	('my-hero-academia', 'Kaina Tsutsumi', 3),
	('my-hero-academia', 'Ryuko Tsuchikawa', 4)
) as v (universe, name, ord)
on conflict (universe, claim_type, lower(name)) do nothing;


-- ───────────────────────────── Claimed canon abilities ─────────────────────────────

insert into public.claimables (universe, claim_type, category, name, max_users, manual_users, note, sort_order)
select universe, 'ability', category, name, max_users, manual_users, note, ord
from (values
	-- Fire Force: all Pillar Ignitions are claimed.
	('fire-force', 'Pillar', 'Twin Kitsune', 1, 1, '', 1),
	('fire-force', 'Pillar', 'Sputter and Flair', 1, 1, '', 2),
	('fire-force', 'Pillar', 'Iai Hand Sword', 1, 1, '', 3),
	('fire-force', 'Pillar', 'Excalibur', 1, 1, '', 4),
	('fire-force', 'Pillar', 'Four Card Kind', 1, 1, '', 5),
	('fire-force', 'Pillar', 'Buff Stacking', 1, 1, '', 6),
	('fire-force', 'Pillar', 'Absorption', 1, 1, '', 7),
	('fire-force', 'Pillar', 'Black Smoke', 1, 1, '', 8),
	('fire-force', 'Pillar', 'Voltage Nova', 1, 1, '', 9),
	('fire-force', 'Pillar', 'Flaming Ink', 1, 1, '', 10),
	('fire-force', 'Pillar', 'Arrow', 1, 1, '', 11),
	('fire-force', 'Pillar', 'Scale Shield', 1, 1, '', 12),

	-- inFAMOUS conduits.
	('infamous', 'Regular Conduits', 'Neon', 1, 1, '', 1),
	('infamous', 'Regular Conduits', 'Paper', 1, 1, '', 2),
	('infamous', 'Regular Conduits', 'Electrokinesis', 1, 1, '', 3),
	('infamous', 'Regular Conduits', 'Ice', 1, 1, '', 4),
	('infamous', 'Regular Conduits', 'Smoke', 1, 1, '', 5),
	('infamous', 'Family Conduits', 'Video', 1, 1, '', 6),
	('infamous', 'Family Conduits', 'Concrete', 1, 1, '', 7),

	-- JoJo canon Stands, grouped by Part.
	('jojo', 'Stardust Crusaders', 'The World', 1, 1, '', 1),
	('jojo', 'Stardust Crusaders', 'Silver Chariot', 1, 1, '', 2),
	('jojo', 'Stardust Crusaders', 'Hierophant Green', 1, 1, '', 3),
	('jojo', 'Stardust Crusaders', 'Emperor', 1, 1, '', 4),
	('jojo', 'Stardust Crusaders', 'Cream', 1, 1, '', 5),
	('jojo', 'Diamond Is Unbreakable', 'The Hand', 1, 1, '', 6),
	('jojo', 'Diamond Is Unbreakable', 'Heaven''s Door', 1, 1, '', 7),
	('jojo', 'Diamond Is Unbreakable', 'Killer Queen', 1, 1, '', 8),
	('jojo', 'Diamond Is Unbreakable', 'Crazy Diamond', 1, 1, '', 9),
	('jojo', 'Golden Wind', 'Golden Experience', 1, 1, '', 10),
	('jojo', 'Golden Wind', 'King Crimson', 1, 1, '', 11),
	('jojo', 'Golden Wind', 'Spice Girl', 1, 1, '', 12),
	('jojo', 'Golden Wind', 'Aerosmith', 1, 1, '', 13),
	('jojo', 'Golden Wind', 'Sex Pistols', 1, 1, '', 14),
	('jojo', 'Golden Wind', 'Purple Haze', 1, 1, '', 15),
	('jojo', 'Stone Ocean', 'Whitesnake', 1, 1, 'Includes variants', 16),
	('jojo', 'Stone Ocean', 'Weather Report', 1, 1, 'Includes variant', 17),
	('jojo', 'Steel Ball Run', 'Dirty Deeds Done Dirt Cheap', 1, 1, '', 18),
	('jojo', 'Steel Ball Run', 'Mandom', 1, 1, '', 19),
	('jojo', 'Steel Ball Run', 'THE WORLD: AU', 1, 1, '', 20),

	-- Jujutsu Kaisen innate techniques: at most 2 users each (canon characters don't count).
	('jujutsu-kaisen', 'Standard', 'Moon Dregs', 2, 1, '', 1),
	('jujutsu-kaisen', 'Standard', 'Cloning', 2, 2, '', 2),
	('jujutsu-kaisen', 'Standard', 'Heart Catch', 2, 1, '', 3),
	('jujutsu-kaisen', 'Standard', 'Paralyzing Gaze', 2, 1, '', 4),
	('jujutsu-kaisen', 'Standard', 'Construction', 2, 2, '', 5),
	('jujutsu-kaisen', 'Standard', 'Pain Killer', 2, 1, '', 6),
	('jujutsu-kaisen', 'Standard', 'Contractual Recreation', 2, 1, '', 7),
	('jujutsu-kaisen', 'Standard', 'Black Bird Manipulation', 2, 2, '', 8),
	('jujutsu-kaisen', 'Standard', 'Inverse', 2, 1, '', 9),
	('jujutsu-kaisen', 'Standard', 'G-Warstaff', 2, 1, '', 10),
	('jujutsu-kaisen', 'Standard', 'Love Rendezvous', 2, 1, '', 11),
	('jujutsu-kaisen', 'Standard', 'Cursed Energy Discharge', 2, 1, '', 12),
	('jujutsu-kaisen', 'Permission Based', 'Technique Extinguishment', 2, 1, '', 13),
	('jujutsu-kaisen', 'Permission Based', 'Sky Manipulation', 2, 1, '', 14),
	('jujutsu-kaisen', 'Permission Based', 'Ice Formation', 2, 2, '', 15),
	('jujutsu-kaisen', 'Permission Based', 'Disaster Flames', 2, 1, '', 16),
	('jujutsu-kaisen', 'Permission Based', 'Idle Transfiguration', 2, 2, '', 17),
	('jujutsu-kaisen', 'Permission Based', 'Mythical Beast Amber', 2, 1, '', 18),
	('jujutsu-kaisen', 'Permission Based', 'Copy', 2, 2, '', 19),
	('jujutsu-kaisen', 'Permission Based', 'Deadly Sentencing', 2, 2, '', 20),
	('jujutsu-kaisen', 'Permission Based', 'Ratio', 2, 2, '', 21),
	('jujutsu-kaisen', 'Permission Based', 'Puppet Manipulation', 2, 1, '', 22),
	('jujutsu-kaisen', 'Permission Based', 'Cursed Spirit Manipulation', 2, 1, 'Also a Tryout', 23),
	('jujutsu-kaisen', 'Permission Based', 'Star Rage', 2, 1, '', 24),
	('jujutsu-kaisen', 'Family Locked', 'Shrine', null, 0, 'Join the family that holds it', 25),
	('jujutsu-kaisen', 'Family Locked', 'Limitless', null, 0, 'Join the family that holds it', 26),
	('jujutsu-kaisen', 'Family Locked', 'Prayer Song', null, 0, 'Join the family that holds it', 27),
	('jujutsu-kaisen', 'Family Locked', 'Projection Sorcery', null, 0, 'Join the family that holds it', 28),
	('jujutsu-kaisen', 'Family Locked', 'Ten Shadows', null, 0, 'Join the family that holds it', 29),
	('jujutsu-kaisen', 'Family Locked', 'Cursed Speech', null, 0, 'Join the family that holds it', 30),
	('jujutsu-kaisen', 'Family Locked', 'Private Pure Love Train', null, 0, 'Join the family that holds it', 31),

	-- My Hero Academia quirks.
	('my-hero-academia', 'Standard', 'All For One', 1, 1, '', 1),
	('my-hero-academia', 'Standard', 'One For All', 1, 1, '', 2),
	('my-hero-academia', 'Standard', 'Warp Gate', 3, 1, '', 3),
	('my-hero-academia', 'Standard', 'Warping', 3, 1, '', 4),
	('my-hero-academia', 'Standard', 'Electrification', 3, 1, '', 5),
	('my-hero-academia', 'Standard', 'Half Hot Half Cold', 3, 2, '', 6),
	('my-hero-academia', 'Standard', 'Twin Impact', 3, 1, '', 7),
	('my-hero-academia', 'Standard', 'IQ', 3, 1, '', 8),
	('my-hero-academia', 'Standard', 'Chronostasis', 2, 1, '', 9),
	('my-hero-academia', 'Standard', 'Slide and Glide', 3, 1, '', 10),
	('my-hero-academia', 'Standard', 'Binging Ball', 3, 1, '', 11),
	('my-hero-academia', 'Standard', 'Elasticity', 2, 1, '', 12),
	('my-hero-academia', 'Standard', 'Cloud', 3, 1, '', 13),
	('my-hero-academia', 'Standard', 'Strong Arm', 3, 1, '', 14),
	('my-hero-academia', 'Standard', 'Poltergeist', 3, 1, '', 15),
	('my-hero-academia', 'Standard', 'Blood Curdle', 2, 1, '', 16),
	('my-hero-academia', 'Standard', 'Whirlwind', 3, 1, '', 17),
	('my-hero-academia', 'Permission Based', 'Overclock', 3, 1, '', 18),
	('my-hero-academia', 'Permission Based', 'New Order', 2, 2, '', 19),
	('my-hero-academia', 'Permission Based', 'Reflect', 2, 1, '', 20),
	('my-hero-academia', 'Permission Based', 'Explosion', 3, 2, '', 21),
	('my-hero-academia', 'Permission Based', 'Pump Up', 2, 1, '', 22),
	('my-hero-academia', 'Permission Based', 'Copy', 3, 2, '', 23),
	('my-hero-academia', 'Permission Based', 'Hellflame', 2, 2, '', 24),
	('my-hero-academia', 'Permission Based', 'Overhaul', 2, 1, '', 25),
	('my-hero-academia', 'Permission Based', 'Decay', 2, 1, '', 26),
	('my-hero-academia', 'Permission Based', 'Cremation', 3, 2, '', 27),
	('my-hero-academia', 'Permission Based', 'Stress', 2, 1, '', 28),
	('my-hero-academia', 'Permission Based', 'Erasure', 2, 1, '', 29)
) as v (universe, category, name, max_users, manual_users, note, ord)
on conflict (universe, claim_type, lower(name)) do nothing;
