import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createDefaultProject } from "../../src/shared/project.ts";
import { inspectProjectArchive } from "../../src/shared/archive.ts";
import type { Project } from "../../src/shared/model.ts";

const storageKey = "cartoon-studio-project-v1";
async function savedProject(page: Page): Promise<Project> {
  await expect(page.getByText("Сохранено на устройстве", { exact: true })).toBeVisible();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
}
async function ready(page: Page) {
  await expect(page.getByLabel("Предпросмотр мультфильма")).toBeVisible();
  await expect(page.getByText("Готовим рисунок", { exact: true })).toBeHidden({ timeout: 120_000 });
  await expect(page.locator(".canvas-error")).toHaveCount(0);
  await expect(page.getByText("Упрощённый рисунок", { exact: true })).toHaveCount(0);
}
async function screenshot(page: Page, path: string) {
  await ready(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Let the viewport resize and the canvas presentation settle before capturing.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  // Software WebGL capture needs its own bounded budget; interaction assertions remain at 15 seconds.
  await page.screenshot({ path, fullPage: true, animations: "disabled", caret: "hide", scale: "css", timeout: 60_000 });
}
function audioFixture(): Buffer {
  const samples = 16000, rate = 8000, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(Math.round(Math.sin((i * Math.PI * 2 * 220) / rate) * 3000), 44 + i * 2);
  return bytes;
}

test("editing, history, scene order, autosave and narrow layout work", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue("Туда, где море");
  await expect(page.locator(".scene-list .scene-card")).toHaveCount(3);
  await screenshot(page, info.outputPath("studio-desktop.png"));
  await page.getByLabel("Название проекта", { exact: true }).fill("Мой первый мультфильм");
  const caption = page.getByLabel("Подпись сцены", { exact: true });
  await caption.fill("Мы отправляемся в путешествие.");
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(caption).toHaveValue("Иногда всё начинается с маленького шага.");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(caption).toHaveValue("Мы отправляемся в путешествие.");
  await page.getByRole("button", { name: "Добавить сцену", exact: true }).first().click();
  await expect(page.locator(".scene-list .scene-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Дублировать сцену", exact: true }).click();
  await expect(page.locator(".scene-list .scene-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Поднять сцену", exact: true }).click();
  const selected = await page.locator(".scene-card.selected .scene-card-title").innerText();
  await expect(page.locator(".stage-caption span").nth(1)).toHaveText(selected);
  await page.getByRole("button", { name: "Удалить сцену", exact: true }).click();
  await expect(page.locator(".scene-list .scene-card")).toHaveCount(4);
  await expect(page.locator(".stage-caption span").nth(1)).toHaveText(await page.locator(".scene-card.selected .scene-card-title").innerText());
  await page.getByRole("tab", { name: "Герои", exact: true }).click();
  await page.getByLabel("Имя", { exact: true }).fill("София");
  await page.getByLabel("Одежда", { exact: true }).fill("#225577");
  await page.getByLabel("Действие").selectOption("wave");
  const saved = await savedProject(page);
  expect(saved.characters[0].name).toBe("София");
  await page.reload();
  await ready(page);
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue("Мой первый мультфильм");
  await expect(page.locator(".scene-list .scene-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel("Позиция воспроизведения").inputValue())).toBeGreaterThan(0.3);
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await page.getByLabel("Формат кадра").selectOption("portrait");
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Скачать видео", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await screenshot(page, info.outputPath("studio-mobile.png"));
  expect(errors).toEqual([]);
});

test("portable save includes audio, import restores it, and invalid imports preserve the project", async ({ page }, info) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("tab", { name: "Звук", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Загрузить аудиофайл/ }).click();
  await (await chooser).setFiles({ name: "voice-test.wav", mimeType: "audio/wav", buffer: audioFixture() });
  await expect(page.getByRole("button", { name: "Удалить звук voice-test.wav", exact: true })).toBeVisible();
  await page.getByLabel("Начало в видео, с", { exact: true }).fill("0.5");
  await page.getByLabel("Обрезать начало, с", { exact: true }).fill("0.2");
  const before = await savedProject(page);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Сохранить .cartoon", exact: true }).click();
  const archivePath = info.outputPath("portable.cartoon");
  await (await download).saveAs(archivePath);
  const parsed = inspectProjectArchive(await readFile(archivePath));
  expect(parsed.project.audio).toHaveLength(1);
  expect(parsed.entries).toHaveLength(1);
  expect(parsed.files[parsed.entries[0].path].byteLength).toBe(audioFixture().length);
  await page.getByLabel("Открыть файл проекта").setInputFiles(archivePath);
  await expect(page.getByText("Проект открыт.", { exact: true })).toBeVisible();
  const restored = await savedProject(page);
  expect(restored.audio[0].assetId).not.toBe(before.audio[0].assetId);
  expect(restored.audio[0].trimStart).toBe(0.2);
  expect(restored.audio[0].start).toBe(0.5);
  const response = await page.request.get(`/api/audio/${restored.audio[0].assetId}`);
  expect(response.ok()).toBe(true);
  await page.getByLabel("Открыть файл проекта").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from('{"version":999}') });
  await expect(page.getByText("Эта версия проекта не поддерживается. Нужна версия 1.", { exact: true })).toBeVisible();
  expect((await savedProject(page)).id).toBe(restored.id);
  await page.getByRole("button", { name: "Новая история", exact: true }).click();
  await expect(page.getByRole("button", { name: /Сценарий с (AI|ИИ)/ })).toBeDisabled();
  await page.getByLabel("Ваша идея").fill("Друзья ищут звёзды ночью");
  await page.getByRole("button", { name: "Создать черновик", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await savedProject(page)).scenes.at(-1)?.backdrop).toBe("night");
});

test("export dialog creates and downloads a real MP4", async ({ page }, info) => {
  const project = createDefaultProject();
  project.scenes = [project.scenes[0]];
  project.scenes[0].duration = 1;
  project.fps = 12;
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify(project)), { key: storageKey, project });
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Скачать видео", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: /Быстрая проверка/ }).click();
  await expect(page.getByRole("button", { name: "Создать видео", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Создать видео", exact: true }).click();
  const link = page.getByRole("link", { name: "Скачать MP4", exact: true });
  await expect(link).toBeVisible({ timeout: 120_000 });
  const event = page.waitForEvent("download");
  await link.click();
  const file = info.outputPath("ui-export.mp4");
  await (await event).saveAs(file);
  expect((await readFile(file)).byteLength).toBeGreaterThan(1000);
  await screenshot(page, info.outputPath("export-complete.png"));
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
