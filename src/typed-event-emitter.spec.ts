import { describe, test, expect } from "bun:test";
import { TypedEventEmitter } from "./typed-event-emitter.ts";

interface TestEventMap {
  greet: { name: string };
  count: { value: number };
  empty: {};
}

describe("TypedEventEmitter", () => {
  test("on and emit deliver data to listener", () => {
    const emitter = new TypedEventEmitter<TestEventMap>();
    let received: { name: string } | undefined;

    emitter.on("greet", (data) => {
      received = data;
    });
    emitter.emit("greet", { name: "alice" });

    expect(received).toEqual({ name: "alice" });
  });

  test("supports multiple listeners for the same event", () => {
    const emitter = new TypedEventEmitter<TestEventMap>();
    const calls: string[] = [];

    emitter.on("greet", () => calls.push("a"));
    emitter.on("greet", () => calls.push("b"));
    emitter.emit("greet", { name: "test" });

    expect(calls).toEqual(["a", "b"]);
  });

  test("different events are independent", () => {
    const emitter = new TypedEventEmitter<TestEventMap>();
    const calls: string[] = [];

    emitter.on("greet", () => calls.push("greet"));
    emitter.on("count", () => calls.push("count"));
    emitter.emit("greet", { name: "test" });

    expect(calls).toEqual(["greet"]);
  });

  test("off removes a specific listener", () => {
    const emitter = new TypedEventEmitter<TestEventMap>();
    const calls: number[] = [];

    const listener = (data: { value: number }) => calls.push(data.value);
    emitter.on("count", listener);
    emitter.emit("count", { value: 1 });
    emitter.off("count", listener);
    emitter.emit("count", { value: 2 });

    expect(calls).toEqual([1]);
  });

  test("off only removes the specified listener", () => {
    const emitter = new TypedEventEmitter<TestEventMap>();
    const calls: string[] = [];

    const listenerA = () => calls.push("a");
    const listenerB = () => calls.push("b");
    emitter.on("greet", listenerA);
    emitter.on("greet", listenerB);
    emitter.off("greet", listenerA);
    emitter.emit("greet", { name: "test" });

    expect(calls).toEqual(["b"]);
  });

  test("emit with no listeners does nothing", () => {
    const emitter = new TypedEventEmitter<TestEventMap>();
    // Should not throw
    emitter.emit("greet", { name: "nobody" });
  });

  test("removeAllListeners clears all events", () => {
    const emitter = new TypedEventEmitter<TestEventMap>();
    const calls: string[] = [];

    emitter.on("greet", () => calls.push("greet"));
    emitter.on("count", () => calls.push("count"));
    emitter.removeAllListeners();
    emitter.emit("greet", { name: "test" });
    emitter.emit("count", { value: 1 });

    expect(calls).toEqual([]);
  });

  test("listener receives correct typed data", () => {
    const emitter = new TypedEventEmitter<TestEventMap>();
    let value: number | undefined;

    emitter.on("count", (data) => {
      value = data.value;
    });
    emitter.emit("count", { value: 42 });

    expect(value).toBe(42);
  });
});
