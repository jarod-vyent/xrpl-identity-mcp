# xrpl-identity-mcp — Implementation Spec v0.1

MCP (Model Context Protocol) server for **identity operations on the XRP Ledger**: DIDs (XLS-40), Credentials (XLS-70), signer lists, and safe transaction preparation/verification. First identity-focused XRPL MCP server.

## Core security model (non-negotiable invariants)

1. **Never custodies keys.** No seed, private key, mnemonic, or wallet import anywhere in the codebase. No signing. The server PREPARES unsigned transactions, RESOLVES/READS ledger state, VERIFIES signed blobs against intent, and SUBMITS pre-signed blobs. Signing happens elsewhere (user's wallet/agent).
2. **Network is explicit.** `XRPL_NETWORK` env var: `mainnet` | `testnet` | `devnet`. Default: `testnet`. WebSocket endpoints: mainnet `wss://xrplcluster.com`, testnet `wss://s.altnet.rippletest.net:51233`, devnet `wss://s.devnet.rippletest.net:51233`. Allow `XRPL_ENDPOINT` env override for custom nodes.
3. **Mainnet submission is opt-in.** `tx_submit_signed` on mainnet requires env `ALLOW_MAINNET_SUBMIT=true`, otherwise the tool returns a structured error explaining the gate. Reads and prepares work on any network without gates.
4. **Every tool result includes `network`** so an agent can never confuse testnet and mainnet state.

## Stack

- TypeScript (strict), Node >= 18, ESM.
- `@modelcontextprotocol/sdk` (latest) — stdio transport.
- `xrpl` ^5.0.0. Verify DID (`DIDSet`/`DIDDelete`) and Credential (`CredentialCreate`/`CredentialAccept`/`CredentialDelete`) transaction types exist in the installed version's models; they should in 5.x. If any is missing, build the tx as plain JSON with correct fields and skip client-side model validation for that type (do NOT drop the tool).
- `vitest` for tests. No test may touch mainnet; integration tests target testnet and must be skippable (`SKIP_INTEGRATION=1` skips them; CI sets it).
- Build: `tsc` to `dist/`, `bin` entry `xrpl-identity-mcp` (shebang) so `npx xrpl-identity-mcp` works after publish.

## Project layout

```
src/
  index.ts            # entry: create MCP server over stdio, register tools
  config.ts           # network resolution from env, endpoint map, mainnet-submit gate
  xrpl-client.ts      # lazy singleton-per-process xrpl Client w/ connect/reconnect; injectable for tests
  ipfs.ts             # ipfs:// URI → https gateway fetch (gateway list w/ fallback), 10s timeout, 1MB cap
  tools/
    did.ts            # did_resolve, did_prepare_set, did_prepare_delete
    credentials.ts    # credential_prepare_create/accept/delete, credential_verify, credential_list
    account.ts        # account_identity_summary
    signers.ts        # signer_list_prepare_set
    tx.ts             # tx_decode_verify, tx_submit_signed
  lib/
    hex.ts            # utf8<->hex helpers (XRPL URI/Data/CredentialType fields are hex)
    intent.ts         # canonical intent comparison for tx_decode_verify
tests/                # unit + integration
```

## Tools (12)

All tools: zod (or SDK-native) input schemas, precise descriptions written for an AI agent consumer, structured JSON results, errors as structured `{ error, hint }` content (never throw raw).

### DID (XLS-40)
1. **`did_resolve`** `{ address }` — `ledger_entry` type `did` for account. Return raw DID object (URI, Data, DIDDocument fields hex-decoded to utf8 where valid). If URI is `ipfs://…` or `https://…`, fetch the DID document (via ipfs.ts / https, same limits) and include it as `document` plus `documentSource`. Also accept `did:xrpl:1:<address>` / `did:xrpl:<address>` style identifiers as input and extract the address. Nonexistent DID → `{ exists: false }`, not an error.
2. **`did_prepare_set`** `{ account, uri?, data?, didDocument? }` — at least one of uri/data/didDocument required. Build `DIDSet` with fields utf8→hex encoded. Autofill (fee, sequence, lastLedgerSequence = current + 100) via connected client, return `{ unsignedTx, instructions }` where instructions explain: sign externally, then use tx_decode_verify + tx_submit_signed.
3. **`did_prepare_delete`** `{ account }` — `DIDDelete`, same autofill/return shape.

### Credentials (XLS-70)
4. **`credential_prepare_create`** `{ issuerAccount, subject, credentialType, expiration?, uri? }` — `CredentialCreate`. credentialType utf8→hex (≤64 bytes enforced), expiration as ISO date converted to ripple epoch.
5. **`credential_prepare_accept`** `{ account, issuer, credentialType }` — `CredentialAccept`.
6. **`credential_prepare_delete`** `{ account, issuer?, subject?, credentialType }` — `CredentialDelete`.
7. **`credential_verify`** `{ issuer, subject, credentialType }` — `ledger_entry` type `credential`. Return `{ exists, accepted, expired, expiration?, uri?, raw }` — computes `expired` against current ledger close time. Not-found → `{ exists: false }`.
8. **`credential_list`** `{ address, role? }` — `account_objects` type `credential`; role filter `issuer`|`subject` (compare fields). Decode credentialType hex→utf8. Paginate via marker internally, cap 400 objects.

### Account
9. **`account_identity_summary`** `{ address }` — composite: `account_info` (flags: `lsfDisableMaster`, RegularKey set?, Domain decoded), signer list (`account_objects` type `signer_list`: quorum + entries), DID exists?, credential counts (as issuer / as subject). Single tool an agent calls to understand an account's identity posture.

### Signers
10. **`signer_list_prepare_set`** `{ account, quorum, signers: [{ address, weight }] }` — `SignerListSet` (validate 1–32 signers, weights ≥ 1, quorum ≤ sum(weights); quorum 0 + empty signers = delete list). Same prepare/return shape.

### Transaction safety
11. **`tx_decode_verify`** `{ signedBlob, expectedIntent? }` — decode via `xrpl` codec (`decode`). Return decoded JSON + `hash`. If `expectedIntent` (partial tx JSON) provided, deep-compare each provided field against decoded (hex fields compared after normalization, Amount normalized), return `{ matches, mismatches: [{ field, expected, actual }] }`. This is the WYSIWYS gate.
12. **`tx_submit_signed`** `{ signedBlob, failHard? }` — mainnet gate per invariant 3. Submit via `submit` (not submitAndWait) then poll `tx` up to ~20s for validation; return `{ engineResult, hash, validated, explanation }` where explanation translates common engine codes (tesSUCCESS, tec*, tem*) to plain language.

## README.md (write it well — this is the shop window)

- One-paragraph positioning: first identity-focused XRPL MCP server; DIDs, credentials, multisig — prepare/verify/submit, never custody.
- Security model section (the 4 invariants, prominently).
- Tool reference table (name, what it does, network writes?).
- Quickstart: `claude mcp add xrpl-identity -- npx -y xrpl-identity-mcp` + env vars table; plus generic MCP client JSON config block.
- Example agent flows: "resolve a DID and read its document", "issue + accept a credential on testnet", "verify a signed blob matches intent before submitting".
- Badge-ready: MIT license, CI badge.
- Credit line: "Built by [Jarod Vyent](https://github.com/jarod-vyent), from the team behind [SciPHR](https://sciphr.io)."
- XLS-40 / XLS-70 links to XRPL Standards.

## Other files

- `LICENSE` — MIT, copyright 2026 Jarod Vyent.
- `package.json` — name `xrpl-identity-mcp`, version `0.1.0`, license MIT, repository `github:jarod-vyent/xrpl-identity-mcp`, keywords (xrpl, mcp, did, verifiable-credentials, xls-40, xls-70, identity, model-context-protocol), `files: ["dist"]`, scripts: build/test/typecheck/dev.
- `.github/workflows/ci.yml` — Node 20: install, typecheck, build, unit tests (`SKIP_INTEGRATION=1`).
- `.gitignore` — node_modules, dist, .env.
- `tsconfig.json` — strict, ES2022, NodeNext.

## Tests

- Unit (no network): hex helpers round-trip; intent comparison (match, mismatch, hex-normalization cases); each prepare tool builds correct tx JSON given a mocked client (mock autofill); config network resolution + mainnet gate logic (gate blocks without env, allows with env — mock the client, never actually hit mainnet); credentialType >64 bytes rejected; signer list validation edge cases.
- Integration (testnet, skippable): connect, did_resolve on a known-nonexistent account returns `{exists:false}`; account_identity_summary on a funded testnet faucet account.
- All green under `npm test` with `SKIP_INTEGRATION=1`.

## Definition of done

`npm install && npm run typecheck && npm run build && SKIP_INTEGRATION=1 npm test` all pass. README complete. Commit everything (including package-lock.json) as focused commits on `main` with clear messages.
