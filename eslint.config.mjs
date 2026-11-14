import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "node_modules/**", "contracts/**", "next-env.d.ts", "src/config/abis.ts"],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/set-state-in-effect": "off",
      // Date.now() is read on purpose to label data freshness; the React Compiler is not enabled.
      "react-hooks/purity": "off",
    },
  },
];

export default config;
