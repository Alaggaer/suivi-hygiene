// Mise à jour de l'app sur une tablette restée ouverte en permanence.
// Le service worker installe la nouvelle version en arrière-plan ; on ne recharge la page qu'à un moment
// sans risque (écran « Qui êtes-vous ? », donc aucune saisie en cours). La file d'envoi est en IndexedDB : rien n'est perdu.
let prete = false;

export function surveillerMisesAJour(intervalleMs = 20 * 60 * 1000) {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  const avaitUnControleur = !!sw.controller;
  sw.addEventListener("controllerchange", () => { if (avaitUnControleur) prete = true; });
  setInterval(() => { sw.getRegistration().then((r) => r?.update()).catch(() => {}); }, intervalleMs);
}

/** Recharge si une nouvelle version est installée. À n'appeler que lorsqu'aucune saisie n'est ouverte. */
export function appliquerMiseAJour(): boolean {
  if (!prete) return false;
  prete = false;
  location.reload();
  return true;
}
