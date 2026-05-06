# SMXP

<div align="center">

**The messaging protocol of the future**

---

Email was designed in the 1980s. Since then we've bolted on SPF, DKIM, DMARC, STARTTLS, IMAP, POP3, MIME, and a dozen other acronyms. each one a bandage on a system that was never meant to handle what we throw at it today.

SMXP doesn't fix email. It replaces it.

One protocol. One server. One API. Everything HTTP. Everything JSON. Everything signed.

</div>

---

## Why

Every year someone writes "email is broken" and proposes another layer on top of SMTP. Another extension. Another workaround. The result: a Frankenstein of protocols where sending a simple message requires negotiating with half a dozen systems (MTA, MDA, MUA, SPF, DKIM, DMARC, IMAP, POP3...)

SMXP starts from zero. No backwards compatibility with a 40-year-old protocol. No MIME. No headers soup. Just a clean and modern messaging system designed for how people and machines actually communicate today.

---

## How it works

### Identity is cryptography

Every SMXP address is a cryptographic identity. When an address is created, a signing keypair is generated. Every outgoing message is digitally signed. There's no way to spoof a sender at the protocol level - not "difficult" not "detectable." Impossible.

Public keys are exposed via a standard endpoint. Any server can independently verify any message without trusting a third party.

### Post-quantum signatures by default

SMXP uses **ML-DSA-65**. a NIST-standardized post-quantum digital signature algorithm (FIPS 204). While most systems today still rely on RSA or ECDSA that will break once quantum computing matures, SMXP is built for that world from day one. This isn't a future upgrade path. It's the default.

### Conversations as a primitive

In email, threading is a guess. Clients reconstruct it differently based on loose `In-Reply-To` and `References` headers, and the result is chaos. In SMXP, a conversation is a first-class concept. Every message belongs to a conversation and can point to a specific reply message. Clean threading without heuristics.

### Edit and delete

A sent message can be edited. It can be deleted. These aren't hacks - they're part of the protocol. An edit or delete is a regular signed message referencing the original. The receiving server can honor it or not - but the signal is standardized.

### Content types, declared

Every message declares its content type: `text`, `markdown` or `html`. No sniffing, no guessing. The client knows exactly how to render each message. Markdown as a built-in type means formatted messages without opening the Pandora's box of HTML and its security nightmares.

### Expiration

Any message can carry an expiration date. This doesn't enforce deletion - it's a signal to clients that the message is no longer relevant. Perfect for OTP codes, temporary invites, expiring links, or anything with a shelf life. The client decides how to display it (dimmed, hidden, tagged) - the protocol just carries the intent.

### Delegation

Instead of API keys, OAuth flows, or complex permission systems, SMXP uses delegation. An address can grant another address permission to act on its behalf - send, read, or manage. This works across completely different servers.

Everything is signature-based. No shared secrets crossing the wire. If Alice grants Bob send permission, Bob signs with his own key and the receiving server validates the delegation against Alice's server. Revocation is instant - Alice removes the delegation and it's done.

This also replaces API keys for applications. An app that needs to send messages gets its own SMXP address. If it needs to send on behalf of another address - delegation. No special credentials. No OAuth. No unnecessary complexity.

### Real-time delivery

SMXP supports SSE (Server-Sent Events) for receiving messages the instant they arrive. A simple unidirectional connection from server to client, running over standard HTTP, with automatic reconnection and built-in sync. When a client reconnects after a disconnect, it receives everything it missed. No polling. No waste.

### Smart forwarding

An address can be configured as a forward pointing to one or many addresses. Wildcards are supported - everything arriving at any address under a domain gets forwarded automatically. This replaces the need for complex catch-all rules.

### Discovery via SVCB

SMXP doesn't use MX records. MX is a primitive discovery mechanism that does one thing - point to a hostname. No port info, no protocol info, no server capabilities. SMXP uses **SVCB records** (RFC 9460) - a modern DNS record type built exactly for this.

```
_smxp.example.com. IN SVCB 1 mail.example.com. alpn="h2,h3" port=8443
```

What this gives you:

**Flexible port** - no reliance on a fixed port like SMTP's 25. Any server can run on any port and publish it in DNS. Run behind a reverse proxy, on a shared host, whatever - no fighting with ISPs blocking ports.

**Transport protocol selection** - the `alpn` parameter advertises which HTTP protocols the server supports (h2, h3, or both). Clients pick the best option - h3 for faster 0-RTT connections, h2 as fallback. Transparent to SMXP itself because everything is HTTP.

**IP hints** - the record can include `ipv4hint` and `ipv6hint`, saving extra A/AAAA lookups. First connection to a new server is faster.

**ECH (Encrypted Client Hello)** - SVCB supports publishing ECH keys that encrypt the TLS SNI. Even someone intercepting traffic can't tell which specific domain is being connected to.

**Priority and failover** - multiple SVCB records with different priorities give automatic failover to backup servers without any special client logic.

**One port for everything** - in SMTP world, port 25 is for server-to-server, 587 for submission, 993 for IMAP, 465 for SMTPS. In SMXP there's one port that does everything - sending, reading, SSE streaming. And it's published in DNS, not hardcoded.

When a server needs to deliver a message to `alice@example.com`, it does a SVCB lookup on `_smxp.example.com`, gets the hostname, port, and preferred protocol, and connects. Simple. Fast. Standard.

## Quick start

```bash
# Clone
git clone https://github.com/orielhaim/smxp.git
cd smxp

# Install
bun install

# Configure
bun run cli

# Run test server
bun run node1
```

---

## Roadmap

- **Universal database support** - pluggable storage layer via [Drizzle ORM](https://orm.drizzle.team). bring your own database, SMXP adapts.

- **Official client** - a dedicated open-source client built specifically for SMXP. Not an email client with SMXP bolted on. A proper, purpose-built interface that takes full advantage of the protocol - real-time delivery, native conversations, edit/delete, expiration, the works.

- **Federation test suite** - automated testing tools for server-to-server communication, signature verification, and delegation flows.

- **SDK & libraries** - lightweight packages for building on top of SMXP in any language.

---

## Contributing

If you're tired of email being stuck in 1985 and want to help build what comes next - PRs are open. Check the issues, pick something, or propose something new.

---

## License

[Apache 2.0](LICENSE). Do whatever you want with it.
