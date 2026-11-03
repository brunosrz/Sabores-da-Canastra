import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { configureNativeApi } from '@sabores/ui/platform';
import { AuthGate } from './auth-gate';
import { ErpOfflineRuntime } from './components/erp-offline-runtime';
import { ErpHome } from './routes/index';
import { CatalogPage } from './routes/catalogo';
import { IngredientsPage } from './ingredients-page';
import { RecipesPage } from './recipes-page';
import { FinancePrototype, ProductsPrototype, SettingsPrototype } from './prototype/pages';
import './styles.css';

configureNativeApi(import.meta.env.VITE_NATIVE_API_ORIGIN || 'https://erp.brunosrz.com', ['erp.brunosrz.com', 'erp-preview.brunosrz.com']);

const root = createRootRoute({
	component: () => (
		<AuthGate>
			<ErpOfflineRuntime>
				<Outlet />
			</ErpOfflineRuntime>
		</AuthGate>
	),
});
const routeTree = root.addChildren([
	createRoute({ getParentRoute: () => root, path: '/', component: ErpHome }),
	createRoute({ getParentRoute: () => root, path: '/catalogo', component: CatalogPage }),
	createRoute({ getParentRoute: () => root, path: '/estoque', component: IngredientsPage }),
	createRoute({ getParentRoute: () => root, path: '/receitas', component: RecipesPage }),
	createRoute({ getParentRoute: () => root, path: '/financeiro', component: FinancePrototype }),
	createRoute({ getParentRoute: () => root, path: '/produtos', component: ProductsPrototype }),
	createRoute({ getParentRoute: () => root, path: '/ajustes', component: SettingsPrototype }),
]);
const router = createRouter({ routeTree });
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 }, mutations: { retry: 0 } } });
createRoot(document.getElementById('root')!).render(
	<QueryClientProvider client={queryClient}>
		<RouterProvider router={router} />
	</QueryClientProvider>,
);
