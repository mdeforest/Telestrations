"use client";

import { useEffect, useRef, useState } from "react";

export type Point = { x: number; y: number };
export type Stroke = { points: Point[]; brushSize: number };

interface DrawingCanvasProps {
  onSubmit: (strokes: Stroke[]) => void;
  replayStrokes?: Stroke[];
  disabled?: boolean;
  /** When true, hides brush controls and submit button — canvas is view-only. */
  readOnly?: boolean;
}

export function DrawingCanvas({ onSubmit, replayStrokes, disabled, readOnly }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>(replayStrokes ?? []);
  const currentStroke = useRef<Point[]>([]);
  const isDrawing = useRef(false);
  const [brushSize, setBrushSize] = useState(4);

  function getPos(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    return {
      x: (e as React.MouseEvent).clientX - rect.left,
      y: (e as React.MouseEvent).clientY - rect.top,
    };
  }

  function startDrawing(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) {
    isDrawing.current = true;
    currentStroke.current = [getPos(e)];
  }

  function continueDrawing(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) {
    if (!isDrawing.current) return;
    const pt = getPos(e);
    currentStroke.current.push(pt);

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx || currentStroke.current.length < 2) return;
    const pts = currentStroke.current;
    ctx.beginPath();
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000";
    ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  }

  function endDrawing() {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const points = currentStroke.current;
    currentStroke.current = [];
    if (points.length > 0) {
      setStrokes((prev) => [...prev, { points, brushSize }]);
    }
  }

  function handleSubmit() {
    onSubmit(strokes);
  }

  // Draw replay strokes onto the canvas when the component mounts with pre-existing data
  useEffect(() => {
    if (!replayStrokes || replayStrokes.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    for (const stroke of replayStrokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.lineWidth = stroke.brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#000";
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
  }, [replayStrokes]);

  return (
    <div className="flex flex-col gap-6 bg-surface-container p-4 sm:p-6 rounded-[2.5rem] shadow-ambient max-w-md w-full mx-auto transform rotate-1">
      <div className="bg-surface-container-high p-2 rounded-3xl">
        <canvas
          ref={canvasRef}
          width={400}
          height={400}
          className="bg-surface-container-lowest touch-none rounded-2xl w-full h-auto object-contain cursor-crosshair shadow-sm"
          onMouseDown={readOnly ? undefined : startDrawing}
          onMouseMove={readOnly ? undefined : continueDrawing}
          onMouseUp={readOnly ? undefined : endDrawing}
          onMouseLeave={readOnly ? undefined : endDrawing}
          onTouchStart={readOnly ? undefined : startDrawing}
          onTouchMove={readOnly ? undefined : continueDrawing}
          onTouchEnd={readOnly ? undefined : endDrawing}
        />
      </div>
      {!readOnly && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 font-label text-sm text-on-surface-variant bg-surface-container-low px-4 py-3 rounded-2xl transform -rotate-1">
            <label htmlFor="brush-size" className="uppercase tracking-wider font-bold">Brush</label>
            <input
              id="brush-size"
              type="range"
              min={1}
              max={20}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="flex-1 accent-secondary"
            />
            <span className="w-8 text-right font-mono font-bold">{brushSize}px</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={disabled}
            className="w-full py-4 rounded-xl text-xl font-black font-display bg-primary text-on-primary shadow-sketch shadow-primary-dim active:shadow-none active:translate-y-[2px] active:translate-x-[2px] active:scale-[0.98] disabled:opacity-50 disabled:active:translate-y-0 disabled:active:translate-x-0 disabled:active:shadow-sketch disabled:active:scale-100 transition-all transform rotate-1"
          >
            {disabled ? "Submitting…" : "Submit Drawing"}
          </button>
        </div>
      )}
    </div>
  );
}
