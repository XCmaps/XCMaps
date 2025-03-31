import axios from 'axios';

// Proxy handler for kk7 thermal tiles
async function kk7ThermalsProxy(req, res) {
    const { z, x, y } = req.params;
    const tileUrl = `https://thermal.kk7.ch/tiles/thermals_jul_07/${z}/${x}/${y}.png?src=xcmaps.com`;

    try {
        console.log(`Proxying request for kk7 thermal tile: ${tileUrl}`);
        const response = await axios({
            method: 'get',
            url: tileUrl,
            responseType: 'stream', // Important for streaming binary data like images
            headers: {
                // Forward minimal necessary headers, avoid forwarding host or origin if possible
                'User-Agent': 'XCmaps-Proxy/1.0', // Identify our proxy
                'Accept': 'image/png,*/*' // Accept image formats
            }
        });

        // Set the correct content type for the response
        res.setHeader('Content-Type', 'image/png');
        // Pipe the stream from the external server directly to the client response
        response.data.pipe(res);

        // Handle stream errors
        response.data.on('error', (err) => {
            console.error('Error streaming kk7 thermal tile:', err);
            if (!res.headersSent) {
                res.status(500).send('Error fetching tile');
            }
        });

    } catch (error) {
        console.error(`Error fetching kk7 thermal tile from ${tileUrl}:`, error.response ? `${error.response.status} ${error.response.statusText}` : error.message);
        if (!res.headersSent) {
            // Send appropriate error status based on the external server's response, or 502 for general proxy errors
            const statusCode = error.response ? error.response.status : 502; // 502 Bad Gateway
            res.status(statusCode).send(`Error fetching tile: ${error.message}`);
        }
    }
}

export default kk7ThermalsProxy;