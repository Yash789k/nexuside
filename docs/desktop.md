# NexusIDE Desktop

NexusIDE Desktop is the same editor and agent engine packaged as an Electron application. It is independent of VS Code and starts without a terminal or separately installed Node.js. The VSIX and CLI remain separate entry points; install them only if you want them.

## Install

Download from [GitHub Releases](https://github.com/Yash789k/nexuside/releases/latest):

| Computer | Download | Installation |
|---|---|---|
| Mac with Apple M-series chip | `NexusIDE-0.3.0-mac-arm64.dmg` | Open the DMG, drag NexusIDE to Applications, then launch it there |
| Windows x64 | `NexusIDE-0.3.0-win-x64.exe` | Run the per-user installer; administrator access is not required by default |
| Linux x64 | `NexusIDE-0.3.0-linux-x64.AppImage` | Mark executable, then launch; a compatible desktop environment and AppImage/FUSE support are needed |
| Debian/Ubuntu x64 | `NexusIDE-0.3.0-linux-x64.deb` | Install through the system package manager |

The first desktop packages are not Developer ID signed/notarized or Windows Authenticode signed. The Mac app is ad-hoc signed to seal its bundle and nested helpers; this is not an Apple-verified publisher identity. macOS/Windows may display an unidentified-publisher warning. Follow the OS's normal explicit first-launch approval after verifying the release source; do not disable Gatekeeper, antivirus or system-wide security settings. No Intel Mac installer is promised unless listed in the release assets. Updates are manual through **Help → Downloads and updates**; no automatic update service is advertised.

On macOS, first try opening NexusIDE from Applications. If macOS blocks this unnotarized build, use **System Settings → Privacy & Security → Open Anyway**, then confirm Open, after checking that you downloaded this release. See [Apple's first-launch instructions](https://support.apple.com/en-us/102445). Managed computers may disallow this exception.

On Debian/Ubuntu, prefer the DEB package. From the download folder:

```sh
sudo apt install ./NexusIDE-0.3.0-linux-x64.deb
```

Then launch NexusIDE from the applications menu. The DEB installs the Chromium sandbox helper and the applicable AppArmor profile. The portable AppImage needs FUSE and an OS configuration that permits Chromium's sandbox; recent Ubuntu policies can prevent it from starting. Use the DEB in that case. Do not launch with `--no-sandbox`. AppImage launch is not covered by the DEB installation test.

You need only one desktop installer. The macOS ZIP contains the same app as the DMG. The `.vsix`, `.tgz`, and source archives are optional downloads for VS Code, terminal use, and development respectively; they are not desktop installers.

## First session

1. Launch NexusIDE and select **Open project folder**. Choose a project you trust.
2. Open **Settings**, choose your provider under **Provider credential**, enter your key, and select **Save key**.
3. For OpenRouter, use its model catalog to import/enable a currently available tool-capable model. Save settings.
4. Use **IDE** for files, editing, tabs/splits and contextual assistance. Use **Agent** for a task, plan, reviewed edits, execution approvals and results.
5. Start with a small task. Read the proposed changes before choosing **Apply changes**. Testing requires its own approval.

For a no-key test, choose **Try an offline walkthrough** on the welcome screen, then **Try the offline walkthrough** in Agent mode. It proposes a Fibonacci module and three Node tests. Both edits and tests require your review. This deterministic demonstration is not a general-purpose offline AI model.

Keys use session memory by default, so first launch does not request Keychain access. To keep keys across restarts, explicitly enable **Remember provider keys on this device** in Settings, then save each key. The OS may request its credential-store password; on macOS this is the login keychain password, normally your Mac login password. Choose Deny to keep using session keys. Disabling the option removes saved encrypted keys from disk. Ad-hoc Mac signatures may cause another access prompt after an update; a stable Developer ID signature is a future distribution prerequisite for consistent Keychain identity.

## What is included and what is optional?

- Included: application window, editor, agent engine, provider adapters, local persistence, protected credential integration and Node runtime for approved `node --test` execution.
- No Docker needed: opening the app, editing, cloud-model assistance, review/apply, or approved host Node tests.
- Host execution is the desktop default and always requires approval. It runs trusted project code on your computer; it is not an OS sandbox.
- Project dependencies, npm, Python/pytest, Git and other project-specific tools are separate dependencies when used. The bundled app runtime does not install every project's toolchain.
- Isolated tests and current agent browser automation still require a running Docker engine/CLI. Browser/pytest isolation also needs the NexusIDE sandbox image. Install the CLI and run `nexus sandbox-build` for that optional setup.
- Code completion/language-server intelligence, debugging and a full interactive terminal are not automatically supplied by Electron. Existing native VS Code capabilities remain in the extension/host; the standalone browser editor's advertised capabilities are unchanged.

## Data and recovery

Projects stay in their existing folders. Runs, traces and editor recovery live in the project's `.nexus` folder. Desktop preferences and credentials are separate from the extension/CLI configuration:

- macOS: `~/Library/Application Support/NexusIDE`
- Windows: `%APPDATA%/NexusIDE`
- Linux: `$XDG_CONFIG_HOME/NexusIDE`, normally `~/.config/NexusIDE`

Provider keys remain in session memory unless you explicitly enable protected storage. When enabled and available, they are encrypted using Electron's OS-backed `safeStorage`. If protected storage is unavailable, the app continues with session keys and identifies this in Settings. Keys are never written into project files. No actual provider key is bundled.

When leaving a dirty project, choose **Save All**, **Keep for recovery**, or **Cancel**. The app waits for acknowledged recovery before closing. Unsaved content/layout can be restored when reopening from Recent projects; undo history restarts. Active agent operations are cancelled on exit; pending approvals remain persisted. As with the other surfaces, physical power loss before an acknowledged save is outside this guarantee.

## Development and verification

```sh
npm ci
npm run desktop
npm run check
npm run test:desktop
npm run package:desktop
```

Set `NEXUS_DESKTOP_EXE` to a packaged executable to run the same integration checks against the distributable. Linux test runners can use `xvfb-run -a npm run test:desktop`. `NEXUS_DESKTOP_PROFILE` selects an isolated data directory for development/testing; it is never set by the renderer. The test suite drives an actual Electron window and real filesystem; only native picker/confirmation responses are supplied at the OS dialog boundary. It also tests provider-key storage using a synthetic key, without making inference calls.

The renderer uses context isolation, Chromium sandboxing and no Node integration. A narrow preload bridge calls the shared service over validated main-frame IPC; no listening HTTP port is needed. External navigation, embedded webviews, popup windows and renderer permission requests are blocked. The fixed downloads link opens in the system browser. These renderer protections do not sandbox host-executed project code.

Published checksums identify the exact downloads. See the release notes for the actual verification performed on each platform and any known failures.
