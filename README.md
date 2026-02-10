# food-bank

## Local dev

```bash
npm install
npm start
```

## Container

Build:

```bash
docker build -t food-bank .
```

Run:

```bash
docker run --rm -p 8080:80 food-bank
```

Then open http://localhost:8080

## Docker Compose

```bash
docker compose up --build
```

Then open http://localhost:8080
