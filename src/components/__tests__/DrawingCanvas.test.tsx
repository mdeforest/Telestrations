// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DrawingCanvas, type Stroke } from "../DrawingCanvas";

describe("DrawingCanvas", () => {
  it("renders a canvas element and a submit button", () => {
    render(<DrawingCanvas onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /submit/i })).toBeTruthy();
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("calls onSubmit with empty array when no drawing has been made", () => {
    const onSubmit = vi.fn();
    render(<DrawingCanvas onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith([]);
  });

  it("serializes a mouse draw sequence into a stroke with points", () => {
    const onSubmit = vi.fn();
    render(<DrawingCanvas onSubmit={onSubmit} />);
    const canvas = document.querySelector("canvas")!;

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 20 });
    fireEvent.mouseMove(canvas, { clientX: 30, clientY: 40 });
    fireEvent.mouseMove(canvas, { clientX: 50, clientY: 60 });
    fireEvent.mouseUp(canvas);

    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [strokes] = onSubmit.mock.calls[0];
    expect(strokes).toHaveLength(1);
    expect(strokes[0].points).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ]);
    expect(typeof strokes[0].brushSize).toBe("number");
  });

  it("uses the selected brush size in the serialized stroke", () => {
    const onSubmit = vi.fn();
    render(<DrawingCanvas onSubmit={onSubmit} />);
    const canvas = document.querySelector("canvas")!;
    const brushInput = screen.getByRole("slider");

    // Change brush size to 12
    fireEvent.change(brushInput, { target: { value: "12" } });

    fireEvent.mouseDown(canvas, { clientX: 5, clientY: 5 });
    fireEvent.mouseMove(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(canvas);

    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    const [strokes] = onSubmit.mock.calls[0];
    expect(strokes[0].brushSize).toBe(12);
  });

  it("accumulates multiple separate strokes from multiple mouse sequences", () => {
    const onSubmit = vi.fn();
    render(<DrawingCanvas onSubmit={onSubmit} />);
    const canvas = document.querySelector("canvas")!;

    // First stroke
    fireEvent.mouseDown(canvas, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(canvas);

    // Second stroke
    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 60 });
    fireEvent.mouseUp(canvas);

    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    const [strokes] = onSubmit.mock.calls[0];
    expect(strokes).toHaveLength(2);
    expect(strokes[0].points[0]).toEqual({ x: 0, y: 0 });
    expect(strokes[1].points[0]).toEqual({ x: 50, y: 50 });
  });

  it("accepts replayStrokes prop and renders without error", () => {
    const replay: Stroke[] = [
      { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], brushSize: 4 },
      { points: [{ x: 50, y: 50 }, { x: 150, y: 150 }], brushSize: 8 },
    ];
    // Should not throw
    expect(() =>
      render(<DrawingCanvas onSubmit={vi.fn()} replayStrokes={replay} />)
    ).not.toThrow();
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("re-renders replay strokes so onSubmit returns them when submitted without additional drawing", () => {
    const replay: Stroke[] = [
      { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], brushSize: 4 },
    ];
    const onSubmit = vi.fn();
    render(<DrawingCanvas onSubmit={onSubmit} replayStrokes={replay} />);
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    // When in replay/display mode the component should pass back the replay strokes
    const [strokes] = onSubmit.mock.calls[0];
    expect(strokes).toEqual(replay);
  });
});
