import { t } from '@sabores/i18n';
import { Badge, Card, CategoryBadge, EmptyState, PageHeader, Price, ResponsiveTable, Preferences } from '@sabores/ui';
import { useEffect, useRef, useState } from 'react';
import { enqueuePriceChange, listPriceOperations, loadProducts, refreshProducts, syncPriceQueue, type ErpProduct } from '../offline/store';

function PrototypeFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
	return (
		<div className="demo-page demo-page-wide">
			<PageHeader title={title} description={description} actions={<Badge>{t('Protótipo')}</Badge>} />
			{children}
		</div>
	);
}

export function ProductsPrototype() {
	const [products, setProducts] = useState<ErpProduct[]>([]);
	const [search, setSearch] = useState('');
	const [editing, setEditing] = useState<ErpProduct | null>(null);
	const [price, setPrice] = useState('');
	const [status, setStatus] = useState('Carregando catálogo…');
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		const reloadCatalog = () => {
			void loadProducts()
				.then(setProducts)
				.catch(() => setStatus(t('Não foi possível atualizar o catálogo local.')));
		};
		window.addEventListener('erp-catalog-changed', reloadCatalog);
		void loadProducts()
			.then((cached) => {
				setProducts(cached);
				setStatus(cached.length ? t('{p0} produtos salvos neste dispositivo', { p0: cached.length }) : t('Nenhum catálogo local ainda'));
				return refreshProducts();
			})
			.then((fresh) => {
				setProducts(fresh);
				setStatus(t('{p0} produtos sincronizados com o D1', { p0: fresh.length }));
			})
			.catch(() => setStatus(t('Offline: exibindo o catálogo deste dispositivo.')));
		return () => window.removeEventListener('erp-catalog-changed', reloadCatalog);
	}, []);
	const filtered = products.filter((product) =>
		`${product.name} ${product.barcode ?? ''} ${product.auxiliary_code ?? ''} ${product.category}`
			.toLocaleLowerCase('pt-BR')
			.includes(search.trim().toLocaleLowerCase('pt-BR')),
	);
	async function savePrice() {
		if (!editing || busy) return;
		const normalized = price.replace(',', '.');
		if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
			setStatus(t('Informe um preço válido com até duas casas decimais.'));
			return;
		}
		const cents = Math.round(Number(normalized) * 100);
		setBusy(true);
		try {
			const operation = await enqueuePriceChange(editing.product_id, cents);
			setProducts(await loadProducts());
			setEditing(null);
			setStatus(
				navigator.onLine
					? t('Preço salvo localmente; sincronizando com o servidor…')
					: t('Preço enfileirado neste dispositivo para sincronizar quando voltar a internet.'),
			);
			await syncPriceQueue();
			const saved = (await listPriceOperations()).find((item) => item.operationId === operation.operationId);
			setStatus(
				saved?.state === 'synced'
					? t('Preço atualizado no D1 e registrado no histórico.')
					: saved?.state === 'conflict'
						? t('Conflito: o servidor tem outro preço. Recarregue o catálogo e revise antes de tentar novamente.')
						: saved?.state === 'blocked_auth'
							? t('Preço aguardando uma sessão válida para sincronizar.')
							: t('Preço salvo neste dispositivo e aguardando sincronização.'),
			);
		} catch (error) {
			setStatus(error instanceof Error ? error.message : t('Não foi possível salvar o preço.'));
		} finally {
			setBusy(false);
		}
	}
	return (
		<PrototypeFrame title={t('Produtos')} description={t('Catálogo do bar com preços, categorias, custos e fichas técnicas.')}>
			<div className="erp-catalog-tools">
				<label htmlFor="erp-product-search">{t('Buscar produto')}</label>
				<input
					id="erp-product-search"
					className="demo-input"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder={t('Nome, código de barras ou código auxiliar')}
				/>
				<span role="status">{t(status)}</span>
			</div>
			<ResponsiveTable
				caption={t('Catálogo de produtos')}
				columns={[
					{ key: 'name', label: 'Produto' },
					{
						key: 'category',
						label: 'Categoria',
						render: (row) => <CategoryBadge category={t(row.category)} />,
					},
					{ key: 'detail', label: 'Detalhes' },
					{
						key: 'cents',
						label: 'Venda',
						render: (row) => <Price cents={row.cents} />,
					},
				]}
				rows={filtered.map((product) => ({
					...product,
					cents: product.sale_price_cents ?? 0,
					detail: `${product.unit} · custo ${product.unit_cost_cents == null ? 'pendente' : 'cadastrado'}`,
				}))}
				rowKey={(row) => row.product_id}
			/>
			<div className="erp-product-cards">
				{filtered.map((product) => (
					<Card key={product.product_id} className="erp-product-card">
						<div>
							<CategoryBadge category={t(product.category)} />
							<h2>{product.name}</h2>
							<p>
								{product.barcode || product.auxiliary_code || 'Sem código'} · {product.unit}
							</p>
						</div>
						<div>
							<span>{t('Venda')}</span>
							<Price cents={product.sale_price_cents ?? 0} />
						</div>
						<div>
							<span>{t('Custo')}</span>
							<strong>{product.unit_cost_cents == null ? t('Pendente') : <Price cents={product.unit_cost_cents} />}</strong>
						</div>
						<button
							className="demo-button demo-button-secondary"
							type="button"
							onClick={() => {
								setEditing(product);
								setPrice(((product.sale_price_cents ?? 0) / 100).toFixed(2).replace('.', ','));
							}}
						>
							{t('Editar preço ')}
						</button>
					</Card>
				))}
			</div>
			{!filtered.length ? (
				<EmptyState
					title={t('Nenhum produto no catálogo local')}
					description={t('Conecte-se para carregar os produtos cadastrados no banco de dados.')}
				/>
			) : null}
			{editing ? (
				<div
					className="erp-modal-backdrop"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setEditing(null);
					}}
				>
					<section className="erp-price-modal" role="dialog" aria-modal="true" aria-labelledby="erp-price-title">
						<div className="ui-page-header">
							<div>
								<h2 id="erp-price-title">{t('Editar preço')}</h2>
								<p>{editing.name}</p>
							</div>
							<button type="button" aria-label={t('Fechar')} onClick={() => setEditing(null)}>
								{t('× ')}
							</button>
						</div>
						<label htmlFor="erp-price-input">{t('Preço de venda (R$)')}</label>
						<input
							id="erp-price-input"
							autoFocus
							inputMode="decimal"
							className="demo-input"
							value={price}
							onChange={(event) => setPrice(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter') void savePrice();
							}}
						/>
						<p className="demo-muted">{t('Sem internet, o valor fica disponível neste dispositivo e entra na fila de sincronização.')}</p>
						<div className="erp-modal-actions">
							<button type="button" className="demo-button demo-button-secondary" onClick={() => setEditing(null)}>
								{t('Cancelar ')}
							</button>
							<button type="button" className="demo-button" disabled={busy} onClick={() => void savePrice()}>
								{busy ? t('Salvando…') : t('Salvar preço')}
							</button>
						</div>
					</section>
				</div>
			) : null}
		</PrototypeFrame>
	);
}

