app.get("/donations/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!userId || Number.isNaN(userId)) {
      return res.status(400).json({ success: false, error: "Invalid userId" });
    }

    // Optional limit from query (?limit=50)
    const limitParam = parseInt(req.query.limit || "0", 10);
    const maxReturn = !Number.isNaN(limitParam) && limitParam > 0 ? limitParam : Infinity;

    let allItems = [];
    console.log(`\n=== Fetching donations (gamepasses) for user ${userId} ===`);

    // ----------------------------------------
    // STEP 1: Fetch ALL inventory pages of assetTypeId=34 (gamepasses)
    // ----------------------------------------
    let pageNumber = 1;
    const maxPages = 50; // safety cap to avoid infinite loops
    let keepGoing = true;

    while (keepGoing && pageNumber <= maxPages && allItems.length < maxReturn) {
      const url = `https://www.roproxy.com/users/inventory/list-json?assetTypeId=34&cursor=&itemsPerPage=100&pageNumber=${pageNumber}&userId=${userId}`;
      console.log(`Fetching inventory page ${pageNumber} for user ${userId}`);

      let response;
      let text;
      try {
        response = await fetch(url);
        text = await response.text();
      } catch (err) {
        console.error("Error fetching inventory page:", err.message);
        break;
      }

      if (!response.ok) {
        console.log(`Inventory fetch failed: ${response.status} ${response.statusText}`);
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
      console.log(`Page ${pageNumber} has ${items.length} items`);

      // If this page is empty, assume we've reached the end
      if (items.length === 0) {
        keepGoing = false;
        break;
      }

      for (const invItem of items) {
        if (allItems.length >= maxReturn) {
          keepGoing = false;
          break;
        }

        const creatorId = invItem.Creator?.Id;
        if (creatorId !== userId) {
          // Only gamepasses actually created by this user
          continue;
        }

        const assetId = invItem.Item?.AssetId;
        const name = invItem.Item?.Name || "Gamepass";
        if (!assetId) continue;

        // OPTIONAL: If you don't need price/for-sale info from Roblox HTTP,
        // you can skip the details fetch and let Roblox MarketplaceService
        // handle "is this for sale" when prompting purchase.
        //
        // For now, we only include passes that have a price > 0.

        let price = 0;
        try {
          const detailsRes = await fetch(
            `https://apis.roproxy.com/marketplace/v1/items/details?itemIds=${assetId}`
          );
          const detailsText = await detailsRes.text();

          if (!detailsRes.ok) {
            console.log(`Details fetch failed for ${assetId}: ${detailsRes.status}`);
            continue;
          }

          let detailsData;
          try {
            detailsData = JSON.parse(detailsText);
          } catch (e) {
            console.log("Failed to parse details JSON for", assetId, ":", e.message);
            continue;
          }

          if (Array.isArray(detailsData) && detailsData.length > 0) {
            const d = detailsData[0];
            price = typeof d.price === "number" ? d.price : 0;
          }
        } catch (err) {
          console.log("Error fetching details for", assetId, ":", err.message);
          continue;
        }

        if (price > 0) {
          allItems.push({
            id: assetId,
            name,
            price,
            type: "gamepass",
          });
        }

        // Small delay to be nice to the API
        await delay(50);
      }

      pageNumber += 1;
      await delay(100);
    }

    // ----------------------------------------
    // STEP 2: Dedupe, sort, trim, respond
    // ----------------------------------------
    const uniqueItems = [];
    const seen = new Set();
    for (const item of allItems) {
      const key = `${item.type}_${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueItems.push(item);
      }
    }

    // Sort by price ascending
    uniqueItems.sort((a, b) => a.price - b.price);

    // Respect maxReturn / ?limit=
    const finalItems =
      Number.isFinite(maxReturn) && uniqueItems.length > maxReturn
        ? uniqueItems.slice(0, maxReturn)
        : uniqueItems;

    console.log(
      `Found ${finalItems.length} valid created gamepasses for user ${userId} (before dedupe: ${allItems.length})`
    );

    res.json({
      success: true,
      items: finalItems,
      count: finalItems.length,
    });
  } catch (error) {
    console.error("Error in donations endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to fetch donation items" });
  }
});
