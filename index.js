const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const delay = ms => new Promise(res => setTimeout(res, ms));

const baseUrl = "https://www.roproxy.com/users/inventory/list-json?assetTypeId=34&cursor=&itemsPerPage=100&pageNumber=%s&userId=%s";

// Recursive function to get all gamepasses (matching the Lua script pattern)
async function getUserCreatedGamepassesRecursive(userId, gamepasses = [], pageNumber = 1, lastLength = Infinity) {
  const requestUrl = baseUrl.replace('%s', pageNumber).replace('%s', userId);
  
  try {
    const response = await fetch(requestUrl);
    
    if (!response.ok) {
      console.log(`Request failed with status: ${response.status}`);
      return gamepasses;
    }
    
    const text = await response.text();
    
    if (!text) {
      return gamepasses;
    }
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.log("Failed to parse JSON:", e.message);
      return gamepasses;
    }
    
    if (!data || !data.Data || !Array.isArray(data.Data.Items)) {
      return gamepasses;
    }
    
    const items = data.Data.Items;
    console.log(`Page ${pageNumber}: Found ${items.length} items`);
    
    // Filter and add gamepasses created by this user (matching Lua logic)
    for (const gamepass of items) {
      if (gamepass.Creator && gamepass.Creator.Id === userId) {
        gamepasses.push(gamepass.Item.AssetId);
      }
    }
    
    // Recursive call if there are more items (matching Lua pattern)
    if (items.length > 0 && items.length >= lastLength) {
      await delay(100); // Rate limiting
      return getUserCreatedGamepassesRecursive(userId, gamepasses, pageNumber + 1, items.length);
    }
    
    return gamepasses;
    
  } catch (err) {
    console.log("Error fetching gamepasses:", err.message);
    return gamepasses;
  }
}

// Function to get gamepass details (price, name, etc.)
async function getGamepassDetails(assetId) {
  try {
    const productRes = await fetch(
      `https://api.roproxy.com/marketplace/productinfo?assetId=${assetId}`
    );
    
    if (!productRes.ok) {
      return null;
    }
    
    const productData = await productRes.json();
    const price = productData.PriceInRobux;
    const isForSale = productData.IsForSale;
    
    if (isForSale && typeof price === 'number' && price > 0) {
      return {
        id: assetId,
        name: productData.Name || "Gamepass",
        price: price,
        type: 'gamepass'
      };
    }
    
    return null;
  } catch (err) {
    console.log("Error fetching details for", assetId, ":", err.message);
    return null;
  }
}

// GET /donations/:userId
app.get('/donations/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const limit = parseInt(req.query.limit, 10) || 50;

  if (!userId || isNaN(userId)) {
    return res.json({ success: false, error: 'Invalid userId', items: [] });
  }

  console.log(`Fetching gamepasses for userId: ${userId}`);

  try {
    // Step 1: Get all gamepass IDs created by user (using the Lua script method)
    const gamepassIds = await getUserCreatedGamepassesRecursive(userId);
    
    console.log(`Found ${gamepassIds.length} gamepasses created by user ${userId}`);
    
    // Step 2: Get details for each gamepass
    const allItems = [];
    
    for (const assetId of gamepassIds) {
      if (allItems.length >= limit) break;
      
      const details = await getGamepassDetails(assetId);
      
      if (details) {
        allItems.push(details);
      }
      
      await delay(50); // Rate limiting
    }

    console.log(`Returning ${allItems.length} items for user ${userId}`);
    res.json({ success: true, items: allItems });

  } catch (err) {
    console.error("Error:", err.message);
    res.json({ success: false, error: err.message, items: [] });
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('Donation proxy is running!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
