import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://github.io',
	base: '/singularityv5', 
	integrations: [
		starlight({
			title: 'SingularityV5 Docs',
		}),
	],
});
