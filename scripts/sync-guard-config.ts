/** Regenerate src/config/guard.ts from the compiled artifact and deployments/mezo-testnet.json (or a zero address). */
import { existsSync, readFileSync } from "node:fs";
import { writeGuardConfig } from "./deploy-guard";

const art = JSON.parse(readFileSync("contracts/artifacts/contracts/RescueGuard.sol/RescueGuard.json", "utf8"));
const dep = existsSync("deployments/mezo-testnet.json") ? JSON.parse(readFileSync("deployments/mezo-testnet.json", "utf8")).contracts.RescueGuard : null;
writeGuardConfig(
  dep?.address ?? "0x0000000000000000000000000000000000000000",
  dep?.deployBlock ?? 0,
  dep?.constructorArgs.borrowerOperationsSignatures ?? "0xD757e3646AF370b15f32EB557F0F8380Df7D639e",
  art.abi,
);
console.log("src/config/guard.ts", dep ? `-> ${dep.address}` : "-> zero address (not deployed yet)");
