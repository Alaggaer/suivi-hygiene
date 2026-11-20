/**
 * Réduit une photo prise par la tablette avant de la garder : 1280 px de côté max, WebP qualité 0,7
 * (≈ 100-150 Ko au lieu de 3-5 Mo). C'est ce qui garde le coût de stockage bas.
 */
export const COTE_MAX = 1280;

export function dimensions(l: number, h: number, max = COTE_MAX): { l: number; h: number } {
  const r = Math.min(1, max / Math.max(l, h));
  return { l: Math.round(l * r), h: Math.round(h * r) };
}

export async function compresserPhoto(fichier: Blob): Promise<Blob> {
  try {
    const img = await createImageBitmap(fichier);
    const { l, h } = dimensions(img.width, img.height);
    const canvas = document.createElement("canvas");
    canvas.width = l; canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, l, h);
    img.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.7));
    // Certains navigateurs ignorent WebP et renvoient du PNG plus lourd : on garde alors le plus léger.
    return blob && blob.size < fichier.size ? blob : fichier;
  } catch {
    return fichier; // format non décodable : on garde l'original plutôt que de perdre la preuve
  }
}
