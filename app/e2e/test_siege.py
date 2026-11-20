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
