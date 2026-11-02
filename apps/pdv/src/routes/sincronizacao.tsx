import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, PageHeader } from '@sabores/ui';
import { listQueue, syncQueue, type QueuedOperation } from '../offline/store';

export const Route = createFileRoute('/sincronizacao')({ component: SyncQueuePage });

function SyncQueuePage() {
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
		setNotice('Sincronizando operações em ordem…');
		try {
			await syncQueue(refresh);
			await refresh();
			setNotice('Sincronização concluída. Confira os estados de cada operação.');
		} catch {
			setNotice('Não foi possível sincronizar agora. As operações continuam salvas neste dispositivo.');
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="demo-page demo-page-wide">
			<PageHeader
				title="Fila de sincronização"
				description="Operações locais são enviadas em ordem e mantêm o mesmo identificador nas tentativas."
				actions={
					<Button variant="primary" busy={busy} onClick={() => void synchronize()}>
						Sincronizar agora
					</Button>
				}
			/>
			{notice ? (
				<p role="status" aria-live="polite">
					{notice}
				</p>
			) : null}
			{rows.length === 0 ? (
				<EmptyState
					title="Nenhuma operação na fila"
					description="Vendas e ajustes salvos neste dispositivo aparecerão aqui até serem sincronizados."
				/>
			) : (
				<div className="erp-area-grid">
					{rows.map((row) => (
						<Card key={row.operation.operationId}>
							<div className="pdv-section-heading">
								<h2>{row.operation.operationType}</h2>
								<Badge>{row.state}</Badge>
							</div>
							<p>{new Date(row.operation.occurredAt).toLocaleString('pt-BR')}</p>
							{row.error ? <p role="alert">{row.error}</p> : null}
							<p className="demo-muted">ID da operação: {row.operation.operationId}</p>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
