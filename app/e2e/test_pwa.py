from playwright.sync_api import sync_playwright

def test_installable_et_ouvre_sans_reseau():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context()
        pg = ctx.new_page()
        pg.goto("http://localhost:4173/")
        manifeste = pg.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
        assert manifeste["display"] == "standalone" and len(manifeste["icons"]) >= 2
        pg.evaluate("navigator.serviceWorker.ready.then(() => true)")
        pg.wait_for_function("navigator.serviceWorker.controller !== null || caches.keys().then(k => k.length > 0)", timeout=10000)
        pg.wait_for_timeout(1500)  # fin de la mise en cache
        ctx.set_offline(True)
        pg.reload()
        pg.wait_for_selector("text=Qui êtes-vous ?", timeout=10000)
        b.close()
