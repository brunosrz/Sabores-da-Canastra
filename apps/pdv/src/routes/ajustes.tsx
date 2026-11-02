import { createFileRoute } from '@tanstack/react-router';
import { Badge, Card, PageHeader, ThemeToggle } from '@sabores/ui';

export const Route = createFileRoute('/ajustes')({ component: PdvSettings });

function PdvSettings() {
	return (
		<div className="demo-page">
			<PageHeader title="Ajustes do PDV" description="Preferências locais e estado do dispositivo." actions={<Badge>Dispositivo</Badge>} />
			<Card>
				<h2>Tema</h2>
				<p className="demo-muted">A preferência visual é guardada neste dispositivo.</p>
				<ThemeToggle />
			</Card>
			<Card>
				<h2>Dados offline</h2>
				<p className="demo-muted">
					O catálogo, rascunho e fila usam armazenamento local. Operações pendentes não podem ser apagadas sem sincronização ou resolução.
				</p>
			</Card>
		</div>
	);
}
