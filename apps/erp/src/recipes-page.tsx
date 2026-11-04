import { apiFetch } from '@sabores/ui/platform';
import { t } from '@sabores/i18n';
import { useEffect, useRef, useState } from 'react';
import { PageHeader, Price } from '@sabores/ui';

type Line = { ingredient_id: string; quantity: string; unit: string; stage: string | null };
type Recipe = {
	recipe_id?: string;
	product_id: string | null;
	product_name: string;
	version: string;
	yield_units: number;
	source: string | null;
	instructions: string | null;
	lines: Line[];
	batch_cost_cents?: number | null;
	unit_cost_cents?: number | null;
	pending_ingredients?: string[];
	quality?: string;
	mix_quantity?: number;
	selected_version?: string | null;
};
type Product = { product_id: string; name: string };
type Ingredient = { ingredient_id: string; name: string; base_unit: string };
const empty = (): Recipe => ({
	product_id: null,
	product_name: '',
	version: '1',
	yield_units: 1,
	source: null,
	instructions: null,
	lines: [],
});
async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await apiFetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
	const body = (await response.json()) as T & { error?: string };
	if (!response.ok) throw new Error(body.error ?? 'Operação indisponível.');
	return body;
}
export function RecipesPage() {
	const [recipes, setRecipes] = useState<Recipe[]>([]);
	const [products, setProducts] = useState<Product[]>([]);
	const [ingredients, setIngredients] = useState<Ingredient[]>([]);
	const [editing, setEditing] = useState<Recipe | null>(null);
	const [search, setSearch] = useState('');
	const [message, setMessage] = useState('Carregando receitas…');
	const [busy, setBusy] = useState(false);
	const lock = useRef(false);
	async function load() {
		const [r, p, i] = await Promise.all([
			api<{ data: Recipe[] }>('/api/erp/recipes'),
			api<{ data: Product[] }>('/api/admin/products'),
			api<{ data: Ingredient[] }>('/api/admin/ingredients'),
		]);
		setRecipes(r.data);
		setProducts(p.data);
		setIngredients(i.data);
		setMessage(t('{p0} receitas cadastradas.', { p0: r.data.length }));
	}
	useEffect(() => {
		const timer = window.setTimeout(() => {
			void load().catch((e: Error) => setMessage(e.message));
		}, 0);
		return () => window.clearTimeout(timer);
	}, []);
	function changeLine(index: number, patch: Partial<Line>) {
		if (editing) setEditing({ ...editing, lines: editing.lines.map((l, n) => (n === index ? { ...l, ...patch } : l)) });
	}
	async function save(remove = false) {
		if (!editing || lock.current) return;
		if (remove && !window.confirm(`Excluir a receita de ${editing.product_name}?`)) return;
		lock.current = true;
		setBusy(true);
		try {
			await api(`/api/admin/recipes${editing.recipe_id ? `/${encodeURIComponent(editing.recipe_id)}` : ''}`, {
				method: remove ? 'DELETE' : editing.recipe_id ? 'PUT' : 'POST',
				headers: { 'content-type': 'application/json' },
				...(remove
					? {}
					: { body: JSON.stringify({ ...editing, lines: editing.lines.map((l) => ({ ...l, quantity: l.quantity.replace(',', '.') })) }) }),
			});
			setEditing(null);
			await load();
			setMessage(remove ? t('Receita excluída.') : t('Receita salva. Custos recalculados.'));
		} catch (e) {
			setMessage(e instanceof Error ? e.message : t('Falha ao salvar.'));
		} finally {
			lock.current = false;
			setBusy(false);
		}
	}
	async function selectMix(recipe: Recipe) {
		if (lock.current || !recipe.recipe_id) return;
		lock.current = true;
		setBusy(true);
		try {
			await api(`/api/admin/recipes/${encodeURIComponent(recipe.recipe_id)}/mix`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ quantity: recipe.mix_quantity ?? 0, selected_version: recipe.version }),
			});
			await load();
			setMessage('Mix salvo. O custo desta versão será priorizado quando a quantidade for positiva.');
		} catch (e) {
			setMessage(e instanceof Error ? e.message : 'Falha ao salvar o mix.');
		} finally {
			lock.current = false;
			setBusy(false);
		}
	}
	return (
		<div className="demo-page demo-page-wide">
			<PageHeader title={t('Receitas')} description={t('Composição, rendimento e custos calculados pelas cotações atuais.')} />
			<p role="status">{t(message)}</p>
			<label>
				{t('Buscar receita ')}
				<input className="demo-input" value={search} onChange={(e) => setSearch(e.target.value)} />
			</label>
			<button type="button" className="demo-button" disabled={busy} onClick={() => setEditing(empty())}>
				{t('Nova receita ')}
			</button>
			{editing && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<h2>{editing.recipe_id ? t('Editar receita') : t('Nova receita')}</h2>
					<div className="demo-grid">
						<label>
							{t('Produto vinculado ')}
							<select
								className="demo-input"
								value={editing.product_id ?? ''}
								onChange={(e) => {
									const p = products.find((p) => p.product_id === e.target.value);
									setEditing({ ...editing, product_id: p?.product_id ?? null, product_name: p?.name ?? editing.product_name });
								}}
							>
								<option value="">{t('Sem vínculo — receita base')}</option>
								{products.map((p) => (
									<option key={p.product_id} value={p.product_id}>
										{p.name}
									</option>
								))}
							</select>
						</label>
						<label>
							{t('Nome ')}
							<input
								className="demo-input"
								required
								maxLength={200}
								value={editing.product_name}
								disabled={editing.product_id !== null}
								onChange={(e) => setEditing({ ...editing, product_name: e.target.value })}
							/>
						</label>
						<label>
							{t('Versão ')}
							<input
								className="demo-input"
								required
								maxLength={80}
								value={editing.version}
								onChange={(e) => setEditing({ ...editing, version: e.target.value })}
							/>
						</label>
						<label>
							{t('Rendimento (unidades) ')}
							<input
								className="demo-input"
								type="number"
								required
								min="1"
								step="1"
								value={editing.yield_units}
								onChange={(e) => setEditing({ ...editing, yield_units: Number(e.target.value) })}
							/>
						</label>
						<label>
							{t('Fonte ')}
							<input
								className="demo-input"
								value={editing.source ?? ''}
								onChange={(e) => setEditing({ ...editing, source: e.target.value || null })}
							/>
						</label>
						<label>
							{t('Modo de preparo ')}
							<textarea
								className="demo-input"
								maxLength={10000}
								value={editing.instructions ?? ''}
								onChange={(e) => setEditing({ ...editing, instructions: e.target.value || null })}
							/>
						</label>
					</div>
					<h3>{t('Ingredientes')}</h3>
					{editing.lines.map((line, index) => (
						<fieldset key={index} disabled={busy}>
							<legend>
								{t('Item ')}
								{index + 1}
							</legend>
							<label>
								{t('Ingrediente ')}
								<select
									className="demo-input"
									required
									value={line.ingredient_id}
									onChange={(e) => {
										const i = ingredients.find((i) => i.ingredient_id === e.target.value);
										changeLine(index, { ingredient_id: e.target.value, unit: i?.base_unit ?? 'g' });
									}}
								>
									<option value="">{t('Selecione')}</option>
									{ingredients.map((i) => (
										<option key={i.ingredient_id} value={i.ingredient_id}>
											{i.name}
										</option>
									))}
								</select>
							</label>
							<label>
								{t('Quantidade (')}
								{line.unit})
								<input
									className="demo-input"
									required
									inputMode="decimal"
									value={line.quantity}
									onChange={(e) => changeLine(index, { quantity: e.target.value })}
								/>
							</label>
							<label>
								{t('Etapa ')}
								<input
									className="demo-input"
									maxLength={200}
									value={line.stage ?? ''}
									onChange={(e) => changeLine(index, { stage: e.target.value || null })}
								/>
							</label>
							<button
								type="button"
								className="demo-button demo-button-secondary"
								onClick={() => setEditing({ ...editing, lines: editing.lines.filter((_, n) => n !== index) })}
							>
								{t('Remover item ')}
								{index + 1}
							</button>
						</fieldset>
					))}
					<button
						type="button"
						className="demo-button demo-button-secondary"
						disabled={busy || editing.lines.length >= 80}
						onClick={() =>
							setEditing({ ...editing, lines: [...editing.lines, { ingredient_id: '', quantity: '1', unit: 'g', stage: null }] })
						}
					>
						{t('Adicionar ingrediente ')}
					</button>
					<button className="demo-button" disabled={busy || !editing.lines.length}>
						{t('Salvar receita ')}
					</button>
					<button type="button" className="demo-button demo-button-secondary" disabled={busy} onClick={() => setEditing(null)}>
						{t('Cancelar ')}
					</button>
					{editing.recipe_id && (
						<button type="button" className="demo-button demo-button-danger" disabled={busy} onClick={() => void save(true)}>
							{t('Excluir receita ')}
						</button>
					)}
				</form>
			)}
			<div className="erp-area-grid">
				{recipes
					.filter((r) => r.product_name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')))
					.map((r) => (
						<article className="demo-card" key={r.recipe_id}>
							<h2>{r.product_name}</h2>
							<p>
								{t('Versão ')}
								{r.version} {t(' · rendimento ')}
								{r.yield_units} {t(' · custo ')}
								{r.quality ?? 'Pendente'}
							</p>
							<p>
								{t('Custo do lote: ')}
								{r.batch_cost_cents == null ? t('Pendente') : <Price cents={r.batch_cost_cents} />}
							</p>
							<p>
								{t('Custo unitário: ')}
								{r.unit_cost_cents == null ? t('Pendente') : <Price cents={r.unit_cost_cents} />}
							</p>
							{!!r.pending_ingredients?.length && (
								<p>
									{t('Revisar: ')}
									{r.pending_ingredients.join(', ')}
								</p>
							)}
							<ul>
								{r.lines.map((l, n) => (
									<li key={n}>
										{ingredients.find((i) => i.ingredient_id === l.ingredient_id)?.name ?? l.ingredient_id}: {l.quantity} {l.unit}
									</li>
								))}
							</ul>
							<button
								type="button"
								className="demo-button"
								disabled={busy}
								onClick={() => setEditing({ ...r, lines: r.lines.map((l) => ({ ...l })) })}
							>
								{t('Editar receita ')}
							</button>
							<label>
								Quantidade planejada no mix
								<input
									className="demo-input"
									type="number"
									min="0"
									step="1"
									value={r.mix_quantity ?? 0}
									onChange={(e) =>
										setRecipes(
											recipes.map((item) => (item.recipe_id === r.recipe_id ? { ...item, mix_quantity: Number(e.target.value) } : item)),
										)
									}
								/>
							</label>
							<button type="button" className="demo-button demo-button-secondary" disabled={busy} onClick={() => void selectMix(r)}>
								Selecionar versão no mix
							</button>
						</article>
					))}
			</div>
		</div>
	);
}
