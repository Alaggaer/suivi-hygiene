import { useState } from "react";
import { nouvelId, useContexte, useEnregistrer } from "../contexte";
import { cheminPhoto, service } from "../logique";
import { ChampPhoto } from "../ui/Photo";
import { useToast } from "../ui/outils";

const FAMILLES = ["Viande", "Poisson", "Produit laitier", "Œufs", "Fruits et légumes", "Autre"];

/** Traçabilité produits : 1. photo de l'étiquette, 2. un tap sur la famille → c'est enregistré. */
const cleJour = () => `suivi-hygiene:produits:${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(Date.now())}`;
function lireCompte(): number { try { return Number(localStorage.getItem(cleJour()) || 0); } catch { return 0; } }

export function Produit({ onFini }: { onFini: () => void }) {
  const { api, site } = useContexte();
  const enregistrer = useEnregistrer();
  const toast = useToast();
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [compte, setCompte] = useState(lireCompte);
  const srv = service(Date.now());

  async function choisir(famille: string) {
    if (!photo || envoi) return;
    setEnvoi(true);
    try {
      const maintenant = Date.now();
      const chemin = cheminPhoto(site.id, nouvelId(), maintenant);
      await enregistrer({ type: "utilisation", id: nouvelId(), photo: chemin, famille, service: service(maintenant) }, [{ chemin, blob: photo }]);
      toast(`${famille} enregistré · service du ${service(maintenant)}`);
      setPhoto(null);
      setCompte((c) => { try { localStorage.setItem(cleJour(), String(c + 1)); } catch { /* ignoré */ } return c + 1; });
    } catch (e) { toast(`Échec : ${(e as Error).message}`); } finally { setEnvoi(false); }
  }

  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Terminé</button>
      <h1>Traçabilité produits</h1>
      <p className="hint">1. Photo de l'étiquette (lot et DLC lisibles). 2. Touchez la famille : c'est enregistré pour le service du {srv}. Vous pouvez enchaîner les produits.</p>
      <ChampPhoto texte="Photo de l'étiquette" photo={photo} onPhoto={setPhoto} demo={api.mode === "demo"} />
      <div className="opts">
        {FAMILLES.map((f) => <button key={f} className="opt big" disabled={!photo || envoi} style={!photo ? { opacity: 0.45 } : undefined} onClick={() => choisir(f)}>{f}</button>)}
      </div>
      <p className="kpi">{compte} produit{compte > 1 ? "s" : ""} photographié{compte > 1 ? "s" : ""} aujourd'hui sur cette tablette.</p>
    </div>
  );
}
