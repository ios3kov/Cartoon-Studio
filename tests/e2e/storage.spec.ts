import { test, expect, type Page } from "@playwright/test";
import { PROJECT_KEY, DRAFT_KEY } from "../../src/ui/projectStorage.ts";

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    // Only the rendering device is replaced; both tabs run the real editor and persistence hook.
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      if (kind === "webgl2") return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.getByText("Сохранено на устройстве", { exact: true })).toBeVisible();
}
const title = (page: Page) => page.getByLabel("Название проекта", { exact: true });
const sharedTitle = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).title as string, PROJECT_KEY);

test("two real tabs synchronize, reset stale undo and preserve shared edits when a tab closes", async ({ page, context }) => {
  await openEditor(page);
  const second = await context.newPage();
  await openEditor(second);
  await title(page).fill("Правки из первой вкладки");
  await expect(title(second)).toHaveValue("Правки из первой вкладки");
  await expect(second.getByRole("button", { name: "Отменить", exact: true })).toBeDisabled();
  await second.close();
  expect(await sharedTitle(page)).toBe("Правки из первой вкладки");
  await page.reload();
  await expect(title(page)).toHaveValue("Правки из первой вкладки");
});

test("concurrent real-tab edits do not overwrite a winner and the conflicting draft survives reload", async ({ page, context }) => {
  await openEditor(page);
  const second = await context.newPage();
  await openEditor(second);
  const original = await sharedTitle(page);
  // Hold the browser's real cross-tab lock so both tabs can edit the same saved revision.
  await page.evaluate((key) => new Promise<void>((acquired) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (window as unknown as { releaseSave: () => void }).releaseSave = release;
    void navigator.locks.request(key, async () => { acquired(); await gate; });
  }), PROJECT_KEY);
  try {
    await title(page).fill("Вариант A");
    await title(second).fill("Вариант B");
    for (const tab of [page, second])
      expect(await tab.evaluate((key) => !!sessionStorage.getItem(key), DRAFT_KEY)).toBe(true);
  } finally {
    await page.evaluate(() => (window as unknown as { releaseSave: () => void }).releaseSave());
  }
  await expect.poll(() => sharedTitle(page)).not.toBe(original);
  const winner = await sharedTitle(page);
  expect(["Вариант A", "Вариант B"]).toContain(winner);
  const loser = winner === "Вариант A" ? second : page;
  const losingTitle = winner === "Вариант A" ? "Вариант B" : "Вариант A";
  await expect(loser.getByText(/Проект изменён в другой вкладке/)).toBeVisible();
  await expect(title(loser)).toHaveValue(losingTitle);
  await loser.reload();
  await expect(title(loser)).toHaveValue(losingTitle);
  await expect(loser.getByText(/Проект изменён в другой вкладке/)).toBeVisible();
  expect(await sharedTitle(loser)).toBe(winner);
});
