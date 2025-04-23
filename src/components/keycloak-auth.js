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
        onLoad: 'check-sso', // Reverted to check-sso
        // Using default options
      })
        .then(authenticated => {
          console.log('Keycloak initialized, authenticated:', authenticated);
          isAuthenticated = authenticated;

          if (authenticated) {
            return keycloak.loadUserProfile();
          } else {
            resolve(authenticated); // Resolve immediately if not authenticated
            return null; // Stop promise chain
          }
        })
        .then(profile => {
          if (profile) { // Only runs if authenticated
            userProfile = profile;
            updateUserIcon(true);
            resolve(isAuthenticated); // Resolve after profile load
          }
        })
        .catch(error => {
          console.error('Failed to initialize Keycloak:', error);
          reject(error); // Reject with the actual error
        });
    } catch (error) {
      console.error('Error in initKeycloak:', error);
      reject(error); // Reject with the actual error
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

// Helper function to compare two preference states (map layers + live settings)
function comparePreferenceStates(state1, state2) {
    if (!state1 || !state2) return false; // Cannot compare if one is missing

    // --- Compare Map State ---
    const mapState1 = { selectedBaseLayer: state1.selectedBaseLayer, selectedOverlays: state1.selectedOverlays };
    const mapState2 = { selectedBaseLayer: state2.selectedBaseLayer, selectedOverlays: state2.selectedOverlays };

    // Normalize potentially null/undefined arrays for map overlays
    const overlays1 = mapState1.selectedOverlays || [];
    const overlays2 = mapState2.selectedOverlays || [];

    // Check base layer
    if (mapState1.selectedBaseLayer !== mapState2.selectedBaseLayer) {
        return false;
    }

    // Check overlay layers (order doesn't matter)
    if (overlays1.length !== overlays2.length) {
        return false;
    }
    const set1 = new Set(overlays1);
    for (const overlay of overlays2) {
        if (!set1.has(overlay)) {
            return false;
        }
    }

    // --- Compare Live Settings ---
    const liveSettings1 = state1.liveSettings || {}; // Default to empty object if missing
    const liveSettings2 = state2.liveSettings || {};

    // Compare each live setting property (add more as needed)
    if (liveSettings1.showResting !== liveSettings2.showResting ||
        liveSettings1.showHiking !== liveSettings2.showHiking ||
        liveSettings1.showDriving !== liveSettings2.showDriving) {
        return false;
    }
    // Add comparisons for other live settings here if introduced later

    return true; // States are identical
}

// Helper function to update the Save Settings button appearance and state
function updateSaveButtonAppearance(button, hasChanges) {
    if (!button) return;
    if (hasChanges) {
        button.style.backgroundColor = '#4CAF50'; // Green
        button.style.color = 'white';
        button.style.cursor = 'pointer';
        button.disabled = false;
        button.dataset.hasChanges = 'true'; // Mark that there are changes
    } else {
        button.style.backgroundColor = '#d3d3d3'; // Light grey
        button.style.color = 'black'; // Default text color
        button.style.cursor = 'default';
        button.disabled = true; // Make it non-clickable visually and functionally
        button.dataset.hasChanges = 'false'; // Mark no changes
    }
}


// Logout function - saves preferences before redirecting to Keycloak logout
const logout = async () => { // Make async
  console.log('Logout clicked - attempting to save preferences...');

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

// Update user icon based on authentication state
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
        
        // Create container for the icon
        container.innerHTML = `<div class="user-icon-container"></div>`;
        
        // Set initial icon based on authentication state
        updateUserIcon(isAuthenticated);
        
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
const showProfileBadge = async (container) => { // Make async
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
    <div id="profile-badge-message" style="color: green; margin-bottom: 5px; display: none; text-align: left;"></div> <!-- Message Area -->
    <div class="profile-actions" style="display: flex; justify-content: space-between; align-items: center; padding-top: 5px;">
      <button id="save-settings-button" class="save-settings-button" style="padding: 5px 10px; border: none; border-radius: 3px;">Save Settings</button> <!-- Initial style set by JS -->
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

  // Get references
  const saveSettingsButton = document.getElementById('save-settings-button');
  const messageArea = document.getElementById('profile-badge-message'); // Get message area

  // --- Check current vs saved preferences ---
  let savedPreferences = null;
  let hasChanges = false;
  if (isAuthenticated && keycloak.hasRealmRole('user')) {
      try {
          const response = await fetch('/api/user/preferences', {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${keycloak.token}` }
          });
          if (response.ok) {
              savedPreferences = await response.json();
          } else if (response.status !== 404) { // Ignore 404 (no prefs yet)
              console.error(`Failed to load preferences: ${response.status}`);
          }
      } catch (error) {
          console.error('Error fetching preferences:', error);
      }
  }

  // --- Get Current State (Map + Live) ---
  const currentMapState = getCurrentMapState(window.treeLayersControl);
  let currentLiveSettings = {}; // Default empty
  if (window.liveControl && typeof window.liveControl.getLiveSettings === 'function') {
      currentLiveSettings = window.liveControl.getLiveSettings();
  } else {
      console.warn("LiveControl or getLiveSettings not available for preference check.");
  }
  const currentState = { ...currentMapState, liveSettings: currentLiveSettings };
  // --- End Get Current State ---


  // If no saved preferences, consider it a change if there's a current state (map or live)
  if (!savedPreferences && (currentState.selectedBaseLayer || currentState.selectedOverlays.length > 0 || Object.keys(currentState.liveSettings).length > 0)) {
      hasChanges = true;
  } else if (savedPreferences) {
      // Compare full preference state (map + live)
      hasChanges = !comparePreferenceStates(currentState, savedPreferences);
  }
  // --- End Check ---

  // Update button appearance based on comparison
  updateSaveButtonAppearance(saveSettingsButton, hasChanges);


  // Add click event listener to save settings button
  if (saveSettingsButton) {
    L.DomEvent.on(saveSettingsButton, 'click', async function(e) { // Make async
      L.DomEvent.stopPropagation(e);

      // Only save if the button indicates changes
      if (saveSettingsButton.dataset.hasChanges === 'true') {
          console.log('Save Settings button clicked - attempting to save...');
          // --- Get Current State to Save (Map + Live) ---
          const currentMapStateToSave = getCurrentMapState(window.treeLayersControl);
          let currentLiveSettingsToSave = {}; // Default empty
          if (window.liveControl && typeof window.liveControl.getLiveSettings === 'function') {
              currentLiveSettingsToSave = window.liveControl.getLiveSettings();
          }
          const preferencesToSave = { ...currentMapStateToSave, liveSettings: currentLiveSettingsToSave };
          // --- End Get Current State to Save ---

          try {
              const response = await fetch('/api/user/preferences', {
                  method: 'PUT',
                  headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${keycloak.token}`
                  },
                  body: JSON.stringify(preferencesToSave) // Send combined preferences
              });

              if (response.ok) {
                  messageArea.textContent = 'Settings saved successfully';
                  messageArea.style.color = 'green';
                  messageArea.style.display = 'block';
                  savedPreferences = preferencesToSave; // Update local "saved" state with combined prefs
                  updateSaveButtonAppearance(saveSettingsButton, false); // Revert button to grey/disabled
                  setTimeout(() => { messageArea.style.display = 'none'; messageArea.textContent = ''; }, 3000); // Hide after 3s
              } else {
                  messageArea.textContent = 'Failed to save settings.';
                  messageArea.style.color = 'red'; // Use red for errors
                  messageArea.style.display = 'block';
                  console.error(`Failed to save preferences: ${response.status} ${response.statusText}`);
                  setTimeout(() => { messageArea.style.display = 'none'; messageArea.textContent = ''; }, 3000); // Hide after 3s
              }
          } catch (error) {
              messageArea.textContent = 'Error saving settings.';
              messageArea.style.color = 'red';
              messageArea.style.display = 'block';
              console.error('Error saving user preferences via button:', error);
              setTimeout(() => { messageArea.style.display = 'none'; messageArea.textContent = ''; }, 3000); // Hide after 3s
          }
      } else {
          console.log('Save Settings button clicked, but no changes detected.');
      }
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
// Function to load and apply user preferences (called from index.js after init)
// Function to load and apply user preferences (called from index.js after init)
const loadUserPreferences = async () => {
    if (!isAuthenticated || !keycloak.hasRealmRole('user')) {
        console.log("User not logged in or not 'user' role. Skipping preference loading.");
        return { baseLayerApplied: false, liveSettingsApplied: false }; // Return status object
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
                 return { baseLayerApplied: false, liveSettingsApplied: false }; // No preferences saved yet
            }
            console.error(`Failed to load preferences: ${response.status} ${response.statusText}`);
            return { baseLayerApplied: false, liveSettingsApplied: false }; // Indicate failure
        }

        const preferences = await response.json();
        console.log("Received preferences:", preferences);

        let baseLayerApplied = false;
        let liveSettingsApplied = false;

        // Apply Map Preferences
        if (preferences && window.treeLayersControl) {
             console.log("Applying map preferences to layer control:", preferences);
             baseLayerApplied = applyMapPreferences(preferences, window.treeLayersControl);
        } else {
             console.log("Map preferences not found or layer control not ready.");
        }

        // Apply Live Settings Preferences
        if (preferences && preferences.liveSettings && window.liveControl && typeof window.liveControl.applyLivePreferences === 'function') {
            console.log("Applying live settings preferences:", preferences.liveSettings);
            window.liveControl.applyLivePreferences(preferences.liveSettings);
            liveSettingsApplied = true; // Assume success if function exists and is called
        } else {
            console.log("Live settings preferences not found or LiveControl not ready.");
        }

        return { baseLayerApplied, liveSettingsApplied }; // Return status object

    } catch (error) {
        console.error('Error loading user preferences:', error);
        return { baseLayerApplied: false, liveSettingsApplied: false }; // Indicate failure
    }
};

