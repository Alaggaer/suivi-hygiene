from conftest import connecter, photographier

def test_tablette_coche_les_elements_et_termine(page):
    connecter(page)
    page.click(".task:has-text('Nettoyage cuisine')")
    page.wait_for_selector("h1:has-text('Nettoyage cuisine')")
    assert "2 éléments sur 3 à faire" in page.locator(".screen").inner_text()
    deja = page.locator(".pn-el:has-text('Plans de travail et surfaces')")
    assert "Julie" in deja.locator(".pn-ok").inner_text()
    # Fiche de sécurité du produit, depuis la ligne
    page.locator(".pn-el:has-text('Plans de travail') .pn-fiche:text-is('FDS')").click()
    page.wait_for_selector(".visionneuse img")
    page.click(".visionneuse")
    plaque = page.locator(".pn-el:has-text('Plaque de cuisson et grill')")
    assert plaque.locator("button:has-text('Photo et fait')").count() == 1, "photo obligatoire"
    page.locator(".pn-el:has-text('Sol de la cuisine') button:text-is('Fait')").click()
    page.wait_for_selector(".pn-el.fait:has-text('Sol de la cuisine')")
    plaque.locator("button:has-text('Photo et fait')").click()
    valider = plaque.locator("button:has-text('Prenez la photo')")
    assert valider.is_disabled()
    photographier(page)
    plaque.locator("button:has-text('Valider')").click()
    page.wait_for_selector(".home")
    page.wait_for_selector(".task.faite:has-text('Nettoyage cuisine')", timeout=5000)

def test_fiches_produits_depuis_accueil(page):
    connecter(page)
    page.click(".act:has-text(\"Produits d'entretien\")")
    page.wait_for_selector("h1:has-text(\"Produits d'entretien\")")
    page.wait_for_selector(".pn-el")
    assert page.locator(".pn-el").count() == 3
    assert "Fiches pas encore déposées" in page.locator(".pn-el:has-text('Désinfectant sanitaires')").inner_text()
    page.locator(".pn-el:has-text('Dégraissant cuisine') .pn-fiche:text-is('FDS')").click()
    page.wait_for_selector(".visionneuse img")

def test_siege_suivi_plan_produits(page):
    page.goto("http://localhost:4173/#siege")
    page.wait_for_selector(".s3-carte")
    page.click("button.s3-retour:has-text('Nettoyage')")
    page.wait_for_selector(".pn-suivi")
    assert "1/4" in page.locator(".pn-suivi tr:has-text('DALLAS')").inner_text()
    atlanta = page.locator(".pn-suivi tr:has-text('ATLANTA')").inner_text()
    assert "3/4" in atlanta and "Cuisine" in atlanta and "3/3" in atlanta
    page.locator(".pn-suivi tr:has-text('ATLANTA') .lien:text-is('photo')").click()
    page.wait_for_selector(".visionneuse img")
    page.click(".visionneuse")

    page.click("button[role=tab]:has-text('Plan')")
    page.wait_for_selector(".pn-bloc-zone h3:has-text('Cuisine')")
    assert "chaque vendredi" in page.locator("tr:has-text('Hotte et filtres')").inner_text()
    page.click("text=+ Ajouter un élément")
    enr = page.locator(".pn-form button.s3-verifier")
    assert enr.inner_text() == "Élément à nettoyer"
    page.fill(".pn-form input[placeholder^='Ex. Hotte']", "Machine à glaçons")
    page.click(".pn-form button:has-text('Chaque mois')")
    page.fill(".pn-form label:has-text('Jour du mois') input", "40")
    assert page.locator(".pn-form label:has-text('Jour du mois') input").input_value() == "28"
    page.check(".pn-form label:has-text('Photo obligatoire') input")
    enr.click()
    page.wait_for_selector("tr:has-text('Machine à glaçons'):has-text('le 28 du mois')")

    page.click("button[role=tab]:has-text(\"Produits d'entretien\")")
    page.wait_for_selector(".pn-prod")
    prod = page.locator(".pn-prod:has(input[value='Désinfectant sanitaires'])")
    assert prod.locator(".pill.bad:has-text('manquante')").count() == 2
    prod.locator("input[aria-label='FDS de Désinfectant sanitaires']").set_input_files(files=[{"name": "fds.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4"}])
    page.wait_for_selector(".pill.ok:has-text('FDS déposée')")
    assert page.locator(".pn-prod:has(input[value='Désinfectant sanitaires']) .pill.bad").count() == 1
