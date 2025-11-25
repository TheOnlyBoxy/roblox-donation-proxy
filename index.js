const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "Donation Proxy Running!", time: new Date().toISOString() });
});

// Helper function for delays to prevent rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Get user ID from username
app.get("/userid/:username", async (req, res) => {
  try {
    const username = req.params.username;
    // USE ROPROXY
    const response = await fetch("https://users.roproxy.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
    });

    const data = await response.json();

    if (data.data && data.data.length > 0) {
      res.json({ 
        success: true, 
        userId: data.data[0].id, 
        username: data.data[0].name 
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
    // USE ROPROXY
    const response = await fetch(`https://users.roproxy.com/v1/users/${userId}`);
    const data = await response.json();

    if (data.id) {
      res.json({ 
        success: true, 
        userId: data.id, 
        username: data.name,
        displayName: data.displayName
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
// MAIN DONATIONS ENDPOINT
// ============================================
app.get("/donations/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    let allItems = [];

    console.log(`\n=== Fetching donations for user ${userId} ===`);

    // ----------------------------------------
    // STEP 1: Get gamepasses using NEW API (via ROPROXY)
    // ----------------------------------------
    try {
      let cursor = null;
      let pageCount = 0;
      
      do {
        // USE ROPROXY instead of apis.roblox.com
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
            
            // USE ROPROXY for economy
            let price = null;
            let isForSale = false;

            try {
              const priceResponse = await fetch(
                `https://economy.roproxy.com/v1/game-passes/${passId}/product-info`
              );
              
              if (priceResponse.ok) {
                const priceData = await priceResponse.json();
                price = priceData.PriceInRobux;
                isForSale = priceData.IsForSale === true;
              }
              // Add a tiny delay to be nice to the API
              await delay(50); 
            } catch (priceErr) {
              console.error(`  Failed to get price for gamepass ${passId}`);
            }

            if (isForSale && price && price > 0) {
              allItems.push({
                id: passId,
                name: passName,
                price: price,
                type: "gamepass"
              });
            }
          }
        }

        cursor = data.nextPageCursor || null;
        pageCount++;
        if(pageCount > 5) break; // Safety break

      } while (cursor);

    } catch (gamepassError) {
      console.error("Error fetching gamepasses:", gamepassError.message);
    }

    // ----------------------------------------
    // STEP 2: Get T-Shirts (via ROPROXY)
    // ----------------------------------------
    try {
      // USE ROPROXY
      const catalogUrl = `https://catalog.roproxy.com/v1/search/items?category=Clothing&subcategory=ClassicTShirts&creatorTargetId=${userId}&creatorType=User&limit=60&sortOrder=Desc&sortType=Updated`;
      
      console.log(`Fetching t-shirts: ${catalogUrl}`);

      const catalogResponse = await fetch(catalogUrl);
      
      if (catalogResponse.ok) {
        const catalogData = await catalogResponse.json();
        
        if (catalogData.data && Array.isArray(catalogData.data)) {
          for (const item of catalogData.data) {
            try {
              const assetId = item.id;
              
              // USE ROPROXY
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
                    type: "tshirt"
                  });
                }
              }
              await delay(50); // Tiny delay
            } catch (itemErr) {}
          }
        }
      }
    } catch (tshirtError) {
      console.error("Error fetching t-shirts:", tshirtError.message);
    }

    // ----------------------------------------
    // STEP 3: Clean up
    // ----------------------------------------
    const uniqueItems = [];
    const seenIds = new Set();
    
    for (const item of allItems) {
      const key = `${item.type}_${item.id}`;
      if (!seenIds.has(key)) {
        seenIds.add(key);
        uniqueItems.push(item);
      }
    }

    uniqueItems.sort((a, b) => a.price - b.price);

    console.log(`Found ${uniqueItems.length} valid items.`);

    res.json({ 
      success: true, 
      items: uniqueItems,
      count: uniqueItems.length
    });

  } catch (error) {
    console.error("Error in donations endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to fetch donation items" });
  }
});

// Debug endpoint to check raw API status
app.get("/debug/:userId", async (req, res) => {
    const userId = req.params.userId;
    const url = `https://apis.roproxy.com/game-passes/v1/users/${userId}/game-passes?count=100`;
    
    try {
        const response = await fetch(url);
        const text = await response.text();
        res.send(`Status: ${response.status}\nBody: ${text}`);
    } catch (e) {
        res.send(`Error: ${e.message}`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Donation Proxy running on port ${PORT}`);
});
