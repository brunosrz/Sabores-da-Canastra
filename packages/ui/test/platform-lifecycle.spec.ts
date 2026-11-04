import { describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  native: false,
  network: vi.fn(),
  app: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => platform.native },
}));
vi.mock("@capacitor/network", () => ({
  Network: { addListener: platform.network, getStatus: platform.status },
}));
vi.mock("@capacitor/app", () => ({ App: { addListener: platform.app } }));
import { isOnline, watchLifecycle } from "../src/platform/lifecycle";

describe("ciclo de vida da plataforma", () => {
  it("na web reage à conexão e remove os listeners", () => {
    platform.native = false;
    const connection = vi.fn();
    const resume = vi.fn();
    const stop = watchLifecycle(connection, resume);
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(connection.mock.calls).toEqual([[false], [true]]);
    stop();
    window.dispatchEvent(new Event("offline"));
    expect(connection).toHaveBeenCalledTimes(2);
  });
  it("no nativo acompanha estado e remove listeners registrados após desmontagem", async () => {
    platform.native = true;
    platform.status.mockResolvedValue({ connected: true });
    let finish!: (handle: { remove: () => Promise<void> }) => void;
    const remove = vi.fn().mockResolvedValue(undefined);
    platform.network.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    platform.app.mockResolvedValue({ remove });
    const stop = watchLifecycle(vi.fn(), vi.fn());
    expect(await isOnline()).toBe(true);
    stop();
    finish({ remove });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    platform.native = false;
  });
});
