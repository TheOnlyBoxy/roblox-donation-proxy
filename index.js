app.get("/donations/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!userId || Number.isNaN(userId)) {
      return res.status(400).json({ success: false, error: "Invalid userId" });
    }

    const limitParam = parseInt(req.query.limit || "0", 10);
    const maxReturn = !Number.isNaN(limitParam) && limitParam > 0 ? limitParam : Infinity;

    console.log(`\n=== FETCHING DONATIONS (GAMEPASSES) FOR USER ${userId} ===`);

    const allItems = [];

    // Helper: add an item if not already present (by id + type)
    const pushItem = (item) => {
      allItems.push(item);
    };

    // Small delay helper
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    // ----------------------------------------------------
    // PART 1: INVENTORY-BASED GAMEPASSES (assetTypeId=34)
    // ----------------------------------------------------
    console.log("\n--- PART 1: INVENTORY GAMEPASSES ---");
    try {
      let pageNumber = 1;
      const maxPages = 50;
      let keepGoing = true;

      while (keepGoing && pageNumber <= maxPages && allItems.length < maxReturn) {
        const url = `https://www.roproxy.com/users/inventory/list-json?assetTypeId=34&cursor=&itemsPerPage=100&pageNumber=${pageNumber}&userId=${userId}`;
        console.log(`[INV PAGE ${pageNumber}] URL: ${url}`);

        let response;
        let text;
        try {
          response = await fetch(url);
          text = await response.text();
        } catch (err) {
          console.error(`[INV PAGE ${pageNumber}] ERROR fetching inventory:`, err.message);
          break;
        }

        console.log(
          `[INV PAGE ${pageNumber}] Status: ${response.status} ${response.statusText}`
        );

        if (!response.ok) {
          console.log(
            `[INV PAGE ${pageNumber}] Body snippet:`,
            text.slice(0, 300)
          );
          break;
        }

        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.log(`[INV PAGE ${pageNumber}] JSON parse error:`, e.message);
          console.log(`[INV PAGE ${pageNumber}] Raw (first 300):`, text.slice(0, 300));
          break;
        }

        if (!data || !data.Data || !Array.isArray(data.Data.Items)) {
          console.log(
            `[INV PAGE ${pageNumber}] Unexpected shape. data.Data:`,
            JSON.stringify(data.Data, null, 2).slice(0, 500)
          );
          break;
        }

        const items = data.Data.Items;
        console.log(`[INV PAGE ${pageNumber}] Items count:`, items.length);

        if (items.length === 0) {
          console.log(`[INV PAGE ${pageNumber}] No more inventory items; stopping.`);
          keepGoing = false;
          break;
        }

        for (const invItem of items) {
          if (allItems.length >= maxReturn) {
            console.log(
              `[INV PAGE ${pageNumber}] Reached maxReturn (${maxReturn}); stopping.`
            );
            keepGoing = false;
            break;
          }

          const creatorId = invItem.Creator?.Id;
          const assetId = invItem.Item?.AssetId;
          const name = invItem.Item?.Name || "Gamepass";

          if (!assetId) continue;
          if (creatorId !== userId) continue;

          // Get price
          let price = 0;
          try {
            const detailsUrl = `https://apis.roproxy.com/marketplace/v1/items/details?itemIds=${assetId}`;
            const detailsRes = await fetch(detailsUrl);
            const detailsText = await detailsRes.text();

            if (!detailsRes.ok) {
              console.log(
                `[INV PAGE ${pageNumber}] Details fail for ${assetId}:`,
                detailsRes.status,
                detailsRes.statusText
              );
              continue;
            }

            let detailsData;
            try {
              detailsData = JSON.parse(detailsText);
            } catch (e) {
              console.log(
                `[INV PAGE ${pageNumber}] Details JSON error for ${assetId}:`,
                e.message
              );
              continue;
            }

            if (Array.isArray(detailsData) && detailsData.length > 0) {
              const d = detailsData[0];
              price = typeof d.price === "number" ? d.price : 0;
            }
          } catch (err) {
            console.log(
              `[INV PAGE ${pageNumber}] Error fetching details for ${assetId}:`,
              err.message
            );
            continue;
          }

          if (price <= 0) continue;

          pushItem({
            id: assetId,
            name,
            price,
            type: "gamepass",
            source: "inventory",
          });
        }

        pageNumber += 1;
        await delay(100);
      }
    } catch (err) {
      console.error("Error in inventory pass:", err.message);
    }

    // ----------------------------------------------------
    // PART 2: GAME-BASED GAMEPASSES (per universe)
    // ----------------------------------------------------
    console.log("\n--- PART 2: PER-GAME GAMEPASSES ---");
    try {
      // 1) Get games (universes) owned by the user
      const gamesUrl = `https://games.roproxy.com/v2/users/${userId}/games?accessFilter=Public&limit=50&sortOrder=Asc`;
      console.log("[GAMES] URL:", gamesUrl);

      const gamesRes = await fetch(gamesUrl);
      const gamesText = await gamesRes.text();
      console.log("[GAMES] Status:", gamesRes.status, gamesRes.statusText);

      if (gamesRes.ok) {
        let gamesData;
        try {
          gamesData = JSON.parse(gamesText);
        } catch (e) {
          console.log("[GAMES] JSON parse error:", e.message);
          console.log("[GAMES] Raw (first 300):", gamesText.slice(0, 300));
          gamesData = null;
        }

        if (gamesData && Array.isArray(gamesData.data)) {
          console.log("[GAMES] Count:", gamesData.data.length);

          for (const game of gamesData.data) {
            const universeId = game.id;
            const gameName = game.name;
            console.log(
              `[GAME] UniverseId=${universeId}, Name="${gameName}"`
            );

            // For each universe, fetch gamepasses
            // Note: this endpoint shape may vary; adjust if needed
            const gpUrl = `https://apis.roproxy.com/game-passes/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc`;
            console.log(`[GAMEPASSES] URL for universe ${universeId}:`, gpUrl);

            try {
              const gpRes = await fetch(gpUrl);
              const gpText = await gpRes.text();
              console.log(
                `[GAMEPASSES] Status for universe ${universeId}:`,
                gpRes.status,
                gpRes.statusText
              );

              if (!gpRes.ok) {
                console.log(
                  `[GAMEPASSES] Body snippet for universe ${universeId}:`,
                  gpText.slice(0, 300)
                );
                continue;
              }

              let gpData;
              try {
                gpData = JSON.parse(gpText);
              } catch (e) {
                console.log(
                  `[GAMEPASSES] JSON parse error for universe ${universeId}:`,
                  e.message
                );
                console.log(
                  `[GAMEPASSES] Raw (first 300):`,
                  gpText.slice(0, 300)
                );
                continue;
              }

              if (!gpData || !Array.isArray(gpData.data || gpData.gamePasses)) {
                console.log(
                  `[GAMEPASSES] Unexpected shape for universe ${universeId}:`,
                  JSON.stringify(gpData, null, 2).slice(0, 500)
                );
                continue;
              }

              const passes = gpData.data || gpData.gamePasses;
              console.log(
                `[GAMEPASSES] Universe ${universeId} has ${passes.length} passes`
              );

              for (const pass of passes) {
                if (allItems.length >= maxReturn) {
                  console.log(
                    `[GAMEPASSES] Reached maxReturn (${maxReturn}); stopping per-game passes.`
                  );
                  break;
                }

                const passId = pass.id || pass.gamePassId;
                const passName = pass.name || "Gamepass";
                const creatorId = pass.creator?.id || pass.creator?.creatorId;
                const creatorType = pass.creator?.type || pass.creator?.creatorType;
                const isForSale =
                  pass.isForSale === true ||
                  pass.isForSale === "ForSale" ||
                  pass.isPurchasable === true;

                // Log every pass
                console.log(
                  `[GAMEPASSES] PassId=${passId}, Name="${passName}", CreatorId=${creatorId}, CreatorType=${creatorType}, isForSale=${isForSale}`
                );

                if (!passId) continue;
                if (creatorId !== userId) continue;
                if (!isForSale) continue;

                // Get price if not directly present
                let price = pass.price;
                if (typeof price !== "number") {
                  try {
                    const detailsUrl = `https://apis.roproxy.com/marketplace/v1/items/details?itemIds=${passId}`;
                    const detailsRes = await fetch(detailsUrl);
                    const detailsText = await detailsRes.text();

                    if (!detailsRes.ok) {
                      console.log(
                        `[GAMEPASSES] Details fail for ${passId}:`,
                        detailsRes.status,
                        detailsRes.statusText
                      );
                      continue;
                    }

                    let detailsData;
                    try {
                      detailsData = JSON.parse(detailsText);
                    } catch (e) {
                      console.log(
                        `[GAMEPASSES] Details JSON error for ${passId}:`,
                        e.message
                      );
                      continue;
                    }

                    if (Array.isArray(detailsData) && detailsData.length > 0) {
                      const d = detailsData[0];
                      price = typeof d.price === "number" ? d.price : 0;
                    }
                  } catch (err) {
                    console.log(
                      `[GAMEPASSES] Error fetching details for ${passId}:`,
                      err.message
                    );
                    continue;
                  }
                }

                if (typeof price !== "number" || price <= 0) continue;

                pushItem({
                  id: passId,
                  name: passName,
                  price,
                  type: "gamepass",
                  source: `universe:${universeId}`,
                });

                await delay(50);
              }
            } catch (err) {
              console.log(
                `[GAMEPASSES] Error fetching for universe ${universeId}:`,
                err.message
              );
            }

            await delay(100);
          }
        } else {
          console.log("[GAMES] No games data or not an array");
        }
      } else {
        console.log("[GAMES] Non-OK response. Body snippet:", gamesText.slice(0, 300));
      }
    } catch (err) {
      console.error("Error in per-game pass fetch:", err.message);
    }

    // ----------------------------------------------------
    // PART 3: Dedupe / sort / trim / respond
    // ----------------------------------------------------
    console.log(`\n[SUMMARY] Collected before dedupe: ${allItems.length}`);

    const uniqueItems = [];
    const seen = new Set();
    for (const item of allItems) {
      const key = `gamepass_${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueItems.push(item);
      } else {
        console.log(`[SUMMARY] Duplicate pass skipped: ${key} (source=${item.source})`);
      }
    }

    uniqueItems.sort((a, b) => a.price - b.price);

    const finalItems =
      Number.isFinite(maxReturn) && uniqueItems.length > maxReturn
        ? uniqueItems.slice(0, maxReturn)
        : uniqueItems;

    console.log(
      `[SUMMARY] Final items count: ${finalItems.length}. First few:`,
      JSON.stringify(finalItems.slice(0, 5), null, 2)
    );

    res.json({
      success: true,
      items: finalItems.map(({ source, ...rest }) => rest), // strip 'source' from response if you want
      count: finalItems.length,
    });
  } catch (error) {
    console.error("Error in donations endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to fetch donation items" });
  }
});
