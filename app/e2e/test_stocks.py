from conftest import connecter, photographier

def test_tablette_verifie_un_stock_mort(page):
    connecter(page)
    page.wait_for_selector(".act:has-text('Stocks morts') .badge:text-is('1')")
    page.click(".act:has-text('Stocks morts')")
    page.wait_for_selector("h2:has-text('À vérifier (1)')")
    assert "Consigne du siège" in page.locator(".sm-carte").first.inner_text()
    page.click(".sm-carte:has-text('Sauce cheddar')")
    bouton = page.locator("button.bigbtn")
    assert bouton.inner_text() == "Il vous en reste ?"
    page.click("text=Oui, il en reste")
    assert bouton.inner_text() == "Indiquez la quantité"
    page.fill("input[placeholder^='Ex. 3 cartons']", "2 bidons")
    assert bouton.inner_text() == "Photographiez le produit"
    photographier(page)
    page.click(".liv-dec:has-text('Transféré')")
    assert bouton.inner_text() == "Vers quel restaurant ?"
    page.click(".liv-dec:has-text('À écouler')")
    bouton.click()
    page.wait_for_selector(".sm-carte:has-text('À écouler · 2 bidons')")
    page.click("text=← Retour")
    page.wait_for_selector(".home")
    page.wait_for_selector(".act:has-text('Stocks morts') .badge", state="detached", timeout=5000)

def test_siege_declare_et_suit(page):
    page.goto("http://localhost:4173/#siege")
    page.wait_for_selector(".s3-carte")
    page.click("button:has-text('Stocks morts')")
    page.wait_for_selector("h1:has-text('Stocks morts')")
    envoyer = page.locator("text=Envoyer à tous les restaurants")
    assert envoyer.is_disabled()
    page.fill("input[placeholder^='Ex. Sauce cheddar']", "Pain brioché XL")
    page.fill("input[placeholder^='Ex. à écouler']", "À jeter")
    envoyer.click()
    page.wait_for_selector(".sm-produit:has-text('Pain brioché XL'):has-text('15 à vérifier')")
    sauce = page.locator(".sm-produit:has-text('Sauce cheddar')")
    assert "1 à écouler" in sauce.inner_text() and "1 soldé" in sauce.inner_text()
    sauce.locator("text=Détail par restaurant").click()
    assert "2 bidons" in sauce.locator("tr:has-text('ATLANTA')").inner_text()
    sauce.locator("text=Clore ce produit").click()
    sauce.locator("text=Confirmer la clôture").click()
    page.wait_for_selector(".sm-produit.clos:has-text('Sauce cheddar')")
