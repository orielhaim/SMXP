# SMXP - Simple Message eXchange Protocol

**The messaging protocol of the future**

<div align="center">

Email was designed in the 1980s. Since then we've bolted on SPF, DKIM, DMARC, STARTTLS, IMAP, POP3, MIME, and a dozen other acronyms. each one a bandage on a system that was never meant to handle what we throw at it today.

SMXP doesn't fix email. It replaces it.

One protocol. One server. One API. Everything HTTP. Everything JSON. Everything signed.

</div>

## Why

Every year someone writes "email is broken" and proposes another layer on top of SMTP. Another extension. Another workaround. The result: a Frankenstein of protocols where sending a simple message requires negotiating with half a dozen systems (MTA, MDA, MUA, SPF, DKIM, DMARC, IMAP, POP3...)

SMXP starts from zero. No backwards compatibility with a 40-year-old protocol. No MIME. No headers soup. Just a clean and modern messaging system designed for how people and machines actually communicate today.

## Designed to be open

SMXP is built around a single principle: the protocol decides as little as possible, and the operator decides everything else. Identity, transport, storage, content rendering, and delivery policy are all decoupled. There is one wire format and one set of HTTP endpoints - everything behind them is yours to shape.

Storage is fully pluggable. The server separates three concerns: internal state, message history, and file blobs. Each one talks to the rest of the system through a narrow, well-defined interface, and each one can be backed by the built-in local driver or pointed at an external service through configuration alone. No code changes, no forks, no adapters glued on top. The same is true for DNS resolution, signature algorithms, and content types - the protocol declares the contract, the deployment chooses the implementation.

This makes SMXP equally comfortable as a personal inbox on a single VPS, an internal messaging backbone for an organization, or a federated service running across many operators. The protocol does not assume a use case, so it does not stand in the way of one.

## Some benefits

### Conversations as a primitive

In email, threading is a guess. Clients reconstruct it differently based on loose `In-Reply-To` and `References` headers, and the result is chaos. In SMXP, a conversation is a first-class concept. Every message belongs to a conversation and can point to a specific reply message. Clean threading without heuristics.

### Edit and delete

A sent message can be edited. It can be deleted. These aren't hacks - they're part of the protocol. An edit or delete is a regular signed message referencing the original. The receiving server can honor it or not - but the signal is standardized.

### Content types, declared

Every message declares its content type: `text`, `markdown`, or `html`. No sniffing, no guessing. The client knows exactly how to render each message. Markdown as a built-in type means formatted messages without opening the Pandora's box of HTML and its security nightmares.

### Attachments, modern by default

Files are not stuffed into the envelope. They live in a separate blob store at the sender's server, are encrypted client-side before upload, and are referenced from the message through capability tokens issued per recipient.

### Expiration

Any message can carry an expiration date. This doesn't enforce deletion - it's a signal to clients that the message is no longer relevant. Perfect for OTP codes, temporary invites, expiring links, or anything with a shelf life. The client decides how to display it (dimmed, hidden, tagged) - the protocol just carries the intent.

### Delegation

Instead of API keys, OAuth flows, or complex permission systems, SMXP uses delegation. An address can grant another address permission to act on its behalf - send, read, or manage. This works across completely different servers.

Everything is signature-based. No shared secrets crossing the wire. If Alice grants Bob send permission, Bob signs with his own key and the receiving server validates the delegation against Alice's server. Revocation is instant - Alice removes the delegation and it's done.

### Real-time delivery

SMXP supports SSE (Server-Sent Events) for receiving messages the instant they arrive. A simple unidirectional connection from server to client, running over standard HTTP, with automatic reconnection and built-in sync. When a client reconnects after a disconnect, it receives everything it missed. No polling. No waste.

### Smart forwarding

An address can be configured as a forward pointing to one or many addresses. Wildcards are supported - everything arriving at any address under a domain gets forwarded automatically. This replaces the need for complex catch-all rules.

### Discovery via SVCB

SMXP doesn't use MX records. MX is a primitive discovery mechanism that does one thing - point to a hostname. No port info, no protocol info, no server capabilities. SMXP uses **SVCB records** (RFC 9460) - a modern DNS record type built exactly for this.

What this gives you:

**Flexible port** - no reliance on a fixed port like SMTP's 25. Any server can run on any port and publish it in DNS. Run behind a reverse proxy, on a shared host, whatever - no fighting with ISPs blocking ports.

**Transport protocol selection** - the `alpn` parameter advertises which HTTP protocols the server supports (h2, h3, or both). Clients pick the best option - h3 for faster 0-RTT connections, h2 as fallback. Transparent to SMXP itself because everything is HTTP.

**IP hints** - the record can include `ipv4hint` and `ipv6hint`, saving extra A/AAAA lookups. First connection to a new server is faster.

**ECH (Encrypted Client Hello)** - SVCB supports publishing ECH keys that encrypt the TLS SNI. Even someone intercepting traffic can't tell which specific domain is being connected to.

**Priority and failover** - multiple SVCB records with different priorities give automatic failover to backup servers without any special client logic.

**One port for everything** - in SMTP world, port 25 is for server-to-server, 587 for submission, 993 for IMAP, 465 for SMTPS. In SMXP there's one port that does everything - sending, reading, SSE streaming, blob transfer. And it's published in DNS, not hardcoded.

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

## Roadmap

- **Universal database support** - pluggable storage layer via [Drizzle ORM](https://orm.drizzle.team). bring your own database, SMXP adapts.

- **External blob storage drivers** - S3, R2, MinIO, and any other object store, behind the same interface the local driver already implements.

- **Official client** - a dedicated open-source client built specifically for SMXP. Not an email client with SMXP bolted on. A proper, purpose-built interface that takes full advantage of the protocol - real-time delivery, native conversations, edit/delete, expiration, encrypted attachments, the works.

- **Federation test suite** - automated testing tools for server-to-server communication, signature verification, and delegation flows.

- **SDK & libraries** - lightweight packages for building on top of SMXP in any language.

## Contributing

If you're tired of email being stuck in 1985 and want to help build what comes next - PRs are open. Check the issues, pick something, or propose something new.

## License

[Apache 2.0](LICENSE) Do whatever you want with it
