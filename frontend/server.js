import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(join(__dirname, "public")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`listening on ${port}`));
