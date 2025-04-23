/**
 * Script to examine the raw Flarmnet data
 */

import fetch from 'node-fetch';
import iconv from 'iconv-lite';

// Constants
const FLARMNET_URL = 'https://www.flarmnet.org/static/files/wfn/data.fln';

async function examineFlarmnetData() {
  console.log('Fetching Flarmnet data...');
  const response = await fetch(FLARMNET_URL);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch Flarmnet data: ${response.status} ${response.statusText}`);
  }
  
  const hexData = await response.text();
  console.log(`Fetched ${hexData.length} bytes of Flarmnet data`);
  
  // Examine the first few lines
  const lines = hexData.trim().split('\n');
  console.log(`Total lines: ${lines.length}`);
  
  // Skip the first line (version)
  for (let i = 1; i < Math.min(10, lines.length); i++) {
    const line = lines[i].trim();
    console.log(`\nLine ${i} (length: ${line.length}):`);
    console.log(`Raw: ${line.substring(0, 50)}...`);
    
    // Try to decode the pilot name section (bytes 6-27, hex positions 12-54)
    if (line.length >= 54) {
      const pilotHex = line.slice(12, 54);
      console.log(`Pilot hex: ${pilotHex}`);
      
      // Try different decoding methods
      try {
        // Method 1: Direct hex to string
        const buffer1 = Buffer.from(pilotHex, 'hex');
        console.log(`Method 1 (hex to buffer): ${buffer1.toString('hex').substring(0, 30)}...`);
        
        // Method 2: Latin1 encoding
        const latin1 = iconv.decode(buffer1, 'latin1');
        console.log(`Method 2 (latin1): '${latin1}'`);
        
        // Method 3: ASCII encoding
        const ascii = iconv.decode(buffer1, 'ascii');
        console.log(`Method 3 (ascii): '${ascii}'`);
        
        // Method 4: UTF-8 encoding
        const utf8 = iconv.decode(buffer1, 'utf8');
        console.log(`Method 4 (utf8): '${utf8}'`);
        
        // Method 5: Examine each byte
        let byteStr = 'Bytes: ';
        for (let j = 0; j < Math.min(10, buffer1.length); j++) {
          byteStr += buffer1[j].toString(16).padStart(2, '0') + ' ';
        }
        console.log(byteStr);
        
        // Method 6: Try to interpret as ASCII characters
        let charStr = 'Chars: ';
        for (let j = 0; j < Math.min(10, buffer1.length); j++) {
          const byte = buffer1[j];
          if (byte >= 32 && byte <= 126) {
            charStr += String.fromCharCode(byte);
          } else {
            charStr += '.';
          }
        }
        console.log(charStr);
      } catch (err) {
        console.error(`Error decoding pilot name: ${err.message}`);
      }
    }
    
    // Try to decode the registration section (bytes 69-76, hex positions 138-152)
    if (line.length >= 152) {
      const regHex = line.slice(138, 152);
      console.log(`Registration hex: ${regHex}`);
      
      try {
        const buffer = Buffer.from(regHex, 'hex');
        const latin1 = iconv.decode(buffer, 'latin1').trim();
        console.log(`Registration (latin1): '${latin1}'`);
      } catch (err) {
        console.error(`Error decoding registration: ${err.message}`);
      }
    }
  }
}

examineFlarmnetData().catch(err => console.error('Error:', err));