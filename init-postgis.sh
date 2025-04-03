#!/bin/bash
set -e

# Enable PostGIS extensions for the database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS postgis_topology;
    CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
    CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder;
    CREATE EXTENSION IF NOT EXISTS hstore;
    
    -- Create Keycloak schema if it doesn't exist
    CREATE SCHEMA IF NOT EXISTS keycloak;
    GRANT ALL PRIVILEGES ON SCHEMA keycloak TO "$POSTGRES_USER";
EOSQL

echo "PostGIS extensions and Keycloak schema enabled successfully!"