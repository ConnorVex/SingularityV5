import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://connorvex.github.io',
	base: '/SingularityV5',
	integrations: [
		starlight({
			title: 'Singularity | Version 5.0',
			tableOfContents: false,
		}),
	],
});
