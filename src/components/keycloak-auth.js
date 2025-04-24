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
    const liveSettings1 = state1.liveSettings || {};
    const liveSettings2 = state2.liveSettings || {};

    // Compare each live setting property
    if (liveSettings1.isActive !== liveSettings2.isActive || // Add isActive check
        liveSettings1.showResting !== liveSettings2.showResting ||
        liveSettings1.showHiking !== liveSettings2.showHiking ||
        liveSettings1.showDriving !== liveSettings2.showDriving) {
        return false;
    }

    // --- Compare Pilot Names ---
    const pilotNames1 = state1.pilotNames || [];
    const pilotNames2 = state2.pilotNames || [];

    if (pilotNames1.length !== pilotNames2.length) {
        return false;
    }
    // Simple comparison assuming order might matter for now, or if IDs are unique
    // For a more robust comparison (order-independent), convert to sets or sort first
    const pilotNames1String = JSON.stringify(pilotNames1.sort((a, b) => a.deviceId.localeCompare(b.deviceId)));
    const pilotNames2String = JSON.stringify(pilotNames2.sort((a, b) => a.deviceId.localeCompare(b.deviceId)));
    if (pilotNames1String !== pilotNames2String) {
        return false;
    }

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

    <!-- Live Pilot Name Configuration Section (Added) -->
    <div id="live-pilot-config-section" style="display: none; margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">
      <div style="font-weight: bold; margin-bottom: 8px; text-align: left;">Live! pilot name</div>
      <div id="live-pilot-rows-container">
        <!-- Rows will be added here by JS -->
      </div>
      <button id="add-pilot-row-button" class="add-pilot-button">+</button> <!-- Add Button -->
      <div class="live-pilot-consent">
        <input type="checkbox" id="live-pilot-consent-checkbox">
        <label for="live-pilot-consent-checkbox" style="font-size: 0.9em;">I certify to be the owner of this device</label>
      </div>
    </div>
    <!-- End Live Pilot Name Configuration Section -->
  `;
  
  // Append badge to container
  container.appendChild(badge);

  // Stop clicks inside the badge from propagating to the document listener
  L.DomEvent.on(badge, 'click', L.DomEvent.stopPropagation);
  L.DomEvent.on(badge, 'mousedown', L.DomEvent.stopPropagation); // Also stop mousedown

  // --- Live Pilot Config Logic will be handled later ---

  // Logout button listener will be added later, after the button element is confirmed to exist

  // --- Get references (Primary) ---
  const saveSettingsButton = document.getElementById('save-settings-button');
  const messageArea = document.getElementById('profile-badge-message');
  const logoutButton = document.getElementById('logout-button'); // Declare logoutButton here
  let initialPilotNamesState = []; // Store initial state for comparison
  let savedPreferences = null; // Declare savedPreferences here to be accessible in helpers

  // --- Helper: Add Pilot Name Row ---
  const addPilotNameRow = (deviceId = '', pilotName = '') => {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'live-pilot-row';
      rowDiv.style.display = 'flex';
      rowDiv.style.alignItems = 'center';
      rowDiv.style.marginBottom = '5px';
      rowDiv.innerHTML = `
          <div style="margin-right: 10px; flex-grow: 1;">
              <label style="display: block; font-size: 0.8em; margin-bottom: 2px;">Device ID</label>
              <input type="text" name="deviceId" value="${deviceId}" placeholder="e.g., 4AD2A8" style="width: 100%; padding: 3px;">
          </div>
          <div style="margin-right: 5px; flex-grow: 1;">
              <label style="display: block; font-size: 0.8em; margin-bottom: 2px;">Name</label>
              <input type="text" name="pilotName" value="${pilotName}" placeholder="Display Name" style="width: 100%; padding: 3px;">
          </div>
          <button class="remove-pilot-button" style="padding: 3px 8px; margin-left: 5px; background-color: #f44336; color: white; border: none; border-radius: 3px; cursor: pointer;">-</button>
      `;
      // Get livePilotRowsContainer reference here as it's needed now
      const livePilotRowsContainer = document.getElementById('live-pilot-rows-container');
      if (livePilotRowsContainer) {
           livePilotRowsContainer.appendChild(rowDiv);
      } else {
          console.error("Could not find live-pilot-rows-container to append row.");
      }
      // Add blur listener for deviceId input for lookup
      const deviceIdInput = rowDiv.querySelector('input[name="deviceId"]');
      if (deviceIdInput) {
          L.DomEvent.on(deviceIdInput, 'blur', handleDeviceIdBlur);
      }
  };

  // --- Helper: Handle Device ID Blur for Lookup ---
  const handleDeviceIdBlur = async (e) => {
      const deviceIdInput = e.target;
      const deviceId = deviceIdInput.value.trim();
      const row = deviceIdInput.closest('.live-pilot-row');
      const nameInput = row ? row.querySelector('input[name="pilotName"]') : null;

      if (!deviceId || !nameInput || nameInput.value.trim()) {
          // Don't lookup if device ID is empty or name is already filled
          return;
      }

      console.log(`Looking up name for Device ID: ${deviceId}`);
      try {
          // Show some loading indicator? (Optional)
          deviceIdInput.style.cursor = 'wait';
          nameInput.style.cursor = 'wait';

          const response = await fetch(`/api/lookup/pilot-name?deviceId=${encodeURIComponent(deviceId)}`); // Use your actual endpoint path

          if (response.ok) {
              const data = await response.json();
              if (data && data.name) {
                  console.log(`Found name: ${data.name}`);
                  nameInput.value = data.name;
                  updateSaveButtonState(); // Update save button state as name was changed programmatically
              } else {
                  console.log(`No name found for Device ID: ${deviceId}`);
              }
          } else {
              console.warn(`Pilot name lookup failed: ${response.status}`);
          }
      } catch (error) {
          console.error('Error during pilot name lookup:', error);
      } finally {
          // Remove loading indicator (Optional)
          deviceIdInput.style.cursor = '';
          nameInput.style.cursor = '';
      }
  };
  // --- Helper: Get Current Pilot Names from UI ---
  const getCurrentPilotNamesFromUI = () => {
      let currentData = [];
      // Get livePilotRowsContainer reference here as it's needed now
      const livePilotRowsContainer = document.getElementById('live-pilot-rows-container');
      if (livePilotRowsContainer) {
          const rows = livePilotRowsContainer.querySelectorAll('.live-pilot-row');
          rows.forEach(row => {
              const deviceIdInput = row.querySelector('input[name="deviceId"]');
              const nameInput = row.querySelector('input[name="pilotName"]');
              // Only include if both fields have some value (even if just whitespace initially)
              if (deviceIdInput && nameInput && (deviceIdInput.value || nameInput.value)) {
                  currentData.push({
                      deviceId: deviceIdInput.value.trim(),
                      name: nameInput.value.trim()
                  });
              }
          });
      } else {
           console.error("Could not find live-pilot-rows-container to get UI data.");
      }
      // Sort for consistent comparison
      return currentData.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  };
  // Removed duplicated block from getCurrentPilotNamesFromUI

  // --- Helper: Update Save Button State ---
  const updateSaveButtonState = () => {
      // 1. Check Map/Live Settings changes
      const currentMapState = getCurrentMapState(window.treeLayersControl);
      let currentLiveSettings = window.liveControl?.getLiveSettings() || {};
      const currentNonPilotState = { ...currentMapState, liveSettings: currentLiveSettings };
      const savedNonPilotState = { selectedBaseLayer: savedPreferences?.selectedBaseLayer, selectedOverlays: savedPreferences?.selectedOverlays, liveSettings: savedPreferences?.liveSettings };
      let mapOrLiveChanged = !comparePreferenceStates(currentNonPilotState, savedNonPilotState);

      // 2. Check Pilot Name changes (only if section is visible)
      let pilotNamesChanged = false;
      const livePilotConfigSection = document.getElementById('live-pilot-config-section'); // Get reference here
      const isLiveSectionVisible = livePilotConfigSection && livePilotConfigSection.style.display !== 'none';
      if (isLiveSectionVisible) {
          const currentPilotNames = getCurrentPilotNamesFromUI();
          // Compare current UI state to the initial state when the badge was opened
          pilotNamesChanged = JSON.stringify(currentPilotNames) !== JSON.stringify(initialPilotNamesState);
      }

      // 3. Determine overall changes
      const hasOverallChanges = mapOrLiveChanged || pilotNamesChanged;

      // 4. Update button appearance
      updateSaveButtonAppearance(saveSettingsButton, hasOverallChanges);
  };


  // --- Load Saved Preferences ---
  // let savedPreferences = null; // Moved declaration up
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
      // Store the initially loaded pilot names (sorted)
      initialPilotNamesState = (savedPreferences?.pilotNames || []).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  }
  // --- End Load Saved Preferences ---


  // --- Get Current State (Map + Live) - Initial Check ---
  // Removed redundant block
  // --- End Get Current State ---


  // --- Initial Save Button State ---
  // updateSaveButtonAppearance(saveSettingsButton, hasChanges); // Now called by updateSaveButtonState
  updateSaveButtonState(); // Set initial button state
  // --- End Initial Save Button State ---


  // --- Live Pilot Config Logic (Initialization and Listeners) ---
  const livePilotConfigSection = document.getElementById('live-pilot-config-section'); // Get reference
  if (livePilotConfigSection && keycloak.hasRealmRole('live')) {
    livePilotConfigSection.style.display = 'block';
    // Stop propagation for clicks/mousedown within the entire live config section
    L.DomEvent.on(livePilotConfigSection, 'click', L.DomEvent.stopPropagation);
    L.DomEvent.on(livePilotConfigSection, 'mousedown', L.DomEvent.stopPropagation);

    const livePilotRowsContainer = document.getElementById('live-pilot-rows-container'); // Get reference
    const addPilotRowButton = document.getElementById('add-pilot-row-button'); // Get reference
    const consentCheckbox = document.getElementById('live-pilot-consent-checkbox'); // Get reference

    // Ensure containers/buttons exist before adding listeners
    if (livePilotRowsContainer && addPilotRowButton && consentCheckbox) {
       // Populate initial rows from saved preferences
       livePilotRowsContainer.innerHTML = ''; // Clear any placeholders
       if (initialPilotNamesState.length > 0) {
           initialPilotNamesState.forEach(pilot => addPilotNameRow(pilot.deviceId, pilot.name));
       } else {
           addPilotNameRow(); // Add one empty row if none saved
       }

       // Add Row Button Listener
       L.DomEvent.on(addPilotRowButton, 'click', (e) => {
           L.DomEvent.stopPropagation(e);
           addPilotNameRow();
           updateSaveButtonState(); // Check for changes after adding row
       });

       // Delegated Listeners for Rows (Remove, Input Change, Device ID Blur) - Corrected Syntax
       L.DomEvent.on(livePilotRowsContainer, 'click', (e) => {
           // Check if the click target is the remove button
           if (e.target.matches('.remove-pilot-button')) {
               // Explicitly stop propagation for the remove button click
               L.DomEvent.stopPropagation(e);
               e.target.closest('.live-pilot-row').remove();
               updateSaveButtonState(); // Check for changes after removing row
           }
           // Clicks on other elements within the container will also be stopped by the section listener added earlier
       });

       L.DomEvent.on(livePilotRowsContainer, 'input', (e) => {
           // Check if the input event occurred on an input element
           if (e.target.matches('input')) {
               // Trigger change check on any input change within the rows
               updateSaveButtonState();
           }
       });

       // Attach blur listener without capture phase
       L.DomEvent.on(livePilotRowsContainer, 'blur', (e) => {
            if (e.target.matches('input[name="deviceId"]')) {
                handleDeviceIdBlur(e); // Call the existing lookup handler
            }
       }); // Removed capture phase 'true'


       // Consent Checkbox Listener
       L.DomEvent.on(consentCheckbox, 'change', (e) => {
           // Consent checkbox change doesn't directly mark *data* as changed,
           // but it affects whether saving is *allowed*.
           // The save button click handler already checks this.
           console.log("Consent checkbox changed:", e.target.checked);
       });
    } else {
        console.error("Could not find all elements needed for Live Pilot Config setup.");
    }
  } // Added missing closing brace for the 'if (livePilotConfigSection && keycloak.hasRealmRole('live'))' block
  // --- End Live Pilot Config Logic ---


  // --- Save Button Click Listener ---
  if (saveSettingsButton) {
    L.DomEvent.on(saveSettingsButton, 'click', async function(e) { // Make async
      L.DomEvent.stopPropagation(e);

      // Re-check button state and consent just before saving
      updateSaveButtonState(); // Ensure state is current
      const isSaveButtonEnabled = saveSettingsButton.dataset.hasChanges === 'true';
      const livePilotConfigSection = document.getElementById('live-pilot-config-section');
      const consentCheckbox = document.getElementById('live-pilot-consent-checkbox');
      const isLiveSectionVisible = livePilotConfigSection && livePilotConfigSection.style.display !== 'none';
      const isConsentChecked = !isLiveSectionVisible || consentCheckbox.checked;

      if (isSaveButtonEnabled) {
          // --- Device ID Validation (Added) ---
          let invalidDeviceIdFound = false;
          if (isLiveSectionVisible) {
              const rows = livePilotConfigSection.querySelectorAll('.live-pilot-row');
              rows.forEach(row => {
                  const deviceIdInput = row.querySelector('input[name="deviceId"]');
                  if (deviceIdInput && deviceIdInput.value.trim() && deviceIdInput.value.trim().length !== 6) {
                      invalidDeviceIdFound = true;
                      // Optionally highlight the invalid input
                      deviceIdInput.style.border = '1px solid red';
                  } else if (deviceIdInput) {
                      // Reset border if valid or empty
                      deviceIdInput.style.border = '';
                  }
              });
          }

          if (invalidDeviceIdFound) {
              messageArea.textContent = 'Device ID must be exactly 6 characters long.';
              messageArea.style.color = 'red';
              messageArea.style.display = 'block';
              setTimeout(() => { messageArea.style.display = 'none'; messageArea.textContent = ''; }, 3000);
              return; // Stop saving
          }
          // --- End Device ID Validation ---


          // --- Consent Check ---
          if (isLiveSectionVisible && !isConsentChecked) {
              messageArea.textContent = 'Please certify ownership to save live pilot names.';
              messageArea.style.color = 'red';
              messageArea.style.display = 'block';
              setTimeout(() => { messageArea.style.display = 'none'; messageArea.textContent = ''; }, 3000);
              return; // Stop saving
          }

          console.log('Save Settings button clicked - attempting to save...');

          // --- Get Live Pilot Name Data (Use Helper) ---
          const pilotNamesData = isLiveSectionVisible ? getCurrentPilotNamesFromUI().filter(p => p.deviceId && p.name) : []; // Ensure both fields are non-empty before saving
          // --- End Get Live Pilot Name Data ---


          // --- Get Current State to Save (Map + Live + Pilot Names) ---
          // Re-fetch map/live state at the moment of saving
          const currentMapStateToSave = getCurrentMapState(window.treeLayersControl);
          let currentLiveSettingsToSave = window.liveControl?.getLiveSettings() || {};
          const preferencesToSave = {
              ...currentMapStateToSave,
              liveSettings: currentLiveSettingsToSave,
              pilotNames: pilotNamesData // Add pilot names
          };
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
                  savedPreferences = preferencesToSave; // Update local "saved" state
                  initialPilotNamesState = (savedPreferences.pilotNames || []).sort((a, b) => a.deviceId.localeCompare(b.deviceId)); // Update initial state for future comparisons
                  updateSaveButtonState(); // Re-evaluate button state (should become disabled)
                  setTimeout(() => { messageArea.style.display = 'none'; messageArea.textContent = ''; }, 3000);
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
          console.log('Save Settings button clicked, but no changes detected or consent missing.');
      }
   });
 }
 // --- End Save Button Click Listener ---

 // --- Logout Button Listener (Ensure it's set up after button exists) ---
 if (logoutButton) {
   L.DomEvent.on(logoutButton, 'click', function(e) {
     L.DomEvent.stopPropagation(e);
     logout();
   });
 }
 // --- End Logout Button Listener ---

 // --- Close Badge Logic ---
 const closeProfileBadgeOnClickOutside = (e) => {
   const badgeElement = document.getElementById('profile-badge'); // Renamed to avoid conflict
   const userControlContainer = document.getElementById('user-control'); // Renamed to avoid conflict

   if (badgeElement && userControlContainer && !userControlContainer.contains(e.target)) {
     badgeElement.remove();
     document.removeEventListener('click', closeProfileBadgeOnClickOutside);
   }
 };

 // Add event listener with a slight delay to prevent immediate closing
 setTimeout(() => {
   document.addEventListener('click', closeProfileBadgeOnClickOutside);
 }, 100);
 // --- End Close Badge Logic ---

}; // End of showProfileBadge function

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

        // Apply Live Settings Preferences - Wait for LiveControl if necessary
        const applyLivePrefs = (prefsToApply) => {
            if (window.liveControl && typeof window.liveControl.applyLivePreferences === 'function') {
                console.log("LiveControl ready. Applying live settings preferences:", prefsToApply);
                console.log(`[keycloak-auth.loadUserPreferences] Calling applyLivePreferences on window.liveControl. showDriving value: ${prefsToApply?.showDriving}`);
                window.liveControl.applyLivePreferences(prefsToApply);
                liveSettingsApplied = true;
            } else {
                console.log("LiveControl not ready yet, retrying in 200ms...");
                setTimeout(() => applyLivePrefs(prefsToApply), 200); // Retry after a short delay
            }
        };

        if (preferences && preferences.liveSettings) {
            applyLivePrefs(preferences.liveSettings);
        } else {
            console.log("No live settings preferences found in loaded data.");
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