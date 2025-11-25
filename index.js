const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "Donation Proxy Running!", time: new Date().toISOString() });
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================
// USER HELPERS
// ============================================

// Get user ID from username
app.get("/userid/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const response = await fetch("https://users.roproxy.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    });

    const data = await response.json();

    if (data.data && data.data.length > 0) {
      res.json({
        success: true,
        userId: data.data[0].id,
        username: data.data[0].name,
      });
    } else {
      res.json({ success: false, error: "User not found" });
    }
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user" });
  }
});

// Get user info by ID
app.get("/userinfo/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const response = await fetch(`https://users.roproxy.com/v1/users/${userId}`);
    const data = await response.json();
    if (data.id) {
      res.json({
        success: true,
        userId: data.id,
        username: data.name,
        displayName: data.displayName,
      });
    } else {
      res.json({ success: false, error: "User not found" });
    }
  } catch (error) {
    console.error("Error fetching user info:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user info" });
  }
});

// ============================================
// DONATIONS BY USER (LOOSENED FILTERS)
// Uses: https://apis.roproxy.com/game-passes/v1/users/{userId}/game-passes
// Only requires: isForSale === true and price > 0
// ============================================
app.get("/donations/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    let allItems = [];

    console.log(`\n=== Fetching donations for user ${userId} ===`);

    try {
      const url = `https://apis.roproxy.com/game-passes/v1/users/${userId}/game-passes?count=100`;
      console.log(`Fetching gamepasses: ${url}`);

      const response = await fetch(url);
      const text = await response.text();
      console.log("Raw gamepass response for", userId, ":", text);

      if (!response.ok) {
        console.log(`Gamepass fetch failed: ${response.status} ${response.statusText}`);
      } else {
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.log("Failed to parse gamepass JSON:", e.message);
          data = null;
        }

        if (data && Array.isArray(data.gamePasses)) {
          for (const pass of data.gamePasses) {
            const passId = pass.gamePassId;
            const passName = pass.name || "Gamepass";
            const price = pass.price;
            const isForSale = pass.isForSale === true;

            // LOOSENED: do NOT filter by creatorId/creatorType.
            // Just require it to be for sale with a positive price.
            if (isForSale && typeof price === "number" && price > 0) {
              allItems.push({
                id: passId,
                name: passName,
                price: price,
                type: "gamepass",
                creator: pass.creator, // kept for debugging
              });
            }
          }
        } else {
          console.log("No gamePasses array in response or not an array");
        }
      }

      await delay(50);
    } catch (err) {
      console.error("Error fetching gamepasses:", err.message);
    }

    // De-duplicate and sort
    const uniqueItems = [];
    const seen = new Set();
    for (const item of allItems) {
      const key = `${item.type}_${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueItems.push(item);
      }
    }

    uniqueItems.sort((a, b) => a.price - b.price);
    console.log(`Found ${uniqueItems.length} valid items for user ${userId}.`);

    res.json({
      success: true,
      items: uniqueItems,
      count: uniqueItems.length,
    });
  } catch (error) {
    console.error("Error in donations endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to fetch donation items" });
  }
});

// ============================================
// DEBUG ENDPOINT – raw user gamepasses
// ============================================
app.get("/debug/:userId", async (req, res) => {
  const url = `https://apis.roproxy.com/game-passes/v1/users/${req.params.userId}/game-passes?count=100`;
  try {
    const r = await fetch(url);
    const text = await r.text();
    res.send(`Status: ${r.status}\nURL: ${url}\nBody:\n${text}`);
  } catch (e) {
    res.send(`Error: ${e.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Donation Proxy running on port ${PORT}`));
