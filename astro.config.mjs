import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://connorvex.github.io',
	base: '/SingularityV5',
	integrations: [
		starlight({
			title: 'SingularityV5 Docs',
		}),
	],
});
