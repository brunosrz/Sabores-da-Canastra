import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@sabores/ui';

type Ingredient = {
	ingredient_id?: string;
	name: string;
	base_unit: string;
	pack_quantity: string;
	supplier: string | null;
	notes: string | null;
	source: string | null;
	pack_price_cents: number | null;
	status: string | null;
	quoted_on: string | null;
};
const empty = (): Ingredient => ({
	name: '',
	base_unit: 'g',
	pack_quantity: '1000',
	supplier: null,
	notes: null,
	source: null,
	pack_price_cents: null,
	status: 'Pendente',
	quoted_on: null,
});
async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`/api/admin/ingredients${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
	const body = (await response.json()) as T & { error?: string };
	if (!response.ok) throw new Error(body.error ?? 'Não foi possível concluir a operação.');
	return body;
}
export function IngredientsPage() {
	const [items, setItems] = useState<Ingredient[]>([]);
	const [editing, setEditing] = useState<Ingredient | null>(null);
	const [search, setSearch] = useState('');
	const [filter, setFilter] = useState('Todos');
	const [message, setMessage] = useState('Carregando ingredientes…');
	const [busy, setBusy] = useState(false);
	const lock = useRef(false);
	async function load() {
		const result = await api<{ data: Ingredient[] }>('');
		setItems(result.data);
		setMessage(`${result.data.length} ingredientes cadastrados.`);
	}
	useEffect(() => {
		const timer = window.setTimeout(() => {
			void load().catch((e: Error) => setMessage(e.message));
		}, 0);
		return () => window.clearTimeout(timer);
	}, []);
	async function mutate(remove: boolean) {
		if (!editing || lock.current) return;
		if (remove && !window.confirm(`Excluir ${editing.name}? Ingredientes usados em receitas ou compras não podem ser excluídos.`)) return;
		lock.current = true;
		setBusy(true);
		try {
			await api(editing.ingredient_id ? `/${encodeURIComponent(editing.ingredient_id)}` : '', {
				method: remove ? 'DELETE' : editing.ingredient_id ? 'PUT' : 'POST',
				headers: { 'content-type': 'application/json' },
				...(remove
					? {}
					: {
							body: JSON.stringify({
								...editing,
								pack_quantity: editing.pack_quantity.replace(',', '.'),
								status: editing.status ?? 'Pendente',
							}),
						}),
			});
			setEditing(null);
			await load();
			setMessage(remove ? 'Ingrediente excluído.' : 'Ingrediente e cotação salvos.');
		} catch (e) {
			setMessage(e instanceof Error ? e.message : 'Falha ao salvar.');
		} finally {
			lock.current = false;
			setBusy(false);
		}
	}
	const normalized = (value: string) =>
		value
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLocaleLowerCase('pt-BR');
	const visible = items.filter(
		(i) =>
			normalized(`${i.name} ${i.supplier ?? ''}`).includes(normalized(search.trim())) &&
			(filter === 'Todos' || (i.status ?? 'Pendente') === filter),
	);
	return (
		<div className="demo-page demo-page-wide">
			<PageHeader title="Ingredientes e cotações" description="Pesquise, cadastre e edite os ingredientes usados nas receitas." />
			<p role="status">{message}</p>
			<div className="demo-grid">
				<label>
					Buscar nome ou fornecedor
					<input className="demo-input" value={search} onChange={(e) => setSearch(e.target.value)} />
				</label>
				<label>
					Status
					<select className="demo-input" value={filter} onChange={(e) => setFilter(e.target.value)}>
						{['Todos', 'Confirmado', 'Estimado', 'Pendente', 'Desatualizado'].map((s) => (
							<option key={s}>{s}</option>
						))}
					</select>
				</label>
			</div>
			<button type="button" className="demo-button" disabled={busy} onClick={() => setEditing(empty())}>
				Novo ingrediente
			</button>
			<button
				type="button"
				className="demo-button demo-button-secondary"
				onClick={() => {
					setSearch('');
					setFilter('Todos');
				}}
			>
				Limpar filtros
			</button>
			{editing && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						void mutate(false);
					}}
				>
					<h2>{editing.ingredient_id ? 'Editar ingrediente' : 'Novo ingrediente'}</h2>
					<div className="demo-grid">
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
							Unidade base
							<select
								className="demo-input"
								value={editing.base_unit}
								onChange={(e) => setEditing({ ...editing, base_unit: e.target.value })}
							>
								{['g', 'ml', 'un'].map((u) => (
									<option key={u}>{u}</option>
								))}
							</select>
						</label>
						<label>
							Quantidade no pacote
							<input
								className="demo-input"
								inputMode="decimal"
								required
								value={editing.pack_quantity}
								onChange={(e) => setEditing({ ...editing, pack_quantity: e.target.value })}
							/>
						</label>
						<label>
							Preço do pacote (centavos)
							<input
								className="demo-input"
								type="number"
								min="0"
								step="1"
								value={editing.pack_price_cents ?? ''}
								onChange={(e) => setEditing({ ...editing, pack_price_cents: e.target.value === '' ? null : Number(e.target.value) })}
							/>
						</label>
						<label>
							Status
							<select
								className="demo-input"
								value={editing.status ?? 'Pendente'}
								onChange={(e) => setEditing({ ...editing, status: e.target.value })}
							>
								{['Confirmado', 'Estimado', 'Pendente', 'Desatualizado'].map((s) => (
									<option key={s}>{s}</option>
								))}
							</select>
						</label>
						<label>
							Data da cotação
							<input
								className="demo-input"
								type="date"
								value={editing.quoted_on ?? ''}
								onChange={(e) => setEditing({ ...editing, quoted_on: e.target.value || null })}
							/>
						</label>
						{(['supplier', 'source', 'notes'] as const).map((key) => (
							<label key={key}>
								{{ supplier: 'Fornecedor', source: 'Fonte da cotação', notes: 'Observações' }[key]}
								<input
									className="demo-input"
									value={editing[key] ?? ''}
									onChange={(e) => setEditing({ ...editing, [key]: e.target.value || null })}
								/>
							</label>
						))}
					</div>
					<p>Deixe o preço vazio quando ainda estiver pendente. Cada edição preserva a cotação anterior no histórico.</p>
					<button className="demo-button" disabled={busy}>
						Salvar ingrediente e cotação
					</button>
					<button type="button" className="demo-button demo-button-secondary" disabled={busy} onClick={() => setEditing(null)}>
						Cancelar
					</button>
					{editing.ingredient_id && (
						<button type="button" className="demo-button demo-button-danger" disabled={busy} onClick={() => void mutate(true)}>
							Excluir ingrediente
						</button>
					)}
				</form>
			)}
			<p>
				{visible.length} de {items.length} ingredientes
			</p>
			<div style={{ overflowX: 'auto' }}>
				<table className="demo-table">
					<thead>
						<tr>
							<th>Ingrediente</th>
							<th>Pacote</th>
							<th>Preço</th>
							<th>Fornecedor</th>
							<th>Status</th>
							<th>Ação</th>
						</tr>
					</thead>
					<tbody>
						{visible.map((i) => (
							<tr key={i.ingredient_id}>
								<td>{i.name}</td>
								<td>
									{i.pack_quantity} {i.base_unit}
								</td>
								<td>
									{i.pack_price_cents === null
										? 'Pendente'
										: (i.pack_price_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
								</td>
								<td>{i.supplier ?? '—'}</td>
								<td>{i.status ?? 'Pendente'}</td>
								<td>
									<button type="button" className="demo-button demo-button-secondary" disabled={busy} onClick={() => setEditing({ ...i })}>
										Editar {i.name}
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{!visible.length && <p>Nenhum ingrediente encontrado.</p>}
		</div>
	);
}
