import { useEffect, useId, useState } from "react";
import { compresserPhoto } from "../photos";

/** Prise de photo avec l'appareil de la tablette. Renvoie la photo déjà réduite. */
export function ChampPhoto({ texte, photo, onPhoto, demo }: {
  texte: string; photo: Blob | null; onPhoto: (b: Blob) => void; demo?: boolean;
}) {
  const id = useId();
  const [apercu, setApercu] = useState<string | null>(null);
  const [traitement, setTraitement] = useState(false);
  useEffect(() => {
    if (!photo) { setApercu(null); return; }
    const u = URL.createObjectURL(photo);
    setApercu(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);

  async function choisir(f: File | undefined) {
    if (!f) return;
    setTraitement(true);
    try { onPhoto(await compresserPhoto(f)); } finally { setTraitement(false); }
  }
  async function simuler() {
    // Mode démo sur ordinateur : une image générée tient lieu de photo.
    const c = document.createElement("canvas"); c.width = 320; c.height = 240;
    const g = c.getContext("2d")!; g.fillStyle = "#dfe5ea"; g.fillRect(0, 0, 320, 240);
    g.fillStyle = "#14202b"; g.font = "28px sans-serif"; g.fillText("Photo de démo", 60, 130);
    c.toBlob((b) => b && onPhoto(b), "image/webp", 0.7);
  }

  return (
    <div className={`photo ${photo ? "done" : ""}`}>
      <div className="shot" style={apercu ? { backgroundImage: `url(${apercu})` } : undefined}>{photo ? "" : "aucune"}</div>
      <div style={{ flex: 1 }}>
        <b>{texte}</b>
        <div className="hint">{traitement ? "Préparation de la photo…" : photo ? "Photo prise. Vous pouvez la refaire." : "Ouvre l'appareil photo de la tablette."}</div>
      </div>
      <label htmlFor={id}>{photo ? "Reprendre" : "Prendre la photo"}
        <input id={id} type="file" accept="image/*" capture="environment" onChange={(e) => { void choisir(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {demo && <button type="button" className="sim" onClick={simuler}>Simuler</button>}
    </div>
  );
}
