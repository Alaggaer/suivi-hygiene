import re

def ouvrir(page):
    page.clock.set_fixed_time("2026-11-20T15:40:00+01:00")
    page.goto("http://localhost:4173/#siege")
    page.wait_for_selector(".s3-carte")
    page.click("button.s3-retour:has-text('Gestion')")
    page.wait_for_selector(".g-item.sel")

def test_employe_et_pin_affiche_une_fois(page):
    ouvrir(page)
    page.wait_for_selector(".g-table td:has-text('Karim')")
    page.fill("input[aria-label='Nom du nouvel employé']", "Nora Benali")
    page.select_option("select[aria-label='Rôle']", "chef")
    page.click(".g-ajout button:has-text('Ajouter')")
    code = page.locator(".g-pin-code").inner_text()
    assert re.fullmatch(r"\d{4}", code), code
    page.wait_for_selector(".g-table td:has-text('Nora Benali')")
    page.click(".g-pin button:has-text(\"C'est noté\")")
    assert page.locator(".g-pin").count() == 0, "le code disparaît une fois noté"
    ligne = page.locator(".g-table tr:has-text('Nora Benali')")
    ligne.locator("button:has-text('Nouveau code')").click()
    page.wait_for_selector(".g-pin-code")
    page.click(".g-pin button:has-text(\"C'est noté\")")
    ligne.locator("button:has-text('Désactiver')").click()
    page.wait_for_selector(".g-table tr.inactif:has-text('Nora Benali')")
    assert ligne.locator("button:has-text('Nouveau code')").count() == 0

def test_enceinte_temperature_et_friteuse(page):
    ouvrir(page)
    page.click(".g-onglets button:has-text('Enceintes')")
    ligne = page.locator(".g-table tbody tr").nth(2)
    ligne.locator("input[aria-label='Température maximale']").fill("5")
    ligne.locator("button:has-text('Enregistrer')").click()
    page.wait_for_selector(".pill.ok:has-text('Enregistré')")
    assert ligne.locator("button:has-text('Enregistrer')").count() == 0
    page.click("button:has-text('+ Ajouter une enceinte')")
    nouvelle = page.locator(".g-table tbody tr").last
    assert nouvelle.locator("button:has-text('Enregistrer')").is_disabled(), "nom obligatoire"
    nouvelle.locator("input[aria-label='Nom']").fill("Saladette")
    nouvelle.locator("button:has-text('Enregistrer')").click()
    page.wait_for_selector(".g-table tbody tr:last-child input[value='Saladette']")
    page.click(".g-onglets button:has-text('Friteuses')")
    page.click("button:has-text('+ Ajouter une friteuse')")
    f = page.locator(".g-table tbody tr").last
    assert f.locator("button:has-text('Enregistrer')").is_disabled(), "capacité obligatoire"
    f.locator("input[aria-label='Capacité en litres']").fill("18")
    f.locator("button:has-text('Enregistrer')").click()
    page.wait_for_selector(".pill.ok")

def test_tablette_et_nouveau_restaurant(page):
    ouvrir(page)
    page.click(".g-onglets button:has-text('Tablette')")
    bouton = page.locator("button:has-text('Créer le compte')")
    page.fill("input[aria-label='Mot de passe']", "court")
    assert bouton.is_disabled(), "10 caractères au moins"
    page.fill("input[aria-label='Mot de passe']", "un-mot-de-passe-long")
    bouton.click()
    page.wait_for_selector(".g-tablette:has-text('@hollysdiner.fr')")
    assert page.locator(".g-tablette").inner_text().count("jamais activée") == 1
    page.click(".g-item.ajout")
    page.fill(".g-form label:has-text('Nom') input", "Seattle")
    page.fill(".g-form label:has-text('Ville') input", "Lyon")
    page.click("button:has-text('Créer le restaurant')")
    page.wait_for_selector(".g-item.sel:has-text('SEATTLE')")
    page.wait_for_selector(".g-contenu h2:has-text('SEATTLE')")

def test_fournisseurs(page):
    ouvrir(page)
    page.click(".g-item:has-text('Fournisseurs')")
    ligne = page.locator(".g-table tr:has(input[value='SYSCO'])")
    ligne.locator(".g-jour:has-text('mar')").click()
    ligne.locator("button:has-text('Enregistrer')").click()
    page.wait_for_selector(".pill.ok")
    assert page.locator(".g-table tr:has(input[value='SYSCO']) .g-jour.sel:has-text('mar')").count() == 1
