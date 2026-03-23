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
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: ((e as React.MouseEvent).clientX - rect.left) * scaleX,
      y: ((e as React.MouseEvent).clientY - rect.top) * scaleY,
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

  // Helper to adjust brush size to standard steps on slider
  const handleBrushChange = (size: number) => {
    setBrushSize(size);
    // Focus logic would go here if needed
  };

  return (
    <>
      <div className="flex-grow flex flex-col items-center justify-center w-full px-2 py-4">
        {/* The Drawing Paper Stack */}
        <div className="relative w-full max-w-2xl aspect-[4/3] min-h-[40vh]">
          <div className="absolute inset-0 bg-surface-container-highest -rotate-1 scale-[1.02] sm:scale-105 rounded-xl pointer-events-none opacity-40"></div>
          <div className="absolute inset-0 bg-surface-container-high rotate-1 scale-[1.01] sm:scale-[1.02] rounded-xl pointer-events-none opacity-60"></div>
          {/* Active Drawing Canvas */}
          <div className="absolute inset-0 bg-surface-container-lowest rounded-xl shadow-xl canvas-paper overflow-hidden border-4 border-surface-container-highest">
            <canvas
              ref={canvasRef}
              width={800}
              height={600}
              className="w-full h-full touch-none object-contain cursor-crosshair bg-transparent"
              onMouseDown={readOnly ? undefined : startDrawing}
              onMouseMove={readOnly ? undefined : continueDrawing}
              onMouseUp={readOnly ? undefined : endDrawing}
              onMouseLeave={readOnly ? undefined : endDrawing}
              onTouchStart={readOnly ? undefined : startDrawing}
              onTouchMove={readOnly ? undefined : continueDrawing}
              onTouchEnd={readOnly ? undefined : endDrawing}
            />
          </div>
        </div>
      </div>

      {!readOnly && (
        <footer className="w-full px-6 pb-8 pt-2 flex flex-col md:flex-row items-center justify-between gap-6 z-40 max-w-4xl mx-auto">
          {/* Drawing Tools: Glassmorphism Floating Palette */}
          <div className="flex flex-wrap items-center justify-center gap-4 bg-surface/80 backdrop-blur-md px-6 py-4 rounded-xl border-2 border-surface-container-highest shadow-lg w-full md:w-auto">
            {/* Swatches (Placeholder logic for design mapping) */}
            <div className="flex items-center gap-2 border-r border-surface-container-highest pr-4">
              <button disabled className="w-8 h-8 rounded-full bg-on-surface ring-4 ring-surface-container shadow-inner transition-transform active:scale-90"></button>
              <button disabled className="w-8 h-8 rounded-full bg-primary transition-transform active:scale-90 hover:scale-110 opacity-50"></button>
              <button disabled className="w-8 h-8 rounded-full bg-secondary transition-transform active:scale-90 hover:scale-110 opacity-50"></button>
              <button disabled className="w-8 h-8 rounded-full bg-tertiary transition-transform active:scale-90 hover:scale-110 opacity-50"></button>
              <button disabled className="w-8 h-8 rounded-full bg-error transition-transform active:scale-90 hover:scale-110 opacity-50"></button>
            </div>
            {/* Brush Sizes */}
            <div className="flex items-center gap-4">
              <button onClick={() => handleBrushChange(2)} className={`flex items-center justify-center w-8 h-8 transition-colors ${brushSize <= 2 ? 'text-primary' : 'text-on-surface-variant hover:text-primary'}`}>
                <div className="w-2 h-2 bg-current rounded-full"></div>
              </button>
              <button onClick={() => handleBrushChange(5)} className={`flex items-center justify-center w-8 h-8 transition-colors ${brushSize > 2 && brushSize <= 6 ? 'text-primary' : 'text-on-surface-variant hover:text-primary'}`}>
                <div className="w-4 h-4 bg-current rounded-full"></div>
              </button>
              <button onClick={() => handleBrushChange(10)} className={`flex items-center justify-center w-8 h-8 transition-colors ${brushSize > 6 ? 'text-primary' : 'text-on-surface-variant hover:text-primary'}`}>
                <div className="w-6 h-6 bg-current rounded-full"></div>
              </button>
            </div>
          </div>

          {/* Submit Button: The Squeezable Button */}
          <button
            onClick={handleSubmit}
            disabled={disabled}
            className="group relative w-full md:w-auto bg-primary text-on-primary font-headline font-bold text-lg px-12 py-4 rounded-xl sketch-shadow transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-50 disabled:grayscale"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {disabled ? "Submitting…" : "Submit Drawing"}
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            </span>
            {/* Gel Pen Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-tr from-primary to-primary-container opacity-20 rounded-xl"></div>
          </button>
        </footer>
      )}
    </>
  );
}
