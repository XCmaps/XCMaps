CREATE TABLE places (
    id SERIAL PRIMARY KEY,
    name TEXT,
    type TEXT,
    direction TEXT,
    lastupdate TIMESTAMP,
    descriptio TEXT,
    geom GEOMETRY(Point, 4326),
    rating TEXT,
    height TEXT,
    heightdiff TEXT,
    strplacem TEXT
);