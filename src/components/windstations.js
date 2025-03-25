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

// Main function to fetch and display wind stations.
function fetchWindStations() {
    // Make sure the map exists before trying to use it
    if (!window.map || typeof window.map.getBounds !== 'function') {
      console.error('Map not properly initialized');
      return;
    }

  const bounds = window.map.getBounds();
  const nwLat = bounds.getNorthWest().lat;
  const nwLng = bounds.getNorthWest().lng;
  const seLat = bounds.getSouthEast().lat;
  const seLng = bounds.getSouthEast().lng;
  fetch(
    `${process.env.APP_DOMAIN}/api/wind-data-getCurrent?nwLat=${nwLat}&nwLng=${nwLng}&seLat=${seLat}&seLng=${seLng}`
  )
    .then((response) => response.json())
    .then((responseData) => {
      if (!Array.isArray(responseData)) {
        throw new Error("Invalid data format received from API");
      }
      // Clear previous markers.
      windLayer.clearLayers();
      console.log('Wind layers cleared'); // Add this

      responseData.forEach((station) => {
        const [lon, lat] = station.loc.coordinates;
        const windDirection = station.last["w-dir"];
        const windAvg = station.last["w-avg"];
        const windMax = station.last["w-max"];
        const tempC = station.last["temp"];
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
        const marker = L.marker([lat, lon], { icon: arrowIcon }).addTo(windLayer);

        // Fetch historical data for this station.
        fetch(
          `https://winds.mobi/api/2.3/stations/${station._id}/historic/?duration=21000&keys=w-dir&keys=w-avg&keys=w-max&keys=temp`
        )
          .then((response) => response.json())
          .then((historyData) => {
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
                <td>
                  <span class="wind-direction-arrow" style="padding-top: 3px; padding-bottom: 3px; transform: rotate(${entry["w-dir"] + 180}deg);">⬆</span>
                  ${compassDir}
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
            const popupHtml = `
              <div style="display: flex; gap: 1px; align-items: flex-start; max-width: 700px">
                <div style="flex: 1;" class="wind-station-popup-content">
                  <strong>${station.short}</strong><br><br>
                  <tag-name>Wind Speed:&#9;&#9;${windAvg} km/h<br></tag-name>
                  <tag-name>Max Wind:&#9;&#9;${windMax} km/h<br></tag-name>
                  <tag-name>Wind Direction:&#9;${windDirection}° (${compassDirection})<br></tag-name>
                  <tag-name>Last Update:&#9;&#9;${lastUpdate}<br><br></tag-name>
                </div>
                ${isHolfuy ? `
                  <div style="flex: 0 0 auto; width: 110px;">
                    <iframe src="https://widget.holfuy.com/?station=${holfuyStationId}&su=km/h&t=C&lang=en&mode=rose&size=110"
                      width="160"
                      height="110"
                      frameborder="0"
                      scrolling="no">
                    </iframe>
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

            // When the popup is opened, initialize the chart.
            // When the popup is opened, initialize the chart.
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
                              ctx.font = "18px Arial";
                              ctx.fillText("⬆", 0, 0);
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
                if (station._id === "holfuy-361" || station._id === "holfuy-363") {
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
                  if (cameraImageElement.parentNode) {
                      cameraImageElement.parentNode.replaceChild(container, cameraImageElement);
                      cameraTabElement.style.display = "block";
                      console.log("Successfully replaced image with container");
                  } else {
                      console.error("Cannot find parent of image element for replacement");
                      cameraTabElement.style.display = "none";
                      return;
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
                  if (station._id === "holfuy-363") {
                      websiteUrl = 'https://www.moselfalken.de/meerfeld';
                  }
                  
                  // Fetch the website via our proxy
                  const websiteProxyUrl = `${process.env.APP_DOMAIN}/api/proxy?imageUrl=${websiteUrl}`;
                  
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
                        if (img && (img.src.includes('cam') || (img.alt && img.alt.includes('Webcam')))) {
                          webcamPicture = picture;
                          break;
                        }
                      }
                      
                      // If we didn't find a specific webcam picture, use the first one
                      if (!webcamPicture) {
                        webcamPicture = pictureElements[0];
                      }
                      
                      // Find all source elements and the img element in the picture
                      const sourceElements = webcamPicture.querySelectorAll('source');
                      const imgElement = webcamPicture.querySelector('img');
                      
                      let imageUrl = '';
                      
                      // Try to get URL from the last source element (highest resolution)
                      if (sourceElements.length > 0) {
                        const lastSource = sourceElements[sourceElements.length - 1];
                        const srcset = lastSource.getAttribute('srcset');
                        if (srcset) {
                          // Extract the URL part before " 1x" if present
                          imageUrl = srcset.split(' ')[0];
                        }
                      }
                      
                      // Fallback to img src if no source element found
                      if (!imageUrl && imgElement) {
                        imageUrl = imgElement.getAttribute('src');
                      }
                      
                      if (!imageUrl) {
                        throw new Error('Could not extract image URL from HTML');
                      }
                      
                      // Convert relative URL to absolute URL
                      if (imageUrl.startsWith('/')) {
                        imageUrl = 'https://www.moselfalken.de' + imageUrl;
                      } else if (!imageUrl.startsWith('http')) {
                        imageUrl = 'https://www.moselfalken.de/' + imageUrl;
                      }
                      
                      // Now fetch the image via the proxy
                      const imageProxyUrl = `${process.env.APP_DOMAIN}/api/proxy?imageUrl=${imageUrl}`;
                      
                      // Create a new image element
                      const img = document.createElement('img');
                      img.alt = "Moselfalken Webcam";
                      img.classList.add('webcam-image');
                      
                      // Replace the loading text with just the image
                      container.innerHTML = '';
                      container.appendChild(img);
                    })
                    .catch(error => {
                      // If there's an error, hide the camera tab
                      cameraTabElement.style.display = "none";
                    });
                } else {
                  // Original behavior for other Holfuy stations
                  const cameraImageUrl = `https://holfuy.com/en/takeit/cam/s${holfuyStationId}.jpg`;
                  
                  // Create temporary image to test validity
                  const testImage = new Image();
                  testImage.onload = function() {
                    // Only show tab if image loads successfully
                    cameraImageElement.src = cameraImageUrl;
                    cameraTabElement.style.display = "block";
                  };
                  testImage.onerror = function() {
                    // Hide tab if image fails to load
                    cameraTabElement.style.display = "none";
                  };
                  testImage.src = cameraImageUrl;
                  
                  // Set timeout as fallback in case responses are slow
                  setTimeout(() => {
                    if (!testImage.complete || testImage.naturalWidth === 0) {
                      cameraTabElement.style.display = "none";
                    }
                  }, 2000);
                }
              }, 500);
            });

          })
          .catch((error) =>
            console.error("Error fetching historical wind data:", error)
          );
      });
    })
    .catch((error) =>
      console.error("Error fetching wind station data:", error)
    );
}


// Enhanced tab switching function.
window.showTab = function (tabId, element) {
  console.log("Switching to tab:", tabId);

  document.querySelectorAll(".tab-content").forEach((tab) => {
    tab.style.display = "none";
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.remove("active");
  });

  const targetTab = document.getElementById(tabId);
  if (targetTab) {
    targetTab.style.display = "block";
  } else {
    console.error("Tab not found:", tabId);
  }

  if (element) {
    element.classList.add("active");
  } else {
    console.error("Element is null or undefined");
  }

  if (tabId.startsWith("chart-")) {
    const stationId = tabId.split("chart-")[1];
    console.log("Station ID:", stationId);
    const canvas = document.getElementById(`canvas-${stationId}`);
    if (canvas && canvas.chartInstance) {
      canvas.chartInstance.resize();
    }
  }
};

window.fetchWindStations = fetchWindStations;
