import { parseCatalog, type CatalogModel } from "./openrouter";
let cached: { time: number; models: CatalogModel[] } | undefined;
export async function openRouterCatalog(search = "", modality = "") {
  if (!cached || Date.now() - cached.time > 300_000) {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`OpenRouter catalog unavailable (${response.status})`);
    cached = { time: Date.now(), models: parseCatalog(await response.json()) };
  }
  const query = search.toLowerCase();
  return cached.models.filter(
    (m) =>
      (!query || `${m.id} ${m.name}`.toLowerCase().includes(query)) &&
      (!modality || m.capabilities.includes(modality as "text")),
  );
}
