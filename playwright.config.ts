import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
    headless: true,
    actionTimeout: 15_000,
    launchOptions: {
      executablePath: process.env.CHROME_PATH,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      STUDIO_SOFTWARE_GL: "1",
      PORT: "4173",
      AI_API_KEY: "",
      AI_MODEL: "",
      TTS_API_KEY: "",
      TTS_MODEL: "",
    },
  },
});
