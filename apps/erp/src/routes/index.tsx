import { createFileRoute } from '@tanstack/react-router';
import { Badge, PageHeader } from '@sabores/ui';

export const Route = createFileRoute('/')({ component: ErpHome });

const areas = [
	{ id: 'cadastros', title: 'Cadastros', description: 'Produtos, ingredientes e fornecedores', icon: '▦' },
	{ id: 'operacao', title: 'Operação', description: 'Receitas, estoque, compras e produção', icon: '◷' },
	{ id: 'financeiro', title: 'Financeiro', description: 'Custos, despesas, vendas e resultados', icon: 'R$' },
];

function ErpHome() {
	return (
		<div className="erp-home">
			<section className="erp-welcome" id="inicio">
				<img src="/brand/logo-sabores-canastra.svg" alt="Sabores da Canastra" width="1600" height="520" />
				<p className="island-kicker">Gestão do bar</p>
				<PageHeader
					title="ERP"
					description="Cadastros, operação e acompanhamento financeiro em um só lugar."
					actions={<Badge>Protótipo</Badge>}
				/>
			</section>
			<section className="erp-area-grid" aria-label="Áreas do ERP">
				{areas.map((area) => (
					<article className="erp-area-card" id={area.id} key={area.id}>
						<span aria-hidden="true" className="erp-area-icon">
							{area.icon}
						</span>
						<div>
							<h2>{area.title}</h2>
							<p>{area.description}</p>
						</div>
						<span className="demo-pill">Área do sistema</span>
					</article>
				))}
			</section>
			<p className="erp-mobile-hint">Use a navegação inferior para acessar as áreas do ERP.</p>
		</div>
	);
}
