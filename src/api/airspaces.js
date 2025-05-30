import express from "express";
import fetch from "node-fetch";

const createAirspacesRouter = () => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { lat, lng, dist, types: typesParam } = req.query;
      // Validate required parameters
      if (!lat || !lng) {
        return res.status(400).json({ error: 'Missing lat or lng parameters' });
      }

      const distance = dist || 200000;
      const types = typesParam ? typesParam.split(',').map(Number) : [];
      
      const apiUrl = `https://api.core.openaip.net/api/airspaces?pos=${lat},${lng}&dist=${distance}${types.map(type => `&type=${type}`).join('')}&apiKey=${process.env.OAIP_KEY}`;

      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': process.env.APP_DOMAIN,
          'Origin': process.env.APP_DOMAIN,
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      
      if (!response.ok) {
        // Log detailed error information
        const errorText = await response.text();
        console.error(`Error from OpenAIP API: ${response.status} ${response.statusText}`);
        console.error(`Response body: ${errorText}`);
        return res.status(response.status).json({ 
          error: 'Failed to fetch airspace data', 
          details: response.statusText,
          status: response.status
        });
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Error proxying airspace request:', error);
      res.status(500).json({ error: 'Failed to fetch airspace data', details: error.message });
    }
  });

  return router;
};

export default createAirspacesRouter;