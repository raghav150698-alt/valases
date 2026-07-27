const MAX_LOGO_BYTES = 256 * 1024;
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function readCompanyLogo(file: File): Promise<string> {
  if (!ALLOWED_LOGO_TYPES.has(file.type)) throw new Error("Use a PNG, JPEG, or WebP image.");
  if (file.size > MAX_LOGO_BYTES) throw new Error("Logo must be smaller than 256 KB.");
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The logo could not be read."));
    reader.readAsDataURL(file);
  });
}
