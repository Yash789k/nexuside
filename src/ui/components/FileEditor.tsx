import { useEffect, useState } from "react";
import { FileCode2, Save, X } from "lucide-react";
import { api } from "../api";
export function FileEditor({
  path,
  onClose,
  onSaved,
}: {
  path: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState(""),
    [original, setOriginal] = useState(""),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    setLoaded(false);
    void api("file", { path })
      .then((r) => {
        setOriginal(r.content);
        setContent(r.content);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [path]);
  async function save() {
    setSaving(true);
    try {
      await api("saveFile", { path, before: original, content });
      setOriginal(content);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="file-editor">
      <header>
        <span>
          <FileCode2 size={18} />
          {path}
          {content !== original ? " •" : ""}
        </span>
        <div>
          <button
            disabled={!loaded || saving || content === original}
            onClick={() => void save()}
          >
            <Save size={15} />
            Save
          </button>
          <button
            className="icon-button"
            aria-label="Close file"
            onClick={() => {
              if (content === original || confirm("Discard unsaved edits?"))
                onClose();
            }}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      {error && <p className="error-detail">{error}</p>}
      <textarea
        aria-label={`Edit ${path}`}
        spellCheck={false}
        value={content}
        disabled={!loaded}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            void save();
          }
        }}
      />
      <footer>
        {content.split("\n").length} lines · UTF-8 ·{" "}
        {content !== original ? "Unsaved changes" : "Saved"}
      </footer>
    </section>
  );
}
