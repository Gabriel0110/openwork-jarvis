import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { _electron as electron, expect, test } from "@playwright/test"

test("launches the desktop app shell", async () => {
  test.slow()

  const mainEntry = resolve(process.cwd(), "out/main/index.js")
  test.skip(!existsSync(mainEntry), "Build output not found. Run `npm run build` first.")

  const app = await electron.launch({
    args: [mainEntry],
    env: { ...process.env, NODE_ENV: "test" }
  })

  try {
    const window = await app.firstWindow()
    await expect(window.locator("body")).toContainText("OPENWORK")
  } finally {
    await app.close()
  }
})
