import { useRef, useState } from "react";
import { ArrowUp, Paperclip, X, LoaderCircle } from "lucide-react";
import type { Attachment, Priority } from "../../core/types";
import type { AppState } from "../api";
export function Composer({
  state,
  busy,
  onSubmit,
  model,
  setModel,
  onError,
}: {
  state?: AppState;
  busy: boolean;
  model: string;
  setModel: (m: string) => void;
  onSubmit: (
    prompt: string,
    priority: Priority,
    attachments: Attachment[],
  ) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [prompt, setPrompt] = useState(""),
    [priority, setPriority] = useState<Priority>("balanced"),
    [attachments, setAttachments] = useState<Attachment[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (!prompt.trim() || busy) return;
    try {
      await onSubmit(prompt.trim(), priority, attachments);
      setPrompt("");
      setAttachments([]);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  async function attach(files: FileList | null) {
    if (!files) return;
    try {
      const next: Attachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 20_000_000)
          throw new Error("Choose files smaller than 20 MB");
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        next.push({ name: file.name, mime: file.type, data });
      }
      const all = [...attachments, ...next];
      if (
        all.length > 5 ||
        all.reduce((n, a) => n + a.data.length, 0) > 28_000_000
      )
        throw new Error("Attach up to 5 files, 20 MB total");
      setAttachments(all);
    } catch (e) {
      onError((e as Error).message);
    }
    if (input.current) input.current.value = "";
  }
  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="Task prompt"
          placeholder="Describe a task, ask a question, or attach context…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((a, i) => (
              <span key={i}>
                {a.name}
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() =>
                    setAttachments(attachments.filter((_, j) => i !== j))
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-toolbar">
          <div className="composer-selects">
            <select
              aria-label="Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              <option value="auto">Auto route</option>
              {state?.models
                .filter((m) => m.enabled)
                .map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                    {!m.configured ? " · setup needed" : ""}
                  </option>
                ))}
            </select>
            <select
              aria-label="Routing priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              <option value="balanced">Balanced</option>
              <option value="economy">Economy</option>
              <option value="quality">Quality</option>
            </select>
          </div>
          <div className="composer-actions">
            <input
              type="file"
              multiple
              accept="image/*,audio/*,video/*"
              ref={input}
              onChange={(e) => void attach(e.target.files)}
              hidden
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Attach image, audio or video"
              onClick={() => input.current?.click()}
            >
              <Paperclip size={19} />
            </button>
            <button
              className="send-button"
              type="submit"
              aria-label="Send task"
              disabled={!prompt.trim() || busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={19} />
              ) : (
                <ArrowUp size={20} />
              )}
            </button>
          </div>
        </div>
      </form>
      <div className="composer-caption">
        {model === "demo"
          ? "Offline walkthrough · no model calls"
          : "Changes are reviewed before they reach your files"}
        <span>⌘ / Ctrl + Enter</span>
      </div>
    </div>
  );
}
