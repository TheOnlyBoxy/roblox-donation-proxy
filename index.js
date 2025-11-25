try {
  let pageNumber = 1;
  const maxPages = 10;
  let keepGoing = true;

  while (keepGoing && pageNumber <= maxPages) {
    const url = `https://www.roproxy.com/users/inventory/list-json?assetTypeId=34&cursor=&itemsPerPage=100&pageNumber=${pageNumber}&userId=${userId}`;
    console.log(`Fetching inventory page ${pageNumber}: ${url}`);

    const response = await fetch(url);
    const text = await response.text();
    console.log(`Raw inventory response for user ${userId}, page ${pageNumber}:`, text);

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

    if (items.length === 0) {
      keepGoing = false;
      break;
    }

    for (const item of items) {
      const creatorId = item.Creator?.Id;
      if (Number(creatorId) !== Number(userId)) continue;

      const assetId = item.Item?.AssetId;
      const name = item.Item?.Name || "Gamepass";
      if (!assetId) continue;

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
          console.log("Failed to parse details JSON:", e.message);
          continue;
        }

        if (!Array.isArray(detailsData) || detailsData.length === 0) continue;

        const d = detailsData[0];
        const price = d.price;
        const isForSale =
          d.saleLocation === "AllUniverses" ||
          d.saleLocation === "ExperiencesDevApiOnly";

        if (isForSale && typeof price === "number" && price > 0) {
          allItems.push({
            id: assetId,
            name,
            price,
            type: "gamepass",
          });
        }
      } catch (err) {
        console.log("Error fetching details for", assetId, ":", err.message);
      }

      await delay(50);
    }

    pageNumber += 1;
    await delay(100);
  }
} catch (err) {
  console.error("Error fetching user-created gamepasses:", err.message);
}
