FROM node:13.7.0-alpine

WORKDIR /app
COPY package.json /app/
RUN npm install

COPY lib /app/lib
COPY index.js /app/
COPY config.example.js /app/config.js

CMD [ "node","index.js" ]