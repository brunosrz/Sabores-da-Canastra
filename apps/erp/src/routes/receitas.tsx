import { createFileRoute } from '@tanstack/react-router';
import { RecipesPage } from '../recipes-page';

export const Route = createFileRoute('/receitas')({ component: RecipesPage });
