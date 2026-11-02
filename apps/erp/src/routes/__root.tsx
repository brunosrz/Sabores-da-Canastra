import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { TanStackDevtools } from '@tanstack/react-devtools';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import appCss from '../styles.css?url';
import { AuthGate } from '../auth-gate';
import { themeInitScript } from '@sabores/ui';

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content' },
			{ title: 'ERP Sabores da Canastra | Gestão do bar' },
			{
				name: 'description',
				content:
					'Aplicativo de gestão do Sabores da Canastra para produtos, ingredientes, receitas, estoque, compras, custos e resultados.',
			},
			{ name: 'application-name', content: 'ERP Sabores da Canastra' },
			{ name: 'apple-mobile-web-app-capable', content: 'yes' },
			{ name: 'apple-mobile-web-app-title', content: 'Canastra ERP' },
			{ name: 'author', content: 'Sabores da Canastra' },
			{
				name: 'robots',
				content: 'noindex, nofollow, noarchive, nosnippet',
			},
			{ name: 'theme-color', content: '#fff9f1' },
			{ property: 'og:type', content: 'website' },
			{ property: 'og:site_name', content: 'Sabores da Canastra' },
			{ property: 'og:locale', content: 'pt_BR' },
			{ property: 'og:title', content: 'ERP Sabores da Canastra' },
			{
				property: 'og:description',
				content: 'Gestão de produtos, ingredientes, receitas, estoque, compras, custos e resultados.',
			},
			{ property: 'og:url', content: 'https://erp.brunosrz.com/' },
			{
				property: 'og:image',
				content: 'https://erp.brunosrz.com/social-card-erp.png',
			},
			{ property: 'og:image:width', content: '1200' },
			{ property: 'og:image:height', content: '630' },
			{ property: 'og:image:type', content: 'image/png' },
			{
				property: 'og:image:alt',
				content: 'Sabores da Canastra — sistema ERP para gestão do bar',
			},
			{ name: 'twitter:card', content: 'summary_large_image' },
			{ name: 'twitter:title', content: 'ERP Sabores da Canastra' },
			{
				name: 'twitter:description',
				content: 'Gestão de produtos, ingredientes, receitas, estoque, compras, custos e resultados.',
			},
			{
				name: 'twitter:image',
				content: 'https://erp.brunosrz.com/social-card-erp.png',
			},
			{
				name: 'twitter:image:alt',
				content: 'Sabores da Canastra — sistema ERP para gestão do bar',
			},
		],
		links: [
			{ rel: 'stylesheet', href: appCss },
			{ rel: 'canonical', href: 'https://erp.brunosrz.com/' },
			{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
			{
				rel: 'icon',
				type: 'image/png',
				sizes: '32x32',
				href: '/favicon-32x32.png',
			},
			{
				rel: 'icon',
				type: 'image/png',
				sizes: '16x16',
				href: '/favicon-16x16.png',
			},
			{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
			{
				rel: 'apple-touch-icon',
				sizes: '180x180',
				href: '/apple-touch-icon.png',
			},
			{ rel: 'manifest', href: '/site.webmanifest' },
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="pt-BR" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
				<HeadContent />
			</head>
			<body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[#fca336]/30">
				<AuthGate>{children}</AuthGate>
				{import.meta.env.DEV ? (
					<TanStackDevtools
						config={{
							position: 'bottom-right',
						}}
						plugins={[
							{
								name: 'Tanstack Router',
								render: <TanStackRouterDevtoolsPanel />,
							},
							{ name: 'TanStack Query', render: <ReactQueryDevtools /> },
						]}
					/>
				) : null}
				<Scripts />
			</body>
		</html>
	);
}
