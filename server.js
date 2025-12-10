const express = require("express");
const { chromium } = require("playwright");
const { exec } = require("child_process");
const WebSocket = require("ws");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

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

// Telegram configuration
let telegramBot = null;
let telegramChatId = null;
let telegramBotToken = null;

// Initialize Telegram bot if token is provided
async function initTelegramBot(token) {
  try {
    // If bot already exists with same token, don't reinitialize
    if (telegramBot && telegramBotToken === token) {
      console.log("Telegram bot already initialized with this token");
      return true;
    }

    // Stop existing bot if any
    if (telegramBot) {
      console.log("Stopping existing Telegram bot...");
      await telegramBot.stopPolling();
      telegramBot = null;
    }

    // Create new bot instance
    telegramBot = new TelegramBot(token, { polling: true });
    telegramBotToken = token;

    // Handle polling errors
    telegramBot.on("polling_error", (error) => {
      console.error("Telegram polling error:", error.code, error.message);
      // Don't log full stack trace for common errors
      if (error.code === "ETELEGRAM" && error.message.includes("409")) {
        console.log("Multiple bot instances detected. Stopping this one...");
        if (telegramBot) {
          telegramBot.stopPolling();
          telegramBot = null;
          telegramBotToken = null;
        }
      }
    });

    // Handle /start command to get chat ID
    telegramBot.onText(/\/start/, (msg) => {
      telegramChatId = msg.chat.id;
      telegramBot.sendMessage(
        telegramChatId,
        "✅ Rec Center Monitor connected! You'll receive notifications here when spots become available."
      );
      console.log(`Telegram chat ID registered: ${telegramChatId}`);

      // Broadcast the chat ID to web clients
      broadcast({
        type: "telegram_connected",
        chatId: telegramChatId,
      });
    });

    console.log("Telegram bot initialized successfully");
    return true;
  } catch (error) {
    console.error("Error initializing Telegram bot:", error.message);
    telegramBot = null;
    telegramBotToken = null;
    return false;
  }
}

// Send Telegram notification
async function sendTelegramNotification(message) {
  if (!telegramBot || !telegramChatId) {
    console.log("Telegram not configured, skipping notification");
    return;
  }

  try {
    await telegramBot.sendMessage(telegramChatId, message, {
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });
    console.log("Telegram notification sent");
  } catch (error) {
    console.error("Error sending Telegram notification:", error.message);
  }
}

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

      // Send Telegram notification
      const activityName = pageData.activityTitle || "Activity";
      const openingsText = pageData.openingsCount
        ? `📊 ${pageData.openingsCount} spots remaining\n\n`
        : "";
      const telegramMessage = `🏀 <b>Rec Center Alert!</b>\n\n${activityName} is now available!\n\n${openingsText}🔗 <a href="${url}">Book Now</a>`;
      await sendTelegramNotification(telegramMessage);

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

app.post("/api/telegram/start", async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, error: "Token required" });
  }

  const success = await initTelegramBot(token);

  broadcast({
    type: "telegram_status",
    active: success,
    configured: !!telegramBotToken,
    connected: !!telegramChatId,
  });

  res.json({
    success,
    message: success
      ? "Telegram bot started. Send /start to your bot to connect."
      : "Failed to start bot. Check if another instance is running.",
  });
});

app.post("/api/telegram/stop", async (req, res) => {
  if (telegramBot) {
    try {
      console.log("Stopping Telegram bot...");
      await telegramBot.stopPolling();
      telegramBot = null;
      telegramBotToken = null;
      telegramChatId = null;
      console.log("Telegram bot stopped");

      broadcast({
        type: "telegram_status",
        active: false,
        configured: false,
        connected: false,
      });

      res.json({ success: true, message: "Telegram bot stopped" });
    } catch (error) {
      console.log("Telegram bot stop error:", error.message);
      // Force cleanup
      telegramBot = null;
      telegramBotToken = null;
      telegramChatId = null;

      broadcast({
        type: "telegram_status",
        active: false,
        configured: false,
        connected: false,
      });

      res.json({
        success: true,
        message: "Telegram bot stopped (with errors)",
      });
    }
  } else {
    res.json({ success: true, message: "Telegram bot was not running" });
  }
});

app.get("/api/telegram/status", (req, res) => {
  res.json({
    active: !!telegramBot,
    configured: !!telegramBotToken,
    connected: !!telegramChatId,
    chatId: telegramChatId,
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
