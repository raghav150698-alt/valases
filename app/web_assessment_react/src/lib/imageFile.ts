const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(source);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error("The image could not be read."));
    };
    image.src = source;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("The image could not be prepared.")),
      "image/webp",
      quality,
    );
  });
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The image could not be prepared."));
    reader.readAsDataURL(blob);
  });
}

async function readImage(file: File, maxDimension: number): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error("Use a PNG, JPEG, or WebP image.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Choose an image smaller than 12 MB.");
  const image = await loadImage(file);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is not available in this browser.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.9, 0.82, 0.72, 0.62]) {
    const blob = await canvasBlob(canvas, quality);
    if (blob.size <= MAX_IMAGE_BYTES) return blobDataUrl(blob);
  }
  throw new Error("The image is too detailed. Choose a simpler image or a smaller crop.");
}

export function readCompanyLogo(file: File): Promise<string> {
  return readImage(file, 640);
}

export function readProfileImage(file: File): Promise<string> {
  return readImage(file, 512);
}
