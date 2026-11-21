from conftest import connecter, saisir, photographier

def lancer_minuteur(page, type_, plat, t):
    page.click(".act:has-text('Minuteur')")
    page.click(f"button.opt.big:has-text('{type_}')")
    page.click(f"button.opt:text-is('{plat}')")
    saisir(page, page.locator("button.val"), t)
    page.click("text=Lancer le minuteur")
    page.wait_for_selector(".home")

def test_remise_en_temperature_conforme(page):
    connecter(page)
    lancer_minuteur(page, "Remise en température", "Chili", "8")
    page.click(".tmr:has-text('Remise en T° · chili')")
    for k in "70":
        page.click(f'.pad .keys button:text-is("{k}")')
    page.click(".pad button.k-ok")
    page.wait_for_selector("text=Conforme · +70 °C")
    assert page.locator(".tmr").count() == 0

def test_refroidissement_rate_cree_une_anomalie_critique(page):
    connecter(page)
    lancer_minuteur(page, "Refroidissement rapide", "Riz", "68")
    assert page.locator(".tmr:has-text('Objectif : sous +10 °C')").count() == 1
    page.click(".tmr:has-text('Refroidissement · riz')")
    for k in "15":
        page.click(f'.pad .keys button:text-is("{k}")')
    page.click(".pad button.k-ok")
    page.wait_for_selector("text=Refroidissement non conforme")
    page.click("button.opt.big:has-text('Produit jeté')")
    page.wait_for_selector("text=anomalie critique envoyée")
    page.click(".act:has-text('Anomalies du site')")
    page.wait_for_selector(".anom.g-critique:has-text('Refroidissement raté · Riz')")

def test_cycle_anomalie_equipe_puis_chef(page):
    connecter(page, "Julie", "1111")
    page.click(".act:has-text('Anomalies du site')")
    ligne = page.locator(".anom:has-text('Joint de porte')")
    ligne.locator("text=Marquer traitée").click()
    page.fill("#trait", "Joint remplacé")
    page.click("button.bigbtn.ok:has-text('Traitée')")
    page.wait_for_selector(".anom:has-text('Joint de porte') .pill:text-is('Traitée')")
    assert ligne.locator("text=Vérifiée (clôturer)").count() == 0, "Un équipier ne peut pas vérifier"
    page.click("text=Changer d'utilisateur")
    connecter(page, "Karim", "1234")
    page.click(".act:has-text('Anomalies du site')")
    page.locator(".anom:has-text('Joint de porte')").locator("text=Vérifiée (clôturer)").click()
    page.wait_for_selector("text=vérifiée et clôturée")
    page.wait_for_selector(".anom:has-text('Joint de porte')", state="detached", timeout=4000)

def test_signaler_critique_avec_photo(page):
    connecter(page)
    page.click(".act:has-text('Signaler')")
    assert page.locator("text=Envoyer").is_disabled()
    photographier(page)
    page.click("button.opt:text-is('Nuisibles')")
    page.click("text=Critique · siège prévenu tout de suite")
    page.fill("#com", "Souris derrière le four mixte")
    page.click("text=Envoyer")
    page.wait_for_selector("text=le siège est prévenu")
    page.click(".act:has-text('Anomalies du site')")
    page.wait_for_selector(".anom.g-critique:has-text('Souris derrière le four mixte')")

def test_tache_simple_cest_fait(page):
    connecter(page)
    page.click("text=Contrôle des pièges à nuisibles")
    page.click("text=C'est fait")
    page.wait_for_selector(".task.faite:has-text('Contrôle des pièges à nuisibles')", timeout=3000)
