import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { demoApi } from "./api/demo";
import { supabaseApi } from "./api/supabase";
import { ToastProvider } from "./ui/outils";
import "./styles.css";

// Sans variables Supabase (ou avec ?demo dans l'adresse), l'app tourne sur le serveur simulé.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const cle = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const demo = !url || !cle || new URLSearchParams(location.search).has("demo");
const api = demo ? demoApi : supabaseApi(url!, cle!);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App api={api} />
    </ToastProvider>
  </StrictMode>,
);
