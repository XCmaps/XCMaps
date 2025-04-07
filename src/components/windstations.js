// spotsHelper.js - Common functionality for loading and displaying spots on a map

// Module-scoped variable to track Dropzone instance
let feedbackDropzone = null;
let currentFeedbackForm = null;

// Swiper related functions
function changeSwiper() {
    if (typeof swiperc !== "undefined") {
        $(".swiper2").removeClass("swiper-small swiper-medium swiper-large"); // Remove all classes first
        if (window.innerWidth < 576) {
            $(".swiper2").addClass("swiper-small");
            swiperc.changeDirection('horizontal', true);
        }
        else {
            if (window.innerWidth < 840) {
                $(".swiper2").addClass("swiper-medium");
            }
            else {
                $(".swiper2").addClass("swiper-large");
            }
            swiperc.changeDirection('vertical', true);
        }
    }
}

function initSwiper(idImg) {
    let swiperv, swiperc;
    // USED 09/24 Beschreibung: Initialisierung der Image-Swiper
    var swiperLoop3 = (idImg < 4) ? false : true;
    var swiperLoop4 = (idImg < 5) ? false : true;

    swiperv = new Swiper('.swiper1', {
        autoHeight: true,
        direction: 'horizontal',
        allowTouchMove: false,
        mousewheel: false,
        slidesPerView: 1,
        loop: false,
    });

    swiperc = new Swiper('.swiper2', {
        direction: 'vertical',
        allowTouchMove: true,
        mousewheel: true,
        slidesPerView: 3,
        spaceBetween: 10,
        loop: swiperLoop3,
        breakpoints: {
            840: {
                slidesPerView: 4,
                loop: swiperLoop4
            }
        },
        scrollbar: {
            el: '.swiper-scrollbar',
            hide: false,
            draggable: true,
        },
        on: {
            click: function() {
                let iR = (this.clickedSlide.firstChild.id).substring(3) - 1;
                swiperv.slideTo(iR, 1);
            },
            transitionEnd: function () {
                let iR = this.realIndex;
                swiperv.slideTo(iR, 1);
            }
        }
    });

    changeSwiper();
}

// Mapping wind directions to angles
function getCompassDirection(deg) {
    const directions = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    ];
    return directions[Math.round(deg / 22.5) % 16];
}

function getFillColor(speed) {
    if (speed >= 7 && speed <= 14) return "LimeGreen";
    if (speed >= 15 && speed <= 24) return "yellow";
    if (speed >= 25 && speed <= 30) return "orange";
    if (speed >= 31 && speed <= 36) return "red";
    if (speed > 36) return "black";
    return "Aquamarine";
}

function getStrokeColor(speed) {
    if (speed >= 15 && speed <= 24) return "LimeGreen";
    if (speed >= 25 && speed <= 32) return "yellow";
    if (speed >= 33 && speed <= 38) return "orange";
    if (speed >= 39 && speed <= 44) return "red";
    if (speed > 44) return "black";
    return "Aquamarine";
}

function getTextColor(backgroundColor) {
    return backgroundColor === "black" ? "white" : "black";
}

// Helper: Process raw historical data into 10‑minute averages.
function processHistoricalData(data) {
    const grouped = {};
    data.forEach((entry) => {
        const dt = new Date(entry._id * 1000);
        // Round down to the nearest 10‑minute mark.
        dt.setMinutes(Math.floor(dt.getMinutes() / 10) * 10);
        dt.setSeconds(0);
        dt.setMilliseconds(0);
        const key = dt.getTime();
        if (!grouped[key]) {
            grouped[key] = { count: 0, wAvgSum: 0, wMaxSum: 0, wDirSum: 0, tempSum: 0, tempCount: 0 };
        }
        grouped[key].count++;
        grouped[key].wAvgSum += entry["w-avg"];
        grouped[key].wMaxSum += entry["w-max"];
        grouped[key].wDirSum += entry["w-dir"];
        if (entry["temp"] !== undefined) {
            grouped[key].tempSum += entry["temp"];
            grouped[key].tempCount++;
        }
    });
    const result = Object.keys(grouped).map((key) => ({
        _id: parseInt(key) / 1000, // back to seconds
        "w-avg": grouped[key].wAvgSum / grouped[key].count,
        "w-max": grouped[key].wMaxSum / grouped[key].count,
        "w-dir": grouped[key].wDirSum / grouped[key].count,
        "temp": grouped[key].tempCount > 0 ? grouped[key].tempSum / grouped[key].tempCount : undefined,
    }));
    // For the table we want descending order (most recent first).
    result.sort((a, b) => b._id - a._id);
    return result;
}

