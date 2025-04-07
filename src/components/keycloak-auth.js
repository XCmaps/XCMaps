// Keycloak integration for user authentication

// Import Keycloak
import Keycloak from 'keycloak-js';

// Initialize Keycloak instance
const keycloak = new Keycloak({
  url: `${window.location.origin}/auth`,
  realm: 'master',
  clientId: 'xcmaps-client'
});

// Store the authentication state
let isAuthenticated = false;
let userProfile = null;

// Initialize Keycloak
const initKeycloak = () => {
  console.log('Initializing Keycloak...');
  return new Promise((resolve, reject) => {
    try {
      keycloak.init({
        onLoad: 'check-sso',
        // Disable silent check SSO to avoid 404 errors
        silentCheckSsoRedirectUri: null,
        checkLoginIframe: false
      })
        .then(authenticated => {
          console.log('Keycloak initialized, authenticated:', authenticated);
          isAuthenticated = authenticated;
          
          if (authenticated) {
            return keycloak.loadUserProfile();
          }
          
          resolve(authenticated);
        })
        .then(profile => {
          if (profile) {
            userProfile = profile;
            updateUserIcon(true);
          }
          resolve(isAuthenticated);
        })
        .catch(error => {
          console.error('Failed to initialize Keycloak:', error);
          resolve(false);
        });
    } catch (error) {
      console.error('Error in initKeycloak:', error);
      resolve(false);
    }
  });
};

// Login function - redirect to Keycloak login page
const login = () => {
  console.log('Login clicked - redirecting to Keycloak login');
  try {
    // Set up a callback for when login completes
    keycloak.onAuthSuccess = function() {
      console.log('Authentication successful');
      isAuthenticated = true;
      keycloak.loadUserProfile().then(profile => {
        userProfile = profile;
        updateUserIcon(true);
      });
    };
    
    keycloak.login();
  } catch (error) {
    console.error('Error during login:', error);
    // Show error message to user
    alert('Error during login. Please try again later.');
  }
};

// Helper function to get the current state of base and overlay layers
function getCurrentMapState(control) {
    if (!control || !control.getContainer) {
        console.warn("Layer control not available for getting map state.");
        return { selectedBaseLayer: null, selectedOverlays: [] };
    }

    const controlContainer = control.getContainer();
    let selectedBaseLayerLabel = null;
    const selectedOverlayLabels = [];

    // Find selected base layer (radio button)
    const baseLayerRadios = controlContainer.querySelectorAll('.leaflet-control-layers-base input[type="radio"]');
    baseLayerRadios.forEach(radio => {
        if (radio.checked) {
            let labelElement = radio.closest('label') || radio.parentElement.querySelector('span'); // Adjust selector if needed
            if (labelElement && labelElement.textContent.trim()) {
                selectedBaseLayerLabel = labelElement.textContent.trim();
                console.log("Found selected base layer label:", selectedBaseLayerLabel);
            }
        }
    });

    // Find selected overlay layers (checkboxes)
    const overlayCheckboxes = controlContainer.querySelectorAll('.leaflet-control-layers-overlays input[type="checkbox"]');
    overlayCheckboxes.forEach(checkbox => {
        if (checkbox.checked) {
            let labelElement = checkbox.closest('label') || checkbox.parentElement.querySelector('span'); // Adjust selector if needed
            if (labelElement && labelElement.textContent.trim()) {
                const labelText = labelElement.textContent.trim();
                // Basic filtering attempt - might need refinement if labels are ambiguous
                const knownParentLabels = ['Rain Viewer', 'Thermals', 'Spots']; // Labels of nodes that contain other layers
                if (!knownParentLabels.includes(labelText)) {
                    console.log("Found checked overlay layer label:", labelText);
                    selectedOverlayLabels.push(labelText);
                } else {
                    console.log("Skipping potential parent label:", labelText);
                }
            }
        }
    });

    console.log("Current map state:", { selectedBaseLayer: selectedBaseLayerLabel, selectedOverlays: selectedOverlayLabels });
    return { selectedBaseLayer: selectedBaseLayerLabel, selectedOverlays: selectedOverlayLabels };
}


