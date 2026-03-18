import sodium from "libsodium-wrappers";

export const encryptSecretValue = async (value: string, publicKey: string) => {
  await sodium.ready;

  return sodium.to_base64(
    sodium.crypto_box_seal(
      sodium.from_string(value),
      sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL)
    ),
    sodium.base64_variants.ORIGINAL
  );
};
