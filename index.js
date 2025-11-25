const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "Donation Proxy Running!", time: new Date().toISOString() });
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Get user ID from username
app.get("/userid/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const response = await fetch("https://users.roproxy.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    });

    const data = await response.json();

    if (data.data && data.data.length > 0) {
      res.json({
        success: true,
        userId: data.data[0].id,
        username: data.data[0].name,
      });
    } else {
      res.json({ success: false, error: "User not found" });
    }
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user" });
  }
});

// Get user info by ID
app.get("/userinfo/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const response = await fetch(`https://users.roproxy.com/v1/users/${userId}`);
    const data = await response.json();
    if (data.id) {
      res.json({
        success: true,
        userId: data.id,
        username: data.name,
        displayName: data.displayName,
      });
    } else {
      res.json({ success: false, error: "User not found" });
    }
  } catch (error) {
    console.error("Error fetching user info:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user info" });
  }
});

// ============================================
// MAIN DONATIONS ENDPOINT (GAMEPASSES BY USER)
// ============================================
app.get("/donations/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    let allItems = [];

    console.log(`\n=== Fetching donations for user ${userId} ===`);

    // ----------------------------------------
    // STEP 1: Get gamepasses for the user (using gamePasses array)
    // ----------------------------------------
    try {
      const url = `https://apis.roproxy.com/game-passes/v1/users/${userId}/game-passes?count=100`;
      console.log(`Fetching gamepasses: ${url}`);

      const response = await fetch(url);
      const text = await response.text();
      console.log("Raw gamepass response for", userId, ":", text);

      if (!response.ok) {
        console.log(`Gamepass fetch failed: ${response.status} ${response.statusText}`);
      } else {
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.log("Failed to parse gamepass JSON:", e.message);
          data = null;
        }

        if (data && Array.isArray(data.gamePasses)) {
          for (const pass of data.gamePasses) {
            const passId = pass.gamePassId;
            const passName = pass.name || "Gamepass";
            const price = pass.price;
            const isForSale = pass.isForSale === true;

            const creatorId = pass.creator?.creatorId;
            const creatorType = pass.creator?.creatorType;

            // Only include passes actually created by this user
            if (creatorId !== userId || creatorType !== "User") {
              continue;
            }

            if (isForSale && typeof price === "number" && price > 0) {
              allItems.push({
                id: passId,
                name: passName,
                price: price,
                type: "gamepass",
              });
            }
          }
        } else {
          console.log("No gamePasses array in response or not an array");
        }
      }

      await delay(50);
    } catch (err) {
      console.error("Error fetching gamepasses:", err.message);
    }

    // ----------------------------------------
    // STEP 2: Cleanup and respond
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

    uniqueItems.sort((a, b) => a.price - b.price);
    console.log(`Found ${uniqueItems.length} valid items for user ${userId}.`);

    res.json({
      success: true,
      items: uniqueItems,
      count: uniqueItems.length,
    });
  } catch (error) {
    console.error("Error in donations endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to fetch donation items" });
  }
});