// Helper function to apply saved preferences (base layer and overlays)
function applyMapPreferences(preferences, control) {
    if (!control || !control.getContainer) {
        console.warn("Layer control not available for applying preferences.");
        return false; // Indicate base layer not set
    }

    const controlContainer = control.getContainer();
    // Use defaults if properties are missing/null in preferences
    const { selectedBaseLayer = null, selectedOverlays = [] } = preferences;
    const overlayLabelsToApply = new Set(selectedOverlays);
    let baseLayerApplied = false;

    console.log("Applying Base Layer:", selectedBaseLayer);
    console.log("Applying Overlays:", selectedOverlays);

    // Apply base layer selection
    const baseLayerRadios = controlContainer.querySelectorAll('.leaflet-control-layers-base input[type="radio"]');
    baseLayerRadios.forEach(radio => {
        let labelElement = radio.closest('label') || radio.parentElement.querySelector('span');
        if (labelElement) {
             const labelText = labelElement.textContent.trim();
             // Check if this radio corresponds to the saved preference
             if (labelText === selectedBaseLayer) {
                 if (!radio.checked) {
                     console.log(`Clicking base layer radio: ${selectedBaseLayer}`);
                     radio.click(); // Click to select the base layer
                 } else {
                      console.log(`Base layer already selected: ${selectedBaseLayer}`);
                 }
                 baseLayerApplied = true;
             }
        }
    });

     if (selectedBaseLayer && !baseLayerApplied) {
         console.warn(`Could not find base layer radio button for label: ${selectedBaseLayer}`);
     }

    // Apply overlay selections
    const overlayCheckboxes = controlContainer.querySelectorAll('.leaflet-control-layers-overlays input[type="checkbox"]');
    overlayCheckboxes.forEach(checkbox => {
        let labelElement = checkbox.closest('label') || checkbox.parentElement.querySelector('span');
        if (labelElement) {
            const labelText = labelElement.textContent.trim();
            const shouldBeChecked = overlayLabelsToApply.has(labelText);

            // Only click if the state needs changing
            if (checkbox.checked !== shouldBeChecked) {
                console.log(`Clicking overlay checkbox for: ${labelText} (Should be checked: ${shouldBeChecked})`);
                checkbox.click(); // Click to toggle state
            } else {
                 console.log(`Overlay checkbox already in correct state for: ${labelText} (Checked: ${checkbox.checked})`);
            }
        }
    });

    console.log("Finished applying preferences.");
    // control.expandSelected(true); // Optional: Re-expand nodes if needed
    return baseLayerApplied; // Return whether the preferred base layer was found and applied
}


// Export functions
export {
  keycloak, // Export keycloak instance
  initKeycloak,
  login,
  logout,
  isUserAuthenticated,
  getUserProfile,
  createUserControl,
  loadUserPreferences,
  // Potentially export comparePreferenceStates if needed elsewhere, but likely not
};