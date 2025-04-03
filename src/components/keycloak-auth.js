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

// Logout function - redirect to Keycloak logout
const logout = () => {
  console.log('Logout clicked - redirecting to Keycloak logout');
  try {
    keycloak.logout({ redirectUri: window.location.origin });
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

// Export functions
export {
  initKeycloak,
  login,
  logout,
  isUserAuthenticated,
  getUserProfile,
  createUserControl
};