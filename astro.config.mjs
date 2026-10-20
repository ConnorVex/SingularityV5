import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	// REPLACE 'your-github-username' and 'your-repo-name' with your actual setup
	site: 'https://connorvex.github.io',
	base: '/SingularityV5',
	integrations: [
		starlight({
			title: 'Singularity',
			sidebar: [
				{ label: 'Guides', items: [{ label: 'Example Guide', slug: 'example' }] },
			],
		}),
	],
});
