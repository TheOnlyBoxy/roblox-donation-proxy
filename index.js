const express = require("express");
const fetch = require("node-fetch");
const app = express();

// Enable CORS
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
          price: item.price
        }));
      
      // Sort by price (lowest first)
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
