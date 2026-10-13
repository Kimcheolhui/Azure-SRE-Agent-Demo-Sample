FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY app/src ./src
ARG CLIENT_SOURCE=app/src/provider-client.mjs
COPY ${CLIENT_SOURCE} ./src/provider-client.mjs
ARG SOURCE_COMMIT=local
ARG RELEASE=v1.8
ENV SOURCE_COMMIT=${SOURCE_COMMIT} RELEASE=${RELEASE} NODE_ENV=production
USER node
EXPOSE 8080 8081
CMD ["node", "src/server.mjs"]