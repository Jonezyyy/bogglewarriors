# Use the official Node.js 22.11 image from Docker Hub
FROM node:22.11

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install production dependencies
RUN npm install --production

# Copy the rest of your application's source code
COPY . .

# Expose the port your application will run on
EXPOSE 3000

# Command to run your application
CMD ["node", "server.js"]
