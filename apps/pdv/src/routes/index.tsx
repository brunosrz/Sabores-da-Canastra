import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
	feeCents,
	lineTotalCents,
	operationIdentity,
	operationPayloadHash,
	splitEqual,
	validateOperationPayload,
	type PaymentMethod,
	type SaleCreatePayload,
	type SalePayment,
} from '@sabores/pdv-sync';
import { useAuthUser } from '../auth-gate';
import {
	clearDraft,
	commitSaleAndClearDraft,
	createSaleOperation,
	DEFAULT_FEES,
	getPaymentFees,
	getDeviceId,
	listProducts,
	loadDraft,
	saveDraft,
	syncQueue,
	updateCatalog,
	type CachedProduct,
} from '../offline/store';

export const Route = createFileRoute('/')({ component: PdvHome });

type BasketLine = { product: CachedProduct; quantity: string };
type PaymentDraft = {
	method: PaymentMethod;
	partNumber: number;
	amount: string;
};
const METHODS: PaymentMethod[] = ['Dinheiro', 'Débito', 'Crédito', 'Pix'];
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const centsFromInput = (value: string) => {
	if (!/^\d*(?:[,.]\d{0,2})?$/.test(value)) return null;
	const [whole = '0', fraction = ''] = value.replace(',', '.').split('.');
	const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
	return Number.isSafeInteger(cents) ? cents : null;
};
const textMoney = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

