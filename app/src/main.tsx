import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { avecCache } from "./api/cache";
import { demoApi } from "./api/demo";
import { supabaseApi } from "./api/supabase";
import { FileEnvoi } from "./hors-ligne/file";
import { stockageIndexedDB, stockageMemoire } from "./hors-ligne/stockage";
import { ToastProvider } from "./ui/outils";
import "./styles.css";

// Sans variables Supabase (ou avec ?demo dans l'adresse), l'app tourne sur le serveur simulé.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const cle = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const demo = !url || !cle || new URLSearchParams(location.search).has("demo");
const api = avecCache(demo ? demoApi : supabaseApi(url!, cle!));

// En démo, la file reste en mémoire (le serveur simulé repart de zéro à chaque chargement).
const stockage = demo || typeof indexedDB === "undefined" ? stockageMemoire() : stockageIndexedDB();
const file = new FileEnvoi(stockage, api);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App api={api} file={file} />
    </ToastProvider>
  </StrictMode>,
);
