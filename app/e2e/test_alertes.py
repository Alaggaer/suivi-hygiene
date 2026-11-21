from conftest import connecter, photographier

def test_tablette_retrait_un_lot_puis_prolongation_deja_faite(page):
    connecter(page)
    bandeau = page.locator(".al-bandeau")
    bandeau.first.wait_for()
    assert bandeau.count() == 1, "seule l'alerte sans réponse s'affiche en bandeau"
    assert "Retrait produit : Cheddar tranché" in bandeau.inner_text()
    assert page.locator(".act:has-text('Alertes produit') .badge").inner_text() == "1"
    bandeau.click()
    page.wait_for_selector("h2:has-text('À vérifier (1)')")
    page.click(".sm-carte:has-text('Cheddar tranché')")
    page.click("text=Voir le document du fournisseur")
    page.wait_for_selector(".visionneuse img")
    page.click(".visionneuse")
    page.click("text=J'ai trouvé un lot")
    bouton = page.locator("button.bigbtn")
    assert bouton.inner_text() == "Indiquez le n° de lot"
    page.fill("input[placeholder^='Ex. L2611A']", "L2611B")
    page.fill("input[placeholder^='Ex. 3 sacs']", "2 sacs")
    assert bouton.inner_text() == "Photographiez l'étiquette"
    photographier(page)
    assert bouton.inner_text() == "Qu'avez-vous fait du produit ?"
    page.click(".liv-dec:has-text('Mis de côté')")
    assert bouton.inner_text() == "Photographiez le résultat"
    photographier(page, 1)
    bouton.click()
    page.wait_for_selector(".al-rep:has-text('L2611B')")
    page.click("button:has-text(\"C'est tout\")")
    page.wait_for_selector("h2:has-text('Déjà répondu')")
    assert page.locator(".sm-carte:has-text('Cheddar tranché'):has-text('1 lot traité')").count() == 1
    page.click(".sm-carte:has-text('Sauce barbecue')")
    page.wait_for_selector(".al-rep:has-text('B4471')")
    assert "→" in page.locator(".al-ddm").inner_text()
    page.click("text=← Retour")
    page.click("text=← Retour")
    page.wait_for_selector(".home")
    page.wait_for_selector(".al-bandeau", state="detached", timeout=5000)   # plus de bandeau une fois répondu
    assert page.locator(".act:has-text('Alertes produit') .badge").count() == 0

def test_tablette_aucun_lot(page):
    connecter(page)
    page.locator(".al-bandeau").click()
    page.click(".sm-carte:has-text('Cheddar tranché')")
    page.click("text=Aucun lot concerné")
    page.wait_for_selector("h2:has-text('Déjà répondu')")
    assert page.locator(".sm-carte:has-text('Cheddar tranché'):has-text('Aucun lot chez nous')").count() == 1

def test_siege_envoie_et_suit(page):
    page.goto("http://localhost:4173/#siege")
    page.wait_for_selector(".s3-carte")
    page.click("button.s3-retour:has-text('Alertes produit')")
    cheddar = page.locator(".al-siege:has-text('Cheddar tranché')")
    assert "1/15 ont répondu" in cheddar.inner_text()
    bbq = page.locator(".al-siege:has-text('Sauce barbecue')")
    assert "1 lot trouvé" in bbq.inner_text()
    bbq.locator("text=Détail par restaurant").click()
    assert "B4471" in bbq.locator("tr:has-text('DALLAS')").inner_text()
    assert "sans réponse, relancé" in bbq.locator("tr:has-text('BOSTON')").inner_text()
    bbq.locator("tr:has-text('DALLAS') button:has-text('Réétiquetage')").click()
    page.wait_for_selector(".visionneuse img")
    page.click(".visionneuse")

    page.click("text=+ Nouvelle alerte")
    envoyer = page.locator(".al-form button.s3-verifier")
    assert envoyer.inner_text() == "Choisissez le type d'alerte"
    page.click("text=Prolongation de DDM")
    page.fill(".al-form input[placeholder^='Ex. Cheddar']", "Ketchup 5 kg")
    page.fill(".al-form label:has-text(\"DDM d'origine\") input", "2026-12-01")
    page.fill(".al-form label:has-text('Nouvelle DDM') input", "2026-11-25")
    assert envoyer.inner_text() == "La nouvelle DDM doit être après l'ancienne"
    page.fill(".al-form label:has-text('Nouvelle DDM') input", "2027-02-01")
    assert envoyer.inner_text() == "Confirmez qu'il s'agit d'une DDM"
    page.check(".al-ddm-ok input")
    assert envoyer.inner_text() == "Joignez le courrier du fournisseur"
    page.set_input_files("input[aria-label='Document du fournisseur']", files=[{"name": "courrier.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4 test"}])
    page.click(".al-form button:text-is('Certains')")
    assert envoyer.inner_text() == "Choisissez les restaurants"
    page.click(".al-form .g-jour:has-text('DALLAS')")
    page.click(".al-form .g-jour:has-text('BOSTON')")
    envoyer.click()
    page.wait_for_selector(".al-siege:has-text('Ketchup 5 kg'):has-text('0/2 ont répondu')")
    k = page.locator(".al-siege:has-text('Ketchup 5 kg')")
    k.locator("text=Clore l'alerte").click()
    k.locator("text=Confirmer la clôture").click()
    page.wait_for_selector(".al-siege.clos:has-text('Ketchup 5 kg')")
