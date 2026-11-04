import { test, expect, type Page } from "@playwright/test";
import { createDefaultProject } from "../../src/shared/project.ts";
import type { Project } from "../../src/shared/model.ts";

const storageKey = "cartoon-studio-project-v1";

async function initializeEditor(page: Page, project: Project): Promise<void> {
  await page.addInitScript(
    ({ key, project }) => {
      // Keep the actual editor and hooks. Painterly rendering has separate GPU tests.
      // The fallback avoids expensive asset preparation masking a short save debounce.
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        ...args: unknown[]
      ) {
        if (kind === "webgl2") return null;
        return Reflect.apply(getContext, this, [kind, ...args]);
      } as typeof getContext;
      // Do not reset storage after reload: that would hide a persistence regression.
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(project));
    },
    { key: storageKey, project },
  );
}

test("an immediate real reload preserves the latest title before the autosave debounce", async ({
  page,
}) => {
  const project = createDefaultProject();
  const changedTitle = "Изменение перед обновлением";
  await initializeEditor(page, project);
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.goto("/");
  const title = page.getByLabel("Название проекта", { exact: true });
  await expect(title).toHaveValue(project.title);
  await page.clock.pauseAt(new Date("2030-01-01T00:01:00Z"));

  await title.fill(changedTitle);
  await expect(title).toHaveValue(changedTitle);
  // Fake time cannot reach 450 ms. Only the real navigation flush can persist this edit.
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).title,
      storageKey,
    ),
  ).toBe(project.title);
  await page.reload();
  await expect(
    page.getByLabel("Название проекта", { exact: true }),
  ).toHaveValue(changedTitle);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).title,
      storageKey,
    ),
  ).toBe(changedTitle);
  await page.clock.resume();
});

interface AudioObservation {
  plays: number[];
  positions: number[];
}

test("preview applies a 0.1-second trim on initial play and after a short manual seek", async ({
  page,
}) => {
  const project = createDefaultProject();
  project.scenes = [project.scenes[0]];
  project.scenes[0].duration = 2;
  project.fps = 12;
  project.audio = [
    {
      id: "regression-track",
      assetId: `a_${"1".repeat(32)}`,
      name: "Контроль обрезки",
      start: 0,
      trimStart: 0.1,
      volume: 0.5,
      loop: false,
      kind: "voice",
    },
  ];
  await initializeEditor(page, project);
  await page.addInitScript(() => {
    const observation: AudioObservation = { plays: [], positions: [] };
    (
      window as unknown as { __audioRegression: AudioObservation }
    ).__audioRegression = observation;
    // The real usePlayback hook receives deterministic, already available metadata.
    // Only the media device is replaced; timeline state and UI events stay unchanged.
    class ControlledAudio extends EventTarget {
      src: string;
      duration = 10;
      readyState = 1;
      paused = true;
      volume = 1;
      preload = "";
      private position = 0;
      constructor(src = "") {
        super();
        this.src = src;
        queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
      }
      get currentTime(): number {
        return this.position;
      }
      set currentTime(value: number) {
        this.position = value;
        observation.positions.push(value);
      }
      play(): Promise<void> {
        observation.plays.push(this.position);
        this.paused = false;
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
      removeAttribute(name: string): void {
        if (name === "src") this.src = "";
      }
      load(): void {
        /* No media I/O in this controlled device. */
      }
    }
    window.Audio = ControlledAudio as unknown as typeof Audio;
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Воспроизвести", exact: true })
    .click();
  const observations = () =>
    page.evaluate(
      () =>
        (window as unknown as { __audioRegression: AudioObservation })
          .__audioRegression,
    );
  await expect.poll(async () => (await observations()).plays.length).toBe(1);
  expect((await observations()).plays[0]).toBeCloseTo(0.1, 8);

  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  const seekTo = 1 / project.fps;
  const scrubber = page.getByLabel("Позиция воспроизведения", { exact: true });
  await scrubber.evaluate((element, time) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, String(time));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, seekTo);
  expect(Number(await scrubber.inputValue())).toBeCloseTo(seekTo, 8);
  await page
    .getByRole("button", { name: "Воспроизвести", exact: true })
    .click();
  await expect.poll(async () => (await observations()).plays.length).toBe(2);
  expect((await observations()).plays[1]).toBeCloseTo(0.1 + seekTo, 8);
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
});
