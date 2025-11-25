const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const delay = ms => new Promise(res => setTimeout(res, ms));

// GET /donations/:userId
app.get('/donations/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const limit = parseInt(req.query.limit, 10) || 50;

  if (!userId || isNaN(userId)) {
    return res.json({ success: false, error: 'Invalid userId', items: [] });
  }

  console.log(`Fetching gamepasses for userId: ${userId}`);

  const allItems = [];

  try {
    let pageNumber = 1;
    const maxPages = 10;
    let keepGoing = true;

    while (keepGoing && pageNumber <= maxPages && allItems.length < limit) {
      const url = `https://www.roproxy.com/users/inventory/list-json?assetTypeId=34&cursor=&itemsPerPage=100&pageNumber=${pageNumber}&userId=${userId}`;
      
      const response = await fetch(url);
      const text = await response.text();

      if (!response.ok) {
        console.log(`Inventory fetch failed: ${response.status}`);
        break;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.log("Failed to parse inventory JSON:", e.message);
        break;
      }

      if (!data || !data.Data || !Array.isArray(data.Data.Items)) {
        console.log("No Data.Items array in inventory response");
        break;
      }

      const items = data.Data.Items;
      console.log(`Page ${pageNumber}: ${items.length} items`);

      if (items.length === 0) {
        break;
      }

      for (const item of items) {
        // Only include passes created by this user
        const creatorId = item.Creator?.Id;
        if (creatorId !== userId) continue;

        const assetId = item.Item?.AssetId;
        const name = item.Item?.Name || "Gamepass";

        if (!assetId) continue;

        try {
          const detailsRes = await fetch(
            `https://economy.roproxy.com/v1/assets/${assetId}/resale-data`
          );
          
          // Try getting price from product info instead
          const productRes = await fetch(
            `https://api.roproxy.com/marketplace/productinfo?assetId=${assetId}`
          );
          const productText = await productRes.text();
          
          if (productRes.ok) {
            const productData = JSON.parse(productText);
            const price = productData.PriceInRobux;
            const isForSale = productData.IsForSale;

            if (isForSale && typeof price === 'number' && price > 0) {
              allItems.push({
                id: assetId,
                name: productData.Name || name,
                price: price,
                type: 'gamepass'
              });
            }
          }
        } catch (err) {
          console.log("Error fetching details for", assetId, ":", err.message);
        }

        if (allItems.length >= limit) break;
        await delay(50);
      }

      pageNumber++;
      await delay(100);
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
