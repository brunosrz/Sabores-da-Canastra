import { createFileRoute } from '@tanstack/react-router';
import { InventoryPrototype } from '../prototype/pages';

export const Route = createFileRoute('/estoque')({ component: InventoryPrototype });
