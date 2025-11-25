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

// Get T-Shirts created by user (multiple methods)
app.get("/tshirts/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    let allTshirts = [];
    
    // Method 1: Catalog search
    try {
      const url = `https://catalog.roblox.com/v1/search/items/details?Category=3&CreatorTargetId=${userId}&CreatorType=1&Limit=30&SortType=0`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.data) {
        for (const item of data.data) {
          if (item.price && item.price > 0) {
            allTshirts.push({
              id: item.id,
              name: item.name,
              price: item.price,
              type: "tshirt"
            });
          }
        }
      }
    } catch (e) {
      console.error("Catalog search failed:", e);
    }
    
    // Method 2: Inventory created assets
    try {
      const url = `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?assetType=TShirt&limit=100`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.data) {
        for (const item of data.data) {
          // Check if already added
          if (!allTshirts.find(t => t.id === item.assetId)) {
            // Get price info
            try {
              const priceRes = await fetch(`https://economy.roblox.com/v1/assets/${item.assetId}/resellers?limit=1`);
              const priceData = await priceRes.json();
              
              if (item.recentAveragePrice && item.recentAveragePrice > 0) {
                allTshirts.push({
                  id: item.assetId,
                  name: item.name,
                  price: item.recentAveragePrice,
                  type: "tshirt"
                });
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {
      console.error("Inventory search failed:", e);
    }
    
    // Method 3: Created assets API
    try {
      const url = `https://www.roblox.com/users/inventory/list-json?assetTypeId=2&cursor=&itemsPerPage=100&pageNumber=1&userId=${userId}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.Data && data.Data.Items) {
        for (const item of data.Data.Items) {
          if (item.Creator && item.Creator.Id === parseInt(userId)) {
            if (item.Product && item.Product.PriceInRobux && item.Product.PriceInRobux > 0 && item.Product.IsForSale) {
              if (!allTshirts.find(t => t.id === item.Item.AssetId)) {
                allTshirts.push({
                  id: item.Item.AssetId,
                  name: item.Item.Name,
                  price: item.Product.PriceInRobux,
                  type: "tshirt"
                });
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("Created assets search failed:", e);
    }
    
    allTshirts.sort((a, b) => a.price - b.price);
    
    res.json({ success: true, tshirts: allTshirts });
  } catch (error) {
    console.error("Error fetching tshirts:", error);
    res.status(500).json({ success: false, error: "Failed to fetch t-shirts" });
  }
});

// Get Gamepasses created by user
app.get("/gamepasses/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    
    const gamesResponse = await fetch(
      `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=50&sortOrder=Asc`
    );
    const gamesData = await gamesResponse.json();
    
    let allGamepasses = [];
    
    if (gamesData.data && gamesData.data.length > 0) {
      for (const game of gamesData.data.slice(0, 10)) {
        try {
          const universeId = game.id;
          
          const passesResponse = await fetch(
            `https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc`
          );
          const passesData = await passesResponse.json();
          
          if (passesData.data) {
            for (const pass of passesData.data) {
              try {
                const priceResponse = await fetch(
                  `https://economy.roblox.com/v1/game-passes/${pass.id}/product-info`
                );
                const priceData = await priceResponse.json();
                
                if (priceData.PriceInRobux && priceData.PriceInRobux > 0 && priceData.IsForSale) {
                  allGamepasses.push({
                    id: pass.id,
                    name: pass.name,
                    price: priceData.PriceInRobux,
                    type: "gamepass"
                  });
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }
    
    allGamepasses.sort((a, b) => a.price - b.price);
    
    res.json({ success: true, gamepasses: allGamepasses });
  } catch (error) {
    console.error("Error fetching gamepasses:", error);
    res.status(500).json({ success: false, error: "Failed to fetch gamepasses" });
  }
});

// Get BOTH T-Shirts AND Gamepasses
app.get("/donations/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    let allItems = [];
    
    // ===== T-SHIRTS =====
    
    // Method 1: Catalog search
    try {
      const tshirtUrl = `https://catalog.roblox.com/v1/search/items/details?Category=3&CreatorTargetId=${userId}&CreatorType=1&Limit=30&SortType=0`;
      const tshirtResponse = await fetch(tshirtUrl);
      const tshirtData = await tshirtResponse.json();
      
      if (tshirtData.data) {
        for (const item of tshirtData.data) {
          if (item.price && item.price > 0) {
            allItems.push({
              id: item.id,
              name: item.name,
              price: item.price,
              type: "tshirt"
            });
          }
        }
      }
    } catch (e) {
      console.error("Catalog search failed:", e);
    }
    
    // Method 2: User's created T-Shirts via inventory API
    try {
      const url = `https://www.roblox.com/users/inventory/list-json?assetTypeId=2&cursor=&itemsPerPage=100&pageNumber=1&userId=${userId}`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      const data = await response.json();
      
      if (data.Data && data.Data.Items) {
        for (const item of data.Data.Items) {
          // Only items created by this user
          if (item.Creator && item.Creator.Id === parseInt(userId)) {
            if (item.Product && item.Product.PriceInRobux && item.Product.PriceInRobux > 0 && item.Product.IsForSale) {
              // Check not already added
              if (!allItems.find(t => t.id === item.Item.AssetId)) {
                allItems.push({
                  id: item.Item.AssetId,
                  name: item.Item.Name,
                  price: item.Product.PriceInRobux,
                  type: "tshirt"
                });
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("Inventory API failed:", e);
    }
    
    // ===== GAMEPASSES =====
    
    try {
      const gamesResponse = await fetch(
        `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=50&sortOrder=Asc`
      );
      const gamesData = await gamesResponse.json();
      
      if (gamesData.data && gamesData.data.length > 0) {
        for (const game of gamesData.data.slice(0, 10)) {
          try {
            const universeId = game.id;
            
            const passesResponse = await fetch(
              `https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc`
            );
            const passesData = await passesResponse.json();
            
            if (passesData.data) {
              for (const pass of passesData.data) {
                try {
                  const priceResponse = await fetch(
                    `https://economy.roblox.com/v1/game-passes/${pass.id}/product-info`
                  );
                  const priceData = await priceResponse.json();
                  
                  if (priceData.PriceInRobux && priceData.PriceInRobux > 0 && priceData.IsForSale) {
                    allItems.push({
                      id: pass.id,
                      name: pass.name,
                      price: priceData.PriceInRobux,
                      type: "gamepass"
                    });
                  }
                } catch (e) {}
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error("Error fetching gamepasses:", e);
    }
    
    // Sort by price
    allItems.sort((a, b) => a.price - b.price);
    
    console.log(`Found ${allItems.length} items for user ${userId}`);
    
    res.json({ success: true, items: allItems });
  } catch (error) {
    console.error("Error fetching donations:", error);
    res.status(500).json({ success: false, error: "Failed to fetch donation items" });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Donation Proxy running on port ${PORT}`);
});
