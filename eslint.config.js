import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import pluginVueA11y from "eslint-plugin-vuejs-accessibility";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  js.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  ...pluginVueA11y.configs["flat/recommended"],
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tsParser,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // v-html bypasses Vue's escaping and is a standing XSS footgun. Nothing
      // in this codebase uses it today, but the rule stays wired at "error"
      // (not the plugin's default "warn", which wouldn't fail `npm run lint`
      // here since it isn't run with --max-warnings 0) so the first future
      // usage is caught before it lands.
      "vue/no-v-html": "error",
    },
  },
  prettier,
  {
    ignores: [
      ".vitepress/dist/**",
      ".vitepress/cache/**",
      "node_modules/**",
      "support.js",
    ],
  },
];
