import { apiFetch } from '@sabores/ui/platform';
import { t, formatLocale } from '@sabores/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { feeCents } from '@sabores/pdv-sync';
import { createOperation, getDeviceId, listQueue, removeQueuedOperation, syncQueue, type QueuedOperation } from '../offline/store';
import { useAuthUser } from '../auth-gate';
import { summarizeSales } from '../sales-summary';
import type { OperationEnvelope, PaymentMethod, SaleAdjustPaymentsPayload, SaleCreatePayload, SalePayment } from '@sabores/pdv-sync';

export const Route = createFileRoute('/historico')({ component: SalesHistory });

type HistorySale = {
	sale_id: string;
	gross_cents: number;
	fee_cents: number;
	net_cents: number;
	occurred_on: string;
	created_at: string;
	cancellation_reason: string | null;
	payment_version: number | null;
	items: Array<{
		product_name_snapshot: string;
		quantity: string;
		line_total_cents: number;
	}>;
	payments: Array<{
		method: PaymentMethod;
		method_label: string | null;
		amount_cents: number;
		fee_rate: string;
		fee_cents: number;
		part_number: number;
	}>;
};
const day = () =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Sao_Paulo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(new Date());
const money = (cents: number) => (cents / 100).toLocaleString(formatLocale(), { style: 'currency', currency: 'BRL' });
const METHODS: PaymentMethod[] = ['Dinheiro', 'Débito', 'Crédito', 'Pix'];

