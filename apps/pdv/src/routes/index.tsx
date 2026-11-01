import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({ component: PdvHome });

function PdvHome() {
	return (
		<main className="mx-auto flex min-h-[70vh] max-w-5xl flex-col justify-center px-5 py-12">
			<p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#cf4712] dark:text-[#fca336]">Sabores da Canastra</p>
			<h1 className="mt-3 text-4xl font-bold tracking-tight text-[var(--sea-ink)] sm:text-6xl">Ponto de venda</h1>
			<p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--sea-ink-soft)]">
				Base independente para registrar vendas, itens e formas de pagamento, conectada à infraestrutura compartilhada do negócio.
			</p>
			<p className="mt-8 inline-flex w-fit rounded-full bg-amber-100 px-4 py-2 text-sm font-medium text-amber-950">
				Fundação técnica pronta para as próximas etapas
			</p>
		</main>
	);
}
