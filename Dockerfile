FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY worker ./worker
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