export function InventoryPrototype() {
	const [ingredients, setIngredients] = useState<
		Array<{
			ingredient_id: string;
			name: string;
			base_unit: string;
			pack_quantity: string;
			supplier: string | null;
			pack_price_cents: number | null;
			status: string | null;
		}>
	>([]);
	const [search, setSearch] = useState('');
	const [status, setStatus] = useState('Carregando ingredientes…');
	useEffect(() => {
		const controller = new AbortController();
		void fetch('/api/erp/ingredients', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error(t('Não foi possível carregar os ingredientes.'));
				return response.json() as Promise<{ data: typeof ingredients }>;
			})
			.then((body) => {
				setIngredients(body.data);
				setStatus(t('{p0} ingredientes cadastrados.', { p0: body.data.length }));
			})
			.catch(() => {
				if (!controller.signal.aborted) setStatus(t('Ingredientes indisponíveis. Conecte-se e tente novamente.'));
			});
		return () => controller.abort();
	}, []);
	const filtered = ingredients.filter((ingredient) =>
		ingredient.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')),
	);
	return (
		<PrototypeFrame title={t('Ingredientes')} description={t('Consulte os insumos e suas cotações atuais.')}>
			<label>
				{t('Buscar ingrediente ')}
				<input className="demo-input" value={search} onChange={(event) => setSearch(event.target.value)} />
			</label>
			<p role="status">{t(status)}</p>
			<div className="erp-area-grid">
				{filtered.map((ingredient) => (
					<Card key={ingredient.ingredient_id}>
						<Badge>{ingredient.status ?? 'Pendente'}</Badge>
						<h2>{ingredient.name}</h2>
						<p className="demo-muted">
							{t('Pacote: ')}
							{ingredient.pack_quantity} {ingredient.base_unit} · {ingredient.supplier ?? 'Fornecedor não informado'}
						</p>
						<p>{ingredient.pack_price_cents == null ? t('Preço pendente') : <Price cents={ingredient.pack_price_cents} />}</p>
					</Card>
				))}
			</div>
			<p className="demo-muted">{t('A quantidade do pacote não indica a quantidade disponível em estoque.')}</p>
		</PrototypeFrame>
	);
}

