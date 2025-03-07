import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

// Create and export wind routes
export default function createWindRouter() {
    // API endpoint to fetch wind data - getNear
    router.get("/wind-data-getNear", async (req, res) => {
        const { lat, lng } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({ error: "Latitude and longitude are required." });
        }

        const apiUrl = `https://windspion.app/dataServer/getNear.php?a=${lat}&o=${lng}&count=600`;

        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            res.json(data);
        } catch (error) {
            console.error("Error fetching data:", error);
            res.status(500).json({ error: "Failed to fetch wind station data." });
        }
    });

    // API endpoint to fetch current wind data - getCurrent
    router.get("/wind-data-getCurrent", async (req, res) => {
        const { nwLat, nwLng, seLat, seLng } = req.query;

        if (!nwLat || !nwLng || !seLat || !seLng) {
            return res.status(400).json({ error: "Latitude and longitude are required." });
        }

        const apiUrl = `https://winds.mobi/api/2.3/stations/?is-highest-duplicates-rating=true&keys=short&keys=loc&keys=status&keys=pv-name&keys=alt&keys=peak&keys=last._id&keys=last.w-dir&keys=last.w-avg&keys=last.w-max&limit=220&within-pt1-lat=${nwLat}&within-pt1-lon=${seLng}&within-pt2-lat=${seLat}&within-pt2-lon=${nwLng}`;

        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            res.json(data);
        } catch (error) {
            console.error("Error fetching data:", error);
            res.status(500).json({ error: "Failed to fetch current wind data." });
        }
    });

    return router;
}