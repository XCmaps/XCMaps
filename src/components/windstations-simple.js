// windstations-simple.js - Simplified version of windstations.js

// Function to fetch wind stations
function fetchWindStations() {
  console.log("Fetching wind stations...");
  
  // Clear existing wind layers
  console.log("Wind layers cleared");
  
  // Get map bounds
  const bounds = window.map ? window.map.getBounds() : null;
  if (!bounds) {
    console.error("Map bounds not available");
    return;
  }
  
  const nwLat = bounds.getNorthWest().lat;
  const nwLng = bounds.getNorthWest().lng;
  const seLat = bounds.getSouthEast().lat;
  const seLng = bounds.getSouthEast().lng;
  
  // Fetch wind station data using the correct API endpoint
  fetch(`/api/wind-data-getCurrent?nwLat=${nwLat}&nwLng=${nwLng}&seLat=${seLat}&seLng=${seLng}`)
    .then((response) => response.json())
    .then((data) => {
      // Process wind stations
      data.forEach((station) => {
        // Create marker for each station
        const marker = L.marker([station.lat, station.lon], {
          icon: L.icon({
            iconUrl: `/assets/images/wind-icon.png`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -12],
          }),
        });
        
        // Fetch historical wind data using the correct API endpoint
        fetch(`https://winds.mobi/api/2.3/stations/${station._id}/historic/?duration=21000&keys=w-dir&keys=w-avg&keys=w-max&keys=temp`)
          .then((response) => response.json())
          .then((chartData) => {
            // Create popup content
            const historyTable = createHistoryTable(chartData);
            
            const popupHtml = `
              <style>
                .tab-container {
                  display: flex;
                  border-bottom: 1px solid #ddd;
                  padding: 10px 10px 0;
                  background-color: #f5f5f5;
                }
                
                .tab {
                  padding: 8px 12px;
                  margin-right: 5px;
                  margin-bottom: 5px;
                  background-color: #e0e0e0;
                  border-radius: 4px 4px 0 0;
                  cursor: pointer;
                }
                
                .tab.active {
                  background-color: #fff;
                  border: 1px solid #ddd;
                  border-bottom: 1px solid #fff;
                  margin-bottom: -1px;
                }
                
                .tab-content {
                  padding: 10px;
                  display: none;
                }
                
                .wind-data-table {
                  width: 100%;
                  border-collapse: collapse;
                }
                
                .wind-data-table th, .wind-data-table td {
                  padding: 8px;
                  text-align: left;
                  border-bottom: 1px solid #ddd;
                }
                
                .wind-data-table th {
                  background-color: #f5f5f5;
                }
                
                @media (max-width: 480px) {
                  .tab {
                    padding: 6px 10px;
                    font-size: 12px;
                  }
                  
                  .wind-data-table th, .wind-data-table td {
                    padding: 5px 3px;
                    font-size: 12px;
                  }
                  
                  .wind-rose {
                    display: none;
                  }
                }
              </style>
              <div class="tab-container">
                <div class="tab active" onclick="showTab('table-${station._id}', this)">Table</div>
                <div class="tab" onclick="showTab('chart-${station._id}', this)">Chart</div>
                <div class="tab" onclick="showTab('camera-${station._id}', this)">Camera</div>
              </div>
              <div id="table-${station._id}" class="tab-content">
                ${historyTable}
              </div>
              <div id="chart-${station._id}" class="tab-content chart-container" style="display: none;">
                <canvas id="canvas-${station._id}" width="100%" height="200"></canvas>
              </div>
              <div id="camera-${station._id}" class="tab-content" style="display: none;">
                <img id="camera-image-${station._id}" src="" alt="Camera Image" style="width: 100%; height: auto;">
              </div>
            `;
            
            // Determine optimal popup size based on device
            const isMobile = window.innerWidth <= 480;
            
            // Use standard Leaflet popup
            const popupOptions = {
              maxWidth: isMobile ? window.innerWidth - 20 : 400,
              className: 'wind-station-responsive-popup' + (isMobile ? ' mobile-popup' : '')
            };
            
            marker.bindPopup(popupHtml, popupOptions);
            
            // When the popup is opened, initialize the chart
            marker.on("popupopen", () => {
              setTimeout(() => {
                const canvas = document.getElementById(`canvas-${station._id}`);
                if (canvas) {
                  // Get dimensions for the canvas
                  const isMobile = window.innerWidth <= 480;
                  const parent = canvas.parentElement;
                  
                  // Calculate optimal dimensions
                  const containerWidth = parent ? parent.clientWidth : (window.innerWidth - 40);
                  const containerHeight = isMobile ? 200 : 300;
                  
                  // Set canvas style dimensions
                  canvas.style.width = containerWidth + "px";
                  canvas.style.height = containerHeight + "px";
                  
                  // Set explicit canvas dimensions
                  canvas.width = containerWidth;
                  canvas.height = containerHeight;
                  
                  // Ensure canvas is visible
                  canvas.style.display = 'block';
                  
                  // Force a reflow to ensure dimensions are applied
                  if (parent) {
                    parent.style.display = 'flex';
                    parent.style.justifyContent = 'center';
                    parent.style.alignItems = 'center';
                    parent.offsetHeight; // Force reflow
                  }
                  
                  console.log(`Canvas dimensions set: ${canvas.width}x${canvas.height}`);
                  
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
                        animation: {
                          duration: 0 // Disable animations for better performance
                        },
                        resizeDelay: 0, // Immediate resize
                        layout: {
                          padding: {
                            left: 2,
                            right: 2,
                            top: 2,
                            bottom: 5
                          },
                        },
                        plugins: {
                          legend: {
                            display: false // Hide legend to save space
                          },
                          tooltip: {
                            enabled: true,
                            mode: 'index',
                            intersect: false,
                            callbacks: {
                              title: function(tooltipItems) {
                                // Format the time for the tooltip
                                const date = new Date(tooltipItems[0].parsed.x);
                                return date.toLocaleTimeString("de-DE", {
                                  hour: "2-digit",
                                  minute: "2-digit"
                                });
                              }
                            }
                          }
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
                              color: 'rgba(0,0,0,0.1)',
                            },
                            ticks: {
                              autoSkip: true,
                              maxRotation: 0,
                              minRotation: 0,
                              padding: 5,
                              maxTicksLimit: window.innerWidth <= 480 ? 4 : 8,
                            }
                          },
                          y: {
                            beginAtZero: true,
                            grid: {
                              drawBorder: true,
                              color: 'rgba(0,0,0,0.1)',
                            },
                            ticks: {
                              padding: 5,
                              maxTicksLimit: 5,
                            }
                          }
                        }
                      }
                    });
                    
                    // Store chart instance on canvas for later access
                    canvas.chartInstance = chartInstance;
                  }
                }
                
                // Check if camera image is available
                if (station.camera && station.camera.url) {
                  const cameraImageUrl = station.camera.url;
                  const cameraImage = document.getElementById(`camera-image-${station._id}`);
                  const cameraTabElement = document.getElementById(`camera-${station._id}`);
                  
                  if (cameraImage) {
                    cameraImage.src = cameraImageUrl;
                  }
                  
                  // Test if image is available
                  const testImage = new Image();
                  testImage.onload = function() {
                    // Image loaded successfully, show camera tab
                    if (cameraTabElement) {
                      cameraTabElement.style.display = "block";
                    }
                  };
                  testImage.onerror = function() {
                    // Image failed to load, hide camera tab
                    if (cameraTabElement) {
                      cameraTabElement.style.display = "none";
                    }
                  };
                  testImage.src = cameraImageUrl;
                  
                  // Set timeout as fallback in case responses are slow
                  setTimeout(() => {
                    if (!testImage.complete || testImage.naturalWidth === 0) {
                      if (cameraTabElement) {
                        cameraTabElement.style.display = "none";
                      }
                    }
                  }, 2000);
                }
              }, 500);
            });
          })
          .catch((error) => {
            console.error("Error fetching historical wind data:", error);
          });
      });
    })
    .catch((error) => {
      console.error("Error fetching wind station data:", error);
    });
}

