import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const iconSvgPath = path.join(root, "app", "static", "img", "icon.svg");
const outDir = path.join(root, "app", "static", "img");
const svgContent = fs.readFileSync(iconSvgPath, "utf8");
const sizes = [128, 180, 192, 512];

const browser = await chromium.launch();

try {
  for (const size of sizes) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });

    await page.setContent(
      `<!doctype html>
      <html>
        <body style="margin:0;background:#050505;display:grid;place-items:center;width:100vw;height:100vh;overflow:hidden;">
          ${svgContent}
        </body>
      </html>`,
      { waitUntil: "load" },
    );

    await page.locator("svg").evaluate((node, targetSize) => {
      node.setAttribute("width", String(targetSize));
      node.setAttribute("height", String(targetSize));
      node.style.display = "block";
    }, size);

    const fileName = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
    await page.screenshot({
      path: path.join(outDir, fileName),
      clip: { x: 0, y: 0, width: size, height: size },
    });

    await page.close();
  }
} finally {
  await browser.close();
}
