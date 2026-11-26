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
    assert [t.split(" · ")[0] for t in page.locator(".liv-temp span").all_inner_texts()] == ["Camion", "Produits laitiers", "Viande", "Surgelés"], \
        "une température par famille livrée"
    saisir(page, page.locator(".liv-temp").nth(0), "2.5")
    saisir(page, page.locator(".liv-temp").nth(1), "3")      # laitiers 0/+4
    saisir(page, page.locator(".liv-temp").nth(2), "2.5")    # viande 0/+3
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
    # Plus de suivi du rangement (demande du chef exécutif) : ni chrono, ni « C'est rangé ».
    assert page.locator(".tmr").count() == 0, "aucun chrono de rangement"
    assert page.locator("text=C'est rangé").count() == 0

def test_livraison_hors_temperature_refus_partiel(page):
    connecter(page)
    page.click(".act:has-text('Livraison')")
    page.click(".liv-four:has-text('Pomona')")
    saisir(page, page.locator(".liv-temp").nth(0), "9")
    saisir(page, page.locator(".liv-temp").nth(1), "6")             # légumes à +6 °C : conforme (seuil +8) ; surgelés « Aucun »
    assert "ok" in page.locator(".liv-temp").nth(1).get_attribute("class"), "légumes à +6 °C dans la plage +1/+8"
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
    page.wait_for_selector(".act:has-text('Anomalies du site') .badge:text-is('3')", timeout=5000)   # 2 en démo + celle de la livraison

def test_livraison_fournisseur_sec_camion_seulement(page):
    connecter(page)
    page.click(".act:has-text('Livraison')")
    page.click(".liv-four:has-text('Cafés (sec)')")
    assert page.locator(".liv-temp").count() == 2 and page.locator(".liv-temp.aucun").count() == 1, "fournisseur sec : pas de frais, surgelés « Aucun »"
    saisir(page, page.locator(".liv-temp").nth(0), "12")   # camion non réfrigéré : hors seuil
    assert page.locator("button.bigbtn").inner_text() == "Photographiez le bon de livraison"

def test_livraison_tout_refusee(page):
    connecter(page)
    page.click(".act:has-text('Livraison')")
    page.click(".liv-four:has-text('Brake')")
    assert page.locator(".liv-temp").count() == 2, "fournisseur de surgelés : camion et surgelés seulement"
    saisir(page, page.locator(".liv-temp").nth(0), "2")
    saisir(page, page.locator(".liv-temp").nth(1), "-12")
    page_bl(page)
    page.click("text=DLC trop courte")
    page.click(".liv-dec:has-text('Tout refusé')")
    assert page.locator("button.bigbtn").inner_text() == "Valider le refus"
    page.click("button.bigbtn")
    page.wait_for_selector(".liv-ligne:has-text('Brake'):has-text('Tout refusé')")
    assert page.locator(".tmr").count() == 0

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


def test_livraison_poisson_seuil_strict(page):
    """Classeur du groupe : poisson 0/+2 °C. À +3 °C (accepté avant avec le seuil unique +4), la livraison est non conforme."""
    connecter(page)
    page.click(".act:has-text('Livraison')")
    page.click(".liv-four:has-text('Marée du port')")
    saisir(page, page.locator(".liv-temp").nth(0), "2")
    saisir(page, page.locator(".liv-temp").nth(1), "3")
    assert "bad" in page.locator(".liv-temp").nth(1).get_attribute("class")
    page_bl(page)
    page.click("text=Rien à signaler")
    page.wait_for_selector(".liv-verdict.bad")
