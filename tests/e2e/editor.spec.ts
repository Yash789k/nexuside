import { test, expect } from "./fixtures";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
const ide = async (page: any) => {
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await expect(page.getByText("Recovery ready", { exact: true })).toBeVisible();
};
const open = async (page: any, name: string) =>
  page.getByRole("button", { name: `◇ ${name}`, exact: true }).click();
test("E01 dirty documents and task drafts survive modes, tabs, split edits, save, undo and reload", async ({
  page,
  nexus,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByLabel("Task prompt").fill("Agent draft stays");
  await ide(page);
  await open(page, "a.ts");
  const editor = page.getByRole("textbox", { name: "Edit a.ts", exact: true });
  await editor.fill("export const alpha = 42;\n");
  await open(page, "b.ts");
  await open(page, "a.ts");
  await expect(editor).toContainText("alpha = 42");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(page.getByLabel("Task prompt")).toHaveValue("Agent draft stays");
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await expect(editor).toContainText("alpha = 42");
  await page.getByRole("button", { name: "Split Right", exact: true }).click();
  await expect(editor).toHaveCount(2);
  await editor.nth(1).fill("shared 😀 buffer");
  await expect(editor.nth(0)).toContainText("shared 😀 buffer");
  await page.getByRole("button", { name: "Save All", exact: true }).click();
  await expect
    .poll(() => readFile(path.join(nexus.workspace, "a.ts"), "utf8"))
    .toBe("shared 😀 buffer");
  await editor.nth(1).fill("recover after reload");
  await expect(page.getByText("Recovery saved", { exact: true })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.reload();
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Edit a.ts" })).toHaveCount(2);
  await expect(
    page.getByRole("textbox", { name: "Edit a.ts" }).first(),
  ).toContainText("recover after reload");
  expect(errors).toEqual([]);
});
test("E02 dirty close offers Cancel, Save and Discard; closing one split view preserves document", async ({
  page,
  nexus,
}) => {
  await ide(page);
  await open(page, "a.ts");
  await page.getByRole("textbox", { name: "Edit a.ts" }).fill("unsaved");
  await page.getByRole("button", { name: "Split Down", exact: true }).click();
  await page
    .getByRole("button", { name: "Close a.ts", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Edit a.ts" })).toContainText(
    "unsaved",
  );
  await page.getByRole("button", { name: "Close a.ts", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Edit a.ts" })).toContainText(
    "unsaved",
  );
  await page.getByRole("button", { name: "Close a.ts", exact: true }).click();
  await page.getByRole("button", { name: "Save and close" }).click();
  await expect
    .poll(() => readFile(path.join(nexus.workspace, "a.ts"), "utf8"))
    .toBe("unsaved");
  await expect(page.getByRole("textbox", { name: "Edit a.ts" })).toHaveCount(0);
});
test("E03 external conflict never overwrites unseen disk changes; file CRUD uses real files", async ({
  page,
  nexus,
}) => {
  await ide(page);
  await open(page, "a.ts");
  await page.getByRole("textbox", { name: "Edit a.ts" }).fill("mine");
  await writeFile(path.join(nexus.workspace, "a.ts"), "external");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Conflict:" }),
  ).toBeVisible();
  expect(await readFile(path.join(nexus.workspace, "a.ts"), "utf8")).toBe(
    "external",
  );
  await expect(
    page.getByRole("button", { name: "Compare / resolve" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compare / resolve" }).click();
  await expect(page.getByRole("dialog")).toContainText("external");
  await page.getByRole("button", { name: "Keep my edits" }).click();
  await expect
    .poll(() => readFile(path.join(nexus.workspace, "a.ts"), "utf8"))
    .toBe("mine");
  await page.getByRole("button", { name: "New file", exact: true }).click();
  await page.getByLabel("Workspace path").fill("nested/資料 new.ts");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Edit nested/資料 new.ts" }),
  ).toBeVisible();
  await open(page, "nested/資料 new.ts");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Workspace path").fill("nested/renamed.ts");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("tab", { name: "renamed.ts" })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await expect
    .poll(async () => {
      try {
        await readFile(path.join(nexus.workspace, "nested/renamed.ts"));
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
  await page.getByRole("button", { name: "Undo delete" }).click();
  await expect
    .poll(() =>
      readFile(path.join(nexus.workspace, "nested/renamed.ts"), "utf8").catch(
        () => null,
      ),
    )
    .toBe("");
});
test("E04 keyboard commands, independent undo, shared undo, search, tab drag and group resize", async ({
  page,
}) => {
  await ide(page);
  await open(page, "a.ts");
  const a = page.getByRole("textbox", { name: "Edit a.ts" });
  await a.fill("unique alpha");
  await open(page, "b.ts");
  await page.getByRole("textbox", { name: "Edit b.ts" }).fill("unique beta");
  await open(page, "a.ts");
  await a.press("ControlOrMeta+z");
  await expect(a).toContainText("export const alpha");
  await a.press("ControlOrMeta+Shift+z");
  await expect(a).toContainText("unique alpha");
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByLabel("Find or enter file path").fill("b.ts");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "b.ts", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Edit b.ts" })).toContainText(
    "unique beta",
  );
  await page.getByRole("button", { name: "Split Right", exact: true }).click();
  const b = page.getByRole("textbox", { name: "Edit b.ts" });
  await b.last().fill("peer history");
  await b.first().click();
  await b.first().press("ControlOrMeta+z");
  await expect(b.last()).toContainText("unique beta");
  const separator = page.getByRole("separator", {
    name: "Resize editor groups",
  });
  await separator.focus();
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "45");
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page
    .getByRole("button", { name: "Find / Replace", exact: true })
    .click();
  await expect(page.getByPlaceholder("Find")).toBeVisible();
  await page.getByPlaceholder("Find").fill("unique");
  await page.keyboard.press("Escape");
  const tabs = page.locator(".editor-group").first().locator(".editor-tab");
  await tabs.nth(0).dragTo(tabs.nth(1));
  await expect(
    page.locator(".editor-group").first().getByRole("tab").first(),
  ).toHaveText(/b.ts/);
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page
    .getByRole("button", { name: "Move Tab to Next Group", exact: true })
    .click();
  await expect(
    page.locator(".editor-group").last().getByRole("tab", { name: /a.ts/ }),
  ).toBeVisible();
});
test("E05 delayed save preserves later typing and duplicate save requests serialize", async ({
  page,
  nexus,
}) => {
  await ide(page);
  await open(page, "a.ts");
  const editor = page.getByRole("textbox", { name: "Edit a.ts" });
  await editor.fill("first save");
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const enteredPromise = new Promise<void>((r) => (entered = r));
  let once = true;
  // Transport delay only; the real service still performs the write and conflict check.
  await page.route("**/api/saveFile", async (route) => {
    if (once) {
      once = false;
      entered();
      await held;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await enteredPromise;
  await editor.fill("newer keystrokes");
  release();
  await expect
    .poll(() => readFile(path.join(nexus.workspace, "a.ts"), "utf8"))
    .toBe("first save");
  await expect(editor).toContainText("newer keystrokes");
  await expect(
    page.getByRole("tab", { name: "a.ts •", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).dblclick();
  await expect
    .poll(() => readFile(path.join(nexus.workspace, "a.ts"), "utf8"))
    .toBe("newer keystrokes");
});
test("E07 Unicode and CRLF, find/replace, invalid regex feedback, indentation, comments and word wrap", async ({
  page,
  nexus,
}) => {
  await ide(page);
  await open(page, "unicode 空間.txt");
  const unicode = page.getByRole("textbox", { name: "Edit unicode 空間.txt" });
  await unicode.press("ControlOrMeta+End");
  await unicode.press("Enter");
  await unicode.pressSequentially("追加 😀");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() =>
      readFile(path.join(nexus.workspace, "unicode 空間.txt"), "utf8"),
    )
    .toContain("\r\n追加 😀");
  await open(page, "a.ts");
  const editor = page.getByRole("textbox", { name: "Edit a.ts" });
  await editor.fill("const alpha = 1;\nconst alphaTwo = alpha;\n");
  await editor.press("ControlOrMeta+f");
  await page.getByLabel("Find", { exact: true }).fill("alpha");
  await page.getByLabel("Find", { exact: true }).press("ArrowRight");
  await page.getByLabel("Replace", { exact: true }).fill("omega");
  await page.getByLabel("Replace", { exact: true }).press("ArrowRight");
  await page.getByRole("button", { name: "replace all", exact: true }).click();
  await expect(editor).toContainText("omegaTwo");
  await page.getByLabel("regexp", { exact: true }).check();
  await page.getByLabel("Find", { exact: true }).fill("[");
  await page.getByLabel("Find", { exact: true }).press("ArrowRight");
  await expect(
    page.getByText("Invalid regular expression", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await editor.press("ControlOrMeta+Home");
  await editor.press("Tab");
  await expect(editor).toContainText("  const");
  await editor.press("Shift+Tab");
  await editor.press("ControlOrMeta+/");
  await expect(editor).toContainText("// const");
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page
    .getByRole("button", { name: "Toggle Word Wrap", exact: true })
    .click();
  await expect(page.locator(".cm-lineWrapping")).toBeVisible();
});
test("E08 near-limit text, unsupported binary/encoding, over-limit files and exact paths fail recoverably", async ({
  page,
  nexus,
}) => {
  await writeFile(
    path.join(nexus.workspace, "near-limit.txt"),
    "a\n".repeat(255000),
  );
  await writeFile(
    path.join(nexus.workspace, "over-limit.txt"),
    "a".repeat(512001),
  );
  await writeFile(
    path.join(nexus.workspace, "binary.bin"),
    Buffer.from([0, 1, 2]),
  );
  await writeFile(
    path.join(nexus.workspace, "invalid.txt"),
    Buffer.from([255, 254]),
  );
  await page.reload();
  await ide(page);
  await open(page, "near-limit.txt");
  await expect(
    page.getByRole("textbox", { name: "Edit near-limit.txt" }),
  ).toBeVisible();
  await open(page, "over-limit.txt");
  await expect(page.getByRole("alert")).toContainText("500 KB");
  await page.getByRole("button", { name: "Dismiss editor error" }).click();
  await open(page, "binary.bin");
  await expect(page.getByRole("alert")).toContainText("Binary");
  await page.getByRole("button", { name: "Dismiss editor error" }).click();
  await open(page, "invalid.txt");
  await expect(page.getByRole("alert")).toContainText("UTF-8");
  await open(page, "a.ts");
  await expect(page.getByRole("textbox", { name: "Edit a.ts" })).toBeVisible();
});

test("E13 autosave writes after idle and explicit Discard leaves disk unchanged", async ({
  page,
  nexus,
}) => {
  await ide(page);
  await open(page, "a.ts");
  const editor = page.getByRole("textbox", { name: "Edit a.ts" });
  await page.getByLabel("Autosave after 1.5 s idle").check();
  await editor.fill("autosaved document");
  await expect
    .poll(() => readFile(path.join(nexus.workspace, "a.ts"), "utf8"), {
      timeout: 8000,
    })
    .toBe("autosaved document");
  await page.getByLabel("Autosave after 1.5 s idle").uncheck();
  await editor.fill("explicitly discarded edit");
  await page.getByRole("button", { name: "Close a.ts", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(await readFile(path.join(nexus.workspace, "a.ts"), "utf8")).toBe(
    "autosaved document",
  );
  await open(page, "a.ts");
  await expect(editor).toContainText("autosaved document");
});

test("E14 real filesystem permission denial preserves dirty content and recovers after permission restoration", async ({
  page,
  nexus,
}) => {
  test.skip(
    process.platform === "win32" || process.getuid?.() === 0,
    "Requires effective POSIX mode denial for a non-root account",
  );
  const dir = path.join(nexus.workspace, "locked"),
    file = path.join(dir, "a.ts");
  await mkdir(dir);
  await writeFile(file, "original disk content");
  await page.reload();
  await ide(page);
  await open(page, "locked/a.ts");
  const editor = page.getByRole("textbox", { name: "Edit locked/a.ts" });
  await editor.fill("dirty buffer survives EACCES");
  await chmod(dir, 0o555);
  try {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      /EACCES|EPERM|permission denied/i,
    );
    expect(await readFile(file, "utf8")).toBe("original disk content");
    await expect(editor).toContainText("dirty buffer survives EACCES");
    await expect(
      page.getByRole("tab", { name: "a.ts •", exact: true }),
    ).toBeVisible();
  } finally {
    await chmod(dir, 0o755);
  }
  await page.getByRole("button", { name: "Dismiss editor error" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => readFile(file, "utf8"))
    .toBe("dirty buffer survives EACCES");
});
