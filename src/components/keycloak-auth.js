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

// Helper function to get selected overlay layer labels (placeholder - needs actual implementation based on L.Control.Layers.Tree)
function getSelectedOverlayLabels(control) {
    if (!control || !control.getContainer) {
        console.warn("Layer control not available for getting selected layers.");
        return [];
    }
    const selectedLabels = [];
    const inputs = control.getContainer().querySelectorAll('input[type="checkbox"]');

    // This is a basic example assuming checkbox labels correspond to layer names in overlayTree
    // It might need significant adjustment based on the actual structure and methods of L.Control.Layers.Tree
    inputs.forEach(input => {
        if (input.checked) {
            // Find the corresponding label text - this depends heavily on the DOM structure
            let labelElement = input.closest('label') || input.parentElement.querySelector('span'); // Adjust selector as needed
            if (labelElement && labelElement.textContent.trim()) {
                 // We need to filter out base layers and parent nodes if necessary
                 // This logic is complex and depends on how L.Control.Layers.Tree renders nodes
                 const labelText = labelElement.textContent.trim();
                 // Add checks here to ensure it's an actual overlay layer node
                 // For now, adding all checked ones for demonstration
                 console.log("Found checked layer label:", labelText);
                 selectedLabels.push(labelText);
            }
        }
    });
     // TODO: Refine this logic to accurately get only selected *overlay* leaf nodes/layers
     // It might involve inspecting the control's internal state if available, or more complex DOM traversal.
    console.log("Selected overlay labels (raw):", selectedLabels);
    // Example filter (needs proper implementation): filter out parent labels like 'Weather Stations', 'Airspaces' etc.
    const knownParentLabels = ['Rain Viewer', 'Thermals', 'Spots']; // Removed 'Airspaces' and 'Weather Stations'
    const filteredLabels = selectedLabels.filter(label => !knownParentLabels.includes(label));
    console.log("Selected overlay labels (filtered):", filteredLabels);
    return filteredLabels;
}


// Logout function - saves preferences before redirecting to Keycloak logout
const logout = async () => { // Make async
  console.log('Logout clicked - attempting to save preferences...');

  // --- Save Preferences before logout ---
  if (isAuthenticated && keycloak.hasRealmRole('user')) {
    console.log("User is authenticated and has 'user' role. Saving preferences.");
    try {
      const selectedLayers = getSelectedOverlayLabels(window.treeLayersControl); // Assumes global treeLayersControl
      // Always prepare and send the current selection, even if empty
      const preferences = { selectedLayers: selectedLayers };
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
        return;
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
                 return; // No preferences saved yet, do nothing.
            }
            console.error(`Failed to load preferences: ${response.status} ${response.statusText}`);
            return;
        }

        const preferences = await response.json();
        console.log("Received preferences:", preferences);

        if (preferences && preferences.selectedLayers && Array.isArray(preferences.selectedLayers) && window.treeLayersControl) {
            console.log("Applying preferences to layer control:", preferences.selectedLayers);
            applyPreferencesToLayerControl(preferences.selectedLayers, window.treeLayersControl);
        } else {
             console.log("No valid selectedLayers found in preferences or layer control not ready.");
        }

    } catch (error) {
        console.error('Error loading user preferences:', error);
    }
};

// Helper function to apply preferences (placeholder - needs actual implementation)
function applyPreferencesToLayerControl(selectedLabels, control) {
     if (!control || !control.getContainer) {
        console.warn("Layer control not available for applying preferences.");
        return;
    }
    console.log("Attempting to apply labels:", selectedLabels);

    // This logic is highly dependent on L.Control.Layers.Tree implementation
    // We need to find the checkbox inputs corresponding to the labels and check them.
    const inputs = control.getContainer().querySelectorAll('input[type="checkbox"]');
    const labelsToApply = new Set(selectedLabels); // Use a Set for efficient lookup

    inputs.forEach(input => {
        let labelElement = input.closest('label') || input.parentElement.querySelector('span'); // Adjust selector
        if (labelElement) {
            const labelText = labelElement.textContent.trim();
            if (labelsToApply.has(labelText)) {
                if (!input.checked) {
                    console.log(`Checking layer: ${labelText}`);
                    input.click(); // Simulate a click to check the box and trigger layer addition
                    // Note: Directly setting input.checked = true might not trigger Leaflet's layer add events.
                    // Clicking is generally safer but might have side effects if click handlers do more than toggle.
                } else {
                     console.log(`Layer already checked: ${labelText}`);
                }
            } else {
                 // Uncheck layers not in the preferences list, especially defaults
                 // Check if the current layer is one of the defaults ('Weather Stations' or 'Radar')
                 const defaultLabels = ['Weather Stations', 'Radar'];
                 if (input.checked && defaultLabels.includes(labelText)) {
                    console.log(`Unchecking default layer not in preferences: ${labelText}`);
                    input.click(); // Simulate click to uncheck and trigger layer removal
                 }
            }
        }
    });
     console.log("Finished applying preferences.");
     // It might be necessary to explicitly update the map or control state after changing checkboxes.
     // control.expandSelected(true); // Example: Re-expand nodes if needed
}


// Export functions
export {
  initKeycloak,
  login,
  logout,
  isUserAuthenticated,
  getUserProfile,
  createUserControl,
  loadUserPreferences // Export the new function
};