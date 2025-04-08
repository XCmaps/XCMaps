#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# This script automates the creation and configuration of Keycloak clients and roles for XCmaps.
# It expects the following environment variables to be set (e.g., from .env):
# - KEYCLOAK_AUTH_SERVER_URL: Base URL of Keycloak auth endpoint (e.g., http://keycloak:8080/auth)
# - KEYCLOAK_REALM_NAME: Keycloak realm name (e.g., master)
# - KEYCLOAK_ADMIN_USER: Keycloak admin username
# - KEYCLOAK_ADMIN_PASSWORD: Keycloak admin password
# - KEYCLOAK_CLIENT_ID: Public client ID for frontend (e.g., xcmaps-client)
# - KEYCLOAK_ADMIN_CLIENT_ID: Service account client ID for backend (e.g., xcmaps-backend-service)
# - APP_DOMAIN: Base URL of the XCmaps application (e.g., http://localhost:3000)

# --- Configuration ---
KC_AUTH_URL="${KEYCLOAK_AUTH_SERVER_URL:-http://localhost:8080/auth}" # Default for local dev if not set
KC_REALM="${KEYCLOAK_REALM_NAME:-master}"
KC_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
KC_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
FRONTEND_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-xcmaps-client}"
BACKEND_CLIENT_ID="${KEYCLOAK_ADMIN_CLIENT_ID:-xcmaps-backend-service}"
APP_URL="${APP_DOMAIN:-http://localhost:3000}"
USER_ROLE_NAME="user"
REALM_MGMT_CLIENT_ID="realm-management" # Built-in client for realm management roles

