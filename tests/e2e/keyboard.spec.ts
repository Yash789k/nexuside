import { test, expect } from "./fixtures";
import { readFile, stat, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

async function ide(page: any) {
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await expect(page.getByText("Recovery ready", { exact: true })).toBeVisible();
}
const open = (page: any, name: string) =>
  page.getByRole("button", { name: `◇ ${name}`, exact: true }).click();

test("E09 keyboard Save/Save All, tab navigation, explorer and group focus preserve documents", async ({
  page,
  nexus,
}) => {
  await ide(page);
  await open(page, "a.ts");
  const a = page.getByRole("textbox", { name: "Edit a.ts" });
  await a.fill("keyboard saved alpha");
  await a.press("ControlOrMeta+s");
  await expect
    .poll(() => readFile(path.join(nexus.workspace, "a.ts"), "utf8"))
    .toBe("keyboard saved alpha");
  await a.fill("Save All alpha");
  await open(page, "b.ts");
  const b = page.getByRole("textbox", { name: "Edit b.ts" });
  await b.fill("Save All beta");
  await b.press("ControlOrMeta+Shift+s");
  await expect
    .poll(() => readFile(path.join(nexus.workspace, "a.ts"), "utf8"))
    .toBe("Save All alpha");
  await expect
    .poll(() => readFile(path.join(nexus.workspace, "b.ts"), "utf8"))
    .toBe("Save All beta");
  await b.press("Control+PageUp");
  await expect(a).toBeVisible();
  await page.getByRole("tab", { name: "a.ts", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "b.ts", exact: true }),
  ).toBeFocused();
  await expect(b).toBeVisible();
  await b.press("ControlOrMeta+b");
  await expect(page.getByLabel("Filter files")).toHaveCount(0);
  await b.press("ControlOrMeta+b");
  await expect(page.getByLabel("Filter files")).toBeVisible();
  await page.getByRole("button", { name: "Split Right", exact: true }).click();
  await b.last().click();
  await b.last().press("ControlOrMeta+Alt+ArrowLeft");
  await expect(b.first()).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("E10 folder creation, workspace content search, clean external reload and deleted-file recovery", async ({
  page,
  nexus,
}) => {
  await ide(page);
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("Workspace path").fill("nested/資料 folder");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect
    .poll(async () =>
      stat(path.join(nexus.workspace, "nested/資料 folder"))
        .then((s) => s.isDirectory())
        .catch(() => false),
    )
    .toBe(true);
  await page.getByLabel("Search contents", { exact: true }).check();
  await page.getByLabel("Search file contents", { exact: true }).fill("beta");
  await page.getByRole("button", { name: /b.ts:1/ }).click();
  const b = page.getByRole("textbox", { name: "Edit b.ts" });
  await expect(b).toContainText("export const beta");
  await writeFile(
    path.join(nexus.workspace, "b.ts"),
    "clean external refresh\n",
  );
  await expect(b).toContainText("clean external refresh", { timeout: 10000 });
  await b.fill("recover deleted dirty document");
  await unlink(path.join(nexus.workspace, "b.ts"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Compare / resolve" }).click();
  await expect(page.getByRole("dialog")).toContainText("Deleted on disk");
  await page.getByRole("button", { name: "Keep my edits" }).click();
  await expect
    .poll(() =>
      readFile(path.join(nexus.workspace, "b.ts"), "utf8").catch(() => null),
    )
    .toBe("recover deleted dirty document");
});

test("E11 go to line, line movement, multicursor replacement and independent scroll restoration", async ({
  page,
  nexus,
}) => {
  await writeFile(
    path.join(nexus.workspace, "a.ts"),
    Array.from(
      { length: 200 },
      (_, i) => `const line${i + 1} = ${i + 1};`,
    ).join("\n"),
  );
  await ide(page);
  await open(page, "a.ts");
  const a = page.getByRole("textbox", { name: "Edit a.ts" });
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page.getByRole("button", { name: "Go to Line", exact: true }).click();
  const line = page.locator(".cm-goto-line input");
  await line.fill("150");
  await line.press("Enter");
  await a.pressSequentially("// marker ");
  await expect(a).toContainText("// marker const line150");
  const scroll = await page
    .locator(".cm-scroller")
    .evaluate((el) => el.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await open(page, "b.ts");
  await open(page, "a.ts");
  await expect
    .poll(() => page.locator(".cm-scroller").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(scroll - 10);
  // Keyboard selection includes the whole CodeMirror document, including
  // virtualized lines outside the DOM. contenteditable.fill only sees DOM.
  await a.press("ControlOrMeta+a");
  await page.keyboard.insertText("alpha\nbeta\ngamma");
  await a.press("ControlOrMeta+Home");
  await a.press("Alt+ArrowDown");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => readFile(path.join(nexus.workspace, "a.ts"), "utf8"))
    .toBe("beta\nalpha\ngamma");
  await a.fill("same same same");
  await a.press("ControlOrMeta+Home");
  await a.press("ControlOrMeta+d");
  await a.press("ControlOrMeta+d");
  await a.pressSequentially("next");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => readFile(path.join(nexus.workspace, "a.ts"), "utf8"))
    .toBe("next next same");
});

test("E12 a slow file load cannot steal focus from a later file selection", async ({
  page,
}) => {
  await ide(page);
  await open(page, "a.ts");
  await expect(page.getByRole("textbox", { name: "Edit a.ts" })).toBeVisible();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route("**/api/file", async (route) => {
    if (route.request().postDataJSON().path === "b.ts") {
      entered();
      await held;
    }
    await route.continue();
  });
  await open(page, "b.ts");
  await arrived;
  await open(page, "a.ts");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/file") &&
      r.request().postDataJSON().path === "b.ts",
  );
  release();
  await response;
  await expect(
    page.getByRole("tab", { name: "b.ts", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "a.ts", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Edit a.ts" })).toBeVisible();
});

test("E15 pointer resizing, case-sensitive replacement and bracket matching", async ({
  page,
}) => {
  await ide(page);
  await open(page, "a.ts");
  const editor = page.getByRole("textbox", { name: "Edit a.ts" });
  await editor.fill("alpha Alpha ALPHA");
  await editor.press("ControlOrMeta+f");
  await page.getByLabel("Find", { exact: true }).fill("alpha");
  await page.getByLabel("Find", { exact: true }).press("ArrowRight");
  await expect(page.locator(".cm-searchMatch")).toHaveCount(3);
  await page.getByLabel("match case", { exact: true }).check();
  await expect(page.locator(".cm-searchMatch")).toHaveCount(1);
  await page.getByLabel("Replace", { exact: true }).fill("changed");
  await page.getByLabel("Replace", { exact: true }).press("ArrowRight");
  await page.getByRole("button", { name: "replace all", exact: true }).click();
  await expect(editor).toContainText("changed Alpha ALPHA");
  await page.keyboard.press("Escape");
  await editor.fill("const pair = [1, 2];");
  await editor.press("ControlOrMeta+End");
  await editor.press("ArrowLeft");
  await expect(page.locator(".cm-matchingBracket")).toHaveCount(2);
  await page.getByRole("button", { name: "Split Right", exact: true }).click();
  const separator = page.getByRole("separator", {
    name: "Resize editor groups",
  });
  const bounds = (await separator.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 60);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 120, bounds.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await separator.getAttribute("aria-valuenow")))
    .toBeGreaterThan(55);
  await expect(editor).toHaveCount(2);
  await expect(editor.first()).toContainText("const pair");
  await expect(editor.last()).toContainText("const pair");
});
