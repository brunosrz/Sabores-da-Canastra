import { Badge, Card, CategoryBadge, EmptyState, PageHeader, Price, ResponsiveTable } from '@sabores/ui';

type ExampleRow = { name: string; category: string; detail: string; cents: number };

const sampleProducts: ExampleRow[] = [
	{ name: 'Coxinha de frango', category: 'Salgados', detail: 'Unidade · custo cadastrado', cents: 800 },
	{ name: 'Refrigerante 350 ml', category: 'Bebidas', detail: 'Lata · estoque em acompanhamento', cents: 600 },
	{ name: 'Pizza calabresa', category: 'Pizzas', detail: 'Média · ficha técnica pendente', cents: 5000 },
];

function PrototypeFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
	return (
		<div className="demo-page demo-page-wide">
			<PageHeader title={title} description={description} actions={<Badge>Protótipo</Badge>} />
			{children}
		</div>
	);
}

export function ProductsPrototype() {
	return (
		<PrototypeFrame title="Produtos" description="Catálogo do bar com preços, categorias, custos e fichas técnicas.">
			<ResponsiveTable
				caption="Exemplos do catálogo de produtos"
				columns={[
					{ key: 'name', label: 'Produto' },
					{ key: 'category', label: 'Categoria', render: (row) => <CategoryBadge category={row.category} /> },
					{ key: 'detail', label: 'Detalhes' },
					{ key: 'cents', label: 'Venda', render: (row) => <Price cents={row.cents} /> },
				]}
				rows={sampleProducts}
				rowKey={(row) => row.name}
			/>
			<p className="demo-muted">Dados demonstrativos; edição de catálogo será conectada ao fluxo de produtos do ERP.</p>
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
	return (
		<PrototypeFrame title="Financeiro" description="Resumo demonstrativo de vendas, compras, taxas e despesas do período.">
			<div className="erp-area-grid">
				{[
					['Vendas brutas', 128450],
					['Taxas estimadas', 4820],
					['Custos e despesas', 75200],
					['Resultado estimado', 48430],
				].map(([label, cents]) => (
					<Card key={String(label)}>
						<p className="demo-muted">{label}</p>
						<Price cents={Number(cents)} />
					</Card>
				))}
			</div>
			<EmptyState title="Visão de demonstração" description="Os valores acima são sintéticos e não representam o caixa real." />
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
