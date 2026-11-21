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
    """Démo : F1 jour 6, F2 jour 13, F3 au 15e jour (au-delà de 14 j), F4 jour 3."""
    connecter(page)
    page.click("text=Mesure de l'huile")
    page.wait_for_selector("text=huile : jour 15/14")
    saisir(page, page.locator("button.val").nth(0), "12")
    saisir(page, page.locator("button.val").nth(1), "26")
    saisir(page, page.locator("button.val").nth(2), "10")
    assert page.locator(".pill.bad:has-text('Interdite')").count() == 1
    assert page.locator("text=huile utilisée depuis 15 jours").count() == 1, "F3 : changement imposé par l'âge malgré 10 %"
    bouton = page.locator("button.bigbtn")
    assert bouton.is_disabled() and "filtrée ou changée" in bouton.inner_text()
    page.click("text=Huile changée (25 L) >> nth=1")         # F2 (la 1re est F1)
    assert page.locator("button:text-is('Huile filtrée')").count() == 1, "« filtrée » impossible quand le changement est obligatoire"
    page.click("text=Je change avant le service >> nth=1")   # F3 (la 1re est F2)
    page.click("text=Non utilisée aujourd'hui ?")
    assert bouton.is_disabled(), "F1 mesurée sans réponse filtrée / changée"
    page.click("button:text-is('Huile filtrée')")                          # F1
    assert bouton.inner_text() == "Valider la mesure"
    bouton.click()
    page.wait_for_selector(".home")
    page.wait_for_selector(".task.faite:has-text(\"Mesure de l'huile\")", timeout=3000)

def test_huile_friteuses_en_plusieurs_fois(page):
    connecter(page)
    page.click("text=Mesure de l'huile")
    saisir(page, page.locator("button.val").nth(0), "10")
    bouton = page.locator("button.bigbtn")
    assert bouton.is_disabled()
    page.click("button:text-is('Huile filtrée')")
    assert "3 friteuses restera à faire" in bouton.inner_text()
    bouton.click()
    page.wait_for_selector(".home")
    assert "reste à faire : Friteuse 2, Friteuse 3, Friteuse 4" in page.locator("#toast").inner_text()
    assert page.locator(".task.faite:has-text(\"Mesure de l'huile\")").count() == 0, "tâche encore ouverte"
    page.click("text=Mesure de l'huile")
    page.wait_for_selector(".row.fait:has-text('Friteuse 1')")
    assert page.locator("button.val").count() == 3, "la friteuse déjà faite n'est plus redemandée"
    page.locator("text=Non utilisée aujourd'hui ?").nth(0).click()   # F2 éteinte
    saisir(page, page.locator("button.val").nth(0), "11")            # F3 (15e jour)
    page.click("text=Huile changée (25 L)")
    saisir(page, page.locator("button.val").nth(1), "9")             # F4
    page.click("button:text-is('Huile filtrée')")
    bouton.click()
    page.wait_for_selector(".home")
    page.wait_for_selector(".task.faite:has-text(\"Mesure de l'huile\")", timeout=3000)
    page.click("text=Mesure de l'huile")
    page.wait_for_selector("text=Toutes les friteuses sont faites pour aujourd'hui.")
    assert page.locator(".row.fait:has-text('Non utilisée aujourd')").count() == 1
    assert page.locator(".row.fait:has-text('jour 1/14')").count() == 1, "F3 : nouvelle huile, compteur remis à 1"

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

def test_valeurs_impossibles_refusees(page):
    connecter(page)
    page.click("text=Relevé températures du matin")
    page.wait_for_selector("button.val")
    rangee = page.locator(".row:has-text('Maximum +')").first
    rangee.locator("button.val").click()
    for k in "4":
        page.click(f'.pad .keys button:text-is("{k}")')
    page.click('.pad button[aria-label="Changer le signe"]')
    page.wait_for_selector(".pave-erreur")
    assert "enceinte positive" in page.locator(".pave-erreur").inner_text()
    assert page.locator(".pad .k-ok").is_disabled()
    page.click('.pad button[aria-label="Changer le signe"]')          # +4 : accepté
    assert page.locator(".pave-erreur").count() == 0
    assert not page.locator(".pad .k-ok").is_disabled()
