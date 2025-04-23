/**
 * Flarmnet Parser Module
 * Implements the parsing logic for Flarmnet data files
 * 
 * Based on the example script provided
 */

import iconv from 'iconv-lite';

// Debug flag - set to true to enable detailed logging
const DEBUG = true;

/**
 * Decode Flarmnet data from hex format
 * @param {string} data - The raw hex data from the Flarmnet file
 * @returns {Object} - Object containing version and records
 */
export function decode(data) {
  let lines = data.split('\n');
  
  // Try to parse version from first line
  let version;
  try {
    version = parseInt(lines[0], 16);
    if (isNaN(version)) {
      console.warn('Could not parse version from first line, using default value');
      version = 0;
    }
  } catch (err) {
    console.warn('Error parsing version:', err);
    version = 0;
  }
  
  if (DEBUG) {
    console.log(`Flarmnet version: ${version}`);
    console.log(`Total lines: ${lines.length}`);
    // Log a few sample lines
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      console.log(`Sample line ${i}: ${lines[i].substring(0, 50)}...`);
    }
  }
  
  // Process all lines (including first line in case it's not a version)
  let records = [];
  let skippedLines = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    
    const record = decodeLine(line, i);
    if (record) {
      records.push(record);
    } else {
      skippedLines++;
    }
  }
  
  if (DEBUG) {
    console.log(`Processed ${lines.length} lines, created ${records.length} records, skipped ${skippedLines} lines`);
  }
  
  return { version, records };
}

/**
 * Decode a single line of Flarmnet data - exactly as in the example script
 * @param {string} line - A single line of hex-encoded Flarmnet data
 * @param {number} lineIndex - Index of the line for debugging
 * @returns {Object|null} - Decoded record or null if invalid
 */
function decodeLine(line, lineIndex) {
  if (line.length < 172) {
    if (DEBUG) console.warn(`Line ${lineIndex} too short (${line.length}), skipping`);
    return null;
  }
  
  try {
    // Extract and decode each field exactly as in the example script
    let id = decodeString(line.slice(0, 12));
    let pilot = decodeString(line.slice(12, 54));
    let airfield = decodeString(line.slice(54, 96));
    let plane_type = decodeString(line.slice(96, 138));
    let registration = decodeString(line.slice(138, 152));
    let callsign = decodeString(line.slice(152, 158));
    let frequency = decodeString(line.slice(158, 172));
    
    // Format the FLARM ID to ensure it's in the correct format
    id = formatFlarmId(id);
    
    // Debug output for specific IDs we're looking for
    if (id === '22017D' || id === '31E00C') {
      console.log(`Found important ID: ${id}, Reg: ${registration || '[null]'}, Type: ${plane_type || '[null]'}`);
    }
    
    // Return record without pilot field
    return { id, airfield, plane_type, registration, callsign, frequency };
  } catch (err) {
    if (DEBUG) console.warn(`Error decoding line ${lineIndex}:`, err);
    return null;
  }
}

/**
 * Decode a hex string to a readable string - exactly as in the example script
 * @param {string} str - Hex string to decode
 * @returns {string|null} - Decoded string or null if empty/invalid
 */
function decodeString(str) {
  if (!str || str.length === 0) return null;
  
  try {
    const numBytes = str.length / 2;
    const buffer = Buffer.alloc(numBytes);
    
    for (let i = 0; i < numBytes; i++) {
      const byte = parseInt(str.slice(i * 2, i * 2 + 2), 16);
      buffer.writeUInt8(byte, i);
    }
    
    let result = iconv.decode(buffer, 'latin1');
    result = result.trim();
    return result || null;
  } catch (err) {
    if (DEBUG) console.warn('Error decoding string:', err);
    return null;
  }
}

/**
 * Format a FLARM ID to ensure it's in the correct format
 * @param {string} id - The decoded FLARM ID
 * @returns {string} - Formatted FLARM ID
 */
function formatFlarmId(id) {
  if (!id) return null;
  
  // If it's already in the expected format (6 hex chars), use it
  if (/^[0-9A-F]{6}$/i.test(id)) {
    return id.toUpperCase();
  }
  
  // Otherwise, try to convert it to a 6-character hex string
  try {
    // Convert to hex if it's not already
    let hexId = '';
    for (let i = 0; i < id.length && i < 6; i++) {
      const charCode = id.charCodeAt(i);
      hexId += charCode.toString(16).padStart(2, '0').toUpperCase();
    }
    
    // Ensure it's exactly 6 characters
    return hexId.padStart(6, '0').substring(0, 6);
  } catch (err) {
    if (DEBUG) console.warn('Error formatting FLARM ID:', err);
    return id;
  }
}

/**
 * Encode Flarmnet data to hex format
 * @param {Object} data - Object containing version and records
 * @returns {string} - Hex-encoded Flarmnet data
 */
export function encode({ version, records }) {
  return [
    version.toString(16).padStart(6, '0'),
    ...records.map(encodeRecord)
  ].join('\n') + '\n';
}

/**
 * Encode a single record to hex format
 * @param {Object} record - Record to encode
 * @returns {string} - Hex-encoded record
 */
function encodeRecord(record) {
  return [
    encodeString(record.id, 6),
    encodeString(record.pilot, 21),
    encodeString(record.airfield, 21),
    encodeString(record.plane_type, 21),
    encodeString(record.registration, 7),
    encodeString(record.callsign, 3),
    encodeString(record.frequency, 7),
  ].join('');
}

/**
 * Encode a string to hex format
 * @param {string} str - String to encode
 * @param {number} length - Desired length of the string
 * @returns {string} - Hex-encoded string
 */
function encodeString(str, length) {
  let buffer = iconv.encode((str || '').padEnd(length, ' '), 'latin1');
  return Array.from(buffer.values()).map(it => it.toString(16).padStart(2, '0')).join('');
}