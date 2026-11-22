import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.QUANTUM_API_URL;
const accessCode = process.env.APP_ACCESS_CODE;
assert.ok(base && accessCode, "Acceptance environment is missing.");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 601, height: 1007 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#access-code").fill(accessCode);
  await page.locator("#auth-submit").click();
  await page.locator("#auth-gate.hidden").waitFor({ state: "attached", timeout: 30000 });

  const answer = page.locator(".message.assistant .message-text").last();
  await answer.waitFor({ state: "visible", timeout: 30000 });
  assert.ok((await answer.innerText()).trim().length > 20, "Restored assistant answer is empty.");
  const citation = page.locator(".message.assistant .message-sources a").first();
  await citation.waitFor({ state: "visible", timeout: 15000 });
  assert.match(await citation.getAttribute("href"), /^https:\/\/en\.wikipedia\.org\/wiki\//);

  await page.locator("#open-knowledge").click();
  await page.locator(".knowledge-row a").first().waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#dialog-close").click();

  await page.locator("#new-chat").click();
  await page.locator("#welcome").waitFor({ state: "visible" });
  await page.locator("#open-history").click();
  await page.locator(".history-item").first().click();
  await page.locator(".message.assistant .message-sources a").first().waitFor({ state: "visible", timeout: 15000 });

  await page.locator("#open-system").click();
  await page.locator("#info-dialog").waitFor({ state: "visible" });
  assert.match(await page.locator("#dialog-title").innerText(), /Quantum system status/);
  await page.locator("#dialog-close").click();

  await page.locator("#settings-button").click();
  assert.match(await page.locator("#dialog-content").innerText(), /SmolLM2-135M-Instruct/);
  await page.locator(".dialog-action.danger").click();
  await page.locator("#auth-gate:not(.hidden)").waitFor({ state: "visible" });
  assert.deepEqual(pageErrors, [], "Browser reported JavaScript runtime errors.");
  console.log("PASS: tablet-sized browser sign-in, restored AI answer, citation links, knowledge library, history, system status, settings, and sign-out.");
} finally {
  await browser.close();
}
