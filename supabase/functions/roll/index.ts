// Supabase Edge Function "roll": rolls a player's Potential or Cursed Energy.
//
// 1. Checks who is asking (their portal login).
// 2. Asks Discord whether that account is a member of the Singularity server.
// 3. Only then calls perform_roll() in the database, which does the dice and the locking.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets):
//   DISCORD_BOT_TOKEN  the Singularity Portal bot's token (keep private)
//   DISCORD_GUILD_ID   the Singularity server's ID
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
	if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);

	try {
		const { kind, characterId } = await req.json().catch(() => ({}));
		if (!['potential', 'cursed_energy'].includes(kind) || typeof characterId !== 'string') {
			return reply({ error: 'Bad request.' }, 400);
		}

		const url = Deno.env.get('SUPABASE_URL')!;
		const asPlayer = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
			global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
		});
		const { data: auth } = await asPlayer.auth.getUser();
		const user = auth?.user;
		const discord = user?.identities?.find((i) => i.provider === 'discord');
		const discordId = discord?.identity_data?.provider_id ?? discord?.identity_data?.sub ?? discord?.id;
		if (!user || !discordId) return reply({ error: 'Log in with Discord first.' }, 401);

		// Trim pasted secrets: a stray space or line break breaks the Discord request.
		const guild = Deno.env.get('DISCORD_GUILD_ID')?.replace(/\D/g, '');
		const token = Deno.env.get('DISCORD_BOT_TOKEN')?.trim().replace(/^Bot\s+/i, '');
		if (!guild || !token) return reply({ error: 'Rolling isn’t set up yet. Ask an admin.' }, 503);

		const member = await fetch(`https://discord.com/api/v10/guilds/${guild}/members/${discordId}`, {
			headers: { Authorization: `Bot ${token}` },
		});
		if (member.status === 404) {
			// Discord uses 404 both for "not a member" (code 10007) and "this bot can't see that
			// server" (10004: the bot isn't in it, or DISCORD_GUILD_ID is wrong).
			const body = await member.json().catch(() => ({}));
			if (body?.code === 10007 || body?.code === 10013) {
				return reply({ error: 'You need to be a member of the Singularity Discord server to roll.' }, 403);
			}
			console.error('Discord membership check failed', body);
			return reply(
				{ error: `Rolling isn’t set up correctly: the portal bot can’t see the Singularity server (Discord code ${body?.code ?? '?'}). Ask an admin.` },
				503,
			);
		}
		if (member.status === 401) {
			console.error('Discord rejected the bot token');
			return reply({ error: 'Rolling isn’t set up correctly: the portal bot’s token was rejected. Ask an admin.' }, 503);
		}
		if (!member.ok) {
			return reply({ error: 'Couldn’t check your Singularity membership right now. Try again in a minute.' }, 502);
		}

		const asServer = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
		const { data, error } = await asServer.rpc('perform_roll', { p_user: user.id, p_kind: kind, p_character: characterId });
		if (error) return reply({ error: error.message }, 400);
		return reply({ roll: data });
	} catch (e) {
		console.error(e);
		return reply({ error: 'Something went wrong while rolling.' }, 500);
	}
});