// Helper function to create history table
function createHistoryTable(chartData) {
  // Create table HTML
  let tableHtml = `
    <table class="wind-data-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Wind Avg</th>
          <th>Wind Max</th>
          <th>Direction</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  // Add rows for each data point
  chartData.forEach((entry) => {
    const date = new Date(entry._id * 1000);
    const time = date.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit"
    });
    
    tableHtml += `
      <tr>
        <td>${time}</td>
        <td>${entry["w-avg"]} km/h</td>
        <td>${entry["w-max"]} km/h</td>
        <td>${entry["w-dir"]}</td>
      </tr>
    `;
  });
  
  tableHtml += `
      </tbody>
    </table>
  `;
  
  return tableHtml;
}

// Enhanced tab switching function with improved chart handling
window.showTab = function (tabId, element) {
  console.log("Switching to tab:", tabId);
  
  // Check if we're on mobile
  const isMobile = window.innerWidth <= 480;
  const popupElement = element ? element.closest('.mobile-popup') : null;
  
  // If we're on mobile and using the mobile popup, don't hide content
  if (isMobile && popupElement) {
    // Just add active class to the clicked tab
    if (element) {
      document.querySelectorAll(".tab").forEach((tab) => {
        tab.classList.remove("active");
      });
      element.classList.add("active");
    }
    
    // Make sure all content is visible
    document.querySelectorAll(".tab-content").forEach((tab) => {
      tab.style.display = "block";
    });
    
    // Scroll to the clicked section
    const targetTab = document.getElementById(tabId);
    if (targetTab) {
      targetTab.scrollIntoView({ behavior: 'smooth' });
    }
  } else {
    // Standard tab behavior for desktop
    // Hide all tab content
    document.querySelectorAll(".tab-content").forEach((tab) => {
      tab.style.display = "none";
    });

    // Remove active class from all tabs
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.remove("active");
    });

    // Show the target tab
    const targetTab = document.getElementById(tabId);
    if (targetTab) {
      targetTab.style.display = "block";
      
      // Force repaint to ensure visibility
      targetTab.offsetHeight;
    } else {
      console.error("Tab not found:", tabId);
    }

    // Add active class to the clicked tab
    if (element) {
      element.classList.add("active");
    } else {
      console.error("Element is null or undefined");
    }
  }

  // Special handling for chart tab
  if (tabId.startsWith("chart-")) {
    const stationId = tabId.split("chart-")[1];
    console.log("Station ID:", stationId);
    const canvas = document.getElementById(`canvas-${stationId}`);
    
    if (canvas) {
      // Force canvas to be visible
      canvas.style.display = "block";
      
      // Get the container dimensions
      const container = document.getElementById(tabId);
      const isMobile = window.innerWidth <= 480;
      
      // Calculate container width based on available space
      let containerWidth;
      if (isMobile) {
        // On mobile, use full browser width minus padding
        containerWidth = window.innerWidth - 20;
      } else {
        // On desktop, use container width
        containerWidth = container ? container.clientWidth : 400;
      }
      
      // Set canvas dimensions based on container
      canvas.style.width = containerWidth + "px";
      canvas.style.height = (isMobile ? 200 : 300) + "px";
      
      // Set explicit dimensions for the canvas element
      canvas.width = containerWidth;
      canvas.height = isMobile ? 200 : 300;
      
      // Force a reflow
      if (container) container.offsetHeight;
      
      // Resize the chart if it exists
      if (canvas.chartInstance) {
        setTimeout(() => {
          try {
            canvas.chartInstance.resize();
            console.log("Chart resized successfully");
          } catch (e) {
            console.error("Error resizing chart:", e);
          }
        }, 100);
        
        // Add resize listener for the chart
        const resizeChartOnWindowResize = () => {
          if (canvas && canvas.chartInstance) {
            const newIsMobile = window.innerWidth <= 480;
            const newContainerWidth = newIsMobile ? window.innerWidth - 20 : (container ? container.clientWidth : 400);
            
            // Update canvas dimensions
            canvas.style.width = newContainerWidth + "px";
            canvas.style.height = (newIsMobile ? 200 : 300) + "px";
            canvas.width = newContainerWidth;
            canvas.height = newIsMobile ? 200 : 300;
            
            // Resize chart
            try {
              canvas.chartInstance.resize();
              console.log("Chart resized on window resize in tab view");
            } catch (e) {
              console.error("Error resizing chart:", e);
            }
          }
        };
        
        // Remove any existing handler
        if (canvas.resizeHandler) {
          window.removeEventListener('resize', canvas.resizeHandler);
        }
        
        // Add resize listener
        window.addEventListener('resize', resizeChartOnWindowResize);
        
        // Store the resize handler on the canvas for cleanup
        canvas.resizeHandler = resizeChartOnWindowResize;
      }
    }
  }
};

window.fetchWindStations = fetchWindStations;