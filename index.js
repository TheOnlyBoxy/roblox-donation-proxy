const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const delay = ms => new Promise(res => setTimeout(res, ms));

// Optional: avoid very long hanging requests
app.use((req, res, next) => {
  res.setTimeout(120000); // 2 minutes
  next();
});

// Get gamepasses created by a specific user using catalog search
async function getUserGamepasses(userId, maxToFetch = 100) {
  const allIds = [];
  let cursor = '';
  let keepGoing = true;

  while (keepGoing && allIds.length < maxToFetch) {
    const url =
      `https://catalog.roproxy.com/v1/search/items` +
      `?category=GamePass&creatorType=User&creatorId=${userId}` +
      `&limit=30&cursor=${encodeURIComponent(cursor)}`;

    console.log("Requesting catalog page:", url);

    const response = await fetch(url);
    const text = await response.text();

    if (!response.ok) {
      console.log("Catalog fetch failed:", response.status, text.slice(0, 200));
      break;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.log("Failed to parse catalog JSON:", e.message);
      break;
    }

    if (!data || !Array.isArray(data.data)) {
      console.log("No data.data array in catalog response");
      break;
    }

    for (const item of data.data) {
      // Just in case, ensure it’s a gamepass and belongs to this user
      if (item.itemType === 'GamePass' &&
          item.creatorType === 'User' &&
          item.creatorTargetId === userId
      ) {
        allIds.push({
          id: item.id,
          name: item.name || 'Gamepass'
        });
      }
    }

    console.log(`Collected ${allIds.length} gamepass IDs so far`);

    if (!data.nextPageCursor) {
      keepGoing = false;
    } else {
      cursor = data.nextPageCursor;
      await delay(100);
    }
  }

  return allIds;
}

// Get product details (price, isForSale, final name)
async function getGamepassDetails(assetId, fallbackName = 'Gamepass') {
  try {
    const productRes = await fetch(
      `https://api.roproxy.com/marketplace/productinfo?assetId=${assetId}`
    );
    const text = await productRes.text();

    if (!productRes.ok) {
      console.log(`productinfo failed for ${assetId}:`, productRes.status, text.slice(0, 200));
      return null;
    }

    const productData = JSON.parse(text);
    const price = productData.PriceInRobux;
    const isForSale = productData.IsForSale;

    if (isForSale && typeof price === 'number' && price > 0) {
      return {
        id: assetId,
        name: productData.Name || fallbackName,
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

  console.log(`Fetching donations for userId: ${userId}, limit: ${limit}`);

  try {
    // Step 1: get gamepass IDs created by this user
    const ids = await getUserGamepasses(userId, limit * 3); // overfetch a bit
    console.log(`Found ${ids.length} gamepasses in catalog for user ${userId}`);

    // Step 2: get details & filter by for-sale + price > 0
    const items = [];
    for (const { id: assetId, name } of ids) {
      if (items.length >= limit) break;
      const details = await getGamepassDetails(assetId, name);
      if (details) {
        items.push(details);
      }
      await delay(50);
    }

    console.log(`Returning ${items.length} items for user ${userId}`);
    res.json({ success: true, items });

  } catch (err) {
    console.error("Error in /donations:", err.message);
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