// ============================================
// DONATIONS BY GAME (UNIVERSE) ID
// ============================================
app.get("/donations/game/:universeId", async (req, res) => {
  const universeId = req.params.universeId;

  try {
    console.log(`\n=== Fetching donations for universe ${universeId} ===`);

    // STEP 1: Get game (universe) info to check the creator
    const gameInfoUrl = `https://games.roproxy.com/v1/games?universeIds=${universeId}`;
    console.log("Fetching game info:", gameInfoUrl);

    const gameInfoRes = await fetch(gameInfoUrl);
    const gameInfoText = await gameInfoRes.text();
    console.log("Raw game info response:", gameInfoText);

    if (!gameInfoRes.ok) {
      return res.status(500).json({
        success: false,
        error: `Failed to fetch game info: ${gameInfoRes.status} ${gameInfoRes.statusText}`,
      });
    }

    let gameInfo;
    try {
      gameInfo = JSON.parse(gameInfoText);
    } catch (e) {
      console.error("Failed to parse game info JSON:", e.message);
      return res.status(500).json({
        success: false,
        error: "Invalid JSON returned from game info API",
      });
    }

    if (!Array.isArray(gameInfo.data) || gameInfo.data.length === 0) {
      return res.json({ success: false, error: "Game (universe) not found" });
    }

    const game = gameInfo.data[0];
    const creator = game.creator;
    console.log("Game creator:", creator);

    // NOTE:
    // This block only allows USER-owned games.
    // If your game is group-owned, remove or change this check and see note below.
    if (!creator || creator.type !== "User") {
      return res.json({
        success: false,
        error: "Game is not owned by a user (probably group-owned). Adjust logic if you want group-owned games too.",
      });
    }

    const ownerUserId = creator.id; // ID of the user who owns the game
    console.log("Game owner userId:", ownerUserId);

    // STEP 2: Get all gamepasses for this universe (with pagination)
    let allItems = [];
    let cursor = null;

    while (true) {
      const params = new URLSearchParams({
        limit: "100",
      });
      if (cursor) params.set("cursor", cursor);

      const gamePassesUrl = `https://games.roproxy.com/v1/games/${universeId}/game-passes?${params.toString()}`;
      console.log("Fetching gamepasses for game:", gamePassesUrl);

      const gpRes = await fetch(gamePassesUrl);
      const gpText = await gpRes.text();
      console.log("Raw gamepasses response:", gpText);

      if (!gpRes.ok) {
        console.error("Failed to fetch gamepasses:", gpRes.status, gpRes.statusText);
        break;
      }

      let gpData;
      try {
        gpData = JSON.parse(gpText);
      } catch (e) {
        console.error("Failed to parse gamepasses JSON:", e.message);
        break;
      }

      if (!Array.isArray(gpData.data)) {
        console.log("No gamepasses 'data' array in response.");
        break;
      }

      for (const pass of gpData.data) {
        const passId = pass.id;
        const passName = pass.name || "Gamepass";
        const price = pass.price;
        const isForSale = pass.isForSale === true;

        // Creator of the gamepass itself
        const passCreatorId = pass.creator?.id;
        const passCreatorType = pass.creator?.type;

        // Only include passes which:
        // 1) Are for sale
        // 2) Have a valid positive price
        // 3) Are created by the SAME USER who owns the game
        if (
          isForSale &&
          typeof price === "number" &&
          price > 0 &&
          passCreatorType === "User" &&
          passCreatorId === ownerUserId
        ) {
          allItems.push({
            id: passId,
            name: passName,
            price: price,
            type: "gamepass",
          });
        }
      }

      // Pagination
      if (gpData.nextPageCursor) {
        cursor = gpData.nextPageCursor;
        await delay(50); // small delay between paginated requests
      } else {
        break;
      }
    }

    // STEP 3: De-duplicate and sort
    const uniqueItems = [];
    const seen = new Set();

    for (const item of allItems) {
      const key = `${item.type}_${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueItems.push(item);
      }
    }

    uniqueItems.sort((a, b) => a.price - b.price);

    console.log(
      `Found ${uniqueItems.length} valid gamepasses for universe ${universeId} (owned by user ${ownerUserId}).`
    );

    res.json({
      success: true,
      items: uniqueItems,
      count: uniqueItems.length,
      universeId: universeId,
      ownerUserId: ownerUserId,
    });
  } catch (error) {
    console.error("Error in game donations endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to fetch donation items for game" });
  }
});

// Debug endpoint – shows raw gamepass API response (user-based)
app.get("/debug/:userId", async (req, res) => {
  const url = `https://apis.roproxy.com/game-passes/v1/users/${req.params.userId}/game-passes?count=100`;
  try {
    const r = await fetch(url);
    const text = await r.text();
    res.send(`Status: ${r.status}\nBody: ${text}`);
  } catch (e) {
    res.send(`Error: ${e.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Donation Proxy running on port ${PORT}`));
