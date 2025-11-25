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

// ======================================================
// GET USER ID FROM USERNAME
// ======================================================
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

// ======================================================
// GET USER INFO BY ID
// ======================================================
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

// ======================================================
// MAIN DONATIONS ENDPOINT (GAMEPASSES ONLY, INVENTORY-BASED)
// Uses /users/inventory/list-json?assetTypeId=34
// and filters Creator.Id == userId
// ======================================================
app.get("/donations/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!userId || Number.isNaN(userId)) {
      return res.status(400).json({ success: false, error: "Invalid userId" });
    }

    const limitParam = parseInt(req.query.limit || "0", 10);
    const maxReturn =
      !Number.isNaN(limitParam) && limitParam > 0 ? limitParam : Infinity;

    console.log(`\n=== FETCHING INVENTORY GAMEPASSES FOR USER ${userId} ===`);

    const allItems = [];
    let pageNumber = 1;
    const maxPages = 50;
    let keepGoing = true;

    while (keepGoing && pageNumber <= maxPages && allItems.length < maxReturn) {
      const url = `https://www.roproxy.com/users/inventory/list-json?assetTypeId=34&cursor=&itemsPerPage=100&pageNumber=${pageNumber}&userId=${userId}`;
      console.log(`[INV PAGE ${pageNumber}] URL: ${url}`);

      let response;
      let text;
      try {
        response = await fetch(url);
        text = await response.text();
      } catch (err) {
        console.error(`[INV PAGE ${pageNumber}] ERROR fetching inventory:`, err.message);
        break;
      }

      console.log(
        `[INV PAGE ${pageNumber}] Status: ${response.status} ${response.statusText}`
      );

      if (!response.ok) {
        console.log(
          `[INV PAGE ${pageNumber}] Body snippet:`,
          text.slice(0, 300)
        );
        break;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.log(`[INV PAGE ${pageNumber}] JSON parse error:`, e.message);
        console.log(`[INV PAGE ${pageNumber}] Raw (first 300):`, text.slice(0, 300));
        break;
      }

      if (!data || !data.Data || !Array.isArray(data.Data.Items)) {
        console.log(
          `[INV PAGE ${pageNumber}] Unexpected shape. data.Data:`,
          JSON.stringify(data.Data, null, 2).slice(0, 500)
        );
        break;
      }

      const items = data.Data.Items;
      console.log(`[INV PAGE ${pageNumber}] Items count:`, items.length);

      if (items.length === 0) {
        console.log(`[INV PAGE ${pageNumber}] No more inventory items; stopping.`);
        keepGoing = false;
        break;
      }

      for (const invItem of items) {
        if (allItems.length >= maxReturn) {
          console.log(
            `[INV PAGE ${pageNumber}] Reached maxReturn (${maxReturn}); stopping.`
          );
          keepGoing = false;
          break;
        }

        const creatorId = invItem.Creator?.Id;
        const assetId = invItem.Item?.AssetId;
        const name = invItem.Item?.Name || "Gamepass";

        if (!assetId) continue;
        if (creatorId !== userId) continue;

        // Get price from marketplace details
        let price = 0;
        try {
          const detailsUrl = `https://apis.roproxy.com/marketplace/v1/items/details?itemIds=${assetId}`;
          const detailsRes = await fetch(detailsUrl);
          const detailsText = await detailsRes.text();

          if (!detailsRes.ok) {
            console.log(
              `[INV PAGE ${pageNumber}] Details fail for ${assetId}:`,
              detailsRes.status,
              detailsRes.statusText
            );
            continue;
          }

          let detailsData;
          try {
            detailsData = JSON.parse(detailsText);
          } catch (e) {
            console.log(
              `[INV PAGE ${pageNumber}] Details JSON error for ${assetId}:`,
              e.message
            );
            continue;
          }

          if (Array.isArray(detailsData) && detailsData.length > 0) {
            const d = detailsData[0];
            price = typeof d.price === "number" ? d.price : 0;
          }
        } catch (err) {
          console.log(
            `[INV PAGE ${pageNumber}] Error fetching details for ${assetId}:`,
            err.message
          );
          continue;
        }

        if (price <= 0) continue;

        allItems.push({
          id: assetId,
          name,
          price,
          type: "gamepass",
        });
      }

      pageNumber += 1;
      await delay(100);
    }

    console.log(`[SUMMARY] Collected before dedupe: ${allItems.length}`);

    // Dedupe and sort
    const uniqueItems = [];
    const seen = new Set();
    for (const item of allItems) {
      const key = `gamepass_${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueItems.push(item);
      }
    }

    uniqueItems.sort((a, b) => a.price - b.price);

    const finalItems =
      Number.isFinite(maxReturn) && uniqueItems.length > maxReturn
        ? uniqueItems.slice(0, maxReturn)
        : uniqueItems;

    console.log(
      `[SUMMARY] Final items count: ${finalItems.length}. First few:`,
      JSON.stringify(finalItems.slice(0, 5), null, 2)
    );

    res.json({
      success: true,
      items: finalItems,
      count: finalItems.length,
    });
  } catch (error) {
    console.error("Error in donations endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to fetch donation items" });
  }
});

// Debug endpoint – old gamepass API
app.get("/debug/:userId", async (req, res) => {
  const url = `https://apis.roproxy.com/game-passes/v1/users/${req.params.userId}/game-passes?count=100`;
  try {
    const r = await fetch(url);
    const text = await r.text();
    res.send(`Status: ${r.status}\nBody: ${text}`);
  } catch (e) {
    res.send(`Error: ${e.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Donation Proxy running on port ${PORT}`));
