import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { PageHeader } from '@sabores/ui';
export const Route = createFileRoute('/catalogo')({ component: CatalogPage });
type Category = { category_id: string; name: string };
type Product = {
	product_id?: string;
	name: string;
	category_id: string;
	unit: string;
	barcode: string | null;
	auxiliary_code: string | null;
	sale_price_cents: number | null;
	unit_cost_cents: number | null;
	active: number;
	notes: string | null;
};
const empty = (): Product => ({
	name: '',
	category_id: '',
	unit: 'un',
	barcode: null,
	auxiliary_code: null,
	sale_price_cents: null,
	unit_cost_cents: null,
	active: 1,
	notes: null,
});
async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`/api/admin/${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
	const body = (await response.json()) as T & { error?: string };
	if (!response.ok) throw new Error(body.error ?? `Falha na operação (${response.status}).`);
	return body;
}
function CatalogPage() {
	const [products, setProducts] = useState<Product[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [search, setSearch] = useState('');
	const [editing, setEditing] = useState<Product | null>(null);
	const [categoryName, setCategoryName] = useState('');
	const [status, setStatus] = useState('Carregando…');
	const [busy, setBusy] = useState(false);
	async function load() {
		const [p, c] = await Promise.all([api<{ data: Product[] }>('products'), api<{ data: Category[] }>('categories')]);
		setProducts(p.data);
		setCategories(c.data);
		setStatus(`${p.data.length} produtos cadastrados.`);
	}
	useEffect(() => {
		const timer = window.setTimeout(() => {
			void load().catch((error: Error) => setStatus(error.message));
		}, 0);
		return () => window.clearTimeout(timer);
	}, []);
	async function save() {
		if (!editing || busy) return;
		setBusy(true);
		try {
			await api(editing.product_id ? `products/${encodeURIComponent(editing.product_id)}` : 'products', {
				method: editing.product_id ? 'PUT' : 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(editing),
			});
			setEditing(null);
			await load();
			setStatus('Produto salvo.');
		} catch (error) {
			setStatus(error instanceof Error ? error.message : 'Falha ao salvar.');
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="demo-page demo-page-wide">
			<PageHeader title="Cadastro de produtos" description="Produtos ativos e inativos, códigos, preços e categorias." />
			<p role="status">{status}</p>
			<label>
				Buscar produto
				<input className="demo-input" value={search} onChange={(e) => setSearch(e.target.value)} />
			</label>
			<button className="demo-button" type="button" onClick={() => setEditing(empty())}>
				Novo produto
			</button>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (busy) return;
					setBusy(true);
					void api('categories', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ name: categoryName }),
					})
						.then(() => {
							setCategoryName('');
							return load();
						})
						.catch((error: Error) => setStatus(error.message))
						.finally(() => setBusy(false));
				}}
			>
				<label>
					Nova categoria
					<input
						className="demo-input"
						required
						maxLength={200}
						value={categoryName}
						onChange={(event) => setCategoryName(event.target.value)}
					/>
				</label>
				<button className="demo-button" disabled={busy}>
					Cadastrar categoria
				</button>
			</form>
			{editing ? (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<h2>{editing.product_id ? 'Editar produto' : 'Novo produto'}</h2>
					<label>
						Nome
						<input
							className="demo-input"
							required
							maxLength={200}
							value={editing.name}
							onChange={(e) => setEditing({ ...editing, name: e.target.value })}
						/>
					</label>
					<label>
						Categoria
						<select
							className="demo-input"
							required
							value={editing.category_id}
							onChange={(e) => setEditing({ ...editing, category_id: e.target.value })}
						>
							<option value="">Selecione</option>
							{categories.map((c) => (
								<option key={c.category_id} value={c.category_id}>
									{c.name}
								</option>
							))}
						</select>
					</label>
					{(['unit', 'barcode', 'auxiliary_code', 'notes'] as const).map((key) => (
						<label key={key}>
							{{ unit: 'Unidade', barcode: 'Código de barras', auxiliary_code: 'Código auxiliar', notes: 'Observações' }[key]}
							<input
								className="demo-input"
								value={editing[key] ?? ''}
								onChange={(e) => setEditing({ ...editing, [key]: e.target.value || (key === 'unit' ? '' : null) })}
							/>
						</label>
					))}
					{(['sale_price_cents', 'unit_cost_cents'] as const).map((key) => (
						<label key={key}>
							{key === 'sale_price_cents' ? 'Preço de venda (centavos)' : 'Custo unitário (centavos)'}
							<input
								className="demo-input"
								type="number"
								min="0"
								step="1"
								value={editing[key] ?? ''}
								onChange={(e) => setEditing({ ...editing, [key]: e.target.value === '' ? null : Number(e.target.value) })}
							/>
						</label>
					))}
					<label>
						<input
							type="checkbox"
							checked={editing.active === 1}
							onChange={(e) => setEditing({ ...editing, active: e.target.checked ? 1 : 0 })}
						/>
						Disponível para venda
					</label>
					<p>Preço e custo vazios permanecem pendentes.</p>
					<button className="demo-button" disabled={busy}>
						Salvar produto
					</button>
					<button type="button" className="demo-button demo-button-secondary" disabled={busy} onClick={() => setEditing(null)}>
						Cancelar
					</button>
				</form>
			) : null}
			<ul>
				{products
					.filter((p) =>
						`${p.name} ${p.barcode ?? ''} ${p.auxiliary_code ?? ''}`
							.toLocaleLowerCase('pt-BR')
							.includes(search.toLocaleLowerCase('pt-BR').trim()),
					)
					.map((p) => (
						<li key={p.product_id}>
							<button type="button" className="demo-button demo-button-secondary" onClick={() => setEditing({ ...p })}>
								{p.name} · {p.active ? 'Ativo' : 'Inativo'}
							</button>
						</li>
					))}
			</ul>
		</div>
	);
}
