import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

// Create and export wind routes
export default function createMoselfalkenImageRouter() {
    // API endpoint to fetch wind data - getNear
    router.get("/moselfaken-images", async (req, res) => {
        const { imageUrl } = req.query;

        if (!imageUrl) {
            return res.status(400).json({ error: "Latitude and longitude are required." });
        }

        const apiUrl = `https://moselfalken.de${imageUrl}`;

        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            res.json(data);
        } catch (error) {
            console.error("Error fetching data:", error);
            res.status(500).json({ error: "Failed to fetch Moselfalken image." });
        }
    });

    return router;
}