# --- Helper Functions ---
get_admin_token() {
  echo "🔑 Getting Keycloak admin token..."
  local TOKEN=$(curl -s -X POST "${KC_AUTH_URL}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=${KC_ADMIN_USER}" \
    -d "password=${KC_ADMIN_PASSWORD}" \
    -d "grant_type=password" \
    -d "client_id=admin-cli" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

  if [ -z "$TOKEN" ]; then
    echo "❌ ERROR: Failed to get admin token. Check Keycloak status and admin credentials." >&2
    exit 1
  fi
  echo "$TOKEN"
}

# Function to make authenticated API calls
kc_api_call() {
  local method=$1
  local endpoint=$2
  local data=$3
  local token=$4
  local content_type="application/json"

  local args=(-s -X "$method" "${KC_AUTH_URL}/admin/realms/${KC_REALM}/${endpoint}")
  args+=(-H "Authorization: Bearer ${token}")
  args+=(-H "Content-Type: ${content_type}")

  if [ -n "$data" ]; then
    args+=(-d "$data")
  fi

  # echo "DEBUG: curl ${args[@]}" # Uncomment for debugging API calls
  curl "${args[@]}"
}

# Function to get internal ID of a client by clientId
get_client_internal_id() {
  local client_id=$1
  local token=$2
  kc_api_call GET "clients?clientId=${client_id}" "" "$token" | grep -o '"id":"[^"]*' | head -n 1 | cut -d'"' -f4
}

# Function to get internal ID of a realm role by name
get_realm_role_id() {
    local role_name=$1
    local token=$2
    kc_api_call GET "roles/${role_name}" "" "$token" | grep -o '"id":"[^"]*' | cut -d'"' -f4
}

# Function to get internal ID of a client role by name
get_client_role_id() {
    local client_internal_id=$1
    local role_name=$2
    local token=$3
    kc_api_call GET "clients/${client_internal_id}/roles/${role_name}" "" "$token" | grep -o '"id":"[^"]*' | cut -d'"' -f4
}


# --- Main Script ---
TOKEN=$(get_admin_token)
echo "✅ Admin token obtained."

# 1. Create/Update Frontend Client (xcmaps-client)
echo "🔧 Checking/Creating Frontend Client: ${FRONTEND_CLIENT_ID}..."
FRONTEND_CLIENT_INTERNAL_ID=$(get_client_internal_id "$FRONTEND_CLIENT_ID" "$TOKEN")

FRONTEND_CLIENT_PAYLOAD=$(cat <<EOF
{
  "clientId": "${FRONTEND_CLIENT_ID}",
  "name": "XCmaps Frontend",
  "description": "Public client for the XCmaps web application.",
  "rootUrl": "${APP_URL}",
  "baseUrl": "/",
  "redirectUris": [ "${APP_URL}/*" ],
  "webOrigins": [ "${APP_URL}", "+" ],
  "enabled": true,
  "publicClient": true,
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": false,
  "implicitFlowEnabled": false,
  "serviceAccountsEnabled": false,
  "clientAuthenticatorType": "client-secret",
  "protocol": "openid-connect",
  "fullScopeAllowed": true,
   "defaultClientScopes": [
      "web-origins", "profile", "roles", "email"
   ],
   "optionalClientScopes": [
      "address", "phone", "offline_access"
   ]
}
EOF
)

if [ -z "$FRONTEND_CLIENT_INTERNAL_ID" ]; then
  echo "   Creating new frontend client..."
  kc_api_call POST "clients" "$FRONTEND_CLIENT_PAYLOAD" "$TOKEN" > /dev/null
  if [ $? -ne 0 ]; then echo "❌ ERROR: Failed to create frontend client." >&2; exit 1; fi
  echo "✅ Frontend client created."
else
  echo "   Frontend client already exists (ID: ${FRONTEND_CLIENT_INTERNAL_ID}). Updating..."
  # Use PUT to update existing client - Note: PUT replaces the entire resource
  kc_api_call PUT "clients/${FRONTEND_CLIENT_INTERNAL_ID}" "$FRONTEND_CLIENT_PAYLOAD" "$TOKEN" > /dev/null
   if [ $? -ne 0 ]; then echo "❌ ERROR: Failed to update frontend client." >&2; exit 1; fi
  echo "✅ Frontend client updated."
fi


# 2. Create/Update Backend Service Client (xcmaps-backend-service)
echo "🔧 Checking/Creating Backend Service Client: ${BACKEND_CLIENT_ID}..."
BACKEND_CLIENT_INTERNAL_ID=$(get_client_internal_id "$BACKEND_CLIENT_ID" "$TOKEN")

BACKEND_CLIENT_PAYLOAD=$(cat <<EOF
{
  "clientId": "${BACKEND_CLIENT_ID}",
  "name": "XCmaps Backend Service",
  "description": "Confidential client for XCmaps backend API interactions.",
  "enabled": true,
  "publicClient": false,
  "clientAuthenticatorType": "client-secret",
  "secret": null, # Let Keycloak generate the secret
  "serviceAccountsEnabled": true,
  "standardFlowEnabled": false,
  "directAccessGrantsEnabled": false,
  "implicitFlowEnabled": false,
  "authorizationServicesEnabled": false, # Keep Authorization OFF as per README
  "protocol": "openid-connect",
  "fullScopeAllowed": false # Limit scope initially
}
EOF
)

if [ -z "$BACKEND_CLIENT_INTERNAL_ID" ]; then
  echo "   Creating new backend client..."
  kc_api_call POST "clients" "$BACKEND_CLIENT_PAYLOAD" "$TOKEN" > /dev/null
   if [ $? -ne 0 ]; then echo "❌ ERROR: Failed to create backend client." >&2; exit 1; fi
  # Need to get the ID *after* creation
  BACKEND_CLIENT_INTERNAL_ID=$(get_client_internal_id "$BACKEND_CLIENT_ID" "$TOKEN")
  echo "✅ Backend client created (ID: ${BACKEND_CLIENT_INTERNAL_ID})."
else
  echo "   Backend client already exists (ID: ${BACKEND_CLIENT_INTERNAL_ID}). Updating..."
  kc_api_call PUT "clients/${BACKEND_CLIENT_INTERNAL_ID}" "$BACKEND_CLIENT_PAYLOAD" "$TOKEN" > /dev/null
   if [ $? -ne 0 ]; then echo "❌ ERROR: Failed to update backend client." >&2; exit 1; fi
  echo "✅ Backend client updated."
fi

# 3. Assign Service Account Roles to Backend Client
echo "🔧 Assigning Service Account Roles to ${BACKEND_CLIENT_ID}..."
# Get internal ID of the backend client's service account user
SERVICE_ACCOUNT_USER_ID=$(kc_api_call GET "clients/${BACKEND_CLIENT_INTERNAL_ID}/service-account-user" "" "$TOKEN" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
if [ -z "$SERVICE_ACCOUNT_USER_ID" ]; then echo "❌ ERROR: Could not find service account user for ${BACKEND_CLIENT_ID}." >&2; exit 1; fi

# Get internal ID of the realm-management client
REALM_MGMT_INTERNAL_ID=$(get_client_internal_id "$REALM_MGMT_CLIENT_ID" "$TOKEN")
if [ -z "$REALM_MGMT_INTERNAL_ID" ]; then echo "❌ ERROR: Could not find internal ID for ${REALM_MGMT_CLIENT_ID} client." >&2; exit 1; fi

# Roles to assign (from realm-management client)
ROLES_TO_ASSIGN=("manage-users" "view-users")
ROLES_PAYLOAD="["
COUNT=0
for role_name in "${ROLES_TO_ASSIGN[@]}"; do
    role_id=$(get_client_role_id "$REALM_MGMT_INTERNAL_ID" "$role_name" "$TOKEN")
    if [ -z "$role_id" ]; then
        echo "   ⚠️ WARNING: Could not find role '${role_name}' in client '${REALM_MGMT_CLIENT_ID}'. Skipping assignment." >&2
        continue
    fi
    # Fetch role representation to get all necessary fields
    role_repr=$(kc_api_call GET "clients/${REALM_MGMT_INTERNAL_ID}/roles/${role_name}" "" "$TOKEN")
    if [ $COUNT -gt 0 ]; then ROLES_PAYLOAD+=","; fi
    ROLES_PAYLOAD+="$role_repr"
    COUNT=$((COUNT + 1))
    echo "   Assigning role: ${role_name}"
done
ROLES_PAYLOAD+="]"

if [ $COUNT -gt 0 ]; then
    # Assign the roles to the service account user
    kc_api_call POST "users/${SERVICE_ACCOUNT_USER_ID}/role-mappings/clients/${REALM_MGMT_INTERNAL_ID}" "$ROLES_PAYLOAD" "$TOKEN" > /dev/null
    if [ $? -ne 0 ]; then echo "❌ ERROR: Failed to assign service account roles." >&2; exit 1; fi
    echo "✅ Service account roles assigned."
else
    echo "   No valid roles found to assign."
fi


# 4. Create Realm Role 'user'
echo "🔧 Checking/Creating Realm Role: ${USER_ROLE_NAME}..."
USER_ROLE_ID=$(get_realm_role_id "$USER_ROLE_NAME" "$TOKEN")

if [ -z "$USER_ROLE_ID" ]; then
  echo "   Creating new realm role: ${USER_ROLE_NAME}..."
  ROLE_PAYLOAD="{\"name\": \"${USER_ROLE_NAME}\", \"description\": \"Standard user role for XCmaps application\"}"
  kc_api_call POST "roles" "$ROLE_PAYLOAD" "$TOKEN" > /dev/null
   if [ $? -ne 0 ]; then echo "❌ ERROR: Failed to create realm role ${USER_ROLE_NAME}." >&2; exit 1; fi
  echo "✅ Realm role '${USER_ROLE_NAME}' created."
else
  echo "   Realm role '${USER_ROLE_NAME}' already exists."
fi

# 5. Retrieve and Display Backend Client Secret
echo "🔑 Retrieving Backend Client Secret for ${BACKEND_CLIENT_ID}..."
# Regenerate secret to ensure we can display it (or get existing if possible)
SECRET_DATA=$(kc_api_call POST "clients/${BACKEND_CLIENT_INTERNAL_ID}/client-secret" "" "$TOKEN")
CLIENT_SECRET=$(echo "$SECRET_DATA" | grep -o '"value":"[^"]*' | cut -d'"' -f4)

if [ -z "$CLIENT_SECRET" ]; then
  echo "❌ ERROR: Failed to retrieve client secret for ${BACKEND_CLIENT_ID}." >&2
  exit 1
fi

echo "✅ Backend client secret retrieved."
echo "---------------------------------------------------------------------"
echo "🔑 IMPORTANT: Add the following line to your .env file:"
echo ""
echo "KEYCLOAK_ADMIN_CLIENT_SECRET=${CLIENT_SECRET}"
echo ""
echo "---------------------------------------------------------------------"

echo "🎉 Keycloak setup script completed successfully!"