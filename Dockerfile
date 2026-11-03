FROM node:22.16.0-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_PATH=/data/workspace.sqlite
EXPOSE 3000
CMD ["node", "src/server.mjs"]
