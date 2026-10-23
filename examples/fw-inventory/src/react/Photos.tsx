import { useEffect, useRef, useState } from "react";
import { useIoNode } from "./useIoNode";
import type { Photo } from "./types";

type UploadEl = HTMLElement & { abort(): void; files: File[] | null };
interface UploadValues { value: Photo | null; loading: boolean; progress: number; error: any; status: number; files: File[] | null }
interface QueueItem { key: number; file: File }

let seq = 0;

export function Photos({ productId, initial }: { productId: number; initial: Photo[] }) {
  const [photos, setPhotos] = useState<Photo[]>(initial);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  return (
    <div>
      <div data-testid="photos">
        {photos.map((ph) => <img key={ph.id} className="thumb" src={ph.url} alt="" data-photo-id={ph.id} />)}
      </div>
      <div className="toolbar">
        <input type="file" multiple accept="image/*" data-testid="photo-input"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []).map((file) => ({ key: ++seq, file }));
            setQueue((q) => [...q, ...picked]);
            e.target.value = "";
          }} />
      </div>
      {queue.map((item) => (
        <UploadRow key={item.key} file={item.file} url={`/api/products/${productId}/photos`}
          onUploaded={(ph) => setPhotos((p) => (p.some((x) => x.id === ph.id) ? p : [...p, ph]))} />
      ))}
    </div>
  );
}

// One <wcs-upload> per file, so each file has its own progress, cancel and retry. An automatic upload
// starts when it has both `files` and `url`, in either order (since 4.6).
function UploadRow({ file, url, onUploaded }: { file: File; url: string; onUploaded: (p: Photo) => void }) {
  const [ref, up, el] = useIoNode<UploadEl, UploadValues>({ value: null, loading: false, progress: 0, error: null, status: 0 });
  // A new array starts an upload: the element uses its files up, so a retry needs a new one (assigning
  // the same array again changes nothing a framework writes).
  const [files, setFiles] = useState<File[]>(() => [file]);
  const done = useRef(false);
  useEffect(() => {
    if (up.value && up.status === 201 && !done.current) { done.current = true; onUploaded(up.value); }
  }, [up.value, up.status, onUploaded]);

  const state = up.loading ? "uploading" : up.error ? "failed" : done.current ? "done" : up.status ? "done" : "waiting";
  const message = up.error ? (up.error.status === 413 ? "too large (over 1 MB)" : up.error.status ? `server error ${up.error.status}` : up.error.message ?? "failed") : "";
  return (
    <div className="upload-row" data-testid="upload-row" data-file={file.name} data-state={state}>
      <wcs-upload ref={ref} files={files} url={url} accept="image/*"></wcs-upload>
      <span>{file.name} ({Math.round(file.size / 1024)} KB)</span>
      <progress max={100} value={up.progress ?? 0} data-testid="upload-progress"></progress>
      <span data-testid="upload-state">{state}{message ? `: ${message}` : ""}</span>
      {up.loading && <button data-testid="upload-cancel" onClick={() => el.current?.abort()}>Cancel</button>}
      {!up.loading && (up.error || state === "waiting") && (
        <button data-testid="upload-retry" onClick={() => { done.current = false; setFiles([file]); }}>Retry</button>
      )}
    </div>
  );
}
