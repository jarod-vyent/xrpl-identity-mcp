# xrpl-identity-mcp

[![CI](https://github.com/jarod-vyent/xrpl-identity-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/jarod-vyent/xrpl-identity-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`xrpl-identity-mcp` is the first identity-focused MCP server for the XRP Ledger: DIDs ([XLS-40](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0040-decentralized-identity)), credentials ([XLS-70](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0070-credentials)), multisig signer lists, and safe transaction prepare/verify/submit workflows. It prepares unsigned transactions, reads ledger state, verifies signed blobs against intent, and can submit pre-signed blobs without ever taking custody of keys.

Built by [Jarod Vyent](https://github.com/jarod-vyent), from the team behind [SciPHR](https://sciphr.io).

## Security Model

These invariants are core behavior:

1. **No key custody.** The server has no seed, private key, mnemonic, wallet import, or signing path. Signing happens in the user's wallet or agent.
2. **Network is explicit.** `XRPL_NETWORK` is `mainnet`, `testnet`, or `devnet`. The default is `testnet`. Every tool result includes `network`.
3. **Mainnet submit is opt-in.** `tx_submit_signed` on mainnet is blocked unless `ALLOW_MAINNET_SUBMIT=true` is set.
4. **Prepare, verify, then submit.** Write workflows return unsigned JSON with instructions to sign externally, call `tx_decode_verify`, and only then call `tx_submit_signed`.

## Quickstart

Claude MCP:

```bash
claude mcp add xrpl-identity -- npx -y xrpl-identity-mcp
```

Generic MCP client config:

```json
{
  "mcpServers": {
    "xrpl-identity": {
      "command": "npx",
      "args": ["-y", "xrpl-identity-mcp"],
      "env": {
        "XRPL_NETWORK": "testnet"
      }
    }
  }
}
```

Environment variables:

| Variable | Values | Default | Purpose |
| --- | --- | --- | --- |
| `XRPL_NETWORK` | `mainnet`, `testnet`, `devnet` | `testnet` | Selects the XRPL network. |
| `XRPL_ENDPOINT` | WebSocket URL | Network default | Overrides the rippled WebSocket endpoint. |
| `ALLOW_MAINNET_SUBMIT` | `true` or unset | unset | Required for `tx_submit_signed` on mainnet. |

Default endpoints:

| Network | Endpoint |
| --- | --- |
| `mainnet` | `wss://xrplcluster.com` |
| `testnet` | `wss://s.altnet.rippletest.net:51233` |
| `devnet` | `wss://s.devnet.rippletest.net:51233` |

## Tools

| Tool | What it does | Network writes? |
| --- | --- | --- |
| `did_resolve` | Resolve an XLS-40 DID object and fetch an `ipfs://` or `https://` DID document when present. | No |
| `did_prepare_set` | Prepare an unsigned `DIDSet` transaction. | No |
| `did_prepare_delete` | Prepare an unsigned `DIDDelete` transaction. | No |
| `credential_prepare_create` | Prepare an unsigned `CredentialCreate` transaction. | No |
| `credential_prepare_accept` | Prepare an unsigned `CredentialAccept` transaction. | No |
| `credential_prepare_delete` | Prepare an unsigned `CredentialDelete` transaction. | No |
| `credential_verify` | Read a credential object and report existence, acceptance, and expiration. | No |
| `credential_list` | List up to 400 credential objects visible to an account, with issuer/subject filtering. | No |
| `account_identity_summary` | Summarize auth posture, signer list, DID presence, and credential counts for an account. | No |
| `signer_list_prepare_set` | Prepare an unsigned `SignerListSet` transaction for multisig create, replace, or delete. | No |
| `tx_decode_verify` | Decode a signed blob, compute hash, and compare against expected intent. | No |
| `tx_submit_signed` | Submit a pre-signed blob and poll for validation. Mainnet requires `ALLOW_MAINNET_SUBMIT=true`. | Yes |

## Example Agent Flows

Resolve a DID and read its document:

1. Call `did_resolve` with `address` set to a classic XRPL address or `did:xrpl:<address>`.
2. Inspect `decoded.URI`, `decoded.Data`, and `decoded.DIDDocument`.
3. If the URI is `ipfs://` or `https://`, inspect `document` and `documentSource`.

Issue and accept a credential on testnet:

1. Set `XRPL_NETWORK=testnet`.
2. Call `credential_prepare_create` with issuer, subject, credential type, optional expiration, and optional URI.
3. Sign the returned `unsignedTx` externally with the issuer account.
4. Call `tx_decode_verify` with the signed blob and the expected intent.
5. Call `tx_submit_signed`.
6. Call `credential_prepare_accept` for the subject, sign externally, verify with `tx_decode_verify`, then submit.
7. Call `credential_verify` to confirm `accepted: true` and `expired: false`.

Verify a signed blob before submitting:

1. Call `tx_decode_verify` with `signedBlob` and an `expectedIntent` partial transaction JSON.
2. Check `matches` and any `mismatches`.
3. Submit only when the decoded transaction matches the user's intent.

## Development

```bash
npm install
npm run typecheck
npm run build
SKIP_INTEGRATION=1 npm test
```

Integration tests target testnet and are skipped when `SKIP_INTEGRATION=1`. To run the account summary integration test, set `XRPL_INTEGRATION_ACCOUNT` to a funded testnet account address.

## License

MIT
