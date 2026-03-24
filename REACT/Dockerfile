# Serve pre-built React app using Nginx
# (React source files are not in the repo; using the existing dist/ folder)
FROM nginx:stable-alpine

# Create the directory structure explicitly to avoid pathing errors
RUN mkdir -p /usr/share/nginx/html/energymatrix/uat

# Copy the pre-built React app to the UAT subfolder
COPY dist /usr/share/nginx/html/energymatrix/uat

# Copy custom Nginx configuration
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]