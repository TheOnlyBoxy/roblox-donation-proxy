const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const delay = ms => new Promise(res => setTimeout(res, ms));

// Common inventory URL (same as your original one)
const inventoryBaseUrl = (pageNumber, userId) =>
  `https://www.roproxy.com/users/inventory/list-json?assetTypeId=34&cursor=&itemsPerPage=100&pageNumber=${pageNumber}&userId=${userId}`;

// ---- Helper: fetch all gamepasses this user CREATED (no price filter) ----
async function getUserCreatedGamepasses(userId, pageLimit = 10) {
  const gamepasses = [];
  let pageNumber = 1;

  while (pageNumber <= pageLimit) {
    const url = inventoryBaseUrl(pageNumber, userId);
    console.log(`[INV] Requesting page ${pageNumber}: ${url}`);

    let response;
    let text;

    try {
      response = await fetch(url);
      text = await response.text();
    } catch (err) {
      console.log(`[INV] Request error on page ${pageNumber}:`, err.message);
      break;
    }

    console.log(`[INV] Page ${pageNumber} status:`, response.status);

    if (!response.ok) {
      console.log(`[INV] Non-OK response on page ${pageNumber}, stopping.`);
      break;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.log(`[INV] Failed to parse JSON on page ${pageNumber}:`, err.message);
      break;
    }

    if (!data || !data.Data || !Array.isArray(data.Data.Items)) {
      console.log(`[INV] No Data.Items array on page ${pageNumber}, stopping.`);
      break;
    }

    const items = data.Data.Items;
    console.log(`[INV] Page ${pageNumber}: ${items.length} total items`);

    if (items.length === 0) {
      console.log("[INV] Items array empty, stopping.");
      break;
    }

    let createdCount = 0;

    for (const item of items) {
      const creatorId = item.Creator?.Id;
      if (creatorId !== userId) continue;

      createdCount++;

      const assetId = item.Item?.AssetId;
      const name = item.Item?.Name || "Gamepass";

      if (!assetId) continue;

      gamepasses.push({ id: assetId, name });
    }

    console.log(
      `[INV] Page ${pageNumber}: ${createdCount} items where Creator.Id == ${userId}`
    );

    pageNumber++;
    await delay(100);
  }

  console.log(`[INV] Total created gamepasses found: ${gamepasses.length}`);
  return gamepasses;
}

// ---- Original donations route, now reusing helper + logging ----
app.get('/donations/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const limit = parseInt(req.query.limit, 10) || 50;

  if (!userId || isNaN(userId)) {
    return res.json({ success: false, error: 'Invalid userId', items: [] });
  }

  console.log(`[/donations] Fetching gamepasses for userId: ${userId}, limit: ${limit}`);

  const allItems = [];

  try {
    // 1) get gamepasses user CREATED
    const createdGamepasses = await getUserCreatedGamepasses(userId, 10);

    console.log(
      `[/donations] gamepasses created by user ${userId}: ${createdGamepasses.length}`
    );

    // 2) fetch details for each and apply price/for-sale filters
    for (const gp of createdGamepasses) {
      if (allItems.length >= limit) break;

      const assetId = gp.id;
      const fallbackName = gp.name;

      try {
        const productRes = await fetch(
          `https://api.roproxy.com/marketplace/productinfo?assetId=${assetId}`
        );
        const productText = await productRes.text();

        if (!productRes.ok) {
          console.log(
            `[/donations] productinfo failed for ${assetId}:`,
            productRes.status,
            productText.slice(0, 150)
          );
          continue;
        }

        let productData;
        try {
          productData = JSON.parse(productText);
        } catch (e) {
          console.log(
            `[/donations] Failed to parse productinfo JSON for ${assetId}:`,
            e.message
          );
          continue;
        }

        const price = productData.PriceInRobux;
        const isForSale = productData.IsForSale;

        if (isForSale && typeof price === 'number' && price > 0) {
          allItems.push({
            id: assetId,
            name: productData.Name || fallbackName,
            price: price,
            type: 'gamepass'
          });
        }
      } catch (err) {
        console.log(
          `[/donations] Error fetching details for ${assetId}:`,
          err.message
        );
      }

      await delay(50);
    }

    console.log(
      `[/donations] Returning ${allItems.length} donation items for user ${userId}`
    );
    res.json({ success: true, items: allItems });

  } catch (err) {
    console.error("[/donations] Error:", err.message);
    res.json({ success: false, error: err.message, items: [] });
  }
});

// ---- Debug route: show raw created gamepasses (no price filter) ----
app.get('/debug-gamepasses/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);

  if (!userId || isNaN(userId)) {
    return res.json({ success: false, error: 'Invalid userId', items: [] });
  }

  console.log(`[/debug-gamepasses] Checking created gamepasses for userId: ${userId}`);

  try {
    const gps = await getUserCreatedGamepasses(userId, 10);
    res.json({
      success: true,
      count: gps.length,
      items: gps
    });
  } catch (err) {
    console.error("[/debug-gamepasses] Error:", err.message);
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
