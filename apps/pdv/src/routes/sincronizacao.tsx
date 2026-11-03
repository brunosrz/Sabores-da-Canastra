import { t, formatLocale } from '@sabores/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, PageHeader } from '@sabores/ui';
import { listQueue, syncQueue, type QueuedOperation } from '../offline/store';

export const Route = createFileRoute('/sincronizacao')({ component: SyncQueuePage });

export function SyncQueuePage() {
	const [rows, setRows] = useState<QueuedOperation[]>([]);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState('');
	const refresh = useCallback(async () => setRows(await listQueue()), []);

	useEffect(() => {
		let active = true;
		void listQueue().then((queue) => {
			if (active) setRows(queue);
		});
		window.addEventListener('online', refresh);
		return () => {
			active = false;
			window.removeEventListener('online', refresh);
		};
	}, [refresh]);

	async function synchronize() {
		setBusy(true);
		setNotice(t('Sincronizando operações em ordem…'));
		try {
			await syncQueue(refresh);
			await refresh();
			setNotice(t('Sincronização concluída. Confira os estados de cada operação.'));
		} catch {
			setNotice(t('Não foi possível sincronizar agora. As operações continuam salvas neste dispositivo.'));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="demo-page demo-page-wide">
			<PageHeader
				title={t('Fila de sincronização')}
				description={t('Operações locais são enviadas em ordem e mantêm o mesmo identificador nas tentativas.')}
				actions={
					<Button variant="primary" busy={busy} onClick={() => void synchronize()}>
						{t('Sincronizar agora ')}
					</Button>
				}
			/>
			{notice ? (
				<p role="status" aria-live="polite">
					{t(notice)}
				</p>
			) : null}
			{rows.length === 0 ? (
				<EmptyState
					title={t('Nenhuma operação na fila')}
					description={t('Vendas e ajustes salvos neste dispositivo aparecerão aqui até serem sincronizados.')}
				/>
			) : (
				<div className="erp-area-grid">
					{rows.map((row) => (
						<Card key={row.operation.operationId}>
							<div className="pdv-section-heading">
								<h2>{t(row.operation.operationType)}</h2>
								<Badge>{t(row.state)}</Badge>
							</div>
							<p>{new Date(row.operation.occurredAt).toLocaleString(formatLocale())}</p>
							{row.error ? <p role="alert">{t(row.error)}</p> : null}
							<p className="demo-muted">
								{t('ID da operação: ')}
								{row.operation.operationId}
							</p>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
