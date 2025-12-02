const express = require("express");
const mysql = require("mysql");
const cors = require("cors");
const port = 5000;

const app = express();

app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "toollink",
});

db.connect((err) => {
    if (err) {
        console.log("Error Connecting to the database: ", err);
        throw err;
    }
    console.log("ToolLink MySQL server connected...");
});

// Register Route
app.post("/register", (req, res) => {
    const { userId, userName, userPassword, userImage } = req.body;

    const sql = "INSERT INTO users (userId, userName, userPassword, userImage) VALUES (?, ?, ?, ?)";

    db.query(sql, [userId, userName, userPassword, userImage], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send(err);
        } else {
            res.send(result);
        }
    });
});

// Login Route
app.post("/login", (req, res) => {
    const { userId, userPassword } = req.body;

    const sql = "SELECT * FROM users WHERE userId = ? AND userPassword = ?";

    db.query(sql, [userId, userPassword], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send(err);
        } else {
            res.send(result);
        }
    });
});

// --- Tool Routes ---

// 1. Add a New Tool (CREATE)
app.post("/addTool", (req, res) => {
    const { ownerId, toolName, category, price, toolImage } = req.body;

    const sql = "INSERT INTO tools (ownerId, toolName, category, price, toolImage) VALUES (?, ?, ?, ?, ?)";

    db.query(sql, [ownerId, toolName, category, price, toolImage], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send(err);
        } else {
            res.send(result);
        }
    });
});