export function SalesHistory() {
	const user = useAuthUser();
	const [from, setFrom] = useState(day());
	const [to, setTo] = useState(day());
	const [sales, setSales] = useState<HistorySale[]>([]);
	const [queue, setQueue] = useState<QueuedOperation[]>([]);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [feedback, setFeedback] = useState('');
	const [adjusting, setAdjusting] = useState<string | null>(null);
	const [reason, setReason] = useState('');
	const [adjusted, setAdjusted] = useState<SalePayment[]>([]);
	const [paymentFees, setPaymentFees] = useState<Record<PaymentMethod, string>>({
		Dinheiro: '0',
		Débito: '0.0139',
		Crédito: '0.0334',
		Pix: '0',
	});

	const refreshQueue = useCallback(async () => {
		setQueue(await listQueue().catch(() => []));
	}, []);

	const loadHistory = useCallback(async () => {
		if (!navigator.onLine) return;
		setBusy(true);
		setError('');
		try {
			const response = await apiFetch(`/api/pdv/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
				credentials: 'same-origin',
				cache: 'no-store',
			});
			if (!response.ok) throw new Error(t('Histórico indisponível ({p0}).', { p0: response.status }));
			const body = (await response.json()) as {
				sales: HistorySale[];
				paymentFees: Record<PaymentMethod, string>;
			};
			setSales(body.sales);
			setPaymentFees(body.paymentFees);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t('Não foi possível consultar o histórico.'));
		} finally {
			setBusy(false);
		}
	}, [from, to]);

	useEffect(() => {
		const initialLoad = window.setTimeout(() => {
			void refreshQueue();
			void loadHistory();
		}, 0);
		const online = () => {
			void refreshQueue();
			void loadHistory();
		};
		window.addEventListener('online', online);
		return () => {
			window.clearTimeout(initialLoad);
			window.removeEventListener('online', online);
		};
	}, [loadHistory, refreshQueue]);

	async function cancelSale(saleId: string) {
		if (!user) return;
		const cancellationReason = window.prompt('Informe o motivo do cancelamento:')?.trim();
		if (!cancellationReason) return;
		try {
			const deviceId = await getDeviceId();
			const operation = await createOperation(deviceId, user.id, user.username, 'sale.cancel', { saleId, reason: cancellationReason });
			await import('../offline/store').then(({ enqueueOperation }) => enqueueOperation(operation));
			setFeedback(
				navigator.onLine
					? 'Cancelamento adicionado à fila de sincronização.'
					: 'Cancelamento guardado para sincronizar ao voltar a conexão.',
			);
			if (navigator.onLine) await syncQueue();
			await Promise.all([refreshQueue(), loadHistory()]);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t('Falha ao solicitar cancelamento.'));
		}
	}

	function startAdjustment(sale: HistorySale) {
		const version = sale.payment_version ?? 1;
		setAdjusting(sale.sale_id);
		setReason('');
		setAdjusted(
			sale.payments.map((payment, position) => ({
				...payment,
				methodLabel: payment.method_label,
				amountCents: payment.amount_cents,
				feeRate: payment.fee_rate,
				feeCents: payment.fee_cents,
				partNumber: payment.part_number,
				position,
			})),
		);
		if (version < 1) setError(t('Versão de pagamento inválida.'));
	}

	async function submitAdjustment(sale: HistorySale) {
		if (!user || !reason.trim() || !adjusted.length) return;
		const payload: SaleAdjustPaymentsPayload = {
			saleId: sale.sale_id,
			basePaymentVersion: sale.payment_version ?? 1,
			reason: reason.trim(),
			payments: adjusted,
		};
		try {
			const deviceId = await getDeviceId();
			const operation: OperationEnvelope = await createOperation(deviceId, user.id, user.username, 'sale.adjust_payments', payload);
			const { enqueueOperation } = await import('../offline/store');
			await enqueueOperation(operation);
			setAdjusting(null);
			setFeedback('Correção adicionada à fila de sincronização.');
			if (navigator.onLine) await syncQueue();
			await Promise.all([refreshQueue(), loadHistory()]);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t('Falha ao corrigir os pagamentos.'));
		}
	}

	function queueLabel(row: QueuedOperation) {
		const names: Record<QueuedOperation['state'], string> = {
			pending: 'Pendente',
			syncing: 'Sincronizando',
			synced: 'Sincronizada',
			duplicate: 'Possível duplicata',
			conflict: 'Conflito',
			invalid: 'Rejeitada',
			auth_required: 'Entre para sincronizar',
		};
		return names[row.state];
	}

	const summary = summarizeSales(sales);

	return (
		<div className="pdv-page">
			<section className="pdv-heading">
				<div>
					<p className="island-kicker">{t('Vendas e sincronização')}</p>
					<h1>{t('Histórico')}</h1>
					<p className="demo-muted">
						{t('O histórico do servidor só é carregado online; offline aparecem as operações deste dispositivo.')}
					</p>
				</div>
				<button
					type="button"
					className="demo-button"
					onClick={() => void syncQueue().then(() => Promise.all([refreshQueue(), loadHistory()]))}
				>
					{t('Sincronizar agora ')}
				</button>
			</section>
			{error ? (
				<p role="alert" className="pdv-message">
					{t(error)}
				</p>
			) : null}
			{feedback ? (
				<p role="status" className="pdv-message">
					{feedback}
				</p>
			) : null}
			<section className="pdv-panel">
				<div className="pdv-section-heading">
					<h2>{t('Período')}</h2>
					<span>{navigator.onLine ? t('Histórico remoto') : t('Modo offline')}</span>
				</div>
				<div className="pdv-history-filter">
					<label>
						{t('De ')}
						<input className="demo-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
					</label>
					<label>
						{t('Até ')}
						<input className="demo-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
					</label>
					<button type="button" className="demo-button" disabled={busy || !navigator.onLine} onClick={() => void loadHistory()}>
						{busy ? t('Carregando…') : t('Filtrar')}
					</button>
				</div>
				{navigator.onLine && !error && sales.length > 0 ? (
					<section aria-label={t('Resumo das vendas carregadas')} className="pdv-panel">
						<h3>{t('Resumo das vendas carregadas')}</h3>
						{sales.length >= 500 ? (
							<p role="status">{t('O histórico está limitado a 500 vendas. Reduza o período para obter totais completos.')}</p>
						) : null}
						<p>
							{summary.count} {t(' vendas · Bruto ')}
							{money(summary.gross)} {t(' · Taxas ')}
							{money(summary.fees)} {t(' · Recebido ')}
							{money(summary.net)}
						</p>
						<p>{t('Recebido por forma de pagamento')}</p>
						<ul>
							{summary.payments.map(([method, amount]) => (
								<li key={t(method)}>
									{t(method)}: {money(amount)}
								</li>
							))}
						</ul>
						<p>{t('Itens vendidos')}</p>
						<ul>
							{summary.products.map(([name, item]) => (
								<li key={name}>
									{name}: {item.quantity.toLocaleString(formatLocale())} · {money(item.total)}
								</li>
							))}
						</ul>
					</section>
				) : null}
				{!navigator.onLine ? (
					<div className="pdv-history-list">
						{queue
							.filter((row) => row.operation.operationType === 'sale.create')
							.map((row) => {
								const payload = row.operation.payload as SaleCreatePayload;
								return (
									<article className="pdv-history-card" key={row.operation.operationId}>
										<div>
											<strong>
												{t('Venda local ')}
												{payload.saleId}
											</strong>
											<p>{payload.items.map((item) => t('{p0}× {p1}', { p0: item.quantity, p1: item.name })).join(', ')}</p>
											<small>
												{new Date(row.operation.occurredAt).toLocaleString(formatLocale())} · {queueLabel(row)}
											</small>
										</div>
										<b>{money(payload.items.reduce((sum, item) => sum + item.lineTotalCents, 0))}</b>
										<button
											type="button"
											className="demo-button demo-button-danger"
											onClick={() => void cancelSale(payload.saleId)}
											disabled={row.state === 'duplicate' || row.state === 'invalid'}
										>
											{t('Cancelar ')}
										</button>
									</article>
								);
							})}
					</div>
				) : (
					<div className="pdv-history-list">
						{sales.map((sale) => (
							<article className="pdv-history-card" key={sale.sale_id}>
								<div className="pdv-history-main">
									<strong>
										{sale.occurred_on} · {sale.sale_id}
									</strong>
									<p>{sale.items.map((item) => t('{p0}× {p1}', { p0: item.quantity, p1: item.product_name_snapshot })).join(', ')}</p>
									<small>
										{t('Pagamentos: ')}
										{sale.payments
											.map((payment) => t('{p0} {p1}', { p0: payment.method, p1: money(payment.amount_cents) }))
											.join(' · ')}{' '}
										{t(' · versão')} {sale.payment_version ?? 1}
									</small>
									{sale.cancellation_reason ? (
										<p className="pdv-cancelled">
											{t('Cancelada: ')}
											{sale.cancellation_reason}
										</p>
									) : null}
								</div>
								<div className="pdv-history-total">
									<strong>{money(sale.gross_cents)}</strong>
									<small>
										{t('Líquido ')}
										{money(sale.net_cents)}
									</small>
								</div>
								{!sale.cancellation_reason ? (
									<div className="pdv-history-actions">
										<button type="button" className="demo-button demo-button-secondary" onClick={() => startAdjustment(sale)}>
											{t('Corrigir pagamento ')}
										</button>
										<button type="button" className="demo-button demo-button-danger" onClick={() => void cancelSale(sale.sale_id)}>
											{t('Cancelar venda ')}
										</button>
									</div>
								) : null}
								{adjusting === sale.sale_id ? (
									<form
										className="pdv-adjust-form"
										onSubmit={(event) => {
											event.preventDefault();
											void submitAdjustment(sale);
										}}
									>
										<h3>{t('Nova versão dos pagamentos')}</h3>
										{adjusted.map((payment, index) => (
											<div className="pdv-payment-row" key={index}>
												<label>
													{t('Forma ')}
													<select
														className="demo-select"
														value={t(payment.method)}
														onChange={(event) =>
															setAdjusted((current) =>
																current.map((line, lineIndex) =>
																	lineIndex === index
																		? {
																				...line,
																				method: event.target.value as PaymentMethod,
																				feeRate: paymentFees[event.target.value as PaymentMethod],
																				feeCents: feeCents(line.amountCents, paymentFees[event.target.value as PaymentMethod]) ?? 0,
																			}
																		: line,
																),
															)
														}
													>
														{METHODS.map((method) => (
															<option key={method} value={method}>
																{t(method)}
															</option>
														))}
													</select>
												</label>
												<label>
													{t('Valor (centavos) ')}
													<input
														className="demo-input"
														type="number"
														min="1"
														step="1"
														value={payment.amountCents}
														onChange={(event) =>
															setAdjusted((current) =>
																current.map((line, lineIndex) =>
																	lineIndex === index
																		? {
																				...line,
																				amountCents: Number(event.target.value),
																				feeCents: feeCents(Number(event.target.value), line.feeRate) ?? 0,
																			}
																		: line,
																),
															)
														}
													/>
												</label>
											</div>
										))}
										<label>
											{t('Motivo obrigatório ')}
											<input
												className="demo-input"
												value={reason}
												onChange={(event) => setReason(event.target.value)}
												required
												maxLength={500}
											/>
										</label>
										<div className="pdv-actions">
											<button type="button" className="demo-button demo-button-secondary" onClick={() => setAdjusting(null)}>
												{t('Voltar ')}
											</button>
											<button className="demo-button" type="submit" disabled={!reason.trim()}>
												{t('Salvar correção ')}
											</button>
										</div>
									</form>
								) : null}
							</article>
						))}
						{!sales.length ? (
							<p className="demo-muted">
								{navigator.onLine ? t('Nenhuma venda no período.') : t('Sem vendas remotas disponíveis offline.')}
							</p>
						) : null}
					</div>
				)}
			</section>
			<section className="pdv-panel">
				<div className="pdv-section-heading">
					<h2>{t('Fila neste dispositivo')}</h2>
					<span>
						{queue.length} {t(' operação(ões)')}
					</span>
				</div>
				<div className="pdv-history-list">
					{queue.map((row) => (
						<article className="pdv-queue-row" key={row.operation.operationId}>
							<div>
								<strong>{t(row.operation.operationType)}</strong>
								<small>
									{new Date(row.queuedAt).toLocaleString(formatLocale())} · {row.operation.operationId}
								</small>
								{row.error ? <p role={row.state === 'invalid' || row.state === 'conflict' ? 'alert' : 'status'}>{t(row.error)}</p> : null}
							</div>
							<span className={`demo-pill state-${row.state}`}>{queueLabel(row)}</span>
							{['duplicate', 'conflict', 'invalid'].includes(row.state) ? (
								<button
									type="button"
									className="demo-button demo-button-danger"
									onClick={() =>
										void removeQueuedOperation(row.operation.operationId)
											.then(() => syncQueue())
											.then(refreshQueue)
									}
								>
									{t('Remover para continuar ')}
								</button>
							) : null}
						</article>
					))}
					{!queue.length ? <p className="demo-muted">{t('Nenhuma operação pendente.')}</p> : null}
				</div>
			</section>
		</div>
	);
}