// Main function to fetch and display/update wind stations.
function fetchWindStations() {
    console.log('[fetchWindStations] Function called.'); // Added log
    // Make sure the map and windLayer exist before trying to use them
    if (!window.map || typeof window.map.getBounds !== 'function' || !window.windLayer) {
        console.error('[fetchWindStations] Map or windLayer not properly initialized, exiting.'); // Modified log
        return;
    }

    // Note: We don't need to track the open popup ID explicitly.
    // Leaflet keeps the popup open if only the icon is updated via setIcon().

    const bounds = window.map.getBounds();
    const nwLat = bounds.getNorthWest().lat;
    const nwLng = bounds.getNorthWest().lng;
    const seLat = bounds.getSouthEast().lat;
    const seLng = bounds.getSouthEast().lng;

    fetch(
        `/api/wind-data-getCurrent?nwLat=${nwLat}&nwLng=${nwLng}&seLat=${seLat}&seLng=${seLng}`
    )
    .then((response) => response.json())
    .then((responseData) => { // Main .then for station data
        if (!Array.isArray(responseData)) {
            console.error("[fetchWindStations] Invalid data format received from API:", responseData); // Added log
            throw new Error("Invalid data format received from API");
        }

        console.log(`[fetchWindStations] Received ${responseData.length} stations from API.`); // Added log
        const newStationsMap = new Map(responseData.map(station => [station._id, station]));
        const existingMarkersMap = new Map();
        window.windLayer.eachLayer(marker => {
            // Ensure we only process markers added by this logic (with stationId)
            if (marker.options && marker.options.stationId) {
                existingMarkersMap.set(marker.options.stationId, marker);
            }
        });

        let updatedCount = 0;
        let removedCount = 0;
        let addedCount = 0;
        // --- Update existing markers or remove old ones ---
        existingMarkersMap.forEach((marker, stationId) => {
            const newStationData = newStationsMap.get(stationId);
            if (newStationData) {
                // Station exists, update its icon
                const windDirection = newStationData.last["w-dir"];
                const windAvg = newStationData.last["w-avg"];
                const windMax = newStationData.last["w-max"];
                const fillColor = getFillColor(windAvg);
                const strokeColor = getStrokeColor(windMax);
                const peakArrow = newStationData.peak ? "▲" : "▼";

                const newArrowSvg = `
                  <svg width="30" height="30" viewBox="0 0 800 900" xmlns="http://www.w3.org/2000/svg">
                    <g transform="rotate(${windDirection + 90}, 400, 400)" stroke="${strokeColor}" stroke-width="60">
                      <path d="M203,391 L75,144 L738,391 L75,637 L203,391 Z" fill="${fillColor}"/>
                    </g>
                    <text x="330" y="850" font-size="220" text-anchor="middle" fill="black" font-weight="bold">
                      ${peakArrow}${Math.round(windAvg)} / ${Math.round(windMax)}
                    </text>
                  </svg>`;

                const newArrowIcon = L.divIcon({
                    className: "wind-arrow",
                    html: newArrowSvg,
                    iconSize: [30, 30],
                    iconAnchor: [12, 15],
                });

                marker.setIcon(newArrowIcon);
                updatedCount++;

                // Remove from map so we know it's been processed and won't be added again
                newStationsMap.delete(stationId);

            } else {
                // Station no longer in data, remove marker
                // console.log(`Removing marker for station: ${stationId}`); // Debugging
                window.windLayer.removeLayer(marker);
                removedCount++;
            }
        }); // End existingMarkersMap.forEach

        // --- Add new markers ---
        newStationsMap.forEach((station) => { // Iterate only stations NOT already updated
            addedCount++;
            // console.log(`Adding new marker for station: ${station._id}`); // Debugging
            const [lon, lat] = station.loc.coordinates;
            const windDirection = station.last["w-dir"];
            const windAvg = station.last["w-avg"];
            const windMax = station.last["w-max"];
            // const tempC = station.last["temp"]; // Keep for potential future use in popup
            const compassDirection = getCompassDirection(windDirection);
            const lastUpdate = new Date(station.last["_id"] * 1000).toLocaleTimeString("de-DE", {hour: "2-digit", minute: "2-digit", });
            const fillColor = getFillColor(windAvg);
            const strokeColor = getStrokeColor(windMax);
            const peakArrow = station.peak ? "▲" : "▼";
            const isHolfuy = station._id.includes("holfuy");
            let holfuyStationId = '';
            if (isHolfuy) {
              holfuyStationId = station._id.split("-")[1];
            }

            // Create the SVG arrow icon.
            const arrowSvg = `
              <svg width="30" height="30" viewBox="0 0 800 900" xmlns="http://www.w3.org/2000/svg">
                <g transform="rotate(${windDirection + 90}, 400, 400)" stroke="${strokeColor}" stroke-width="60">
                  <path d="M203,391 L75,144 L738,391 L75,637 L203,391 Z" fill="${fillColor}"/>
                </g>
                <text x="330" y="850" font-size="220" text-anchor="middle" fill="black" font-weight="bold">
                  ${peakArrow}${Math.round(windAvg)} / ${Math.round(windMax)}
                </text>
              </svg>`;

            const arrowIcon = L.divIcon({
              className: "wind-arrow",
              html: arrowSvg,
              iconSize: [30, 30],
              iconAnchor: [12, 15],
            });

            // Create the marker.
            const marker = L.marker([lat, lon], {
                icon: arrowIcon,
                stationId: station._id // Store station ID in options
            }).addTo(window.windLayer);

            // --- Fetch historical data and bind popup ONLY for NEW markers ---
            fetch(
              `https://winds.mobi/api/2.3/stations/${station._id}/historic/?duration=21000&keys=w-dir&keys=w-avg&keys=w-max&keys=temp`
            )
              .then((response) => response.json())
              .then((historyData) => { // .then for history data
                // Process historyData into 10‑minute averages.
                const aggregatedData = processHistoricalData(historyData);

                // --- TABLE SETUP (10‑minute averages, limited to last 5 hours) ---
                const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
                const limitedData = aggregatedData.filter(
                  (entry) => entry._id * 1000 >= fiveHoursAgo
                ).slice(0, 24); // Limit to 24 most recent entries
                let historyTable = `<div class="table-responsive"><table class="wind-data-table table">
                  <thead>
                    <tr>
                      <th>Wind (m/s)</th>
                      <th>Gusts (m/s)</th>
                      <th>Direction</th>
                      <th>Temp C°</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>`;
                limitedData.forEach((entry) => {
                  const timeFormatted = new Date(entry._id * 1000).toLocaleTimeString("de-DE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const compassDir = getCompassDirection(entry["w-dir"]);
                  historyTable += `<tr>
                    <td class="wind-avg-cell" style="color: ${getTextColor(getFillColor(entry["w-avg"]))}; background-color: ${getFillColor(entry["w-avg"])};">
                      ${entry["w-avg"].toFixed(1)}
                    </td>
                    <td class="wind-max-cell" style="color: ${getTextColor(getStrokeColor(entry["w-max"]))}; background-color: ${getStrokeColor(entry["w-max"])};">
                      ${entry["w-max"].toFixed(1)}
                    </td>
                    <td style="white-space: nowrap;">
                      <span class="wind-direction-arrow" style="transform: rotate(${entry["w-dir"] + 180}deg);">
                          <i class="fa fa-long-arrow-up"></i>
                      </span>
                      &nbsp;&nbsp;${compassDir}
                    </td>
                    <td>${entry["temp"] !== undefined ? entry["temp"].toFixed(1) : "N/A"}</td>
                    <td>${timeFormatted}</td>
                  </tr>`;
                });
                historyTable += `</tbody></table></div>`;

                // --- CHART SETUP (10‑minute averages with hourly vertical grid lines) ---
                // For the chart we want ascending order (oldest first).
                const chartData = aggregatedData.slice().reverse();

                // Build the popup HTML with tabs.
                // Use the current data passed into this loop for the top section
                const currentWindAvg = station.last["w-avg"];
                const currentWindMax = station.last["w-max"];
                const currentWindDir = station.last["w-dir"];
                const currentCompassDir = getCompassDirection(currentWindDir);
                const currentLastUpdate = new Date(station.last["_id"] * 1000).toLocaleTimeString("de-DE", {hour: "2-digit", minute: "2-digit", });

                const popupHtml = `
                  <div style="display: flex; gap: 1px; align-items: flex-end; max-width: 700px">
                    <div style="flex: 1;" class="wind-station-popup-content">
                      <strong>${station.short}</strong><br><br>
                      <tag-name>Wind Speed:&#9;&#9;${currentWindAvg} km/h<br></tag-name>
                      <tag-name>Max Wind:&#9;&#9;${currentWindMax} km/h<br></tag-name>
                      <tag-name>Wind Direction:&#9;${currentWindDir}° (${currentCompassDir})<br></tag-name>
                      <tag-name>Last Update:&#9;&#9;${currentLastUpdate}<br><br></tag-name>
                    </div>
                    ${isHolfuy ? `
                      <div style="flex: 0 0 auto; width: 110px; margin-right: 15px; position: relative;">
                        <iframe src="https://widget.holfuy.com/?station=${holfuyStationId}&su=km/h&t=C&lang=en&mode=rose&size=110"
                          width="110"
                          height="110"
                          frameborder="0"
                          scrolling="no"
                          style="pointer-events: none;">
                        </iframe>
                        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10;"></div>
                      </div>
                    ` : ''}
                  </div>
                  
                  <div class="tab-container">
                    <div class="tab active" onclick="showTab('table-${station._id}', this)">Table</div>
                    <div class="tab" onclick="showTab('chart-${station._id}', this)">Chart</div>
                    <div class="tab" id="camera-tab-${station._id}" style="display: none;" onclick="showTab('camera-${station._id}', this)">Camera</div>
                  </div>
                  <div id="table-${station._id}" class="tab-content">
                    ${historyTable}
                  </div>
                  <div id="chart-${station._id}" class="tab-content" style="display: none;">
                    <canvas id="canvas-${station._id}" width="400" height="200"></canvas>
                  </div>
                  <div id="camera-${station._id}" class="tab-content" style="display: none;">
                    <img id="camera-image-${station._id}" src="" alt="Camera Image" class="camera-image">
                  </div>
                `;

                // Bind a responsive popup using the plugin.
                marker.bindPopup(
                  L.responsivePopup({
                    hasTip: true,
                    autoPan: false,
                    offset: [15, 25],
                    maxWidth: 700,
                    minWidth: 400,
                    maxHeight: 800,
                  }).setContent(popupHtml)
                );

                // When the popup is opened, initialize the chart and camera logic.
                marker.on("popupopen", () => {
                  setTimeout(() => {
                    const canvas = document.getElementById(`canvas-${station._id}`);
                    if (canvas) {
                      canvas.style.height = "300px";
                      const ctx = canvas.getContext("2d");
                      if (ctx) {
                        // Transform chartData so that each point has an x (timestamp) and y (value)
                        const chartDataPointsAvg = chartData.map((entry) => ({
                          x: entry._id * 1000, // convert seconds to ms
                          y: entry["w-avg"],
                        }));
                        const chartDataPointsMax = chartData.map((entry) => ({
                          x: entry._id * 1000,
                          y: entry["w-max"],
                        }));

                        const chartInstance = new Chart(ctx, {
                          type: "line",
                          data: {
                            datasets: [
                              {
                                label: "Wind Avg (km/h)",
                                data: chartDataPointsAvg,
                                borderColor: "blue",
                                fill: false,
                                pointRadius: 3,
                              },
                              {
                                label: "Wind Max (km/h)",
                                data: chartDataPointsMax,
                                borderColor: "red",
                                fill: false,
                                pointRadius: 3,
                              },
                            ],
                          },
                          options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            layout: {
                              // Add extra bottom padding so there's room for the arrows.
                              padding: { bottom: 5 },
                            },
                            scales: {
                              x: {
                                type: "time",
                                time: {
                                  unit: "hour",
                                  displayFormats: {
                                    hour: "HH:mm",
                                  },
                                  tooltipFormat: "HH:mm",
                                },
                                grid: {
                                  drawBorder: true,
                                },
                                ticks: {
                                  autoSkip: true,
                                  maxRotation: 0,
                                  minRotation: 0,
                                  padding: 30,
                                },
                              },
                              y: {
                                beginAtZero: true,
                                ticks: {
                                  stepSize: 10,
                                  maxTicksLimit: 10,
                                  font: { size: 14 },
                                },
                              },
                            },
                            plugins: {
                              legend: { display: false },
                            },
                          },
                          plugins: [
                            {
                              id: "windDirectionArrows",
                              afterDraw: (chart) => {
                                const ctx = chart.ctx;
                                const xAxis = chart.scales.x;
                                ctx.save();
                                // Position arrows just below the x-axis line 
                                const arrowRowY = xAxis.top + 20;
                                
                                // Set text properties for centered alignment
                                ctx.textAlign = "center";
                                ctx.textBaseline = "middle";
                                
                                chartData.forEach((entry) => {
                                  const x = xAxis.getPixelForValue(entry._id * 1000);
                                  ctx.save();
                                  ctx.translate(x, arrowRowY);
                                  ctx.rotate(((entry["w-dir"] + 180) * Math.PI) / 180);
                                  ctx.font = "extra-bold 12px 'Roboto', sans-serif";
                                  ctx.fillText("↑", 0, 0);
                                  ctx.restore();
                                });
                                ctx.restore();
                              },
                            },
                          ],
                          
                        });
                        canvas.chartInstance = chartInstance;
                      } else {
                        console.error("Failed to get 2D context from canvas.");
                      }
                    } else {
                      console.error("Canvas element not found.");
                    }
                    // Inside the popupopen event handler where camera handling happens:
                    const cameraTabElement = document.getElementById(`camera-tab-${station._id}`);
                    const cameraImageElement = document.getElementById(`camera-image-${station._id}`);
                    
                    // Special cases for Moselfalken webcams
                    if (station._id === "holfuy-361" || station._id === "holfuy-362" || station._id === "holfuy-363") {
                      console.log(`Handling special case for ${station._id}`);
                      
                      // Create a container div for better layout control
                      const container = document.createElement('div');
                      container.classList.add('holfuy-container');

                      // No heading needed
                      
                      // Add a loading indicator
                      const loadingText = document.createElement('div');
                      loadingText.textContent = 'Loading webcam image...';
                      loadingText.classList.add('loading-text');
                      container.appendChild(loadingText);
                      
                      // Replace the image element with our container
                      if (cameraImageElement && cameraImageElement.parentNode) { // Check if element exists
                          cameraImageElement.parentNode.replaceChild(container, cameraImageElement);
                          if (cameraTabElement) cameraTabElement.style.display = "block"; // Check if tab exists
                          console.log("Successfully replaced image with container");
                      } else {
                          console.error("Cannot find parent of image element or image element itself for replacement");
                          if (cameraTabElement) cameraTabElement.style.display = "none"; // Check if tab exists
                          return; // Exit if we can't replace
                      }
                      
                      // First fetch the Moselfalken website to extract the current image URL
                      
                      // Show loading state
                      const extractingText = document.createElement('div');
                      extractingText.textContent = 'Loading webcam image...';
                      extractingText.classList.add('loading-text');
                      container.innerHTML = '';
                      container.appendChild(extractingText);
                      
                      // Determine the website URL based on the station ID
                      let websiteUrl = 'https://www.moselfalken.de/zeltingen-rachtig'; // Default for holfuy-361
                      if (station._id === "holfuy-362") {
                          websiteUrl = 'https://www.moselfalken.de/ockfen';
                      } else if (station._id === "holfuy-363") {
                          websiteUrl = 'https://www.moselfalken.de/meerfeld';
                      }
                      
                      
                      // Fetch the website via our proxy
                      const websiteProxyUrl = `/api/proxy?imageUrl=${encodeURIComponent(websiteUrl)}`; // Ensure URL is encoded
                      console.log(`[${station._id}] Fetching website HTML from: ${websiteProxyUrl}`); // Added logging
                      fetch(websiteProxyUrl)
                        .then(response => {
                          if (!response.ok) {
                            throw new Error(`HTTP error! Status: ${response.status}`);
                          }
                          return response.text();
                        })
                        .then(html => {
                          // Parse the HTML
                          const parser = new DOMParser();
                          const doc = parser.parseFromString(html, 'text/html');
                          
                          // Find all picture elements
                          const pictureElements = doc.querySelectorAll('picture');
                          
                          if (pictureElements.length === 0) {
                            throw new Error('No picture elements found in HTML');
                          }
                          
                          // Look for a picture element that might contain the webcam image
                          let webcamPicture = null;
                          for (const picture of pictureElements) {
                            const img = picture.querySelector('img');
                            if (img && (img.src.includes('cam') || (img.alt && img.alt.toLowerCase().includes('webcam')))) { // Case-insensitive check
                              webcamPicture = picture;
                              break;
                            }
                          }
                          
                          // If we didn't find a specific webcam picture, use the first one as fallback
                          if (!webcamPicture && pictureElements.length > 0) {
                            console.warn(`[${station._id}] No specific webcam picture found, using first picture element as fallback.`);
                            webcamPicture = pictureElements[0];
                          } else if (!webcamPicture) {
                             throw new Error('No suitable picture element found.');
                          }
                          
                          // Find all source elements and the img element in the picture
                          const sourceElements = webcamPicture.querySelectorAll('source');
                          const imgElement = webcamPicture.querySelector('img');
                          
                          let imageUrl = '';
                          
                          // Try to get URL from the last source element (often highest resolution)
                          if (sourceElements.length > 0) {
                            const lastSource = sourceElements[sourceElements.length - 1];
                            const srcset = lastSource.getAttribute('srcset');
                            if (srcset) {
                              // Extract the URL part before potential " 1x", " 2x" descriptors
                              imageUrl = srcset.trim().split(' ')[0];
                            }
                          }
                          
                          // Fallback to img src if no source element found or srcset was empty
                          if (!imageUrl && imgElement) {
                            imageUrl = imgElement.getAttribute('src');
                          }
                          
                          if (!imageUrl) {
                            throw new Error('Could not extract image URL from picture element');
                          }
                          
                          // Convert relative URL to absolute URL based on the fetched website's origin
                          try {
                              const base = new URL(websiteUrl); // Use the original website URL as base
                              imageUrl = new URL(imageUrl, base).href;
                          } catch (e) {
                              console.error(`[${station._id}] Error constructing absolute URL for ${imageUrl} with base ${websiteUrl}:`, e);
                              throw new Error('Failed to construct absolute image URL');
                          }

                          console.log(`[${station._id}] Extracted absolute image URL: ${imageUrl}`); // Added logging
                          
                          // Now fetch the image via the proxy
                          const imageProxyUrl = `/api/proxy?imageUrl=${encodeURIComponent(imageUrl)}`; // Ensure URL is encoded
                          
                          // Create a new image element
                          const img = document.createElement('img');
                          img.alt = "Moselfalken Webcam";
                          img.classList.add('webcam-image'); // Use consistent class
                          img.style.maxWidth = '100%'; // Ensure image fits container
                          img.style.height = 'auto';
                          console.log(`[${station._id}] Setting image src to proxy: ${imageProxyUrl}`); // Added logging
                          img.src = imageProxyUrl;
                          
                          // Replace the loading text with just the image
                          container.innerHTML = '';
                          container.appendChild(img);
                        })
                        .catch(error => {
                          console.error(`[${station._id}] Error fetching/parsing website or extracting image URL:`, error); // Added logging
                          container.innerHTML = 'Error loading webcam.'; // Show error in container
                          // Optionally hide the tab if preferred on error
                          // if (cameraTabElement) cameraTabElement.style.display = "none";
                        });
                    } else if (isHolfuy && holfuyStationId) { // Handle other Holfuy stations
                      const cameraImageUrl = `https://holfuy.com/en/takeit/cam/s${holfuyStationId}.jpg`;
                      
                      // Create temporary image to test validity
                      const testImage = new Image();
                      testImage.onload = function() {
                        // Only show tab if image loads successfully
                        if (cameraImageElement) cameraImageElement.src = cameraImageUrl; // Check element exists
                        if (cameraTabElement) cameraTabElement.style.display = "block"; // Check element exists
                      };
                      testImage.onerror = function() {
                        // Hide tab if image fails to load
                         if (cameraTabElement) cameraTabElement.style.display = "none"; // Check element exists
                      };
                      testImage.src = cameraImageUrl;
                      
                      // Set timeout as fallback in case responses are slow
                      setTimeout(() => {
                        if (!testImage.complete || testImage.naturalWidth === 0) {
                           if (cameraTabElement) cameraTabElement.style.display = "none"; // Check element exists
                        }
                      }, 3000); // Increased timeout slightly
                    } else {
                       // If not Holfuy or no ID, ensure tab is hidden
                       if (cameraTabElement) cameraTabElement.style.display = "none";
                    }
                  }, 500); // End setTimeout for popupopen
                }); // End marker.on("popupopen")

              }) // End .then for history data
              .catch((error) =>
                console.error(`Error fetching historical wind data for ${station._id}:`, error)
              ); // End .catch for history data
        }); // End newStationsMap.forEach

        console.log(`[fetchWindStations] Update complete. Updated: ${updatedCount}, Removed: ${removedCount}, Added: ${addedCount}`); // Added summary log
    }) // End .then for station data
    .catch((error) =>
      console.error("Error fetching wind station data:", error)
    ); // End .catch for station data
} // End fetchWindStations function


