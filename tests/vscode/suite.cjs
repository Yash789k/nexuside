const vscode = require("vscode");
const assert = require("node:assert/strict");
exports.run = async () => {
  const extension = vscode.extensions.getExtension("nexuside-local.nexuside");
  assert.ok(extension, "NexusIDE extension is registered");
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "nexuside.open",
    "nexuside.complete",
    "nexuside.edit",
    "nexuside.configure",
  ])
    assert.ok(commands.includes(command));
  await vscode.commands.executeCommand("nexuside.open");
  for (
    let i = 0;
    i < 80 &&
    !vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .some((tab) => tab.label === "NexusIDE");
    i++
  )
    await new Promise((r) => setTimeout(r, 100));
  assert.ok(
    vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .some((tab) => tab.label === "NexusIDE"),
    "Workspace panel opens",
  );
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
};
