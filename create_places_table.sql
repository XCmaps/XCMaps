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