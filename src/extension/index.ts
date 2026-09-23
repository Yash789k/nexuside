import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Workspace } from "../core/workspace";
import { Service } from "../server/service";
import { loadConfig, envKey } from "../core/config";
import { Engine } from "../core/engine";
import { available } from "../core/router";
let panel: vscode.WebviewPanel | undefined;
export function activate(context: vscode.ExtensionContext) {
  const getRoot = () => {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust this workspace to use NexusIDE");
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) throw new Error("Open a folder in VS Code first");
    return root;
  };
  const key = async (m: any) =>
    m.keyEnv
      ? ((await context.secrets.get(m.keyEnv)) ?? (await envKey(m)))
      : undefined;
  const configure = async () => {
    const config = await loadConfig();
    const envs = [
      ...new Set(config.models.map((m) => m.keyEnv).filter(Boolean)),
    ] as string[];
    const selected = await vscode.window.showQuickPick(envs, {
      title: "Choose a provider credential",
    });
    if (!selected) return;
    const value = await vscode.window.showInputBox({
      title: `Configure ${selected}`,
      prompt:
        "Stored in VS Code SecretStorage. Never written into your repository.",
      password: true,
      ignoreFocusOut: true,
    });
    if (value) {
      await context.secrets.store(selected, value);
      void vscode.window.showInformationMessage(
        "NexusIDE provider credential saved securely.",
      );
    }
  };
  const show = async () => {
    const root = getRoot();
    if (panel) {
      panel.reveal();
      return;
    }
    const service = new Service(
      await Workspace.open(root),
      key,
      async (env, value) => {
        if (value) await context.secrets.store(env, value);
        else await context.secrets.delete(env);
      },
    );
    panel = vscode.window.createWebviewPanel(
      "nexuside",
      "NexusIDE",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "dist", "web"),
        ],
      },
    );
    const view = panel.webview;
    const html = await readFile(
      path.join(context.extensionPath, "dist", "web", "index.html"),
      "utf8",
    );
    const source = (file: string) =>
      view
        .asWebviewUri(
          vscode.Uri.joinPath(context.extensionUri, "dist", "web", file),
        )
        .toString();
    let sessionId = context.workspaceState.get<string>("nexus.editorSession");
    if (!sessionId) {
      sessionId = randomUUID();
      await context.workspaceState.update("nexus.editorSession", sessionId);
    }
    const nonce = randomBytes(16).toString("hex");
    view.html = html
      .replace(
        "<head>",
        `<head><meta name="nexus-session" content="${sessionId}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.cspSource} data:; style-src ${view.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${view.cspSource};">`,
      )
      .replace(
        /src="\.\/([^\"]+)"/g,
        (_m, file) => `nonce="${nonce}" src="${source(file)}"`,
      )
      .replace(/href="\.\/([^\"]+)"/g, (_m, file) => `href="${source(file)}"`);
    panel.onDidDispose(() => {
      panel = undefined;
    });
    view.onDidReceiveMessage(
      async (msg) => {
        if (
          msg?.type !== "nexus-request" ||
          typeof msg.id !== "string" ||
          typeof msg.action !== "string"
        )
          return;
        try {
          getRoot();
          const data = await service.request(msg.action, msg.data);
          await view.postMessage({ type: "nexus-response", id: msg.id, data });
        } catch (e) {
          await view.postMessage({
            type: "nexus-response",
            id: msg.id,
            error: (e as Error).message,
          });
        }
      },
      undefined,
      context.subscriptions,
    );
  };
  const safe = (fn: () => Promise<unknown>) => () =>
    fn().catch((e) => vscode.window.showErrorMessage(`NexusIDE: ${e.message}`));
  context.subscriptions.push(
    vscode.commands.registerCommand("nexuside.open", safe(show)),
    vscode.commands.registerCommand("nexuside.configure", safe(configure)),
  );
  let suggestion:
    | { uri: string; version: number; position: vscode.Position; text: string }
    | undefined;
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { scheme: "file" },
      {
        provideInlineCompletionItems(document, position) {
          if (
            suggestion?.uri === document.uri.toString() &&
            suggestion.version === document.version &&
            suggestion.position.isEqual(position)
          )
            return [
              new vscode.InlineCompletionItem(
                suggestion.text,
                new vscode.Range(position, position),
              ),
            ];
          return [];
        },
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "nexuside.complete",
      safe(async () => {
        const root = getRoot();
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const workspace = await Workspace.open(root);
        await workspace.resolve(
          path
            .relative(root, editor.document.uri.fsPath)
            .split(path.sep)
            .join("/"),
        );
        const config = await loadConfig();
        const models = (await available(config, key)).filter(
          (m) => m.provider !== "demo",
        );
        if (!models.length) {
          await configure();
          return;
        }
        const doc = editor.document,
          position = editor.selection.active,
          version = doc.version;
        const offset = doc.offsetAt(position);
        const text = doc.getText();
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "NexusIDE: generating inline suggestion",
          },
          async () => {
            const e = new Engine(workspace, key);
            const run = await e.create({
              mode: "ide",
              model: models[0].id,
              prompt: `Return only the code to insert at <CURSOR>. No markdown or explanation. Language: ${doc.languageId}\n${text.slice(Math.max(0, offset - 6000), offset)}<CURSOR>${text.slice(offset, offset + 2000)}`,
            });
            const result = await e.drive(run.id);
            if (result.status !== "completed")
              throw new Error(result.error ?? "Completion did not finish");
            if (doc.version !== version) return;
            suggestion = {
              uri: doc.uri.toString(),
              version,
              position,
              text: (result.summary ?? "").replace(/^```[^\n]*\n|\n```$/g, ""),
            };
            await vscode.commands.executeCommand(
              "editor.action.inlineSuggest.trigger",
            );
          },
        );
      }),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "nexuside.edit",
      safe(async () => {
        const root = getRoot(),
          editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const instruction = await vscode.window.showInputBox({
          title: "NexusIDE: Edit selection",
          prompt: "Describe the change. The result will be staged for review.",
        });
        if (!instruction) return;
        const workspace = await Workspace.open(root),
          file = path
            .relative(root, editor.document.uri.fsPath)
            .split(path.sep)
            .join("/");
        await workspace.resolve(file);
        if (editor.document.isDirty) {
          const saved = await editor.document.save();
          if (!saved)
            throw new Error("Save the document before proposing changes");
        }
        const e = new Engine(workspace, key);
        const run = await e.create({
          prompt: `${instruction}\nFile: ${file}\nSelected lines ${editor.selection.start.line + 1}–${editor.selection.end.line + 1}. Read the file and propose a focused edit. Preserve unrelated content.`,
        });
        void e
          .drive(run.id)
          .catch((err) => vscode.window.showErrorMessage(err.message));
        await show();
      }),
    ),
  );
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  status.text = "$(sparkle) NexusIDE";
  status.command = "nexuside.open";
  status.tooltip = "Open the NexusIDE workspace";
  status.show();
  context.subscriptions.push(status);
}
export function deactivate() {
  panel?.dispose();
}
