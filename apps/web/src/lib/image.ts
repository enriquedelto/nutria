"use client";

export type B64Image = { mediaType: "image/jpeg"; data: string; preview: string };

/** Downscale to `max` px on the long side and re-encode as JPEG (keeps AI payloads small). */
export async function fileToJpeg(file: Blob, max = 1568, quality = 0.82): Promise<B64Image> {
  const bmp = await createImageBitmap(file).catch(async () => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    return img;
  });
  const w = "width" in bmp ? bmp.width : 0;
  const h = "height" in bmp ? bmp.height : 0;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(bmp as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  const preview = canvas.toDataURL("image/jpeg", quality);
  return { mediaType: "image/jpeg", data: preview.split(",")[1]!, preview };
}

export async function fileToBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
