import os
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        # Use absolute path for file
        path = os.path.abspath("index.html")
        page.goto(f"file://{path}")

        # Take a screenshot of the hero
        page.screenshot(path="verification/hero.png")

        # Open mobile menu and take screenshot
        page.set_viewport_size({"width": 375, "height": 667})
        page.click("#mobBtn")
        page.wait_for_timeout(500)
        page.screenshot(path="verification/mobile_menu.png")

        browser.close()

if __name__ == "__main__":
    if not os.path.exists("verification"):
        os.makedirs("verification")
    run()
