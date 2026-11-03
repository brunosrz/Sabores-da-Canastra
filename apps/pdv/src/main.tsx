import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { AuthGate } from './auth-gate';
import { PdvRuntime } from './components/pdv-runtime';
import { PdvHome } from './routes/index';
import { PdvSettings } from './routes/ajustes';
import { SalesHistory } from './routes/historico';
import { SyncQueuePage } from './routes/sincronizacao';
import './styles.css';

const root = createRootRoute({
	component: () => (
		<AuthGate>
			<PdvRuntime>
				<Outlet />
			</PdvRuntime>
		</AuthGate>
	),
});
const routeTree = root.addChildren([
	createRoute({ getParentRoute: () => root, path: '/', component: PdvHome }),
	createRoute({ getParentRoute: () => root, path: '/ajustes', component: PdvSettings }),
	createRoute({ getParentRoute: () => root, path: '/historico', component: SalesHistory }),
	createRoute({ getParentRoute: () => root, path: '/sincronizacao', component: SyncQueuePage }),
]);
const router = createRouter({ routeTree });
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 }, mutations: { retry: 0 } } });
createRoot(document.getElementById('root')!).render(
	<QueryClientProvider client={queryClient}>
		<RouterProvider router={router} />
	</QueryClientProvider>,
);
