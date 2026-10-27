"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PropertyThumb } from "@/components/property-thumb";
import { CameraIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { setPropertyPhoto } from "../actions";

const SIZE = 512;

/** Center-crops to a square and shrinks to 512 px JPEG before upload (keeps files small on mobile data). */
async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process images");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read the image"))), "image/jpeg", 0.86));
}

export function PhotoUploader({ propertyId, name, url }: { propertyId: string; name: string; url: string | null }) {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(url);
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: string }>({ busy: false });

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setState({ busy: false, error: "Choose an image file (JPEG, PNG or WebP)" });
    setState({ busy: true });
    try {
      const blob = await toSquareJpeg(file);
      setPreview(URL.createObjectURL(blob));
      const path = `${propertyId}/cover-${Date.now()}.jpg`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("property-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error("Upload failed. Check your connection and try again.");
      const res = await setPropertyPhoto(propertyId, path);
      if (res.error) throw new Error(res.error);
      setState({ busy: false, ok: "Photo updated" });
      router.refresh();
    } catch (e) {
      setState({ busy: false, error: (e as Error).message });
    }
  }

  return (
    <div className="cover">
      <PropertyThumb name={name} url={preview} size="xl" />
      <div>
        <b style={{ fontSize: 14 }}>Property photo</b>
        <p>Shown as the property icon in the header, the property switcher and on documents. Cropped to a square.</p>
        <div className="actions">
          <label className="attach">
            <CameraIcon />
            {state.busy ? "Uploading…" : preview ? "Change photo" : "Upload photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={state.busy} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {state.error && <span className="msg err">{state.error}</span>}
          {state.ok && <span className="msg ok">{state.ok}</span>}
        </div>
      </div>
    </div>
  );
}
