import { useState } from "react";
import { Search, Plus, Check, LoaderCircle } from "lucide-react";
import { api } from "../api";
import { catalogModel, type CatalogModel } from "../../core/openrouter";
import type { Config, ModelConfig, OpenRouterOptions } from "../../core/types";

function ListField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value?: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value?.join(", ") ?? "");
  return (
    <label>
      {label}
      <input
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          );
        }}
      />
    </label>
  );
}

export function OpenRouterPreferences({
  model,
  onChange,
}: {
  model: ModelConfig;
  onChange: (options: OpenRouterOptions) => void;
}) {
  const o = model.openrouter ?? {};
  const set = (field: keyof OpenRouterOptions, value: unknown) =>
    onChange({ ...o, [field]: value });
  return (
    <div className="openrouter-preferences span-2">
      <h4>OpenRouter routing</h4>
      <p className="subtle">
        The input/output prices above also cap provider token prices, including
        fallback models. Update these ceilings if no endpoint is available.
      </p>
      <div className="settings-grid">
        <label>
          Optimize for
          <select
            value={o.sort ?? "price"}
            onChange={(e) => set("sort", e.target.value)}
          >
            <option value="price">Lowest price</option>
            <option value="latency">Lowest latency</option>
            <option value="throughput">Highest throughput</option>
          </select>
        </label>
        <label>
          Model preference
          <select
            value={o.partition ?? "model"}
            onChange={(e) => set("partition", e.target.value)}
          >
            <option value="model">Primary model first</option>
            <option value="none">Compare all fallback models</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={o.allowFallbacks ?? true}
            onChange={(e) => set("allowFallbacks", e.target.checked)}
          />
          Allow provider fallbacks
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={o.zdr ?? false}
            onChange={(e) => set("zdr", e.target.checked)}
          />
          Require zero data retention
        </label>
        <label>
          Provider data collection
          <select
            value={o.dataCollection ?? "allow"}
            onChange={(e) => set("dataCollection", e.target.value)}
          >
            <option value="allow">Use account defaults</option>
            <option value="deny">Deny data collection</option>
          </select>
        </label>
        <label>
          Reasoning effort
          <select
            value={o.reasoningEffort ?? ""}
            onChange={(e) =>
              set("reasoningEffort", e.target.value || undefined)
            }
          >
            <option value="">Model default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <div className="span-2">
          <ListField
            label="Fallback model IDs (up to 4, comma separated)"
            value={o.fallbackModels}
            onChange={(v) => set("fallbackModels", v)}
            placeholder="google/gemini-2.5-flash"
          />
        </div>
        <ListField
          label="Preferred provider order"
          value={o.order}
          onChange={(v) => set("order", v)}
          placeholder="Provider slugs, comma separated"
        />
        <ListField
          label="Only these providers"
          value={o.only}
          onChange={(v) => set("only", v)}
          placeholder="Empty allows all eligible providers"
        />
        <ListField
          label="Exclude providers"
          value={o.ignore}
          onChange={(v) => set("ignore", v)}
        />
        <label>
          Preferred max latency (seconds)
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={o.preferredMaxLatency ?? ""}
            onChange={(e) =>
              set(
                "preferredMaxLatency",
                e.target.value ? Number(e.target.value) : undefined,
              )
            }
          />
        </label>
        <label>
          Preferred min throughput (tokens/sec)
          <input
            type="number"
            min="1"
            value={o.preferredMinThroughput ?? ""}
            onChange={(e) =>
              set(
                "preferredMinThroughput",
                e.target.value ? Number(e.target.value) : undefined,
              )
            }
          />
        </label>
      </div>
      <p className="subtle">
        Fallback models must support tools and your attachments. Performance
        preferences are targets. Privacy restrictions can reduce availability;
        reasoning must be supported by the selected model.
      </p>
    </div>
  );
}

export function OpenRouterCatalog({
  config,
  onChange,
}: {
  config: Config;
  onChange: (config: Config) => void;
}) {
  const [models, setModels] = useState<CatalogModel[]>([]),
    [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(false),
    [query, setQuery] = useState(""),
    [modality, setModality] = useState(""),
    [error, setError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      setModels(await api<CatalogModel[]>("openrouterCatalog"));
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const filtered = models.filter(
    (m) =>
      `${m.id} ${m.name}`.toLowerCase().includes(query.toLowerCase()) &&
      (!modality || m.capabilities.includes(modality as "text")),
  );
  return (
    <section className="catalog-section">
      <div className="catalog-heading">
        <div>
          <h3>OpenRouter model catalog</h3>
          <p className="subtle">
            One key, multiple model families. Discover tool-capable models with
            published token prices.
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading}>
          {loading ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Search size={15} />
          )}
          {loading ? "Loading…" : "Load catalog"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {loaded && (
        <>
          <div className="catalog-filters">
            <input
              aria-label="Search OpenRouter models"
              placeholder="Search model or provider…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="OpenRouter input capability"
              value={modality}
              onChange={(e) => setModality(e.target.value)}
            >
              <option value="">All inputs</option>
              <option value="image">Images</option>
              <option value="audio">Audio</option>
              <option value="video">Video</option>
            </select>
          </div>
          <p className="subtle">
            {filtered.length} models · USD per million tokens · Add, then Save
            settings.
          </p>
          <div className="catalog-results">
            {filtered.slice(0, 50).map((m) => {
              const exists = config.models.some(
                (c) => c.provider === "openrouter" && c.model === m.id,
              );
              return (
                <div className="catalog-model" key={m.id}>
                  <div>
                    <strong>{m.name}</strong>
                    <code>{m.id}</code>
                    <small>
                      ${m.inputCost.toFixed(3)} in / ${m.outputCost.toFixed(3)}{" "}
                      out · {Math.round(m.contextLength / 1000)}k context ·{" "}
                      {m.capabilities.join(" / ")}
                    </small>
                  </div>
                  <button
                    aria-label={`${exists ? "Added" : "Add"} ${m.id}`}
                    disabled={exists || config.models.length >= 30}
                    onClick={() =>
                      onChange({
                        ...config,
                        models: [...config.models, catalogModel(m)],
                      })
                    }
                  >
                    {exists ? <Check size={15} /> : <Plus size={15} />}
                    {exists ? "Added" : "Add"}
                  </button>
                </div>
              );
            })}
            {!filtered.length && <p className="subtle">No matching models.</p>}
          </div>
          {filtered.length > 50 && (
            <p className="subtle">
              Showing the first 50. Narrow your search to see more.
            </p>
          )}
        </>
      )}
    </section>
  );
}
