CREATE TABLE places (
    id SERIAL PRIMARY KEY,
    name TEXT,
    type TEXT,
    direction TEXT,
    lastupdate TIMESTAMP,
    description TEXT,
    dhv_id INTEGER,
    geom GEOMETRY(Point, 4326),
    rating TEXT,
    height TEXT,
    heightdifference TEXT,
    strplacemarkid TEXT
);
CREATE INDEX IF NOT EXISTS idx_places_dhv_id ON places(dhv_id);