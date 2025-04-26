import fs from "fs";
import { zodToJsonSchema } from "zod-to-json-schema";
import { configSchema } from "../src/config"

const jsonSchema = zodToJsonSchema(configSchema);

const outputPath = "./config.schema.json";
fs.writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2), "utf-8");
console.log(`JSON schema generated at ${outputPath}`);