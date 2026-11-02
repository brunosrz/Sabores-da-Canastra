import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { afterEach, describe, expect, it } from "vitest";
import {
  Badge,
  Button,
  CategoryBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  NumberField,
  Price,
  ResponsiveTable,
  TextField,
} from "../src";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("componentes compartilhados", () => {
  it("expõe botão primário ocupado como busy e desativado", () => {
    render(
      <Button variant="primary" busy>
        Salvar
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Aguarde…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("associa rótulo, dica e erro ao campo numérico", () => {
    render(
      <NumberField
        id="quantidade"
        label="Quantidade"
        hint="Em unidades"
        error="Valor inválido"
      />,
    );
    const field = screen.getByRole("spinbutton", { name: "Quantidade" });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute(
      "aria-describedby",
      "quantidade-hint quantidade-error",
    );
    expect(screen.getByText("Em unidades")).toBeInTheDocument();
    expect(screen.getByText("Valor inválido")).toBeInTheDocument();
  });

  it("formata preços brasileiros e expõe a categoria no chip", () => {
    render(
      <>
        <Price cents={1234} />
        <CategoryBadge category="Porções" />
        <Badge>Protótipo</Badge>
      </>,
    );
    expect(document.querySelector("data.ui-price")).toHaveAttribute(
      "value",
      "12.34",
    );
    expect(screen.getByText("Porções")).toHaveAttribute(
      "data-category",
      "porcoes",
    );
    expect(screen.getByText("Protótipo")).toBeInTheDocument();
  });

  it("renderiza estados vazio, carregando e erro com papéis acessíveis", () => {
    render(
      <>
        <EmptyState
          title="Sem produtos"
          description="Cadastre o primeiro produto."
        />
        <LoadingState label="Carregando produtos" />
        <ErrorState
          description="Tente novamente mais tarde."
          onRetry={() => undefined}
        />
      </>,
    );
    expect(
      screen.getByRole("heading", { name: "Sem produtos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando produtos");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tente novamente mais tarde.",
    );
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeInTheDocument();
  });

  it("apresenta dados em tabela semântica e em cartões responsivos", () => {
    type Product = { name: string; price: string };
    render(
      <ResponsiveTable<Product>
        caption="Produtos cadastrados"
        columns={[
          { key: "name", label: "Produto" },
          { key: "price", label: "Preço" },
        ]}
        rows={[{ name: "Coca-Cola", price: "R$ 6,00" }]}
        rowKey={(row) => row.name}
      />,
    );
    expect(
      screen.getByRole("table", { name: "Produtos cadastrados" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Coca-Cola")).toHaveLength(2);
    expect(screen.getAllByText("R$ 6,00")).toHaveLength(2);
  });

  it("não apresenta violações axe nos componentes de formulário e estado", async () => {
    const { container } = render(
      <>
        <TextField id="busca" label="Buscar produto" />
        <EmptyState
          title="Catálogo vazio"
          description="Sincronize o catálogo para começar."
        />
      </>,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("mantém o valor digitado no campo após edição", () => {
    render(
      <TextField id="nome" label="Nome do produto" error="Informe um nome" />,
    );
    const field = screen.getByRole("textbox", { name: "Nome do produto" });
    fireEvent.change(field, { target: { value: "Suco" } });
    expect(field).toHaveValue("Suco");
  });
});
