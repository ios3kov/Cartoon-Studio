import { test, expect } from "@playwright/test";
import { PROJECT_KEY } from "../../src/ui/projectStorage.ts";

test("closing immediately before debounce recovers the last edit in a newly opened tab", async ({ page, context }) => {
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      if (kind === "webgl2") return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.goto("/");
  await expect(page.getByText("Сохранено на устройстве", { exact: true })).toBeVisible();
  await page.clock.pauseAt(new Date("2030-01-01T00:01:00Z"));
  await page.getByLabel("Название проекта", { exact: true }).fill("Последняя правка перед закрытием");
  // No debounce timer can fire. Run real exit handlers and discard this tab's sessionStorage.
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => page.isClosed()).toBe(true);
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.getByLabel("Название проекта", { exact: true })).toHaveValue("Последняя правка перед закрытием");
  await expect.poll(() => reopened.evaluate((key) => JSON.parse(localStorage.getItem(key)!).title, PROJECT_KEY))
    .toBe("Последняя правка перед закрытием");
});