function PdvHome() {
	const user = useAuthUser();
	const [products, setProducts] = useState<CachedProduct[]>([]);
	const [basket, setBasket] = useState<BasketLine[]>([]);
	const [payments, setPayments] = useState<PaymentDraft[]>([{ method: 'Dinheiro', partNumber: 1, amount: '0,00' }]);
	const [partCount, setPartCount] = useState(1);
	const [customSplit, setCustomSplit] = useState(false);
	const [splitAmounts, setSplitAmounts] = useState<string[]>(['0,00']);
	const [search, setSearch] = useState('');
	const [customer, setCustomer] = useState('');
	const [notes, setNotes] = useState('');
	const [catalogState, setCatalogState] = useState('Carregando catálogo local…');
	const [busy, setBusy] = useState(false);
	const [paymentOpen, setPaymentOpen] = useState(false);
	const [receipt, setReceipt] = useState<{
		sale: SaleCreatePayload;
		occurredAt: string;
	} | null>(null);
	const [message, setMessage] = useState('');
	const [draftId, setDraftId] = useState('');
	const [deviceId, setDeviceId] = useState('');
	const [fees, setFees] = useState(DEFAULT_FEES);
	const searchInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		void (async () => {
			const [cached, draft, id, localFees] = await Promise.all([
				listProducts(),
				loadDraft<{
					basket?: BasketLine[];
					customer?: string;
					notes?: string;
					partCount?: number;
					payments?: PaymentDraft[];
					customSplit?: boolean;
					splitAmounts?: string[];
					draftId?: string;
				}>(),
				getDeviceId(),
				getPaymentFees(),
			]);
			setProducts(cached);
			setDeviceId(id);
			setFees(localFees);
			setDraftId(draft?.draftId ?? crypto.randomUUID());
			if (draft) {
				setBasket(draft.basket ?? []);
				setCustomer(draft.customer ?? '');
				setNotes(draft.notes ?? '');
				setPartCount(draft.partCount ?? 1);
				setPayments(draft.payments ?? [{ method: 'Dinheiro', partNumber: 1, amount: '0,00' }]);
				setCustomSplit(draft.customSplit ?? false);
				setSplitAmounts(draft.splitAmounts ?? ['0,00']);
			}
			setCatalogState(cached.length ? `${cached.length} itens salvos neste dispositivo` : 'Nenhum catálogo local ainda');
			try {
				const result = await updateCatalog();
				setProducts(result.products);
				setFees(await getPaymentFees());
				setCatalogState(
					`${result.products.length} itens · atualizado ${new Date(result.fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
				);
			} catch {
				if (!cached.length) setCatalogState('Conecte-se uma vez para carregar o catálogo neste dispositivo.');
				else setCatalogState(`${cached.length} itens locais · pode estar desatualizado`);
			}
		})().catch((error) => setMessage(error instanceof Error ? error.message : 'Não foi possível iniciar o PDV.'));
	}, []);

	useEffect(() => {
		if (!draftId) return;
		void saveDraft({
			draftId,
			basket,
			customer,
			notes,
			partCount,
			payments,
			customSplit,
			splitAmounts,
		});
	}, [draftId, basket, customer, notes, partCount, payments, customSplit, splitAmounts]);

	const total = useMemo(
		() => basket.reduce((sum, line) => sum + (lineTotalCents(line.quantity, line.product.sale_price_cents ?? 0) ?? 0), 0),
		[basket],
	);
	const splits = useMemo(() => {
		if (!customSplit) return splitEqual(total, partCount);
		const amounts = splitAmounts.map(centsFromInput);
		if (
			amounts.length !== partCount ||
			amounts.some((amount) => amount === null || amount <= 0) ||
			amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0) !== total
		)
			return null;
		return amounts.map((dueCents, index) => ({
			partNumber: index + 1,
			dueCents: dueCents!,
		}));
	}, [customSplit, partCount, splitAmounts, total]);
	const paymentAmounts = payments.map((payment) => centsFromInput(payment.amount));
	const paymentTotal = paymentAmounts.every((value) => value !== null)
		? paymentAmounts.reduce<number>((sum, value) => sum + value!, 0)
		: -1;
	const feeTotal = payments.reduce((sum, payment, index) => {
		const amount = paymentAmounts[index];
		const rate = fees[payment.method].replace(',', '.');
		const fee = amount === null ? null : feeCents(amount, rate);
		return sum + (fee ?? 0);
	}, 0);
	const visibleProducts = products
		.filter((product) =>
			`${product.barcode ?? ''} ${product.auxiliary_code ?? ''} ${product.name} ${product.category}`
				.toLocaleLowerCase()
				.includes(search.trim().toLocaleLowerCase()),
		)
		.slice(0, 100);

	function addProduct(product: CachedProduct) {
		setBasket((current) => {
			const existing = current.find((line) => line.product.product_id === product.product_id);
			if (existing)
				return current.map((line) =>
					line.product.product_id === product.product_id ? { ...line, quantity: String(Number(line.quantity) + 1) } : line,
				);
			return [...current, { product, quantity: '1' }];
		});
	}

	function selectProduct(product: CachedProduct) {
		addProduct(product);
		setSearch('');
		requestAnimationFrame(() => searchInput.current?.focus());
	}

	function setQuantity(id: string, value: string) {
		setBasket((current) => current.map((line) => (line.product.product_id === id ? { ...line, quantity: value } : line)));
	}

	function selectPartCount(value: number) {
		setPartCount(value);
		setCustomSplit(false);
		const nextSplits = splitEqual(total, value) ?? [];
		setSplitAmounts(nextSplits.map((part) => textMoney(part.dueCents)));
		setPayments(
			nextSplits.map((part) => ({
				method: 'Dinheiro',
				partNumber: part.partNumber,
				amount: textMoney(part.dueCents),
			})),
		);
	}

	function addPayment(partNumber: number) {
		const due = splits?.find((part) => part.partNumber === partNumber)?.dueCents ?? 0;
		setPayments((current) => [...current, { method: 'Pix', partNumber, amount: textMoney(due) }]);
	}

	function openPayment() {
		if (!basket.length) return;
		const equalParts = splitEqual(total, partCount) ?? [];
		setPayments(
			equalParts.map((part) => ({
				method: 'Dinheiro',
				partNumber: part.partNumber,
				amount: textMoney(part.dueCents),
			})),
		);
		setPaymentOpen(true);
	}

	async function finalizeSale() {
		if (busy || !user) return;
		if (!basket.length || paymentTotal !== total || !splits) {
			setMessage('Inclua itens e confira se os pagamentos reconciliam com o total.');
			return;
		}
		for (const part of splits) {
			if (
				payments
					.filter((payment) => payment.partNumber === part.partNumber)
					.reduce((sum, payment) => {
						const paymentIndex = payments.indexOf(payment);
						return sum + (paymentAmounts[paymentIndex] ?? 0);
					}, 0) !== part.dueCents
			) {
				setMessage(`Os pagamentos da parte ${part.partNumber} precisam totalizar ${money(part.dueCents)}.`);
				return;
			}
		}
		setBusy(true);
		setMessage('');
		try {
			const occurredAt = new Date().toISOString();
			const payload: SaleCreatePayload = {
				saleId: 'pending',
				occurredOn: new Intl.DateTimeFormat('en-CA', {
					timeZone: 'America/Sao_Paulo',
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
				}).format(new Date(occurredAt)),
				customer: customer.trim() || null,
				notes: notes.trim() || null,
				items: basket.map((line, position) => ({
					productId: line.product.product_id,
					name: line.product.name,
					category: line.product.category,
					quantity: line.quantity,
					unitPriceCents: line.product.sale_price_cents ?? 0,
					unitCostCents: line.product.unit_cost_cents ?? null,
					lineTotalCents: lineTotalCents(line.quantity, line.product.sale_price_cents ?? 0) ?? 0,
					position,
				})),
				splits: splits.map((part) => ({ ...part })),
				payments: payments.map((payment, position) => {
					const amountCents = centsFromInput(payment.amount) ?? 0;
					const feeRate = fees[payment.method].replace(',', '.');
					return {
						method: payment.method,
						methodLabel: null,
						amountCents,
						feeRate,
						feeCents: feeCents(amountCents, feeRate) ?? 0,
						partNumber: payment.partNumber,
						position,
					} satisfies SalePayment;
				}),
			};
			const operation = await createSaleOperation(deviceId, user.id, user.username, occurredAt, payload);
			operation.operationId = draftId || operation.operationId;
			const salePayload = operation.payload as SaleCreatePayload;
			salePayload.saleId = operationIdentity('sale.create', operation.operationId).saleId;
			operation.payloadHash = await operationPayloadHash(operation);
			if (!validateOperationPayload(operation)) {
				setMessage('A venda contém dados inválidos e não foi salva. Revise os itens e pagamentos.');
				return;
			}
			await commitSaleAndClearDraft(operation);
			setReceipt({ sale: payload, occurredAt });
			setPaymentOpen(false);
			setBasket([]);
			setCustomer('');
			setNotes('');
			setPartCount(1);
			setPayments([{ method: 'Dinheiro', partNumber: 1, amount: '0,00' }]);
			setCustomSplit(false);
			setSplitAmounts(['0,00']);
			setDraftId(crypto.randomUUID());
			setMessage(
				navigator.onLine
					? 'Venda salva. Sincronizando com o servidor…'
					: 'Venda salva neste dispositivo para sincronizar quando a internet voltar.',
			);
			if (navigator.onLine)
				void syncQueue()
					.then(() => setMessage('Sincronização concluída; confira o estado na fila.'))
					.catch(() => setMessage('A venda ficou salva; a sincronização será retomada quando possível.'));
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'Não foi possível salvar a venda neste dispositivo.');
		} finally {
			setBusy(false);
		}
	}

	async function discardDraft() {
		if (!window.confirm('Descartar os itens e os pagamentos deste rascunho?')) return;
		setBasket([]);
		setPayments([{ method: 'Dinheiro', partNumber: 1, amount: '0,00' }]);
		setPartCount(1);
		setCustomSplit(false);
		setSplitAmounts(['0,00']);
		setCustomer('');
		setNotes('');
		setDraftId(crypto.randomUUID());
		await clearDraft();
	}

	return (
		<div className="pdv-page">
			<section className="pdv-heading">
				<div>
					<p className="island-kicker">Frente de caixa</p>
					<h1>Nova venda</h1>
					<p className="demo-muted">{catalogState}</p>
				</div>
				<button
					type="button"
					className="demo-button demo-button-secondary"
					onClick={() =>
						void updateCatalog()
							.then((result) => {
								setProducts(result.products);
								setCatalogState(`${result.products.length} itens atualizados`);
							})
							.catch((error) => setMessage(error.message))
					}
				>
					Atualizar catálogo
				</button>
			</section>
			<div className="pdv-layout">
				<section className="pdv-panel" aria-labelledby="catalog-heading">
					<div className="pdv-section-heading">
						<h2 id="catalog-heading">Produtos</h2>
						<span className="demo-pill">{products.length} no dispositivo</span>
					</div>
					<label className="sr-only" htmlFor="product-search">
						Buscar por código ou nome
					</label>
					<input
						ref={searchInput}
						id="product-search"
						className="demo-input pdv-search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && visibleProducts[0]) {
								event.preventDefault();
								selectProduct(visibleProducts[0]);
							}
						}}
						placeholder="Código de barras, auxiliar ou nome"
						autoComplete="off"
					/>
					<div className="pdv-product-list" role="list">
						{visibleProducts.map((product) => (
							<button type="button" className="pdv-product" key={product.product_id} onClick={() => selectProduct(product)}>
								<span>
									<strong>{product.name}</strong>
									<small>
										Barras: {product.barcode || '—'} · Auxiliar: {product.auxiliary_code || '—'}
										{' · '}
										{product.category}
									</small>
								</span>
								<span className="pdv-product-prices">
									<b>Venda {money(product.sale_price_cents ?? 0)}</b>
									<small>Custo {product.unit_cost_cents == null ? 'pendente' : money(product.unit_cost_cents)}</small>
								</span>
							</button>
						))}
						{!visibleProducts.length ? (
							<p className="demo-muted">
								{products.length
									? 'Nenhum produto corresponde à busca.'
									: 'Carregue o catálogo quando estiver online para vender sem rede depois.'}
							</p>
						) : null}
					</div>
				</section>

				<section className="pdv-panel" aria-labelledby="order-heading">
					<div className="pdv-section-heading">
						<h2 id="order-heading">Pedido</h2>
						<button type="button" className="demo-button demo-button-danger" onClick={() => void discardDraft()} disabled={!basket.length}>
							Limpar rascunho
						</button>
					</div>
					<div className="pdv-basket">
						{basket.map((line) => (
							<div className="pdv-basket-row" key={line.product.product_id}>
								<div>
									<strong>{line.product.name}</strong>
									<small>{money(line.product.sale_price_cents ?? 0)} por unidade</small>
								</div>
								<label>
									Qtd.
									<input
										className="demo-input pdv-quantity"
										inputMode="decimal"
										value={line.quantity}
										onChange={(event) => setQuantity(line.product.product_id, event.target.value)}
									/>
								</label>
								<b>{money(lineTotalCents(line.quantity, line.product.sale_price_cents ?? 0) ?? 0)}</b>
								<button
									type="button"
									aria-label={`Remover ${line.product.name}`}
									onClick={() => setBasket((current) => current.filter((item) => item.product.product_id !== line.product.product_id))}
								>
									×
								</button>
							</div>
						))}
						{!basket.length ? <p className="demo-muted">Pesquise e toque em um produto para adicionar.</p> : null}
					</div>
					<div className="pdv-inline-fields">
						<label>
							Cliente (opcional)
							<input className="demo-input" value={customer} onChange={(event) => setCustomer(event.target.value)} maxLength={200} />
						</label>
						<label>
							Observação
							<input className="demo-input" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} />
						</label>
					</div>

					<div className="pdv-section-heading pdv-checkout-summary">
						<div>
							<h3>Subtotal</h3>
							<small>Pagamento definido ao finalizar</small>
						</div>
						<strong>{money(total)}</strong>
					</div>
					<button type="button" className="pdv-confirm" onClick={openPayment} disabled={!basket.length}>
						Finalizar venda · {money(total)}
					</button>
					{message ? (
						<p role="status" className="pdv-message">
							{message}
						</p>
					) : null}
					{receipt ? (
						<div className="pdv-receipt-actions" role="status">
							<span>Venda registrada no dispositivo.</span>
							<button type="button" className="demo-button demo-button-secondary" onClick={() => window.print()}>
								Imprimir notinha
							</button>
							<button type="button" aria-label="Fechar notinha" onClick={() => setReceipt(null)}>
								×
							</button>
						</div>
					) : null}
					{receipt ? (
						<div className="pdv-print-receipt">
							<strong>Sabores da Canastra</strong>
							<span>Comprovante não fiscal</span>
							<span>{new Date(receipt.occurredAt).toLocaleString('pt-BR')}</span>
							<hr />
							{receipt.sale.items.map((item) => (
								<div key={`${item.productId}-${item.position}`}>
									<span>
										{item.quantity} × {item.name}
									</span>
									<b>{money(item.lineTotalCents)}</b>
								</div>
							))}
							<hr />
							<div>
								<strong>Total</strong>
								<strong>{money(receipt.sale.items.reduce((sum, item) => sum + item.lineTotalCents, 0))}</strong>
							</div>
							{receipt.sale.customer ? <span>Cliente: {receipt.sale.customer}</span> : null}
							<span>
								Pagamento: {receipt.sale.payments.map((payment) => `${payment.method} ${money(payment.amountCents)}`).join(' · ')}
							</span>
							<span>Documento sem valor fiscal.</span>
						</div>
					) : null}
					{paymentOpen ? (
						<div
							className="pdv-modal-backdrop"
							onMouseDown={(event) => {
								if (event.target === event.currentTarget) setPaymentOpen(false);
							}}
						>
							<section
								className="pdv-payment-modal"
								role="dialog"
								aria-modal="true"
								aria-labelledby="checkout-title"
								onKeyDown={(event) => {
									if (event.key === 'Escape') setPaymentOpen(false);
								}}
							>
								<div className="pdv-section-heading">
									<div>
										<p className="island-kicker">Concluir pedido</p>
										<h2 id="checkout-title">Forma de pagamento</h2>
									</div>
									<button type="button" aria-label="Fechar pagamento" onClick={() => setPaymentOpen(false)}>
										×
									</button>
								</div>
								<p className="demo-muted">
									Taxas: débito {(Number(fees['Débito']) * 100).toLocaleString('pt-BR')}%; crédito{' '}
									{(Number(fees['Crédito']) * 100).toLocaleString('pt-BR')}%.
								</p>
								<label className="pdv-split-select">
									Dividir em partes iguais
									<select className="demo-select" value={partCount} onChange={(event) => selectPartCount(Number(event.target.value))}>
										{Array.from({ length: 10 }, (_, index) => (
											<option key={index + 1} value={index + 1}>
												{index + 1} {index ? 'partes' : 'parte'}
											</option>
										))}
									</select>
								</label>
								{partCount > 1 ? (
									<label className="pdv-custom-split-toggle">
										<input
											type="checkbox"
											checked={customSplit}
											onChange={(event) => {
												const next = event.target.checked;
												setCustomSplit(next);
												if (next) setSplitAmounts((splitEqual(total, partCount) ?? []).map((part) => textMoney(part.dueCents)));
											}}
										/>{' '}
										Definir valores diferentes por parte
									</label>
								) : null}
								{customSplit && !splits ? (
									<p className="pdv-message" role="status">
										A soma das partes precisa ser igual ao total da venda ({money(total)}).
									</p>
								) : null}
								{splits?.map((part) => (
									<div className="pdv-payment-part" key={part.partNumber}>
										<div className="pdv-section-heading">
											<strong>Parte {part.partNumber}</strong>
											{customSplit ? (
												<label>
													Valor da parte (R$)
													<input
														className="demo-input pdv-part-amount"
														inputMode="decimal"
														value={splitAmounts[part.partNumber - 1] ?? ''}
														onChange={(event) =>
															setSplitAmounts((current) =>
																current.map((value, index) => (index === part.partNumber - 1 ? event.target.value : value)),
															)
														}
													/>
												</label>
											) : (
												<span>{money(part.dueCents)}</span>
											)}
											<button type="button" className="demo-button demo-button-secondary" onClick={() => addPayment(part.partNumber)}>
												+ Meio
											</button>
										</div>
										{payments.map((payment, index) =>
											payment.partNumber === part.partNumber ? (
												<div className="pdv-payment-row" key={`${part.partNumber}-${index}`}>
													<label>
														Forma
														<select
															className="demo-select"
															value={payment.method}
															onChange={(event) =>
																setPayments((current) =>
																	current.map((item, currentIndex) =>
																		currentIndex === index
																			? {
																					...item,
																					method: event.target.value as PaymentMethod,
																				}
																			: item,
																	),
																)
															}
														>
															{METHODS.map((method) => (
																<option key={method}>{method}</option>
															))}
														</select>
													</label>
													<label>
														Valor (R$)
														<input
															className="demo-input"
															inputMode="decimal"
															value={payment.amount}
															onChange={(event) =>
																setPayments((current) =>
																	current.map((item, currentIndex) =>
																		currentIndex === index ? { ...item, amount: event.target.value } : item,
																	),
																)
															}
														/>
													</label>
													<button
														type="button"
														aria-label="Remover forma de pagamento"
														onClick={() => setPayments((current) => current.filter((_, currentIndex) => currentIndex !== index))}
														disabled={payments.filter((item) => item.partNumber === part.partNumber).length <= 1}
													>
														×
													</button>
												</div>
											) : null,
										)}
									</div>
								))}
								<div className="pdv-total-summary">
									<span>
										Venda bruta <strong>{money(total)}</strong>
									</span>
									<span>
										Taxas <strong>{money(feeTotal)}</strong>
									</span>
									<span>
										Recebido líquido <strong>{money(total - feeTotal)}</strong>
									</span>
									<span>
										Pagamentos <strong>{money(Math.max(0, paymentTotal))}</strong>
									</span>
								</div>
								<div className="pdv-actions">
									<button type="button" className="demo-button demo-button-secondary" onClick={() => setPaymentOpen(false)}>
										Voltar ao pedido
									</button>
									<button
										type="button"
										className="pdv-confirm"
										onClick={() => void finalizeSale()}
										disabled={busy || !basket.length || paymentTotal !== total || !splits}
									>
										{busy ? 'Salvando…' : 'Confirmar pagamento'}
									</button>
								</div>
							</section>
						</div>
					) : null}
				</section>
			</div>
		</div>
	);
}
