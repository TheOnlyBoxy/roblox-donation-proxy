app.get("/donations/:userId", async (req, res) => {
  console.log("\n==== /donations route hit ====");
  try {
    const userId = parseInt(req.params.userId, 10);
    console.log("Parsed userId:", userId, "raw:", req.params.userId);

    if (!userId || Number.isNaN(userId)) {
      console.log("Invalid userId");
      return res.status(400).json({ success: false, error: "Invalid userId" });
    }

    const limitParam = parseInt(req.query.limit || "0", 10);
    const maxReturn =
      !Number.isNaN(limitParam) && limitParam > 0 ? limitParam : Infinity;

    console.log("maxReturn from query ?limit=", maxReturn);

    let allItems = [];

    // ----------------------------------------
    // STEP 1: Get gamepasses the user CREATED
    // using inventory/list-json (assetTypeId=34)
    // ----------------------------------------
    try {
      let pageNumber = 1;
      const maxPages = 10; // safety cap
      let keepGoing = true;

      while (keepGoing && pageNumber <= maxPages && allItems.length < maxReturn) {
        const url = `https://www.roproxy.com/users/inventory/list-json?assetTypeId=34&cursor=&itemsPerPage=100&pageNumber=${pageNumber}&userId=${userId}`;
        console.log(`Fetching inventory page ${pageNumber}: ${url}`);

        let response, text;
        try {
          response = await fetch(url);
          text = await response.text();
        } catch (err) {
          console.error("Network error fetching inventory:", err.message);
          break;
        }

        console.log(
          `Inventory page ${pageNumber} status: ${response.status} ${response.statusText}`
        );
        // Just log first 300 chars so logs aren't huge
        console.log(
          `Inventory raw body (first 300 chars) page ${pageNumber}:`,
          text.slice(0, 300)
        );

        if (!response.ok) {
          console.log(
            `Inventory fetch failed: ${response.status} ${response.statusText}`
          );
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

        // If no items, we're probably at the end
        if (items.length === 0) {
          console.log("No more items, stopping pagination");
          keepGoing = false;
          break;
        }

        for (const item of items) {
          const creatorId = item.Creator?.Id;
          const assetId = item.Item?.AssetId;
          const name = item.Item?.Name || "Gamepass";

          console.log(
            `Item from inventory: assetId=${assetId}, name="${name}", CreatorId=${creatorId}`
          );

          // DevForum logic: only include passes where Creator.Id == userId
          if (creatorId !== userId) {
            console.log(
              `  -> SKIP: creatorId ${creatorId} != requested userId ${userId}`
            );
            continue;
          }

          if (!assetId) {
            console.log("  -> SKIP: no AssetId");
            continue;
          }

          // We still need price info; get via product info
          try {
            const detailsUrl = `https://apis.roproxy.com/marketplace/v1/items/details?itemIds=${assetId}`;
            console.log(`  Fetching details for ${assetId}: ${detailsUrl}`);

            const detailsRes = await fetch(detailsUrl);
            const detailsText = await detailsRes.text();

            console.log(
              `  Details status for ${assetId}: ${detailsRes.status} ${detailsRes.statusText}`
            );

            if (!detailsRes.ok) {
              console.log(
                `  -> SKIP: Details fetch failed for ${assetId}: ${detailsRes.status}`
              );
              continue;
            }

            let detailsData;
            try {
              detailsData = JSON.parse(detailsText);
            } catch (e) {
              console.log("  -> SKIP: Failed to parse details JSON:", e.message);
              continue;
            }

            if (!Array.isArray(detailsData) || detailsData.length === 0) {
              console.log("  -> SKIP: detailsData empty");
              continue;
            }

            const d = detailsData[0];
            const price = d.price;
            const isForSale =
              d.saleLocation === "AllUniverses" ||
              d.saleLocation === "ExperiencesDevApiOnly";

            console.log(
              `  Details for ${assetId}: price=${price}, saleLocation=${d.saleLocation}, isForSale=${isForSale}`
            );

            if (isForSale && typeof price === "number" && price > 0) {
              console.log(
                `  -> ADD: ${assetId} "${name}" price=${price} (created by user)`
              );
              allItems.push({
                id: assetId,
                name,
                price,
                type: "gamepass",
              });
            } else {
              console.log(
                `  -> SKIP: not for sale or invalid price (price=${price})`
              );
            }
          } catch (err) {
            console.log("  -> SKIP: Error fetching details for", assetId, ":", err.message);
          }

          // Tiny delay to be nicer to the API
          await delay(50);
        }

        pageNumber += 1;
        await delay(100);
      }
    } catch (err) {
      console.error("Error fetching user-created gamepasses:", err.message);
    }

    console.log("Collected items count (before dedupe):", allItems.length);

    // Dedupe & sort
    const uniqueItems = [];
    const seen = new Set();
    for (const item of allItems) {
      const key = `gamepass_${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueItems.push(item);
      }
    }

    uniqueItems.sort((a, b) => a.price - b.price);

    const finalItems =
      Number.isFinite(maxReturn) && uniqueItems.length > maxReturn
        ? uniqueItems.slice(0, maxReturn)
        : uniqueItems;

    console.log("Final items count (after dedupe & limit):", finalItems.length);
    console.log("First few items:", JSON.stringify(finalItems.slice(0, 5), null, 2));

    res.json({
      success: true,
      items: finalItems,
      count: finalItems.length,
    });
  } catch (error) {
    console.error("Error in donations endpoint:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch donation items" });
  }
});
