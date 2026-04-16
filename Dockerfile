# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application source
COPY . .

# Expose the port the server listens on
EXPOSE 10000

# Start the backend server
CMD ["node", "server.js"]
