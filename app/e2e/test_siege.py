def ouvrir(page):
    # Heure fixe (15:40 à Paris) : la règle « tablette silencieuse » ne joue qu'en heures d'ouverture.
    page.clock.set_fixed_time("2026-11-20T15:40:00+01:00")
    page.goto("http://localhost:4173/#siege")
    page.wait_for_selector(".s3-carte")

def test_accueil_cartes_par_restaurant(page):
    ouvrir(page)
    cartes = page.locator(".s3-carte")
    assert cartes.count() == 15, "une carte par restaurant"
    premiere = cartes.first.inner_text()
    assert "À surveiller" in premiere, "les plus préoccupants d'abord"
    assert page.locator(".s3-carte:has-text('PHOENIX'):has-text('Tablette silencieuse')").count() == 1
    assert "PHOENIX" in page.locator(".s3-chiffre:has-text('Tablettes silencieuses')").inner_text()
    page.click(".s3-filtres button:has-text('À surveiller')")
    n = page.locator(".s3-carte").count()
    assert 1 <= n < 15 and page.locator(".s3-carte .pill.warn, .s3-carte .pill.ok").count() == 0

def test_fiche_restaurant_et_dossier(page):
    ouvrir(page)
    page.click(".s3-carte:has-text('DALLAS')")
    page.wait_for_selector("h2:has-text('La journée')")
    for titre in ["Températures", "Huile", "Livraisons", "Traçabilité produits", "30 derniers jours"]:
        assert page.locator(f".s3-bloc h2:has-text('{titre}')").count() == 1, titre
    assert page.locator(".s3-atraiter:has-text('Chambre froide négative')").count() == 1, "anomalie du restaurant à traiter en tête"
    page.wait_for_selector(".s3-vignette img")
    page.locator(".s3-vignette").first.click()
    page.wait_for_selector(".visionneuse img")
    page.click(".visionneuse")
    page.click("button:has-text('Hier')")
    page.wait_for_selector("h2:has-text('La journée')")
    page.click("text=← Tous les restaurants")
    page.wait_for_selector(".s3-carte")

def test_traiter_puis_verifier(page):
    ouvrir(page)
    assert page.locator(".s3-averifier").inner_text() == "1 à vérifier"
    page.click(".s3-carte:has-text('DALLAS')")
    carte = page.locator(".s3-atraiter .carte")
    carte.locator("input").fill("Frigoriste passé, porte réparée")
    carte.locator("text=Marquer traitée").click()
    page.wait_for_selector(".s3-averifier:text-is('2 à vérifier')")
    page.click(".s3-averifier")
    page.wait_for_selector("h1:has-text('Anomalies du groupe')")
    c = page.locator(".carte:has-text('DALLAS')")
    assert "Frigoriste passé" in c.inner_text()
    c.locator("text=Vérifier et clore").click()
    page.wait_for_selector(".s3-averifier:text-is('1 à vérifier')")

def test_telephone(page):
    page.set_viewport_size({"width": 390, "height": 844})
    ouvrir(page)
    largeur = page.evaluate("document.documentElement.scrollWidth")
    assert largeur <= 392, f"pas de défilement horizontal sur téléphone ({largeur}px)"
    page.click(".s3-carte >> nth=0")
    page.wait_for_selector("h2:has-text('La journée')")
    assert page.evaluate("document.documentElement.scrollWidth") <= 392

def test_rattrapage_par_le_siege(page):
    ouvrir(page)
    page.click(".s3-carte:has-text('DALLAS')")
    page.wait_for_selector("h2:has-text('Températures')")
    ligne = page.locator("tr:has-text('Chambre froide négative')")
    ligne.locator("text=Corriger").click()
    page.wait_for_selector("text=Corriger une saisie")
    bouton = page.locator("text=Enregistrer la correction")
    assert bouton.is_disabled(), "motif obligatoire"
    page.click("text=Erreur de saisie (faute de frappe)")
    page.fill("input[placeholder='Vide = saisie annulée']", "25")
    assert page.locator(".correction .t-bad").count() == 1 and bouton.is_disabled(), "valeur impossible refusée"
    page.fill("input[placeholder='Vide = saisie annulée']", "-21")
    bouton.click()
    page.wait_for_selector("tr.corrigee:has-text('Chambre froide négative')")
    t = page.locator("tr.corrigee").inner_text()
    assert "−12" in t or "-12" in t, "valeur d'origine gardée (barrée)"
    assert "Corrigé par Siège (démo)" in t and "Erreur de saisie" in t

def test_saisie_oubliee_par_le_siege(page):
    ouvrir(page)   # horloge fixée au 20/11 15:40
    page.click(".s3-carte:has-text('DALLAS')")
    page.wait_for_selector("h2:has-text('Températures')")
    page.click("text=+ Relevé oublié")
    page.wait_for_selector("text=Relevé oublié ·")
    bouton = page.locator("text=Enregistrer la saisie oubliée")
    page.select_option("select.champ", label="Frigo poste chaud (max +4 °C)")
    page.fill("input[type=time]", "18:00")
    assert page.locator("text=Cette heure n'est pas encore passée.").count() == 1
    page.fill("input[type=time]", "14:10")
    page.fill(".correction input[inputmode=decimal]", "6")
    page.wait_for_selector("text=action corrective faite à l'époque")
    page.click("text=Relevé fait sur papier, pas sur la tablette")
    assert bouton.is_disabled(), "action corrective obligatoire si hors seuil"
    page.click(".correction button:has-text('Porte mal fermée, refermée')")
    bouton.click()
    page.wait_for_selector("tr:has-text('Frigo poste chaud'):has-text('Saisi après coup par le siège')")

def test_heure_reelle_et_reception(page):
    ouvrir(page)
    page.click(".s3-carte:has-text('DALLAS')")
    page.wait_for_selector("h2:has-text('Températures')")
    assert "reçue 13:05" in page.locator("tr:has-text('Chambre froide positive')").inner_text(), "saisie hors ligne : heure réelle + heure de réception"
