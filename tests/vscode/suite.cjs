const vscode = require("vscode");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
exports.run = async () => {
  const report = {
    runtime: vscode.version,
    installed: process.env.NEXUS_TEST_INSTALLED === "1",
    checks: [],
    blocked: [],
  };
  const evidence = path.resolve("../nexuside-qa-evidence");
  await fs.mkdir(evidence, { recursive: true });
  try {
    const extension = vscode.extensions.getExtension("nexuside-local.nexuside");
    assert.ok(extension);
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "nexuside.open",
      "nexuside.complete",
      "nexuside.edit",
      "nexuside.configure",
    ])
      assert.ok(commands.includes(id));
    report.checks.push("Extension activation and four registered commands");
    const root = vscode.workspace.workspaceFolders[0].uri,
      uri = vscode.Uri.joinPath(root, "native 空間.ts");
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from("export const value = 1;\n"),
    );
    const doc = await vscode.workspace.openTextDocument(uri),
      editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await editor.edit((edit) =>
      edit.insert(new vscode.Position(1, 0), "// native host edit\n"),
    );
    assert.ok(doc.isDirty);
    await doc.save();
    assert.match(
      Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(),
      /native host edit/,
    );
    report.checks.push(
      "Native document editing, dirty state and real filesystem save",
    );
    const { chromium } = require("playwright"),
      browser = await chromium.connectOverCDP(
        `http://127.0.0.1:${process.env.NEXUS_TEST_CDP}`,
      );
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes("workbench"));
    assert.ok(page);
    await page.bringToFront();
    await page.locator(".monaco-editor .view-lines").first().click();
    if (vscode.window.state.focused) {
      editor.selection = new vscode.Selection(0, 0, 0, 6);
      await vscode.commands.executeCommand("editor.action.commentLine");
      for (let i = 0; i < 30 && !doc.getText().includes("// export"); i++)
        await new Promise((r) => setTimeout(r, 100));
      assert.match(doc.getText(), /\/\/ export/);
      await vscode.commands.executeCommand("undo");
      for (let i = 0; i < 30 && !doc.getText().startsWith("export"); i++)
        await new Promise((r) => setTimeout(r, 100));
      assert.ok(doc.getText().startsWith("export"));
      report.checks.push("Foreground native comment and undo commands");
    } else {
      report.blocked.push(
        "OS foreground focus is unavailable (window.state.focused=false even with CDP DOM focus). Native comment/undo/physical shortcut test is retained but not credited as passed.",
      );
      if (process.env.NEXUS_REQUIRE_NATIVE_FOCUS === "1")
        assert.fail("Native foreground focus is required for this test");
    }
    await doc.save();
    await vscode.commands.executeCommand("workbench.action.splitEditorRight");
    assert.ok(vscode.window.tabGroups.all.length >= 2);
    report.checks.push("Native editor split");
    await vscode.commands.executeCommand("nexuside.open");
    for (
      let i = 0;
      i < 80 &&
      !vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .some((t) => t.label === "NexusIDE");
      i++
    )
      await new Promise((r) => setTimeout(r, 100));
    assert.ok(
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .some((t) => t.label === "NexusIDE"),
    );
    assert.ok(
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .some((t) => t.label === "native 空間.ts"),
    );
    report.checks.push("NexusIDE opens beside existing native editor");
    let frame;
    for (let i = 0; i < 60 && !frame; i++) {
      for (const f of page.frames())
        if (await f.getByRole("button", { name: "IDE", exact: true }).count()) {
          frame = f;
          break;
        }
      if (!frame) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(frame, "Actual NexusIDE webview renders");
    await frame.getByRole("button", { name: "IDE", exact: true }).click();
    await frame
      .getByRole("button", { name: "◇ native 空間.ts", exact: true })
      .click();
    await frame
      .getByRole("textbox", { name: "Edit native 空間.ts" })
      .fill("export const savedFromWebview = true;");
    await frame.getByRole("button", { name: "Save", exact: true }).click();
    for (
      let i = 0;
      i < 50 &&
      !Buffer.from(await vscode.workspace.fs.readFile(uri))
        .toString()
        .includes("savedFromWebview");
      i++
    )
      await new Promise((r) => setTimeout(r, 100));
    assert.match(
      Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(),
      /savedFromWebview/,
    );
    report.checks.push(
      "Actual installed webview IDE edits and saves a native workspace file",
    );
    // The native split integration is verified above. Join those host groups
    // before zooming so their minimum widths cannot push the tested webview
    // outside the OS window. This changes host layout, not web CSS scaling.
    for (const command of [
      "workbench.action.joinAllGroups",
      "workbench.action.closeSidebar",
      "workbench.action.closeAuxiliaryBar",
      "workbench.action.closePanel",
    ]) {
      assert.ok(commands.includes(command), `Host command exists: ${command}`);
      await vscode.commands.executeCommand(command);
    }
    await vscode.commands.executeCommand("nexuside.open");
    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("workbench.action.zoomReset");
    await new Promise((r) => setTimeout(r, 200));
    const baseRatio = await page.evaluate(() => devicePixelRatio);
    await vscode.commands.executeCommand("workbench.action.zoomIn");
    await new Promise((r) => setTimeout(r, 200));
    const increasedRatio = await page.evaluate(() => devicePixelRatio);
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await vscode.commands.executeCommand("workbench.action.zoomReset");
    await new Promise((r) => setTimeout(r, 200));
    const resetRatio = await page.evaluate(() => devicePixelRatio);
    report.zoomCommands = { baseRatio, increasedRatio, resetRatio };
    assert.ok(
      increasedRatio > baseRatio,
      "Native host zoom changes renderer device scale",
    );
    assert.equal(resetRatio, baseRatio);
    report.checks.push(
      "Host zoom in/out/reset commands change real renderer scale (not CSS or viewport emulation)",
    );
    for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
      await vscode.workspace
        .getConfiguration("window")
        .update(
          "zoomLevel",
          Math.log(scale) / Math.log(1.2),
          vscode.ConfigurationTarget.Global,
        );
      await new Promise((r) => setTimeout(r, 200));
      await frame
        .getByRole("button", { name: "Commands", exact: true })
        .focus();
      await frame
        .getByRole("button", { name: "Commands", exact: true })
        .press("Enter");
      await frame.getByRole("dialog", { name: "Command palette" }).waitFor();
      const hostFrame = await frame.frameElement();
      const bounds = await hostFrame.boundingBox();
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      assert.ok(
        bounds &&
          bounds.x >= 0 &&
          bounds.x + bounds.width <= viewport.width + 1,
        `Webview must fit inside host window at ${scale * 100}%`,
      );
      const session = await page.context().newCDPSession(page);
      const screenshot = await session.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      });
      await fs.writeFile(
        path.join(evidence, `native-zoom-${Math.round(scale * 100)}.png`),
        Buffer.from(screenshot.data, "base64"),
      );
      report.zoomSnapshots ??= [];
      report.zoomSnapshots.push({
        scale,
        viewport: await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
          bodyWidth: document.body.clientWidth,
        })),
        webview: await frame.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
        })),
      });
      await session.detach();
      await frame
        .getByRole("button", { name: "Close dialog", exact: true })
        .focus();
      await frame
        .getByRole("button", { name: "Close dialog", exact: true })
        .press("Enter");
    }
    report.checks.push(
      "Real host zoom configuration at 80/100/125/150/200%, keyboard activation of webview command dialog and screenshots",
    );
    await vscode.commands.executeCommand("workbench.action.zoomReset");
    await vscode.workspace
      .getConfiguration("workbench")
      .update(
        "colorTheme",
        "Default Light Modern",
        vscode.ConfigurationTarget.Global,
      );
    await vscode.workspace
      .getConfiguration("workbench")
      .update(
        "colorTheme",
        "Default Dark Modern",
        vscode.ConfigurationTarget.Global,
      );
    report.checks.push("Host theme changes");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("nexuside.open");
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .some((t) => t.label === "NexusIDE"),
    );
    report.checks.push("Panel disposal and reopening");
    report.blocked.push(
      "CDP pointer mapping into the zoomed webview hit an adjacent host pane at 80%; keyboard activation was used, so pointer alignment is unverified.",
    );
    report.blocked.push(
      "Physical zoom shortcuts, native caret/drag alignment at each zoom, real screen reader, workspace-trust denial UI, and live provider inline suggestion acceptance/dismissal require separate host/provider verification.",
    );
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    report.failure = e.stack;
    throw e;
  } finally {
    await fs.writeFile(
      path.join(evidence, "vscode-integration.json"),
      JSON.stringify(report, null, 2),
    );
  }
};
