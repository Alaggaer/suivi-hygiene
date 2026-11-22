"""Revue lot 3 : saisie gardée après inactivité, réponse huile effacée quand la mesure change."""
from conftest import URL, connecter, saisir


def test_saisie_gardee_apres_inactivite(page):
    page.clock.install()
    page.goto(URL)
    connecter(page)
    page.click("text=Relevé températures du matin")
    saisir(page, page.locator("button.val").nth(0), "2")
    page.clock.fast_forward("02:05")
    page.wait_for_selector("text=Saisie en cours de Karim")
    # Même personne : la saisie revient telle quelle.
    for k in "1234":
        page.click(f'.login .keys button:text-is("{k}")')
    page.wait_for_selector("button.val.filled")
    assert page.locator("button.val").nth(0).inner_text() == "+2 °C"


def test_autre_personne_repart_de_l_accueil(page):
    page.clock.install()
    page.goto(URL)
    connecter(page)
    page.click("text=Relevé températures du matin")
    page.clock.fast_forward("02:05")
    page.wait_for_selector("text=Saisie en cours de Karim")
    page.click('.users button:has-text("Julie")')
    for k in "1111":
        page.click(f'.login .keys button:text-is("{k}")')
    page.wait_for_selector(".home")


def test_huile_reponse_effacee_si_la_mesure_change(page):
    connecter(page)
    page.click("text=Mesure de l'huile")
    page.wait_for_selector("text=huile : jour 6/14")
    ligne = page.locator(".row").filter(has_text="huile : jour 6/14")
    saisir(page, ligne.locator("button.val"), "27")
    ligne.locator("text=Je change avant le service").click()
    saisir(page, ligne.locator("button.val"), "12")
    assert ligne.locator("button.opt.sel").count() == 0, "réponse donnée pour 27 % effacée après correction à 12 %"
