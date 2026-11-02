import { createFileRoute } from '@tanstack/react-router';
import { RecipesPage } from '../prototype/pages';

export const Route = createFileRoute('/receitas')({ component: RecipesPage });