// 2. Get All Tools (READ)
/* Get All Available Tools */
app.get("/getTools", (req, res) => {
    // MODIFIED: Added JOIN to users table to fetch owner details
    const sql = `
        SELECT t.*, u.userName AS ownerName, u.userImage AS ownerImage
        FROM tools t
        JOIN users u ON t.ownerId = u.userId
        WHERE t.status = 'available' 
        ORDER BY t.toolId DESC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send(err);
        } else {
            res.send(result);
        }
    });
});

// 3. Get Tools for a Specific User (READ - Private) -> UPDATED
app.get("/getMyListings/:userId", (req, res) => {
    const userId = req.params.userId;
    // NEW: Left Join rentals (active only) and users to see who is renting your tool
    const sql = `
        SELECT 
            t.*, 
            r.startDate, r.endDate, 
            u.userName AS renterName
        FROM tools t
        LEFT JOIN rentals r ON t.toolId = r.toolId AND r.status = 'active'
        LEFT JOIN users u ON r.renterId = u.userId
        WHERE t.ownerId = ? 
        ORDER BY t.toolId DESC
    `;

    db.query(sql, [userId], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send(err);
        } else {
            res.send(result);
        }
    });
});

// 4. Delete a Tool (DELETE) - With Safety Check
app.delete("/deleteTool/:toolId", (req, res) => {
    const toolId = req.params.toolId;

    // Check for active rentals first
    const checkSql = "SELECT * FROM rentals WHERE toolId = ? AND status = 'active'";

    db.query(checkSql, [toolId], (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).send(err);
        }

        // If an active rental exists, BLOCK the delete
        if (results.length > 0) {
            return res.status(400).send({ message: "Cannot delete this tool because it is currently rented out." });
        }

        // If safe, proceed to delete
        const deleteSql = "DELETE FROM tools WHERE toolId = ?";
        db.query(deleteSql, [toolId], (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).send(err);
            }
            res.send(result);
        });
    });
});

// 5. Get Lender Stats (Earnings & Active Rentals)
app.get("/getLenderStats/:userId", (req, res) => {
    const userId = req.params.userId;

    const sql = `
    SELECT 
      SUM(r.totalPrice) as totalEarnings,
      COUNT(r.rentalId) as activeRentals
    FROM rentals r
    JOIN tools t ON r.toolId = t.toolId
    WHERE t.ownerId = ? AND r.status = 'active'
  `;

    db.query(sql, [userId], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send(err);
        } else {
            // If result is null (no rentals), return 0
            const stats = {
                totalEarnings: result[0].totalEarnings || 0,
                activeRentals: result[0].activeRentals || 0
            };
            res.send(stats);
        }
    });
});

// 6. Update User Profile (UPDATE)
app.put("/updateUser", (req, res) => {
    const { userId, userName, userPassword, userImage } = req.body;

    // Only update password if it's provided
    let sql = "UPDATE users SET userName = ?, userImage = ? WHERE userId = ?";
    let params = [userName, userImage, userId];

    if (userPassword && userPassword.trim() !== "") {
        sql = "UPDATE users SET userName = ?, userImage = ?, userPassword = ? WHERE userId = ?";
        params = [userName, userImage, userPassword, userId];
    }

    db.query(sql, params, (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send(err);
        } else {
            res.send(result);
        }
    });
});

// 7. Update a Tool (UPDATE)
app.put("/updateTool", (req, res) => {
    // NEW: Destructure toolImage from req.body
    const { toolId, toolName, category, price, toolImage } = req.body;

    // NEW: Update SQL to set toolImage as well
    const sql = "UPDATE tools SET toolName = ?, category = ?, price = ?, toolImage = ? WHERE toolId = ?";

    // NEW: Add toolImage to the parameters array
    db.query(sql, [toolName, category, price, toolImage, toolId], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send(err);
        } else {
            res.send(result);
        }
    });
});

// 8. Rent a Tool (CREATE Rental)
// 8. Rent a Tool (CREATE Rental) - With Availability Check
app.post("/rentTool", (req, res) => {
    const { toolId, renterId, days } = req.body;

    // 1. Check if tool exists AND is available
    const checkSql = "SELECT price, status FROM tools WHERE toolId = ?";
    
    db.query(checkSql, [toolId], (err, results) => {
        if (err) return res.status(500).send(err);
        
        if (results.length === 0) {
            return res.status(404).send({ message: "Tool not found" });
        }

        const tool = results[0];

        // [CRITICAL FIX] Block rental if already rented
        if (tool.status !== 'available') {
            return res.status(400).send({ message: "This tool is no longer available." });
        }

        // 2. Calculate Dates & Price
        const pricePerDay = tool.price;
        const totalPrice = pricePerDay * parseInt(days);
        
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + parseInt(days));

        // 3. Insert Rental Record
        const rentSql = `
            INSERT INTO rentals (toolId, renterId, startDate, endDate, totalPrice, status) 
            VALUES (?, ?, NOW(), ?, ?, 'active')
        `;

        db.query(rentSql, [toolId, renterId, endDate, totalPrice], (err, result) => {
            if (err) return res.status(500).send(err);

            // 4. Update Tool Status to 'rented'
            const updateToolSql = "UPDATE tools SET status = 'rented' WHERE toolId = ?";
            db.query(updateToolSql, [toolId], (err, updateResult) => {
                if (err) {
                    console.log("Warning: Rental created but tool status not updated");
                }
                res.send({ message: "Rental successful!", rentalId: result.insertId });
            });
        });
    });
});

// 9. Get My Rentals (READ Orders) -> UPDATED
app.get("/myRentals/:userId", (req, res) => {
    const userId = req.params.userId;

    // FIX: Changed JOIN to LEFT JOIN so orders still appear even if tool/owner data is missing
    const sql = `
    SELECT 
      r.rentalId, r.toolId, r.status, r.startDate, r.endDate, r.totalPrice,
      t.toolName, t.category, t.toolImage,
      u.userName AS ownerName
    FROM rentals r
    LEFT JOIN tools t ON r.toolId = t.toolId
    LEFT JOIN users u ON t.ownerId = u.userId
    WHERE r.renterId = ?
    ORDER BY r.startDate DESC
  `;

    db.query(sql, [userId], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send(err);
        } else {
            res.send(result);
        }
    });
});

// --- Wishlist Routes ---

// 10. Add to Wishlist
app.post("/addToWishlist", (req, res) => {
    const { userId, toolId } = req.body;
    const sql = "INSERT INTO wishlist (userId, toolId) VALUES (?, ?)";
    db.query(sql, [userId, toolId], (err, result) => {
        if (err) {
            // If duplicate, we can just ignore or send message
            res.send({ message: "Already in wishlist" });
        } else {
            res.send(result);
        }
    });
});

// 11. Remove from Wishlist (Updated to use URL params)
app.delete("/removeFromWishlist/:userId/:toolId", (req, res) => {
    const userId = req.params.userId;
    const toolId = req.params.toolId;

    const sql = "DELETE FROM wishlist WHERE userId = ? AND toolId = ?";
    db.query(sql, [userId, toolId], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send(err);
        } else {
            res.send(result);
        }
    });
});

// 12. Get User's Wishlist (IDs only - useful for checking heart icons)
app.get("/getWishlistIds/:userId", (req, res) => {
    const userId = req.params.userId;
    const sql = "SELECT toolId FROM wishlist WHERE userId = ?";
    db.query(sql, [userId], (err, result) => {
        if (err) console.log(err);
        res.send(result);
    });
});

// 13. Get Full Wishlist Items (For Wishlist Page)
app.get("/myWishlist/:userId", (req, res) => {
    const userId = req.params.userId;
    const sql = `
    SELECT 
        t.*, 
        u.userName AS ownerName, 
        u.userImage AS ownerImage 
    FROM wishlist w
    JOIN tools t ON w.toolId = t.toolId
    JOIN users u ON t.ownerId = u.userId -- MODIFIED: Added JOIN for owner info
    WHERE w.userId = ?
    `;
    db.query(sql, [userId], (err, result) => {
        if (err) console.log(err);
        res.send(result);
    });
});

// 14. Return a Tool (UPDATE Rental & Tool Status)
app.post("/returnTool", (req, res) => {
    const { rentalId, toolId } = req.body;

    // 1. Update Rental Status to 'completed'
    const updateRentalSql = "UPDATE rentals SET status = 'completed' WHERE rentalId = ?";

    db.query(updateRentalSql, [rentalId], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }

        // 2. Update Tool Status to 'available'
        const updateToolSql = "UPDATE tools SET status = 'available' WHERE toolId = ?";
        db.query(updateToolSql, [toolId], (err, toolResult) => {
            if (err) {
                console.log("Error updating tool status on return");
            }
            res.send({ message: "Tool returned successfully" });
        });
    });
});

app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});