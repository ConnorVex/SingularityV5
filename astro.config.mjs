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
			// Groups start closed so first-time visitors aren't flooded; the group holding
			// the current page always opens.
			sidebar: [
				'index',
				{ label: 'Character Portal', link: '/portal/' },
				{
					label: 'Important Systems',
					collapsed: true,
					items: [{ autogenerate: { directory: 'Important Systems', collapsed: true } }],
				},
				{
					label: 'Power Systems',
					collapsed: true,
					items: [{ autogenerate: { directory: 'Power Systems', collapsed: true } }],
				},
				{
					label: 'Fighting Styles',
					collapsed: true,
					items: [{ autogenerate: { directory: 'Fighting Styles', collapsed: true } }],
				},
				{
					label: 'Skill System',
					collapsed: true,
					items: [{ autogenerate: { directory: 'Skill System', collapsed: true } }],
				},
			],
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
					// The sidebar starts collapsed until the visitor opens it with the logo; that choice
					// is remembered. Set before the page paints, so it doesn't flicker.
					tag: 'script',
					content:
						"try{if(localStorage.getItem('sidebar-collapsed')!=='0')document.documentElement.setAttribute('data-sidebar-collapsed','')}catch(e){document.documentElement.setAttribute('data-sidebar-collapsed','')}",
				},
			],
		}),
	],
});
