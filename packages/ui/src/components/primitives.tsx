import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  busy,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      aria-busy={busy || undefined}
      className={`ui-button ${className}`.trim()}
      data-variant={variant}
      disabled={props.disabled || busy}
    >
      {busy ? "Aguarde…" : props.children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      aria-label={label}
      className={`ui-icon-button ${className}`.trim()}
      type={props.type ?? "button"}
    >
      {children}
    </button>
  );
}

type FieldBase = { label: string; hint?: string; error?: string; id: string };
function fieldDescription(id: string, hint?: string, error?: string) {
  return (
    [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") ||
    undefined
  );
}

export function TextField({
  label,
  hint,
  error,
  id,
  ...props
}: ComponentPropsWithoutRef<"input"> & FieldBase) {
  return (
    <div className="ui-field-group">
      <label className="ui-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        {...props}
        aria-describedby={fieldDescription(id, hint, error)}
        aria-invalid={Boolean(error)}
        className={`ui-field ${props.className ?? ""}`.trim()}
        id={id}
      />
      {hint && (
        <span className="ui-help" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="ui-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function NumberField(
  props: ComponentPropsWithoutRef<"input"> & FieldBase,
) {
  return (
    <TextField
      {...props}
      inputMode={props.inputMode ?? "decimal"}
      type="number"
    />
  );
}

export function SelectField({
  label,
  hint,
  error,
  id,
  children,
  ...props
}: ComponentPropsWithoutRef<"select"> & FieldBase) {
  return (
    <div className="ui-field-group">
      <label className="ui-field-label" htmlFor={id}>
        {label}
      </label>
      <select
        {...props}
        aria-describedby={fieldDescription(id, hint, error)}
        aria-invalid={Boolean(error)}
        className={`ui-select ${props.className ?? ""}`.trim()}
        id={id}
      >
        {children}
      </select>
      {hint && (
        <span className="ui-help" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="ui-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function TextareaField({
  label,
  hint,
  error,
  id,
  ...props
}: ComponentPropsWithoutRef<"textarea"> & FieldBase) {
  return (
    <div className="ui-field-group">
      <label className="ui-field-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        {...props}
        aria-describedby={fieldDescription(id, hint, error)}
        aria-invalid={Boolean(error)}
        className={`ui-textarea ${props.className ?? ""}`.trim()}
        id={id}
      />
      {hint && (
        <span className="ui-help" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="ui-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function Card({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"section">) {
  return <section {...props} className={`ui-card ${className}`.trim()} />;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="ui-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="ui-badge">{children}</span>;
}

const categoryTokens: Record<string, string> = {
  pizzas: "pizzas",
  lanches: "lanches",
  porções: "porcoes",
  porcoes: "porcoes",
  novidades: "novidades",
  promoção: "promocao",
  promocao: "promocao",
  limitado: "limitado",
  salgados: "salgados",
  bebidas: "bebidas",
  doces: "doces",
  molhos: "molhos",
  outros: "outros",
};

export function CategoryBadge({ category }: { category: string }) {
  const token =
    categoryTokens[category.trim().toLocaleLowerCase("pt-BR")] ?? "outros";
  return (
    <span className="ui-category-badge" data-category={token}>
      {category}
    </span>
  );
}

export function Price({
  cents,
  className = "",
}: {
  cents: number;
  className?: string;
}) {
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
  return (
    <data
      className={`ui-price ${className}`.trim()}
      value={(cents / 100).toFixed(2)}
    >
      {formatted}
    </data>
  );
}

export function SkipLink({
  href = "#conteudo",
  children = "Pular para o conteúdo",
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <a className="ui-skip-link" href={href}>
      {children}
    </a>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="ui-state-card" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}

export function LoadingState({ label = "Carregando" }: { label?: string }) {
  return (
    <div className="ui-state-card" role="status" aria-live="polite">
      <span aria-hidden="true" className="ui-spinner" />
      {label}
    </div>
  );
}

export function ErrorState({
  title = "Não foi possível carregar",
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <section className="ui-state-card" role="alert">
      <h2>{title}</h2>
      <p>{description}</p>
      {onRetry && <Button onClick={onRetry}>Tentar novamente</Button>}
    </section>
  );
}

export type TableColumn<Row> = {
  key: keyof Row;
  label: string;
  render?: (row: Row) => ReactNode;
};

export function ResponsiveTable<Row extends Record<string, unknown>>({
  caption,
  columns,
  rows,
  rowKey,
}: {
  caption: string;
  columns: Array<TableColumn<Row>>;
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
}) {
  return (
    <>
      <div className="ui-table-desktop">
        <table className="ui-responsive-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={String(column.key)} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)}>
                {columns.map((column) => (
                  <td key={String(column.key)}>
                    {column.render
                      ? column.render(row)
                      : String(row[column.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ui-responsive-cards" role="group" aria-label={caption}>
        {rows.map((row, index) => (
          <article
            className="ui-card ui-responsive-card"
            key={rowKey(row, index)}
          >
            <dl>
              {columns.map((column) => (
                <div className="ui-table-pair" key={String(column.key)}>
                  <dt>{column.label}</dt>
                  <dd>
                    {column.render
                      ? column.render(row)
                      : String(row[column.key] ?? "—")}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="ui-form-actions">{children}</div>;
}
