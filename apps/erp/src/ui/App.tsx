import { resolveAppMode } from './app-mode';

const mode = resolveAppMode(window.location.hostname, window.location.pathname);

const appContent = {
	pdv: {
		eyebrow: 'SABORES DA CANASTRA · FRENTE DE CAIXA',
		title: 'PDV de vendas',
		description: 'O espaço do ponto de venda está pronto para receber as próximas etapas.',
	},
	gestao: {
		eyebrow: 'SABORES DA CANASTRA · GESTÃO',
		title: 'Gestão do negócio',
		description: 'O espaço de gestão está pronto para receber as próximas etapas.',
	},
	inicio: {
		eyebrow: 'SABORES DA CANASTRA',
		title: 'Escolha um aplicativo',
		description: 'O PDV e a Gestão compartilham a plataforma e terão experiências próprias.',
	},
} as const;

export function App() {
	const content = appContent[mode];

	return (
		<main className="shell">
			<header className="topbar">
				<a className="brand" href="/" aria-label="Sabores da Canastra início">
					<span className="brand-mark" aria-hidden="true">
						S
					</span>
					<span>Sabores da Canastra</span>
				</a>
				<span className="environment-tag">AMBIENTE LOCAL</span>
			</header>

			<section className="hero" aria-labelledby="page-title">
				<p className="eyebrow">{content.eyebrow}</p>
				<h1 id="page-title">{content.title}</h1>
				<p className="description">{content.description}</p>

				{mode === 'inicio' ? (
					<div className="app-links">
						<a className="app-card app-card-primary" href="/pdv">
							<span className="app-card-icon" aria-hidden="true">
								↗
							</span>
							<span className="app-card-title">Abrir PDV</span>
							<span className="app-card-copy">Lançamento e consulta de vendas</span>
						</a>
						<a className="app-card" href="/gestao">
							<span className="app-card-icon" aria-hidden="true">
								▤
							</span>
							<span className="app-card-title">Abrir Gestão</span>
							<span className="app-card-copy">Custos, receitas e operação</span>
						</a>
					</div>
				) : (
					<a className="back-link" href="/">
						← Voltar à seleção de aplicativos
					</a>
				)}
			</section>

			<footer className="footer">Plataforma privada · Aplicativo em desenvolvimento</footer>
		</main>
	);
}
