import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { TanStackDevtools } from '@tanstack/react-devtools';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import appCss from '../styles.css?url';
import { AuthGate } from '../auth-gate';

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'Sabores da Canastra | PDV' },
		],
		links: [{ rel: 'stylesheet', href: appCss }],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="pt-BR" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="min-h-screen font-sans antialiased">
				<AuthGate>{children}</AuthGate>
				{import.meta.env.DEV ? (
					<TanStackDevtools
						config={{ position: 'bottom-right' }}
						plugins={[
							{ name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> },
							{ name: 'TanStack Query', render: <ReactQueryDevtools /> },
						]}
					/>
				) : null}
				<Scripts />
			</body>
		</html>
	);
}
