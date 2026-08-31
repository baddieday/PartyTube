import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";

const packageMetadata = JSON.parse(readFileSync("package.json", "utf8"));

test("Deployment: health reports the packaged release version", async ({ request }) => {
  const response = await request.get("/health");

  expect(response.ok()).toBeTruthy();
  await expect(response).toBeOK();
  expect(await response.json()).toEqual({ status: "ok", version: packageMetadata.version });
});

test("Deployment: Portainer uses its environment file and a persistent named volume", () => {
  const defaultCompose = readFileSync("docker-compose.yml", "utf8");
  const portainerCompose = readFileSync("docker-compose.portainer.yml", "utf8");

  expect(defaultCompose).toContain("./data:/app/data");
  expect(portainerCompose).toContain("- stack.env");
  expect(portainerCompose).toContain("partytube_data:/app/data");
  expect(portainerCompose).toMatch(/volumes:\s+partytube_data:/s);
});
