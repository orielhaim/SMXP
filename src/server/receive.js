import { DeliveryError, prepareDelivery, routeAndDeliver } from "./delivery.js";
import { verifyRemoteSender } from "./verification.js";

export async function processReceive(envelope) {
  const prepared = await prepareDelivery(envelope);
  try {
    await verifyRemoteSender(
      envelope,
      prepared.from.domain,
      prepared.from.localPart,
    );
  } catch (err) {
    throw new DeliveryError(403, `verification error: ${err.message}`);
  }

  return await routeAndDeliver(envelope, prepared);
}
