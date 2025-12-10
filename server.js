const express = require("express");
const { chromium } = require("playwright");
const { exec } = require("child_process");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const PORT = 3001;

// Middleware
app.use(express.json());
app.use(express.static("public"));

// State
let isPolling = false;
let pollInterval = null;
let currentUrl =
  "https://anc.ca.apm.activecommunities.com/burnaby/activity/search/detail/70284?onlineSiteId=0&from_original_cui=true";
let pollIntervalSeconds = 30;
let lastCheckResult = null;
let checkCount = 0;

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ noServer: true });

// Broadcast to all connected clients
function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Send desktop notification (macOS)
function sendNotification(title, message) {
  const script = `display notification "${message}" with title "${title}" sound name "Glass"`;
  exec(`osascript -e '${script}'`, (error) => {
    if (error) {
      console.error("Notification error:", error);
    }
  });
}

// Check availability function
async function checkAvailability(url) {
  let browser;

  try {
    console.log(
      `[${new Date().toLocaleTimeString()}] Checking availability...`
    );

    browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    });

    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    const pageData = await page.evaluate(() => {
      const bodyText = document.body.innerText;

      const hasEnrollButton = bodyText.includes("Enroll Now");
      const isFull =
        bodyText.includes("Full") || bodyText.includes("currently full");

      const openingsMatch = bodyText.match(/(\d+)\s+openings?\s+remaining/i);
      const openingsCount = openingsMatch ? parseInt(openingsMatch[1]) : null;

      // Extract activity title from h1 or page title
      const titleElement = document.querySelector("h1");
      const activityTitle = titleElement
        ? titleElement.innerText.trim()
        : document.title;

      return {
        hasEnrollButton,
        isFull,
        openingsCount,
        activityTitle,
      };
    });

    const available = pageData.hasEnrollButton && !pageData.isFull;

    const result = {
      timestamp: new Date().toISOString(),
      available,
      openings: pageData.openingsCount,
      full: pageData.isFull,
      activityTitle: pageData.activityTitle,
      url,
    };

    lastCheckResult = result;
    checkCount++;

    // Log the result for debugging
    console.log("Result:", {
      available: result.available,
      openings: result.openings,
      activityTitle: result.activityTitle,
    });

    // Send notification if available
    if (available) {
      const message = pageData.openingsCount
        ? `${pageData.openingsCount} spots available!`
        : "Spots available!";

      sendNotification("🏀 Rec Center Alert", message);
      exec(`open "${url}"`);
    }

    return result;
  } catch (error) {
    console.error("Error checking availability:", error.message);
    return {
      timestamp: new Date().toISOString(),
      error: error.message,
      url,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Start polling
async function startPolling() {
  if (isPolling) return;

  isPolling = true;
  checkCount = 0;

  broadcast({
    type: "status",
    isPolling: true,
    interval: pollIntervalSeconds,
    url: currentUrl,
  });

  // Check immediately
  const result = await checkAvailability(currentUrl);
  broadcast({
    type: "result",
    ...result,
    checkCount,
  });

  // Then check at intervals
  pollInterval = setInterval(async () => {
    const result = await checkAvailability(currentUrl);
    broadcast({
      type: "result",
      ...result,
      checkCount,
    });
  }, pollIntervalSeconds * 1000);
}

// Stop polling
function stopPolling() {
  if (!isPolling) return;

  isPolling = false;
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  broadcast({
    type: "status",
    isPolling: false,
  });
}

// API Routes
app.get("/api/status", (req, res) => {
  res.json({
    isPolling,
    interval: pollIntervalSeconds,
    url: currentUrl,
    lastCheck: lastCheckResult,
    checkCount,
  });
});

app.post("/api/start", async (req, res) => {
  if (req.body.url) {
    currentUrl = req.body.url;
  }
  if (req.body.interval) {
    pollIntervalSeconds = parseInt(req.body.interval);
  }

  await startPolling();
  res.json({ success: true, isPolling: true });
});

app.post("/api/stop", (req, res) => {
  stopPolling();
  res.json({ success: true, isPolling: false });
});

app.post("/api/config", (req, res) => {
  if (req.body.url) {
    currentUrl = req.body.url;
  }
  if (req.body.interval) {
    pollIntervalSeconds = parseInt(req.body.interval);
  }

  res.json({
    success: true,
    url: currentUrl,
    interval: pollIntervalSeconds,
  });
});

// Serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🏀 Rec Center Checker running at http://localhost:${PORT}`);
  console.log(`Open your browser to control the polling`);
});

// WebSocket upgrade
server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// WebSocket connection
wss.on("connection", (ws) => {
  console.log("Client connected");

  // Send current status
  ws.send(
    JSON.stringify({
      type: "status",
      isPolling,
      interval: pollIntervalSeconds,
      url: currentUrl,
      lastCheck: lastCheckResult,
      checkCount,
    })
  );

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});
