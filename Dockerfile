FROM node:24-alpine

ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --chown=node:node index.html styles.css script.js leads-client.js server.mjs landing.config.json ./
COPY --chown=node:node assets/ ./assets/
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
