def test_tableau_du_siege(page):
    page.goto("http://localhost:4173/#siege")
    page.wait_for_selector("text=Tableau de bord du groupe")
    lignes = page.locator(".tbl tbody tr.clic")
    assert lignes.count() == 15, "un rang par restaurant"
    page.click("button.opt:text-is('30 jours')")
    page.wait_for_selector(".tbl tbody tr.clic")
    lignes.first.click()
    page.wait_for_selector("tr.detail >> text=Tâches échues sur la période")
    assert page.locator("text=Boucherie (viandes)").count() == 1

def test_siege_traite_et_verifie_une_anomalie(page):
    page.goto("http://localhost:4173/#siege")
    page.wait_for_selector("text=Tableau de bord du groupe")
    page.wait_for_selector("button[role=tab]:has-text('Anomalies') .compte:text-is('3')")
    page.click("button[role=tab]:has-text('Anomalies')")
    page.wait_for_selector("text=À traiter (2)")
    assert "DALLAS" in page.locator(".carte").first.inner_text(), "la critique d'abord"
    page.locator(".carte").first.locator("input").fill("Frigoriste passé, porte réparée")
    page.locator(".carte").first.locator("text=Marquer traitée").click()
    page.wait_for_selector("text=À traiter (1)")
    page.click("text=À vérifier (2)")
    carte = page.locator(".carte:has-text('DALLAS')")
    assert "Frigoriste passé" in carte.inner_text()
    carte.locator("text=Vérifier et clore").click()
    page.wait_for_selector("text=Vérifiées · 7 jours (2)")
    page.wait_for_selector("button[role=tab]:has-text('Anomalies') .compte:text-is('2')")

def test_siege_preuves_du_jour(page):
    page.goto("http://localhost:4173/#siege")
    page.wait_for_selector(".tbl tbody tr.clic")
    page.locator(".tbl tbody tr.clic").first.click()
    page.click("text=Voir les preuves du jour de ce restaurant")
    page.wait_for_selector("h3:text-is('Relevés de températures')")
    for titre in ["Tâches du jour", "Huile", "Livraisons", "Traçabilité produits", "Anomalies signalées ce jour"]:
        assert page.locator(f"h3:text-is('{titre}')").count() == 1, titre
    assert page.locator("text=non faite").count() >= 1
    assert page.locator("text=non utilisée").count() == 1
    page.click("text=Bon de livraison >> nth=0")
    page.wait_for_selector(".visionneuse img")
    page.click(".visionneuse")
    assert page.locator(".visionneuse").count() == 0
