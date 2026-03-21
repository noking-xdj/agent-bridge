import { describe, it, expect } from "vitest";
import {
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  isRequest,
  isResponse,
  isNotification,
  serialize,
  parseBuffer,
} from "../../src/codex-protocol/json-rpc.js";

describe("JSON-RPC", () => {
  describe("createRequest", () => {
    it("creates a valid JSON-RPC request", () => {
      const req = createRequest("test/method", { foo: "bar" });
      expect(req.jsonrpc).toBe("2.0");
      expect(req.method).toBe("test/method");
      expect(req.params).toEqual({ foo: "bar" });
      expect(req.id).toBeDefined();
    });

    it("increments IDs", () => {
      const r1 = createRequest("a");
      const r2 = createRequest("b");
      expect(r2.id).toBeGreaterThan(r1.id as number);
    });
  });

  describe("createResponse", () => {
    it("creates a success response", () => {
      const res = createResponse(1, { ok: true });
      expect(res.jsonrpc).toBe("2.0");
      expect(res.id).toBe(1);
      expect(res.result).toEqual({ ok: true });
      expect(res.error).toBeUndefined();
    });
  });

  describe("createErrorResponse", () => {
    it("creates an error response", () => {
      const res = createErrorResponse(1, -32600, "Invalid request");
      expect(res.error?.code).toBe(-32600);
      expect(res.error?.message).toBe("Invalid request");
    });
  });

  describe("type guards", () => {
    it("identifies requests", () => {
      const req = createRequest("test");
      expect(isRequest(req)).toBe(true);
      expect(isResponse(req)).toBe(false);
      expect(isNotification(req)).toBe(false);
    });

    it("identifies responses", () => {
      const res = createResponse(1, null);
      expect(isResponse(res)).toBe(true);
      expect(isRequest(res)).toBe(false);
      expect(isNotification(res)).toBe(false);
    });

    it("identifies notifications", () => {
      const notif = createNotification("test/event", { data: 1 });
      expect(isNotification(notif)).toBe(true);
      expect(isRequest(notif)).toBe(false);
      expect(isResponse(notif)).toBe(false);
    });
  });

  describe("serialize", () => {
    it("serializes to newline-delimited JSON", () => {
      const msg = createNotification("test");
      const str = serialize(msg);
      expect(str.endsWith("\n")).toBe(true);
      expect(JSON.parse(str)).toEqual(msg);
    });
  });

  describe("parseBuffer", () => {
    it("parses complete messages", () => {
      const msg1 = createNotification("a");
      const msg2 = createNotification("b");
      const buffer = serialize(msg1) + serialize(msg2);

      const { messages, remaining } = parseBuffer(buffer);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual(msg1);
      expect(messages[1]).toEqual(msg2);
      expect(remaining).toBe("");
    });

    it("handles incomplete messages", () => {
      const complete = serialize(createNotification("a"));
      const buffer = complete + '{"jsonrpc":"2.0","meth';

      const { messages, remaining } = parseBuffer(buffer);
      expect(messages).toHaveLength(1);
      expect(remaining).toBe('{"jsonrpc":"2.0","meth');
    });

    it("skips empty lines", () => {
      const buffer = "\n\n" + serialize(createNotification("a")) + "\n";
      const { messages } = parseBuffer(buffer);
      expect(messages).toHaveLength(1);
    });

    it("skips malformed JSON", () => {
      const buffer = "not json\n" + serialize(createNotification("a"));
      const { messages } = parseBuffer(buffer);
      expect(messages).toHaveLength(1);
    });
  });
});
