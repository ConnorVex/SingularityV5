import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://connorvex.github.io',
	base: '/SingularityV5',
	integrations: [
		starlight({
			title: 'Singularity | Version 5.0',
			tableOfContents: false,
			pagination: false,
			markdown: {
				headingLinks: false,
			},
			components: {
				SiteTitle: './src/components/SiteTitle.astro',
			},
			customCss: [
				'@fontsource-variable/exo-2',
				'./src/styles/sidebar.css',
				'./src/styles/custom.css',
			],
			head: [
				{
					// Restore the collapsed sidebar before the page paints, so it doesn't flicker open.
					tag: 'script',
					content:
						"try{if(localStorage.getItem('sidebar-collapsed')==='1')document.documentElement.setAttribute('data-sidebar-collapsed','')}catch(e){}",
				},
			],
		}),
	],
});
