export async function hashPassword(password) {
  const hash = await Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 65536, // 64MB
    timeCost: 3,
  });
  return hash;
}

export async function verifyPassword(password, passwordHash) {
  const valid = await Bun.password.verify(password, passwordHash);

  return valid;
}
