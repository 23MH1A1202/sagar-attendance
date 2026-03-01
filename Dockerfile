# Use official Playwright image with all dependencies & Chromium pre-installed
FROM mcr.microsoft.com/playwright:v1.54.2-jammy


# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json first to install dependencies
COPY package*.json ./

# Install node dependencies
RUN npm install

# Copy the rest of the project
COPY . .

# Expose your app's port
EXPOSE 8080

# Start your server
CMD ["node", "server.js"]
