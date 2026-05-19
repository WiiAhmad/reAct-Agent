import { expect, test } from "bun:test";
import { redactSecrets } from "../../src/logging/redaction";

test("redactSecrets masks nested secret keys and token strings while preserving safe content", () => {
  const input = {
    user: "terry",
    nested: {
      apiKey: "sk-ant-api03-secret-value",
      api_key: "sk-proj-openai-secret-value",
      authorization: "Bearer abc.def.ghi",
      accessToken: "plain-token-value",
      safe: "Bearer public text plus sk-ant-api03-hidden should be masked",
    },
    items: [
      { refresh_token: "refresh-secret", note: "keep me" },
      "prefix sk-proj-openaiKey1234567890 suffix",
    ],
  };

  expect(redactSecrets(input)).toEqual({
    user: "terry",
    nested: {
      apiKey: "[REDACTED]",
      api_key: "[REDACTED]",
      authorization: "[REDACTED]",
      accessToken: "[REDACTED]",
      safe: "Bearer [REDACTED] text plus [REDACTED] should be masked",
    },
    items: [
      { refresh_token: "[REDACTED]", note: "keep me" },
      "prefix [REDACTED] suffix",
    ],
  });
});

test("redactSecrets masks common secret-bearing key names while preserving safe fields", () => {
  expect(
    redactSecrets({
      clientSecret: "client-secret-value",
      webhook_secret: "webhook-secret-value",
      secretKey: "secret-key-value",
      secret_key: "secret-key-value-2",
      privateKey: "private-key-value",
      access_key: "access-key-value",
      password: "password-value",
      safe: "visible",
    }),
  ).toEqual({
    clientSecret: "[REDACTED]",
    webhook_secret: "[REDACTED]",
    secretKey: "[REDACTED]",
    secret_key: "[REDACTED]",
    privateKey: "[REDACTED]",
    access_key: "[REDACTED]",
    password: "[REDACTED]",
    safe: "visible",
  });
});

test("redactSecrets clones repeated shared references instead of treating them as circular", () => {
  const shared = {
    apiKey: "sk-ant-api03-sharedsecret",
    safe: "visible",
  };
  const input = {
    a: shared,
    b: shared,
  };

  expect(redactSecrets(input)).toEqual({
    a: {
      apiKey: "[REDACTED]",
      safe: "visible",
    },
    b: {
      apiKey: "[REDACTED]",
      safe: "visible",
    },
  });
});

test("redactSecrets preserves Error details while redacting secret strings", () => {
  const error = new Error("failed with sk-ant-api03-errorsecret and Bearer abc.def.ghi");
  error.stack = "Error: failed with sk-ant-api03-errorsecret\n    at Bearer abc.def.ghi";

  expect(redactSecrets(error)).toEqual({
    name: "Error",
    message: "failed with [REDACTED] and Bearer [REDACTED]",
    stack: "Error: failed with [REDACTED]\n    at Bearer [REDACTED]",
  });
});
