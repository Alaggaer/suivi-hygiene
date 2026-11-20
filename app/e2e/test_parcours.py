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
    valider = page.locator("text=Valider le relevé")
    assert valider.is_disabled(), "Hors seuil sans action corrective : validation impossible"
    page.click("text=Thermostat réglé")
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
