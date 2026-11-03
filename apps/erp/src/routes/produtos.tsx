import { createFileRoute } from '@tanstack/react-router';
import { ProductsPrototype } from '../prototype/pages';

export const Route = createFileRoute('/produtos')({ component: ProductsPrototype });
