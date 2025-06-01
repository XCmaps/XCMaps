import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import xml2js from 'xml2js';
import dotenv from 'dotenv';

dotenv.config();

const DB_CONNECTION_STRING = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
const pool = new Pool({
    connectionString: DB_CONNECTION_STRING,
});

const xmlFilePath = path.resolve('./uploads/dhvgelaende_dhvxml_alle.xml');

async function importDhvSites() {
    let client;
    try {
        client = await pool.connect();
        console.log('Connected to PostgreSQL database.');

        // Read XML file with explicit UTF-8 encoding
        const xmlData = fs.readFileSync(xmlFilePath, { encoding: 'utf8' });
        console.log('XML file read successfully.');

        // Parse XML
        const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
        const result = await parser.parseStringPromise(xmlData);
        console.log('XML parsed successfully.');

        const flyingSites = result.DhvXml.FlyingSites.FlyingSite;

        if (!flyingSites || flyingSites.length === 0) {
            console.log('No FlyingSites found in the XML.');
            return;
        }

        // Start transaction
        await client.query('BEGIN');
        console.log('Transaction started.');

        // Clear existing data
        await client.query('TRUNCATE TABLE dhv_sites RESTART IDENTITY;');
        console.log('Existing data truncated from dhv_sites table.');

        for (const site of flyingSites) {
            const siteId = parseInt(site.SiteID, 10) || null;
            const siteName = site.SiteName ? site.SiteName._ || site.SiteName : null;
            const siteCountry = site.SiteCountry || null;
            const siteType = site.SiteType ? site.SiteType._ || site.SiteType : null;
            const siteTypeEn = site.SiteType_en ? site.SiteType_en._ || site.SiteType_en : null;
            const heightDifferenceMax = parseInt(site.HeightDifferenceMax, 10) || 0;
            const webCam1 = site.WebCam1 || null;
            const webCam2 = site.WebCam2 || null;
            const webCam3 = site.WebCam3 || null;
            const weatherInfo = site.WeatherInfo ? site.WeatherInfo._ || site.WeatherInfo : null;
            const weatherPhone = site.WeatherPhone || null;
            const deCertified = site.DECertified === 'true';
            const deCertificationHolder = site.DECertificationHolder ? site.DECertificationHolder._ || site.DECertificationHolder : null;
            const siteContact = site.SiteContact || null;
            const siteInformation = site.SiteInformation ? site.SiteInformation._ || site.SiteInformation : null;
            const cableCar = site.CableCar || null;
            const siteRemarks = site.SiteRemarks ? site.SiteRemarks._ || site.SiteRemarks : null;
            const requirements = site.Requirements ? site.Requirements._ || site.Requirements : null;
            const siteUrl = site.SiteUrl ? site.SiteUrl._ || site.SiteUrl : null;

            // Handle multiple locations
            const locations = Array.isArray(site.Location) ? site.Location : [site.Location];

            for (const location of locations) {
                if (!location) continue;

                const locationName = location.LocationName ? location.LocationName._ || location.LocationName : null;
                const coordinates = location.Coordinates ? location.Coordinates.split(',').map(c => parseFloat(c.trim())) : [null, null];
                const latitude = coordinates[1];
                const longitude = coordinates[0];
                const locationId = parseInt(location.LocationID, 10) || null;
                const locationType = parseInt(location.LocationType, 10) || null;
                const coordinatesText = location.CoordinatesText ? location.CoordinatesText._ || location.CoordinatesText : null;
                const altitude = parseInt(location.Altitude, 10) || null;
                const locationCountry = location.LocationCountry || null;
                const postCode = location.PostCode || null;
                const regionId = parseInt(location.RegionID, 10) || null;
                const region = location.Region ? location.Region._ || location.Region : null;
                const municipality = location.Municipality ? location.Municipality._ || location.Municipality : null;
                const directions = location.Directions || null;
                const directionsText = location.DirectionsText || null;
                const towingLength = parseInt(location.TowingLength, 10) || 0;
                const mobileWinch = parseInt(location.MobileWinch, 10) || 0;
                const towingHeight1 = parseInt(location.TowingHeight1, 10) || 0;
                const towingHeight2 = parseInt(location.TowingHeight2, 10) || 0;
                const accessByCar = location.AccessByCar === 'true';
                const accessByPublicTransport = location.AccessByPublicTransport === 'true';
                const accessByFoot = location.AccessByFoot === 'true';
                const accessRemarks = location.AccessRemarks || null;
                const hanggliding = location.Hanggliding === 'true';
                const paragliding = location.Paragliding === 'true';
                const suitabilityHg = location.SuitabilityHG ? location.SuitabilityHG._ || location.SuitabilityHG : null;
                const suitabilityHgEn = location.SuitabilityHG_en ? location.SuitabilityHG_en._ || location.SuitabilityHG_en : null;
                const suitabilityPg = location.SuitabilityPG ? location.SuitabilityPG._ || location.SuitabilityPG : null;
                const suitabilityPgEn = location.SuitabilityPG_en ? location.SuitabilityPG_en._ || location.SuitabilityPG_en : null;
                const locationRemarks = location.LocationRemarks ? location.LocationRemarks._ || location.LocationRemarks : null;

                const query = `
                    INSERT INTO dhv_sites (
                        site_id, site_name, site_country, site_type, site_type_en, height_difference_max,
                        webcam1, webcam2, webcam3, weather_info, weather_phone, de_certified,
                        de_certification_holder, site_contact, site_information, cable_car,
                        site_remarks, requirements, site_url,
                        location_name, location_id, location_type, coordinates_text, altitude,
                        location_country, post_code, region_id, region, municipality,
                        directions, directions_text, towing_length, mobile_winch,
                        towing_height1, towing_height2, access_by_car, access_by_public_transport,
                        access_by_foot, access_remarks, hanggliding, paragliding,
                        suitability_hg, suitability_hg_en, suitability_pg, suitability_pg_en,
                        location_remarks, latitude, longitude
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                        $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44,
                        $45, $46, $47, $48
                    );
                `;
                const values = [
                    siteId, siteName, siteCountry, siteType, siteTypeEn, heightDifferenceMax,
                    webCam1, webCam2, webCam3, weatherInfo, weatherPhone, deCertified,
                    deCertificationHolder, siteContact, siteInformation, cableCar,
                    siteRemarks, requirements, siteUrl,
                    locationName, locationId, locationType, coordinatesText, altitude,
                    locationCountry, postCode, regionId, region, municipality,
                    directions, directionsText, towingLength, mobileWinch,
                    towingHeight1, towingHeight2, accessByCar, accessByPublicTransport,
                    accessByFoot, accessRemarks, hanggliding, paragliding,
                    suitabilityHg, suitabilityHgEn, suitabilityPg, suitabilityPgEn,
                    locationRemarks, latitude, longitude
                ];
                await client.query(query, values);
            }
        }

        await client.query('COMMIT');
        console.log('Data imported successfully and transaction committed.');

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
            console.error('Transaction rolled back due to an error.');
        }
        console.error('Error importing DHV sites:', error);
    } finally {
        if (client) {
            client.release();
            console.log('Database client released.');
        }
        pool.end();
        console.log('Database pool closed.');
    }
}

importDhvSites();