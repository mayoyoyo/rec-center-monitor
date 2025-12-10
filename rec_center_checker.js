#!/usr/bin/env node

/**
 * Rec Center Availability Checker (Playwright Version)
 * Uses a headless browser to check JavaScript-rendered pages
 *
 * Setup:
 *   npm install
 *   npx playwright install chromium
 *
 * Usage:
 *   node rec_center_checker.js
 *
 * Cron (every minute):
 *   * * * * * cd /Users/hansonkang/Documents/proj && /usr/bin/node rec_center_checker.js >> rec_checker.log 2>&1
 */

const { chromium } = require("playwright");
const { exec } = require("child_process");

const CONFIG = {
  // url: "https://anc.ca.apm.activecommunities.com/burnaby/activity/search/detail/70284?onlineSiteId=0&from_original_cui=true",
  url: "https://anc.ca.apm.activecommunities.com/burnaby/activity/search/detail/81362?onlineSiteId=0&from_original_cui=true",
  notificationTitle: "🏀 Rec Center Alert",
  activityName: "Adult Basketball",
  timeout: 60000, // 60 seconds
};

/**
 * Send desktop notification (macOS)
 */
function sendNotification(title, message) {
  const script = `display notification "${message}" with title "${title}" sound name "Glass"`;
  exec(`osascript -e '${script}'`, (error) => {
    if (error) {
      console.error("Notification error:", error);
    }
  });
}

/**
 * Check availability using Playwright
 */
async function checkRecCenter() {
  let browser;

  try {
    console.log(
      `[${new Date().toLocaleString("en-US", {
        timeZone: "America/Vancouver",
        hour12: false,
      })}] Checking ${CONFIG.activityName}...`
    );

    // Launch headless browser
    browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    });

    const page = await context.newPage();

    // Navigate to page
    console.log("  Loading page...");
    await page.goto(CONFIG.url, {
      waitUntil: "domcontentloaded",
      timeout: CONFIG.timeout,
    });

    // Wait for content to load
    console.log("  Waiting for content...");
    await page.waitForTimeout(3000);

    // Extract the page content
    const pageData = await page.evaluate(() => {
      const bodyText = document.body.innerText;

      // Check for availability indicators
      const hasEnrollButton = bodyText.includes("Enroll Now");
      const isFull =
        bodyText.includes("Full") || bodyText.includes("currently full");
      const hasWaitlist =
        bodyText.includes("waitlist") || bodyText.includes("Waitlist");

      // Try to find openings count
      const openingsMatch = bodyText.match(/(\d+)\s+openings?\s+remaining/i);
      const openingsCount = openingsMatch ? parseInt(openingsMatch[1]) : null;

      return {
        hasEnrollButton,
        isFull,
        hasWaitlist,
        openingsCount,
        bodyText: bodyText.substring(0, 500), // First 500 chars for debugging
      };
    });

    // Determine availability
    const available = pageData.hasEnrollButton && !pageData.isFull;

    // Log results
    console.log(`  Available: ${available ? "✅ YES" : "❌ NO"}`);
    if (pageData.openingsCount !== null) {
      console.log(`  Openings: ${pageData.openingsCount}`);
    }
    console.log(`  Full: ${pageData.isFull ? "Yes" : "No"}`);
    console.log(`  Waitlist: ${pageData.hasWaitlist ? "Yes" : "No"}`);
    console.log("---");

    // Send notification if available
    if (available) {
      const message = pageData.openingsCount
        ? `${pageData.openingsCount} spots available! Book now!`
        : `${CONFIG.activityName} is now available! Book now!`;

      console.log(`🎉 ${message}`);
      sendNotification(CONFIG.notificationTitle, message);

      // Open the URL in default browser
      exec(`open "${CONFIG.url}"`);
    }
  } catch (error) {
    console.error("Error checking rec center:", error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the check
checkRecCenter();
