import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const DB_CONNECTION_STRING = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
const pool = new Pool({
    connectionString: DB_CONNECTION_STRING,
});

// Haversine formula to calculate distance between two points on a sphere (in meters)
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const d = R * c; // in metres
    return d;
}

async function linkPlacesWithDhvSites() {
    let client;
    try {
        client = await pool.connect();
        console.log('Connected to PostgreSQL database.');

        const batchSize = 5000; // Process 5000 records at a time
        const accuracyThreshold = 100; // meters

        const totalPlacesResult = await client.query('SELECT COUNT(*) FROM places;');
        const totalPlaces = parseInt(totalPlacesResult.rows[0].count, 10);
        console.log(`Total places to process: ${totalPlaces}`);

        const dhvSitesResult = await client.query('SELECT site_id, latitude, longitude FROM dhv_sites;');
        const dhvSites = dhvSitesResult.rows;
        console.log(`Loaded ${dhvSites.length} DHV sites.`);

        for (let offset = 0; offset < totalPlaces; offset += batchSize) {
            console.log(`Processing batch from offset ${offset} to ${offset + batchSize}...`);

            const placesBatchResult = await client.query(
                `SELECT id, ST_Y(geom) AS latitude, ST_X(geom) AS longitude FROM places ORDER BY id LIMIT $1 OFFSET $2;`,
                [batchSize, offset]
            );
            const placesBatch = placesBatchResult.rows;

            if (placesBatch.length === 0) {
                console.log('No more places to process in this batch. Exiting loop.');
                break;
            }

            const updates = [];
            for (const place of placesBatch) {
                let matchedDhvSiteId = null;
                for (const dhvSite of dhvSites) {
                    const distance = haversineDistance(
                        place.latitude, place.longitude,
                        dhvSite.latitude, dhvSite.longitude
                    );

                    if (distance <= accuracyThreshold) {
                        matchedDhvSiteId = dhvSite.site_id;
                        break; // Found a match, move to the next place
                    }
                }
                if (matchedDhvSiteId !== null) {
                    updates.push({ placeId: place.id, dhvSiteId: matchedDhvSiteId });
                }
            }

            if (updates.length > 0) {
                await client.query('BEGIN');
                console.log(`Starting transaction for ${updates.length} updates in this batch.`);
                for (const update of updates) {
                    await client.query(
                        'UPDATE places SET dhv_site_id = $1 WHERE id = $2;',
                        [update.dhvSiteId, update.placeId]
                    );
                }
                await client.query('COMMIT');
                console.log(`Committed ${updates.length} updates for batch starting at offset ${offset}.`);
            } else {
                console.log(`No updates for batch starting at offset ${offset}.`);
            }
        }

        console.log('Finished linking places with DHV sites.');

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
            console.error('Transaction rolled back due to an error.');
        }
        console.error('Error linking places with DHV sites:', error);
    } finally {
        if (client) {
            client.release();
            console.log('Database client released.');
        }
        await pool.end();
        console.log('Database pool closed.');
    }
}

linkPlacesWithDhvSites();