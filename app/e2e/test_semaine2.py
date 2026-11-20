from conftest import connecter, saisir, photographier

def test_livraison_non_conforme_lance_le_minuteur_de_rangement(page):
    connecter(page)
    page.click(".act:has-text('Livraison')")
    page.click("button.opt.big:has-text('Pomona')")
    saisir(page, page.locator("button.val").nth(0), "6")     # camion hors seuil
    saisir(page, page.locator("button.val").nth(1), "3")
    page.click("text=Suivant")
    assert page.locator("text=Suivant").is_disabled(), "Photo du BL obligatoire"
    photographier(page)
    page.click(".card button.opt:text-is('Oui')")             # viande
    page.click("text=Non, elle manque")                       # origine absente
    page.click("text=Suivant")
    assert page.locator("text=Une température est hors seuil").count() == 1
    page.click("button.bigbtn.bad:has-text('Non')")
    assert page.locator("button.opt.sel:has-text('Température')").count() == 1, "Motif température pré-sélectionné"
    page.click("text=Accepté sous réserve")
    page.click("text=Enregistrer la livraison")
    page.wait_for_selector(".home")
    page.wait_for_selector(".tmr:has-text('Rangement · Pomona')")
    # 2 anomalies : livraison non conforme + origine absente
    page.wait_for_selector(".act .badge:text-is('3')", timeout=3000)
    page.click(".tmr:has-text('Rangement · Pomona')")
    page.wait_for_selector("text=Livraison rangée")
    assert page.locator(".tmr").count() == 0

def test_produit_utilise_photo_puis_famille(page):
    connecter(page)
    page.click(".act:has-text('Produit utilisé')")
    assert page.locator("button.opt.big:has-text('Viande')").is_disabled()
    photographier(page)
    page.click("button.opt.big:has-text('Viande')")
    page.wait_for_selector("text=Viande enregistré")
    assert page.locator(".photo.done").count() == 0, "Prêt pour le produit suivant"
    page.wait_for_selector("text=1 produit photographié")
    photographier(page)
    page.click("button.opt.big:has-text('Poisson')")
    page.wait_for_selector("text=2 produits photographiés")

def test_hors_ligne_puis_retour_du_reseau(page):
    connecter(page)
    page.evaluate("window.__demoHorsLigne = true")
    page.click("text=Relevé températures du matin")
    for i, v in enumerate(["2", "-20", "4", "3", "3", "-19"]):
        saisir(page, page.locator("button.val").nth(i), v)
    page.click("text=Valider le relevé")
    page.wait_for_selector(".home")
    # la tâche est cochée tout de suite, même sans réseau
    page.wait_for_selector(".task.faite:has-text('Relevé températures du matin')", timeout=3000)
    page.wait_for_selector(".sync.warn:has-text('1 en attente')", timeout=3000)
    page.evaluate("window.__demoHorsLigne = false; window.dispatchEvent(new Event('online'))")
    page.wait_for_selector(".sync.ok:has-text('Tout est envoyé')", timeout=5000)
    page.wait_for_selector(".task.faite:has-text('Relevé températures du matin')")
