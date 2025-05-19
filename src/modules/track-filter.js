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
          // Example: Check for large jump in latitude (threshold needs refinement)
          const latDiff = Math.abs(parseFloat(currentTrack.lat) - parseFloat(previousTrack.lat));
          if (latDiff > 0.1) { // Example threshold: 0.1 degrees latitude
            isAnomaly = true;
            anomalies[aircraftId].push({ type: 'large_lat_jump', current: currentTrack, previous: previousTrack });
          }

          // Example: Check for large jump in longitude (threshold needs refinement)
          const lonDiff = Math.abs(parseFloat(currentTrack.lon) - parseFloat(previousTrack.lon));
           if (lonDiff > 0.1) { // Example threshold: 0.1 degrees longitude
            isAnomaly = true;
            anomalies[aircraftId].push({ type: 'large_lon_jump', current: currentTrack, previous: previousTrack });
          }

          // Example: Check for sudden large change in alt_msl (threshold needs refinement)
          const altMslDiff = Math.abs(parseFloat(currentTrack.alt_msl) - parseFloat(previousTrack.alt_msl));
          if (altMslDiff > 500) { // Example threshold: 500 meters
             isAnomaly = true;
             anomalies[aircraftId].push({ type: 'large_alt_msl_change', current: currentTrack, previous: previousTrack });
          }

           // Example: Check for sudden large change in alt_agl (threshold needs refinement)
          const altAglDiff = Math.abs(parseFloat(currentTrack.alt_agl) - parseFloat(previousTrack.alt_agl));
          if (altAglDiff > 500) { // Example threshold: 500 meters
             isAnomaly = true;
             anomalies[aircraftId].push({ type: 'large_alt_agl_change', current: currentTrack, previous: previousTrack });
          }

          // Example: Check for unrealistic speed change (threshold needs refinement)
          const speedDiff = Math.abs(parseFloat(currentTrack.speed_kmh) - parseFloat(previousTrack.speed_kmh));
          if (speedDiff > 200) { // Example threshold: 200 km/h
             isAnomaly = true;
             anomalies[aircraftId].push({ type: 'unrealistic_speed_change', current: currentTrack, previous: previousTrack });
          }

          // Example: Check for extreme vertical speed (threshold needs refinement)
          const vs = parseFloat(currentTrack.vs);
          if (Math.abs(vs) > 50) { // Example threshold: 50 m/s
             isAnomaly = true;
             anomalies[aircraftId].push({ type: 'extreme_vertical_speed', current: currentTrack, previous: previousTrack });
          }

        }


        if (!isAnomaly) {
          filteredTracks[aircraftId].push(currentTrack);
        }
      }
    }

    return { filteredTracks, anomalies };
  }
}
