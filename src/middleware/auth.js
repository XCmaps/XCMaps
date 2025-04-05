import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import 'dotenv/config';

// Ensure required environment variables are set
if (!process.env.KEYCLOAK_AUTH_SERVER_URL || !process.env.KEYCLOAK_REALM_NAME) {
    console.error("ERROR: KEYCLOAK_AUTH_SERVER_URL and KEYCLOAK_REALM_NAME must be set in the environment variables.");
    process.exit(1); // Exit if essential config is missing
}

const client = jwksClient({
    jwksUri: `${process.env.KEYCLOAK_AUTH_SERVER_URL}/realms/${process.env.KEYCLOAK_REALM_NAME}/protocol/openid-connect/certs`
});

function getKey(header, callback) {
    client.getSigningKey(header.kid, function(err, key) {
        if (err) {
            console.error("Error fetching signing key:", err);
            return callback(err);
        }
        const signingKey = key.publicKey || key.rsaPublicKey;
        callback(null, signingKey);
    });
}

export function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (token == null) {
        console.log("Auth middleware: No token provided.");
        return res.status(401).json({ message: 'Authentication token required' }); // if there isn't any token
    }

    jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
        if (err) {
            console.error("Auth middleware: Token verification failed.", err.message);
            // Handle specific errors if needed (e.g., TokenExpiredError)
            if (err.name === 'TokenExpiredError') {
                 return res.status(401).json({ message: 'Token expired' });
            }
            return res.status(403).json({ message: 'Invalid or expired token' }); // if token is invalid or expired
        }

        // Attach user info to the request object
        req.user = {
            id: decoded.sub, // Keycloak User ID
            username: decoded.preferred_username,
            roles: decoded.realm_access?.roles || [], // Extract realm roles
            // Add other relevant decoded token claims if needed
        };
        console.log(`Auth middleware: Token verified for user ${req.user.username} (ID: ${req.user.id}), Roles: ${req.user.roles.join(', ')}`);
        next(); // pass the execution off to whatever request the client intended
    });
}

// Optional: Middleware to check for specific roles
export function requireRole(roleName) {
    return (req, res, next) => {
        if (!req.user || !req.user.roles || !req.user.roles.includes(roleName)) {
            console.warn(`Auth middleware: User ${req.user?.username || 'Unknown'} (ID: ${req.user?.id}) denied access. Required role: ${roleName}, User roles: ${req.user?.roles?.join(', ')}`);
            return res.status(403).json({ message: `Forbidden: Requires '${roleName}' role` });
        }
        next();
    };
}