// Logout function - saves preferences before redirecting to Keycloak logout
const logout = async () => { // Make async
  console.log('Logout clicked - attempting to save preferences...');

  // --- Save Preferences before logout ---
  if (isAuthenticated && keycloak.hasRealmRole('user')) {
    console.log("User is authenticated and has 'user' role. Saving preferences.");
    try {
      const currentMapState = getCurrentMapState(window.treeLayersControl); // Get base and overlays state
      // Always prepare and send the current state
      const preferences = {
          selectedBaseLayer: currentMapState.selectedBaseLayer, // Will be null if none selected
          selectedOverlays: currentMapState.selectedOverlays   // Will be [] if none selected
      };
      console.log("Sending preferences to save:", preferences);

      const response = await fetch('/api/user/preferences', {
          method: 'PUT',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${keycloak.token}`
          },
          body: JSON.stringify(preferences)
      });

      if (!response.ok) {
          console.error(`Failed to save preferences: ${response.status} ${response.statusText}`);
          // Optionally inform user, but proceed with logout
      } else {
          console.log("Preferences saved successfully (including empty state if applicable).");
      }
    } catch (error) {
      console.error('Error saving user preferences:', error);
      // Proceed with logout even if saving fails
    }
  } else {
      console.log("User not logged in or does not have 'user' role. Skipping preference saving.");
  }
  // --- End Save Preferences ---


  console.log('Proceeding with Keycloak logout...');
  try {
    // Clear local state immediately before redirect
    const redirectUri = window.location.origin;
    isAuthenticated = false;
    userProfile = null;
    // updateUserIcon(false); // This might not run fully before redirect, handle UI update on page load

    keycloak.logout({ redirectUri: redirectUri });
  } catch (error) {
    console.error('Error during logout:', error);
    // Fallback to manual logout
    isAuthenticated = false;
    userProfile = null;
    updateUserIcon(false);
    
    // Remove profile badge if exists
    const badge = document.getElementById('profile-badge');
    if (badge) {
      badge.remove();
    }
  }
};

// Check if user is authenticated
const isUserAuthenticated = () => {
  return isAuthenticated;
};

// Get user profile
const getUserProfile = () => {
  return userProfile;
};

// Update user icon based on authentication state (Reverted to innerHTML version)
const updateUserIcon = (authenticated) => {
  console.log('Updating user icon, authenticated:', authenticated);
  
  // Try to find the icon container with a small delay to ensure DOM is ready
  setTimeout(() => {
    const iconContainer = document.querySelector('.user-icon-container');
    if (iconContainer) {
      console.log('Found user icon container, updating image');
      if (authenticated) {
        // Use the active user icon
        iconContainer.innerHTML = `
          <img id="user-control-icon" src="/assets/images/user-active.svg" width="30" height="30" alt="User (logged in)" />
        `;
        console.log('Set active user icon');
      } else {
        // Use the default user icon
        iconContainer.innerHTML = `
          <svg id="user-control-icon" xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 256 256" xml:space="preserve">
            <g style="stroke: none; stroke-width: 0; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: none; fill-rule: nonzero; opacity: 1;" transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
              <path d="M 45 0 C 20.147 0 0 20.147 0 45 c 0 24.853 20.147 45 45 45 s 45 -20.147 45 -45 C 90 20.147 69.853 0 45 0 z M 45 22.007 c 8.899 0 16.14 7.241 16.14 16.14 c 0 8.9 -7.241 16.14 -16.14 16.14 c -8.9 0 -16.14 -7.24 -16.14 -16.14 C 28.86 29.248 36.1 22.007 45 22.007 z M 45 83.843 c -11.135 0 -21.123 -4.885 -27.957 -12.623 c 3.177 -5.75 8.144 -10.476 14.05 -13.341 c 2.009 -0.974 4.354 -0.958 6.435 0.041 c 2.343 1.126 4.857 1.696 7.473 1.696 c 2.615 0 5.13 -0.571 7.473 -1.696 c 2.083 -1 4.428 -1.015 6.435 -0.041 c 5.906 2.864 10.872 7.591 14.049 13.341 C 66.123 78.957 56.135 83.843 45 83.843 z" style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: rgb(0,0,0); fill-rule: nonzero; opacity: 1;" transform=" matrix(1 0 0 1 0 0) " stroke-linecap="round"/>
            </g>
          </svg>
        `;
        console.log('Set default user icon');
      }
    } else {
      console.error('User icon container not found');
    }
  }, 500);
};

// Create user control
const createUserControl = () => {
  try {
    console.log('Creating user control...');
    
    // Check if window.map exists
    if (!window.map) {
      console.error('Map not initialized yet, cannot add user control');
      // Try again after a short delay
      setTimeout(createUserControl, 1000);
      return;
    }
    
    // Check if control already exists
    if (document.getElementById('user-control')) {
      console.log('User control already exists, not creating again');
      return;
    }
    
    // Create a Leaflet control for the user icon
    L.Control.UserControl = L.Control.extend({
      onAdd: function(map) {
        console.log('Adding user control to map');
        const container = L.DomUtil.create('div', 'leaflet-control-user');
        container.id = 'user-control';
        // Removed: container.tabIndex = -1; 
        
        // Create container for the icon
        const iconContainer = L.DomUtil.create('div', 'user-icon-container', container); 
        // Removed: iconContainer.tabIndex = -1; 
        
        // Set initial icon based on authentication state
        updateUserIcon(isAuthenticated); // Call the reverted function
        
        // Add click event listener
        L.DomEvent.on(container, 'click', function(e) {
          L.DomEvent.stopPropagation(e);
          
          if (isAuthenticated) {
            // Show profile badge with logout option
            showProfileBadge(container);
          } else {
            // Login
            login();
          }
        });
        
        return container;
      }
    });
    
    L.control.userControl = function(opts) {
      return new L.Control.UserControl(opts);
    };
    
    // Add the user control to the map
    const userControl = L.control.userControl({ position: 'topright' });
    userControl.addTo(window.map);
    console.log('User control added to map');
    
    return userControl;
  } catch (error) {
    console.error('Error creating user control:', error);
  }
};

// Show profile badge with logout option
const showProfileBadge = (container) => {
  // Remove existing profile badge if any
  const existingBadge = document.getElementById('profile-badge');
  if (existingBadge) {
    existingBadge.remove();
    return;
  }
  
  // Create profile badge
  const badge = document.createElement('div');
  badge.id = 'profile-badge';
  badge.className = 'profile-badge';
  
  // Add user info and logout button
  badge.innerHTML = `
    <div class="profile-info">
      <div class="profile-name">${userProfile ? userProfile.username : 'User'}</div>
      ${userProfile && userProfile.email ? `<div class="profile-email">${userProfile.email}</div>` : ''}
    </div>
    <div class="profile-actions">
      <button id="logout-button" class="logout-button">Logout</button>
    </div>
  `;
  
  // Append badge to container
  container.appendChild(badge);
  
  // Add click event listener to logout button
  const logoutButton = document.getElementById('logout-button');
  if (logoutButton) {
    L.DomEvent.on(logoutButton, 'click', function(e) {
      L.DomEvent.stopPropagation(e);
      logout();
    });
  }
  
  // Close profile badge when clicking outside
  const closeProfileBadge = (e) => {
    const badge = document.getElementById('profile-badge');
    const container = document.getElementById('user-control');
    
    if (badge && container && !container.contains(e.target)) {
      badge.remove();
      document.removeEventListener('click', closeProfileBadge);
    }
  };
  
  // Add event listener with a slight delay to prevent immediate closing
  setTimeout(() => {
    document.addEventListener('click', closeProfileBadge);
  }, 100);
};

// Function to load and apply user preferences (called from index.js after init)
const loadUserPreferences = async () => {
    if (!isAuthenticated || !keycloak.hasRealmRole('user')) {
        console.log("User not logged in or not 'user' role. Skipping preference loading.");
        return false; // Indicate base layer not applied
    }

    console.log("User is authenticated 'user'. Loading preferences...");
    try {
        const response = await fetch('/api/user/preferences', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${keycloak.token}`
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                 console.log("No preferences found for user.");
                 return false; // No preferences saved yet, base layer not applied from prefs
            }
            console.error(`Failed to load preferences: ${response.status} ${response.statusText}`);
            return false; // Error, base layer not applied
        }

        const preferences = await response.json();
        console.log("Received preferences:", preferences);

        // Check if preferences exist and layer control is ready
        let baseLayerApplied = false;
        if (preferences && window.treeLayersControl && window.map) { // Ensure map is also ready
             console.log("Applying preferences to layer control:", preferences);
             baseLayerApplied = applyMapPreferences(preferences, window.treeLayersControl);
        } else {
             console.log("No preferences found or layer control/map not ready.");
        }
        return baseLayerApplied; // Return whether the preferred base layer was found and applied

    } catch (error) {
        console.error('Error loading user preferences:', error);
        return false; // Error, base layer not applied
    }
};

// Helper function to apply saved preferences (Refactored to avoid clicks)
function applyMapPreferences(preferences, control) {
    if (!control || !control.getContainer || !window.map || !control._layers) { // Check for map and internal _layers
        console.warn("Layer control, map, or internal layer mapping not available for applying preferences.");
        return false; // Indicate base layer not set
    }

    const controlContainer = control.getContainer();
    const { selectedBaseLayer: preferredBaseLayerLabel = null, selectedOverlays: preferredOverlayLabels = [] } = preferences;
    const preferredOverlaysSet = new Set(preferredOverlayLabels);
    let baseLayerApplied = false;

    console.log("Applying Preferences (No Click):");
    console.log(" - Base Layer:", preferredBaseLayerLabel);
    console.log(" - Overlays:", preferredOverlayLabels);

    // Iterate through all layers managed by the control
    control._layers.forEach(layerInfo => {
        const layer = layerInfo.layer;
        const layerLabel = layerInfo.name?.trim(); // Get label from control's internal structure
        const inputElement = layerInfo.input; // Get input element from control's internal structure

        if (!layerLabel || !inputElement) {
            console.warn("Skipping layer due to missing label or input element in control structure:", layerInfo);
            return; // Skip if essential info is missing
        }

        if (layerInfo.overlay) {
            // Handle Overlay Layer
            const shouldBeVisible = preferredOverlaysSet.has(layerLabel);
            const isVisible = window.map.hasLayer(layer);

            if (shouldBeVisible && !isVisible) {
                console.log(`Adding overlay: ${layerLabel}`);
                window.map.addLayer(layer);
            } else if (!shouldBeVisible && isVisible) {
                console.log(`Removing overlay: ${layerLabel}`);
                window.map.removeLayer(layer);
            }

            // Update checkbox UI without clicking
            if (inputElement.checked !== shouldBeVisible) {
                console.log(`Setting checkbox UI for ${layerLabel} to ${shouldBeVisible}`);
                inputElement.checked = shouldBeVisible;
            }

        } else {
            // Handle Base Layer
            const shouldBeVisible = (layerLabel === preferredBaseLayerLabel);
            const isVisible = window.map.hasLayer(layer); // Check if THIS layer is on map

            if (shouldBeVisible) {
                if (!isVisible) {
                    console.log(`Adding base layer: ${layerLabel}`);
                    window.map.addLayer(layer);
                }
                // Update radio button UI without clicking
                if (!inputElement.checked) {
                    console.log(`Setting radio UI for ${layerLabel} to true`);
                    inputElement.checked = true;
                }
                baseLayerApplied = true; // Mark that the preferred base layer was handled
            } else {
                if (isVisible) {
                    console.log(`Removing base layer: ${layerLabel}`);
                    window.map.removeLayer(layer);
                }
                 // Update radio button UI without clicking
                if (inputElement.checked) {
                    console.log(`Setting radio UI for ${layerLabel} to false`);
                    inputElement.checked = false;
                }
            }
        }
    });

    // If a preferred base layer was specified but not found/applied (e.g., label mismatch), log warning
    if (preferredBaseLayerLabel && !baseLayerApplied) {
        console.warn(`Preferred base layer "${preferredBaseLayerLabel}" was not found or applied.`);
    }

    console.log("Finished applying preferences (No Click).");
    // No focus management needed here anymore as we didn't simulate clicks
    // Removed: setTimeout(() => { window.map?.getContainer()?.focus(); }, 0); 
    return baseLayerApplied; // Return whether the preferred base layer was found and applied
}


// Export functions
export {
  initKeycloak,
  login,
  logout,
  isUserAuthenticated,
  getUserProfile,
  createUserControl,
  loadUserPreferences // Name remains the same, functionality updated
};