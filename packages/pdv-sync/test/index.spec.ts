import { describe, expect, it } from "vitest";
import {
  feeCents,
  lineTotalCents,
  occurredOnInSaoPaulo,
  operationIdentity,
  splitEqual,
} from "../src/index";

describe("contrato de sincronização do PDV", () => {
  it("calcula quantidades e taxas em centavos com arredondamento half-up", () => {
    expect(lineTotalCents("1.005", 101)).toBe(102);
    expect(feeCents(101, "0.005")).toBe(1);
    expect(lineTotalCents("1.0001", 101)).toBeNull();
  });

  it("divide valores iguais distribuindo o resto nos primeiros itens", () => {
    expect(splitEqual(1001, 3)).toEqual([
      { partNumber: 1, dueCents: 334 },
      { partNumber: 2, dueCents: 334 },
      { partNumber: 3, dueCents: 333 },
    ]);
  });

  it("converte instante para o dia operacional de São Paulo e deriva IDs", () => {
    expect(occurredOnInSaoPaulo("2026-11-01T02:30:00.000Z")).toBe("2026-10-31");
    expect(operationIdentity("sale.create", "abc")).toEqual({
      saleId: "pdv-sale:abc",
      idempotencyKey: "pdv:sale.create:abc",
    });
  });
});
