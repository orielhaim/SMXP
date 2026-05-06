export function parseAddress(address) {
  if (typeof address !== "string") {
    throw new Error("address must be a string");
  }

  const atIndex = address.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === address.length - 1) {
    throw new Error(`invalid address "${address}"`);
  }

  const localPart = address.slice(0, atIndex).trim().toLowerCase();
  const domain = address
    .slice(atIndex + 1)
    .trim()
    .toLowerCase();

  if (
    !localPart ||
    !domain ||
    localPart.includes("@") ||
    domain.includes("@")
  ) {
    throw new Error(`invalid address "${address}"`);
  }

  return { localPart, domain, address: `${localPart}@${domain}` };
}

export function formatAddress(localPart, domain) {
  return `${localPart.trim().toLowerCase()}@${domain.trim().toLowerCase()}`;
}
