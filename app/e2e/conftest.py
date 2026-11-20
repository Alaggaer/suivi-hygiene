"""Parcours tablette de bout en bout, en mode démonstration (serveur simulé).
Lancer : npm run test:e2e (construit l'app, la sert sur le port 4173, puis lance pytest)."""
import pytest
from playwright.sync_api import sync_playwright

URL = "http://localhost:4173/"

@pytest.fixture()
def page():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 800})
        erreurs = []
        pg.on("pageerror", lambda e: erreurs.append(str(e)))
        pg.goto(URL)
        yield pg
        b.close()
        assert erreurs == [], f"Erreurs JavaScript : {erreurs}"

def connecter(pg, nom="Karim", pin="1234"):
    pg.click(f'.users button:has-text("{nom}")')
    for k in pin:
        pg.click(f'.login .keys button:text-is("{k}")')
    pg.wait_for_selector(".home")

def saisir(pg, bouton, valeur):
    """Ouvre le pavé numérique depuis `bouton` et tape `valeur` (ex. "-18", "4.5")."""
    bouton.click()
    neg = valeur.startswith("-")
    for k in valeur.lstrip("-"):
        if k == ".":
            pg.click('.pad button:has-text("virgule"), .pad .keys button:text-is(",")')
        else:
            pg.click(f'.pad .keys button:text-is("{k}")')
    if neg:
        pg.click('.pad button[aria-label="Changer le signe"]')
    pg.click(".pad button.k-ok")

def png(l=64, h=48):
    """Petite image PNG valide (pour simuler la photo prise par la tablette)."""
    import struct, zlib
    brut = b"".join(b"\x00" + bytes([200, 120, 40]) * l for _ in range(h))
    def bloc(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + bloc(b"IHDR", struct.pack(">IIBBBBB", l, h, 8, 2, 0, 0, 0))
            + bloc(b"IDAT", zlib.compress(brut)) + bloc(b"IEND", b""))

def photographier(pg, index=0):
    pg.locator('.photo input[type="file"]').nth(index).set_input_files(
        {"name": "etiquette.png", "mimeType": "image/png", "buffer": png()})
    pg.wait_for_selector(".photo.done")
