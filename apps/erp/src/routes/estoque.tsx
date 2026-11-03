import { createFileRoute } from '@tanstack/react-router';
import { IngredientsPage } from '../ingredients-page';

export const Route = createFileRoute('/estoque')({ component: IngredientsPage });
