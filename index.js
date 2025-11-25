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
// MAIN DONATIONS ENDPOINT (FIXED)
// ============================================
app.get("/donations/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    let allItems = [];

    console.log(`\n=== Fetching donations for user ${userId} ===`);

    // ----------------------------------------
    // STEP 1: Get gamepasses created by the user
    // ----------------------------------------
    try {
      let cursor = null;
      let pageCount = 0;

      do {
        const url = cursor
          ? `https://apis.roproxy.com/game-passes/v1/users/${userId}/game-passes?count=100&cursor=${cursor}`
          : `https://apis.roproxy.com/game-passes/v1/users/${userId}/game-passes?count=100`;

        console.log(`Fetching gamepasses: ${url}`);

        const response = await fetch(url);
        if (!response.ok) {
          console.log(`Gamepass fetch failed: ${response.status} ${response.statusText}`);
          break;
        }

        const data = await response.json();
        if (data.data && Array.isArray(data.data)) {
          for (const pass of data.data) {
            const passId = pass.id || pass.gamePassId;
            const passName = pass.name || pass.displayName || "Gamepass";

            let price = null;
            let isForSale = false;

            try {
              const priceResponse = await fetch(
                `https://economy.roproxy.com/v1/game-passes/${passId}/product-info`
              );
              if (priceResponse.ok) {
                const priceData = await priceResponse.json();

                const creatorId = priceData.Creator?.Id;
                const creatorType = priceData.Creator?.Type;

                console.log("Product info for pass", passId, {
                  creatorId,
                  creatorType,
                  userId,
                  price: priceData.PriceInRobux,
                  isForSale: priceData.IsForSale,
                });

                // Must be for sale and have a price
                price = priceData.PriceInRobux;
                isForSale = priceData.IsForSale === true;

                // OPTIONAL SAFETY: ensure the creator matches the user
                if (creatorId != userId) {
                  console.log(
                    `Skipping pass ${passId} because creatorId != userId`,
                    creatorId,
                    userId
                  );
                  continue;
                }
              } else {
                console.log(
                  `Failed to get product-info for gamepass ${passId}:`,
                  priceResponse.status,
                  priceResponse.statusText
                );
              }
              await delay(50);
            } catch (priceErr) {
              console.error(`Failed to get price for gamepass ${passId}:`, priceErr.message);
            }

            if (isForSale && price && price > 0) {
              allItems.push({
                id: passId,
                name: passName,
                price: price,
                type: "gamepass",
              });
            }
          }
        }

        cursor = data.nextPageCursor || null;
        pageCount++;
        if (pageCount > 5) break;
      } while (cursor);
    } catch (err) {
      console.error("Error fetching gamepasses:", err.message);
    }

    // ----------------------------------------
    // STEP 2: T-Shirts
    // ----------------------------------------
    try {
      const catalogUrl = `https://catalog.roproxy.com/v1/search/items?category=Clothing&subcategory=ClassicTShirts&creatorTargetId=${userId}&creatorType=User&limit=60&sortOrder=Desc&sortType=Updated`;
      console.log(`Fetching t-shirts: ${catalogUrl}`);

      const catalogResponse = await fetch(catalogUrl);
      if (catalogResponse.ok) {
        const catalogData = await catalogResponse.json();
        if (catalogData.data && Array.isArray(catalogData.data)) {
          for (const item of catalogData.data) {
            try {
              const assetId = item.id;
              const infoResponse = await fetch(
                `https://economy.roproxy.com/v1/assets/${assetId}/product-info`
              );
              if (infoResponse.ok) {
                const infoData = await infoResponse.json();
                const price = infoData.PriceInRobux;
                const isForSale = infoData.IsForSale === true;
                const name = infoData.Name || item.name || "T-Shirt";

                if (isForSale && price && price > 0) {
                  allItems.push({
                    id: assetId,
                    name: name,
                    price: price,
                    type: "tshirt",
                  });
                }
              }
              await delay(50);
            } catch (itemErr) {
              console.error("Error processing t-shirt item:", itemErr.message);
            }
          }
        }
      } else {
        console.log(
          "T-shirt catalog fetch failed:",
          catalogResponse.status,
          catalogResponse.statusText
        );
      }
    } catch (err) {
      console.error("Error fetching t-shirts:", err.message);
    }

    // ----------------------------------------
    // STEP 3: Cleanup and respond
    // ----------------------------------------
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

// Debug endpoint
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
