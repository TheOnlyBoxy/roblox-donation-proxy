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

// Get T-Shirts created by user
app.get("/tshirts/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const limit = req.query.limit || 20;
    
    const url = `https://catalog.roblox.com/v1/search/items/details?Category=3&CreatorTargetId=${userId}&CreatorType=1&Limit=${limit}&SortType=0`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.data) {
      const tshirts = data.data
        .filter(item => item.price && item.price > 0)
        .map(item => ({
          id: item.id,
          name: item.name,
          price: item.price,
          type: "tshirt"
        }));
      
      tshirts.sort((a, b) => a.price - b.price);
      
      res.json({ success: true, tshirts: tshirts });
    } else {
      res.json({ success: true, tshirts: [] });
    }
  } catch (error) {
    console.error("Error fetching tshirts:", error);
    res.status(500).json({ success: false, error: "Failed to fetch t-shirts" });
  }
});

// Get Gamepasses created by user (searches all their games)
app.get("/gamepasses/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // First get user's games/places
    const gamesResponse = await fetch(
      `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=50&sortOrder=Asc`
    );
    const gamesData = await gamesResponse.json();
    
    let allGamepasses = [];
    
    if (gamesData.data && gamesData.data.length > 0) {
      // For each game, get its gamepasses
      for (const game of gamesData.data) {
        try {
          const universeId = game.id;
          
          const passesResponse = await fetch(
            `https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc`
          );
          const passesData = await passesResponse.json();
          
          if (passesData.data) {
            for (const pass of passesData.data) {
              // Get price info for each pass
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
              } catch (e) {
                // Skip this pass if we can't get price
              }
            }
          }
        } catch (e) {
          // Skip this game if error
        }
      }
    }
    
    // Sort by price
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
    const limit = req.query.limit || 20;
    
    let allItems = [];
    
    // Fetch T-Shirts
    try {
      const tshirtUrl = `https://catalog.roblox.com/v1/search/items/details?Category=3&CreatorTargetId=${userId}&CreatorType=1&Limit=${limit}&SortType=0`;
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
      console.error("Error fetching tshirts:", e);
    }
    
    // Fetch Gamepasses
    try {
      const gamesResponse = await fetch(
        `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=10&sortOrder=Asc`
      );
      const gamesData = await gamesResponse.json();
      
      if (gamesData.data && gamesData.data.length > 0) {
        for (const game of gamesData.data.slice(0, 5)) { // Limit to 5 games for speed
          try {
            const universeId = game.id;
            
            const passesResponse = await fetch(
              `https://games.roblox.com/v1/games/${universeId}/game-passes?limit=20&sortOrder=Asc`
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
                } catch (e) {
                  // Skip
                }
              }
            }
          } catch (e) {
            // Skip
          }
        }
      }
    } catch (e) {
      console.error("Error fetching gamepasses:", e);
    }
    
    // Sort by price (lowest first)
    allItems.sort((a, b) => a.price - b.price);
    
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
