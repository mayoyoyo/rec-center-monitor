#!/usr/bin/env node

const https = require("https");
const fs = require("fs");

const url =
  "https://anc.ca.apm.activecommunities.com/burnaby/activity/search/detail/70284?onlineSiteId=0&from_original_cui=true";

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
        },
        (res) => {
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            resolve(data);
          });
        }
      )
      .on("error", (err) => {
        reject(err);
      });
  });
}

async function debug() {
  try {
    console.log("Fetching page...");
    const html = await fetchPage(url);

    // Save to file
    fs.writeFileSync("page_content.html", html);
    console.log("✅ Saved HTML to page_content.html");

    // Check for key phrases
    console.log("\n🔍 Searching for key phrases:");
    console.log(
      "  'openings remaining':",
      html.includes("openings remaining") ? "✅ FOUND" : "❌ NOT FOUND"
    );
    console.log(
      "  'Enroll Now':",
      html.includes("Enroll Now") ? "✅ FOUND" : "❌ NOT FOUND"
    );
    console.log(
      "  'Full':",
      html.includes(">Full<") ? "✅ FOUND" : "❌ NOT FOUND"
    );

    // Try to find the openings text with regex
    const openingsMatch = html.match(/(\d+)\s+openings?\s+remaining/i);
    if (openingsMatch) {
      console.log(
        `  ✅ Found: "${openingsMatch[0]}" - ${openingsMatch[1]} openings`
      );
    } else {
      console.log("  ❌ Regex didn't match");

      // Try to find any number followed by "opening"
      const anyMatch = html.match(/\d+.*?opening/i);
      if (anyMatch) {
        console.log(`  🔍 Found similar: "${anyMatch[0]}"`);
      }
    }

    // Search for the specific section
    const lines = html.split("\n");
    const relevantLines = lines.filter(
      (line) =>
        line.includes("opening") ||
        line.includes("Enroll") ||
        line.includes("Full") ||
        line.includes("remaining")
    );

    if (relevantLines.length > 0) {
      console.log("\n📄 Relevant HTML lines:");
      relevantLines.slice(0, 10).forEach((line) => {
        console.log("  ", line.trim().substring(0, 100));
      });
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

debug();
