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

// Get user ID from username
app.get("/userid/:username", async (req, res) => {
  try {
    const username = req.params.username;

    const response = await fetch("https://users.roblox.com/v1/usernames/users", {
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

    const response = await fetch(`https://users.roblox.com/v1/users/${userId}`);
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
// NEW: Get gamepasses directly by user ID
// This uses the NEW endpoint from DevForum
// ============================================
app.get("/user-gamepasses/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    let allGamepasses = [];
    let cursor = null;

    // Paginate through all gamepasses
    do {
      const url = cursor 
        ? `https://apis.roblox.com/game-passes/v1/users/${userId}/game-passes?count=100&cursor=${cursor}`
        : `https://apis.roblox.com/game-passes/v1/users/${userId}/game-passes?count=100`;

      console.log(`Fetching: ${url}`);

      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`API returned ${response.status}: ${response.statusText}`);
        break;
      }

      const data = await response.json();
      
      if (data.data && Array.isArray(data.data)) {
        allGamepasses = allGamepasses.concat(data.data);
      }

      cursor = data.nextPageCursor || null;

    } while (cursor);

    console.log(`Found ${allGamepasses.length} gamepasses for user ${userId}`);

    res.json({ 
      success: true, 
      gamepasses: allGamepasses,
      count: allGamepasses.length
    });

  } catch (error) {
    console.error("Error fetching user gamepasses:", error);
    res.status(500).json({ success: false, error: "Failed to fetch gamepasses" });
  }
});

// ============================================
// MAIN DONATIONS ENDPOINT - REWRITTEN
// ============================================
app.get("/donations/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    let allItems = [];

    console.log(`\n=== Fetching donations for user ${userId} ===`);

    // ----------------------------------------
    // STEP 1: Get gamepasses using NEW API
    // ----------------------------------------
    try {
      let cursor = null;
      
      do {
        const url = cursor 
          ? `https://apis.roblox.com/game-passes/v1/users/${userId}/game-passes?count=100&cursor=${cursor}`
          : `https://apis.roblox.com/game-passes/v1/users/${userId}/game-passes?count=100`;

        console.log(`Fetching gamepasses: ${url}`);

        const response = await fetch(url);
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.data && Array.isArray(data.data)) {
            for (const pass of data.data) {
              // The new API returns different field names
              const passId = pass.id || pass.gamePassId;
              const passName = pass.name || pass.displayName || "Gamepass";
              
              // Get price info from economy API
              let price = null;
              let isForSale = false;

              try {
                const priceResponse = await fetch(
                  `https://economy.roblox.com/v1/game-passes/${passId}/product-info`
                );
                
                if (priceResponse.ok) {
                  const priceData = await priceResponse.json();
                  price = priceData.PriceInRobux;
                  isForSale = priceData.IsForSale === true;
                  
                  console.log(`  Gamepass ${passId}: ${passName} - R$${price} (ForSale: ${isForSale})`);
                }
              } catch (priceErr) {
                console.error(`  Failed to get price for gamepass ${passId}`);
              }

              // Only add if for sale with valid price
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
        } else {
          console.error(`Gamepass API returned ${response.status}`);
          cursor = null;
        }

      } while (cursor);

    } catch (gamepassError) {
      console.error("Error fetching gamepasses:", gamepassError.message);
    }

    // ----------------------------------------
    // STEP 2: Get T-Shirts (catalog API)
    // ----------------------------------------
    try {
      const catalogUrl = `https://catalog.roblox.com/v1/search/items?category=Clothing&subcategory=ClassicTShirts&creatorTargetId=${userId}&creatorType=User&limit=30&sortOrder=Desc&sortType=Updated`;
      
      console.log(`Fetching t-shirts: ${catalogUrl}`);

      const catalogResponse = await fetch(catalogUrl);
      
      if (catalogResponse.ok) {
        const catalogData = await catalogResponse.json();
        
        if (catalogData.data && Array.isArray(catalogData.data)) {
          console.log(`Found ${catalogData.data.length} t-shirts`);

          for (const item of catalogData.data) {
            try {
              const assetId = item.id;
              
              // Get price info
              const infoResponse = await fetch(
                `https://economy.roblox.com/v1/assets/${assetId}/product-info`
              );
              
              if (infoResponse.ok) {
                const infoData = await infoResponse.json();
                
                const price = infoData.PriceInRobux;
                const isForSale = infoData.IsForSale === true;
                const name = infoData.Name || item.name || "T-Shirt";

                console.log(`  T-Shirt ${assetId}: ${name} - R$${price} (ForSale: ${isForSale})`);

                if (isForSale && price && price > 0) {
                  allItems.push({
                    id: assetId,
                    name: name,
                    price: price,
                    type: "tshirt"
                  });
                }
              }
            } catch (itemErr) {
              console.error(`  Failed to get t-shirt info`);
            }
          }
        }
      }
    } catch (tshirtError) {
      console.error("Error fetching t-shirts:", tshirtError.message);
    }

    // ----------------------------------------
    // STEP 3: Remove duplicates and sort
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

    // Sort by price (lowest first)
    uniqueItems.sort((a, b) => a.price - b.price);

    console.log(`\n=== Total: ${uniqueItems.length} donation items for user ${userId} ===\n`);

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

// ============================================
// DEBUG: Test the new gamepass API directly
// ============================================
app.get("/debug/gamepasses/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    
    const url = `https://apis.roblox.com/game-passes/v1/users/${userId}/game-passes?count=100`;
    console.log(`DEBUG - Fetching: ${url}`);

    const response = await fetch(url);
    const responseText = await response.text();
    
    console.log(`DEBUG - Status: ${response.status}`);
    console.log(`DEBUG - Response: ${responseText.substring(0, 500)}`);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    res.json({
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      data: data
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Donation Proxy running on port ${PORT}`);
});
