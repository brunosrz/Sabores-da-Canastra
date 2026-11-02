import { Badge, Card, CategoryBadge, EmptyState, PageHeader, Price, ResponsiveTable } from '@sabores/ui';
import { useEffect, useState } from 'react';
import { enqueuePriceChange, listPriceOperations, loadProducts, refreshProducts, syncPriceQueue, type ErpProduct } from '../offline/store';

function PrototypeFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
	return (
		<div className="demo-page demo-page-wide">
			<PageHeader title={title} description={description} actions={<Badge>Protótipo</Badge>} />
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
			void loadProducts().then(setProducts);
		};
		window.addEventListener('erp-catalog-changed', reloadCatalog);
		void loadProducts()
			.then((cached) => {
				setProducts(cached);
				setStatus(cached.length ? `${cached.length} produtos salvos neste dispositivo` : 'Nenhum catálogo local ainda');
				return refreshProducts();
			})
			.then((fresh) => {
				setProducts(fresh);
				setStatus(`${fresh.length} produtos sincronizados com o D1`);
			})
			.catch(() => setStatus('Offline: exibindo o catálogo deste dispositivo.'));
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
			setStatus('Informe um preço válido com até duas casas decimais.');
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
					? 'Preço salvo localmente; sincronizando com o servidor…'
					: 'Preço enfileirado neste dispositivo para sincronizar quando voltar a internet.',
			);
			await syncPriceQueue();
			const saved = (await listPriceOperations()).find((item) => item.operationId === operation.operationId);
			setStatus(
				saved?.state === 'synced'
					? 'Preço atualizado no D1 e registrado no histórico.'
					: saved?.state === 'conflict'
						? 'Conflito: o servidor tem outro preço. Recarregue o catálogo e revise antes de tentar novamente.'
						: saved?.state === 'blocked_auth'
							? 'Preço aguardando uma sessão válida para sincronizar.'
							: 'Preço salvo neste dispositivo e aguardando sincronização.',
			);
		} catch (error) {
			setStatus(error instanceof Error ? error.message : 'Não foi possível salvar o preço.');
		} finally {
			setBusy(false);
		}
	}
	return (
		<PrototypeFrame title="Produtos" description="Catálogo do bar com preços, categorias, custos e fichas técnicas.">
			<div className="erp-catalog-tools">
				<label htmlFor="erp-product-search">Buscar produto</label>
				<input
					id="erp-product-search"
					className="demo-input"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder="Nome, código de barras ou código auxiliar"
				/>
				<span role="status">{status}</span>
			</div>
			<ResponsiveTable
				caption="Catálogo de produtos"
				columns={[
					{ key: 'name', label: 'Produto' },
					{
						key: 'category',
						label: 'Categoria',
						render: (row) => <CategoryBadge category={row.category} />,
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
							<CategoryBadge category={product.category} />
							<h2>{product.name}</h2>
							<p>
								{product.barcode || product.auxiliary_code || 'Sem código'} · {product.unit}
							</p>
						</div>
						<div>
							<span>Venda</span>
							<Price cents={product.sale_price_cents ?? 0} />
						</div>
						<div>
							<span>Custo</span>
							<strong>{product.unit_cost_cents == null ? 'Pendente' : <Price cents={product.unit_cost_cents} />}</strong>
						</div>
						<button
							className="demo-button demo-button-secondary"
							type="button"
							onClick={() => {
								setEditing(product);
								setPrice(((product.sale_price_cents ?? 0) / 100).toFixed(2).replace('.', ','));
							}}
						>
							Editar preço
						</button>
					</Card>
				))}
			</div>
			{!filtered.length ? (
				<EmptyState
					title="Nenhum produto no catálogo local"
					description="Conecte-se para carregar os produtos cadastrados no banco de dados."
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
								<h2 id="erp-price-title">Editar preço</h2>
								<p>{editing.name}</p>
							</div>
							<button type="button" aria-label="Fechar" onClick={() => setEditing(null)}>
								×
							</button>
						</div>
						<label htmlFor="erp-price-input">Preço de venda (R$)</label>
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
						<p className="demo-muted">Sem internet, o valor fica disponível neste dispositivo e entra na fila de sincronização.</p>
						<div className="erp-modal-actions">
							<button type="button" className="demo-button demo-button-secondary" onClick={() => setEditing(null)}>
								Cancelar
							</button>
							<button type="button" className="demo-button" disabled={busy} onClick={() => void savePrice()}>
								{busy ? 'Salvando…' : 'Salvar preço'}
							</button>
						</div>
					</section>
				</div>
			) : null}
		</PrototypeFrame>
	);
}

export function InventoryPrototype() {
	return (
		<PrototypeFrame title="Estoque" description="Acompanhe insumos e produtos para planejar compras e produção.">
			<div className="erp-area-grid">
				{[
					['Abaixo do mínimo', 'Queijo mussarela', '2,4 kg disponíveis'],
					['Em dia', 'Refrigerante 350 ml', '18 unidades disponíveis'],
					['A conferir', 'Massa de pastel', 'Última contagem há 3 dias'],
				].map(([status, name, detail]) => (
					<Card key={name}>
						<Badge>{status}</Badge>
						<h2>{name}</h2>
						<p className="demo-muted">{detail}</p>
					</Card>
				))}
			</div>
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
	const [loaded, setLoaded] = useState(false);
	const [status, setStatus] = useState('Selecione o período e consulte.');
	async function loadFinance() {
		setLoaded(false);
		setStatus('Consultando…');
		try {
			const response = await fetch(`/api/erp/finance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
				credentials: 'same-origin',
				cache: 'no-store',
			});
			if (!response.ok) throw new Error('Não foi possível consultar o financeiro.');
			const body = (await response.json()) as { data: Array<{ entry_type: string; total: number }> };
			setTotals(Object.fromEntries(body.data.map((row) => [row.entry_type, row.total])));
			setLoaded(true);
			setStatus(`Período consultado: ${from} a ${to}.`);
		} catch (error) {
			setTotals({});
			setStatus(error instanceof Error ? error.message : 'Financeiro indisponível.');
		}
	}
	return (
		<PrototypeFrame title="Financeiro" description="Movimentações registradas no período.">
			<label>
				De <input className="demo-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
			</label>{' '}
			<label>
				Até <input className="demo-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
			</label>{' '}
			<button type="button" className="demo-button" onClick={() => void loadFinance()}>
				Consultar
			</button>
			<p role="status">{status}</p>
			{loaded ? (
				<div className="erp-area-grid">
					{[
						['Vendas brutas', totals.sale ?? 0],
						['Compras', totals.purchase ?? 0],
						['Gastos', totals.expense ?? 0],
					].map(([label, cents]) => (
						<Card key={String(label)}>
							<p className="demo-muted">{label}</p>
							<Price cents={Number(cents)} />
						</Card>
					))}
				</div>
			) : null}
			<p className="demo-muted">
				Vendas canceladas são excluídas. Compras e gastos refletem os lançamentos registrados; estes valores não representam lucro.
			</p>
		</PrototypeFrame>
	);
}

export function SettingsPrototype() {
	return (
		<PrototypeFrame title="Ajustes" description="Preferências deste dispositivo e informações sobre a aplicação.">
			<Card>
				<h2>Preferência visual</h2>
				<p>Use o seletor de tema na barra superior para escolher claro, escuro ou seguir o sistema.</p>
				<p className="demo-muted">A preferência fica neste navegador; dados de negócio e credenciais não são armazenados aqui.</p>
			</Card>
		</PrototypeFrame>
	);
}
