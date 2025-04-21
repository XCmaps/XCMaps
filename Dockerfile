# Use Node.js LTS as the base image
FROM node:20-alpine

# Install dependencies required for canvas, GDAL, and PostGIS
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pixman-dev \
    cairo-dev \
    pango-dev \
    libjpeg-turbo-dev \
    giflib-dev \
    gdal \
    gdal-dev \
    gdal-tools \
    postgresql-client \
    postgis

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
# Using npm ci for faster, reliable builds in CI/CD environments
# Consider --only=production if you don't need devDependencies in the final image
RUN npm ci

# Copy specific application files and directories
# Ensure these paths match your project structure
COPY server.js ./
COPY src ./src
COPY build ./build
COPY scripts ./scripts

# Expose the port the app runs on (as defined in server.js)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Command to run the application
CMD ["node", "server.js"]