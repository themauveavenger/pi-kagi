// @ts-check

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default defineConfig({
  files: ["**/*.ts"],
  extends: [
    js.configs.recommended,
    tseslint.configs.recommended,
    tseslint.configs.stylistic,
    // Must come after the presets above so it can switch off anything
    // formatting-related they enabled; Prettier owns layout from here on.
    eslintConfigPrettier,
  ],
  rules: {
    // Prettier doesn't add/remove braces (that changes the AST, not just
    // layout), so this is exactly the option eslint-config-prettier's docs
    // call out as safe to keep alongside Prettier: "all", never "multi-line"
    // or "multi-or-nest".
    curly: ["error", "all"],
  },
});
