import { Router } from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

export default function createMoselfalkenImageRouter() {
    router.get("/", async (req, res) => {
        const { imageUrl } = req.query;

        if (!imageUrl) {
            return res.status(400).json({ error: "url is required" });
        }

        try {
            // Add a timeout to the fetch request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
            
            const response = await fetch(imageUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                return res.status(response.status).send(response.statusText);
            }

            // Get content type from original response
            const contentType = response.headers.get('content-type');
            
            // Set basic CORS headers
            const corsHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Requested-With',
                'Access-Control-Expose-Headers': 'Content-Length, Content-Type'
            };
            
            // Get the response as a buffer
            const responseBuffer = await response.buffer();
            
            // No need to save the response anymore
            
            // Set appropriate content type
            res.set({
                'Content-Type': contentType || 'application/octet-stream',
                ...corsHeaders
            });
            
            // Send the buffer as the response
            res.send(responseBuffer);

        } catch (error) {
            res.status(500).json({ error: "Failed to fetch image." });
        }
    });

    return router;
}