// Enhanced tab switching function.
function showTab(tabId, element) {
  console.log("Switching to tab:", tabId);

  // Find the closest popup content container to ensure we only affect tabs within the current popup
  let popupContent = element ? element.closest('.leaflet-popup-content') : null;
  if (!popupContent) {
      // Fallback if element is null or not inside a popup (shouldn't happen with onclick)
      popupContent = document; // Less ideal, might affect other popups if multiple are open somehow
      console.warn("Could not find parent popup content for tab switching, using document as root.");
  }

  // Hide all tab content within this specific popup
  popupContent.querySelectorAll(".tab-content").forEach((tab) => {
    tab.style.display = "none";
  });

  // Deactivate all tabs within this specific popup
  popupContent.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.remove("active");
  });

  // Show the target tab content within this specific popup
  const targetTab = popupContent.querySelector(`#${tabId}`); // Search within popupContent
  if (targetTab) {
    targetTab.style.display = "block";
  } else {
    console.error("Tab content not found within this popup:", tabId);
  }

  // Activate the clicked tab element
  if (element) {
    element.classList.add("active");
  } else {
    console.error("Clicked tab element is null or undefined");
  }

  // Resize chart if the chart tab was selected
  if (tabId.startsWith("chart-")) {
    const stationId = tabId.split("chart-")[1];
    // console.log("Resizing chart for Station ID:", stationId); // Debugging
    const canvas = popupContent.querySelector(`#canvas-${stationId}`); // Search within popupContent
    if (canvas && canvas.chartInstance) {
      // Need a slight delay for the tab content to become visible and have dimensions
      setTimeout(() => {
          canvas.chartInstance.resize();
          // console.log("Chart resized."); // Debugging
      }, 50);
    } else if (canvas && !canvas.chartInstance) {
        console.warn("Canvas found, but chart instance not attached.");
    } else {
        // console.warn("Canvas not found for chart resize."); // Debugging
    }
  }
};

// Assign functions to window object for global access
window.showTab = showTab;
window.fetchWindStations = fetchWindStations;
