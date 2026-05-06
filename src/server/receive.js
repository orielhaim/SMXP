import { deliverEnvelope } from "./delivery.js";
import { verifyRemoteSender } from "./verification.js";

export async function handleReceive(req) {
  let envelope;
  try {
    envelope = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return await deliverEnvelope(envelope, (message, sender) =>
    verifyRemoteSender(message, sender.domain, sender.localPart),
  );
}
