import os, re, tempfile
import openpyxl

def classeur():
    wb = openpyxl.Workbook()
    wb.active.title = "Mode d'emploi"
    def onglet(nom, lignes):
        ws = wb.create_sheet(nom)
        for l in lignes: ws.append(l)
    onglet("Restaurants", [["Restaurant", "Ville", "Responsable de site", "Ouverture", "Début service soir", "Modèle testeur d'huile", "Remarques"],
        ["ATLANTA", "LANGUEUX", "David", "09H", "18h30", "Testo", None],
        ["SEATTLE", "LYON", None, "10h", "19h", "Testo", None]])
    onglet("Enceintes", [["Restaurant", "Enceinte", "Type", "T° max (°C)", "Capteur Traqfood", "Remarques"],
        ["ATLANTA", "Chambre froide positive", "Chambre froide positive", 3, False, None],
        ["ATLANTA", "Frigo desserts", "Frigo", 4, False, None],
        ["ATLANTA", "Chambre froide négative", "Chambre froide négative", -4, False, None],
        ["SEATTLE", "Frigo bar", "Frigo", 4, False, None]])
    onglet("Friteuses", [["Restaurant", "Friteuse", "Capacité (L)", "Remarques"], ["ATLANTA", "Friteuse 1", 18, None], ["ATLANTA", "Friteuse 3", None, None]])
    onglet("Employés", [["Restaurant", "Prénom", "Nom", "Rôle", "Remarques"], ["ATLANTA", "Nora", "Benali", "Chef", None], ["SEATTLE", "Léa", "Martin", "Équipe", None]])
    onglet("Fournisseurs", [["Fournisseur", "Produits livrés", "Livre de la viande", "Jours de livraison", "Contact", "Remarques"],
        ["SYSCO", "Frais, Surgelé", "Oui", "lundi, jeudi", None, None], ["METRO", "Sec", None, None, None, None]])
    f = os.path.join(tempfile.mkdtemp(), "parametrage.xlsx")
    wb.save(f)
    return f

def ouvrir_import(page):
    page.goto("http://localhost:4173/#siege")
    page.wait_for_selector(".s3-carte")
    page.click("button.s3-retour:has-text('Gestion')")
    page.click(".g-item:has-text('Importer le tableau')")

def test_import_apercu_puis_application_et_codes(page):
    ouvrir_import(page)
    page.set_input_files("input[aria-label='Fichier du tableau']", classeur())
    page.wait_for_selector("h2:has-text(\"Ce que l'import va faire\")")
    page.click(".imp-groupe summary:has-text('À savoir')")
    texte = page.locator(".imp").inner_text()
    for attendu in ["ATLANTA : service du soir 18:30", "Nouveau restaurant SEATTLE (LYON)", "ATLANTA · nouvelle enceinte Frigo desserts",
                    "ATLANTA · Friteuse 1 : 25 → 18 L", "ATLANTA · nouvel employé Nora Benali (chef)", "ATLANTA · nouvel employé David (responsable)",
                    "SEATTLE · nouvel employé Léa Martin (équipe)", "SYSCO : livre frais, surgele, viande : oui, jours de livraison", "Nouveau fournisseur METRO",
                    "-4 °C impossible", "capacité manquante"]:
        assert attendu in texte, attendu
    assert "1 ligne refusée" in texte
    bouton = page.locator("button:has-text('Appliquer les')")
    n = int(re.search(r"Appliquer les (\d+)", bouton.inner_text()).group(1))
    bouton.click()
    page.wait_for_selector("h2:has-text('Import terminé')")
    assert f"{n} changements enregistrés" in page.locator(".imp-resume").inner_text()
    codes = page.locator(".imp-code")
    assert codes.count() == 3
    assert all(re.fullmatch(r"\d{4}", c) for c in codes.all_inner_texts())
    assert page.locator(".imp-resto:has-text('SEATTLE'):has-text('Léa Martin')").count() == 1
    # Le nouveau restaurant est dans la liste ; réimporter le même fichier ne change plus rien.
    page.wait_for_selector(".g-item:has-text('SEATTLE')")
    page.click("text=Importer un autre fichier")
    page.set_input_files("input[aria-label='Fichier du tableau']", classeur())
    page.wait_for_selector("h2:has-text(\"Ce que l'import va faire\")")
    assert page.locator("button:has-text('Rien à changer')").is_disabled()

def test_fichier_illisible(page):
    ouvrir_import(page)
    f = os.path.join(tempfile.mkdtemp(), "faux.xlsx")
    open(f, "wb").write(b"pas un classeur")
    page.set_input_files("input[aria-label='Fichier du tableau']", f)
    page.wait_for_selector(".pill.bad:has-text('Fichier illisible')")
