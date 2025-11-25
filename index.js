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

// Get gamepasses for a specific universe
app.get("/game-passes/:universeId", async (req, res) => {
  try {
    const universeId = req.params.universeId;
    
    // Try multiple endpoints
    let gamepasses = [];
    
    // Method 1: games.roblox.com v1
    try {
      const response = await fetch(
        `https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc`
      );
      const data = await response.json();
      if (data.data) {
        gamepasses = data.data;
      }
    } catch (e) {}
    
    // Method 2: apis.roblox.com (newer)
    if (gamepasses.length === 0) {
      try {
        const response = await fetch(
          `https://apis.roblox.com/game-passes/v1/game-passes?universeIds=${universeId}`
        );
        const data = await response.json();
        if (data.data) {
          gamepasses = data.data;
        }
      } catch (e) {}
    }
    
    res.json({ success: true, gamepasses: gamepasses });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch gamepasses" });
  }
});

// Main donations endpoint
app.get("/donations/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    let allItems = [];
    
    // Get user's games
    const gamesResponse = await fetch(
      `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=50&sortOrder=Asc`
    );
    const gamesData = await gamesResponse.json();
    
    console.log(`Found ${gamesData.data ? gamesData.data.length : 0} games for user ${userId}`);
    
    if (gamesData.data && gamesData.data.length > 0) {
      for (const game of gamesData.data.slice(0, 15)) {
        try {
          const universeId = game.id;
          const rootPlaceId = game.rootPlace ? game.rootPlace.id : null;
          
          console.log(`Checking game: ${game.name} (Universe: ${universeId}, Place: ${rootPlaceId})`);
          
          // Method 1: Try with universe ID on games.roblox.com
          let passesData = null;
          try {
            const passesResponse = await fetch(
              `https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc`
            );
            passesData = await passesResponse.json();
          } catch (e) {}
          
          // Method 2: Try www.roblox.com/games/getgamepasses
          if (!passesData || !passesData.data || passesData.data.length === 0) {
            if (rootPlaceId) {
              try {
                const passesResponse = await fetch(
                  `https://www.roblox.com/games/getgamepasses?placeId=${rootPlaceId}&startIndex=0&maxRows=100`
                );
                const rawData = await passesResponse.json();
                if (rawData && rawData.data) {
                  passesData = { data: rawData.data };
                }
              } catch (e) {}
            }
          }
          
          // Method 3: economy.roblox.com
          if (!passesData || !passesData.data || passesData.data.length === 0) {
            try {
              const passesResponse = await fetch(
                `https://economy.roblox.com/v1/universes/${universeId}/game-passes?limit=100&sortOrder=Asc`
              );
              passesData = await passesResponse.json();
            } catch (e) {}
          }
          
          // Process gamepasses
          if (passesData && passesData.data && passesData.data.length > 0) {
            console.log(`Found ${passesData.data.length} passes for ${game.name}`);
            
            for (const pass of passesData.data) {
              try {
                // Get pass ID (different APIs return it differently)
                const passId = pass.id || pass.Id || pass.gamePassId || pass.GamePassId;
                const passName = pass.name || pass.Name;
                
                if (!passId) continue;
                
                // Get price info
                let price = pass.price || pass.Price || pass.PriceInRobux || null;
                let isForSale = pass.isForSale || pass.IsForSale || true;
                
                // If no price, fetch it
                if (price === null) {
                  try {
                    const priceResponse = await fetch(
                      `https://economy.roblox.com/v1/game-passes/${passId}/product-info`
                    );
                    const priceData = await priceResponse.json();
                    price = priceData.PriceInRobux;
                    isForSale = priceData.IsForSale;
                  } catch (e) {}
                }
                
                // Add if valid
                if (price && price > 0 && isForSale) {
                  allItems.push({
                    id: passId,
                    name: passName || "Gamepass",
                    price: price,
                    type: "gamepass"
                  });
                  console.log(`Added gamepass: ${passName} - R$${price}`);
                }
              } catch (e) {}
            }
          }
        } catch (e) {
          console.error(`Error processing game:`, e);
        }
      }
    }
    
    // Remove duplicates
    const uniqueItems = [];
    const seenIds = new Set();
    for (const item of allItems) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        uniqueItems.push(item);
      }
    }
    
    // Sort by price
    uniqueItems.sort((a, b) => a.price - b.price);
    
    console.log(`Total: ${uniqueItems.length} gamepasses for user ${userId}`);
    
    res.json({ success: true, items: uniqueItems });
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
