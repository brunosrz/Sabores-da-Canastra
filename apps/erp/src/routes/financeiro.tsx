import { createFileRoute } from '@tanstack/react-router';
import { FinancePrototype } from '../prototype/pages';

export const Route = createFileRoute('/financeiro')({ component: FinancePrototype });
