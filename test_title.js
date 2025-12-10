const { chromium } = require("playwright");

async function testTitle() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const url =
    "https://anc.ca.apm.activecommunities.com/burnaby/activity/search/detail/78784?onlineSiteId=0&from_original_cui=true";

  console.log("Loading page...");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  const data = await page.evaluate(() => {
    // Try different selectors
    const h1 = document.querySelector("h1");
    const h2 = document.querySelector("h2");
    const title = document.title;

    // Get all text content
    const bodyText = document.body.innerText;

    // Try to find "Reserve In Advance" pattern
    const reserveMatch = bodyText.match(/Reserve In Advance[:\s]+([^\n]+)/i);

    return {
      h1: h1 ? h1.innerText : null,
      h2: h2 ? h2.innerText : null,
      title: title,
      reserveMatch: reserveMatch ? reserveMatch[0] : null,
      firstLines: bodyText.split("\n").slice(0, 20).join("\n"),
    };
  });

  console.log("\n=== Page Title Info ===");
  console.log("H1:", data.h1);
  console.log("H2:", data.h2);
  console.log("Document Title:", data.title);
  console.log("Reserve Match:", data.reserveMatch);
  console.log("\n=== First 20 Lines ===");
  console.log(data.firstLines);

  await browser.close();
}

testTitle().catch(console.error);
