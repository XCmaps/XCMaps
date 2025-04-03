#!/bin/bash

# This script creates a client in Keycloak for the XCmaps application

# Keycloak admin credentials
KEYCLOAK_URL="http://localhost:3000/auth"
KEYCLOAK_REALM="master"
KEYCLOAK_CLIENT="xcmaps-client"
ADMIN_USER="admin"
ADMIN_PASSWORD="admin"

# Get admin token
echo "Getting admin token..."
TOKEN=$(curl -s -X POST "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=${ADMIN_USER}" \
  -d "password=${ADMIN_PASSWORD}" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Failed to get admin token. Make sure Keycloak is running and credentials are correct."
  exit 1
fi

echo "Admin token obtained successfully."

# Check if client already exists
CLIENT_ID=$(curl -s -X GET "${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/clients" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" | grep -o "\"clientId\":\"${KEYCLOAK_CLIENT}\"")

if [ ! -z "$CLIENT_ID" ]; then
  echo "Client ${KEYCLOAK_CLIENT} already exists."
else
  # Create client
  echo "Creating client ${KEYCLOAK_CLIENT}..."
  curl -s -X POST "${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/clients" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{
      "clientId": "'${KEYCLOAK_CLIENT}'",
      "name": "XCmaps Client",
      "rootUrl": "http://localhost:3000",
      "adminUrl": "http://localhost:3000",
      "baseUrl": "/",
      "surrogateAuthRequired": false,
      "enabled": true,
      "alwaysDisplayInConsole": false,
      "clientAuthenticatorType": "client-secret",
      "redirectUris": [
        "http://localhost:3000/*"
      ],
      "webOrigins": [
        "+"
      ],
      "notBefore": 0,
      "bearerOnly": false,
      "consentRequired": false,
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": true,
      "serviceAccountsEnabled": false,
      "publicClient": true,
      "frontchannelLogout": false,
      "protocol": "openid-connect",
      "attributes": {
        "saml.assertion.signature": "false",
        "saml.force.post.binding": "false",
        "saml.multivalued.roles": "false",
        "saml.encrypt": "false",
        "backchannel.logout.revoke.offline.tokens": "false",
        "saml.server.signature": "false",
        "saml.server.signature.keyinfo.ext": "false",
        "exclude.session.state.from.auth.response": "false",
        "backchannel.logout.session.required": "true",
        "client_credentials.use_refresh_token": "false",
        "saml_force_name_id_format": "false",
        "saml.client.signature": "false",
        "tls.client.certificate.bound.access.tokens": "false",
        "saml.authnstatement": "false",
        "display.on.consent.screen": "false",
        "saml.onetimeuse.condition": "false"
      },
      "authenticationFlowBindingOverrides": {},
      "fullScopeAllowed": true,
      "nodeReRegistrationTimeout": -1,
      "defaultClientScopes": [
        "web-origins",
        "role_list",
        "profile",
        "roles",
        "email"
      ],
      "optionalClientScopes": [
        "address",
        "phone",
        "offline_access",
        "microprofile-jwt"
      ],
      "access": {
        "view": true,
        "configure": true,
        "manage": true
      }
    }'

  if [ $? -eq 0 ]; then
    echo "Client ${KEYCLOAK_CLIENT} created successfully."
  else
    echo "Failed to create client ${KEYCLOAK_CLIENT}."
    exit 1
  fi
fi

echo "Keycloak client setup complete."