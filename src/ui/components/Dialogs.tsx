import { useEffect, useRef, useState } from "react";
import { X, Check, KeyRound, ExternalLink } from "lucide-react";
import { api, type AppState } from "../api";
import type { Config } from "../../core/types";
import { OpenRouterCatalog, OpenRouterPreferences } from "./OpenRouterSettings";
export function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function SettingsDialog({
  state,
  onClose,
  onSaved,
}: {
  state: AppState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [config, setConfig] = useState<Config>(structuredClone(state.config)),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [provider, setProvider] = useState("OPENAI_API_KEY"),
    [key, setKey] = useState(""),
    [keySaved, setKeySaved] = useState(false),
    [domains, setDomains] = useState(state.config.browserDomains.join(", "));
  const update = (index: number, field: string, value: unknown) =>
    setConfig((c) => ({
      ...c,
      models: c.models.map((m, i) =>
        i === index ? { ...m, [field]: value } : m,
      ),
    }));
  async function save() {
    setSaving(true);
    try {
      await api("config", {
        config: {
          ...config,
          browserDomains: domains
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function saveKey() {
    try {
      await api("key", { env: provider, key });
      setKey("");
      setKeySaved(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog title="Workspace settings" wide onClose={onClose}>
      <div className="dialog-body">
        <OpenRouterCatalog config={config} onChange={setConfig} />
        <section>
          <h3>Providers & models</h3>
          <p className="subtle">
            Use your own models. Model IDs and estimated token prices are
            editable.
          </p>
          <div className="provider-list">
            {config.models
              .filter((m) => m.provider !== "demo")
              .map((m) => {
                const i = config.models.findIndex((a) => a.id === m.id);
                return (
                  <details key={m.id} className="provider-detail">
                    <summary>
                      <span
                        className={`dot ${state.models.find((a) => a.id === m.id)?.configured ? "completed" : "disabled"}`}
                      />
                      <strong>{m.name}</strong>
                      <span>{m.model}</span>
                    </summary>
                    <div className="provider-fields">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={m.enabled}
                          onChange={(e) =>
                            update(i, "enabled", e.target.checked)
                          }
                        />
                        Enabled
                      </label>
                      <label>
                        Model ID
                        <input
                          value={m.model}
                          onChange={(e) => update(i, "model", e.target.value)}
                        />
                      </label>
                      <label className="span-2">
                        API base URL
                        <input
                          value={m.baseUrl}
                          onChange={(e) => update(i, "baseUrl", e.target.value)}
                        />
                      </label>
                      <label>
                        Intelligence tier
                        <select
                          value={m.tier}
                          onChange={(e) =>
                            update(i, "tier", Number(e.target.value))
                          }
                        >
                          <option value={1}>1 · Fast</option>
                          <option value={2}>2 · Balanced</option>
                          <option value={3}>3 · Quality</option>
                        </select>
                      </label>
                      <label>
                        Input $ / million tokens
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={m.inputCost}
                          onChange={(e) =>
                            update(i, "inputCost", Number(e.target.value))
                          }
                        />
                      </label>
                      <label>
                        Output $ / million tokens
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={m.outputCost}
                          onChange={(e) =>
                            update(i, "outputCost", Number(e.target.value))
                          }
                        />
                      </label>
                      {m.provider === "openrouter" && (
                        <OpenRouterPreferences
                          model={m}
                          onChange={(options) =>
                            update(i, "openrouter", options)
                          }
                        />
                      )}
                    </div>
                  </details>
                );
              })}
          </div>
        </section>
        <section>
          <h3>Provider credential</h3>
          <p className="subtle">
            Storage: {state.credentialStorage}.{" "}
            {state.credentialStorage === "Session memory"
              ? "Keys are forgotten when this server stops. CLI runs can use provider environment variables."
              : "Keys stay in VS Code’s protected credential store."}
          </p>
          <div className="key-form">
            <select
              aria-label="Credential provider"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setKeySaved(false);
              }}
            >
              {[
                ...new Set(config.models.map((m) => m.keyEnv).filter(Boolean)),
              ].map((env) => (
                <option key={env}>{env}</option>
              ))}
            </select>
            <input
              type="password"
              aria-label="Provider API key"
              autoComplete="off"
              placeholder="Paste your provider key"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setKeySaved(false);
              }}
            />
            <button onClick={() => void saveKey()} disabled={key.length < 8}>
              Save key
            </button>
          </div>
          {keySaved && (
            <p className="success-text">
              <Check size={15} />
              Credential saved.
            </p>
          )}
        </section>
        <section>
          <h3>Execution policy</h3>
          <div className="settings-grid">
            <label>
              Budget per run (USD estimate)
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.1"
                value={config.maxBudget}
                onChange={(e) =>
                  setConfig({ ...config, maxBudget: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Maximum agent steps
              <input
                type="number"
                min="1"
                max="100"
                value={config.maxSteps}
                onChange={(e) =>
                  setConfig({ ...config, maxSteps: Number(e.target.value) })
                }
              />
            </label>
            <label className="span-2">
              Test execution
              <select
                value={config.testRunner}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    testRunner: e.target.value as "docker" | "host",
                  })
                }
              >
                <option value="docker">
                  Docker · isolated snapshot, no network
                </option>
                <option value="host">
                  This computer · trusted code only, approval required
                </option>
              </select>
            </label>
            <label className="span-2">
              Browser allowlist (exact domains, comma separated)
              <input
                placeholder="example.com, docs.example.com"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
              />
            </label>
          </div>
          <p className="subtle">
            Changes apply to new runs. File edits, test execution, browser
            actions and commits each require review.
          </p>
        </section>
        {error && (
          <div className="error-detail" role="alert">
            {error}
          </div>
        )}
      </div>
      <footer>
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary-button"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </footer>
    </Dialog>
  );
}
export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="NexusIDE in your terminal" onClose={onClose}>
      <div className="dialog-body help-body">
        <p>
          The same engine, workspace, and approvals in PowerShell, Terminal, or
          your favorite shell.
        </p>
        <h3>Install the CLI download</h3>
        <pre>npm install -g ./nexuside-0.1.0.tgz</pre>
        <h3>Try the offline walkthrough</h3>
        <pre>nexus demo --yes</pre>
        <h3>Run a task in your project</h3>
        <pre>nexus -w ./my-project run "Add tests"</pre>
        <h3>Open this dashboard</h3>
        <pre>nexus -w ./my-project serve</pre>
        <h3>Inspect and evaluate runs</h3>
        <pre>
          {"nexus runs\nnexus trace <run-id> --verify\nnexus eval --json"}
        </pre>
        <p className="subtle">
          Requires Node.js 22+. Docker is optional for editing and required for
          isolated tests and browser actions. Build the browser image with{" "}
          <code>nexus sandbox-build</code>.
        </p>
      </div>
    </Dialog>
  );
}
