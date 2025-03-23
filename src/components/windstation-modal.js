/**
 * Wind Station Modal
 * A custom modal implementation for displaying wind station data
 */

// Make functions available globally
window.createWindStationModal = createModal;
window.showWindStationModal = showModal;
window.initializeWindStationChart = initializeChart;
window.showWindStationTab = showTab;

// Create modal container if it doesn't exist
function createModal() {
  // Check if modal already exists
  let modal = document.getElementById('wind-station-modal');
  
  // Create modal if it doesn't exist
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'wind-station-modal';
    modal.className = 'wind-station-modal';
    document.body.appendChild(modal);
    
    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'wind-station-modal-close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = function() {
      modal.style.display = 'none';
    };
    modal.appendChild(closeBtn);
    
    // Add content container
    const contentDiv = document.createElement('div');
    contentDiv.className = 'wind-station-modal-content';
    modal.appendChild(contentDiv);
    
    // Add resize handler
    window.addEventListener('resize', function() {
      if (modal.style.display === 'block') {
        const isMobile = window.innerWidth <= 480;
        
        if (isMobile) {
          modal.className = 'wind-station-modal mobile-popup';
        } else {
          modal.className = 'wind-station-modal';
        }
        
        // Find all canvases in the modal
        const canvases = modal.querySelectorAll('canvas');
        canvases.forEach(canvas => {
          if (canvas && canvas.chartInstance) {
            const containerWidth = isMobile ? window.innerWidth - 20 : 380;
            
            // Update canvas dimensions
            canvas.style.width = containerWidth + "px";
            canvas.style.height = (isMobile ? 200 : 300) + "px";
            canvas.width = containerWidth;
            canvas.height = isMobile ? 200 : 300;
            
            // Resize chart
            try {
              canvas.chartInstance.resize();
              console.log("Chart resized on window resize");
            } catch (e) {
              console.error("Error resizing chart:", e);
            }
          }
        });
      }
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
      if (event.target === modal) {
        modal.style.display = 'none';
      }
    });
    
    // Close modal with Escape key
    window.addEventListener('keydown', function(event) {
      if (event.key === 'Escape' && modal.style.display === 'block') {
        modal.style.display = 'none';
      }
    });
  }
  
  return modal;
}

// Show modal with content
function showModal(content) {
  const modal = createModal();
  
  // Get content container
  const contentDiv = modal.querySelector('.wind-station-modal-content');
  
  // Set content
  contentDiv.innerHTML = content;
  
  // Show modal
  modal.style.display = 'block';
  
  // Set modal position and size based on screen size
  const isMobile = window.innerWidth <= 480;
  if (isMobile) {
    modal.className = 'wind-station-modal mobile-popup';
  } else {
    modal.className = 'wind-station-modal';
  }
  
  // Initialize tabs
  const tabs = modal.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', function() {
      const tabId = this.getAttribute('data-tab');
      showTab(tabId, this);
    });
  });
  
  // Show first tab by default
  if (tabs.length > 0) {
    const firstTab = tabs[0];
    const tabId = firstTab.getAttribute('data-tab');
    showTab(tabId, firstTab);
  }
  
  return modal;
}

// Initialize chart in modal
function initializeChart(canvas, chartData) {
  if (!canvas || !chartData || chartData.length === 0) return;
  
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  
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

// Show tab content
function showTab(tabId, element) {
  // Check if we're on mobile
  const isMobile = window.innerWidth <= 480;
  const modal = document.getElementById('wind-station-modal');
  const isModalMobile = modal && modal.classList.contains('mobile-popup');
  
  // If we're on mobile and using the mobile popup, don't hide content
  if (isMobile && isModalMobile) {
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
    }

    // Add active class to the clicked tab
    if (element) {
      element.classList.add("active");
    }
  }

  // Special handling for chart tab
  if (tabId.startsWith("chart-")) {
    const stationId = tabId.split("chart-")[1];
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
      }
    }
  }
}

// Export functions
export { createModal, showModal, initializeChart, showTab };