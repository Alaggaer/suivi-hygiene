from conftest import connecter, saisir

def test_mauvais_pin_refuse(page):
    page.click('.users button:has-text("Julie")')
    for k in "9999":
        page.click(f'.login .keys button:text-is("{k}")')
    page.wait_for_selector("text=Code incorrect")
    assert page.locator(".home").count() == 0

def test_releve_avec_hors_seuil(page):
    connecter(page)
    page.click("text=Relevé températures du matin")
    vals = ["2", "-20", "4", "6", "3", "-19"]
    for i, v in enumerate(vals):
        saisir(page, page.locator("button.val").nth(i), v)
    valider = page.locator(".screen button.bigbtn")
    assert valider.is_disabled(), "Hors seuil sans action corrective : validation impossible"
    assert "Encore 1 enceinte" in valider.inner_text()
    page.click("text=Thermostat réglé")
    assert valider.inner_text() == "Valider le relevé"
    valider.click()
    page.wait_for_selector(".home")
    assert "1 anomalie" in page.locator("#toast").inner_text()
    page.wait_for_selector(".task.faite:has-text('Relevé températures du matin')", timeout=3000)

def test_huile_rouge_exige_une_decision(page):
    connecter(page)
    page.click("text=Mesure de l'huile")
    saisir(page, page.locator("button.val").nth(0), "12")
    saisir(page, page.locator("button.val").nth(1), "26")
    assert page.locator(".pill.bad:has-text('Interdite')").count() == 1
    assert page.locator("text=Valider la mesure").is_disabled()
    page.click("text=Huile changée (25 L) >> nth=1")
    page.click("text=Valider la mesure")
    page.wait_for_selector(".home")
    page.wait_for_selector(".task.faite:has-text(\"Mesure de l'huile\")", timeout=3000)

def test_enceinte_hors_service(page):
    connecter(page)
    page.click("text=Relevé températures du matin")
    page.locator("text=Enceinte hors service ?").nth(1).click()
    vals = {0: "2", 2: "4", 3: "3", 4: "3", 5: "-19"}
    boutons = page.locator("button.val")
    assert boutons.count() == 5, "l'enceinte hors service n'a plus de case à remplir"
    for i, v in enumerate(vals.values()):
        saisir(page, boutons.nth(i), v)
    page.click(".screen button.bigbtn:text-is('Valider le relevé')")
    page.wait_for_selector(".home")
    assert "1 anomalie" in page.locator("#toast").inner_text()
    page.click(".act:has-text('Anomalies du site')")
    page.wait_for_selector(".anom:has-text('Chambre froide négative hors service')")
