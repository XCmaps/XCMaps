# This script creates a client in Keycloak for the XCmaps application

# Keycloak admin credentials
$KEYCLOAK_URL = "http://localhost:3000/auth"
$KEYCLOAK_REALM = "master"
$KEYCLOAK_CLIENT = "xcmaps-client"
$ADMIN_USER = "admin"
$ADMIN_PASSWORD = "admin"

# Get admin token
Write-Host "Getting admin token..."
$tokenResponse = Invoke-RestMethod -Uri "$KEYCLOAK_URL/realms/$KEYCLOAK_REALM/protocol/openid-connect/token" `
    -Method Post `
    -ContentType "application/x-www-form-urlencoded" `
    -Body @{
        username    = $ADMIN_USER
        password    = $ADMIN_PASSWORD
        grant_type  = "password"
        client_id   = "admin-cli"
    } -ErrorAction SilentlyContinue

if (-not $tokenResponse -or -not $tokenResponse.access_token) {
    Write-Host "Failed to get admin token. Make sure Keycloak is running and credentials are correct."
    exit 1
}

$TOKEN = $tokenResponse.access_token
Write-Host "Admin token obtained successfully."

# Check if client already exists
try {
    $clients = Invoke-RestMethod -Uri "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM/clients" `
        -Method Get `
        -Headers @{
            Authorization = "Bearer $TOKEN"
        } -ErrorAction SilentlyContinue
    
    $clientExists = $clients | Where-Object { $_.clientId -eq $KEYCLOAK_CLIENT }
    
    if ($clientExists) {
        Write-Host "Client $KEYCLOAK_CLIENT already exists."
    } else {
        # Create client
        Write-Host "Creating client $KEYCLOAK_CLIENT..."
        
        $clientData = @{
            clientId                  = $KEYCLOAK_CLIENT
            name                      = "XCmaps Client"
            rootUrl                   = "http://localhost:3000"
            adminUrl                  = "http://localhost:3000"
            baseUrl                   = "/"
            surrogateAuthRequired     = $false
            enabled                   = $true
            alwaysDisplayInConsole    = $false
            clientAuthenticatorType   = "client-secret"
            redirectUris              = @("http://localhost:3000/*")
            webOrigins                = @("+")
            notBefore                 = 0
            bearerOnly                = $false
            consentRequired           = $false
            standardFlowEnabled       = $true
            implicitFlowEnabled       = $false
            directAccessGrantsEnabled = $true
            serviceAccountsEnabled    = $false
            publicClient              = $true
            frontchannelLogout        = $false
            protocol                  = "openid-connect"
            attributes                = @{
                "saml.assertion.signature"                  = "false"
                "saml.force.post.binding"                   = "false"
                "saml.multivalued.roles"                    = "false"
                "saml.encrypt"                              = "false"
                "backchannel.logout.revoke.offline.tokens"  = "false"
                "saml.server.signature"                     = "false"
                "saml.server.signature.keyinfo.ext"         = "false"
                "exclude.session.state.from.auth.response"  = "false"
                "backchannel.logout.session.required"       = "true"
                "client_credentials.use_refresh_token"      = "false"
                "saml_force_name_id_format"                 = "false"
                "saml.client.signature"                     = "false"
                "tls.client.certificate.bound.access.tokens" = "false"
                "saml.authnstatement"                       = "false"
                "display.on.consent.screen"                 = "false"
                "saml.onetimeuse.condition"                 = "false"
            }
            authenticationFlowBindingOverrides = @{}
            fullScopeAllowed                   = $true
            nodeReRegistrationTimeout          = -1
            defaultClientScopes                = @(
                "web-origins",
                "role_list",
                "profile",
                "roles",
                "email"
            )
            optionalClientScopes               = @(
                "address",
                "phone",
                "offline_access",
                "microprofile-jwt"
            )
            access                             = @{
                view      = $true
                configure = $true
                manage    = $true
            }
        }
        
        $clientJson = $clientData | ConvertTo-Json -Depth 10
        
        $result = Invoke-RestMethod -Uri "$KEYCLOAK_URL/admin/realms/$KEYCLOAK_REALM/clients" `
            -Method Post `
            -Headers @{
                Authorization = "Bearer $TOKEN"
                "Content-Type" = "application/json"
            } `
            -Body $clientJson -ErrorAction SilentlyContinue
        
        Write-Host "Client $KEYCLOAK_CLIENT created successfully."
    }
} catch {
    Write-Host "Error: $_"
    exit 1
}

Write-Host "Keycloak client setup complete."