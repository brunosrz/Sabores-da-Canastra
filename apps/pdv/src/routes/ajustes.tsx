import { t } from '@sabores/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { Badge, Card, PageHeader, Preferences } from '@sabores/ui';

export const Route = createFileRoute('/ajustes')({ component: PdvSettings });

export function PdvSettings() {
	return (
		<div className="demo-page">
			<PageHeader
				title={t('Ajustes do PDV')}
				description={t('Preferências locais e estado do dispositivo.')}
				actions={<Badge>{t('Dispositivo')}</Badge>}
			/>
			<Card>
				<h2>{t('Preferências')}</h2>
				<Preferences />
			</Card>
			<Card>
				<h2>{t('Dados offline')}</h2>
				<p className="demo-muted">
					{t(
						'O catálogo, rascunho e fila usam armazenamento local. Operações pendentes não podem ser apagadas sem sincronização ou resolução. ',
					)}
				</p>
			</Card>
		</div>
	);
}
