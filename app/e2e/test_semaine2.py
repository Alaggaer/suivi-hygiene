from conftest import connecter, saisir, photographier, png

def page_bl(page, n=1):
    for _ in range(n):
        avant = page.locator(".liv-pages .liv-page:not(.ajout)").count()
        page.locator('.liv-pages input[type="file"]').first.set_input_files({"name": "bl.png", "mimeType": "image/png", "buffer": png()})
        page.wait_for_function(f"document.querySelectorAll('.liv-pages .liv-page:not(.ajout)').length > {avant}")

def test_livraison_conforme_verdict_automatique(page):
    connecter(page)
    page.click(".act:has-text('Livraison')")
    page.wait_for_selector("h1:has-text('Livraisons du jour')")
    assert "attendu aujourd'hui" in page.locator(".liv-four").first.inner_text(), "fournisseurs attendus en premier"
    page.click(".liv-four:has-text('Transgourmet')")
    bouton = page.locator("button.bigbtn")
    assert bouton.inner_text() == "Mesurez les températures"
    saisir(page, page.locator(".liv-temp").nth(0), "2.5")
    saisir(page, page.locator(".liv-temp").nth(1), "3")
    page.click("text=Pas de surgelés")
    assert bouton.inner_text() == "Photographiez le bon de livraison"
    page_bl(page, 2)
    assert page.locator(".liv-page:has-text('page 2')").count() == 1, "BL sur plusieurs pages"
    page.click("text=Rien à signaler")
    assert bouton.inner_text() == "Origine de la viande ?"
    page.click(".liv-viande button:text-is('Oui')")
    page.wait_for_selector(".liv-verdict.ok:has-text('Livraison conforme')")
    bouton.click()
    page.wait_for_selector(".liv-ligne:has-text('Transgourmet'):has-text('Conforme')")
    assert "BL 2 pages" in page.locator(".liv-ligne:has-text('Transgourmet')").inner_text()
    page.wait_for_selector(".tmr:has-text('Rangement · Transgourmet')")
    page.click(".liv-ligne:has-text('Transgourmet') >> text=C'est rangé")
    page.wait_for_selector(".liv-ligne:has-text('Transgourmet'):has-text('rangée à')")
    assert page.locator(".tmr").count() == 0, "le minuteur de rangement disparaît"

def test_livraison_hors_temperature_refus_partiel(page):
    connecter(page)
    page.click(".act:has-text('Livraison')")
    page.click(".liv-four:has-text('Pomona')")
    saisir(page, page.locator(".liv-temp").nth(0), "9")
    saisir(page, page.locator(".liv-temp").nth(1), "3")             # Pomona ne livre que du frais : surgelés « Aucun »
    page_bl(page)
    page.click("text=Rien à signaler")
    page.wait_for_selector(".liv-verdict.bad:has-text('température')")
    bouton = page.locator("button.bigbtn")
    assert bouton.is_disabled() and bouton.inner_text() == "Indiquez ce que vous avez fait"
    page.click(".liv-dec:has-text('Une partie refusée')")
    assert bouton.inner_text() == "Notez les produits refusés"
    page.fill(".liv-decision input.champ", "Salade, herbes fraîches")
    bouton.click()
    page.wait_for_selector(".liv-ligne:has-text('Pomona'):has-text('Refus partiel')")
    assert "refusé : Salade, herbes fraîches" in page.locator(".liv-ligne:has-text('Pomona')").inner_text()
    page.click("text=← Retour")
    page.wait_for_selector(".act .badge:text-is('2')", timeout=3000)

def test_livraison_fournisseur_sec_camion_seulement(page):
    connecter(page)
    page.click(".act:has-text('Livraison')")
    page.click(".liv-four:has-text('Cafés (sec)')")
    assert page.locator(".liv-temp.aucun").count() == 2, "fournisseur sec : frais et surgelés pré-remplis « Aucun »"
    saisir(page, page.locator(".liv-temp").nth(0), "12")   # camion non réfrigéré : hors seuil
    assert page.locator("button.bigbtn").inner_text() == "Photographiez le bon de livraison"

def test_livraison_tout_refusee_sans_rangement(page):
    connecter(page)
    page.click(".act:has-text('Livraison')")
    page.click(".liv-four:has-text('Brake')")
    assert page.locator(".liv-temp.aucun").count() == 1, "fournisseur de surgelés : « Aucun » frais pré-rempli"
    saisir(page, page.locator(".liv-temp").nth(0), "2")
    saisir(page, page.locator(".liv-temp").nth(2), "-12")
    page_bl(page)
    page.click("text=DLC trop courte")
    page.click(".liv-dec:has-text('Tout refusé')")
    assert page.locator("button.bigbtn").inner_text() == "Valider le refus"
    page.click("button.bigbtn")
    page.wait_for_selector(".liv-ligne:has-text('Brake'):has-text('rien à ranger')")
    assert page.locator(".tmr").count() == 0, "pas de minuteur de rangement quand tout est refusé"

def test_produit_utilise_photo_puis_famille(page):
    connecter(page)
    page.click(".act:has-text('Traçabilité produits')")
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
    page.click(".screen button.bigbtn:text-is('Valider le relevé')")
    page.wait_for_selector(".home")
    # la tâche est cochée tout de suite, même sans réseau
    page.wait_for_selector(".task.faite:has-text('Relevé températures du matin')", timeout=3000)
    page.wait_for_selector(".sync.warn:has-text('1 en attente')", timeout=3000)
    page.evaluate("window.__demoHorsLigne = false; window.dispatchEvent(new Event('online'))")
    page.wait_for_selector(".sync.ok:has-text('Tout est envoyé')", timeout=5000)
    page.wait_for_selector(".task.faite:has-text('Relevé températures du matin')")
