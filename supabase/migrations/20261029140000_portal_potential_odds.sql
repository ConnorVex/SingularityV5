-- Singularity character portal: reordered Potential odds (approved 2026-10-29).
--
-- Each higher Potential is now rarer than the one below it. Average (50–390, 68.2%) and
-- Tremendous (496–500, 1%) are unchanged, as are the overall odds of an above-average
-- Potential (22%). Only new rolls use this; rolls already made keep their result.
--
--   1d500       Potential     Chance
--   1–17        Limited        3.4%
--   18–49       Low            6.4%
--   50–390      Average       68.2%
--   391–430     Great          8.0%
--   431–455     High           5.0%
--   456–473     Insane         3.6%
--   474–486     Immense        2.6%
--   487–495     Colossal       1.8%
--   496–500     Tremendous     1.0%
--
-- Run once in the SQL Editor.

create or replace function public.potential_for(n int)
returns text
language sql
immutable
set search_path = ''
as $$
	select case
		when n <= 17 then 'limited'
		when n <= 49 then 'low'
		when n <= 390 then 'average'
		when n <= 430 then 'great'
		when n <= 455 then 'high'
		when n <= 473 then 'insane'
		when n <= 486 then 'immense'
		when n <= 495 then 'colossal'
		else 'tremendous'
	end;
$$;