export function FinancePrototype() {
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Sao_Paulo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(new Date());
	const [from, setFrom] = useState(today);
	const [to, setTo] = useState(today);
	const [totals, setTotals] = useState<Record<string, number>>({});
	const [entries, setEntries] = useState<
		Array<{
			ledger_id: string;
			occurred_on: string;
			entry_type: string;
			description: string;
			category: string;
			amount_cents: number;
			cancelled: number;
		}>
	>([]);
	const [entryType, setEntryType] = useState('');
	const [truncated, setTruncated] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [status, setStatus] = useState('Selecione o período e consulte.');
	const latestRequest = useRef(0);
	useEffect(
		() => () => {
			latestRequest.current += 1;
		},
		[],
	);
	async function loadFinance() {
		const requestId = ++latestRequest.current;
		setLoaded(false);
		setStatus(t('Consultando…'));
		try {
			const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
			const [response, entryResponse] = await Promise.all([
				fetch(`/api/erp/finance?${query}`, { credentials: 'same-origin', cache: 'no-store' }),
				fetch(`/api/erp/finance?${query}&entries=1&type=${encodeURIComponent(entryType)}`, {
					credentials: 'same-origin',
					cache: 'no-store',
				}),
			]);
			if (!response.ok || !entryResponse.ok) throw new Error(t('Não foi possível consultar o financeiro.'));
			const body = (await response.json()) as { data: Array<{ entry_type: string; total: number }> };
			const entryBody = (await entryResponse.json()) as { data: typeof entries; truncated: boolean };
			if (requestId !== latestRequest.current) return;
			setEntries(entryBody.data);
			setTruncated(entryBody.truncated);
			setTotals(Object.fromEntries(body.data.map((row) => [row.entry_type, row.total])));
			setLoaded(true);
			setStatus(t('Período consultado: {p0} a {p1}.', { p0: from, p1: to }));
		} catch (error) {
			if (requestId !== latestRequest.current) return;
			setTotals({});
			setEntries([]);
			setStatus(error instanceof Error ? error.message : t('Financeiro indisponível.'));
		}
	}
	return (
		<PrototypeFrame title={t('Financeiro')} description={t('Movimentações registradas no período.')}>
			<label>
				{t('De ')}
				<input className="demo-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
			</label>{' '}
			<label>
				{t('Até ')}
				<input className="demo-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
			</label>{' '}
			<label>
				{t('Tipo')}{' '}
				<select className="demo-input" value={entryType} onChange={(event) => setEntryType(event.target.value)}>
					<option value="">{t('Todos')}</option>
					<option value="sale">{t('Venda')}</option>
					<option value="purchase">{t('Compra')}</option>
					<option value="expense">{t('Gasto')}</option>
					<option value="adjustment">{t('Ajuste')}</option>
				</select>
			</label>{' '}
			<button type="button" className="demo-button" onClick={() => void loadFinance()}>
				{t('Consultar ')}
			</button>
			<p role="status">{t(status)}</p>
			{loaded ? (
				<>
					<div className="erp-area-grid">
						{[
							['Vendas brutas', totals.sale ?? 0],
							['Compras', totals.purchase ?? 0],
							['Gastos', totals.expense ?? 0],
						].map(([label, cents]) => (
							<Card key={String(label)}>
								<p className="demo-muted">{t(label)}</p>
								<Price cents={Number(cents)} />
							</Card>
						))}
					</div>
					<section>
						<h2>{t('Lançamentos')}</h2>
						{truncated ? (
							<p role="status">{t('Exibindo os 500 lançamentos mais recentes; reduza o período para consultar os demais.')}</p>
						) : null}
						{entries.length === 0 ? (
							<p>{t('Nenhum lançamento encontrado.')}</p>
						) : (
							<ul>
								{entries.map((entry) => (
									<li key={entry.ledger_id}>
										{entry.occurred_on} · {t(entry.entry_type)} · {entry.description} · {t(entry.category)} ·{' '}
										<Price cents={entry.amount_cents} />
										{entry.cancelled ? <strong> {t(' · Venda cancelada')}</strong> : null}
									</li>
								))}
							</ul>
						)}
					</section>
				</>
			) : null}
			<p className="demo-muted">
				{t(
					'Os totais excluem vendas canceladas; seus lançamentos permanecem identificados na lista para auditoria. Compras e gastos refletem os lançamentos registrados; estes valores não representam lucro. ',
				)}
			</p>
		</PrototypeFrame>
	);
}

export function SettingsPrototype() {
	return (
		<PrototypeFrame title={t('Ajustes')} description={t('Preferências deste dispositivo e informações sobre a aplicação.')}>
			<Card>
				<h2>{t('Preferências')}</h2>
				<Preferences />
			</Card>
		</PrototypeFrame>
	);
}
