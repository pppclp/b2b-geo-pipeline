// Mounts the local Excel-backed API at /api inside the Vite dev server,
// so `npm run dev` runs frontend + backend together.
import path from "node:path";
import { createApi } from "./api.js";

export default function geoApi({ root = process.cwd() } = {}) {
  return {
    name: "geo-local-api",
    apply: "serve",
    configureServer(server) {
      const handle = createApi({
        yamlPath: path.join(root, "b2b_geo_pipeline.yaml"),
        dataDir: path.join(root, process.env.GEO_DATA_DIR || "data"),
      });
      server.middlewares.use((req, res, next) => (req.url.startsWith("/api/") ? handle(req, res) : next()));
    },
  };
}
