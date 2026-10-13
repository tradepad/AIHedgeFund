import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/**
 * The vertical slice through the UI, as one serial journey:
 * 1 sign in · 2 campaign · 3 idea cards · 4 strategy and version · 5 SDL ·
 * 6 Pine · 7 verification · 8 CSV uploads · 9 results and parity ·
 * 10 committee decision and audit.
 * The CSVs are synthetic development fixtures, not real TradingView output.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "pine", "fixtures", "tradingview");
const RUN = Date.now().toString(36);

test.describe.configure({ mode: "serial" });

async function signInAs(page: Page, who: "researcher" | "committee"): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId(`login-${who}`).click();
  await expect(page.getByTestId("current-user")).toHaveText(who === "researcher" ? "Riley Researcher" : "Casey Committee");
}

let versionUrl = "";

test("researcher builds the evidence and committee decides", async ({ page }) => {
  // 1. Sign in.
  await signInAs(page, "researcher");
  await expect(page.getByRole("heading", { name: "Command Centre" })).toBeVisible();

  // 2. Create a campaign.
  await page.goto("/campaigns");
  const campaign = page.getByRole("form", { name: "Create campaign" });
  await campaign.locator('input[name="name"]').fill(`E2E campaign ${RUN}`);
  await campaign.locator('textarea[name="objective"]').fill("Find robust crypto trend pullback strategies on BTC perpetuals");
  await campaign.getByRole("button", { name: "Create campaign" }).click();
  await expect(page.getByTestId("campaign-name")).toHaveText(`E2E campaign ${RUN}`);

  // 3. Record a structured Idea Card and ask the IDEA_SCOUT fixture provider for another.
  await page.getByRole("form", { name: "Add idea card" }).getByRole("button", { name: "Record idea" }).click();
  await expect(page.getByTestId("idea-row")).toHaveCount(1);
  const generate = page.getByRole("form", { name: "Generate idea" });
  await generate.locator('input[name="objective"]').fill("trend continuation on BTC perpetuals after pullbacks");
  await generate.getByRole("button", { name: "Request idea" }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("idea-row")).toHaveCount(2, { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });

  // 4. Create a strategy from the idea and its root version.
  const strategy = page.getByRole("form", { name: "Create strategy" });
  await strategy.locator('input[name="name"]').fill(`E2E pullback ${RUN}`);
  await strategy.locator('select[name="ideaCardId"]').selectOption({ index: 1 });
  await strategy.getByRole("button", { name: "Create strategy" }).click();
  await expect(page.getByRole("heading", { name: `E2E pullback ${RUN}` })).toBeVisible();
  const version = page.getByRole("form", { name: "Create version" });
  await version.locator('input[name="symbol"]').fill("BYBIT:BTCUSDT.P");
  await version.locator('input[name="timeframe"]').fill("60");
  await version.getByRole("button", { name: "Create version" }).click();
  await expect(page).toHaveURL(/\/versions\/[0-9a-f-]{36}$/);
  versionUrl = page.url();
  await expect(page.locator("[data-state]").first()).toHaveAttribute("data-state", "HYPOTHESIS_DRAFT");

  // 5. Attach the Strategy Definition and move to Pine development.
  await page.getByTestId("tab-definition").click();
  await page.getByTestId("attach-sdl").click();
  await expect(page.getByTestId("attach-sdl")).toHaveCount(0);
  await page.getByTestId("tab-overview").click();
  await page.getByTestId("transition-PINE_DEVELOPMENT").click();
  await expect(page.locator("h1 [data-state]")).toHaveAttribute("data-state", "PINE_DEVELOPMENT");

  // 6. Generate, lint and attach the Pine v6 revision, then request verification.
  await page.getByTestId("tab-pine").click();
  await page.getByTestId("generate-pine").click();
  await page.getByTestId("attach-pine").click();
  await expect(page.getByTestId("attach-pine")).toHaveCount(0);
  await page.getByTestId("tab-overview").click();
  await expect(page.getByTestId("pine-hash")).toHaveText(/^[0-9a-f]{64}$/);
  await page.getByTestId("transition-TRADINGVIEW_VERIFICATION").click();
  await expect(page.locator("h1 [data-state]")).toHaveAttribute("data-state", "TRADINGVIEW_VERIFICATION");

  // 7. Create the TradingView verification.
  await page.getByTestId("tab-verification").click();
  const create = page.getByRole("form", { name: "Create verification" });
  await create.locator('input[name="dateFrom"]').fill("2024-01-01");
  await create.locator('input[name="dateTo"]').fill("2024-04-30");
  await page.getByTestId("create-verification").click();
  await expect(page).toHaveURL(/\/verifications\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("verification-settings")).toContainText("BYBIT:BTCUSDT.P");

  // 8. Upload both CSV exports through the presigned flow with attestations.
  for (const [slot, file] of [
    ["performance-summary", "classic-performance-summary.csv"],
    ["list-of-trades", "classic-list-of-trades.csv"],
  ] as const) {
    await page.getByTestId(`file-${slot}`).setInputFiles(join(FIXTURES, file));
    await page.getByTestId(`attest-hash-${slot}`).check();
    await page.getByTestId(`attest-settings-${slot}`).check();
    await page.getByTestId(`upload-${slot}`).click();
    await expect(page.getByTestId(`upload-status-${slot}`)).toContainText(file);
  }
  await expect(page.getByTestId("verification-status")).toHaveAttribute("data-status", "COMPLETED", { timeout: 60_000 });

  // 9. Results (ledger, equity, metrics) and the parity report.
  await page.getByTestId("verification-complete").getByRole("link", { name: "View results" }).click();
  await expect(page.getByTestId("equity-summary")).toContainText("10,201.09");
  await expect(page.getByTestId("metrics-table")).toContainText("net profit");
  await expect(page.getByTestId("trades-table").locator("tbody tr")).toHaveCount(12);
  await page.getByTestId("tab-parity").click();
  await expect(page.getByTestId("parity-table")).toBeVisible();
  await expect(page.locator("h2 [data-parity]")).toHaveAttribute("data-parity", "WARN");
  await page.getByTestId("tab-overview").click();
  await page.getByTestId("transition-PAPER_APPROVAL_REVIEW").click();
  await expect(page.locator("h1 [data-state]")).toHaveAttribute("data-state", "PAPER_APPROVAL_REVIEW");

  // 10. An independent committee member records an audited decision.
  await signInAs(page, "committee");
  await page.goto(`${versionUrl}/decision`);
  await expect(page.getByTestId("evidence-summary")).toBeVisible();
  await expect(page.getByTestId("decision-version")).toContainText(versionUrl.split("/").at(-1) ?? "");
  await page.getByTestId("decision-PAPER_APPROVED").check();
  await page.getByTestId("decision-summary").fill("Parity within tolerance and metrics reproduced independently by ARF.");
  await page.getByTestId("decision-rejection-case").fill("Only twelve synthetic trades; the sample is far too small to trust.");
  await page.getByTestId("decision-override").check();
  await page.getByTestId("decision-override-reason").fill("Development fixture walk-through; paper stage only, no capital at risk.");
  await page.getByTestId("decision-ack").check();
  await page.getByTestId("decision-submit").click();
  await expect(page.getByTestId("recorded-decision")).toContainText("PAPER APPROVED");

  await page.goto(versionUrl);
  await expect(page.locator("h1 [data-state]")).toHaveAttribute("data-state", "PAPER_APPROVED");
  await page.getByTestId("tab-audit").click();
  await expect(page.getByTestId("audit-table")).toContainText("DECISION_RECORDED");
  await expect(page.getByTestId("audit-table")).toContainText("HUMAN_OVERRIDE");
  await page.getByTestId("tab-lineage").click();
  await expect(page.getByTestId("lineage-table")).toBeVisible();
  await page.goto("/strategies");
  await expect(page.getByTestId("library-table")).toContainText(`E2E pullback ${RUN}`);
});
