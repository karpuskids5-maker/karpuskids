import asyncio
from playwright.async_api import async_playwright
import os

async def verify():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={'width': 1280, 'height': 720})
        page = await context.new_page()

        # Load the local index.html
        file_path = f"file://{os.getcwd()}/index.html"
        await page.goto(file_path)

        # Wait for AOS animations to settle
        await page.wait_for_timeout(2000)

        # Take a screenshot of the desktop version
        os.makedirs('verification', exist_ok=True)
        await page.screenshot(path='verification/desktop_index.png', full_page=True)
        print("Desktop screenshot saved to verification/desktop_index.png")

        # Test mobile responsiveness
        await page.set_viewport_size({'width': 375, 'height': 812})
        await page.wait_for_timeout(2000)
        await page.screenshot(path='verification/mobile_index.png', full_page=True)
        print("Mobile screenshot saved to verification/mobile_index.png")

        # Verify specific elements
        title = await page.title()
        print(f"Page title: {title}")

        # Check if video is present in Hero
        video_exists = await page.locator('section.relative video.video-bg').count()
        print(f"Hero video present: {video_exists > 0}")

        # Check H1 structure
        h1_flex = await page.locator('h1.karpus-kids-colored').evaluate("el => getComputedStyle(el).display === 'flex'")
        print(f"Hero H1 uses flex: {h1_flex}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
