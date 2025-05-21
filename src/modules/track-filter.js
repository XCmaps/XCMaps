/**
 * Analyzes aircraft track data to identify and filter out inaccurate data points.
 */
export class TrackFilter {
  /**
   * Initializes the TrackFilter with data from a CSV string.
   * @param {string} csvData - The aircraft track data in CSV format.
   */
  /**
   * Initializes the TrackFilter with an array of track data objects.
   * @param {Array<Object>} trackData - An array of track data objects.
   */
  constructor(trackData) {
    // Group tracks by aircraft_id
    this.tracks = trackData.reduce((acc, track) => {
      const aircraftId = track.aircraft_id;
      if (!acc[aircraftId]) {
        acc[aircraftId] = [];
      }
      acc[aircraftId].push(track);
      return acc;
    }, {});
  }

  /**
   * Analyzes the track data for anomalies and filters out inaccurate points.
   * @returns {Object} An object containing filtered tracks and identified anomalies.
   */
  filterInaccurateTracks() {
    const filteredTracks = {};
    const anomalies = {};

    for (const aircraftId in this.tracks) {
      filteredTracks[aircraftId] = [];
      anomalies[aircraftId] = [];
      const aircraftTracks = this.tracks[aircraftId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      for (let i = 0; i < aircraftTracks.length; i++) {
        const currentTrack = aircraftTracks[i];
        const previousTrack = i > 0 ? aircraftTracks[i - 1] : null;

        // Implement filtering logic here
        // Compare currentTrack with previousTrack for sudden changes in:
        // lat, lon, alt_msl, alt_agl, speed_kmh, vs

        let isAnomaly = false;

        if (previousTrack) {
          // Calculate time difference between points in seconds
          const currentTime = new Date(currentTrack.timestamp);
          const previousTime = new Date(previousTrack.timestamp);
          const timeDiffSeconds = (currentTime - previousTime) / 1000;
          
          // Skip time-based checks if the time difference is too large (e.g., more than 30 minutes)
          // This prevents false positives when there are large gaps in data
          const maxTimeDiffSeconds = 1800; // 30 minutes
          
          if (timeDiffSeconds <= maxTimeDiffSeconds && timeDiffSeconds > 0) {
            // Calculate maximum plausible distance based on time difference and max speed
            // Assuming max speed of 150 km/h (41.67 m/s) for paragliders/hang gliders
            const maxDistanceMeters = timeDiffSeconds * 41.67;
            
            // Calculate actual distance between points using Haversine formula
            const lat1 = parseFloat(previousTrack.lat);
            const lon1 = parseFloat(previousTrack.lon);
            const lat2 = parseFloat(currentTrack.lat);
            const lon2 = parseFloat(currentTrack.lon);
            
            // Haversine formula
            const R = 6371000; // Earth radius in meters
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a =
              Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distanceMeters = R * c;
            
            // Check if the distance is physically possible given the time difference
            if (distanceMeters > maxDistanceMeters) {
              isAnomaly = true;
              anomalies[aircraftId].push({
                type: 'impossible_distance',
                current: currentTrack,
                previous: previousTrack,
                details: {
                  distanceMeters,
                  maxDistanceMeters,
                  timeDiffSeconds
                }
              });
            }
            
            // Check for large jumps in latitude/longitude (more than 0.05 degrees in a short time)
            // This is approximately 5.5 km at the equator
            const latDiff = Math.abs(lat2 - lat1);
            const lonDiff = Math.abs(lon2 - lon1);
            
            if (latDiff > 0.05) {
              isAnomaly = true;
              anomalies[aircraftId].push({
                type: 'large_lat_jump',
                current: currentTrack,
                previous: previousTrack,
                details: { latDiff }
              });
            }
            
            if (lonDiff > 0.05) {
              isAnomaly = true;
              anomalies[aircraftId].push({
                type: 'large_lon_jump',
                current: currentTrack,
                previous: previousTrack,
                details: { lonDiff }
              });
            }
            
            // Check for sudden large change in altitude (more than 300 meters in a short time)
            const altMslDiff = Math.abs(parseFloat(currentTrack.alt_msl) - parseFloat(previousTrack.alt_msl));
            const maxAltChangeRate = 20; // meters per second (max climb/sink rate)
            const maxAltChange = maxAltChangeRate * timeDiffSeconds;
            
            if (altMslDiff > maxAltChange && altMslDiff > 300) {
              isAnomaly = true;
              anomalies[aircraftId].push({
                type: 'large_alt_msl_change',
                current: currentTrack,
                previous: previousTrack,
                details: {
                  altMslDiff,
                  maxAltChange,
                  timeDiffSeconds
                }
              });
            }
            
            // Check for sudden large change in AGL (more than 300 meters in a short time)
            const altAglDiff = Math.abs(parseFloat(currentTrack.alt_agl) - parseFloat(previousTrack.alt_agl));
            
            if (altAglDiff > maxAltChange && altAglDiff > 300) {
              isAnomaly = true;
              anomalies[aircraftId].push({
                type: 'large_alt_agl_change',
                current: currentTrack,
                previous: previousTrack,
                details: {
                  altAglDiff,
                  maxAltChange,
                  timeDiffSeconds
                }
              });
            }
            
            // Check for unrealistic speed change (more than 50 km/h in a short time)
            const speedDiff = Math.abs(parseFloat(currentTrack.speed_kmh) - parseFloat(previousTrack.speed_kmh));
            const maxSpeedChange = 50; // km/h
            
            if (speedDiff > maxSpeedChange) {
              isAnomaly = true;
              anomalies[aircraftId].push({
                type: 'unrealistic_speed_change',
                current: currentTrack,
                previous: previousTrack,
                details: { speedDiff }
              });
            }
            
            // Check for extreme vertical speed (more than 15 m/s)
            const vs = parseFloat(currentTrack.vs);
            
            if (Math.abs(vs) > 15) {
              isAnomaly = true;
              anomalies[aircraftId].push({
                type: 'extreme_vertical_speed',
                current: currentTrack,
                previous: previousTrack,
                details: { vs }
              });
            }
          }
        }

        if (!isAnomaly) {
          filteredTracks[aircraftId].push(currentTrack);
        }
      }
    }

    return { filteredTracks, anomalies };
  }

  /**
   * Checks if a new track point is an anomaly compared to existing track history.
   * @param {Object} newPoint - The new track point to check
   * @param {Array<Object>} trackHistory - Array of previous track points for the same aircraft
   * @returns {Object} Object containing isAnomaly flag and anomalyDetails if any
   */
  isPointAnomaly(newPoint, trackHistory) {
    if (!trackHistory || trackHistory.length === 0) {
      // No history to compare against, assume point is valid
      return { isAnomaly: false };
    }

    // Sort track history by timestamp (newest first)
    const sortedHistory = [...trackHistory].sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    // Get the most recent point
    const previousPoint = sortedHistory[0];
    
    // Create a temporary tracks object for the filterInaccurateTracks method
    const aircraftId = newPoint.aircraft_id;
    const tempTracks = {
      [aircraftId]: [previousPoint, newPoint]
    };
    
    this.tracks = tempTracks;
    
    // Run the filtering logic
    const { anomalies } = this.filterInaccurateTracks();
    
    // Check if the new point was flagged as an anomaly
    const hasAnomalies = anomalies[aircraftId] &&
                         anomalies[aircraftId].some(a =>
                           a.current && a.current.timestamp &&
                           new Date(a.current.timestamp).getTime() === new Date(newPoint.timestamp).getTime());
    
    return {
      isAnomaly: hasAnomalies,
      anomalyDetails: hasAnomalies ? anomalies[aircraftId] : null
    };
  }
}
